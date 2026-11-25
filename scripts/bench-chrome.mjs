// Runs the benchmark page in a real Chrome with Gemini Nano switched on,
// using its own profile so the on-device model is downloaded once and kept.
//
//   node scripts/bench-chrome.mjs [modes] [pagesPerChapter] [--glossary]
//   node scripts/bench-chrome.mjs device,auto 5
//
// Needs: `npm run build`, the bench page served on BENCH_URL, and
// playwright-core (npm i -D playwright-core).

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BENCH_URL = process.env.BENCH_URL ?? "http://127.0.0.1:5178/";
const PROFILE = process.env.LENS_CHROME_PROFILE ?? join(homedir(), ".cache", "mangit-lens-chrome");
const modes = (process.argv[2] ?? "device,auto").split(",");
const limit = process.argv[3] ?? "5";
const glossary = process.argv.includes("--glossary");

mkdirSync(PROFILE, { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  viewport: { width: 1200, height: 900 },
  // Playwright's default flags disable OptimizationHints and the component
  // updater, which is how Chrome delivers Gemini Nano. Pass only what's needed.
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
    "--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput",
  ],
});

const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (m) => {
  const t = m.text();
  if (process.env.VERBOSE || /error|nano|download/i.test(t)) console.log(`[page ${m.type()}] ${t.slice(0, 300)}`);
});
await page.goto(BENCH_URL);

const availability = await page.evaluate(async () => {
  if (!("LanguageModel" in self)) return "no LanguageModel API";
  return LanguageModel.availability({
    expectedInputs: [{ type: "image" }, { type: "text", languages: ["en", "ja"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });
});
console.log(`Chrome ${await context.browser()?.version?.()} · Nano: ${availability}`);

await page.evaluate(
  ({ modes, limit, glossary }) => {
    for (const box of document.querySelectorAll("input[name=mode]")) box.checked = modes.includes(box.value);
    document.getElementById("limit").value = limit;
    document.getElementById("glossary").checked = glossary;
  },
  { modes, limit, glossary },
);
// A real click: Chrome only starts the model download after a user gesture.
await page.click("#run");

let last = "";
const started = Date.now();
let changedAt = Date.now();
// The model download can sit on one percentage for a while; a page can't.
const STALL_MS = Number(process.env.STALL_MS) || 15 * 60 * 1000;
while (true) {
  const log = await page.textContent("#log");
  if (log !== last) {
    console.log(`${Math.round((Date.now() - started) / 1000)}s  ${log}`);
    last = log;
    changedAt = Date.now();
  }
  if (log === "Done.") break;
  if (Date.now() - changedAt > STALL_MS && !/Downloading/.test(log)) {
    console.error(`Stalled on "${log}" for ${STALL_MS / 60000} min; partial table:`);
    console.error(await page.innerText("#out"));
    console.error("last steps:\n" + (await page.evaluate(() => (globalThis.__lensTrace ?? []).slice(-15).join("\n"))));
    await context.close();
    process.exit(1);
  }
  await page.waitForTimeout(3000);
}

console.log(await page.innerText("#out"));
const json = await page.evaluate(async () => {
  const a = document.getElementById("download");
  return a.href ? (await fetch(a.href)).text() : null;
});
if (json) {
  mkdirSync("bench/results", { recursive: true });
  const file = `bench/results/${new Date().toISOString().replace(/[:.]/g, "-")}-${modes.join("+")}${glossary ? "-glossary" : ""}.json`;
  writeFileSync(file, json);
  console.log(`Saved ${file}`);
}
await context.close();
