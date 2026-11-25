// Service worker: the toolbar icon and Alt+T open the side panel and translate
// the page in one go. That click is also what gives Mangit access to the page
// (activeTab), so it's the only step needed on a new site.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.warn("sidePanel behavior", err));

function openAndTranslate(tab) {
  if (!tab?.id) return;
  // open() must run straight from the click; don't await anything before it.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.warn("sidePanel open", err));
  // A panel that is just opening picks this up when it starts; an open one
  // gets the message.
  chrome.storage.session.set({ translateRequest: { tabId: tab.id, at: Date.now() } }).catch(() => {});
  chrome.runtime.sendMessage({ type: "lens/translate-shortcut" }).catch(() => {});
}

chrome.action.onClicked.addListener(openAndTranslate);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "translate-page") openAndTranslate(tab);
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
