// Draws translated bubbles into a layer that sits exactly over a page image.
// Shared by the extension's content script and the web demo.
// Styles: src/overlay.css.

const MIN_READABLE = 11; // px

// Bubbles arrive with boxes as fractions (0..1) of the page element.
export function renderBubbles(layer, bubbles) {
  layer.replaceChildren();
  for (const b of bubbles) {
    if (!b.translation) continue;
    const el = document.createElement("div");
    el.className = `mangit-lens-bubble mangit-lens-${b.source}${b.shape === "rect" ? " mangit-lens-rect" : ""}`;
    el.style.left = `${b.box.x * 100}%`;
    el.style.top = `${b.box.y * 100}%`;
    el.style.width = `${b.box.w * 100}%`;
    el.style.height = `${b.box.h * 100}%`;
    el.dataset.original = b.original ?? "";
    el.dataset.translation = b.translation;
    el.dataset.path = pathLabel(b);
    const text = document.createElement("span");
    text.textContent = b.translation;
    const mark = document.createElement("i");
    mark.className = "mangit-lens-mark";
    mark.setAttribute("aria-hidden", "true");
    el.append(text, mark);
    el.addEventListener("mouseenter", () => showCard(el));
    el.addEventListener("mouseleave", hideCard);
    layer.appendChild(el);
    if (el.clientHeight > el.clientWidth * 1.6) el.classList.add("mangit-lens-narrow");
    fitText(el, text);
    // Too small to read: grow the box around its centre, like a letterer
    // would, instead of shrinking the text to nothing. Narrow boxes widen,
    // short boxes get taller.
    if (parseFloat(text.style.fontSize) < MIN_READABLE) {
      let { x, y, w, h } = b.box;
      if (w < 0.2) {
        const nw = Math.min(w * 2.2, 0.2);
        x = Math.max(0, Math.min(1 - nw, x - (nw - w) / 2));
        w = nw;
      }
      if (h < 0.06) {
        const nh = Math.min(h * 1.8, 0.06);
        y = Math.max(0, Math.min(1 - nh, y - (nh - h) / 2));
        h = nh;
      }
      if (w !== b.box.w || h !== b.box.h) {
        Object.assign(el.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
        el.classList.add("mangit-lens-grown");
        fitText(el, text);
      }
    }
  }
}

// The lettering font loads on first use; measure again once it has.
export function whenLetteringReady(callback) {
  document.fonts?.load('700 20px "MangitLensLetter"').then(callback, () => {});
}

export function refitLayer(layer) {
  for (const box of layer.children) fitText(box, box.querySelector("span"));
}

function pathLabel(b) {
  const ms = b.ms ? ` · ${b.ms < 1000 ? `${b.ms} ms` : `${(b.ms / 1000).toFixed(1)} s`}` : "";
  if (b.escalated) return `Cloud second opinion (Nano was unsure)${ms}`;
  if (b.hard) return `Cloud · vertical text, sent straight to Gemini${ms}`;
  return b.source === "device" ? `On your computer · Gemini Nano${ms}` : `Cloud · Gemini${ms}`;
}

// Learner card: the original next to the translation, and which model read it.
let card;
function showCard(el) {
  if (!el.dataset.original) return;
  if (!card) {
    card = document.createElement("div");
    card.className = "mangit-lens-card";
    card.setAttribute("role", "tooltip");
    card.innerHTML =
      '<p class="mangit-lens-original" lang="und"></p><p class="mangit-lens-translation"></p><p class="mangit-lens-path"></p>';
  }
  card.querySelector(".mangit-lens-original").textContent = el.dataset.original;
  card.querySelector(".mangit-lens-translation").textContent = el.dataset.translation;
  card.querySelector(".mangit-lens-path").textContent = el.dataset.path;
  card.dataset.source = el.classList.contains("mangit-lens-device") ? "device" : "cloud";
  if (!card.isConnected) document.body.appendChild(card);
  const r = el.getBoundingClientRect();
  const below = r.bottom + 8 + 140 < window.innerHeight;
  card.style.left = `${Math.max(8, Math.min(window.innerWidth - 328, r.left)) + window.scrollX}px`;
  card.style.top = `${(below ? r.bottom + 8 : Math.max(8, r.top - 8 - card.offsetHeight)) + window.scrollY}px`;
  card.classList.add("mangit-lens-card-on");
}

function hideCard() {
  card?.classList.remove("mangit-lens-card-on");
}

// Text area inside the bubble, from the bubble's own size: an ellipse leaves
// about 70% of its box for text; captions and narrow bubbles use more.
function setPadding(box) {
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const rect = box.classList.contains("mangit-lens-rect");
  const narrow = box.classList.contains("mangit-lens-narrow");
  const px = w * (rect ? 0.05 : narrow ? 0.04 : 0.13);
  const py = h * (rect ? 0.06 : narrow ? 0.05 : 0.14);
  box.style.padding = `${py}px ${px}px`;
}

// Largest font size that keeps the text inside its bubble. In rounded
// bubbles a narrower text column often fits bigger text (shorter lines clear
// the curved top and bottom), so a few column widths are tried and the one
// that allows the largest size wins.
function fitText(box, span) {
  setPadding(box);
  const widths = box.classList.contains("mangit-lens-rect") ? [100] : [100, 88, 76, 64];
  let best = { size: 0, width: 100 };
  for (const width of widths) {
    span.style.maxWidth = `${width}%`;
    const size = largestFit(box, span);
    if (size > best.size + 0.25) best = { size, width };
  }
  span.style.maxWidth = `${best.width}%`;
  span.style.fontSize = `${best.size}px`;
}

function largestFit(box, span) {
  let lo = 6;
  let hi = Math.max(lo, Math.min(28, box.clientHeight));
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    span.style.fontSize = `${mid}px`;
    // A word wider than the line overflows the span sideways; text taller
    // than the bubble's padded inside overflows downward; lines must also
    // clear the bubble's rounded corners.
    const fits =
      span.scrollWidth <= span.clientWidth + 0.5 && span.offsetHeight <= innerHeight(box) && fitsShape(box, span);
    if (fits) lo = mid;
    else hi = mid;
  }
  return lo;
}

function innerHeight(box) {
  const cs = getComputedStyle(box);
  return box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
}

// The white box is rounded (an oval, or a capsule for tall bubbles), so a line
// that fits the rectangle can still be cut off where the corners curve in.
// Check every line of text against the rounded shape at that line's height.
// Radii match overlay.css: 42% for ovals, 48% / 30% for narrow, ~0 for rect.
function fitsShape(box, span) {
  if (box.classList.contains("mangit-lens-rect")) return true;
  const narrow = box.classList.contains("mangit-lens-narrow");
  const r = box.getBoundingClientRect();
  if (!r.width || !r.height) return true;
  const a = r.width / 2;
  const b = r.height / 2;
  const cx = r.left + a;
  const cy = r.top + b;
  const rx = r.width * (narrow ? 0.48 : 0.42);
  const ry = r.height * (narrow ? 0.3 : 0.42);
  const margin = Math.max(2, r.width * 0.04);
  const range = document.createRange();
  range.selectNodeContents(span);
  for (const line of range.getClientRects()) {
    if (line.width < 1) continue;
    for (const y of [line.top, line.bottom]) {
      const half = halfWidthAt(Math.abs(y - cy), a, b, rx, ry);
      if (Math.max(cx - line.left, line.right - cx) > half - margin) return false;
    }
  }
  return true;
}

// Half the width of a rounded rectangle (corner radii rx, ry) at distance dy
// from its centre line.
function halfWidthAt(dy, a, b, rx, ry) {
  if (dy >= b) return 0;
  const straight = b - ry;
  if (dy <= straight) return a;
  const t = (dy - straight) / ry;
  return a - rx + rx * Math.sqrt(1 - t * t);
}

