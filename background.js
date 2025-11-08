// Persistent stats and navigation-aware per-site tracking + reset and debug toggle.

let lastTotal = 0;
let perSite = {};
let DEBUG = false;

// Track last hostname per tab to detect top-level navigation changes
const tabHosts = {};

// Helper to compute total from perSite
function computeTotalFromPerSite(obj) {
  return Object.values(obj).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

// Initialize from storage on service worker start
chrome.storage.local.get(["lastTotal", "perSite", "debugMode"], (res) => {
  lastTotal = Number(res.lastTotal) || 0;
  perSite = res.perSite || {};
  DEBUG = !!res.debugMode;

  // Repair stored state: recompute authoritative total from perSite
  const repairedTotal = computeTotalFromPerSite(perSite);
  if (repairedTotal !== lastTotal) {
    lastTotal = repairedTotal;
    // persist the repaired total so stored state is consistent
    chrome.storage.local.set({ lastTotal }, () => {
      if (DEBUG) console.log("[Autoplay Blocker][background] Repaired lastTotal from perSite", { lastTotal, perSite });
    });
  }

  if (DEBUG) console.log("[Autoplay Blocker][background] Initialized from storage", { lastTotal, perSite, DEBUG });
  // Reflect badge if any (global badge)
  try {
    chrome.action.setBadgeText({ text: lastTotal ? String(lastTotal) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#d00" });
  } catch (e) {}
});

// Listen for messages from content/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "updateStats") {
    const site = message.site || "unknown";
    const delta = Number(message.delta || 0);
    const siteDelta = Number(message.siteDelta || 0);

    // Update per-site authoritative map
    if (siteDelta) {
      perSite[site] = (Number(perSite[site]) || 0) + siteDelta;
    } else if (typeof message.siteCount === "number") {
      // Backwards compatibility: avoid regressing stored value
      perSite[site] = Math.max(Number(perSite[site]) || 0, message.siteCount);
    }

    // Recompute the authoritative global total as the sum of perSite counts.
    lastTotal = computeTotalFromPerSite(perSite);

    // Persist the authoritative state
    chrome.storage.local.set({ lastTotal, perSite }, () => {
      if (DEBUG) console.log("[Autoplay Blocker][background] Persisted stats (authoritative)", { lastTotal, perSite });
    });

    // Update global badge
    try {
      chrome.action.setBadgeText({ text: lastTotal ? String(lastTotal) : "" });
      chrome.action.setBadgeBackgroundColor({ color: "#d00" });
    } catch (e) {}

    return; // no response expected
  }

  if (message.type === "getStats") {
    const domain = message.site || "unknown";
    // ensure total is authoritative before responding
    lastTotal = computeTotalFromPerSite(perSite);
    sendResponse({
      total: lastTotal,
      site: domain,
      siteCount: perSite[domain] || 0
    });
    return; // synchronous response
  }

  if (message.type === "resetStats") {
    lastTotal = 0;
    perSite = {};
    chrome.storage.local.set({ lastTotal: 0, perSite: {} }, () => {
      if (DEBUG) console.log("[Autoplay Blocker][background] Stats reset via popup");
    });
    // Clear badge
    try {
      chrome.action.setBadgeText({ text: "" });
    } catch (e) {}
    sendResponse({ total: 0, siteCount: 0 });

    // Broadcast reset to all tabs so content scripts can clear local counters as well
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(t => {
        try {
          chrome.tabs.sendMessage(t.id, { type: "resetLocalCounters", site: t.url ? (new URL(t.url)).hostname.replace(/^www\./, "") : "unknown" }, () => {});
        } catch (e) {}
      });
    });
    return true;
  }

  if (message.type === "setDebug") {
    DEBUG = !!message.debug;
    chrome.storage.local.set({ debugMode: DEBUG }, () => {
      if (DEBUG) console.log("[Autoplay Blocker][background] Debug mode set to", DEBUG);
    });
    sendResponse({ debug: DEBUG });
    return;
  }
});

// Observe storage changes (in case popup toggles debug or other contexts change it)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debugMode) {
    DEBUG = !!changes.debugMode.newValue;
    if (DEBUG) console.log("[Autoplay Blocker][background] debugMode changed (storage)", DEBUG);
  }
});

// Navigation-aware: detect top-level navigation changes and notify content script in that tab to reset local counters
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    // Only care about top-level navigations
    if (details.frameId !== 0) return;
    try {
      const url = new URL(details.url);
      const newHost = url.hostname.replace(/^www\./, "");
      const tabId = details.tabId;
      const prev = tabHosts[tabId];
      if (prev !== newHost) {
        if (DEBUG) console.log("[Autoplay Blocker][background] Top-level navigation detected", { tabId, prev, newHost });
        // Inform the content script in that tab to reset its local counters
        chrome.tabs.sendMessage(tabId, { type: "resetLocalCounters", site: newHost }, () => {
          if (chrome.runtime.lastError && DEBUG) {
            // If the content script is not yet injected/ready, that's okay.
            console.warn("[Autoplay Blocker][background] sendMessage to tab failed (may not have content script yet):", chrome.runtime.lastError);
          } else if (DEBUG) {
            console.log("[Autoplay Blocker][background] resetLocalCounters message sent to tab", tabId);
          }
        });
      }
      tabHosts[tabId] = newHost;
    } catch (e) {
      if (DEBUG) console.warn("[Autoplay Blocker][background] onCommitted parse error", e);
    }
  });
}

// Cleanup map when tab is removed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabHosts[tabId];
});