// Reddit launch images from the web translator (local web-dist on :5180):
// the full UI with a translated page and a hover card, and a before/after.
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5180/";
const OUT = resolve("store/reddit");
const root = join(homedir(), ".cache", "cft", "chrome");
const bin = join(root, readdirSync(root).sort().reverse()[0], "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
const browser = await chromium.launch({ executablePath: bin, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("lens.feedback.sentAt", String(Date.now())));
await page.goto(BASE);
const chapter = process.argv[2] ?? "ja_school";
await page.click(`[data-chapter=${chapter}]`);
await page.waitForTimeout(1500);
await page.check("input[name=route][value=cloud]", { force: true });
const stage = page.locator("#stage");
await stage.scrollIntoViewIfNeeded();
await stage.screenshot({ path: join(OUT, `${chapter}-before.png`) });
await page.click("#go");
await page.waitForFunction(() => /Done|No text|wrong/.test(document.getElementById("status").textContent), null, { timeout: 120000 });
console.log(await page.textContent("#status"));
await page.waitForTimeout(800);
await stage.screenshot({ path: join(OUT, `${chapter}-after.png`) });
await page.evaluate(() => document.querySelector(".tool").scrollIntoView({ block: "start" }));
await page.hover(".mangit-lens-bubble >> nth=1");
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, `${chapter}-ui.png`) });
await browser.close();
