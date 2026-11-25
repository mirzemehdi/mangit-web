// Benchmark: runs the real pipeline on the ground-truth pages in bench/data in
// each routing mode and scores what readers care about.
//
//   found      share of real bubbles that came back translated
//   read       how close the text the model read is to the real text (0-100)
//   names      character names translated recognisably
//   leftover   translations that still contain source script
//   on-device  share of bubbles Gemini Nano handled
//   cloud      cloud requests per page
//   time       seconds per page

import { loadConfig } from "./lib/firebase.js";
import { HybridTranslator } from "./lib/translator.js";
import { newTally, translateCanvas } from "./lib/pipeline.js";

const CHAPTERS = new URLSearchParams(location.search).get("chapters")?.split(",") ?? ["ja_school", "ko_office", "zh_sect"];
const out = document.getElementById("out");
const log = document.getElementById("log");
const say = (t) => (log.textContent = t);

document.getElementById("run").addEventListener("click", run);

globalThis.__lensTrace = [];

async function run() {
  const config = await loadConfig();
  const translator = new HybridTranslator(config);
  const modes = [...document.querySelectorAll("input[name=mode]:checked")].map((i) => i.value);
  const limit = Number(document.getElementById("limit").value) || 99;
  const useGlossary = document.getElementById("glossary").checked;

  let deviceReady = false;
  if ("LanguageModel" in self) {
    say("Preparing Gemini Nano…");
    try {
      await translator.prepareDevice("en", (p) => say(`Downloading Gemini Nano ${Math.round(p * 100)}%`));
      deviceReady =
        (await LanguageModel.availability({
          expectedInputs: [{ type: "image" }, { type: "text", languages: ["en", "ja"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        })) === "available";
    } catch (err) {
      console.warn(err);
    }
  }
  const env = {
    chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
    nano: deviceReady ? "available" : "not available",
    config,
    glossary: useGlossary,
    date: new Date().toISOString(),
  };

  const pages = [];
  for (const ch of CHAPTERS) {
    const gt = await (await fetch(`data/${ch}/gt.json`)).json();
    for (const p of gt.pages.slice(0, limit)) pages.push({ ch, gt, p });
  }

  const results = { env, modes: {} };
  for (const mode of modes) {
    if (mode === "device" && !deviceReady) {
      results.modes[mode] = { skipped: "Gemini Nano not available in this browser" };
      continue;
    }
    const rows = [];
    for (const [i, { ch, gt, p }] of pages.entries()) {
      say(`${mode}: ${ch} ${p.file} (${i + 1}/${pages.length})`);
      const tally = newTally();
      const t0 = performance.now();
      let bubbles = [];
      let error = null;
      let first = null;
      let page = null;
      try {
        page = await loadCanvas(`data/${ch}/${p.file}`);
        const glossary = useGlossary ? glossaryFor(gt) : {};
        bubbles = await translateCanvas(page, {
          translator,
          config,
          target: "en",
          route: mode,
          deviceReady,
          glossary,
          tally,
          onBubble: () => {
            if (first == null) first = (performance.now() - t0) / 1000;
          },
        });
      } catch (err) {
        error = String(err?.message ?? err);
        console.error(err);
      }
      const seconds = (performance.now() - t0) / 1000;
      let scored = { gt: 0, found: 0, extra: 0, read: 0, names: 0, namesTotal: 0, leftover: 0, sample: [] };
      try {
        if (page) scored = score(p, gt, bubbles, page);
      } catch (err) {
        error = error ?? `score: ${err?.message ?? err}`;
      }
      rows.push({ chapter: ch, page: p.file, seconds, first: first ?? seconds, error, tally, ...scored });
      render(results, mode, rows);
    }
    results.modes[mode] = summarise(rows);
    results.modes[mode].rows = rows;
    render(results);
  }
  say("Done.");
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
  const a = document.getElementById("download");
  a.href = URL.createObjectURL(blob);
  a.download = `bench-${Date.now()}.json`;
  a.hidden = false;
}

async function loadCanvas(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c;
}

// A reader-supplied glossary: names and terms as a fan would type them.
const FAN_GLOSSARY = {
  結城: "Yuki", 葵: "Aoi", 蓮: "Ren", 黒川: "Kurokawa", 日向: "Hinata",
  서윤: "Seo-yoon", 태오: "Tae-o", 민지: "Minji", 하준: "Ha-jun",
  婉儿: "Wan'er", 萧辰: "Xiao Chen", 白长老: "Elder Bai", 青云宗: "Qingyun Sect",
  筑基: "Foundation Establishment", 师兄: "Senior Brother",
};
function glossaryFor(gt) {
  const g = {};
  for (const src of Object.keys(gt.names)) if (FAN_GLOSSARY[src]) g[src] = FAN_GLOSSARY[src];
  return g;
}

function score(p, gt, bubbles, page) {
  const groups = new Map();
  for (const l of p.lines) {
    if (!l.bubble) continue;
    const g = groups.get(l.gid) ?? { bubble: l.bubble, texts: [] };
    g.texts.push(l.text);
    groups.set(l.gid, g);
  }
  const gtBubbles = [...groups.values()];
  const W = page.width;
  const H = page.height;
  const centre = (b) => [(b.box.x + b.box.w / 2) * W, (b.box.y + b.box.h / 2) * H];

  let found = 0;
  const reads = [];
  let names = 0;
  let namesTotal = 0;
  const used = new Set();
  for (const g of gtBubbles) {
    const [x0, y0, x1, y1] = g.bubble;
    const idx = bubbles.findIndex((b, i) => {
      if (used.has(i)) return false;
      const [cx, cy] = centre(b);
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    });
    const truth = g.texts.join("");
    for (const [src, n] of Object.entries(gt.names)) {
      if (!truth.includes(src)) continue;
      namesTotal++;
      if (idx >= 0 && new RegExp(n.re, "i").test(bubbles[idx].translation)) names++;
    }
    if (idx < 0) continue;
    used.add(idx);
    found++;
    reads.push(similarity(norm(bubbles[idx].original), norm(truth)));
  }
  const leftover = bubbles.filter((b) =>
    /[぀-ヿ一-鿿가-힯]/.test(b.translation),
  ).length;
  return {
    gt: gtBubbles.length,
    found,
    extra: bubbles.length - used.size,
    read: reads.length ? reads.reduce((a, b) => a + b, 0) / reads.length : 0,
    names,
    namesTotal,
    leftover,
    sample: bubbles.slice(0, 3).map((b) => ({ original: b.original, translation: b.translation, source: b.source })),
  };
}

function summarise(rows) {
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const t = rows.reduce(
    (a, r) => ({
      device: a.device + r.tally.device,
      cloud: a.cloud + r.tally.cloud,
      calls: a.calls + r.tally.cloudCalls,
      escalated: a.escalated + r.tally.escalated,
    }),
    { device: 0, cloud: 0, calls: 0, escalated: 0 },
  );
  const n = rows.length || 1;
  return {
    pages: rows.length,
    errors: rows.filter((r) => r.error).length,
    found: pct(sum("found"), sum("gt")),
    read: Math.round((rows.reduce((a, r) => a + r.read * r.found, 0) / Math.max(1, sum("found"))) * 100),
    names: pct(sum("names"), sum("namesTotal")),
    leftover: sum("leftover"),
    onDevice: pct(t.device, t.device + t.cloud),
    cloudCallsPerPage: +(t.calls / n).toFixed(2),
    escalated: t.escalated,
    secondsPerPage: +(sum("seconds") / n).toFixed(1),
    firstBubbleSeconds: +(sum("first") / n).toFixed(1),
  };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const norm = (t) => (t ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");

function similarity(a, b) {
  if (!a && !b) return 1;
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

function render(results, liveMode, liveRows) {
  const cols = [
    ["found", "Bubbles found %"],
    ["read", "Text read right"],
    ["names", "Names right %"],
    ["leftover", "Untranslated"],
    ["onDevice", "On-device %"],
    ["cloudCallsPerPage", "Cloud calls / page"],
    ["firstBubbleSeconds", "First bubble (s)"],
    ["secondsPerPage", "Whole page (s)"],
    ["errors", "Errors"],
  ];
  const modes = { ...results.modes };
  if (liveMode) modes[liveMode] = { ...summarise(liveRows), live: true };
  out.innerHTML =
    `<p class="env">Chrome ${results.env.chrome ?? "?"} · Gemini Nano ${results.env.nano} · glossary ${results.env.glossary ? "on" : "off"}</p>` +
    "<table><thead><tr><th>Mode</th>" +
    cols.map(([, h]) => `<th>${h}</th>`).join("") +
    "</tr></thead><tbody>" +
    Object.entries(modes)
      .map(([m, s]) =>
        s.skipped
          ? `<tr><td>${m}</td><td colspan="${cols.length}">${s.skipped}</td></tr>`
          : `<tr><td>${m}${s.live ? " …" : ""}</td>` + cols.map(([k]) => `<td>${s[k]}</td>`).join("") + "</tr>",
      )
      .join("") +
    "</tbody></table>";
}
