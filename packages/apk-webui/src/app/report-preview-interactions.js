import { clamp } from "./math.js";

const tapPopupMedia = window.matchMedia("(hover: none), (pointer: coarse)");
const supportsPointerEvents = typeof window.PointerEvent === "function";
const CONTRIBUTOR_GITHUB_ALIASES = new Map([
  ["absinthe", "zhaobozhen"],
]);

let runtime = null;
let state = null;
let t = () => "";
let ensureRulePreviewMaterial = () => {};
let updateLiquidGlassFilterForPreview = () => {};
let setLiquidGlassHighlightFromClientPoint = () => {};
let scheduleRulePreviewMaterialWarmup = () => {};

export function initReportPreviewInteractions(options) {
  runtime = options.runtime;
  state = options.state;
  t = options.t;
  ensureRulePreviewMaterial = options.ensureRulePreviewMaterial;
  updateLiquidGlassFilterForPreview = options.updateLiquidGlassFilterForPreview;
  setLiquidGlassHighlightFromClientPoint = options.setLiquidGlassHighlightFromClientPoint;
  scheduleRulePreviewMaterialWarmup = options.scheduleRulePreviewMaterialWarmup;

  initSdkIconPreview();
  initSdkRulePreview();
  initArchiveChartPreview();
  scheduleRulePreviewMaterialWarmup();
}
function addPreviewPointerListeners({ onPointerStart, onHover, onLeave, trackMove = false }) {
  if (supportsPointerEvents) {
    document.addEventListener("pointerdown", onPointerStart);
    document.addEventListener("pointerover", onHover);
    if (trackMove) {
      document.addEventListener("pointermove", onHover);
    }
    document.addEventListener("pointerout", onLeave);
    return;
  }

  document.addEventListener("mousedown", onPointerStart);
  document.addEventListener("mouseover", onHover);
  if (trackMove) {
    document.addEventListener("mousemove", onHover);
  }
  document.addEventListener("mouseout", onLeave);
}

function initSdkIconPreview() {
  let preview = null;
  let activeIcon = null;
  let activePinned = false;
  let lastPointerType = "";

  const ensurePreview = () => {
    ensureRulePreviewMaterial();

    if (preview) {
      return preview;
    }

    preview = document.createElement("div");
    preview.className = "sdk-icon-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;
    document.body.append(preview);
    return preview;
  };

  const getPreviewGraphic = (icon) => {
    const graphic = icon.querySelector(".sdk-icon__image, .sdk-icon__svg");
    if (!graphic) {
      return null;
    }

    const clone = graphic.cloneNode(true);
    if (clone instanceof HTMLImageElement) {
      clone.alt = "";
    }
    return clone;
  };

  const positionPreview = (icon) => {
    const popup = ensurePreview();
    const iconRect = icon.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const popupWidth = popupRect.width || 96;
    const popupHeight = popupRect.height || 96;

    let left = iconRect.left + iconRect.width / 2 - popupWidth / 2;
    left = clamp(left, margin, window.innerWidth - popupWidth - margin);

    let top = iconRect.top - popupHeight - gap;
    if (top < margin) {
      top = iconRect.bottom + gap;
    }
    top = clamp(top, margin, window.innerHeight - popupHeight - margin);

    popup.style.setProperty("--preview-x", `${left}px`);
    popup.style.setProperty("--preview-y", `${top}px`);
    setLiquidGlassHighlightFromClientPoint(popup, iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
  };

  const hidePreview = ({ immediate = false } = {}) => {
    if (!preview) {
      return;
    }

    preview.classList.remove("is-visible", "is-mono", "is-pinned");
    activeIcon = null;
    activePinned = false;
    if (immediate) {
      preview.hidden = true;
      return;
    }

    window.setTimeout(() => {
      if (!activeIcon && preview) {
        preview.hidden = true;
      }
    }, 120);
  };

  const showPreview = (icon, options = {}) => {
    const pinned = Boolean(options.pinned);
    if (activeIcon === icon) {
      activePinned = activePinned || pinned;
      ensurePreview().classList.toggle("is-pinned", activePinned);
      positionPreview(icon);
      updateLiquidGlassFilterForPreview(ensurePreview());
      return;
    }

    const graphic = getPreviewGraphic(icon);
    if (!graphic) {
      hidePreview();
      return;
    }

    const popup = ensurePreview();
    popup.hidden = false;
    popup.classList.remove("is-visible", "is-mono");
    popup.classList.toggle("is-mono", icon.classList.contains("sdk-icon--mono"));
    popup.classList.toggle("is-pinned", pinned);
    popup.replaceChildren(graphic);
    activeIcon = icon;
    activePinned = pinned;
    positionPreview(icon);
    updateLiquidGlassFilterForPreview(popup);
    window.requestAnimationFrame(() => {
      if (activeIcon === icon) {
        popup.classList.add("is-visible");
      }
    });
  };

  const handleHoverEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const icon = event.target.closest?.(".sdk-icon");
    if (!icon) {
      if (activeIcon) {
        hidePreview();
      }
      return;
    }

    if (icon === activeIcon) {
      return;
    }

    showPreview(icon);
  };

  const handleLeaveEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const icon = event.target.closest?.(".sdk-icon");
    if (!icon || icon !== activeIcon) {
      return;
    }

    if (event.relatedTarget && icon.contains(event.relatedTarget)) {
      return;
    }

    hidePreview();
  };

  addPreviewPointerListeners({
    onPointerStart(event) {
      lastPointerType = event.pointerType || "";
    },
    onHover: handleHoverEvent,
    onLeave: handleLeaveEvent,
  });
  document.addEventListener("click", (event) => {
    const icon = event.target.closest?.(".sdk-icon");
    if (icon) {
      showPreview(icon, { pinned: true });
      return;
    }

    if (activePinned && !event.target.closest?.(".sdk-icon-preview")) {
      hidePreview();
    }
  });

  window.addEventListener("scroll", () => hidePreview({ immediate: true }), true);

  window.addEventListener("resize", hidePreview);
}

function initSdkRulePreview() {
  let preview = null;
  let activeLabel = null;
  let activePinned = false;
  let hideTimer = null;
  let lastPointerType = "";

  const ensurePreview = () => {
    ensureRulePreviewMaterial();

    if (preview) {
      return preview;
    }

    preview = document.createElement("div");
    preview.className = "sdk-rule-preview";
    preview.setAttribute("role", "tooltip");
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;
    preview.addEventListener("pointerenter", () => {
      cancelScheduledHide();
    });
    preview.addEventListener("mouseenter", () => {
      cancelScheduledHide();
    });
    preview.addEventListener("pointerleave", () => {
      scheduleHidePreview();
    });
    preview.addEventListener("mouseleave", () => {
      scheduleHidePreview();
    });
    preview.addEventListener("pointermove", updateLiquidGlassHighlightFromEvent);
    preview.addEventListener("mousemove", updateLiquidGlassHighlightFromEvent);
    preview.addEventListener("focusin", () => {
      cancelScheduledHide();
    });
    preview.addEventListener("focusout", (event) => {
      if (!event.relatedTarget || !preview.contains(event.relatedTarget)) {
        scheduleHidePreview();
      }
    });
    document.body.append(preview);
    return preview;
  };

  const positionPreview = (label) => {
    const popup = ensurePreview();
    const labelRect = label.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const popupWidth = popupRect.width || 360;
    const popupHeight = popupRect.height || 180;

    let left = labelRect.left + labelRect.width / 2 - popupWidth / 2;
    const maxLeft = window.innerWidth - popupWidth - margin;
    left = maxLeft < margin ? margin : clamp(left, margin, maxLeft);

    let top = labelRect.bottom + gap;
    if (top + popupHeight > window.innerHeight - margin) {
      top = labelRect.top - popupHeight - gap;
    }
    const maxTop = window.innerHeight - popupHeight - margin;
    top = maxTop < margin ? margin : clamp(top, margin, maxTop);

    popup.style.setProperty("--rule-preview-x", `${left}px`);
    popup.style.setProperty("--rule-preview-y", `${top}px`);
    setLiquidGlassHighlightFromClientPoint(popup, labelRect.left + labelRect.width / 2, labelRect.top + labelRect.height / 2);
  };

  const updateLiquidGlassHighlightFromEvent = (event) => {
    if (!preview || preview.hidden) {
      return;
    }

    setLiquidGlassHighlightFromClientPoint(preview, event.clientX, event.clientY);
  };

  const hidePreview = ({ immediate = false } = {}) => {
    if (!preview) {
      return;
    }

    cancelScheduledHide();
    preview.classList.remove("is-visible", "is-pinned");
    preview.setAttribute("aria-hidden", "true");
    activeLabel = null;
    activePinned = false;
    if (immediate) {
      preview.hidden = true;
      return;
    }

    window.setTimeout(() => {
      if (!activeLabel && preview) {
        preview.hidden = true;
      }
    }, 140);
  };

  const scheduleHidePreview = () => {
    if (activePinned) {
      return;
    }

    cancelScheduledHide();
    hideTimer = window.setTimeout(() => {
      const popup = ensurePreview();
      const activeElement = document.activeElement;
      if (
        activeLabel?.matches(":hover") ||
        popup.matches(":hover") ||
        activeElement?.closest?.(".sdk-rule-label.has-rule-detail") ||
        popup.contains(activeElement)
      ) {
        return;
      }

      hidePreview();
    }, 90);
  };

  const cancelScheduledHide = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const showPreview = (label, options = {}) => {
    cancelScheduledHide();
    const pinned = Boolean(options.pinned);
    if (activeLabel === label) {
      const popup = ensurePreview();
      activePinned = activePinned || pinned;
      popup.classList.toggle("is-pinned", activePinned);
      positionPreview(label);
      return;
    }

    const detail = runtime.sdkIconRendererModule?.getRegisteredSdkRuleDetail(label.dataset.ruleDetailId) || null;
    const content = buildRulePreviewContent(label, detail);
    if (!content) {
      hidePreview();
      return;
    }

    const popup = ensurePreview();
    popup.hidden = false;
    popup.classList.remove("is-visible", "is-pinned");
    popup.classList.toggle("is-pinned", pinned);
    popup.setAttribute("aria-hidden", "false");
    popup.replaceChildren(content);
    activeLabel = label;
    activePinned = pinned;
    positionPreview(label);
    updateLiquidGlassFilterForPreview(popup);
    window.requestAnimationFrame(() => {
      if (activeLabel === label) {
        popup.classList.add("is-visible");
      }
    });
  };

  const handleHoverEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    if (event.target.closest?.(".sdk-rule-preview")) {
      cancelScheduledHide();
      updateLiquidGlassHighlightFromEvent(event);
      return;
    }

    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (!label) {
      if (activeLabel && !document.activeElement?.closest?.(".sdk-rule-label.has-rule-detail")) {
        scheduleHidePreview();
      }
      return;
    }

    if (label === activeLabel) {
      updateLiquidGlassHighlightFromEvent(event);
      return;
    }

    showPreview(label);
    updateLiquidGlassHighlightFromEvent(event);
  };

  const handleLeaveEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (!label || label !== activeLabel) {
      return;
    }

    if (event.relatedTarget && label.contains(event.relatedTarget)) {
      return;
    }

    if (event.relatedTarget && ensurePreview().contains(event.relatedTarget)) {
      cancelScheduledHide();
      return;
    }

    scheduleHidePreview();
  };

  addPreviewPointerListeners({
    onPointerStart(event) {
      lastPointerType = event.pointerType || "";
    },
    onHover: handleHoverEvent,
    onLeave: handleLeaveEvent,
    trackMove: true,
  });
  document.addEventListener("click", (event) => {
    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (label) {
      showPreview(label, { pinned: true });
      return;
    }

    if (activePinned && !event.target.closest?.(".sdk-rule-preview")) {
      hidePreview();
    }
  });
  document.addEventListener("focusin", (event) => {
    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (label) {
      showPreview(label);
    }
  });
  document.addEventListener("focusout", (event) => {
    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (label && label === activeLabel) {
      if (event.relatedTarget && ensurePreview().contains(event.relatedTarget)) {
        cancelScheduledHide();
        return;
      }
      scheduleHidePreview();
    }
  });

  window.addEventListener("scroll", () => hidePreview({ immediate: true }), true);

  window.addEventListener("resize", hidePreview);
}

function initArchiveChartPreview() {
  let preview = null;
  let activeSegment = null;
  let activePinned = false;
  let hideTimer = null;
  let lastPointerType = "";
  let lastPoint = null;

  const ensurePreview = () => {
    ensureRulePreviewMaterial();

    if (preview) {
      return preview;
    }

    preview = document.createElement("div");
    preview.className = "sdk-rule-preview archive-chart-preview";
    preview.setAttribute("role", "tooltip");
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;
    document.body.append(preview);
    return preview;
  };

  const positionPreview = (segment, event = null) => {
    const popup = ensurePreview();
    const segmentRect = segment.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 14;
    const margin = 8;
    const popupWidth = popupRect.width || 300;
    const popupHeight = popupRect.height || 140;
    const x = Number.isFinite(event?.clientX)
      ? event.clientX
      : lastPoint?.x ?? segmentRect.left + segmentRect.width / 2;
    const y = Number.isFinite(event?.clientY)
      ? event.clientY
      : lastPoint?.y ?? segmentRect.top + segmentRect.height / 2;

    let left = x + gap;
    if (left + popupWidth > window.innerWidth - margin) {
      left = x - popupWidth - gap;
    }
    left = clamp(left, margin, window.innerWidth - popupWidth - margin);

    let top = y + gap;
    if (top + popupHeight > window.innerHeight - margin) {
      top = y - popupHeight - gap;
    }
    top = clamp(top, margin, window.innerHeight - popupHeight - margin);

    popup.style.setProperty("--rule-preview-x", `${left}px`);
    popup.style.setProperty("--rule-preview-y", `${top}px`);
    setLiquidGlassHighlightFromClientPoint(popup, x, y);
  };

  const hidePreview = () => {
    if (!preview) {
      return;
    }

    cancelScheduledHide();
    preview.classList.remove("is-visible", "is-pinned");
    preview.setAttribute("aria-hidden", "true");
    activeSegment?.classList.remove("is-active");
    activeSegment = null;
    activePinned = false;
    lastPoint = null;
    window.setTimeout(() => {
      if (!activeSegment && preview) {
        preview.hidden = true;
      }
    }, 140);
  };

  const scheduleHidePreview = () => {
    if (activePinned) {
      return;
    }

    cancelScheduledHide();
    hideTimer = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        activeSegment?.matches(":hover") ||
        activeElement?.closest?.(".archive-chart-segment")
      ) {
        return;
      }

      hidePreview();
    }, 80);
  };

  const cancelScheduledHide = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const showPreview = (segment, event = null, options = {}) => {
    cancelScheduledHide();
    if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
      lastPoint = { x: event.clientX, y: event.clientY };
    }

    const popup = ensurePreview();
    const pinned = Boolean(options.pinned);
    if (activeSegment === segment) {
      activePinned = activePinned || pinned;
      popup.classList.toggle("is-pinned", activePinned);
      segment.classList.add("is-active");
      positionPreview(segment, event);
      updateLiquidGlassFilterForPreview(popup);
      return;
    }

    const content = buildArchiveChartPreviewContent(segment);
    if (!content) {
      hidePreview();
      return;
    }

    popup.style.setProperty("--archive-segment-color", segment.dataset.archiveColor || "var(--accent)");
    activeSegment?.classList.remove("is-active");
    popup.hidden = false;
    popup.classList.remove("is-visible", "is-pinned");
    popup.classList.toggle("is-pinned", pinned);
    popup.setAttribute("aria-hidden", "false");
    popup.replaceChildren(content);
    activeSegment = segment;
    activeSegment.classList.add("is-active");
    activePinned = pinned;
    positionPreview(segment, event);
    updateLiquidGlassFilterForPreview(popup);
    window.requestAnimationFrame(() => {
      if (activeSegment === segment) {
        popup.classList.add("is-visible");
      }
    });
  };

  const handleHoverEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const segment = event.target.closest?.(".archive-chart-segment");
    if (!segment) {
      if (activeSegment && !document.activeElement?.closest?.(".archive-chart-segment")) {
        scheduleHidePreview();
      }
      return;
    }

    showPreview(segment, event);
  };

  const handleLeaveEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const segment = event.target.closest?.(".archive-chart-segment");
    if (!segment || segment !== activeSegment) {
      return;
    }

    if (event.relatedTarget && segment.contains(event.relatedTarget)) {
      return;
    }

    scheduleHidePreview();
  };

  addPreviewPointerListeners({
    onPointerStart(event) {
      lastPointerType = event.pointerType || "";
    },
    onHover: handleHoverEvent,
    onLeave: handleLeaveEvent,
    trackMove: true,
  });
  document.addEventListener("click", (event) => {
    const segment = event.target.closest?.(".archive-chart-segment");
    if (segment) {
      showPreview(segment, event, { pinned: true });
      return;
    }

    if (activePinned) {
      hidePreview();
    }
  });
  document.addEventListener("focusin", (event) => {
    const segment = event.target.closest?.(".archive-chart-segment");
    if (segment) {
      showPreview(segment);
    }
  });
  document.addEventListener("focusout", (event) => {
    const segment = event.target.closest?.(".archive-chart-segment");
    if (segment && segment === activeSegment) {
      scheduleHidePreview();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSegment) {
      hidePreview();
    }
  });

  window.addEventListener("scroll", () => {
    if (activeSegment) {
      positionPreview(activeSegment);
      updateLiquidGlassFilterForPreview(ensurePreview());
    }
  }, true);

  window.addEventListener("resize", hidePreview);
}

function shouldUseTapPopups(pointerType = "") {
  return (
    pointerType === "touch" ||
    pointerType === "pen" ||
    tapPopupMedia.matches
  );
}

function buildRulePreviewContent(label, detail) {
  const localized = selectRuleDetailLocale(detail);
  if (!localized) {
    return null;
  }

  const title = localized.label || label.textContent?.trim() || t("unknown");
  const root = document.createElement("div");
  root.className = "sdk-rule-preview-card";

  const titleNode = document.createElement("div");
  titleNode.className = "sdk-rule-preview-title";
  titleNode.textContent = title;
  root.append(titleNode);

  if (localized.description) {
    const descriptionNode = document.createElement("div");
    descriptionNode.className = "sdk-rule-preview-description";
    descriptionNode.textContent = localized.description;
    root.append(descriptionNode);
  }

  const metaRows = [];
  if (localized.team) {
    metaRows.push([t("ruleDevTeam"), createTextNode(localized.team)]);
  }
  if (localized.contributors?.length) {
    metaRows.push([t("ruleContributors"), createContributorLinks(localized.contributors)]);
  }
  if (localized.source) {
    metaRows.push([t("ruleSource"), createSourceLink(localized.source)]);
  }
  if (detail?.uuid) {
    metaRows.push([t("ruleUuid"), createTextNode(detail.uuid)]);
  }

  if (metaRows.length) {
    const metaNode = document.createElement("div");
    metaNode.className = "sdk-rule-preview-meta";
    for (const [name, value] of metaRows) {
      const row = document.createElement("div");
      row.className = "sdk-rule-preview-meta-row";

      const nameNode = document.createElement("span");
      nameNode.textContent = name;

      const valueNode = document.createElement("span");
      valueNode.append(value);

      row.append(nameNode, valueNode);
      metaNode.append(row);
    }
    root.append(metaNode);
  }

  return root;
}

function buildArchiveChartPreviewContent(segment) {
  const root = document.createElement("div");
  root.className = "sdk-rule-preview-card";

  const titleNode = document.createElement("div");
  titleNode.className = "sdk-rule-preview-title";
  titleNode.textContent = segment.dataset.archiveName || t("unknown");
  root.append(titleNode);

  const metaNode = document.createElement("div");
  metaNode.className = "sdk-rule-preview-meta";
  const metaRows = [
    [t("size"), segment.dataset.archiveSize || t("unknown")],
    [t("archiveDistributionPercent"), segment.dataset.archivePercent || t("unknown")],
  ];

  for (const [name, value] of metaRows) {
    const row = document.createElement("div");
    row.className = "sdk-rule-preview-meta-row";

    const nameNode = document.createElement("span");
    nameNode.textContent = name;

    const valueNode = document.createElement("span");
    valueNode.append(createTextNode(value));

    row.append(nameNode, valueNode);
    metaNode.append(row);
  }
  root.append(metaNode);

  return root;
}

function createTextNode(value) {
  return document.createTextNode(String(value || ""));
}

function createContributorLinks(contributors = []) {
  const fragment = document.createDocumentFragment();
  contributors.forEach((contributor, index) => {
    if (index > 0) {
      fragment.append(document.createTextNode(", "));
    }

    const link = createGithubProfileLink(contributor);
    fragment.append(link || document.createTextNode(String(contributor || "")));
  });
  return fragment;
}

function createGithubProfileLink(contributor) {
  const displayName = String(contributor || "").trim();
  const username = CONTRIBUTOR_GITHUB_ALIASES.get(displayName.toLowerCase()) || displayName;
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(username)) {
    return null;
  }

  return createExternalLink(`https://github.com/${username}`, displayName);
}

function createSourceLink(source) {
  const value = String(source || "").trim();
  const safeUrl = normalizeExternalUrl(value);
  return safeUrl ? createExternalLink(safeUrl, value) : createTextNode(value);
}

function createExternalLink(href, text) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = text;
  return link;
}

function normalizeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function selectRuleDetailLocale(detail) {
  const locales = detail?.locales;
  if (!locales || typeof locales !== "object") {
    return null;
  }

  return (
    locales[state.locale] ||
    locales["zh-Hans"] ||
    locales["zh-CN"] ||
    locales.en ||
    Object.values(locales).find((item) => item && typeof item === "object") ||
    null
  );
}
