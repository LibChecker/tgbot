const [, , action = "info", ...restArgs] = process.argv;

const options = parseArgs(restArgs);
const workerUrl = normalizeBaseUrl(
  options["worker-url"] || process.env.WORKER_URL || process.env.PUBLIC_WEBHOOK_URL,
);
const adminToken = options["admin-token"] || process.env.ADMIN_TOKEN;

if (!workerUrl) {
  fail(
    "Missing Worker URL. Set WORKER_URL or pass --worker-url=https://your-worker.your-subdomain.workers.dev",
  );
}

if (!adminToken) {
  fail("Missing ADMIN_TOKEN. Set ADMIN_TOKEN or pass --admin-token=<token>.");
}

const actionHandlers = {
  async info() {
    return callAdminApi(workerUrl, adminToken, "/admin/webhook", {
      method: "GET",
    });
  },

  async set() {
    const webhookUrl = normalizeWebhookUrl(options["webhook-url"] || process.env.WEBHOOK_URL);
    const dropPendingUpdates = getBooleanFlag(
      options["drop-pending-updates"],
      process.env.DROP_PENDING_UPDATES,
    );

    return callAdminApi(workerUrl, adminToken, "/admin/webhook/set", {
      method: "POST",
      body: {
        url: webhookUrl || undefined,
        drop_pending_updates: dropPendingUpdates,
      },
    });
  },

  async delete() {
    const dropPendingUpdates = getBooleanFlag(
      options["drop-pending-updates"],
      process.env.DROP_PENDING_UPDATES,
    );

    return callAdminApi(workerUrl, adminToken, "/admin/webhook/delete", {
      method: "POST",
      body: {
        drop_pending_updates: dropPendingUpdates,
      },
    });
  },
};

const handler = actionHandlers[action];
if (!handler) {
  fail(
    `Unknown action "${action}". Use one of: ${Object.keys(actionHandlers)
      .map((name) => `"${name}"`)
      .join(", ")}.`,
  );
}

try {
  const response = await handler();
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  fail(message);
}

async function callAdminApi(baseUrl, adminTokenValue, path, request) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: request.method,
    headers: {
      authorization: `Bearer ${adminTokenValue}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: request.body ? JSON.stringify(pruneUndefined(request.body)) : undefined,
  });

  const responseText = await response.text();
  const data = tryParseJson(responseText);

  if (!response.ok) {
    const errorMessage =
      data?.error ||
      data?.description ||
      (responseText.trim() ? responseText.trim() : `Request failed with ${response.status}`);
    throw new Error(`${path} failed: ${errorMessage}`);
  }

  return data ?? { ok: true, raw: responseText };
}

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const normalized = token.slice(2);
    const equalIndex = normalized.indexOf("=");
    if (equalIndex >= 0) {
      result[normalized.slice(0, equalIndex)] = normalized.slice(equalIndex + 1);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      result[normalized] = "true";
      continue;
    }

    result[normalized] = next;
    index += 1;
  }

  return result;
}

function getBooleanFlag(value, fallback) {
  const raw = value ?? fallback;
  if (raw == null) {
    return false;
  }

  if (typeof raw === "boolean") {
    return raw;
  }

  const normalized = String(raw).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeBaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/u, "");
}

function normalizeWebhookUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/webhook") ? trimmed : `${trimmed.replace(/\/+$/u, "")}/webhook`;
}

function pruneUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
