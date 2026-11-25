// Hybrid translation through Firebase AI Logic.
//
// Routing, per page:
//   1. The bubble detector found bubbles and Gemini Nano is ready
//      -> each bubble crop is read and translated on-device (free, private,
//         works offline).
//   2. A bubble the on-device model was unsure about (empty, untranslated,
//      self-reported low confidence) is re-asked in the cloud, up to a
//      Remote Config budget per page, and only when we're online.
//   3. The detector found no bubbles, Nano isn't available, or the target
//      language isn't one Nano can write
//      -> the whole page goes to a cloud model that finds the bubbles itself.
//
// Every result records which path produced it, from the SDK's
// response.inferenceSource, so the UI can show "8 on-device · 1 cloud".

import {
  AgentPlatformBackend,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
} from "firebase/ai";
import { app } from "./firebase.js";

// Agent Platform (Vertex) bills the project's Cloud billing account per use;
// the Gemini Developer API needs prepaid credits on paid projects.
const ai = getAI(app, {
  backend:
    process.env.AI_BACKEND === "gemini-developer"
      ? new GoogleAIBackend()
      : new AgentPlatformBackend("global"),
});

const LANGUAGE_NAMES = {
  en: "English",
  es: "Spanish",
  ja: "Japanese",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  id: "Indonesian",
  vi: "Vietnamese",
  tr: "Turkish",
  ar: "Arabic",
  ru: "Russian",
  ko: "Korean",
  zh: "Chinese (Simplified)",
};

export function languageName(code) {
  return LANGUAGE_NAMES[code] ?? code;
}

export const TARGET_LANGUAGES = Object.keys(LANGUAGE_NAMES);

const BUBBLE_SCHEMA = {
  type: "object",
  properties: {
    original: { type: "string", description: "Text exactly as written in the image." },
    translation: { type: "string" },
    confident: {
      type: "boolean",
      description: "false if the text was hard to read or the translation is a guess.",
    },
  },
  required: ["original", "translation", "confident"],
};

const PAGE_SCHEMA = {
  type: "object",
  properties: {
    bubbles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          box_2d: {
            type: "array",
            items: { type: "integer" },
            description: "[ymin, xmin, ymax, xmax] normalised to 0-1000.",
          },
          original: { type: "string" },
          translation: { type: "string" },
        },
        required: ["box_2d", "original", "translation"],
      },
    },
  },
  required: ["bubbles"],
};

function bubblePrompt(target, glossary, { onDevice = false } = {}) {
  return [
    "This image is one speech bubble or caption cropped from a manga or comic page.",
    "Read all the text in it (it may be Japanese, Korean, Chinese, or another language; Japanese is often vertical, read top-to-bottom, right-to-left).",
    `Translate it into natural, conversational ${languageName(target)} that fits a comic speech bubble. Keep it short. Keep sound effects as sound effects.`,
    onDevice ? deviceGlossaryLine(glossary, target) : glossaryLine(glossary),
    "If there is no readable text, return empty strings and confident=false.",
    "Answer only with JSON matching the schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

function pagePrompt(target, glossary) {
  return [
    "This is a manga or comic page. Find every speech bubble, thought bubble and narration box that contains text.",
    "Skip sound effects drawn into the art.",
    `For each, give its box_2d as [ymin, xmin, ymax, xmax] on a 0-1000 scale covering the inside of the bubble, the original text, and a natural ${languageName(target)} translation sized to fit the bubble.`,
    "List them in reading order.",
    glossaryLine(glossary),
    "Answer only with JSON matching the schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

function glossaryLine(glossary) {
  const entries = Object.entries(glossary ?? {}).filter(([k, v]) => k && v);
  if (!entries.length) return "";
  return (
    "Always translate these names and terms this way: " +
    entries.map(([k, v]) => `${k} -> ${v}`).join("; ") +
    "."
  );
}

// Gemini Nano only accepts English, Japanese and Spanish text in a prompt;
// Chinese or Korean characters in the prompt can make it hang. On-device
// prompts therefore list only the translated names (which steer spelling) and
// drop any that aren't in a script Nano accepts.
const NANO_TEXT = /^[\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{N}\p{P}\p{Zs}'’-]+$/u;
function deviceGlossaryLine(glossary, target) {
  const names = [...new Set(Object.values(glossary ?? {}))].filter((v) => v && NANO_TEXT.test(v));
  if (!names.length) return "";
  return `If the text mentions any of these names, use this spelling: ${names.join(", ")}. Otherwise ignore this line.`;
}

// Reading a bubble needs little reasoning; long thinking only adds seconds.
function thinking(level) {
  return level ? { thinkingConfig: { thinkingLevel: level } } : {};
}

// Cost guards for the cloud path. Remote Config can pause the cloud for
// everyone at once (cloud_enabled = 0), and each browser gets a daily budget
// of cloud bubble requests (daily_cloud_requests_per_browser). On-device
// reading is never limited.
export class CloudUnavailableError extends Error {
  constructor(kind) {
    super(
      kind === "paused"
        ? "Cloud translation is paused right now. On-device mode still works."
        : "You've reached today's cloud limit for this browser. On-device mode still works, and the limit resets tomorrow.",
    );
    this.name = "CloudUnavailableError";
    this.kind = kind;
  }
}

const DAY_KEY = () => `lens.cloudCalls.${new Date().toISOString().slice(0, 10)}`;
function cloudCallsToday() {
  try {
    return Number(localStorage.getItem(DAY_KEY())) || 0;
  } catch {
    return 0;
  }
}
function countCloudCall() {
  try {
    localStorage.setItem(DAY_KEY(), String(cloudCallsToday() + 1));
  } catch {}
}

export class DeviceLanguageError extends Error {
  constructor(target) {
    super(`Gemini Nano can't write ${languageName(target)} yet. Pick English, Spanish or Japanese, or use the cloud.`);
    this.name = "DeviceLanguageError";
  }
}

export class HybridTranslator {
  constructor(config) {
    this.config = config;
    this.deviceLanguages = new Set(config.device_languages.split(",").map((s) => s.trim()));
    this.models = new Map();
  }

  // Bubble model: Nano first, cloud fallback. Cached per target language since
  // the on-device session is created with its expected output language.
  bubbleModel(target, mode = InferenceMode.PREFER_ON_DEVICE) {
    const key = `${mode}:${target}`;
    if (!this.models.has(key)) {
      const outLang = this.deviceLanguages.has(target) ? target : "en";
      this.models.set(
        key,
        getGenerativeModel(ai, {
          mode,
          inCloudParams: {
            model: this.config.cloud_fast_model,
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
              responseJsonSchema: BUBBLE_SCHEMA,
              ...thinking(this.config.cloud_bubble_thinking),
            },
          },
          onDeviceParams: {
            createOptions: {
              expectedInputs: [
                { type: "image" },
                { type: "text", languages: ["en", "ja"] },
              ],
              expectedOutputs: [{ type: "text", languages: [outLang] }],
            },
            promptOptions: { responseConstraint: BUBBLE_SCHEMA },
          },
        }),
      );
    }
    return this.models.get(key);
  }

  pageModel() {
    if (!this.pageModelInstance) {
      this.pageModelInstance = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: this.config.cloud_page_model,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseJsonSchema: PAGE_SCHEMA,
            ...thinking(this.config.cloud_page_thinking),
          },
        },
      });
    }
    return this.pageModelInstance;
  }

  cloudAllowed() {
    try {
      this.checkCloud();
      return true;
    } catch {
      return false;
    }
  }

  checkCloud() {
    if (!Number(this.config.cloud_enabled)) throw new CloudUnavailableError("paused");
    if (cloudCallsToday() >= Number(this.config.daily_cloud_requests_per_browser))
      throw new CloudUnavailableError("limit");
  }

  canRunOnDevice(target) {
    return this.deviceLanguages.has(target);
  }

  // Must be called from a user gesture (button click). Starts the Gemini Nano
  // download if needed and reports progress 0..1.
  async prepareDevice(target, onProgress) {
    if (!this.canRunOnDevice(target)) return;
    await this.bubbleModel(target).initializeDeviceModel?.(onProgress);
  }

  // route: "auto" (Nano first, cloud fallback), "device" (Nano only, never
  // touches the network) or "cloud".
  async translateBubble(imagePart, { target, glossary, route = "auto" }) {
    // On-device is a promise to the reader: it never falls back to the cloud.
    if (route === "device" && !this.canRunOnDevice(target)) {
      throw new DeviceLanguageError(target);
    }
    let mode = InferenceMode.PREFER_ON_DEVICE;
    if (route === "cloud" || !this.canRunOnDevice(target)) mode = InferenceMode.ONLY_IN_CLOUD;
    else if (route === "device") mode = InferenceMode.ONLY_ON_DEVICE;
    // PREFER_ON_DEVICE can fall back to the cloud inside the SDK, so it is
    // guarded too.
    if (mode !== InferenceMode.ONLY_ON_DEVICE) this.checkCloud();
    const started = performance.now();
    const prompt = bubblePrompt(target, glossary, { onDevice: mode !== InferenceMode.ONLY_IN_CLOUD });
    const call = withRetry(() => this.bubbleModel(target, mode).generateContent([prompt, imagePart]));
    // Gemini Nano occasionally never answers a prompt. Give up after a limit so
    // one bubble can't stall the page; the next request starts a new session.
    const result =
      mode === InferenceMode.ONLY_IN_CLOUD
        ? await call
        : // Hybrid gives up quickly (the cloud takes the bubble); On-device has
          // no fallback, so it waits much longer and only guards against a hang.
          await withTimeout(
            call,
            route === "device" ? Number(this.config.device_only_timeout_ms) || 90000 : Number(this.config.device_timeout_ms) || 20000,
          );
    if (result.response.inferenceSource !== InferenceSource.ON_DEVICE) countCloudCall();
    const parsed = parseJson(result.response.text());
    return {
      original: parsed?.original?.trim() ?? "",
      translation: parsed?.translation?.trim() ?? "",
      confident: parsed?.confident !== false,
      source:
        result.response.inferenceSource === InferenceSource.ON_DEVICE ? "device" : "cloud",
      ms: Math.round(performance.now() - started),
    };
  }

  async translatePage(imagePart, { target, glossary }) {
    this.checkCloud();
    countCloudCall();
    const started = performance.now();
    const result = await withRetry(() =>
      this.pageModel().generateContent([pagePrompt(target, glossary), imagePart]),
    );
    const parsed = parseJson(result.response.text());
    const ms = Math.round(performance.now() - started);
    return (parsed?.bubbles ?? [])
      .filter((b) => Array.isArray(b.box_2d) && b.box_2d.length === 4 && b.translation)
      .map((b) => ({
        box: {
          y: b.box_2d[0] / 1000,
          x: b.box_2d[1] / 1000,
          h: (b.box_2d[2] - b.box_2d[0]) / 1000,
          w: (b.box_2d[3] - b.box_2d[1]) / 1000,
        },
        original: b.original ?? "",
        translation: b.translation,
        confident: true,
        source: "cloud",
        ms,
      }));
  }
}

// A bubble result we shouldn't trust and should re-ask in the cloud.
export function needsSecondOpinion(r, target) {
  if (!r.translation) return Boolean(r.original);
  if (!r.confident) return true;
  if (target !== "ja" && /[぀-ヿ一-鿿가-힯]/.test(r.translation)) return true;
  return false;
}

export class DeviceTimeoutError extends Error {
  constructor() {
    super("Gemini Nano didn't answer in time.");
    this.name = "DeviceTimeoutError";
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new DeviceTimeoutError()), ms))),
  ]);
}

// Rate limits (429) are brief; back off and retry a couple of times.
async function withRetry(call, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const limited = /429|RESOURCE_EXHAUSTED|quota/i.test(String(err?.message ?? err));
      if (!limited || attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt + Math.random() * 500));
    }
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
