// Auto-translate check: translate once, scroll, and confirm new bubbles are
// translated by themselves, without duplicates, and nothing is translated
// twice when scrolling back.
//   node scripts/build.mjs && node scripts/e2e-auto.mjs
import { chromium } from "playwright-core";
import { readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const EXT = resolve("dist");
const PROFILE = join(homedir(), ".cache", "mangit-auto-test");
rmSync(PROFILE, { recursive: true, force: true });
const root = join(homedir(), ".cache", "cft", "chrome");
const bin = join(root, readdirSync(root).sort().reverse()[0], "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: bin, headless: true, viewport: null, ignoreDefaultArgs: true,
  args: [`--user-data-dir=${PROFILE}`, "--remote-debugging-pipe", "--headless=new", "--no-first-run", "--window-size=1200,800", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let worker;
for (let i = 0; i < 40 && !worker; i++) {
  for (const w of ctx.serviceWorkers()) if ((await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => ""))?.startsWith("Mangit")) worker = w;
  if (!worker) await new Promise((r) => setTimeout(r, 500));
}
const id = new URL(worker.url()).host;
const reader = await ctx.newPage();
await reader.goto(`${process.env.BENCH_URL ?? "http://127.0.0.1:5178/"}reader.html?c=ko_office`);
await reader.waitForLoadState("networkidle");
const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("reader"))?.id);
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${id}/sidepanel.html?tab=${tabId}`);
await panel.waitForFunction(() => document.getElementById("device-status").dataset.state !== "checking", null, { polling: 250 });
await panel.check("input[name=route][value=cloud]", { force: true });
const calls = [];
panel.on("request", (r) => /firebasevertexai|aiplatform|generateContent/i.test(r.url()) && calls.push(r.method() + " " + r.url()));
const bubbles = () => reader.$$eval(".mangit-lens-bubble", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.x + scrollX)},${Math.round(r.y + scrollY)}`; }));
const progress = () => panel.textContent("#progress");
const waitIdle = async () => {
  await panel.waitForFunction(() => !document.getElementById("translate").disabled, null, { polling: 300, timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500)); // let any queued auto run start and finish
  await panel.waitForFunction(() => !document.getElementById("translate").disabled, null, { polling: 300, timeout: 60000 });
};

console.log("auto switch on by default:", await panel.isChecked("#auto"));
await reader.bringToFront();
await panel.$eval("#translate", (el) => el.click());
await panel.waitForFunction(() => /Done|No text|wrong/.test(document.getElementById("progress").textContent), null, { timeout: 60000, polling: 300 });
await waitIdle();
const b1 = await bubbles();
console.log(`1) manual: ${b1.length} bubbles, ${calls.length} cloud calls | ${await progress()}`);

await reader.bringToFront();
await reader.mouse.wheel(0, 900);
await new Promise((r) => setTimeout(r, 1500));
await waitIdle();
const b2 = await bubbles();
const c2 = calls.length;
console.log(`2) after scroll down: ${b2.length} bubbles (${new Set(b2).size} unique), ${c2} cloud calls | ${await progress()}`);

await reader.bringToFront();
await reader.mouse.wheel(0, -900);
await new Promise((r) => setTimeout(r, 1500));
await waitIdle();
const b3 = await bubbles();
console.log(`3) back up: ${b3.length} bubbles, ${calls.length} cloud calls (+${calls.length - c2}) | ${await progress()}`);

const ok = b2.length > b1.length && new Set(b2).size === b2.length && calls.length === c2 && b3.length === b2.length;
if (!ok) console.log("calls after scroll back:", calls.slice(c2).map((u) => u.split("?")[0]));
console.log(ok ? "PASS" : "FAIL");
await ctx.close();
process.exit(ok ? 0 : 1);
