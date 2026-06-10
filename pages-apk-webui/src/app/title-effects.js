const DOT_TITLE_GLYPHS = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "?": ["11111", "00001", "00010", "00100", "00100", "00000", "00100"],
};

export function renderBrandTitle(node, fallbackTitle) {
  if (!node) {
    return;
  }

  const title = node.dataset.dotTitle || fallbackTitle || "LibChecker WebUI";
  node.textContent = "";
  node.classList.add("is-dot-rendered");
  node.setAttribute("aria-label", title);

  node.append(
    buildBrandTitleLayer(title, "brand-title__layer brand-title__layer--base"),
    buildBrandTitleCanvas(),
  );
}

function buildBrandTitleLayer(title, className) {
  const layerNode = document.createElement("span");
  layerNode.className = className;
  layerNode.setAttribute("aria-hidden", "true");

  title.split(" ").forEach((word) => {
    if (!word) {
      return;
    }

    const wordNode = document.createElement("span");
    wordNode.className = "brand-title__word";

    Array.from(word.toUpperCase()).forEach((character) => {
      const glyph = DOT_TITLE_GLYPHS[character] || DOT_TITLE_GLYPHS["?"];
      const letterNode = document.createElement("span");
      letterNode.className = "brand-title__letter";

      glyph.forEach((row) => {
        Array.from(row).forEach((dot) => {
          const dotNode = document.createElement("span");
          dotNode.className = dot === "1" ? "brand-title__dot is-on" : "brand-title__dot";
          letterNode.append(dotNode);
        });
      });

      wordNode.append(letterNode);
    });

    layerNode.append(wordNode);
  });

  return layerNode;
}

function buildBrandTitleCanvas() {
  const canvas = document.createElement("canvas");
  canvas.className = "brand-title__color-canvas";
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}
