import "../mcp-guide.css";
import { escapeHtml } from "./html.js";

const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';

function codeBlock(id, label, value, t) {
  return `<div class="mcp-guide-code">
    <div class="mcp-guide-code__bar"><span>${escapeHtml(label)}</span><button type="button" data-mcp-copy="${id}">${copyIcon}<span>${escapeHtml(t("mcpGuideCopy"))}</span></button></div>
    <pre class="app-data-text" id="${id}">${escapeHtml(value)}</pre>
  </div>`;
}

/** @param {HTMLDialogElement} dialog */
export function openMcpGuide(dialog, t) {
  if (dialog.open) return;
  const url = new URL("/mcp", window.location.origin).href;
  dialog.innerHTML = `
    <header class="mcp-guide-header">
      <div class="mcp-guide-mark" aria-hidden="true"><svg viewBox="0 0 180 180"><use href="#mcp-logo"></use></svg></div>
      <div><h2 id="mcp-guide-title">${escapeHtml(t("mcpGuideTitle"))}</h2><p>${escapeHtml(t("mcpGuideSubtitle"))}</p></div>
      <form method="dialog"><button class="mcp-guide-close" autofocus aria-label="${escapeHtml(t("lcappsClose"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></form>
    </header>
    <div class="mcp-guide-tabs" role="tablist" aria-label="${escapeHtml(t("mcpGuideTitle"))}">
      <button id="mcp-tab-remote" type="button" role="tab" aria-selected="true" aria-controls="mcp-panel-remote" data-mcp-mode="remote">${escapeHtml(t("mcpGuideRemote"))}</button>
      <button id="mcp-tab-local" type="button" role="tab" aria-selected="false" aria-controls="mcp-panel-local" tabindex="-1" data-mcp-mode="local">${escapeHtml(t("mcpGuideLocal"))}</button>
      <button id="mcp-tab-prompt" type="button" role="tab" aria-selected="false" aria-controls="mcp-panel-prompt" tabindex="-1" data-mcp-mode="prompt">${escapeHtml(t("mcpGuidePrompt"))}</button>
    </div>
    <div class="mcp-guide-body">
      <section id="mcp-panel-remote" role="tabpanel" aria-labelledby="mcp-tab-remote">
        <p class="mcp-guide-intro">${escapeHtml(t("mcpGuideRemoteHelp"))}</p>
        ${codeBlock("mcp-guide-url", "Streamable HTTP", url, t)}
        <p class="mcp-guide-step">${escapeHtml(t("mcpGuideCodex"))}</p>
        ${codeBlock("mcp-guide-remote-config", "~/.codex/config.toml", `[mcp_servers.apk_remote]\nurl = ${JSON.stringify(url)}`, t)}
        <p class="mcp-guide-hint">${escapeHtml(t("mcpGuideRemoteTry"))}</p>
      </section>
      <section id="mcp-panel-local" role="tabpanel" aria-labelledby="mcp-tab-local" hidden>
        <p class="mcp-guide-intro">${escapeHtml(t("mcpGuideLocalHelp"))}</p>
        ${codeBlock("mcp-guide-install", t("mcpGuideTerminal"), "npm install\nnpm run generated:generate", t)}
        <p class="mcp-guide-step">${escapeHtml(t("mcpGuideLocalConfig"))}</p>
        ${codeBlock("mcp-guide-local-config", "~/.codex/config.toml", '[mcp_servers.apk_local]\ncommand = "node"\nargs = ["/absolute/path/to/tgbot/packages/apk-mcp/src/server.mjs"]', t)}
        <p class="mcp-guide-hint">${escapeHtml(t("mcpGuideLocalTry"))}</p>
      </section>
      <section id="mcp-panel-prompt" role="tabpanel" aria-labelledby="mcp-tab-prompt" hidden>
        <p class="mcp-guide-intro">${escapeHtml(t("mcpGuidePromptHelp"))}</p>
        ${codeBlock("mcp-guide-prompt", t("mcpGuidePrompt"), t("mcpGuidePromptText", { url, docs: "https://github.com/LibChecker/tgbot#mcp-clients" }), t)}
        <p class="mcp-guide-hint">${escapeHtml(t("mcpGuidePromptHint"))}</p>
      </section>
      <p class="mcp-guide-feedback" role="status" aria-live="polite"></p>
    </div>
    <footer class="mcp-guide-footer"><span>${escapeHtml(t("mcpGuideFooter"))}</span><a href="https://github.com/LibChecker/tgbot#mcp-clients" target="_blank" rel="noreferrer">${escapeHtml(t("mcpGuideDocs"))}<span aria-hidden="true"> ↗</span></a></footer>
  `;
  dialog.onclick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest("[data-mcp-mode]");
    if (tab) selectMode(dialog, tab.getAttribute("data-mcp-mode"));
    const copy = target?.closest("[data-mcp-copy]");
    if (!copy) return;
    const status = dialog.querySelector('[role="status"]');
    status.textContent = "";
    try {
      await navigator.clipboard.writeText(dialog.querySelector(`#${copy.getAttribute("data-mcp-copy")}`).textContent);
      status.textContent = t("mcpGuideCopied");
    } catch {
      status.textContent = t("mcpGuideCopyFailed");
    }
  };
  dialog.onkeydown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.matches('[role="tab"]') && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const modes = ["remote", "local", "prompt"];
      const current = modes.indexOf(target.getAttribute("data-mcp-mode"));
      const index = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
      const mode = modes[index];
      selectMode(dialog, mode);
      /** @type {HTMLElement} */ (dialog.querySelector(`#mcp-tab-${mode}`)).focus();
    }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button, a[href]")].filter((node) => !node.closest("[hidden]") && node.getAttribute("tabindex") !== "-1");
    const first = /** @type {HTMLElement} */ (controls[0]);
    const last = /** @type {HTMLElement} */ (controls[controls.length - 1]);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.showModal();
}

function selectMode(dialog, mode) {
  for (const tab of dialog.querySelectorAll("[data-mcp-mode]")) {
    const selected = tab.dataset.mcpMode === mode;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    dialog.querySelector(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
  }
  dialog.querySelector('[role="status"]').textContent = "";
}
