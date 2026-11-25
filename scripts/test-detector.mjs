// Bubble detector against the ground truth in bench/data: how many real
// bubbles it finds, how many regions aren't bubbles, and whether it gets each
// bubble's text direction and shape right. No model, no network.
import { PNG } from "pngjs";
import { readdirSync, readFileSync } from "node:fs";
import { detectBubbles } from "../src/lib/bubbles.js";

const root = new URL("../bench/data/", import.meta.url).pathname;

function downscale(png, maxSide) {
  const s = Math.min(1, maxSide / Math.max(png.width, png.height));
  const w = Math.round(png.width * s);
  const h = Math.round(png.height * s);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (Math.min(png.height - 1, Math.floor(y / s)) * png.width + Math.min(png.width - 1, Math.floor(x / s))) * 4;
      data.set(png.data.subarray(si, si + 4), (y * w + x) * 4);
    }
  return { width: w, height: h, data, s };
}
const iou = (a, b) => {
  const i = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
};

let gt = 0, hit = 0, det = 0, fp = 0, dirOk = 0, shapeOk = 0, matched = 0;
for (const ch of readdirSync(root).filter((d) => !d.startsWith("."))) {
  const truth = JSON.parse(readFileSync(`${root}${ch}/gt.json`));
  for (const p of truth.pages) {
    const img = downscale(PNG.sync.read(readFileSync(`${root}${ch}/${p.file}`)), 900);
    const found = detectBubbles(img).map((b) => ({ ...b, abs: [b.x / img.s, b.y / img.s, (b.x + b.w) / img.s, (b.y + b.h) / img.s] }));
    const bubbles = [...new Map(p.lines.filter((l) => l.bubble).map((l) => [l.gid, l])).values()];
    gt += bubbles.length;
    det += found.length;
    hit += bubbles.filter((l) => found.some((d) => iou(l.bubble, d.abs) > 0.4)).length;
    fp += found.filter((d) => !bubbles.some((l) => iou(l.bubble, d.abs) > 0.4)).length;
    for (const d of found) {
      const [x0, y0, x1, y1] = d.abs;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const l = bubbles.find((l) => cx >= l.bubble[0] && cx <= l.bubble[2] && cy >= l.bubble[1] && cy <= l.bubble[3]);
      if (!l) continue;
      matched++;
      if (!!l.vertical === d.vertical) dirOk++;
      if ((l.shape === "rect") === (d.shape === "rect")) shapeOk++;
    }
  }
}
const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`;
console.log(`bubbles found   ${pct(hit, gt)} (${hit}/${gt})`);
console.log(`not a bubble    ${pct(fp, det)} of detections (${fp}/${det})`);
console.log(`text direction  ${dirOk}/${matched}`);
console.log(`shape           ${shapeOk}/${matched}`);
if (hit / gt < 0.9) process.exit(1);
