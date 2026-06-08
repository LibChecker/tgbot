import { createI18n, normalizeLocale } from "./i18n.js";

export function renderUploadPage({
  locale = undefined,
  uploadUrl = "/upload",
  maxSizeText = "90 MB",
  error = "",
} = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const { t, languageTag } = createI18n(normalizedLocale);
  const escapedUploadUrl = escapeHtml(uploadUrl);
  const errorBlock = error
    ? `<div class="alert" role="alert">${escapeHtml(error)}</div>`
    : "";

  return `<!doctype html>
<html lang="${escapeHtml(languageTag)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(t("upload.page_title"))}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --text: #172033;
        --muted: #657084;
        --line: #dfe5ee;
        --accent: #0f766e;
        --accent-strong: #0b5f59;
        --danger-bg: #fff1f2;
        --danger-text: #9f1239;
        --shadow: 0 18px 44px rgba(23, 32, 51, 0.09);
        --corner-curve: squircle;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
        corner-shape: var(--corner-curve);
      }

      html,
      body {
        width: 100%;
        max-width: 100%;
        min-height: 100%;
        overflow-x: hidden;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 16px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(245, 247, 251, 0.9)),
          var(--bg);
        color: var(--text);
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }

      main {
        width: min(560px, 100%);
      }

      .panel {
        padding: 24px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: var(--shadow);
      }

      h1 {
        margin: 0;
        font-size: 1.65rem;
        line-height: 1.25;
        letter-spacing: 0;
      }

      p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.7;
        overflow-wrap: anywhere;
      }

      form {
        display: grid;
        gap: 16px;
        margin-top: 22px;
      }

      label {
        display: grid;
        gap: 8px;
        font-weight: 700;
      }

      input,
      select,
      button {
        width: 100%;
        min-width: 0;
        border-radius: 12px;
        font: inherit;
      }

      input,
      select {
        border: 1px solid var(--line);
        background: #fff;
        color: var(--text);
        padding: 11px 12px;
      }

      input[type="file"] {
        padding: 10px;
      }

      button {
        border: 0;
        padding: 12px 14px;
        background: var(--accent);
        color: #fff;
        font-weight: 800;
        cursor: pointer;
      }

      button:active {
        background: var(--accent-strong);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.76;
      }

      .progress {
        display: grid;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #f8fafc;
      }

      .progress[hidden] {
        display: none;
      }

      .progress__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-size: 0.92rem;
        font-weight: 700;
      }

      .progress__track {
        height: 10px;
        overflow: hidden;
        border-radius: 999px;
        background: #e6edf5;
      }

      .progress__bar {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #0f766e, #14b8a6);
        transition: width 160ms ease;
      }

      .progress.is-indeterminate .progress__bar {
        width: 38%;
        animation: progress-slide 1.1s ease-in-out infinite;
      }

      .progress__status {
        margin: 0;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.45;
      }

      .alert {
        margin-top: 18px;
        padding: 12px;
        border-radius: 12px;
        background: var(--danger-bg);
        color: var(--danger-text);
        line-height: 1.6;
        overflow-wrap: anywhere;
      }

      .hint {
        margin-top: 14px;
        font-size: 0.95rem;
      }

      @media (max-width: 520px) {
        body {
          place-items: start center;
          padding: 10px;
        }

        .panel {
          padding: 18px 14px;
        }
      }

      @keyframes progress-slide {
        0% {
          transform: translateX(-120%);
        }

        100% {
          transform: translateX(280%);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>${escapeHtml(t("upload.heading"))}</h1>
        <p>${escapeHtml(t("upload.intro"))}</p>
        ${errorBlock}
        <form method="post" action="${escapedUploadUrl}" enctype="multipart/form-data" data-busy="${escapeHtml(t("upload.busy"))}">
          <label>
            ${escapeHtml(t("upload.file_label"))}
            <input name="apk" type="file" accept=".apk,application/vnd.android.package-archive" required>
          </label>
          <label>
            ${escapeHtml(t("upload.language_label"))}
            <select name="lang">
              <option value="zh-CN"${normalizedLocale === "zh-CN" ? " selected" : ""}>中文</option>
              <option value="en"${normalizedLocale === "en" ? " selected" : ""}>English</option>
            </select>
          </label>
          <div class="progress" data-upload-progress hidden aria-live="polite">
            <div class="progress__header">
              <span>${escapeHtml(t("upload.progress_label"))}</span>
              <span data-progress-percent>0%</span>
            </div>
            <div class="progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="progress__bar" data-progress-bar></div>
            </div>
            <p class="progress__status" data-progress-status>${escapeHtml(t("upload.progress_preparing"))}</p>
          </div>
          <button type="submit">${escapeHtml(t("upload.submit"))}</button>
        </form>
        <p class="hint">${escapeHtml(t("upload.max_hint", { maxSize: maxSizeText }))}</p>
      </section>
    </main>
    <script>
      const form = document.querySelector("form");
      form?.addEventListener("submit", (event) => {
        if (!window.XMLHttpRequest || !window.FormData) {
          setBusyState(form);
          return;
        }

        event.preventDefault();
        submitWithProgress(form);
      });

      function submitWithProgress(form) {
        const button = form.querySelector("button");
        const progress = form.querySelector("[data-upload-progress]");
        const progressBar = form.querySelector("[data-progress-bar]");
        const progressTrack = form.querySelector("[role='progressbar']");
        const progressPercent = form.querySelector("[data-progress-percent]");
        const progressStatus = form.querySelector("[data-progress-status]");
        const busyText = form.dataset.busy || button?.textContent || "";

        setBusyState(form);
        setProgress(0);
        if (progress) {
          progress.hidden = false;
          progress.classList.add("is-indeterminate");
        }
        if (progressStatus) {
          progressStatus.textContent = ${JSON.stringify(t("upload.progress_preparing"))};
        }

        const request = new XMLHttpRequest();
        request.open("POST", form.action);
        request.responseType = "text";

        request.upload.addEventListener("progress", (uploadEvent) => {
          if (!uploadEvent.lengthComputable) {
            progress?.classList.add("is-indeterminate");
            return;
          }

          progress?.classList.remove("is-indeterminate");
          setProgress((uploadEvent.loaded / uploadEvent.total) * 100);
          if (progressStatus) {
            progressStatus.textContent = busyText;
          }
        });

        request.addEventListener("load", () => {
          progress?.classList.remove("is-indeterminate");
          setProgress(100);
          if (progressStatus) {
            progressStatus.textContent = ${JSON.stringify(t("upload.progress_complete"))};
          }

          if (request.responseURL && isReportUrl(request.responseURL)) {
            window.location.assign(request.responseURL);
            return;
          }

          if (request.responseText) {
            document.open();
            document.write(request.responseText);
            document.close();
            return;
          }

          restoreSubmitState();
        });

        request.addEventListener("error", () => {
          progress?.classList.remove("is-indeterminate");
          if (progressStatus) {
            progressStatus.textContent = ${JSON.stringify(t("upload.network_error"))};
          }
          restoreSubmitState();
        });

        request.send(new FormData(form));

        function setProgress(value) {
          const percent = Math.max(0, Math.min(100, Math.round(value)));
          if (progressBar) {
            progressBar.style.width = percent + "%";
          }
          if (progressPercent) {
            progressPercent.textContent = percent + "%";
          }
          if (progressTrack) {
            progressTrack.setAttribute("aria-valuenow", String(percent));
          }
        }

        function restoreSubmitState() {
          if (button) {
            button.disabled = false;
            button.textContent = ${JSON.stringify(t("upload.submit"))};
          }
        }
      }

      function setBusyState(form) {
        const button = form.querySelector("button");
        if (button) {
          button.disabled = true;
          button.textContent = form.dataset.busy || button.textContent;
        }
      }

      function isReportUrl(value) {
        try {
          return new URL(value, window.location.href).pathname === "/report";
        } catch {
          return false;
        }
      }
    </script>
  </body>
</html>`;
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
