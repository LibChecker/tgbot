const BRAND_TITLE_SWITCH_MS = 620;
const BRAND_TITLE_CHAR_STAGGER_MS = 16;
const BRAND_TITLE_MAX_STAGGER_MS = 220;
const BRAND_TITLE_WORD_STAGGER_MS = 46;
const BRAND_TITLE_MAX_WORD_STAGGER_MS = 180;
const brandTitleAnimationTimers = new WeakMap();
const titleSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function renderBrandTitle(node, fallbackTitle, options = {}) {
  if (!node) {
    return;
  }

  const title = fallbackTitle || "LibChecker WebUI";
  const shouldAnimate = Boolean(options.animate);
  const previousTitle = node.getAttribute("aria-label") || node.textContent || "";
  clearBrandTitleAnimationTimer(node);
  node.classList.remove("is-switching-title");
  node.classList.add("is-text-rendered");
  node.setAttribute("aria-label", title);
  node.title = title;

  if (shouldAnimate && previousTitle && previousTitle !== title) {
    renderBrandTitleSwitch(node, previousTitle, title);
    return;
  }

  renderBrandTitleStable(node, title);
}

function renderBrandTitleStable(node, title) {
  node.textContent = "";
  node.classList.remove("is-switching-title");
  node.append(buildBrandTitleTextLayer(title, "brand-title__layer brand-title__layer--base brand-title__text"));
}

function renderBrandTitleSwitch(node, previousTitle, title) {
  node.textContent = "";
  node.classList.add("is-switching-title");
  node.append(
    buildBrandTitleTextLayer(previousTitle, "brand-title__layer brand-title__layer--exit brand-title__text", {
      animate: true,
    }),
    buildBrandTitleTextLayer(title, "brand-title__layer brand-title__layer--enter brand-title__text", {
      animate: true,
    }),
  );

  const timer = window.setTimeout(() => {
    brandTitleAnimationTimers.delete(node);
    if (node.getAttribute("aria-label") === title) {
      node.querySelector(".brand-title__layer--exit")?.remove();
      node.classList.remove("is-switching-title");
    }
  }, BRAND_TITLE_SWITCH_MS);
  brandTitleAnimationTimers.set(node, timer);
}

function buildBrandTitleTextLayer(title, className, options = {}) {
  const layerNode = document.createElement("span");
  layerNode.className = className;
  layerNode.setAttribute("aria-hidden", "true");
  layerNode.append(...(options.animate ? buildBlurTitleWordNodes(title) : [document.createTextNode(title)]));
  return layerNode;
}

function buildBlurTitleWordNodes(title) {
  let wordIndex = 0;
  let characterIndex = 0;
  return getTextWords(title).map((part) => {
    if (/^\s+$/u.test(part)) {
      return document.createTextNode(part);
    }

    const wordNode = document.createElement("span");
    wordNode.className = "brand-title__blur-word";
    wordNode.style.setProperty(
      "--word-blur-delay",
      `${Math.min(wordIndex * BRAND_TITLE_WORD_STAGGER_MS, BRAND_TITLE_MAX_WORD_STAGGER_MS)}ms`,
    );
    wordIndex += 1;

    for (const character of getTextCharacters(part)) {
      const characterNode = document.createElement("span");
      characterNode.className = "brand-title__blur-char";
      characterNode.style.setProperty(
        "--char-rise-delay",
        `${Math.min(characterIndex * BRAND_TITLE_CHAR_STAGGER_MS, BRAND_TITLE_MAX_STAGGER_MS)}ms`,
      );
      characterNode.textContent = character;
      wordNode.append(characterNode);
      characterIndex += 1;
    }

    return wordNode;
  });
}

function getTextWords(title) {
  const parts = title.split(/(\s+)/u).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [title];
}

function getTextCharacters(title) {
  if (!titleSegmenter) {
    return [...title];
  }

  return [...titleSegmenter.segment(title)].map((item) => item.segment);
}

function clearBrandTitleAnimationTimer(node) {
  const timer = brandTitleAnimationTimers.get(node);
  if (timer) {
    window.clearTimeout(timer);
    brandTitleAnimationTimers.delete(node);
  }
}
