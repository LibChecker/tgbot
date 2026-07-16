/**
 * Register the installed PWA as a single-package launch consumer.
 *
 * The manifest uses `multiple-clients`, so a conforming browser sends one file
 * to each app window. The first valid handle is still selected defensively for
 * browsers that provide more than one handle in a launch.
 *
 * @param {(file: File) => void | Promise<void>} onFile
 * @param {{ launchQueueRef?: LaunchQueue | null, onError?: (error: unknown) => void }} [options]
 * @returns {boolean} Whether a launch consumer was registered.
 */
export function registerPwaFileHandler(onFile, options = {}) {
  if (typeof onFile !== "function") {
    throw new TypeError("PWA file handling requires an onFile callback");
  }

  const launchQueueRef = options.launchQueueRef ?? globalThis.launchQueue;
  if (typeof launchQueueRef?.setConsumer !== "function") {
    return false;
  }

  const onError = typeof options.onError === "function"
    ? options.onError
    : reportPwaFileHandlerError;

  launchQueueRef.setConsumer(async (launchParams) => {
    const fileHandle = Array.from(launchParams?.files || [])
      .find((handle) => typeof handle?.getFile === "function");
    if (!fileHandle) {
      return;
    }

    try {
      await onFile(await fileHandle.getFile());
    } catch (error) {
      onError(error);
    }
  });

  return true;
}

function reportPwaFileHandlerError(error) {
  console.error("Failed to open the launched Android package", error);
}
