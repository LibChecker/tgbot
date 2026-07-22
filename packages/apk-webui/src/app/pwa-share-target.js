export const SHARED_APK_CACHE = "apk-webui-share-target-v1";
export const SHARED_APK_PATH = "/.pwa-share-target/apk";

const SHARE_TARGET_PARAM = "share-target";
const SHARE_TARGET_WORKER_PATH = "/share-target-sw.js";

/**
 * Register Android share handling and consume a pending APK once.
 *
 * @param {(file: File) => void | Promise<void>} onFile
 * @param {{
 *   cacheStorage?: CacheStorage | null,
 *   historyRef?: History | null,
 *   locationRef?: Location | URL | null,
 *   onRegistrationError?: (error: unknown) => void,
 *   serviceWorkerContainer?: ServiceWorkerContainer | null,
 * }} [options]
 * @returns {Promise<{ consumed: boolean, registered: boolean }>}
 */
export async function initializePwaShareTarget(onFile, options = {}) {
  if (typeof onFile !== "function") {
    throw new TypeError("PWA share target requires an onFile callback");
  }

  const serviceWorkerContainer = options.serviceWorkerContainer
    ?? globalThis.navigator?.serviceWorker;
  const registrationPromise = registerShareTargetWorker(serviceWorkerContainer)
    .catch((error) => {
      options.onRegistrationError?.(error);
      return false;
    });

  const file = await consumeSharedApk(options);
  if (file) {
    await onFile(file);
  }

  return {
    consumed: Boolean(file),
    registered: await registrationPromise,
  };
}

async function registerShareTargetWorker(serviceWorkerContainer) {
  if (typeof serviceWorkerContainer?.register !== "function") {
    return false;
  }
  await serviceWorkerContainer.register(SHARE_TARGET_WORKER_PATH, { scope: "/" });
  return true;
}

async function consumeSharedApk(options) {
  const locationRef = options.locationRef ?? globalThis.location;
  if (!locationRef) {
    return null;
  }

  const url = new URL(locationRef.href);
  const result = url.searchParams.get(SHARE_TARGET_PARAM);
  if (!result) {
    return null;
  }

  const historyRef = options.historyRef ?? globalThis.history;
  clearShareTargetParam(url, historyRef);
  if (result !== "ready") {
    throw new Error("The shared item is not a readable APK");
  }

  const cacheStorage = options.cacheStorage ?? globalThis.caches;
  if (typeof cacheStorage?.open !== "function") {
    throw new Error("Cache Storage is unavailable for the shared APK");
  }

  const cache = await cacheStorage.open(SHARED_APK_CACHE);
  const cacheKey = new URL(SHARED_APK_PATH, url.origin).href;
  const response = await cache.match(cacheKey);
  if (!response) {
    throw new Error("The shared APK is no longer available");
  }

  const blob = await response.blob();
  const file = new File([blob], decodeFileName(response.headers.get("x-pwa-file-name")), {
    type: response.headers.get("content-type") || blob.type,
    lastModified: Number(response.headers.get("x-pwa-file-last-modified")) || Date.now(),
  });
  await cache.delete(cacheKey);
  return file;
}

function clearShareTargetParam(url, historyRef) {
  url.searchParams.delete(SHARE_TARGET_PARAM);
  historyRef?.replaceState(historyRef.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function decodeFileName(value) {
  try {
    return decodeURIComponent(value || "shared.apk") || "shared.apk";
  } catch {
    return "shared.apk";
  }
}
