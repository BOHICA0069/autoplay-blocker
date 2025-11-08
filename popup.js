document.addEventListener("DOMContentLoaded", function () {
  const siteEl = document.getElementById("site");
  const siteCountEl = document.getElementById("siteCount");
  const totalEl = document.getElementById("total");
  const resetBtn = document.getElementById("resetBtn");
  const debugToggle = document.getElementById("debugToggle");

  function updateUI(response, domainFallback) {
    totalEl.textContent = response?.total || 0;
    siteEl.textContent = response?.site || domainFallback || "...";
    siteCountEl.textContent = response?.siteCount || 0;
  }

  // Get current tab domain and stats
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    let domain = "unknown";

    try {
      const tab = tabs[0];
      if (tab?.url && tab.url.startsWith("http")) {
        domain = new URL(tab.url).hostname.replace(/^www\./, "");
      }
    } catch (e) {
      console.warn("Failed to extract domain from tab", e);
    }

    chrome.runtime.sendMessage({ type: "getStats", site: domain }, function (response) {
      updateUI(response, domain);
    });
  });

  // Load debug toggle state
  chrome.storage.local.get(["debugMode"], (res) => {
    debugToggle.checked = !!res.debugMode;
  });

  // Reset button behavior
  resetBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "resetStats" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("resetStats error", chrome.runtime.lastError);
        return;
      }
      updateUI(response, document.getElementById("site").textContent || "unknown");
    });
  });

  // Debug toggle behavior
  debugToggle.addEventListener("change", () => {
    const enabled = debugToggle.checked;
    // Persist debug setting
    chrome.storage.local.set({ debugMode: enabled }, () => {
      // also send an explicit message to background (background listens too)
      chrome.runtime.sendMessage({ type: "setDebug", debug: enabled }, (res) => {
        // no-op; background will also pick up storage change
      });
    });
  });
});