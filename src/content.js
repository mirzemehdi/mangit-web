// Injected into the page on demand. Finds manga images in view and draws the
// translated bubbles over them. It never reads pixels itself; the side panel
// works from a screenshot of the tab, so cross-origin images are fine.

import { refitLayer, renderBubbles } from "./lib/overlay.js";

(() => {
  if (window.__mangitLens) return;
  window.__mangitLens = true;

  // Lettering font for translated bubbles, loaded from the extension.
  const letter = new FontFace(
    "MangitLensLetter",
    `url(${chrome.runtime.getURL("fonts/baloo-2-latin-700-normal.woff2")})`,
    { weight: "700" },
  );
  letter
    .load()
    .then((f) => {
      document.fonts.add(f);
      requestAnimationFrame(refit); // bubbles drawn before the font arrived
    })
    .catch(() => {});

  const MIN_SIDE = 160;
  const overlays = new Map(); // id -> { el, target, layer }
  let nextId = 1;
  let showOriginal = false;

  function visibleImages() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = [];
    for (const el of document.querySelectorAll("img, canvas, picture > img")) {
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
      const left = Math.max(0, r.left);
      const top = Math.max(0, r.top);
      const right = Math.min(vw, r.right);
      const bottom = Math.min(vh, r.bottom);
      const visW = right - left;
      const visH = bottom - top;
      if (visW < MIN_SIDE * 0.6 || visH < MIN_SIDE * 0.6) continue;
      if (!el.dataset.lensId) el.dataset.lensId = String(nextId++);
      out.push({
        id: el.dataset.lensId,
        // Element box and its visible part, in viewport CSS pixels.
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        visible: { x: left, y: top, w: visW, h: visH },
        visibleArea: visW * visH,
      });
    }
    out.sort((a, b) => b.visibleArea - a.visibleArea);
    return {
      images: out.slice(0, 6),
      viewport: { w: vw, h: vh, dpr: window.devicePixelRatio },
    };
  }

  function layerFor(id) {
    const target = document.querySelector(`[data-lens-id="${id}"]`);
    if (!target) return null;
    let entry = overlays.get(id);
    if (!entry) {
      const layer = document.createElement("div");
      layer.className = "mangit-lens-layer";
      document.body.appendChild(layer);
      entry = { target, layer };
      overlays.set(id, entry);
    }
    entry.layer.replaceChildren();
    position(entry);
    return entry;
  }

  function position({ target, layer }) {
    const r = target.getBoundingClientRect();
    layer.style.left = `${r.left + window.scrollX}px`;
    layer.style.top = `${r.top + window.scrollY}px`;
    layer.style.width = `${r.width}px`;
    layer.style.height = `${r.height}px`;
  }

  // Bubbles arrive with boxes as fractions (0..1) of the target element.
  function render(id, bubbles) {
    const entry = layerFor(id);
    if (!entry) return false;
    renderBubbles(entry.layer, bubbles);
    entry.layer.classList.toggle("mangit-lens-hidden", showOriginal);
    return true;
  }

  function refit() {
    for (const entry of overlays.values()) {
      if (!entry.target.isConnected) continue;
      position(entry);
      refitLayer(entry.layer);
    }
  }

  window.addEventListener("resize", () => requestAnimationFrame(refit));
  new ResizeObserver(() => requestAnimationFrame(refit)).observe(document.body);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "lens/scan":
        sendResponse(visibleImages());
        break;
      case "lens/render":
        sendResponse({ ok: render(msg.id, msg.bubbles) });
        break;
      case "lens/toggle":
        showOriginal = !showOriginal;
        for (const { layer } of overlays.values()) {
          layer.classList.toggle("mangit-lens-hidden", showOriginal);
        }
        sendResponse({ showOriginal });
        break;
      case "lens/clear":
        for (const { layer } of overlays.values()) layer.remove();
        overlays.clear();
        sendResponse({ ok: true });
        break;
      default:
        return false;
    }
    return false;
  });
})();
