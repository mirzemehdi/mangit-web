// Records the footage for the demo video: real Chrome with Gemini Nano and the
// unpacked extension, on our own demo chapters. Each window is recorded to its
// own WebM in video/raw/, with a JSON log of when each step happened so the
// editor can cut to the right moments.
//
//   npm run build && npm run bench   (serves the demo reader on :5178)
//   node scripts/record-demo.mjs
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:5178/";
const PROFILE = join(homedir(), ".cache", "mangit-lens-chrome");
const EXT = resolve("dist");
const OUT = resolve("video/raw");
const SIZE = { width: 1280, height: 800 };
const PANEL = { width: 400, height: 800 };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const marks = [];
const mark = (what) => {
  const at = (Date.now() - t0) / 1000;
  marks.push({ at, what });
  console.log(`${at.toFixed(1)}s  ${what}`);
};

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  viewport: SIZE,
  recordVideo: { dir: OUT, size: SIZE },
  acceptDownloads: true,
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
    "--hide-crash-restore-bubble",
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

let worker = context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
while (!worker) {
  await context.waitForEvent("serviceworker", { timeout: 15000 });
  worker = context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
}
const extId = new URL(worker.url()).host;
mark(`extension ${extId}`);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const videos = {};

async function readerTab(chapter) {
  const page = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage());
  await page.goto(`${BASE}reader.html?c=${chapter}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, 60));
  const tabId = await worker.evaluate(async (c) => {
    for (let i = 0; i < 40; i++) {
      const t = (await chrome.tabs.query({})).find((t) => (t.url || t.pendingUrl || "").includes(`reader.html?c=${c}`));
      if (t) return t.id;
      await new Promise((r) => setTimeout(r, 250));
    }
  }, chapter);
  return { page, tabId };
}

async function panelFor(tabId) {
  const waiting = context.waitForEvent("page");
  await worker.evaluate(
    ({ extId, tabId, w, h }) =>
      chrome.windows.create({ url: `chrome-extension://${extId}/sidepanel.html?tab=${tabId}`, type: "popup", width: w, height: h, left: 1290, top: 0 }),
    { extId, tabId, w: PANEL.width, h: PANEL.height + 40 },
  );
  const panel = await waiting;
  await panel.setViewportSize(PANEL);
  await panel.waitForFunction(() => document.getElementById("device-status").dataset.state !== "checking");
  return panel;
}

async function translateIn(panel, route) {
  await panel.check(`input[name=route][value=${route}]`, { force: true });
  await pause(800);
  await panel.click("#translate");
  await panel.waitForFunction(
    () => !document.getElementById("translate").disabled && /Done|No text|offline|paused|Nano/.test(document.getElementById("progress").textContent),
    null,
    { timeout: 240000, polling: 300 },
  );
  return panel.textContent("#progress");
}

// 1. Hybrid on the Japanese chapter, then the hover card.
{
  const { page: reader, tabId } = await readerTab("ja_school");
  const panel = await panelFor(tabId);
  videos.hybridReader = reader.video();
  videos.hybridPanel = panel.video();
  mark(`device: ${await panel.textContent("#device-status")}`);
  await pause(1500);
  mark("hybrid: translate");
  mark(`hybrid: ${await translateIn(panel, "auto")} | ${await panel.textContent("#stat-privacy")}`);
  await pause(2500);
  const bubbles = reader.locator(".mangit-lens-bubble");
  for (let i = 0; i < Math.min(2, await bubbles.count()); i++) {
    mark(`hover ${i}`);
    await bubbles.nth(i).hover();
    await pause(2500);
  }
  await reader.mouse.move(10, 10);
  await pause(800);
  await panel.close();
}

// 2. Offline, On-device, Korean chapter.
{
  const { page: reader, tabId } = await readerTab("ko_office");
  const panel = await panelFor(tabId);
  videos.offlineReader = reader.video();
  videos.offlinePanel = panel.video();
  await pause(1000);
  await context.setOffline(true);
  mark("offline on");
  await pause(1500);
  mark("on-device: translate");
  mark(`on-device: ${await translateIn(panel, "device")} | ${await panel.textContent("#stat-privacy")}`);
  await pause(3000);
  await context.setOffline(false);
  mark("offline off");
  await panel.close();
}

// 3. Chapter file: open an EPUB, translate the whole chapter, download CBZ.
{
  const lib = await context.newPage();
  videos.library = lib.video();
  await lib.goto(`chrome-extension://${extId}/library.html`);
  await pause(1200);
  await lib.check("input[name=route][value=auto]", { force: true });
  mark("library: open epub");
  await lib.setInputFiles("#file", resolve("web/samples/qingyun-sect-ch1.epub"));
  await lib.waitForFunction(() => /Opened/.test(document.getElementById("status").textContent), null, { polling: 250 });
  await pause(1500);
  mark("library: translate chapter");
  await lib.click("#all");
  await lib.waitForFunction(() => /Chapter done|Stopped|wrong/.test(document.getElementById("status").textContent), null, { timeout: 300000, polling: 250 });
  mark(`library: ${await lib.textContent("#status")}`);
  for (let i = 0; i < 4; i++) {
    await lib.click("#next");
    await pause(1300);
  }
  const [dl] = await Promise.all([lib.waitForEvent("download"), lib.click("#dl-cbz")]);
  mark(`library: downloaded ${dl.suggestedFilename()}`);
  await pause(1500);
}

await context.close();
const files = {};
for (const [name, v] of Object.entries(videos)) files[name] = await v.path();
writeFileSync(join(OUT, "marks.json"), JSON.stringify({ marks, files }, null, 2));
console.log("footage:", files);
