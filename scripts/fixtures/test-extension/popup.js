// Shows the title of the tab the pop-up belongs to, and stores a value.
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  document.getElementById("tab").textContent = tab ? tab.title : "none";
});
chrome.storage.local.set({ opened: Date.now() });
