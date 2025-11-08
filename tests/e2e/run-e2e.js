#!/usr/bin/env node
/**
 * End-to-end Playwright test harness for the Autoplay Blocker extension.
 * 
 * Usage: node run-e2e.js <extension-path>
 * 
 * This script:
 * 1. Launches a persistent Chromium context with the extension loaded
 * 2. Simulates content-script update messages on two sites (example.com, example.org)
 * 3. Opens the extension popup via chrome-extension:// URL
 * 4. Validates popup DOM values
 * 5. Validates persisted chrome.storage.local values
 * 6. Exits with appropriate exit code (0 = success, 1 = failure)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Parse CLI arguments
const extensionPath = process.argv[2];

if (!extensionPath) {
  console.error('Error: Extension path is required');
  console.error('Usage: node run-e2e.js <extension-path>');
  process.exit(1);
}

const absoluteExtensionPath = path.resolve(extensionPath);

if (!fs.existsSync(absoluteExtensionPath)) {
  console.error(`Error: Extension path does not exist: ${absoluteExtensionPath}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(absoluteExtensionPath, 'manifest.json'))) {
  console.error(`Error: manifest.json not found in: ${absoluteExtensionPath}`);
  process.exit(1);
}

console.log(`\n🚀 Starting E2E tests for extension at: ${absoluteExtensionPath}\n`);

// Test configuration
const TEST_SITES = [
  { hostname: 'example.com' },
  { hostname: 'example.org' }
];

const SIMULATED_BLOCKS_PER_SITE = 5;

/**
 * Main test function
 */
async function runTests() {
  let browser;
  let context;
  let passed = 0;
  let failed = 0;
  
  try {
    console.log('📦 Launching Chromium with extension...');
    
    // Find system Chrome/Chromium
    const execSync = require('child_process').execSync;
    let chromePath = '/usr/bin/google-chrome';
    try {
      const whichResult = execSync('which chromium-browser || which chromium || which google-chrome', { encoding: 'utf8' });
      chromePath = whichResult.trim().split('\n')[0];
    } catch (e) {
      // Use default
    }
    
    console.log(`  Using Chrome at: ${chromePath}`);
    
    // Launch browser with extension
    context = await chromium.launchPersistentContext(
      path.join(__dirname, 'test-user-data'),
      {
        headless: false,
        executablePath: chromePath,
        args: [
          `--disable-extensions-except=${absoluteExtensionPath}`,
          `--load-extension=${absoluteExtensionPath}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ]
      }
    );

    // Wait for extension to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('✅ Browser launched with extension loaded\n');

    // Get the extension ID and service worker
    let extensionId = null;
    let serviceWorker = null;
    
    // Wait for service worker
    console.log('⏳ Waiting for extension service worker...');
    try {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
      const workerUrl = serviceWorker.url();
      console.log(`  Service worker URL: ${workerUrl}`);
      const match = workerUrl.match(/chrome-extension:\/\/([a-z]+)\//);
      if (match) {
        extensionId = match[1];
      }
    } catch (e) {
      // Try getting from existing service workers
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        serviceWorker = workers[0];
        const workerUrl = serviceWorker.url();
        const match = workerUrl.match(/chrome-extension:\/\/([a-z]+)\//);
        if (match) {
          extensionId = match[1];
        }
      }
    }

    if (!extensionId || !serviceWorker) {
      throw new Error('Failed to get extension service worker');
    }

    console.log(`📌 Extension ID: ${extensionId}\n`);

    // Test 1: Simulate content-script updates on multiple sites
    console.log('🧪 Test 1: Simulating content-script updates via service worker');
    
    for (const site of TEST_SITES) {
      console.log(`  ➤ Simulating ${SIMULATED_BLOCKS_PER_SITE} blocked autoplay events on ${site.hostname}...`);
      
      // Send messages directly to the background service worker by evaluating in its context
      for (let i = 0; i < SIMULATED_BLOCKS_PER_SITE; i++) {
        await serviceWorker.evaluate((hostname) => {
          // We're in the service worker context - simulate receiving a message
          // Call the message handler directly
          const message = {
            type: 'updateStats',
            delta: 1,
            site: hostname,
            siteDelta: 1
          };
          
          // Trigger the onMessage listener by simulating it
          chrome.runtime.onMessage.dispatch(message, {}, () => {});
        }, site.hostname);
        
        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      console.log(`  ✅ Simulated ${SIMULATED_BLOCKS_PER_SITE} blocks on ${site.hostname}`);
    }

    // Wait for messages to be processed and persisted
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('');

    // Test 2: Validate chrome.storage.local values
    console.log('🧪 Test 2: Validating chrome.storage.local values');
    
    const storageData = await serviceWorker.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['lastTotal', 'perSite'], (result) => {
          resolve(result);
        });
      });
    });

    console.log(`  Storage lastTotal: ${storageData.lastTotal}`);
    console.log(`  Storage perSite:`, storageData.perSite);

    const expectedTotal = TEST_SITES.length * SIMULATED_BLOCKS_PER_SITE;
    
    if (storageData.lastTotal === expectedTotal) {
      console.log(`  ✅ lastTotal is correct (${expectedTotal})`);
      passed++;
    } else {
      console.log(`  ❌ lastTotal is incorrect. Expected: ${expectedTotal}, Got: ${storageData.lastTotal}`);
      failed++;
    }

    // Validate per-site counts
    for (const site of TEST_SITES) {
      const siteCount = storageData.perSite[site.hostname] || 0;
      if (siteCount === SIMULATED_BLOCKS_PER_SITE) {
        console.log(`  ✅ ${site.hostname} count is correct (${SIMULATED_BLOCKS_PER_SITE})`);
        passed++;
      } else {
        console.log(`  ❌ ${site.hostname} count is incorrect. Expected: ${SIMULATED_BLOCKS_PER_SITE}, Got: ${siteCount}`);
        failed++;
      }
    }
    
    console.log('');

    // Test 3: Open popup and validate DOM values
    console.log('🧪 Test 3: Opening extension popup and validating DOM');
    
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    console.log(`  ➤ Opening popup at: ${popupUrl}`);
    
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    
    // Wait for popup to initialize and load data
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get DOM values
    const totalText = await popupPage.locator('#total').textContent();
    const siteText = await popupPage.locator('#site').textContent();
    const siteCountText = await popupPage.locator('#siteCount').textContent();

    console.log(`  Popup Total: ${totalText}`);
    console.log(`  Popup Site: ${siteText}`);
    console.log(`  Popup Site Count: ${siteCountText}`);

    // Validate total
    const popupTotal = parseInt(totalText);
    if (popupTotal === expectedTotal) {
      console.log(`  ✅ Popup total is correct (${expectedTotal})`);
      passed++;
    } else {
      console.log(`  ❌ Popup total is incorrect. Expected: ${expectedTotal}, Got: ${popupTotal}`);
      failed++;
    }

    // Since popup opens on "about:blank" or last active tab, we just verify it shows something reasonable
    console.log(`  ℹ️  Popup is displaying site: ${siteText}`);
    
    await popupPage.close();
    console.log('');

    // Test 4: Test reset functionality
    console.log('🧪 Test 4: Testing reset functionality');
    
    const resetPopupPage = await context.newPage();
    await resetPopupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click reset button
    await resetPopupPage.click('#resetBtn');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if values are reset
    const resetTotalText = await resetPopupPage.locator('#total').textContent();
    const resetSiteCountText = await resetPopupPage.locator('#siteCount').textContent();

    console.log(`  After reset - Total: ${resetTotalText}, Site Count: ${resetSiteCountText}`);

    if (resetTotalText === '0' && resetSiteCountText === '0') {
      console.log(`  ✅ Reset functionality works correctly`);
      passed++;
    } else {
      console.log(`  ❌ Reset functionality failed`);
      failed++;
    }

    // Verify storage is also reset
    const resetStorageData = await serviceWorker.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['lastTotal', 'perSite'], (result) => {
          resolve(result);
        });
      });
    });

    console.log(`  Storage after reset - lastTotal: ${resetStorageData.lastTotal}, perSite:`, resetStorageData.perSite);

    if (resetStorageData.lastTotal === 0 && Object.keys(resetStorageData.perSite || {}).length === 0) {
      console.log(`  ✅ Storage reset verified`);
      passed++;
    } else {
      console.log(`  ❌ Storage not properly reset`);
      failed++;
    }

    await resetPopupPage.close();
    console.log('');

    // Print summary
    console.log('═══════════════════════════════════════');
    console.log('📊 Test Summary');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total:  ${passed + failed}`);
    console.log('═══════════════════════════════════════\n');

    await context.close();

    if (failed > 0) {
      console.log('❌ Tests FAILED\n');
      process.exit(1);
    } else {
      console.log('✅ All tests PASSED\n');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Test execution failed with error:');
    console.error(error);
    
    if (context) {
      try {
        await context.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    process.exit(1);
  }
}

// Run tests
runTests();
