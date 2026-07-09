const REPORT_REF_PATTERN = /^rp_[a-f0-9]{32}$/u;

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
  let url = cachedUrl || getCurrentReportShareUrl(pageHref, pageSearch, locale);
  if (!url) {
    url = (await publishReport({
      endpoint: buildReportPublishEndpoint(reportDataOrigin, locale),
      report,
      locale,
    })).url;
  }

  return {
    ...(await shareReportUrl({ url, title, text })),
    url,
  };
}

export async function publishReport({ endpoint, report, locale }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ report, locale }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) {
    throw new Error(payload?.error?.message || "Failed to publish report");
  }
  return payload;
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
