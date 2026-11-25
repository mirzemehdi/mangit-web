// Asks the reader before anything goes to the cloud that they didn't choose.
// Picking On-device or Hybrid is a privacy choice, so when Gemini Nano can't
// run (not in this browser, not downloaded yet, or can't write the language)
// we stop and offer the options instead of switching silently.
//
// resolveRoute(...) -> { route: "device" | "auto" | "cloud", download: bool } or null (cancelled)

const SKIP_KEY = "lens.cloudWithoutAsking";

export async function resolveRoute({ route, deviceState, nanoCanWrite, languageLabel, storage }) {
  if (route === "cloud") return { route, download: false };
  const ready = deviceState === "available";
  if (ready && nanoCanWrite) return { route, download: false };

  const skip = (await storage.get(SKIP_KEY)) === true;
  const hybrid = route === "auto";

  if (!nanoCanWrite) {
    if (skip && hybrid) return { route: "cloud", download: false };
    return ask({
      title: `Gemini Nano can't write ${languageLabel} yet`,
      body: hybrid
        ? `In Hybrid mode every bubble would go to the cloud. Translate in the cloud, or pick English, Spanish or Japanese to keep bubbles on this computer.`
        : `On-device mode only uses your computer, so nothing was sent. Translate in the cloud instead, or pick English, Spanish or Japanese.`,
      actions: [{ id: "cloud", label: `Translate in the cloud`, primary: true }],
      allowSkip: hybrid,
      storage,
    });
  }

  if (deviceState === "downloadable" || deviceState === "downloading") {
    return ask({
      title: "Gemini Nano isn't downloaded yet",
      body: "Chrome can run Gemini Nano on this computer after a one-time download (a few minutes). Until then, this page can only be read in the cloud.",
      actions: [
        { id: "download", label: "Download Gemini Nano", primary: true },
        { id: "cloud", label: "Use the cloud this time" },
      ],
      allowSkip: false,
      storage,
    });
  }

  // Not available in this browser at all.
  if (skip) return { route: "cloud", download: false };
  return ask({
    title: "Gemini Nano isn't available in this browser",
    body: `${hybrid ? "Hybrid" : "On-device"} mode needs Gemini Nano, which runs in Chrome 139 or newer on a desktop computer. Nothing has been sent. You can translate this page in the cloud instead.`,
    help: 'To turn it on: open <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, set it to Enabled and relaunch Chrome.',
    actions: [{ id: "cloud", label: "Translate in the cloud", primary: true }],
    allowSkip: true,
    storage,
  });
}

function ask({ title, body, help, actions, allowSkip, storage }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "lens-dialog";
    dlg.setAttribute("aria-labelledby", "lens-dialog-title");
    dlg.innerHTML = `
      <h2 id="lens-dialog-title"></h2>
      <p class="lens-dialog-body"></p>
      ${help ? `<p class="lens-dialog-help">${help}</p>` : ""}
      ${allowSkip ? '<label class="lens-dialog-skip"><input type="checkbox" /> Use the cloud without asking next time</label>' : ""}
      <div class="lens-dialog-actions"></div>`;
    dlg.querySelector("h2").textContent = title;
    dlg.querySelector(".lens-dialog-body").textContent = body;
    const row = dlg.querySelector(".lens-dialog-actions");
    const finish = async (id) => {
      if (id === "cloud" && dlg.querySelector(".lens-dialog-skip input")?.checked) await storage.set(SKIP_KEY, true);
      dlg.close();
      dlg.remove();
      if (id === "cancel") resolve(null);
      else if (id === "download") resolve({ route: null, download: true });
      else resolve({ route: "cloud", download: false });
    };
    for (const a of [...actions, { id: "cancel", label: "Cancel" }]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.className = a.primary ? "lens-dialog-primary" : "lens-dialog-secondary";
      b.addEventListener("click", () => finish(a.id));
      row.appendChild(b);
    }
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish("cancel");
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    row.querySelector(".lens-dialog-primary")?.focus();
  });
}

// Storage adapters: chrome.storage in the extension, localStorage on the web.
export const storageFor = (target) =>
  target === "extension" && globalThis.chrome?.storage
    ? {
        get: async (k) => (await chrome.storage.local.get(k))[k],
        set: (k, v) => chrome.storage.local.set({ [k]: v }),
      }
    : {
        get: async (k) => JSON.parse(localStorage.getItem(k) ?? "null"),
        set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)),
      };
