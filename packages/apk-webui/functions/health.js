const HEALTH_BODY = JSON.stringify({
  status: "ok",
  service: "libchecker-webui",
});

export function onRequest(context) {
  if (!["GET", "HEAD"].includes(context.request.method)) {
    return new Response(null, {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(context.request.method === "HEAD" ? null : HEALTH_BODY, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=UTF-8",
    },
  });
}
