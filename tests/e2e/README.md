# Playwright E2E for Autoplay Blocker extension

This test script launches Chromium with your unpacked extension and performs a small E2E scenario:
- simulates content-script update messages on example.com and example.org
- opens the extension popup and verifies the UI (#total >= #siteCount)
- reads persisted chrome.storage.local (lastTotal, perSite) from the background page or service worker

Requirements:
- Node.js (14+ recommended)
- The script runs Chromium in headed mode (Playwright must install a browser).

Install and run:
1. Place the files from tests/e2e/ into your repo.
2. If you don't have package.json in the repo, add the provided package.json or merge the changes.
3. Install deps:
   npm install
   npx playwright install chromium
4. Run the script (pass the absolute path to your unpacked extension folder):
   node tests/e2e/run-e2e.js /absolute/path/to/unpacked-extension

Notes:
- The script must run in headed mode because Chrome/Chromium does not support extensions in headless mode.
- The script creates a temporary user-data-dir at `tests/e2e/.tmp-user-data` and attempts to remove it at the end.
- If the extension is slow to initialize on your machine, increase the delay near the top of the script.
