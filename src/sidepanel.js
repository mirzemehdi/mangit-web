import { loadConfig, refreshConfig } from "./lib/firebase.js";
import { resolveRoute, storageFor } from "./lib/routeDialog.js";
import { recordUsage } from "./lib/usage.js";

const storage = storageFor("extension");
import {
  HybridTranslator,
  TARGET_LANGUAGES,
  languageName,
} from "./lib/translator.js";
import { crop, dataUrlToBitmap } from "./lib/imaging.js";
import { newTally, translateCanvas } from "./lib/pipeline.js";
import { loadShared, seriesFromTitle, seriesKey, shareEntry } from "./lib/sharedGlossary.js";

const $ = (id) => document.getElementById(id);
const ui = {
  status: $("device-status"),
  translate: $("translate"),
  progress: $("progress"),
  meter: $("meter-fill"),
  routeHelp: $("route-help"),
  target: $("target"),
  bubbles: $("stat-bubbles"),
  device: $("stat-device"),
  cloud: $("stat-cloud"),
  time: $("stat-time"),
  note: $("stat-note"),
  privacy: $("stat-privacy"),
  setup: $("setup"),
  setupGo: $("setup-go"),
  setupSkip: $("setup-skip"),
  setupFill: $("setup-fill"),
  setupStatus: $("setup-status"),
  toggle: $("toggle"),
  clear: $("clear"),
  series: $("series"),
  gShare: $("g-share"),
  glossaryList: $("glossary-list"),
  glossaryForm: $("glossary-form"),
  gSrc: $("g-src"),
  gDst: $("g-dst"),
};

const ROUTE_HELP = {
  auto: "Gemini Nano reads each bubble on your computer. Only bubbles it's unsure about, or pages it can't parse, go to the cloud.",
  device: "Everything stays on your computer. Works offline. Needs Gemini Nano in Chrome.",
  cloud: "Gemini in the cloud reads every bubble at once. Fastest, and best for colour webtoons and unusual layouts.",
};


let config;
let translator;
let deviceState = "checking";
let busy = false;
let glossary = {}; // merged: shared entries, then the reader's own on top
let mine = {};
let shared = {};
let seriesName = "";

const ready = init();

async function init() {
  for (const code of TARGET_LANGUAGES) {
    ui.target.add(new Option(languageName(code), code));
  }
  const saved = await chrome.storage.local.get(["route", "target"]);
  ui.target.value = saved.target ?? "en";
  setRoute(saved.route ?? "auto");

  ui.target.addEventListener("change", () => {
    chrome.storage.local.set({ target: ui.target.value });
    updateRouteHelp();
  });
  for (const r of document.querySelectorAll('input[name="route"]')) {
    r.addEventListener("change", () => {
      chrome.storage.local.set({ route: route() });
      updateRouteHelp();
    });
  }
  ui.translate.addEventListener("click", () => translateVisible());
  ui.toggle.addEventListener("click", toggleOriginal);
  ui.clear.addEventListener("click", clearPage);
  document.getElementById("open-file").addEventListener("click", () =>
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") }),
  );
  ui.glossaryForm.addEventListener("submit", addGlossaryEntry);
  ui.setupGo.addEventListener("click", setUpDevice);
  ui.setupSkip.addEventListener("click", () => {
    chrome.storage.local.set({ setupDismissed: true });
    ui.setup.hidden = true;
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "lens/translate-shortcut") translateVisible();
  });
  chrome.tabs.onActivated.addListener(() => loadGlossary());
  chrome.tabs.onUpdated.addListener((_id, info) => (info.url || info.title) && loadGlossary());
  ui.series.addEventListener("change", () => loadGlossary(ui.series.value.trim()));
  const { shareNames } = await chrome.storage.local.get("shareNames");
  ui.gShare.checked = shareNames !== false;
  ui.gShare.addEventListener("change", () => chrome.storage.local.set({ shareNames: ui.gShare.checked }));

  // Device state doesn't depend on config; show it before the config fetch.
  await refreshDeviceState();
  config = await loadConfig();
  translator = new HybridTranslator(config);
  updateRouteHelp();
  await loadGlossary();
  const { setupDismissed } = await chrome.storage.local.get("setupDismissed");
  ui.setup.hidden = setupDismissed || !["downloadable", "downloading"].includes(deviceState);
}

// First run: one click downloads Gemini Nano (a user gesture is required).
async function setUpDevice() {
  ui.setupGo.disabled = true;
  ui.setupStatus.textContent = "Starting the download…";
  try {
    await translator.prepareDevice("en", (p) => {
      ui.setupFill.style.width = `${Math.round(p * 100)}%`;
      ui.setupStatus.textContent = `Downloading Gemini Nano… ${Math.round(p * 100)}%. You can translate in the cloud meanwhile.`;
      setDeviceState("downloading", `Nano ${Math.round(p * 100)}%`);
    });
    await refreshDeviceState();
    if (deviceState === "available") {
      ui.setupStatus.textContent = "Ready. Bubbles are now read on your computer.";
      setTimeout(() => (ui.setup.hidden = true), 2500);
    } else {
      ui.setupStatus.textContent = "Chrome is still preparing the model. It will switch on by itself.";
    }
  } catch (err) {
    console.warn(err);
    ui.setupStatus.textContent = "Gemini Nano isn't supported on this computer. Translations will use the cloud.";
  } finally {
    ui.setupGo.disabled = false;
  }
}

function route() {
  return document.querySelector('input[name="route"]:checked').value;
}

function setRoute(value) {
  const input = document.querySelector(`input[name="route"][value="${value}"]`);
  if (input) input.checked = true;
  updateRouteHelp();
}

function updateRouteHelp() {
  let text = ROUTE_HELP[route()];
  if (route() !== "cloud" && translator && !translator.canRunOnDevice(ui.target.value)) {
    text = `Gemini Nano can't write ${languageName(ui.target.value)} yet, so this language uses the cloud.`;
  }
  ui.routeHelp.textContent = text;
}

// ---------------------------------------------------------------- device

async function refreshDeviceState() {
  if (!("LanguageModel" in self)) {
    setDeviceState("unavailable", "Cloud only");
    return;
  }
  try {
    const availability = await LanguageModel.availability({
      expectedInputs: [{ type: "image" }, { type: "text", languages: ["en", "ja"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    const labels = {
      available: "Nano ready",
      downloadable: "Nano not downloaded",
      downloading: "Nano downloading…",
      unavailable: "Cloud only",
    };
    setDeviceState(availability, labels[availability] ?? availability);
  } catch {
    setDeviceState("unavailable", "Cloud only");
  }
}

function setDeviceState(state, label) {
  deviceState = state;
  ui.status.dataset.state = state;
  ui.status.textContent = label;
  ui.status.title =
    state === "unavailable"
      ? "Gemini Nano isn't available in this Chrome. Cloud mode works; other modes will ask first."
      : "";
}

// Never switch to the cloud behind the reader's back: if Gemini Nano can't run
// for the chosen mode, ask first (routeDialog.js). Returns the route or null.
async function decideRoute() {
  await refreshDeviceState();
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
      await translator.prepareDevice(target, (p) => setDeviceState("downloading", `Nano ${Math.round(p * 100)}%`));
    } catch (err) {
      console.warn(err);
    }
    await refreshDeviceState();
    if (deviceState !== "available") {
      say("Gemini Nano is still getting ready. Try again in a minute.");
      return null;
    }
    return route();
  }
  if (choice.route === "cloud" && route() !== "cloud") say("Translating in the cloud this time, as you chose.");
  return choice.route;
}

// ---------------------------------------------------------------- pipeline

// The tab the side panel works on. Automated tests open the panel as a page
// and pass the target with ?tab=<id>.
const pinnedTabId = Number(new URLSearchParams(location.search).get("tab")) || null;

async function activeTab() {
  if (pinnedTabId) return chrome.tabs.get(pinnedTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["overlay.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function translateVisible() {
  if (busy) return;
  // A click before setup finishes waits for it instead of being lost.
  if (!translator) {
    say("Getting ready…");
    await ready.catch(() => {});
    if (!translator) return;
  }
  busy = true;
  ui.translate.disabled = true;
  const started = performance.now();
  const tally = { ...newTally(), total: 0 };
  resetStats();

  try {
    const chosen = await decideRoute();
    if (!chosen) return;
    const tab = await activeTab();
    if (!tab?.id || !/^https?:|^file:/.test(tab.url ?? "")) {
      throw new UserFacingError("Open a manga page in this tab first.");
    }
    await injectContentScript(tab.id);
    const scan = await sendToTab(tab.id, { type: "lens/scan" });
    if (!scan?.images?.length) {
      throw new UserFacingError("No manga page in view. Scroll so the page fills the screen.");
    }
    say("Capturing the page…");
    // Chrome only captures a tab that's visible on screen; don't wait forever.
    const dataUrl = await Promise.race([
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new UserFacingError("Couldn't capture the page. Keep the manga tab visible and try again.")), 10000),
      ),
    ]);
    const shot = await dataUrlToBitmap(dataUrl);
    const scale = shot.width / scan.viewport.w;

    const target = ui.target.value;
    const online = navigator.onLine;
    if (chosen === "cloud" && !online) {
      throw new UserFacingError("You're offline. Switch to On-device to keep translating.");
    }

    for (const image of scan.images) {
      const vis = image.visible;
      const page = crop(shot, vis.x * scale, vis.y * scale, vis.w * scale, vis.h * scale);
      const results = await translateImage(page, { target, chosen, online, tally, image, tab }).catch(
        (err) => {
          throw friendlyOffline(err);
        },
      );
      tally.total += results.length;
    }

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    showStats(tally, seconds);
    recordUsage({ mode: chosen, pages: scan.images.length, device: tally.device, cloud: tally.cloud, seconds: Number(seconds), chapter: false });
    say(
      tally.total
        ? `Done. ${tally.total} bubble${tally.total === 1 ? "" : "s"} translated.`
        : "No text found on this page.",
    );
  } catch (err) {
    console.error(err);
    say(err instanceof UserFacingError ? err.message : friendlyError(err));
  } finally {
    busy = false;
    ui.translate.disabled = false;
    setMeter(0);
    refreshDeviceState();
  }
}

async function translateImage(page, { target, chosen, online, tally, image, tab }) {
  const toElementBox = (b) => ({
    x: (image.visible.x - image.rect.x + b.x * image.visible.w) / image.rect.w,
    y: (image.visible.y - image.rect.y + b.y * image.visible.h) / image.rect.h,
    w: (b.w * image.visible.w) / image.rect.w,
    h: (b.h * image.visible.h) / image.rect.h,
  });
  const render = (bubbles) =>
    sendToTab(tab.id, {
      type: "lens/render",
      id: image.id,
      bubbles: bubbles.map((b) => ({
        translation: b.translation,
        original: b.original,
        source: b.source,
        ms: b.ms,
        escalated: b.escalated,
        shape: b.shape,
        box: toElementBox(b.box),
      })),
    });

  const shown = [];
  const bubbles = await translateCanvas(page, {
    translator,
    config,
    target,
    route: chosen,
    online,
    deviceReady: deviceState === "available",
    glossary,
    tally,
    onProgress: (text, fraction) => {
      say(text);
      setMeter(fraction);
    },
    onBubble: async (b) => {
      shown.push(b);
      await render(shown); // bubbles appear one by one as they're translated
      showStats(tally);
    },
  });
  await render(bubbles);
  return bubbles;
}

function friendlyOffline(err) {
  return String(err?.message) === "offline"
    ? new UserFacingError("You're offline and this page needs the cloud. Try On-device.")
    : err;
}

// ---------------------------------------------------------------- UI bits

function say(text) {
  ui.progress.textContent = text;
}

function setMeter(fraction) {
  ui.meter.style.width = `${Math.round(fraction * 100)}%`;
}

function resetStats() {
  for (const el of [ui.bubbles, ui.device, ui.cloud, ui.time]) el.textContent = "–";
  ui.note.textContent = "";
  ui.privacy.textContent = "";
}

function showStats(t, seconds) {
  ui.bubbles.textContent = t.device + t.cloud;
  ui.device.textContent = t.device;
  ui.cloud.textContent = t.cloud;
  if (seconds) ui.time.textContent = `${seconds}s`;
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const parts = [];
  const d = avg(t.deviceMs);
  const c = avg(t.cloudMs);
  if (d != null) parts.push(`on-device ${d} ms/bubble`);
  if (c != null) parts.push(`cloud ${c} ms/call`);
  if (t.escalated) parts.push(`${t.escalated} sent for a second opinion`);
  if (t.device) parts.push(`${t.device} cloud call${t.device === 1 ? "" : "s"} avoided`);
  ui.note.textContent = parts.join(" · ");
  const sent = t.cloudCalls;
  const kept = t.device;
  ui.privacy.dataset.state = sent ? "mixed" : "local";
  ui.privacy.textContent = sent
    ? `${sent} bubble image${sent === 1 ? "" : "s"} sent to the cloud · ${kept} read on your computer`
    : kept
      ? `Nothing left your computer. All ${kept} bubbles were read on-device.`
      : "";
}

async function toggleOriginal() {
  const tab = await activeTab();
  try {
    const res = await sendToTab(tab.id, { type: "lens/toggle" });
    ui.toggle.textContent = res?.showOriginal ? "Show translation" : "Show original";
  } catch {
    say("Nothing translated on this page yet.");
  }
}

async function clearPage() {
  const tab = await activeTab();
  try {
    await sendToTab(tab.id, { type: "lens/clear" });
  } catch {}
  ui.toggle.textContent = "Show original";
  resetStats();
  say("");
}

class UserFacingError extends Error {}

function friendlyError(err) {
  const msg = String(err?.message ?? err);
  if (/app.?check/i.test(msg)) return "This build isn't authorised to reach the cloud model (App Check).";
  if (/quota|429|resource.exhausted/i.test(msg)) return "The cloud model is busy. Try again in a minute, or switch to On-device.";
  if (/network|fetch|offline/i.test(msg)) return "Couldn't reach the cloud. Switch to On-device to translate offline.";
  if (err?.name === "DeviceLanguageError" || err?.name === "CloudUnavailableError") return msg;
  if (/LanguageModel|on-device|API_NOT_ENABLED/i.test(msg)) return "Gemini Nano isn't available here. Nothing was sent. Switch to Cloud to translate.";
  return "Something went wrong. Try again.";
}

// ---------------------------------------------------------------- glossary

async function loadGlossary(name) {
  if (!name) {
    const tab = await activeTab();
    const remembered = (await chrome.storage.local.get(`seriesFor:${tabKey(tab)}`))[`seriesFor:${tabKey(tab)}`];
    name = remembered ?? seriesFromTitle(tab?.title ?? "");
  } else {
    const tab = await activeTab();
    await chrome.storage.local.set({ [`seriesFor:${tabKey(tab)}`]: name });
  }
  seriesName = name;
  ui.series.value = name;
  const key = `glossary:${seriesKey(name)}`;
  mine = (await chrome.storage.local.get(key))[key] ?? {};
  shared = {};
  merge();
  try {
    shared = await loadShared(name);
    merge();
  } catch (err) {
    console.info("Shared glossary unavailable", err?.message);
  }
}

// A series is remembered per site path prefix, so every chapter page of the
// same series on a site maps to the same glossary.
function tabKey(tab) {
  try {
    const u = new URL(tab?.url ?? "");
    return `${u.hostname}${u.pathname.split("/").slice(0, 3).join("/")}`;
  } catch {
    return "";
  }
}

function merge() {
  glossary = { ...shared, ...mine };
  renderGlossary();
}

function renderGlossary() {
  ui.glossaryList.replaceChildren(
    ...Object.entries(glossary).map(([src, dst]) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${src} → ${dst}`;
      li.append(label);
      if (!(src in mine)) {
        const tag = document.createElement("em");
        tag.className = "tag";
        tag.textContent = "shared";
        li.append(tag);
      } else {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${src}`);
        remove.addEventListener("click", async () => {
          delete mine[src];
          await saveMine();
        });
        li.append(remove);
      }
      return li;
    }),
  );
}

async function addGlossaryEntry(event) {
  event.preventDefault();
  const src = ui.gSrc.value.trim();
  const dst = ui.gDst.value.trim();
  if (!src || !dst) return;
  mine[src] = dst;
  ui.gSrc.value = "";
  ui.gDst.value = "";
  await saveMine();
  ui.gSrc.focus();
  if (ui.gShare.checked && seriesName) {
    shareEntry(seriesName, src, dst).catch((err) => console.info("Couldn't share name", err?.message));
  }
}

async function saveMine() {
  await chrome.storage.local.set({ [`glossary:${seriesKey(seriesName)}`]: mine });
  merge();
}
