// The extension's service worker: a badge, a context menu item and an
// answer for the content script.
chrome.action.setBadgeText({ text: "ok" });
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "moon-test", title: "Moon test item", contexts: ["page"] });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message === "ping") reply({ pong: true, fromTab: sender.tab ? sender.tab.id : null });
});
// Shows up under "Errors" on moon://extensions.
console.error("moon-test: an error the extensions page should list");
