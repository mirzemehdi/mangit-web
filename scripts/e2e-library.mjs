// End-to-end check of the extension's "Open a chapter" page: loads the
// unpacked extension in Chrome for Testing, opens a chapter file through the
// file picker, translates a page and the whole chapter, and downloads a CBZ.
//   node scripts/e2e-library.mjs [file] [route]
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const file = resolve(process.argv[2] ?? "web/samples/qingyun-sect-ch1.epub");
const route = process.argv[3] ?? "cloud";
const PROFILE = join(homedir(), ".cache", "mangit-lens-cft-profile");
const root = join(homedir(), ".cache", "cft", "chrome");
const dir = readdirSync(root).sort().reverse()[0];
const bin = join(root, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
const EXT = resolve("dist");

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: bin,
  headless: false,
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
  ignoreDefaultArgs: true,
  args: [`--user-data-dir=${PROFILE}`, "--remote-debugging-pipe", "--no-first-run",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
// Chrome can run its own extension workers too; pick ours by file name.
let worker = context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
while (!worker) {
  await context.waitForEvent("serviceworker", { timeout: 15000 });
  worker = context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
}
const extId = new URL(worker.url()).host;
const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (m) => console.log(`[page ${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => console.log(`[page exception] ${e.message}`));
await page.goto(`chrome-extension://${extId}/library.html`);
await page.bringToFront();
await page.check(`input[name=route][value=${route}]`, { force: true });

await page.setInputFiles("#file", file);
await page
  .waitForFunction(() => /Opened|Couldn|isn't/.test(document.getElementById("status").textContent), null, { polling: 250 })
  .catch(async (err) => {
    console.log(`url: ${page.url()} | status: "${await page.textContent("#status").catch(() => "?")}" | dialog: ${await page.evaluate(() => !!document.querySelector("dialog[open]")).catch(() => "?")}`);
    throw err;
  });
console.log(`open: ${await page.textContent("#status")} | ${await page.textContent("#pos")}`);

await page.$eval("#all", (el) => el.click());
await page
  .waitForFunction(() => /Chapter done|Stopped|wrong|busy|limit|paused/.test(document.getElementById("status").textContent), null, { timeout: 120000, polling: 250 })
  .catch(async (err) => {
    console.log(`status: "${await page.textContent("#status")}" | cloud calls today: ${await page.evaluate(() => localStorage.getItem(`lens.cloudCalls.${new Date().toISOString().slice(0, 10)}`))}`);
    throw err;
  });
console.log(`chapter: ${await page.textContent("#status")}`);
console.log(`bubbles on page 1: ${await page.locator(".mangit-lens-bubble").count()}`);

mkdirSync("bench/e2e", { recursive: true });
const [dl] = await Promise.all([page.waitForEvent("download"), page.$eval("#dl-cbz", (el) => el.click())]);
const out = join("bench/e2e", dl.suggestedFilename());
await dl.saveAs(out);
console.log(`download: ${out} (${statSync(out).size} bytes)`);
await page.screenshot({ path: "bench/e2e/library.png", timeout: 8000 }).catch(() => console.log("(screenshot skipped: window not visible)"));
await context.close();
