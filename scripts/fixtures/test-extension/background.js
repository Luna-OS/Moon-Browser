// The extension's service worker: a badge, a context menu item and an
// answer for the content script.
chrome.action.setBadgeText({ text: "ok" });
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "moon-test", title: "Moon test item", contexts: ["page"] });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message === "ping") reply({ pong: true, fromTab: sender.tab ? sender.tab.id : null });
  // The worker's own messages reach the extension's open pages (the pop-up)…
  if (message === "broadcast") chrome.runtime.sendMessage({ broadcast: true });
  // …and one nobody listens for is noise, not an error to list (as in Chrome):
  // the test page's content script doesn't listen.
  if (message === "unheard")
    chrome.tabs
      .query({ url: "http://127.0.0.1/*" })
      .then(([tab]) => chrome.tabs.sendMessage(tab.id, "anyone there?"));
});
// Shows up under "Errors" on moon://extensions.
console.error("moon-test: an error the extensions page should list");
