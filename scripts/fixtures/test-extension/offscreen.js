// Copies and pastes the way NordPass does, in an offscreen document.
const field = document.querySelector("textarea");
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (!message || message.target !== "offscreen") return;
  if (message.copy !== undefined) {
    field.value = message.copy;
    field.select();
    reply({ copied: document.execCommand("copy") });
  } else {
    field.value = "";
    field.select();
    const pasted = document.execCommand("paste");
    reply({ pasted, text: field.value });
  }
});
