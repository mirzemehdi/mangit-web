// Lays out the raw captures from store-shots.mjs as Chrome Web Store images:
// three 1280x800 screenshots, the 440x280 small tile and the 1400x560 marquee.
//   node scripts/store-compose.mjs
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const raw = (f) => `data:image/png;base64,${readFileSync(resolve("store/raw", f)).toString("base64")}`;
const font = (f) => `data:font/woff2;base64,${readFileSync(resolve("dist/fonts", f)).toString("base64")}`;
const icon = `data:image/png;base64,${readFileSync(resolve("dist/icons/icon128.png")).toString("base64")}`;
const root = join(homedir(), ".cache", "cft", "chrome");
const bin = join(root, readdirSync(root).sort().reverse()[0], "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");

const css = `
@font-face { font-family: Sora; src: url(${font("sora-latin-700-normal.woff2")}); font-weight: 700; }
* { box-sizing: border-box; margin: 0; }
body { background: #0b0c0f; color: #eef0f3; font: 500 20px/1.35 -apple-system, "SF Pro Text", system-ui, sans-serif; overflow: hidden; }
h1, .brand { font-family: Sora, sans-serif; font-weight: 700; letter-spacing: -0.02em; }
.accent { color: #3fe0ff; }
.cloud { color: #ffc15e; }
.shot { width: 1280px; height: 800px; display: grid; grid-template-columns: 1fr 420px; }
.shot .left { display: grid; grid-template-rows: auto 1fr; padding: 34px 28px 0 40px; gap: 22px; min-width: 0; }
.shot h1 { font-size: 34px; line-height: 1.15; }
.shot h1 small { display: block; font: 500 19px/1.4 -apple-system, system-ui, sans-serif; color: #a0a6b1; letter-spacing: 0; margin-top: 8px; }
.frame { border-radius: 14px 14px 0 0; overflow: hidden; border: 1px solid rgb(255 255 255 / .1); border-bottom: 0; background: #1b1b1f; }
.frame img { width: 100%; display: block; }
.panel { border-left: 1px solid rgb(255 255 255 / .09); overflow: hidden; }
.panel img { width: 420px; display: block; }
.full .frame { margin-top: 0; }
`;

const shot = (title, sub, page, panel, crop = "0 9% 0 9%") => `
<div class="shot">
  <div class="left">
    <h1>${title}<small>${sub}</small></h1>
    <div class="frame"><img src="${raw(page)}" style="clip-path: inset(${crop}); margin: 0 -11.5%; width: 123%;"></div>
  </div>
  <div class="panel"><img src="${raw(panel)}"></div>
</div>`;

const pages = {
  "1-translate-japanese.png": [1280, 800, shot(
    `Translate manga <span class="accent">right on the page</span>`,
    "Open the side panel, press Translate. English lettering appears in the bubbles in about two seconds.",
    "1-ja-page.png", "1-ja-panel.png")],
  "2-hover-original.png": [1280, 800, shot(
    `Hover any bubble to <span class="accent">see the original</span>`,
    "Learn as you read: original text, translation, and whether it ran on your computer or in the cloud.",
    "2-zh-hover-page.png", "2-zh-hover-panel.png")],
  "3-open-chapters.png": [1280, 800, `
<div class="shot" style="grid-template-columns: 1fr;">
  <div class="left" style="padding-right: 40px;">
    <h1>Open whole chapters: <span class="accent">PDF, CBZ, CBR, EPUB</span><small>Translate every page, then download as PNG, CBZ or PDF. Files never leave your browser.</small></h1>
    <div class="frame"><img src="${raw("3-chapter.png")}"></div>
  </div>
</div>`],
  "promo-small-440x280.png": [440, 280, `
<div style="width:440px;height:280px;padding:30px 30px;display:grid;align-content:center;gap:14px;background:radial-gradient(120% 90% at 100% 0%, #10343d 0%, #0b0c0f 60%);">
  <div style="display:flex;align-items:center;gap:12px"><img src="${icon}" width="52" height="52"><span class="brand" style="font-size:34px">Mangit</span></div>
  <div class="brand" style="font-size:25px;line-height:1.15">Free manga translator<br><span class="accent">in your browser</span></div>
  <div style="font-size:15px;color:#a0a6b1">Japanese · Korean · Chinese → English</div>
</div>`],
  "promo-marquee-1400x560.png": [1400, 560, `
<div style="width:1400px;height:560px;display:grid;grid-template-columns:600px 1fr;background:radial-gradient(90% 120% at 100% 0%, #10343d 0%, #0b0c0f 60%);">
  <div style="padding:0 0 0 72px;display:grid;align-content:center;gap:22px">
    <div style="display:flex;align-items:center;gap:16px"><img src="${icon}" width="72" height="72"><span class="brand" style="font-size:46px">Mangit</span></div>
    <div class="brand" style="font-size:44px;line-height:1.1">Translate manga<br><span class="accent">right on the page</span></div>
    <div style="font-size:21px;color:#a0a6b1;max-width:30em">Free. About 2 seconds a page. Runs on your computer with Gemini Nano, or in the cloud.</div>
  </div>
  <div style="position:relative;overflow:hidden">
    <div style="position:absolute;left:40px;top:44px;width:900px;height:600px;overflow:hidden;border-radius:14px;box-shadow:0 30px 80px rgb(0 0 0 / .6)"><img src="${raw("2-zh-hover-page.png")}" style="width:1100px;margin-left:-100px;margin-top:-16px"></div>
  </div>
</div>`],
};

const browser = await chromium.launch({ executablePath: bin, headless: true });
for (const [name, [w, h, body]] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>${css}</style>${body}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve("store", name), type: "png" });
  await page.close();
  console.log("store/" + name);
}
await browser.close();
