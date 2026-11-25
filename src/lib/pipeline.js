// The page pipeline shared by the extension and the benchmark:
// detect bubbles -> route each to Gemini Nano or the cloud -> boxes + text.
//
// Speed rules:
//  - Bubble crops are small, so each request is quick on either path.
//  - Cloud bubbles run in parallel; a page costs about one bubble's latency.
//  - Gemini Nano runs one prompt at a time, so on-device bubbles go in reading
//    order and appear one by one. Cloud second opinions for unsure bubbles run
//    in the background while Nano keeps reading.
//  - Only pages where the detector finds nothing go to the slower
//    whole-page cloud model, which locates the bubbles itself.

import { detectBubbles } from "./bubbles.js";
import { crop, toImagePart } from "./imaging.js";
import { needsSecondOpinion } from "./translator.js";

const DETECT_MAX_SIDE = 900;
const BUBBLE_PAD = 0.08;
const BUBBLE_MAX_SIDE = 768; // cloud
const DEVICE_MAX_SIDE = 512; // Gemini Nano: smaller crops, faster reads
const PAGE_MAX_SIDE = 1600;
const COVER_INSET = 0.1;

// Debug trace, only when a test page sets globalThis.__lensTrace = [].
const trace = (what) => globalThis.__lensTrace?.push(`${Math.round(performance.now())} ${what}`);

export function newTally() {
  return { device: 0, cloud: 0, escalated: 0, cloudCalls: 0, deviceMs: [], cloudMs: [], path: "" };
}

/**
 * @param page      canvas holding the page at full resolution
 * @param opts.route "auto" | "device" | "cloud"
 * @param opts.deviceReady  Gemini Nano is downloaded and usable
 * @returns bubbles with `box` as fractions (0..1) of the page, in reading order
 */
export async function translateCanvas(page, opts) {
  const {
    translator,
    config,
    target,
    route,
    online = true,
    deviceReady,
    glossary = {},
    tally = newTally(),
    onProgress = () => {},
    onBubble = () => {},
  } = opts;

  const small = crop(page, 0, 0, page.width, page.height, DETECT_MAX_SIDE);
  const ctx = small.getContext("2d", { willReadFrequently: true });
  trace("detect start");
  const regions = detectBubbles(ctx.getImageData(0, 0, small.width, small.height));
  trace(`detect done: ${regions.length} regions, vertical ${regions.filter((r) => r.vertical).length}`);
  const k = page.width / small.width;

  if (regions.length < config.min_bubbles_for_device_path) {
    if (route === "device") throw new Error("No speech bubbles found on this page for on-device mode.");
    if (!online) throw new Error("offline");
    return wholePage();
  }

  const useDevice =
    route === "device" ||
    (route === "auto" && translator.canRunOnDevice(target) && (deviceReady || !online));
  if (!useDevice && !online) throw new Error("offline");
  tally.path = useDevice ? (route === "device" ? "device" : "hybrid") : "cloud-bubbles";

  // Hybrid splits by difficulty: vertical CJK text is where Gemini Nano misreads
  // most, so those bubbles go to the cloud straight away, in parallel, while
  // Nano reads the rest in order. Remote Config can turn this off.
  // With the cloud paused or over today's limit, Hybrid stays fully on-device.
  const cloudOk = online && translator.cloudAllowed();
  const hard = (r) =>
    useDevice && route === "auto" && cloudOk && config.cloud_first_vertical > 0 && r.vertical;
  trace("crops start");
  const parts = await Promise.all(
    regions.map((r) => bubblePart(r, useDevice && !hard(r) ? DEVICE_MAX_SIDE : BUBBLE_MAX_SIDE)),
  );
  const results = new Array(regions.length);
  const emit = (i, r) => {
    if (!r?.translation) return;
    const bubble = { ...r, ...placement(regions[i]) };
    results[i] = bubble;
    count(tally, bubble);
    onBubble(bubble, results.filter(Boolean));
  };

  if (!useDevice) {
    let finished = 0;
    onProgress(`Translating ${regions.length} bubbles in the cloud…`, 0.2);
    await mapLimit(regions, config.cloud_concurrency || 6, async (_r, i) => {
      try {
        const r = await translator.translateBubble(parts[i], { target, glossary, route: "cloud" });
        tally.cloudCalls++;
        emit(i, r);
      } catch (err) {
        if (err?.name === "CloudUnavailableError") throw err;
        console.warn("cloud bubble failed", err);
      }
      finished++;
      onProgress(`Translated ${finished} of ${regions.length} bubbles…`, finished / regions.length);
    });
    return results.filter(Boolean);
  }

  const maxEscalations = route === "auto" && cloudOk ? config.max_cloud_escalations_per_page : 0;
  const secondOpinions = [];
  const cloudFirst = [];
  regions.forEach((r, i) => {
    if (!hard(r)) return;
    tally.routedHard = (tally.routedHard ?? 0) + 1;
    cloudFirst.push(
      translator
        .translateBubble(parts[i], { target, glossary, route: "cloud" })
        .then((res) => {
          tally.cloudCalls++;
          emit(i, { ...res, hard: true });
        })
        .catch((err) => {
          if (err?.name === "CloudUnavailableError") throw err;
          console.warn("cloud bubble failed", err);
        }),
    );
  });
  trace(`crops done; cloud-first ${cloudFirst.length}`);
  for (let i = 0; i < regions.length; i++) {
    if (hard(regions[i])) continue;
    trace(`bubble ${i} nano start`);
    onProgress(`Reading bubble ${i + 1} of ${regions.length} on-device…`, (i + 0.5) / regions.length);
    let r;
    try {
      r = await translator.translateBubble(parts[i], {
        target,
        glossary,
        route: route === "device" ? "device" : "auto",
      });
      if (r.source === "cloud") tally.cloudCalls++;
    } catch (err) {
      // A Nano timeout skips just this bubble (On-device) or sends it for a
      // cloud second opinion below (Hybrid, as an empty, unsure reading).
      const timedOut = err?.name === "DeviceTimeoutError";
      if (!timedOut && (route === "device" || err?.name === "CloudUnavailableError")) throw err;
      if (timedOut) tally.timeouts = (tally.timeouts ?? 0) + 1;
      console.warn("bubble failed", err);
      r = { translation: "", original: "", confident: false, source: "device", ms: 0, failed: true };
    }

    trace(`bubble ${i} nano done source=${r.source} failed=${!!r.failed} text=${(r.original || "").length}`);
    const unsure =
      r.failed || needsSecondOpinion(r, target) || (!r.original && regions[i].ink > 40); // ink but nothing read
    if (secondOpinions.length < maxEscalations && r.source === "device" && unsure) {
      tally.escalated++;
      const first = r;
      secondOpinions.push(
        translator
          .translateBubble(parts[i], { target, glossary, route: "cloud" })
          .then((second) => {
            tally.cloudCalls++;
            emit(i, second.translation ? { ...second, escalated: true } : first);
          })
          .catch((err) => {
            // Over the cloud budget: keep Nano's reading rather than nothing.
            console.warn("cloud second opinion failed", err);
            emit(i, first);
          }),
      );
      continue;
    }
    emit(i, r);
  }
  trace(`waiting for ${secondOpinions.length} second opinions + ${cloudFirst.length} cloud-first`);
  await Promise.all([...secondOpinions, ...cloudFirst]);
  trace("page done");
  return results.filter(Boolean);

  async function bubblePart(r, maxSide) {
    const padX = r.w * BUBBLE_PAD;
    const padY = r.h * BUBBLE_PAD;
    return toImagePart(
      crop(
        page,
        Math.max(0, (r.x - padX) * k),
        Math.max(0, (r.y - padY) * k),
        (r.w + padX * 2) * k,
        (r.h + padY * 2) * k,
        maxSide,
      ),
      "image/png",
    );
  }

  // Cover the inside of the detected bubble: ovals a little inside their box,
  // rectangular captions almost to the edge (their corners hold text too).
  function placement(r) {
    const inset = r.shape === "rect" ? 0.03 : COVER_INSET;
    return {
      shape: r.shape,
      region: { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k },
      box: {
        x: (r.x + r.w * inset) / small.width,
        y: (r.y + r.h * inset) / small.height,
        w: (r.w * (1 - inset * 2)) / small.width,
        h: (r.h * (1 - inset * 2)) / small.height,
      },
    };
  }

  async function wholePage() {
    tally.path = "cloud-page";
    onProgress("No clear bubbles found. Asking the cloud model to find them…", 0.4);
    const bubbles = await translator.translatePage(
      await toImagePart(crop(page, 0, 0, page.width, page.height, PAGE_MAX_SIDE)),
      { target, glossary },
    );
    tally.cloudCalls++;
    for (const b of bubbles) {
      count(tally, b);
      onBubble(b, bubbles);
    }
    return bubbles;
  }
}

function count(tally, b) {
  tally[b.source]++;
  (b.source === "device" ? tally.deviceMs : tally.cloudMs).push(b.ms ?? 0);
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
