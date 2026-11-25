// Service worker: opens the side panel, captures the visible tab, and relays
// messages between the side panel (where the AI runs) and the page.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.warn("sidePanel behavior", err));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-page") return;
  chrome.runtime.sendMessage({ type: "lens/translate-shortcut" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "lens/capture") {
    chrome.tabs
      .captureVisibleTab(msg.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }
  return false;
});
