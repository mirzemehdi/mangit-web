// Records demo-video footage from the web demo in real Chrome with Gemini
// Nano: Hybrid on a Japanese page, the hover card, On-device with the network
// off, and a whole EPUB chapter translated and downloaded. One WebM per scene
// in video/raw/, plus marks.json with what happened when.
//
//   node scripts/build.mjs            (dev build: local App Check debug token)
//   serve web-dist on WEB_URL, then: node scripts/record-web.mjs
import { chromium } from "playwright-core";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5180/";
const PROFILE = join(homedir(), ".cache", "mangit-lens-chrome");
const OUT = resolve("video/raw");
const SIZE = { width: 1440, height: 900 };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const marks = [];

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  viewport: SIZE,
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: SIZE },
  acceptDownloads: true,
  ignoreDefaultArgs: true,
  args: [
    `--user-data-dir=${PROFILE}`,
    "--remote-debugging-pipe",
    "--no-first-run",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
    `--window-size=${SIZE.width},${SIZE.height + 90}`,
    "--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput",
  ],
});

async function scene(name, run) {
  const page = await context.newPage();
  const t0 = Date.now();
  const log = [];
  const mark = (what) => {
    const at = (Date.now() - t0) / 1000;
    log.push({ at, what });
    console.log(`[${name}] ${at.toFixed(1)}s  ${what}`);
  };
  try {
    await page.goto(WEB);
    await page.waitForFunction(() => !/Checking/.test(document.getElementById("device").textContent), null, { polling: 250 });
    mark(`device: ${await page.textContent("#device")}`);
    await run(page, mark);
  } finally {
    const video = page.video();
    await page.close();
    const file = join(OUT, `${name}.webm`);
    renameSync(await video.path(), file);
    marks.push({ scene: name, file, log });
  }
}

const status = (page) => page.textContent("#status");
async function waitStatus(page, re, timeout = 240000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.getElementById("status").textContent), re.source, { timeout, polling: 250 });
  return status(page);
}
async function scrollStage(page) {
  await page.evaluate(() => document.querySelector(".tool").scrollIntoView({ block: "start" }));
}

// 1. Hybrid on the Japanese demo page, then the hover card.
await scene("1-hybrid", async (page, mark) => {
  await pause(1200);
  await scrollStage(page);
  await pause(800);
  await page.check("input[name=route][value=auto]", { force: true });
  await pause(600);
  mark("translate");
  await page.click("#go");
  mark(await waitStatus(page, /Done|No text|wrong/));
  mark(await page.textContent("#privacy"));
  await pause(2000);
  const bubbles = page.locator(".mangit-lens-bubble");
  const n = await bubbles.count();
  for (const i of [0, Math.min(2, n - 1)]) {
    mark(`hover ${i}`);
    await bubbles.nth(i).hover();
    await pause(2600);
  }
  await page.mouse.move(5, 5);
  await pause(800);
  mark("show original");
  await page.click("#toggle");
  await pause(1500);
  await page.click("#toggle");
  await pause(1200);
});

// 1b. Hybrid on the Chinese chapter: Nano reads most bubbles, both dots show.
await scene("1b-hybrid-zh", async (page, mark) => {
  await page.click("[data-chapter=zh_sect]");
  await pause(1000);
  await scrollStage(page);
  await page.check("input[name=route][value=auto]", { force: true });
  await pause(600);
  mark("translate");
  await page.click("#go");
  mark(await waitStatus(page, /Done|No text|wrong/));
  mark(await page.textContent("#privacy"));
  await pause(2000);
  const bubbles = page.locator(".mangit-lens-bubble");
  mark("hover 0");
  await bubbles.nth(0).hover();
  await pause(2600);
  await page.mouse.move(5, 5);
  await pause(1000);
});

// 2. Network off, On-device, Korean chapter.
await scene("2-offline", async (page, mark) => {
  await page.click("[data-chapter=ko_office]");
  await pause(1000);
  await scrollStage(page);
  await page.check("input[name=route][value=device]", { force: true });
  await pause(800);
  await context.setOffline(true);
  mark("network off");
  await pause(800);
  mark("translate");
  await page.click("#go");
  mark(await waitStatus(page, /Done|No text|wrong|isn't/));
  mark(await page.textContent("#privacy"));
  await pause(3000);
  await context.setOffline(false);
  mark("network on");
});

// 3. Open an EPUB chapter, translate all of it, page through, download CBZ.
await scene("3-chapter", async (page, mark) => {
  await scrollStage(page);
  await page.check("input[name=route][value=auto]", { force: true });
  await pause(800);
  mark("open epub");
  await page.setInputFiles("#file", resolve("web/samples/qingyun-sect-ch1.epub"));
  mark(await waitStatus(page, /Opened|Couldn/));
  await pause(1500);
  mark("translate chapter");
  await page.click("#all");
  mark(await waitStatus(page, /Chapter done|Stopped|wrong/, 400000));
  await pause(1200);
  for (let i = 0; i < 4; i++) {
    await page.click("#next");
    await pause(1400);
  }
  mark("download cbz");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#dl-cbz")]);
  mark(`downloaded ${dl.suggestedFilename()}`);
  await pause(1500);
});

await context.close();
writeFileSync(join(OUT, "marks.json"), JSON.stringify(marks, null, 2));
console.log("footage in video/raw/");
