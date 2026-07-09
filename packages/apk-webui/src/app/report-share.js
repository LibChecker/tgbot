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
