// Before/after image for the Reddit launch post, from store/reddit/ captures.
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const c = process.argv[2] ?? "ko_office";
const img = (f) => `data:image/png;base64,${readFileSync(resolve("store/reddit", f)).toString("base64")}`;
const font = `data:font/woff2;base64,${readFileSync(resolve("dist/fonts/sora-latin-700-normal.woff2")).toString("base64")}`;
const icon = `data:image/png;base64,${readFileSync(resolve("dist/icons/icon128.png")).toString("base64")}`;
const root = join(homedir(), ".cache", "cft", "chrome");
const bin = join(root, readdirSync(root).sort().reverse()[0], "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");

const html = `<!doctype html><style>
@font-face { font-family: Sora; src: url(${font}); font-weight: 700; }
* { box-sizing: border-box; margin: 0; }
body { width: 1600px; height: 1300px; background: #0b0c0f; color: #eef0f3; font: 500 22px/1.4 -apple-system, system-ui, sans-serif; padding: 40px 56px; display: grid; grid-template-rows: auto 1fr auto; gap: 26px; }
h1 { font: 700 44px/1.1 Sora, sans-serif; letter-spacing: -0.02em; }
h1 span { color: #3fe0ff; }
.row { display: grid; grid-template-columns: 1fr 80px 1fr; align-items: center; min-height: 0; }
figure { display: grid; gap: 12px; justify-items: center; min-height: 0; }
figure img { height: 1000px; border-radius: 10px; box-shadow: 0 20px 60px rgb(0 0 0 / .5); }
figcaption { font: 700 20px Sora, sans-serif; color: #a0a6b1; letter-spacing: .04em; text-transform: uppercase; }
figcaption b { color: #3fe0ff; }
.arrow { font: 700 56px Sora, sans-serif; color: #3fe0ff; text-align: center; }
.foot { display: flex; align-items: center; gap: 14px; color: #a0a6b1; }
.foot img { width: 40px; height: 40px; }
.foot strong { color: #eef0f3; font: 700 24px Sora, sans-serif; }
</style>
<h1>Raw to English in <span>~2 seconds a page</span>. Free, in your browser.</h1>
<div class="row">
  <figure><img src="${img(`${c}-before.png`)}"><figcaption>Raw</figcaption></figure>
  <div class="arrow">→</div>
  <figure><img src="${img(`${c}-after.png`)}"><figcaption><b>Translated</b></figcaption></figure>
</div>
<div class="foot"><img src="${icon}"><strong>mangit.app/translate</strong><span>· no account · no API key · open source</span></div>`;

const browser = await chromium.launch({ executablePath: bin, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1300 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve("store/reddit", `reddit-before-after-${c}.png`) });
await browser.close();
console.log(`store/reddit/reddit-before-after-${c}.png`);
