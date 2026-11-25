// Letters translations into the page image itself, for downloading a
// translated chapter as CBZ or PDF. Same rules as the on-screen overlay
// (overlay.js): cover the bubble, fit whole words, widen captions too narrow
// to read.

const FONT_FAMILY = '"MangitLensLetter", "Comic Neue", "Comic Sans MS", system-ui, sans-serif';
const MIN_READABLE = 0.011; // of page height
const MAX_FONT = 0.026;

export async function letterPage(blob, bubbles, type = "image/jpeg") {
  await document.fonts.load(`700 20px ${FONT_FAMILY}`).catch(() => {});
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const W = bmp.width;
  const H = bmp.height;

  for (const b of bubbles) {
    if (!b.translation) continue;
    let x = b.box.x * W;
    let y = b.box.y * H;
    let w = b.box.w * W;
    let h = b.box.h * H;
    const oval = b.shape !== "rect";

    let fit = fitLines(ctx, b.translation, innerWidth(w, oval), innerHeight(h, oval), H);
    if (fit.size < MIN_READABLE * H) {
      if (b.box.w < 0.2) {
        const grown = Math.min(w * 2.2, 0.2 * W);
        x = Math.max(0, Math.min(W - grown, x - (grown - w) / 2));
        w = grown;
      }
      if (b.box.h < 0.06) {
        const grown = Math.min(h * 1.8, 0.06 * H);
        y = Math.max(0, Math.min(H - grown, y - (grown - h) / 2));
        h = grown;
      }
      fit = fitLines(ctx, b.translation, innerWidth(w, oval), innerHeight(h, oval), H);
    }

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    // The box sits 10% inside the detected bubble; the white oval reaches
    // back out near the outline so no stray marks of the original remain.
    if (oval) ctx.ellipse(x + w / 2, y + h / 2, (w / 2) * 1.12, (h / 2) * 1.12, 0, 0, Math.PI * 2);
    else ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.04);
    ctx.fill();

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fit.size}px ${FONT_FAMILY}`;
    const lineH = fit.size * 1.12;
    const top = y + h / 2 - ((fit.lines.length - 1) * lineH) / 2;
    fit.lines.forEach((line, i) => ctx.fillText(line, x + w / 2, top + i * lineH));
  }
  return canvas.convertToBlob({ type, quality: 0.92 });
}

// The largest text inside an ellipse is about 70% of its box; captions use
// nearly all of theirs.
const innerWidth = (w, oval) => w * (oval ? 0.72 : 0.92);
const innerHeight = (h, oval) => h * (oval ? 0.72 : 0.9);

function fitLines(ctx, text, maxW, maxH, pageH) {
  const words = text.split(/\s+/).filter(Boolean);
  let lo = 6;
  let hi = Math.max(lo, Math.min(MAX_FONT * pageH, maxH));
  let best = { size: lo, lines: wrap(ctx, words, maxW, lo) };
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    ctx.font = `700 ${mid}px ${FONT_FAMILY}`;
    const lines = wrap(ctx, words, maxW, mid);
    const fits = lines && lines.length * mid * 1.12 <= maxH;
    if (fits) {
      lo = mid;
      best = { size: mid, lines };
    } else hi = mid;
  }
  ctx.font = `700 ${best.size}px ${FONT_FAMILY}`;
  best.lines ??= wrap(ctx, words, Infinity, best.size);
  return best;
}

// Greedy wrap at spaces. null when a single word is wider than the line.
function wrap(ctx, words, maxW) {
  const lines = [];
  let line = "";
  for (const word of words) {
    if (ctx.measureText(word).width > maxW) return null;
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxW) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function exportCbz(pages, baseName) {
  const { zipSync } = await import("fflate");
  const files = {};
  const pad = String(pages.length).length;
  for (const [i, blob] of pages.entries()) {
    files[`${String(i + 1).padStart(pad, "0")}.jpg`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(files)], { type: "application/vnd.comicbook+zip" });
}

export async function exportPdf(pages) {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const blob of pages) {
    const img = await doc.embedJpg(await blob.arrayBuffer());
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}

export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
