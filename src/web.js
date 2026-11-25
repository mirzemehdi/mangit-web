// Chapter reader with hybrid translation: the hosted web demo, and the
// extension's "Open a file" page (same code, different Firebase app).
// Demo chapters and files the reader opens (image, PDF, CBZ, CBR, EPUB) share
// one navigator; translations are cached per page and can be downloaded as a
// lettered CBZ or PDF.

import { loadConfig, refreshConfig } from "./lib/firebase.js";
import { HybridTranslator, TARGET_LANGUAGES, languageName } from "./lib/translator.js";
import { newTally, translateCanvas } from "./lib/pipeline.js";
import { renderBubbles, refitLayer, whenLetteringReady } from "./lib/overlay.js";
import { ACCEPT, ChapterError, openChapter } from "./lib/chapter.js";
import { resolveRoute, storageFor } from "./lib/routeDialog.js";
import { publicTotals, recordUsage } from "./lib/usage.js";
import { maybeAskForFeedback, noteRun, openFeedback } from "./lib/feedback.js";

const storage = storageFor(process.env.LENS_TARGET);

const $ = (id) => document.getElementById(id);
const ui = {
  page: $("page"),
  layer: $("layer"),
  stage: $("stage"),
  dropHint: $("drop-hint"),
  file: $("file"),
  prev: $("prev"),
  next: $("next"),
  pos: $("pos"),
  device: $("device"),
  target: $("target"),
  go: $("go"),
  all: $("all"),
  status: $("status"),
  sDevice: $("s-device"),
  sCloud: $("s-cloud"),
  sFirst: $("s-first"),
  sTotal: $("s-total"),
  privacy: $("privacy"),
  toggle: $("toggle"),
  downloads: $("downloads"),
  dlCbz: $("dl-cbz"),
  dlPng: $("dl-png"),
  dlNote: $("dl-note"),
  dlPdf: $("dl-pdf"),
  bench: $("bench"),
  totals: $("totals"),
};

const DEVICE_OPTS = {
  expectedInputs: [{ type: "image" }, { type: "text", languages: ["en", "ja"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};
// Demo chapters: our own drawings, one per source language.
const DEMO = {
  ja_school: "Japanese demo: Sakuragaoka Kendo Club",
  ko_office: "Korean demo: Monday Team Lead",
  zh_sect: "Chinese demo: Qingyun Sect",
};

let config;
let translator;
let deviceState = "checking";
let chapter = null; // { name, kind, pages }
let index = 0;
let results = new Map(); // page index -> { bubbles, tally, first, total, target }
let blobs = new Map(); // page index -> Blob (loaded page)
let pageUrl = null;
let busy = false;
let stopAll = false;
let showingOriginal = false;
let loadToken = 0;

for (const code of TARGET_LANGUAGES) ui.target.add(new Option(languageName(code), code));
ui.target.value = "en";
ui.file.accept = ACCEPT;

for (const b of document.querySelectorAll("[data-chapter]")) {
  b.addEventListener("click", () => {
    press(b);
    setChapter(demoChapter(b.dataset.chapter));
  });
}
ui.file.addEventListener("change", () => ui.file.files[0] && openFile(ui.file.files[0]));
ui.prev.addEventListener("click", () => go(index - 1));
ui.next.addEventListener("click", () => go(index + 1));
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  if (e.key === "ArrowLeft") go(index - 1);
  if (e.key === "ArrowRight") go(index + 1);
});
ui.go.addEventListener("click", () => translateCurrent());
ui.all.addEventListener("click", () => (busy && !stopAll ? (stopAll = true) : translateAll()));
ui.toggle.addEventListener("click", () => {
  showingOriginal = !showingOriginal;
  ui.layer.hidden = showingOriginal;
  ui.toggle.textContent = showingOriginal ? "Show translation" : "Show original";
});
ui.dlCbz.addEventListener("click", () => downloadChapter("cbz"));
ui.dlPng.addEventListener("click", downloadPage);
ui.dlPdf.addEventListener("click", () => downloadChapter("pdf"));
for (const ev of ["dragenter", "dragover"]) {
  ui.stage.addEventListener(ev, (e) => {
    e.preventDefault();
    ui.stage.classList.add("dragging");
    ui.dropHint.hidden = false;
  });
}
for (const ev of ["dragleave", "drop"]) {
  ui.stage.addEventListener(ev, (e) => {
    e.preventDefault();
    ui.stage.classList.remove("dragging");
    ui.dropHint.hidden = true;
    if (ev === "drop" && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });
}
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (item) openFile(item.getAsFile());
});
new ResizeObserver(() => refitLayer(ui.layer)).observe(ui.stage);
whenLetteringReady(() => refitLayer(ui.layer));

setChapter(demoChapter("ja_school"));
const ready = init();
if (ui.bench) renderBench();
if (ui.totals) showTotals();

async function showTotals() {
  try {
    const t = await publicTotals();
    // Shown once there's real use to report.
    if (!t || Number(t.pages) < 50) return;
    const f = (n, one, many) => `<b>${Number(n || 0).toLocaleString("en-US")}</b> ${Number(n) === 1 ? one : many}`;
    ui.totals.innerHTML = `So far: ${f(t.pages, "page", "pages")} translated by ${f(t.browsers, "reader", "readers")}, with ${f(t.bubblesOnDevice, "bubble", "bubbles").replace("<b>", '<b class="dev">')} read on readers' own computers.`;
    ui.totals.hidden = false;
  } catch (err) {
    console.info("totals unavailable", err?.code ?? err?.message);
  }
}

async function init() {
  config = await loadConfig();
  translator = new HybridTranslator(config);
  await refreshDevice();
}

// ------------------------------------------------------------ chapters

function demoChapter(id) {
  return {
    name: DEMO[id],
    kind: "demo",
    pages: [1, 2, 3, 4, 5].map((n) => ({
      name: `p${n}.png`,
      load: async () => (await fetch(`data/${id}/p${n}.png`)).blob(),
    })),
  };
}

function press(active) {
  for (const b of document.querySelectorAll("[data-chapter]")) b.setAttribute("aria-pressed", String(b === active));
}

async function openFile(file) {
  if (busy) return say("Wait for the current translation to finish, or stop it.");
  say(`Opening ${file.name}…`);
  try {
    const opened = await openChapter(file);
    press(null);
    setChapter(opened);
    say(
      opened.pages.length > 1
        ? `Opened ${opened.pages.length} pages. Translate one, or the whole chapter.`
        : "Opened. Press Translate page.",
    );
  } catch (err) {
    console.error(err);
    say(err instanceof ChapterError ? err.message : "Couldn't open that file.");
  } finally {
    ui.file.value = "";
  }
}

function setChapter(next) {
  chapter = next;
  results = new Map();
  blobs = new Map();
  updateDownloads();
  go(0, true);
}

async function go(i, force = false) {
  if (!chapter || i < 0 || i >= chapter.pages.length || (i === index && !force)) return;
  index = i;
  const token = ++loadToken;
  ui.prev.disabled = i === 0;
  ui.next.disabled = i === chapter.pages.length - 1;
  ui.pos.textContent = `Page ${i + 1} of ${chapter.pages.length} · ${chapter.name}`;
  ui.layer.replaceChildren();
  const blob = await pageBlob(i);
  if (token !== loadToken) return; // the reader moved on
  if (pageUrl) URL.revokeObjectURL(pageUrl);
  pageUrl = URL.createObjectURL(blob);
  ui.page.src = pageUrl;
  await ui.page.decode().catch(() => {});
  showPage();
  // Read ahead one page so turning is quick.
  if (i + 1 < chapter.pages.length) pageBlob(i + 1).catch(() => {});
}

async function pageBlob(i) {
  if (!blobs.has(i)) blobs.set(i, chapter.pages[i].load());
  return blobs.get(i);
}

function showPage() {
  const r = results.get(index);
  updateDownloads();
  showingOriginal = false;
  ui.layer.hidden = false;
  ui.toggle.textContent = "Show original";
  ui.toggle.disabled = !r?.bubbles.length;
  if (r) {
    renderBubbles(ui.layer, r.bubbles);
    showStats(r.tally, r.first, r.total);
  } else {
    ui.layer.replaceChildren();
    resetStats();
  }
}

// ------------------------------------------------------------ device

async function refreshDevice() {
  if (!("LanguageModel" in self)) return setDevice("unavailable", "Gemini Nano isn't available in this browser. Cloud mode works.");
  try {
    const a = await LanguageModel.availability(DEVICE_OPTS);
    const text = {
      available: "Gemini Nano is ready on this computer.",
      downloadable: "Gemini Nano can run here after a one-time download.",
      downloading: "Gemini Nano is downloading…",
      unavailable: "Gemini Nano isn't available in this browser. Cloud mode works.",
    }[a];
    setDevice(a, text ?? a);
  } catch {
    setDevice("unavailable", "Gemini Nano isn't available in this browser. Cloud mode works.");
  }
}

function setDevice(state, text) {
  deviceState = state;
  ui.device.dataset.state = state;
  ui.device.textContent = text;
}

function route() {
  return document.querySelector("input[name=route]:checked").value;
}

// Never switch to the cloud behind the reader's back: if Gemini Nano can't run
// for the chosen mode, ask (routeDialog.js). Returns the route to use, or null.
async function decideRoute() {
  await refreshDevice();
  await refreshConfig(config);
  const target = ui.target.value;
  const choice = await resolveRoute({
    route: route(),
    deviceState,
    nanoCanWrite: translator.canRunOnDevice(target),
    languageLabel: languageName(target),
    storage,
  });
  if (!choice) {
    say("Cancelled. Nothing was sent.");
    return null;
  }
  if (choice.download) {
    say("Downloading Gemini Nano once. This can take a few minutes.");
    try {
      // The dialog click is the user gesture Chrome needs to start the download.
      await translator.prepareDevice(target, (p) =>
        setDevice("downloading", `Downloading Gemini Nano… ${Math.round(p * 100)}%`),
      );
    } catch (err) {
      console.warn(err);
    }
    await refreshDevice();
    if (deviceState !== "available") {
      say("Gemini Nano is still getting ready. Try again in a minute.");
      return null;
    }
    return route();
  }
  if (choice.route === "cloud" && route() !== "cloud") say("Translating in the cloud this time, as you chose.");
  return choice.route;
}

// ------------------------------------------------------------ translate

// Clicks that arrive before setup finishes wait for it instead of being lost.
async function whenReady() {
  if (translator) return true;
  say("Getting ready…");
  await ready.catch(() => {});
  return Boolean(translator);
}

async function translateCurrent() {
  if (busy || !(await whenReady())) return;
  busy = true;
  ui.go.disabled = true;
  ui.all.disabled = true;
  try {
    const chosen = await decideRoute();
    if (!chosen) return;
    const r = await translatePage(index, { live: true, chosen });
    recordUsage({ mode: chosen, pages: 1, device: r.tally.device, cloud: r.tally.cloud, seconds: r.total, chapter: false });
    const n = r.bubbles.length;
    noteRun({ mode: chosen, target: ui.target.value, pages: 1, bubbles: n, device: r.tally.device, cloud: r.tally.cloud, seconds: r.total, chapter: false });
    say(n ? `Done. ${n} bubble${n === 1 ? "" : "s"} translated. Hover one to see the original.` : "No text found on this page.");
    if (n) maybeAskForFeedback({ host: $("ask"), storage }).catch(() => {});
  } catch (err) {
    console.error(err);
    say(friendly(err, route()));
  } finally {
    busy = false;
    ui.go.disabled = false;
    ui.all.disabled = false;
  }
}

async function translateAll() {
  if (busy || !(await whenReady())) return;
  busy = true;
  stopAll = false;
  ui.go.disabled = true;
  ui.all.textContent = "Stop";
  const target = ui.target.value;
  const started = performance.now();
  let pagesDone = 0;
  let device = 0;
  let cloud = 0;
  try {
    const chosen = await decideRoute();
    if (!chosen) return;
    const total = chapter.pages.length;
    // Start from the page being read, then the rest in order.
    const order = [...Array(total).keys()].sort((a, b) => ((a - index + total) % total) - ((b - index + total) % total));
    for (const i of order) {
      if (stopAll) break;
      if (results.get(i)?.target === target) continue;
      say(`Translating page ${i + 1} of ${total}…`);
      const r = await translatePage(i, { live: i === index, chosen });
      pagesDone++;
      device += r.tally.device;
      cloud += r.tally.cloud;
    }
    const secs = ((performance.now() - started) / 1000).toFixed(0);
    recordUsage({ mode: chosen, pages: pagesDone, device, cloud, seconds: Number(secs), chapter: true });
    noteRun({ mode: chosen, target, pages: pagesDone, device, cloud, seconds: Number(secs), chapter: true });
    if (pagesDone && !stopAll) maybeAskForFeedback({ host: $("ask"), storage }).catch(() => {});
    say(
      stopAll
        ? `Stopped. ${results.size} of ${total} pages translated.`
        : `Chapter done: ${pagesDone} page${pagesDone === 1 ? "" : "s"} in ${secs} s, ${device} bubbles on this computer, ${cloud} in the cloud.`,
    );
  } catch (err) {
    console.error(err);
    say(friendly(err, route()));
  } finally {
    busy = false;
    ui.go.disabled = false;
    ui.all.textContent = "Translate whole chapter";
  }
}

async function translatePage(i, { live, chosen }) {
  const target = ui.target.value;
  const started = performance.now();
  let first = null;
  const tally = newTally();
  const bmp = await createImageBitmap(await pageBlob(i));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  if (live) {
    resetStats();
    ui.layer.replaceChildren();
  }
  const bubbles = await translateCanvas(canvas, {
    translator,
    config,
    target,
    route: chosen,
    online: navigator.onLine,
    deviceReady: deviceState === "available",
    glossary: {},
    tally,
    onProgress: (text) => live && say(chapter.pages.length > 1 ? `Page ${i + 1}: ${text}` : text),
    onBubble: (_b, all) => {
      if (first == null) first = (performance.now() - started) / 1000;
      if (i === index) {
        renderBubbles(ui.layer, all);
        showStats(tally, first);
      }
    },
  });
  const r = { bubbles, tally, first, total: (performance.now() - started) / 1000, target };
  results.set(i, r);
  updateDownloads();
  if (i === index) showPage();
  return r;
}

// ------------------------------------------------------------ download

async function downloadChapter(kind) {
  if (busy) return say("Wait for the translation to finish first.");
  const { letterPage, exportCbz, exportPdf, download } = await import("./lib/exporter.js");
  busy = true;
  try {
    const pages = [];
    for (let i = 0; i < chapter.pages.length; i++) {
      say(`Lettering page ${i + 1} of ${chapter.pages.length}…`);
      pages.push(await letterPage(await pageBlob(i), results.get(i)?.bubbles ?? []));
    }
    say("Packing the file…");
    const base = chapter.name.replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:*?"<>|]+/g, "") || "chapter";
    const lang = languageName(ui.target.value);
    const blob = kind === "pdf" ? await exportPdf(pages) : await exportCbz(pages, base);
    download(blob, `${base} (${lang}).${kind}`);
    const missing = chapter.pages.length - results.size;
    say(missing ? `Downloaded. ${missing} page${missing === 1 ? " wasn't" : "s weren't"} translated and kept the original text.` : "Downloaded.");
  } catch (err) {
    console.error(err);
    say("Couldn't build the file. Try again.");
  } finally {
    busy = false;
  }
}

async function downloadPage() {
  const r = results.get(index);
  if (!r || busy) return;
  const { letterPage, download } = await import("./lib/exporter.js");
  const blob = await letterPage(await pageBlob(index), r.bubbles, "image/png");
  const base = chapter.name.replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:*?"<>|]+/g, "") || "page";
  download(blob, `${base} p${index + 1} (${languageName(r.target)}).png`);
}

function updateDownloads() {
  const pageDone = results.has(index);
  const any = results.size > 0;
  ui.dlPng.disabled = !pageDone;
  ui.dlCbz.disabled = ui.dlPdf.disabled = !any;
  ui.dlNote.textContent = !any
    ? "Translate a page first."
    : results.size < chapter.pages.length
      ? `${results.size} of ${chapter.pages.length} pages translated. The rest keep the original text.`
      : "";
  ui.dlNote.hidden = !ui.dlNote.textContent;
}

// ------------------------------------------------------------ UI bits

function showStats(t, first, total) {
  ui.sDevice.textContent = t.device;
  ui.sCloud.textContent = t.cloud;
  ui.sFirst.textContent = first != null ? `${first.toFixed(1)} s` : "–";
  ui.sTotal.textContent = total != null ? `${total.toFixed(1)} s` : "–";
  const sent = t.cloudCalls;
  ui.privacy.dataset.state = sent ? "mixed" : "local";
  ui.privacy.textContent = sent
    ? `${sent} bubble image${sent === 1 ? "" : "s"} went to the cloud. ${t.device} stayed on this computer.`
    : t.device
      ? `Nothing left this computer. All ${t.device} bubbles were read on-device.`
      : "";
}

function resetStats() {
  for (const el of [ui.sDevice, ui.sCloud, ui.sFirst, ui.sTotal]) el.textContent = "–";
  ui.privacy.textContent = "";
}

function say(text) {
  ui.status.textContent = text;
}

function friendly(err, chosen) {
  const msg = String(err?.message ?? err);
  if (err?.name === "DeviceLanguageError" || err?.name === "CloudUnavailableError") return msg;
  if (msg === "offline") return "You're offline and this page needs the cloud. Try On-device.";
  if (/app.?check|recaptcha/i.test(msg)) return "Couldn't verify this browser for the cloud model. Reload and try again.";
  if (/quota|429|resource.exhausted/i.test(msg)) return "The cloud is busy. Try again in a minute, or use On-device.";
  if (chosen === "device" || /LanguageModel|API_NOT_ENABLED|on-device/i.test(msg))
    return "Gemini Nano isn't available in this browser. Try Hybrid or Cloud.";
  if (/No speech bubbles/i.test(msg)) return msg;
  return "Something went wrong. Try again.";
}

// Benchmark table, from the measured runs in bench/results.
function renderBench() {
  const rows = [
    ["On-device", "77%", "63%", "100%", "3.2 s", "13.3 s"],
    ["Hybrid", "94%", "83%", "62%", "2.0 s", "9.1 s"],
    ["Hybrid + shared names", "94%", "94%", "63%", "1.9 s", "8.4 s"],
    ["Cloud", "100%", "92%", "0%", "1.7 s", "14.1 s*"],
  ];
  ui.bench.innerHTML = `<table><caption>15 test pages (Japanese vertical, Korean, Chinese) to English, Chrome 158 on an M1 Pro.</caption>
    <thead><tr><th scope="col">Mode</th><th scope="col">Text read right</th><th scope="col">Names right</th><th scope="col">Bubbles on your computer</th><th scope="col">First bubble</th><th scope="col">Whole page</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <p class="fine">*A whole chapter sent at once hits the per-user rate limit; one page in normal use takes 2–4 s.</p>`;
}

// ------------------------------------------------------------ feedback

for (const b of document.querySelectorAll("[data-feedback]")) {
  b.addEventListener("click", () => openFeedback({ storage }));
}
