// Spending shut-off for the cloud path.
//
// The extension and web demo read the Remote Config flag `cloud_enabled`.
// When it is 0 nobody's browser calls Gemini in the cloud; On-device keeps
// working. Two guards turn it off at the monthly limit:
//
//   usageGuard   every 15 minutes: adds up this month's Gemini tokens from
//                Cloud Monitoring (minutes behind real time) and prices them.
//   budgetGuard  Cloud Billing budget notifications (Pub/Sub). Billing data
//                lags by hours, so this is the authoritative backstop.
//
// A switch turned off by a guard comes back on at the start of the next month.
// A switch turned off by hand (no guard marker) is left alone.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { logger } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getRemoteConfig } = require("firebase-admin/remote-config");
const { GoogleAuth } = require("google-auth-library");

initializeApp();

const MONTHLY_LIMIT_USD = 10;
const REGION = "us-central1";
const BUDGET_TOPIC = "lens-budget";

// USD per 1M tokens (Agent Platform list prices, global endpoint). Gemini 3.8
// Flash is priced at its standard rate, not the introductory one, so the
// estimate errs high. Unknown models get the highest price in the table.
const PRICES = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.8-flash": { input: 1.5, output: 7.5 },
};
const FALLBACK_PRICE = { input: 1.5, output: 7.5 };

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7); // "2026-11"

// One scheduled job does both (Cloud Scheduler gives 3 free jobs per billing
// account): the spending check, then folding usage stats.
exports.usageGuard = onSchedule({ schedule: "every 15 minutes", region: REGION, timeoutSeconds: 300 }, async () => {
  await reopenIfNewMonth();
  const { cost, lines } = await monthToDateCost();
  logger.info(`Cloud cost this month: $${cost.toFixed(4)} of $${MONTHLY_LIMIT_USD}`, { lines });
  await getFirestore()
    .doc(`stats_month/${monthKey()}`)
    .set({ cloudCostUsd: Number(cost.toFixed(4)), limitUsd: MONTHLY_LIMIT_USD, lines, updatedAt: FieldValue.serverTimestamp() });
  if (cost >= MONTHLY_LIMIT_USD) {
    await pauseCloud(`usage guard: $${cost.toFixed(2)} this month`);
  }
  await foldUsageStats();
});

// ---------------------------------------------------------------- usage stats
//
// Clients write one anonymous record per translation run to usage_events
// (counts only; see firestore.rules). This folds them into
//   stats/{day}           runs, pages, bubbles on-device / cloud, pages by mode,
//                         runs by surface, distinct browsers, estimated cost
//   stats_public/total    all-time pages, bubbles, runs, browsers (demo page)
// and removes the processed records, so storage and reads stay flat.
const USD_PER_CLOUD_BUBBLE = 0.0005; // measured average per cloud bubble request
const BATCH = 400;

async function foldUsageStats() {
  const db = getFirestore();
  const inc = (n) => FieldValue.increment(n);
  let processed = 0;
  for (let round = 0; round < 10; round++) {
    const snap = await db.collection("usage_events").orderBy("createdAt").limit(BATCH).get();
    if (snap.empty) break;
    const days = new Map();
    const browsersByDay = new Map();
    for (const d of snap.docs) {
      const e = d.data();
      const day = /^\d{4}-\d{2}-\d{2}$/.test(e.day) ? e.day : new Date().toISOString().slice(0, 10);
      const t = days.get(day) ?? { runs: 0, chapterRuns: 0, pages: 0, device: 0, cloud: 0, seconds: 0, mode: {}, surface: {} };
      t.runs++;
      if (e.chapter) t.chapterRuns++;
      t.pages += e.pages || 0;
      t.device += e.device || 0;
      t.cloud += e.cloud || 0;
      t.seconds += e.seconds || 0;
      t.mode[e.mode] = (t.mode[e.mode] ?? 0) + (e.pages || 0);
      t.surface[e.surface] = (t.surface[e.surface] ?? 0) + 1;
      days.set(day, t);
      if (!browsersByDay.has(day)) browsersByDay.set(day, new Set());
      if (e.uid) browsersByDay.get(day).add(e.uid);
    }

    const batch = db.batch();
    const all = { runs: 0, pages: 0, device: 0, cloud: 0 };
    for (const [day, t] of days) {
      const update = {
        runs: inc(t.runs),
        chapterRuns: inc(t.chapterRuns),
        pages: inc(t.pages),
        bubblesOnDevice: inc(t.device),
        bubblesCloud: inc(t.cloud),
        seconds: inc(t.seconds),
        estCloudCostUsd: inc(Number((t.cloud * USD_PER_CLOUD_BUBBLE).toFixed(4))),
        updatedAt: FieldValue.serverTimestamp(),
      };
      // Nested maps: set(..., { merge: true }) treats dotted keys literally.
      update.pagesByMode = Object.fromEntries(Object.entries(t.mode).map(([m, n]) => [m, inc(n)]));
      update.runsBySurface = Object.fromEntries(Object.entries(t.surface).map(([k, n]) => [k, inc(n)]));
      batch.set(db.doc(`stats/${day}`), update, { merge: true });
      all.runs += t.runs;
      all.pages += t.pages;
      all.device += t.device;
      all.cloud += t.cloud;
    }
    batch.set(
      db.doc("stats_public/total"),
      { runs: inc(all.runs), pages: inc(all.pages), bubblesOnDevice: inc(all.device), bubblesCloud: inc(all.cloud), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();

    // Distinct browsers: one tiny marker per anonymous ID per day and overall,
    // counted with a count() aggregation (billed per 1,000 index entries).
    const marks = db.bulkWriter();
    for (const [day, ids] of browsersByDay) {
      for (const uid of ids) {
        marks.set(db.doc(`stats/${day}/browsers/${uid}`), { seen: true });
        marks.set(db.doc(`stats_browsers/${uid}`), { seen: true });
      }
    }
    await marks.close();
    for (const day of days.keys()) {
      const n = (await db.collection(`stats/${day}/browsers`).count().get()).data().count;
      await db.doc(`stats/${day}`).set({ browsers: n }, { merge: true });
    }
    const total = (await db.collection("stats_browsers").count().get()).data().count;
    await db.doc("stats_public/total").set({ browsers: total }, { merge: true });

    processed += snap.size;
    if (snap.size < BATCH) break;
  }
  if (processed) logger.info(`usage stats: folded ${processed} records`);
}

exports.budgetGuard = onMessagePublished({ topic: BUDGET_TOPIC, region: REGION }, async (event) => {
  const data = event.data.message.json ?? {};
  const cost = Number(data.costAmount ?? 0);
  const budget = Number(data.budgetAmount ?? MONTHLY_LIMIT_USD);
  logger.info(`Budget notification: $${cost} of $${budget}`, data);
  if (cost >= budget) await pauseCloud(`budget guard: $${cost.toFixed(2)} billed this month`);
});

async function monthToDateCost(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const seconds = Math.max(60, Math.ceil((now - start) / 1000));
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
  const client = await auth.getClient();
  const project = await auth.getProjectId();
  const params = new URLSearchParams({
    filter: 'metric.type="aiplatform.googleapis.com/publisher/online_serving/token_count"',
    "interval.startTime": start.toISOString(),
    "interval.endTime": now.toISOString(),
    "aggregation.alignmentPeriod": `${seconds}s`,
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    "aggregation.groupByFields": "resource.labels.model_user_id",
  });
  params.append("aggregation.groupByFields", "metric.labels.type");
  let cost = 0;
  const lines = [];
  let pageToken = "";
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const res = await client.request({
      url: `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`,
    });
    for (const ts of res.data.timeSeries ?? []) {
      const model = ts.resource.labels.model_user_id ?? "unknown";
      const type = ts.metric.labels.type === "output" ? "output" : "input";
      const tokens = (ts.points ?? []).reduce((n, p) => n + Number(p.value.int64Value ?? 0), 0);
      const price = (PRICES[model] ?? FALLBACK_PRICE)[type];
      const usd = (tokens / 1e6) * price;
      cost += usd;
      lines.push({ model, type, tokens, usd: Number(usd.toFixed(4)) });
    }
    pageToken = res.data.nextPageToken ?? "";
  } while (pageToken);
  return { cost, lines };
}

async function pauseCloud(reason) {
  const rc = getRemoteConfig();
  const template = await rc.getTemplate();
  const p = template.parameters;
  if (p.cloud_enabled?.defaultValue?.value === "0") return;
  p.cloud_enabled = {
    ...(p.cloud_enabled ?? {}),
    defaultValue: { value: "0" },
    valueType: "NUMBER",
    description: "KILL SWITCH: 0 = no cloud calls for anyone (On-device keeps working)",
  };
  // Marks that a guard (not a person) paused it, and in which month.
  p.cloud_guard_paused = { defaultValue: { value: monthKey() }, valueType: "STRING", description: `Set by the spending guard: ${reason}` };
  await rc.publishTemplate(await rc.validateTemplate(template));
  logger.warn(`Cloud translation PAUSED (${reason})`);
}

async function reopenIfNewMonth() {
  const rc = getRemoteConfig();
  const template = await rc.getTemplate();
  const p = template.parameters;
  const pausedMonth = p.cloud_guard_paused?.defaultValue?.value;
  if (!pausedMonth || pausedMonth === monthKey() || p.cloud_enabled?.defaultValue?.value !== "0") return;
  p.cloud_enabled.defaultValue = { value: "1" };
  delete p.cloud_guard_paused;
  await rc.publishTemplate(await rc.validateTemplate(template));
  logger.info(`New month: cloud translation re-enabled (was paused by the guard in ${pausedMonth})`);
}

exports._test = { monthToDateCost, pauseCloud, reopenIfNewMonth, PRICES };
