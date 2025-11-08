// 🔢 Block counter (content script) with debug toggle and reset handler
let blockedCount = 0;
let siteBlockedCounts = {};
let DEBUG = false;

function setDebugFromStorage() {
  chrome.storage.local.get(["debugMode"], (res) => {
    DEBUG = !!res.debugMode;
    if (DEBUG) console.log("[Autoplay Blocker][content] Debug enabled for frame", location.hostname);
  });
}
setDebugFromStorage();

// Respond to storage changes for debug toggle
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debugMode !== undefined) {
    DEBUG = !!changes.debugMode.newValue;
    if (DEBUG) console.log("[Autoplay Blocker][content] debugMode changed via storage", DEBUG);
  }
});

function incrementBlocked(reason, element) {
  blockedCount++;

  const domain = location.hostname.replace(/^www\./, "");
  siteBlockedCounts[domain] = (siteBlockedCounts[domain] || 0) + 1;

  if (DEBUG) {
    console.log(`[Autoplay Blocker] Blocked #${blockedCount} (${domain}): ${reason}`, element);
  }

  try {
    if (chrome.runtime?.id) {
      // Send a delta to the background so it can keep a global cumulative total.
      chrome.runtime.sendMessage({
        type: "updateStats",
        delta: 1,
        site: domain,
        siteDelta: 1
      });
    }
  } catch (e) {
    if (DEBUG) console.warn("Extension context invalidated — message not sent", e);
  }
}


// 🔒 Override native play() to block autoplay
const originalPlay = HTMLMediaElement.prototype.play;

HTMLMediaElement.prototype.play = function () {
  if (!this.dataset.userInitiated) {
    incrementBlocked("play() override", this);
    return Promise.reject("Autoplay blocked");
  }
  return originalPlay.apply(this, arguments);
};

// 🧠 Mark user-initiated media
["click", "keydown", "touchstart"].forEach(eventType => {
  window.addEventListener(eventType, () => {
    document.querySelectorAll("video, audio").forEach(media => {
      media.dataset.userInitiated = "true";
    });
  }, true);
});

// Handler for messages from background/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "resetLocalCounters") {
    if (DEBUG) console.log("[Autoplay Blocker][content] Received resetLocalCounters for site:", message.site);
    blockedCount = 0;
    siteBlockedCounts = {};
    // Optionally respond
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "setDebug") {
    DEBUG = !!message.debug;
    if (DEBUG) console.log("[Autoplay Blocker][content] Debug set via message:", DEBUG);
    sendResponse({ debug: DEBUG });
    return;
  }
});

// 🧹 Strip autoplay attributes and pause media
function blockMedia() {
  const allElements = [...document.querySelectorAll("video, audio, iframe, embed, object")];

  // Sweep shadow DOMs
  document.querySelectorAll("*").forEach(el => {
    if (el.shadowRoot) {
      allElements.push(...el.shadowRoot.querySelectorAll("video, audio"));
    }
  });

  allElements.forEach(media => {
    if (media.tagName === "VIDEO" || media.tagName === "AUDIO") {
      if (media.autoplay || media.hasAttribute("autoplay")) {
        try {
          media.autoplay = false;
          media.removeAttribute("autoplay");
        } catch (e) {}
        incrementBlocked("autoplay attribute", media);
      }
      if (media.loop || media.hasAttribute("loop")) {
        try {
          media.loop = false;
          media.removeAttribute("loop");
        } catch (e) {}
        incrementBlocked("loop attribute", media);
      }

      // Do NOT forcibly unmute: browsers allow muted autoplay. Instead ensure the media is paused.
      try {
        if (!media.paused) {
          media.pause();
          // re-apply pause multiple times to beat any racing scripts
          requestAnimationFrame(() => { try { media.pause(); } catch (e) {} });
          setTimeout(() => { try { media.pause(); } catch (e) {} }, 50);
          incrementBlocked("forced pause", media);
        }
      } catch (e) {
        if (DEBUG) console.warn("[Autoplay Blocker][content] Error pausing media", e);
      }
    }

    if (media.tagName === "IFRAME" || media.tagName === "EMBED" || media.tagName === "OBJECT") {
      const src = media.src || "";
      if (src.includes("autoplay=1")) {
        try {
          media.src = src.replace("autoplay=1", "autoplay=0");
        } catch (e) {}
        incrementBlocked("iframe autoplay param", media);
      }
    }
  });
}

// 🕓 Run after load and on visibility change
if (document.readyState !== "complete") {
  window.addEventListener("load", () => setTimeout(blockMedia, 500));
} else {
  setTimeout(blockMedia, 500);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    blockMedia();
  }
});

// 🔁 Poll for 30 seconds to catch lazy media (increased from 15s)
let pollCount = 0;
const poller = setInterval(() => {
  try { blockMedia(); } catch (e) { if (DEBUG) console.warn(e); }
  pollCount++;
  if (pollCount > 30) clearInterval(poller);
}, 1000);

// 👀 Observe DOM changes
const observer = new MutationObserver(() => {
  try { blockMedia(); } catch (e) { if (DEBUG) console.warn(e); }
});
observer.observe(document.documentElement || document.body, { childList: true, subtree: true });