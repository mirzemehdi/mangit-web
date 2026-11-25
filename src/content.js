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
      const done = overlays.get(el.dataset.lensId);
      out.push({
        // Bubbles already translated on this image, so they aren't paid for twice.
        done: done ? { target: done.lang, boxes: [...(done.bubbles ?? []).map((b) => b.box), ...(done.checked ?? [])] } : null,
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

  const overlap = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
  };

  // Bubbles arrive with boxes as fractions (0..1) of the target element. New
  // bubbles are added to the ones already drawn on this image (scrolling down
  // a long strip), replacing any they overlap; a new language starts over.
  function render(id, bubbles, lang) {
    const entry = layerFor(id);
    if (!entry) return false;
    const kept = entry.lang === lang ? (entry.bubbles ?? []).filter((old) => !bubbles.some((b) => overlap(old.box, b.box) > 0.4)) : [];
    entry.bubbles = [...kept, ...bubbles];
    entry.lang = lang;
    renderBubbles(entry.layer, entry.bubbles);
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

  // Tell the side panel when scrolling stops; with auto-translate on, it
  // translates whatever new bubbles came into view.
  let scrollTimer = 0;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => chrome.runtime.sendMessage({ type: "lens/scrolled" }).catch(() => {}), 700);
    },
    { passive: true },
  );
  new ResizeObserver(() => requestAnimationFrame(refit)).observe(document.body);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "lens/scan":
        sendResponse(visibleImages());
        break;
      case "lens/render":
        sendResponse({ ok: render(msg.id, msg.bubbles, msg.lang) });
        break;
      case "lens/checked": {
        // Regions already looked at (with or without text), per language.
        const entry = overlays.get(msg.id) ?? (layerFor(msg.id) && overlays.get(msg.id));
        if (entry) {
          if (entry.checkedLang !== msg.lang) entry.checked = [];
          entry.checked = [...(entry.checked ?? []), ...msg.boxes].slice(-300);
          entry.checkedLang = msg.lang;
          if (!entry.lang) entry.lang = msg.lang;
        }
        sendResponse({ ok: Boolean(entry) });
        break;
      }
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
