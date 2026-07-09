const REPORT_REF_PATTERN = /^rp_[a-f0-9]{32}$/u;
const REPORT_SHARE_TIMEOUT_MS = 15_000;
const REPORT_SHARE_MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function shareCurrentReport({
  cachedUrl,
  report,
  locale,
  reportDataOrigin,
  pageHref,
  pageSearch,
  title,
  text,
}) {
  const url = await prepareReportShareUrl({
    cachedUrl,
    report,
    locale,
    reportDataOrigin,
    pageHref,
    pageSearch,
  });

  return {
    ...(await shareReportUrl({ url, title, text })),
    url,
  };
}

export async function prepareReportShareUrl({
  cachedUrl,
  report,
  locale,
  reportDataOrigin,
  pageHref,
  pageSearch,
}) {
  const url = cachedUrl || getCurrentReportShareUrl(pageHref, pageSearch, locale);
  if (url) {
    return url;
  }

  return (await publishReport({
    endpoint: buildReportPublishEndpoint(reportDataOrigin, locale),
    report,
    locale,
  })).url;
}

export async function publishReport({ endpoint, report, locale }) {
  const payloadText = JSON.stringify({ report, locale }, stripReportPublishJson);
  if (new TextEncoder().encode(payloadText).byteLength > REPORT_SHARE_MAX_BODY_BYTES) {
    const error = new Error("Report payload is too large to publish.");
    error.name = "ReportSharePayloadTooLarge";
    error.code = "report_data_payload_too_large";
    throw error;
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutHandle = controller
    ? setTimeout(() => {
      controller.abort();
    }, REPORT_SHARE_TIMEOUT_MS)
    : 0;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=UTF-8",
      },
      body: payloadText,
      signal: controller?.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.url) {
      const error = new Error(payload?.error?.message || "Failed to publish report");
      error.code = getResponseErrorCode(payload, response);
      throw error;
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error("Publish report request timed out.");
      timeoutError.name = "ReportShareTimeout";
      timeoutError.code = "report_share_publish_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function shareReportUrl({ url, title, text }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return { operation: "share" };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { cancelled: true, operation: "share" };
      }
    }
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard is not available");
  }

  await navigator.clipboard.writeText(url);
  return { operation: "copy" };
}

function buildReportPublishEndpoint(origin, locale) {
  const url = new URL("/report-data", origin);
  url.searchParams.set("lang", locale);
  return url.href;
}

function getCurrentReportShareUrl(pageHref, pageSearch, locale) {
  const ref = new URLSearchParams(pageSearch || "").get("r") || "";
  if (!REPORT_REF_PATTERN.test(ref)) {
    return "";
  }

  const url = new URL("/", pageHref);
  url.searchParams.set("r", ref);
  url.searchParams.set("lang", locale);
  return url.href;
}

function stripReportPublishJson(key, value) {
  return key === "ruleDetail" ? null : value;
}

function getResponseErrorCode(payload, response) {
  if (typeof payload?.error?.code === "string" && payload.error.code) {
    return payload.error.code;
  }
  if (!response) {
    return "network_error";
  }
  return `http_${response.status}`;
}
