// Launches the real Electron app (no backend, no signed-in user) and checks the
// shipped pages load cleanly with the security settings in place. Runs on the
// Windows CI runner before any release is built: npm run test:smoke
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { _electron: electron } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '../..');
const MAIN_BRIDGE = [
  'appInfo', 'clearAuth', 'endMonitoring', 'getAuth', 'getMonitoringState', 'getSettings',
  'isMonitoring', 'onAuthCleared', 'onMonitoringFinished', 'onMonitoringStarted',
  'onMonitoringStopped', 'openExternal', 'setAuth', 'setLilBrutusSession',
  'setLilBrutusVisible', 'setSettings', 'startMonitoring', 'stopMonitoring'
];

// Signed-out pages call the API and get 401s; that is expected here.
const EXPECTED = /Failed to load resource: .*(401|403)|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/;

test('the desktop app starts cleanly and stays locked down', { timeout: 120000 }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brutus-smoke-'));
  const app = await electron.launch({
    args: [APP_DIR],
    env: { ...process.env, BRUTUS_USER_DATA: profile }
  });
  const problems = [];
  const watch = (page, name) => {
    page.on('pageerror', (err) => problems.push(`[${name}] page error: ${err.message}`));
    page.on('console', (msg) => {
      const text = msg.text();
      if (/Content Security Policy|Refused to/.test(text)) problems.push(`[${name}] CSP: ${text.slice(0, 200)}`);
      else if (msg.type() === 'error' && !EXPECTED.test(text)) problems.push(`[${name}] ${text.slice(0, 200)}`);
    });
    page.on('request', (req) => {
      if (req.resourceType() === 'script' && !req.url().startsWith('file:')) {
        problems.push(`[${name}] remote script: ${req.url()}`);
      }
    });
  };

  try {
    const main = await app.firstWindow();
    watch(main, 'main');
    await main.waitForLoadState('load');
    assert.equal(await main.title(), 'Brutus');

    const csp = await main.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(inline|eval)'/, 'no inline or eval scripts');

    assert.deepEqual(await main.evaluate(() => Object.keys(window.brutus).sort()), MAIN_BRIDGE);
    assert.equal(await main.evaluate(() => typeof window.require), 'undefined', 'no Node in the page');
    assert.equal(await main.evaluate(() => window.brutus.appInfo.packaged), false);

    const start = await main.evaluate(() => window.brutus.startMonitoring());
    assert.deepEqual(start, { ok: false, reason: 'signed_out' }, 'monitoring refused while signed out');

    const denied = await main.evaluate(() => window.brutus.setSettings({ apiUrl: 'https://evil.example' }).then(() => 'saved', () => 'refused'));
    assert.equal(denied, 'refused', 'API URL restricted');

    const analytics = await main.evaluate(() => !!(window.posthog && window.posthog.__loaded));
    assert.equal(analytics, true, 'analytics loads from the local bundle');

    // Lil Brutus opens by default for a fresh profile.
    let mascot = null;
    for (let i = 0; i < 40 && !mascot; i++) {
      mascot = app.windows().find((p) => p.url().endsWith('lil-brutus.html')) || null;
      if (!mascot) await new Promise((r) => setTimeout(r, 250));
    }
    if (mascot) {
      watch(mascot, 'mascot');
      await mascot.waitForLoadState('load');
      assert.deepEqual(await mascot.evaluate(() => Object.keys(window.brutus).sort()),
        ['beginLilBrutusGesture', 'clipLilBrutus', 'endLilBrutusGesture', 'onLilBrutusSession']);
    }

    await main.waitForTimeout(1500);
    assert.deepEqual(problems, [], problems.join('\n'));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
