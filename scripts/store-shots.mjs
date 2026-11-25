// Takes Chrome Web Store screenshots of the real extension (Chrome for
// Testing, headless): the demo reader translated through the side panel, the
// hover card, and the "Open a chapter" page. Raw captures go to store/raw/;
// scripts/store-compose.py lays them out at 1280x800.
//   node scripts/build.mjs --store && node scripts/store-shots.mjs
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:5178/";
const OUT = resolve("store/raw");
const PROFILE = join(homedir(), ".cache", "mangit-store-shots");
const EXT = resolve("dist");
const root = join(homedir(), ".cache", "cft", "chrome");
const bin = join(root, readdirSync(root).sort().reverse()[0], "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: bin,
  headless: true,
  // No viewport emulation: the extension captures the real window, so the page
  // must be exactly the window's size or overlays won't line up.
  viewport: null,
  ignoreDefaultArgs: true,
  args: [`--user-data-dir=${PROFILE}`, "--remote-debugging-pipe", "--headless=new", "--no-first-run", "--hide-scrollbars", "--window-size=880,800", "--force-device-scale-factor=2", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
// Find our extension's worker by its manifest name (Chrome runs others too).
async function ourWorker() {
  for (let i = 0; i < 40; i++) {
    for (const w of context.serviceWorkers()) {
      const name = await w.evaluate(() => chrome.runtime.getManifest?.().name).catch(() => null);
      if (name?.startsWith("Mangit")) return w;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("extension worker not found");
}
const worker = await ourWorker();
const extId = new URL(worker.url()).host;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(chapter, name, { hover = false, scroll = 60 } = {}) {
  const reader = await context.newPage();
  await reader.goto(`${BASE}reader.html?c=${chapter}`);
  await reader.waitForLoadState("networkidle");
  await reader.evaluate((y) => window.scrollTo(0, y), scroll);
  const tabId = await worker.evaluate(async (c) => {
    for (let i = 0; i < 40; i++) {
      const t = (await chrome.tabs.query({})).find((t) => (t.url || "").includes(`c=${c}`));
      if (t) return t.id;
      await new Promise((r) => setTimeout(r, 250));
    }
  }, chapter);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 800 }); // side-panel width; not captured
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  await panel.waitForFunction(() => document.getElementById("device-status").dataset.state !== "checking", null, { polling: 250 });
  await panel.check("input[name=route][value=cloud]", { force: true });
  await reader.bringToFront();
  const run = async () => {
    await panel.$eval("#translate", (el) => el.click());
    await panel.waitForFunction(() => /Done|No text|wrong|paused|limit/.test(document.getElementById("progress").textContent), null, { timeout: 120000, polling: 300 });
  };
  // First run warms up sign-in and App Check; the second shows real speed.
  await run();
  await panel.$eval("#clear", (el) => el.click());
  await wait(500);
  await panel.evaluate(() => (document.getElementById("progress").textContent = ""));
  await run();
  console.log(`${name}: ${await panel.textContent("#progress")}`);
  await wait(800);
  if (hover) {
    await reader.hover(".mangit-lens-bubble >> nth=0");
    await wait(500);
  }
  // Headless capture makes the timing tile meaningless; keep it out of the shot.
  await panel.evaluate(() => document.querySelector(".stats")?.remove());
  await reader.screenshot({ path: join(OUT, `${name}-page.png`) });
  await panel.screenshot({ path: join(OUT, `${name}-panel.png`) });
  await panel.close();
  await reader.close();
}

await shoot("ja_school", "1-ja");
await shoot("zh_sect", "2-zh-hover", { hover: true });

// The "Open a chapter" page with a translated EPUB chapter.
const lib = await context.newPage();
await lib.goto(`chrome-extension://${extId}/library.html`);
await lib.check("input[name=route][value=cloud]", { force: true });
await lib.setInputFiles("#file", resolve("web/samples/monday-team-lead-ep1.cbz"));
await lib.waitForFunction(() => /Opened/.test(document.getElementById("status").textContent), null, { polling: 250 });
await lib.$eval("#go", (el) => el.click());
await lib.waitForFunction(() => /Done|wrong/.test(document.getElementById("status").textContent), null, { timeout: 120000, polling: 300 });
await wait(800);
await lib.evaluate(() => document.getElementById("stage").scrollIntoView({ block: "start" }));
await wait(300);
await lib.screenshot({ path: join(OUT, "3-chapter.png") });
console.log("3-chapter:", await lib.textContent("#status"));
await context.close();
console.log("raw shots in store/raw/");
