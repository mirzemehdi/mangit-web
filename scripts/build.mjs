// Builds three things from the same source:
//   dist/        the Chrome extension (load unpacked, or zip for the store)
//   web-dist/    the hosted web demo (Firebase Hosting)
//   bench-dist/  the benchmark page (served from localhost)
//
// Firebase config comes from .env.local (never committed); see .env.example.
//   node scripts/build.mjs            development build
//   node scripts/build.mjs --prod     web demo without the App Check debug token
//   node scripts/build.mjs --watch
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const prod = process.argv.includes("--prod");

function loadEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const required = ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID"];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")} in .env.local (copy .env.example).`);
  process.exit(1);
}

const KEYS = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
  "APP_CHECK_DEBUG_TOKEN",
  "RECAPTCHA_SITE_KEY",
  "AI_BACKEND",
];
function defines(overrides = {}) {
  const all = { ...env, ...overrides };
  const out = {};
  for (const key of [...KEYS, "LENS_TARGET"]) out[`process.env.${key}`] = JSON.stringify(all[key] ?? "");
  return out;
}

const common = {
  bundle: true,
  alias: { fs: "./src/shims/empty.js", path: "./src/shims/empty.js" },
  target: "chrome139",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

// ---- extension
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
for (const f of ["manifest.json", "sidepanel.html", "sidepanel.css", "overlay.css"]) cpSync(`src/${f}`, `dist/${f}`);
const extDefine = defines({ LENS_TARGET: "extension" });
// Extension's "Open a chapter" page: the web demo's reader, extension config.
for (const f of ["library.html"]) cpSync(`src/${f}`, `dist/${f}`);
cpSync("web/app.css", "dist/app.css");
cpSync("bench/data", "dist/data", { recursive: true });
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "dist/pdf.worker.min.mjs");
cpSync("node_modules/node-unrar-js/esm/js/unrar.wasm", "dist/unrar.wasm");
const builds = [
  {
    ...common,
    entryPoints: { background: "src/background.js", sidepanel: "src/sidepanel.js", library: "src/web.js" },
    outdir: "dist",
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    define: extDefine,
  },
  // Injected with chrome.scripting as a classic script, possibly more than
  // once per page: an IIFE keeps its top-level names private.
  { ...common, entryPoints: { content: "src/content.js" }, outdir: "dist", format: "iife", define: extDefine },
];

// ---- web demo: its own Firebase web app, App Check via reCAPTCHA Enterprise.
rmSync("web-dist", { recursive: true, force: true });
cpSync("web", "web-dist", { recursive: true });
// Hosted under a sub-path (mangit.app/translate/): relative URLs need a base.
{
  const base = process.env.WEB_BASE;
  const page = join("web-dist", "index.html");
  writeFileSync(page, readFileSync(page, "utf8").replace("<!--BASE-->", base ? `<base href="${base}" />` : ""));
  const reader = join("web-dist", "reader.html");
}
cpSync("src/overlay.css", "web-dist/overlay.css");
cpSync("bench/data", "web-dist/data", { recursive: true });
cpSync("bench/reader.html", "web-dist/reader.html");
cpSync("public/icons", "web-dist/icons", { recursive: true });
cpSync("public/fonts", "web-dist/fonts", { recursive: true });
// Readers for PDF and CBR load their workers/wasm from next to the page.
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "web-dist/pdf.worker.min.mjs");
cpSync("node_modules/node-unrar-js/esm/js/unrar.wasm", "web-dist/unrar.wasm");
builds.push({
  ...common,
  entryPoints: { app: "src/web.js" },
  outdir: "web-dist",
  format: "esm",
  splitting: true, // PDF/RAR/EPUB/export code loads only when used
  chunkNames: "chunks/[name]-[hash]",
  alias: { ...common.alias, "firebase/auth/web-extension": "firebase/auth" },
  define: defines({
    LENS_TARGET: "web",
    FIREBASE_APP_ID: env.WEB_FIREBASE_APP_ID || env.FIREBASE_APP_ID,
    // The public site never carries the debug token; it attests with reCAPTCHA.
    APP_CHECK_DEBUG_TOKEN: prod ? "" : env.APP_CHECK_DEBUG_TOKEN,
    RECAPTCHA_SITE_KEY: env.WEB_RECAPTCHA_SITE_KEY || env.RECAPTCHA_SITE_KEY,
  }),
});

// ---- benchmark
rmSync("bench-dist", { recursive: true, force: true });
cpSync("bench", "bench-dist", { recursive: true });
builds.push({
  ...common,
  entryPoints: { bench: "src/bench.js" },
  outdir: "bench-dist",
  format: "esm",
  alias: { ...common.alias, "firebase/auth/web-extension": "firebase/auth" },
  define: defines({ LENS_TARGET: "bench" }),
});

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
