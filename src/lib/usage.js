// Anonymous usage stats: one small record per translation run, so we can see
// how Mangit Web is used (pages, modes, how much stays on-device) without
// collecting anything about what people read. No images, text, URLs, titles
// or names; only counts. A function (functions/index.js) rolls the records up
// into daily totals and deletes them.
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { db, ensureSignedIn } from "./session.js";

const SURFACE = process.env.LENS_TARGET === "extension" ? "extension" : "web";
const clamp = (n, max) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

/**
 * @param run { mode: "auto"|"device"|"cloud", pages, device, cloud, seconds, chapter }
 */
export function recordUsage(run) {
  if (process.env.LENS_TARGET === "bench") return; // benchmarks and tests aren't usage
  if (!navigator.onLine) return; // offline runs stay entirely local
  const event = {
    surface: SURFACE,
    mode: ["auto", "device", "cloud"].includes(run.mode) ? run.mode : "auto",
    pages: clamp(run.pages, 500),
    device: clamp(run.device, 5000),
    cloud: clamp(run.cloud, 5000),
    seconds: clamp(run.seconds, 36000),
    chapter: Boolean(run.chapter),
    day: new Date().toISOString().slice(0, 10),
  };
  if (!event.pages || !(event.device + event.cloud)) return;
  // Fire and forget: stats must never slow down or break a translation.
  ensureSignedIn()
    .then((user) => addDoc(collection(db, "usage_events"), { ...event, uid: user.uid, createdAt: serverTimestamp() }))
    .catch((err) => console.info("usage stats not recorded", err?.code ?? err?.message));
}

// All-time public totals for the demo page (pages translated, bubbles read
// on readers' own computers).
export async function publicTotals() {
  await ensureSignedIn();
  const snap = await getDoc(doc(db, "stats_public", "total"));
  return snap.exists() ? snap.data() : null;
}
