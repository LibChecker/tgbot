export function renderBrandTitle(node, fallbackTitle) {
  if (!node) {
    return;
  }

  const title = node.dataset.dotTitle || fallbackTitle || "LibChecker WebUI";
  node.textContent = "";
  node.classList.remove("is-dot-rendered");
  node.classList.add("is-text-rendered");
  node.setAttribute("aria-label", title);

  node.append(
    buildBrandTitleTextLayer(title, "brand-title__layer brand-title__layer--base brand-title__text"),
    buildBrandTitleTextLayer(title, "brand-title__layer brand-title__layer--color brand-title__text"),
  );
}

function buildBrandTitleTextLayer(title, className) {
  const layerNode = document.createElement("span");
  layerNode.className = className;
  layerNode.setAttribute("aria-hidden", "true");
  layerNode.append(...buildBrandTitleTokenNodes(title));
  return layerNode;
}

function buildBrandTitleTokenNodes(title) {
  return title.split(/(\s+)/u).map((part) => {
    if (/^\s+$/u.test(part)) {
      return document.createTextNode(part);
    }

    const tokenNode = document.createElement("span");
    tokenNode.className = "brand-title__token";
    tokenNode.textContent = part;
    return tokenNode;
  });
}
