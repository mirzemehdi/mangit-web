// End-to-end check of the built extension in Chrome for Testing (branded
// Chrome no longer loads unpacked extensions from the command line).
//
//   npx @puppeteer/browsers install chrome@stable --path ~/.cache/cft
//   npm run build && node scripts/e2e-extension.mjs [route] [chapter]
//
// Opens the demo reader, opens the side panel page against that tab, clicks
// Translate, waits for the result and saves screenshots to bench/e2e/.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const route = process.argv[2] ?? "auto";
const chapter = process.argv[3] ?? "ko_office";
const READER = `${process.env.BENCH_URL ?? "http://127.0.0.1:5178/"}reader.html?c=${chapter}`;
// LENS_BROWSER=chrome uses branded Chrome with the Gemini Nano profile from
// bench-chrome.mjs; Chrome for Testing can't run Nano.
const BRANDED = process.env.LENS_BROWSER === "chrome";
const PROFILE = join(homedir(), ".cache", BRANDED ? "mangit-lens-chrome" : "mangit-lens-cft-profile");
const EXT = resolve("dist");

function findCft() {
  const root = join(homedir(), ".cache", "cft", "chrome");
  for (const dir of existsSync(root) ? readdirSync(root).sort().reverse() : []) {
    const bin = join(root, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    if (existsSync(bin)) return bin;
  }
  throw new Error("Chrome for Testing not found; see the header of this file.");
}

mkdirSync(PROFILE, { recursive: true });
mkdirSync("bench/e2e", { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE, {
  ...(BRANDED ? { channel: "chrome" } : { executablePath: findCft() }),
  headless: false,
  viewport: null,
  ignoreDefaultArgs: true,
  args: [
    `--user-data-dir=${PROFILE}`,
    "--remote-debugging-pipe",
    "--no-first-run",
    // Automated windows are often hidden; don't let Chrome slow their timers.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-default-browser-check",
    "--window-size=1280,1000",
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput",
    // Branded Chrome ignores --load-extension unless this switch is re-allowed.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

// Chrome can run its own extension workers too; pick ours by file name.
let worker = context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
while (!worker) {
  await context.waitForEvent("serviceworker", { timeout: 15000 });
  worker = context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
}
const extId = new URL(worker.url()).host;
console.log(`extension ${extId}`);

const reader = context.pages()[0] ?? (await context.newPage());
await reader.goto(READER);
await reader.waitForLoadState("networkidle");
await reader.evaluate(() => window.scrollTo(0, 60));

const tabId = await worker.evaluate(async (url) => {
  for (let i = 0; i < 20; i++) {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => (t.url || t.pendingUrl || "").startsWith(url.split("?")[0]));
    if (tab) return tab.id;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("reader tab not found: " + JSON.stringify((await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl)));
}, READER);

// The real side panel needs a user click on the toolbar icon; tests open the
// same page in its own window, aimed at the reader tab.
const panelPromise = context.waitForEvent("page");
await worker.evaluate(
  ({ extId, tabId }) =>
    chrome.windows.create({
      url: `chrome-extension://${extId}/sidepanel.html?tab=${tabId}`,
      type: "popup",
      width: 400,
      height: 900,
      left: 1290,
      top: 0,
    }),
  { extId, tabId },
);
const panel = await panelPromise;
await panel.waitForLoadState();
await panel.bringToFront();
panel.on("console", (m) => /error|warn/i.test(m.type()) && console.log(`[panel ${m.type()}] ${m.text().slice(0, 300)}`));
await panel.waitForFunction(() => document.getElementById("device-status").dataset.state !== "checking", null, { polling: 250 });
console.log(`device: ${await panel.textContent("#device-status")}`);

await panel.check(`input[name=route][value=${route}]`, { force: true });
// The panel screenshots the reader tab, so the reader window must be visible.
await reader.bringToFront();
await panel.$eval("#translate", (el) => el.click());
const started = Date.now();
await panel.waitForFunction(
  () => !document.getElementById("translate").disabled && /Done|No text|offline|paused|limit|Nano|wrong/.test(document.getElementById("progress").textContent),
  null,
  { timeout: 120000, polling: 500 },
).catch(async (err) => {
  console.log(`progress: "${await panel.textContent("#progress")}" | device: ${await panel.textContent("#device-status")}`);
  throw err;
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`progress: ${await panel.textContent("#progress")} (${seconds}s)`);
console.log(
  `stats: bubbles ${await panel.textContent("#stat-bubbles")}, on-device ${await panel.textContent("#stat-device")}, cloud ${await panel.textContent("#stat-cloud")}`,
);
console.log(`privacy: ${await panel.textContent("#stat-privacy")}`);
console.log(`note: ${await panel.textContent("#stat-note")}`);

const bubbles = await reader.$$eval(".mangit-lens-bubble", (els) =>
  els.map((e) => ({ text: e.dataset.translation, path: e.dataset.path })),
);
console.log(`overlay bubbles: ${bubbles.length}`);
for (const b of bubbles.slice(0, 6)) console.log(`  ${b.text}  [${b.path}]`);

const stamp = `${chapter}-${route}`;
await reader.screenshot({ path: `bench/e2e/${stamp}-page.png` });
if (bubbles.length) {
  await reader.hover(".mangit-lens-bubble");
  await reader.waitForTimeout(300);
  await reader.screenshot({ path: `bench/e2e/${stamp}-hover.png` });
}
await panel.screenshot({ path: `bench/e2e/${stamp}-panel.png` });
console.log(`screenshots in bench/e2e/${stamp}-*.png`);
await context.close();
