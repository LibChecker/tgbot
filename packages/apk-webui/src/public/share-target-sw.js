const SHARE_TARGET_PATH = "/share-target";
const SHARED_APK_CACHE = "apk-webui-share-target-v1";
const SHARED_APK_PATH = "/.pwa-share-target/apk";

globalThis.addEventListener("fetch", (event) => {
  const fetchEvent = /** @type {{ request: Request, respondWith(response: Promise<Response>): void }} */ (/** @type {unknown} */ (event));
  const requestUrl = new URL(fetchEvent.request.url);
  if (fetchEvent.request.method !== "POST" || requestUrl.pathname !== SHARE_TARGET_PATH) {
    return;
  }

  fetchEvent.respondWith(receiveSharedApk(fetchEvent.request));
});

async function receiveSharedApk(request) {
  let apk;
  try {
    apk = (await request.formData()).get("apk");
  } catch {
    return redirectToApp(request, "invalid");
  }

  if (!isApkFile(apk)) {
    return redirectToApp(request, "invalid");
  }

  try {
    const cache = await caches.open(SHARED_APK_CACHE);
    const cacheKey = new URL(SHARED_APK_PATH, request.url).href;
    // ponytail: one slot matches the single-package UI; key by launch ID if concurrent shares matter.
    await cache.put(cacheKey, new Response(apk, {
      headers: {
        "content-type": apk.type || "application/octet-stream",
        "x-pwa-file-name": encodeURIComponent(apk.name || "shared.apk"),
        "x-pwa-file-last-modified": String(apk.lastModified || Date.now()),
      },
    }));
  } catch {
    return redirectToApp(request, "failed");
  }

  return redirectToApp(request, "ready");
}

function isApkFile(value) {
  if (!(value instanceof File)) {
    return false;
  }
  const name = String(value.name || "").toLowerCase();
  const type = String(value.type || "").toLowerCase();
  return name.endsWith(".apk") || type.includes("android.package-archive");
}

function redirectToApp(request, result) {
  const url = new URL("/", request.url);
  url.searchParams.set("share-target", result);
  return Response.redirect(url, 303);
}
