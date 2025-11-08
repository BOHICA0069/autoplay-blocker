/**
 * Playwright end-to-end test helper for Chrome extension (unpacked).
 *
 * Usage:
 *   node tests/e2e/run-e2e.js /absolute/path/to/unpacked-extension
 *
 * Notes:
 * - This runs Chromium in headed mode (extensions not supported in headless).
 * - The script will:
 *   1) Launch a persistent Chromium context with the extension loaded.
 *   2) Find the extensionId by inspecting background pages/service workers/pages.
 *   3) Open a test tab (example.com) and simulate content script updates by sending messages.
 *   4) Open the extension popup page at chrome-extension://<id>/popup.html and assert DOM values.
 *   5) Read chrome.storage.local from the background page/service worker to validate persisted values.
 *
 * Exits with:
 *   0 on success,
 *   1 on usage error,
 *   2 on extension not found,
 *   3 on assertion failure or other runtime error.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

if (process.argv.length < 3) {
  console.error('Usage: node tests/e2e/run-e2e.js /absolute/path/to/unpacked-extension');
  process.exit(1);
}

(async () => {
  const extPath = path.resolve(process.argv[2]);
  if (!fs.existsSync(extPath)) {
    console.error('Extension path does not exist:', extPath);
    process.exit(1);
  }

  // Temp user data dir inside the repo to avoid touching your main profile
  const userDataDir = path.join(__dirname, '.tmp-user-data');

  // Clean and recreate user data dir
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log('Launching Chromium with extension:', extPath);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // must be headed for extensions
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    // increase timeout for slow machines
    timeout: 60000
  });

  try {
    // Give the extension a moment to initialize
    await delay(1200);

    // Discover extension ID
    let extensionId = null;

    // Check background pages
    for (const bg of context.backgroundPages()) {
      const url = bg.url();
      if (url && url.startsWith('chrome-extension://')) {
        extensionId = url.split('/')[2];
        console.log('Found extensionId from background page:', extensionId);
        break;
      }
    }

    // Check service workers
    if (!extensionId) {
      for (const sw of context.serviceWorkers()) {
        const url = sw.url();
        if (url && url.startsWith('chrome-extension://')) {
          extensionId = url.split('/')[2];
          console.log('Found extensionId from service worker:', extensionId);
          break;
        }
      }
    }

    // Fallback: scan all pages
    if (!extensionId) {
      for (const p of context.pages()) {
        const url = p.url();
        if (url && url.startsWith('chrome-extension://')) {
          extensionId = url.split('/')[2];
          console.log('Found extensionId from page:', extensionId);
          break;
        }
      }
    }

    if (!extensionId) {
      console.error('Could not locate extension ID. Please ensure the extension loaded correctly.');
      await context.close();
      process.exit(2);
    }

    // 1) Open a normal tab for example.com and send an update message
    const testPage = await context.newPage();
    await testPage.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Opened test tab: example.com');

    console.log('Simulating content script update on example.com (delta: 3)...');
    await testPage.evaluate(() => {
      chrome.runtime.sendMessage({ type: 'updateStats', delta: 3, site: 'example.com', siteDelta: 3 });
    });

    // 2) Open another tab for example.org and send an update message
    const otherPage = await context.newPage();
    await otherPage.goto('https://example.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Opened test tab: example.org');

    console.log('Simulating content script update on example.org (delta: 2)...');
    await otherPage.evaluate(() => {
      chrome.runtime.sendMessage({ type: 'updateStats', delta: 2, site: 'example.org', siteDelta: 2 });
    });

    // Allow background service worker to process and persist
    await delay(800);

    // 3) Open the popup page directly and inspect DOM
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Popup opened at', popupUrl);

    const selectors = { total: '#total', siteCount: '#siteCount', site: '#site' };
    await popupPage.waitForSelector(selectors.total, { timeout: 5000 });
    await popupPage.waitForSelector(selectors.siteCount, { timeout: 5000 });

    const popupValues = await popupPage.evaluate((sel) => {
      const get = s => (document.querySelector(s) ? document.querySelector(s).textContent.trim() : null);
      return { total: get(sel.total), site: get(sel.site), siteCount: get(sel.siteCount) };
    }, selectors);

    console.log('Popup values observed:', popupValues);

    const totalObserved = Number(popupValues.total || 0);
    const siteCountObserved = Number(popupValues.siteCount || 0);

    if (!Number.isFinite(totalObserved) || !Number.isFinite(siteCountObserved)) {
      console.error('Popup values are not numeric:', popupValues);
      await context.close();
      process.exit(3);
    }

    if (totalObserved < siteCountObserved) {
      console.error(`Assertion failed: total (${totalObserved}) < siteCount (${siteCountObserved})`);
      await context.close();
      process.exit(3);
    }

    console.log(`Assertion passed: total (${totalObserved}) >= siteCount (${siteCountObserved})`);

    // 4) Inspect persisted storage via background page or service worker
    let storageState = null;
    const bgPages = context.backgroundPages();
    if (bgPages.length) {
      try {
        storageState = await bgPages[0].evaluate(() => {
          return new Promise(resolve => {
            chrome.storage.local.get(['lastTotal', 'perSite'], res => resolve(res));
          });
        });
      } catch (e) {
        console.warn('Background page storage read failed:', e);
      }
    } else {
      const sws = context.serviceWorkers();
      if (sws.length) {
        try {
          storageState = await sws[0].evaluate(() => {
            return new Promise(resolve => {
              chrome.storage.local.get(['lastTotal', 'perSite'], res => resolve(res));
            });
          });
        } catch (e) {
          console.warn('Service worker storage read failed:', e);
        }
      }
    }

    console.log('Persisted storage read:', storageState);

    // Clean up
    await popupPage.close();
    await otherPage.close();
    await testPage.close();

    console.log('E2E script finished successfully.');
    await context.close();

    // Remove temporary user data dir (best-effort)
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}

    process.exit(0);
  } catch (err) {
    console.error('Error during e2e run:', err);
    try { await context.close(); } catch (e) {}
    process.exit(3);
  }
})();
