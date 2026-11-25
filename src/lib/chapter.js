// Opens a page or a whole chapter file in the browser: images, PDF, CBZ/ZIP,
// CBR/RAR and EPUB. Nothing is uploaded; files are read with the File API.
//
// openChapter(file) -> { name, kind, pages: [{ name, load(): Promise<Blob> }] }
// Pages load lazily, so a 200-page volume doesn't sit decoded in memory.

const IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp" };
const PDF_TARGET_HEIGHT = 1800; // render PDF pages about this tall: sharp bubbles, sane memory

export const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.avif,.pdf,.cbz,.zip,.cbr,.rar,.epub";

export class ChapterError extends Error {}

export async function openChapter(file) {
  const name = file.name || "page";
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const type = file.type || "";

  if (type.startsWith("image/") || IMAGE.test(name)) {
    return { name, kind: "image", pages: [{ name, load: async () => file }] };
  }
  if (ext === "pdf" || type === "application/pdf") return openPdf(file, name);
  if (ext === "cbz" || ext === "zip") return openZip(file, name, "cbz");
  if (ext === "epub") return openEpub(file, name);
  if (ext === "cbr" || ext === "rar") return openRar(file, name);
  throw new ChapterError("That file type isn't supported. Use an image, PDF, CBZ, CBR or EPUB.");
}

// ------------------------------------------------------------------ PDF

async function openPdf(file, name) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", document.baseURI).href;
  // isEvalSupported: false - never compile PDF font code with eval (defence
  // against crafted PDFs); scripting is never enabled.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    pages.push({
      name: `${name} p${i}`,
      load: async () => {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(4, PDF_TARGET_HEIGHT / base.height) });
        const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        page.cleanup();
        return canvas.convertToBlob({ type: "image/png" });
      },
    });
  }
  if (!pages.length) throw new ChapterError("This PDF has no pages.");
  return { name, kind: "pdf", pages };
}

// ------------------------------------------------------------------ CBZ / ZIP

async function unzipFile(file) {
  const { unzip } = await import("fflate");
  const data = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) =>
    unzip(data, (err, files) => (err ? reject(new ChapterError("Couldn't open this archive.")) : resolve(files))),
  );
}

function imagePages(entries, name) {
  const images = entries
    .filter(([path, data]) => IMAGE.test(path) && data.length > 0 && !/(^|\/)(__MACOSX|\.)/.test(path))
    .sort(([a], [b]) => naturalCompare(a, b));
  if (!images.length) throw new ChapterError("No pages found in this file.");
  return images.map(([path, data]) => ({
    name: path.split("/").pop(),
    load: async () => new Blob([data], { type: mimeOf(path) }),
  }));
}

async function openZip(file, name, kind) {
  const files = await unzipFile(file);
  return { name, kind, pages: imagePages(Object.entries(files), name) };
}

// ------------------------------------------------------------------ EPUB

// Manga EPUBs are fixed-layout: each spine item shows one image. Follow the
// spine for reading order; fall back to every image in name order.
async function openEpub(file, name) {
  const files = await unzipFile(file);
  const text = (path) => (files[path] ? new TextDecoder().decode(files[path]) : null);
  const xml = (s, type = "application/xml") => new DOMParser().parseFromString(s, type);

  try {
    const container = xml(text("META-INF/container.xml"));
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
    const opf = xml(text(opfPath));
    const opfDir = dirOf(opfPath);
    const manifest = {};
    for (const item of opf.querySelectorAll("manifest > item")) {
      manifest[item.getAttribute("id")] = {
        href: resolvePath(opfDir, item.getAttribute("href")),
        type: item.getAttribute("media-type") ?? "",
      };
    }
    const ordered = [];
    const seen = new Set();
    for (const ref of opf.querySelectorAll("spine > itemref")) {
      const item = manifest[ref.getAttribute("idref")];
      if (!item) continue;
      if (item.type.startsWith("image/")) {
        if (!seen.has(item.href)) ordered.push(item.href), seen.add(item.href);
        continue;
      }
      const page = text(item.href);
      if (!page) continue;
      const doc = xml(page, "application/xhtml+xml");
      const srcs = [
        ...[...doc.getElementsByTagName("img")].map((e) => e.getAttribute("src")),
        ...[...doc.getElementsByTagName("image")].map(
          (e) => e.getAttribute("xlink:href") ?? e.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? e.getAttribute("href"),
        ),
      ].filter(Boolean);
      for (const src of srcs) {
        const path = resolvePath(dirOf(item.href), decodeURIComponent(src.split("#")[0]));
        if (files[path] && !seen.has(path)) ordered.push(path), seen.add(path);
      }
    }
    if (ordered.length) {
      return {
        name,
        kind: "epub",
        pages: ordered.map((path) => ({
          name: path.split("/").pop(),
          load: async () => new Blob([files[path]], { type: mimeOf(path) }),
        })),
      };
    }
  } catch (err) {
    console.info("EPUB spine not readable, using image order", err);
  }
  return { name, kind: "epub", pages: imagePages(Object.entries(files), name) };
}

// ------------------------------------------------------------------ CBR / RAR

async function openRar(file, name) {
  const { createExtractorFromData } = await import("node-unrar-js/esm");
  const wasmBinary = await (await fetch(new URL("unrar.wasm", document.baseURI))).arrayBuffer();
  let extractor;
  try {
    extractor = await createExtractorFromData({ wasmBinary, data: await file.arrayBuffer() });
  } catch {
    throw new ChapterError("Couldn't open this RAR file.");
  }
  const { files } = extractor.extract({ files: (h) => !h.flags.directory && IMAGE.test(h.name) });
  const entries = [];
  for (const f of files) if (f.extraction) entries.push([f.fileHeader.name, f.extraction]);
  return { name, kind: "cbr", pages: imagePages(entries, name) };
}

// ------------------------------------------------------------------ helpers

function mimeOf(path) {
  return MIME[path.split(".").pop().toLowerCase()] ?? "application/octet-stream";
}

function dirOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i + 1);
}

function resolvePath(dir, href) {
  const parts = (dir + href).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

// "page2.jpg" before "page10.jpg".
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
