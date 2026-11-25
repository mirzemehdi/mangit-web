// Finds speech-bubble candidates in a manga page without any model.
//
// Classic manga bubbles are enclosed light regions with dark glyphs inside.
// We threshold the page, label connected light regions, and keep the ones whose
// size, shape and "ink inside" look like a bubble. Each result is a box in the
// coordinates of the ImageData that was passed in.
//
// This runs in a few milliseconds on a downscaled page and lets the on-device
// model work on small, single-bubble crops, which fit its token budget and give
// us exact positions for the overlay. Pages where this finds nothing (colour
// webtoons, borderless text) are sent to the cloud model, which returns its own
// boxes.

const DEFAULTS = {
  lightThreshold: 200, // luminance >= this is "paper"
  inkThreshold: 110, // luminance <= this is "ink"
  minAreaRatio: 0.0015, // of the page
  maxAreaRatio: 0.16,
  minFill: 0.38, // region area / bounding box area
  minInkRatio: 0.015, // ink pixels / bounding box area
  maxInkRatio: 0.45,
  maxAspect: 6,
};

export function detectBubbles(imageData, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { width: w, height: h, data } = imageData;
  const n = w * h;

  const lum = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    lum[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }

  // Ink prefix sums so we can count dark pixels in any box in O(1).
  const ink = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x] <= o.inkThreshold ? 1 : 0;
      ink[(y + 1) * (w + 1) + x + 1] = ink[y * (w + 1) + x + 1] + row;
    }
  }
  const inkIn = (x0, y0, x1, y1) =>
    ink[(y1 + 1) * (w + 1) + x1 + 1] -
    ink[y0 * (w + 1) + x1 + 1] -
    ink[(y1 + 1) * (w + 1) + x0] +
    ink[y0 * (w + 1) + x0];

  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const pageArea = n;
  const found = [];
  let next = 1;

  for (let start = 0; start < n; start++) {
    if (labels[start] || lum[start] < o.lightThreshold) continue;
    const label = next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let touchesEdge = false;

    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      // 4-connected neighbours
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }

    function push(j) {
      if (!labels[j] && lum[j] >= o.lightThreshold) {
        labels[j] = label;
        stack[sp++] = j;
      }
    }

    if (touchesEdge) continue; // page margins and gutters
    const ratio = area / pageArea;
    if (ratio < o.minAreaRatio || ratio > o.maxAreaRatio) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const boxArea = bw * bh;
    if (area / boxArea < o.minFill) continue;
    if (Math.max(bw / bh, bh / bw) > o.maxAspect) continue;
    const inkRatio = inkIn(minX, minY, maxX, maxY) / boxArea;
    if (inkRatio < o.minInkRatio || inkRatio > o.maxInkRatio) continue;

    const layout = textLayout(lum, w, minX, minY, bw, bh, o.inkThreshold);
    // Rectangular captions fill ~95% of their box, oval bubbles ~78%.
    // (Text inside the caption is ink, not paper, so count it as filled.)
    const shape = (area + inkRatio * boxArea) / boxArea > 0.9 ? "rect" : "oval";
    found.push({ x: minX, y: minY, w: bw, h: bh, area, inkRatio, shape, ...layout });
  }

  return dropNested(found);
}

// Reads the text layout from ink projections inside the bubble (border
// trimmed): vertical CJK text forms columns separated by gaps, horizontal text
// forms rows. Also estimates how much text there is, so a model's read that's
// far too short for the ink can be caught.
function textLayout(lum, w, x0, y0, bw, bh, inkThreshold) {
  const ix = Math.round(bw * 0.12);
  const iy = Math.round(bh * 0.12);
  const cols = new Uint16Array(bw);
  const rows = new Uint16Array(bh);
  let ink = 0;
  for (let y = iy; y < bh - iy; y++) {
    for (let x = ix; x < bw - ix; x++) {
      if (lum[(y0 + y) * w + x0 + x] <= inkThreshold) {
        cols[x]++;
        rows[y]++;
        ink++;
      }
    }
  }
  const colRuns = runs(cols, ix, bw - ix);
  const rowRuns = runs(rows, iy, bh - iy);
  return {
    // Bubble shape is the strongest cue: vertical CJK text sits in tall bubbles.
    vertical: bh / bw >= 1.2 || (bh / bw > 0.9 && colRuns.count > rowRuns.count),
    lines: Math.max(colRuns.count, rowRuns.count),
    colRuns: colRuns.count,
    rowRuns: rowRuns.count,
    ink,
  };
}

// Text lines in a projection: smooth it (so strokes inside one glyph merge),
// then count stretches above a share of the peak.
function runs(profile, from, to) {
  const n = to - from;
  if (n <= 0) return { count: 0 };
  const radius = Math.max(2, Math.round(n * 0.025));
  const smooth = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let k = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++, k++) {
      sum += profile[from + j];
    }
    smooth[i] = sum / k;
    if (smooth[i] > peak) peak = smooth[i];
  }
  const cut = peak * 0.22;
  let count = 0;
  let inRun = false;
  for (let i = 0; i < n; i++) {
    if (smooth[i] > cut) {
      if (!inRun) count++;
      inRun = true;
    } else inRun = false;
  }
  return { count };
}

// A bubble region can contain the hole of a letter like "O" that is itself
// light and enclosed. Keep the outer region only.
function dropNested(boxes) {
  boxes.sort((a, b) => b.area - a.area);
  const kept = [];
  for (const b of boxes) {
    const inside = kept.some(
      (k) => b.x >= k.x && b.y >= k.y && b.x + b.w <= k.x + k.w && b.y + b.h <= k.y + k.h,
    );
    if (!inside) kept.push(b);
  }
  // Reading order for manga: top to bottom, right to left within a row.
  kept.sort((a, b) => {
    const rowA = Math.round(a.y / 40);
    const rowB = Math.round(b.y / 40);
    return rowA === rowB ? b.x - a.x : rowA - rowB;
  });
  return kept;
}
