// Reader feedback: a "Feedback" button that is always there, and a small
// "How was this translation?" prompt after a translation. Messages go to the
// Firestore `feedback` collection (create-only, see firestore.rules), so the
// team can read bug reports and fix them quickly.
//
// What is sent: the reader's message, the kind (bug, translation, idea,
// other), an optional email for a reply, and, if the reader leaves the box
// ticked, a short summary of the last run (mode, language, bubble counts,
// timings, browser). Never page images, page text or page addresses.
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, ensureSignedIn } from "./session.js";

const SURFACE = process.env.LENS_TARGET === "extension" ? "extension" : "web";
const VERSION = globalThis.chrome?.runtime?.getManifest?.().version ?? "web";
const KINDS = [
  { id: "bug", label: "Something broke" },
  { id: "translation", label: "Wrong translation" },
  { id: "idea", label: "Idea" },
  { id: "other", label: "Other" },
];
const ASKED_KEY = "lens.feedback.askedAt";
const SENT_KEY = "lens.feedback.sentAt";
const DAY = 86_400_000;

// The dialog brings its own styles, so it looks right on every page and even
// when a browser still has an older stylesheet cached.
const CSS = `
.lens-feedback, .lens-feedback * { box-sizing: border-box; }
.lens-feedback { max-width: 460px; width: calc(100% - 32px); padding: 22px; border: 1px solid rgb(255 255 255 / 0.16); border-radius: 14px; background: #15171b; color: #eef0f3; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.lens-feedback::backdrop { background: rgb(0 0 0 / 0.6); }
.lens-feedback form { display: flex; flex-direction: column; gap: 10px; margin: 0; }
.lens-feedback h2 { margin: 0; font: 700 18px/1.3 "Sora", system-ui, sans-serif; letter-spacing: 0; text-transform: none; color: #eef0f3; }
.lens-feedback p { margin: 0; color: #c9ced6; }
.lens-feedback .lens-fb-kinds { display: flex; flex-wrap: wrap; gap: 6px; border: 0; padding: 0; margin: 4px 0; min-width: 0; }
.lens-feedback .lens-fb-kinds label { position: relative; display: inline-flex; margin: 0; }
.lens-feedback .lens-fb-kinds input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.lens-feedback .lens-fb-kinds span { display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border: 1px solid rgb(255 255 255 / 0.16); border-radius: 999px; font-size: 14px; color: #c9ced6; white-space: nowrap; }
.lens-feedback .lens-fb-kinds input:checked + span { border-color: #3fe0ff; color: #eef0f3; background: rgb(63 224 255 / 0.12); }
.lens-feedback .lens-fb-kinds input:focus-visible + span { outline: 2px solid #3fe0ff; outline-offset: 2px; }
.lens-feedback .lens-fb-label { display: block; font-size: 14px; color: #c9ced6; margin-top: 2px; }
.lens-feedback .lens-fb-label span { color: #a0a6b1; }
.lens-feedback textarea, .lens-feedback input[type=email] { display: block; width: 100%; padding: 10px 12px; border: 1px solid rgb(255 255 255 / 0.16); border-radius: 10px; background: #0b0c0f; color: #eef0f3; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.lens-feedback textarea { min-height: 110px; resize: vertical; }
.lens-feedback textarea::placeholder, .lens-feedback input::placeholder { color: #80868f; }
.lens-feedback textarea:focus-visible, .lens-feedback input[type=email]:focus-visible { outline: 2px solid #3fe0ff; outline-offset: 1px; }
.lens-feedback .lens-fb-ctx { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; color: #a0a6b1; }
.lens-feedback .lens-fb-ctx input { width: 16px; height: 16px; margin: 3px 0 0; flex: none; }
.lens-feedback .lens-fb-status { min-height: 1.2em; font-size: 14px; color: #ffc15e; }
.lens-feedback .lens-fb-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.lens-feedback .lens-fb-actions button { min-height: 44px; padding: 0 16px; border-radius: 10px; font: 600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
.lens-feedback .lens-fb-primary { background: #3fe0ff; border: 1px solid #3fe0ff; color: #06222a; }
.lens-feedback .lens-fb-primary:hover { background: #7ae9ff; }
.lens-feedback .lens-fb-secondary { background: none; border: 1px solid rgb(255 255 255 / 0.16); color: #eef0f3; }
.lens-feedback .lens-fb-actions button:focus-visible { outline: 2px solid #3fe0ff; outline-offset: 2px; }
.lens-feedback button:disabled { opacity: 0.6; cursor: default; }
.lens-feedback .lens-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.lens-ask { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; padding: 12px 14px; border: 1px solid rgb(63 224 255 / 0.35); border-radius: 12px; background: rgb(63 224 255 / 0.07); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #c9ced6; }
.lens-ask p { margin: 0; }
.lens-ask strong { color: #eef0f3; }
.lens-ask-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.lens-ask-actions button { min-height: 40px; padding: 0 14px; border: 1px solid rgb(255 255 255 / 0.16); border-radius: 10px; background: #15171b; color: #eef0f3; font: 600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
.lens-ask-actions button:hover { border-color: #3fe0ff; }
.lens-ask-actions .lens-ask-close { margin-left: auto; min-width: 40px; padding: 0; color: #a0a6b1; }
.lens-ask-actions button:focus-visible { outline: 2px solid #3fe0ff; outline-offset: 2px; }
`;
function injectStyles() {
  if (document.getElementById("lens-feedback-style")) return;
  const el = document.createElement("style");
  el.id = "lens-feedback-style";
  el.textContent = CSS;
  document.head.appendChild(el);
}

let lastRun = null; // { mode, target, bubbles, device, cloud, seconds, chapter, pages }
let lastSent = 0;

/** Remember the latest run so a report can include it. */
export function noteRun(run) {
  lastRun = run;
}

function contextLine() {
  const ua = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") || navigator.userAgent;
  const parts = { surface: SURFACE, version: VERSION, browser: ua.slice(0, 160), lang: navigator.language };
  if (lastRun) Object.assign(parts, { lastRun });
  return JSON.stringify(parts).slice(0, 800);
}

async function send({ kind, message, rating = "none", email = "", withContext = true }) {
  if (Date.now() - lastSent < 20_000) throw new Error("Please wait a few seconds before sending again.");
  const user = await ensureSignedIn();
  await addDoc(collection(db, "feedback"), {
    kind,
    message: message.slice(0, 2000),
    rating,
    email: email.slice(0, 200),
    surface: SURFACE,
    context: withContext ? contextLine() : "",
    uid: user.uid,
    createdAt: serverTimestamp(),
  });
  lastSent = Date.now();
}

/**
 * The feedback form, as a modal dialog.
 * @param opts { kind?: string, rating?: "up"|"down"|"none", storage, title? }
 */
export function openFeedback({ kind = "bug", rating = "none", storage, title } = {}) {
  const dlg = document.createElement("dialog");
  injectStyles();
  dlg.className = "lens-feedback";
  dlg.setAttribute("aria-labelledby", "lens-fb-title");
  dlg.innerHTML = `
    <form method="dialog" novalidate>
      <h2 id="lens-fb-title"></h2>
      <p>Bug, wrong translation, idea, anything. We read every message and fix things fast.</p>
      <fieldset class="lens-fb-kinds"><legend class="lens-sr">What is it about?</legend></fieldset>
      <label class="lens-fb-label" for="lens-fb-msg">Your message</label>
      <textarea id="lens-fb-msg" rows="5" maxlength="2000" required placeholder="What happened? Which site or file? What did you expect?"></textarea>
      <label class="lens-fb-label" for="lens-fb-email">Email <span>(optional, only if you'd like a reply)</span></label>
      <input id="lens-fb-email" type="email" maxlength="200" autocomplete="email" />
      <label class="lens-fb-ctx"><input id="lens-fb-ctx" type="checkbox" checked /> Include details of my last translation (mode, language, timings, browser). No images or text.</label>
      <p class="lens-fb-status" role="status" aria-live="polite"></p>
      <div class="lens-fb-actions">
        <button type="button" class="lens-fb-secondary" data-act="cancel">Cancel</button>
        <button type="submit" class="lens-fb-primary">Send</button>
      </div>
    </form>`;
  dlg.querySelector("h2").textContent = title ?? "Send us feedback";
  const kinds = dlg.querySelector(".lens-fb-kinds");
  for (const k of KINDS) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="lens-fb-kind" value="${k.id}" ${k.id === kind ? "checked" : ""} /><span></span>`;
    l.querySelector("span").textContent = k.label;
    kinds.appendChild(l);
  }
  const msg = dlg.querySelector("#lens-fb-msg");
  const status = dlg.querySelector(".lens-fb-status");
  const submit = dlg.querySelector("button[type=submit]");
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  dlg.querySelector("[data-act=cancel]").addEventListener("click", close);
  dlg.addEventListener("cancel", close);
  dlg.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = msg.value.trim();
    if (text.length < 3) {
      status.textContent = "Write a few words so we know what to fix.";
      msg.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = "Sending…";
    try {
      await send({
        kind: dlg.querySelector("input[name=lens-fb-kind]:checked")?.value ?? "other",
        message: text,
        rating,
        email: dlg.querySelector("#lens-fb-email").value.trim(),
        withContext: dlg.querySelector("#lens-fb-ctx").checked,
      });
      await storage?.set(SENT_KEY, Date.now());
      dlg.querySelector("form").innerHTML = `
        <h2>Thank you</h2>
        <p>Got it. Every message is read by the people who build Mangit.</p>
        <div class="lens-fb-actions"><button type="button" class="lens-fb-primary">Close</button></div>`;
      dlg.querySelector("button").addEventListener("click", close);
      dlg.querySelector("button").focus();
    } catch (err) {
      console.error(err);
      submit.disabled = false;
      status.textContent = err?.message?.startsWith("Please wait")
        ? err.message
        : "Couldn't send. Check your connection and try again, or email team@measify.com.";
    }
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  msg.focus();
}

/**
 * After a translation that worked, sometimes ask "How was this translation?".
 * Shown after the first run, then at most every 5 days, and not for 30 days
 * after the reader sent feedback. Never blocks: it's a small bar that can be
 * dismissed.
 * @param host element to put the bar in
 */
export async function maybeAskForFeedback({ host, storage }) {
  if (!host || host.querySelector(".lens-ask")) return;
  injectStyles();
  const now = Date.now();
  const asked = (await storage.get(ASKED_KEY)) ?? 0;
  const sent = (await storage.get(SENT_KEY)) ?? 0;
  if (now - sent < 30 * DAY || now - asked < 5 * DAY) return;
  await storage.set(ASKED_KEY, now);

  const bar = document.createElement("div");
  bar.className = "lens-ask";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Feedback");
  bar.innerHTML = `
    <p><strong>How was this translation?</strong> Your answer helps us improve Mangit.</p>
    <div class="lens-ask-actions">
      <button type="button" data-r="up" aria-label="Good translation">👍 Good</button>
      <button type="button" data-r="down" aria-label="Bad translation">👎 Not good</button>
      <button type="button" data-r="close" class="lens-ask-close" aria-label="Dismiss">×</button>
    </div>`;
  bar.addEventListener("click", async (e) => {
    const r = e.target.closest("button")?.dataset.r;
    if (!r) return;
    if (r === "close") return bar.remove();
    if (r === "up") {
      send({ kind: "rating", message: "", rating: "up" }).catch((err) => console.info("rating not sent", err?.code ?? err?.message));
      bar.innerHTML = `<p><strong>Thanks!</strong> Anything we could do better?</p>
        <div class="lens-ask-actions"><button type="button" data-r="more">Tell us</button><button type="button" data-r="close" class="lens-ask-close" aria-label="Dismiss">×</button></div>`;
      return;
    }
    if (r === "more") {
      bar.remove();
      return openFeedback({ kind: "idea", rating: "up", storage });
    }
    // Thumbs down: ask what went wrong, with the run details attached.
    bar.remove();
    openFeedback({ kind: "translation", rating: "down", storage, title: "What went wrong?" });
  });
  host.prepend(bar);
  return bar;
}
