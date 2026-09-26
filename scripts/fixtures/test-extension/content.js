// Runs in every page of the test server: marks the page and asks the
// service worker for an answer.
document.documentElement.dataset.moonExtension = "content-script";
chrome.runtime
  .sendMessage("ping")
  .then((answer) => {
    document.documentElement.dataset.moonPong = answer && answer.pong ? "yes" : "no";
  })
  .catch((err) => {
    document.documentElement.dataset.moonPong = `error: ${err.message}`;
  });
