# End-to-End Tests for Autoplay Blocker Extension

This directory contains Playwright-based end-to-end tests for the Autoplay Blocker Chrome extension.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright Chromium browser (optional - will use system Chrome if available):
   ```bash
   npm run install:playwright
   ```

## Running Tests

Run the e2e tests from the project root:

```bash
npm run test:e2e
```

Or run directly with a custom extension path:

```bash
node tests/e2e/run-e2e.js <path-to-extension>
```

For headless environments, use xvfb:

```bash
xvfb-run -a npm run test:e2e
```

## What the Tests Do

The test harness (`run-e2e.js`) performs the following:

1. **Launches Chromium** with the unpacked extension loaded from the specified path
2. **Simulates content-script updates** by sending messages to the background service worker for two test sites:
   - example.com (5 simulated blocks)
   - example.org (5 simulated blocks)
3. **Validates chrome.storage.local** to ensure statistics are correctly persisted
4. **Opens the extension popup** via `chrome-extension://` URL
5. **Validates popup DOM** to ensure displayed statistics are correct
6. **Tests reset functionality** to ensure stats can be cleared
7. **Exits with appropriate exit code** (0 = success, 1 = failure)

## Test Coverage

The tests verify:
- ✅ Extension loads correctly in Chromium
- ✅ Service worker message handling
- ✅ Per-site statistics tracking
- ✅ Global statistics aggregation
- ✅ chrome.storage.local persistence
- ✅ Popup UI displays correct values
- ✅ Reset functionality works correctly

## Requirements

- Node.js 14+
- Playwright
- System Chrome/Chromium (or Playwright-installed Chromium)
- xvfb (for headless environments)

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed or an error occurred
