const APPLE_MOBILE_FILE_PICKER_FALLBACK_REASON = "apple-mobile-unknown-package-extension";

export function applyFilePickerAcceptCompatibility(inputs, navigatorValue = globalThis.navigator) {
  const inputList = Array.from(inputs || []).filter(Boolean);
  const fallbackReason = getFilePickerAcceptFallbackReason(navigatorValue);

  for (const input of inputList) {
    if (fallbackReason) {
      if (!input.dataset.originalAccept) {
        input.dataset.originalAccept = input.getAttribute("accept") || "";
      }
      input.dataset.filePickerAcceptFallback = fallbackReason;
      input.removeAttribute("accept");
      continue;
    }

    if (input.dataset.originalAccept) {
      input.setAttribute("accept", input.dataset.originalAccept);
      delete input.dataset.originalAccept;
    }
    delete input.dataset.filePickerAcceptFallback;
  }

  return fallbackReason;
}

export function getFilePickerAcceptFallbackReason(navigatorValue = globalThis.navigator) {
  const userAgent = getNavigatorText(navigatorValue?.userAgent);
  const platform = getNavigatorText(navigatorValue?.platform);
  const maxTouchPoints = Number(navigatorValue?.maxTouchPoints || 0);

  if (isAppleMobileBrowserConfig(userAgent, platform, maxTouchPoints)) {
    return APPLE_MOBILE_FILE_PICKER_FALLBACK_REASON;
  }

  return "";
}

function isAppleMobileBrowserConfig(userAgent, platform, maxTouchPoints) {
  return (
    /\b(?:iPhone|iPad|iPod)\b/iu.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

function getNavigatorText(value) {
  return typeof value === "string" ? value : "";
}
