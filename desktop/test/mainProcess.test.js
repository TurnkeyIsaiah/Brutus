'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./helpers/fake-electron.js');

test('main process wiring', async (t) => {
  const main = await loadMain();
  const mainContents = () => main.mainWin().webContents;
  const overlayContents = () => main.overlay().webContents;

  await t.test('the main window uses its own preload, sandboxed, with navigation locked', () => {
    const win = main.mainWin();
    assert.ok(win, 'main window created on ready');
    const prefs = win.options.webPreferences;
    assert.match(prefs.preload, /preload-main\.js$/);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.ok(prefs.additionalArguments.some((a) => a.startsWith('--brutus-app-info=')));
    assert.equal(win.webContents.openHandler({ url: 'https://stripe.com/x' }).action, 'deny');
    assert.deepEqual(main.opened, ['https://stripe.com/x'], 'https links go to the system browser');
  });

  await t.test('registers the monitoring and capture channels and drops the unused ones', () => {
    for (const channel of ['start-monitoring', 'stop-monitoring', 'end-monitoring', 'is-monitoring',
      'get-monitoring-state', 'set-capture-intent', 'get-auth', 'set-auth', 'clear-auth', 'get-settings', 'set-settings']) {
      assert.ok(main.handlers.has(channel), `handler ${channel}`);
    }
    for (const channel of ['overlay-ready', 'capture-state', 'overlay-stopped']) {
      assert.ok(main.listeners.has(channel), `listener ${channel}`);
    }
    for (const gone of ['set-selected-source', 'get-session-mode', 'set-session-mode', 'show-settings',
      'minimize-window', 'close-window', 'quit-app', 'show-overlay', 'get-overlay-bounds', 'move-overlay',
      'resize-overlay', 'open-dashboard']) {
      assert.ok(!main.handlers.has(gone), `${gone} removed`);
    }
  });

  await t.test('a message from a window or frame that is not ours is refused', async () => {
    await main.invoke('set-auth', mainContents(), { token: 'tok-1', user: { id: 'u1' } });
    assert.equal(await main.invoke('get-auth', { url: 'file:///elsewhere/index.html' }), undefined, 'unknown sender');
    assert.equal(await main.invokeWithFrame('get-auth', mainContents(), 'https://evil.example/'), undefined, 'navigated frame');
    assert.equal(await main.invokeWithFrame('get-auth', mainContents(), null), undefined, 'dead frame');
    assert.deepEqual(await main.invoke('get-auth', mainContents()), { token: 'tok-1', user: { id: 'u1' } });
  });

  await t.test('auth is stored encrypted', () => {
    assert.notEqual(main.storeData.get('authToken'), 'tok-1');
    assert.match(main.storeData.get('authToken'), /^[A-Za-z0-9+/=]+$/);
  });

  await t.test('start creates a content-protected, locked-down overlay and waits for its handshake', () => {
    assert.deepEqual(main.invoke('start-monitoring', mainContents()), { ok: true });
    const overlay = main.overlay();
    assert.ok(overlay, 'overlay created');
    assert.equal(overlay.contentProtection, true);
    assert.match(overlay.options.webPreferences.preload, /preload-overlay\.js$/);
    assert.equal(overlay.webContents.sent.length, 0, 'nothing sent before the page is ready');

    let prevented = false;
    overlay.webContents.events.get('will-navigate')({ preventDefault: () => { prevented = true; } }, 'https://evil.example/');
    assert.equal(prevented, true, 'overlay cannot navigate away');
    assert.equal(overlay.webContents.openHandler({ url: 'https://evil.example/' }).action, 'deny');

    main.emit('overlay-ready', overlayContents());
    assert.deepEqual(overlay.webContents.sent.map(([c]) => c), ['monitoring-started']);
    assert.equal(main.invoke('get-monitoring-state', mainContents()), 'live');
  });

  await t.test('only the overlay may set a capture intent, and it is used once', async () => {
    const intent = { screenSourceId: 'window:7:0', systemAudio: true };
    assert.equal(main.invoke('set-capture-intent', mainContents(), intent), undefined, 'main window refused');
    assert.equal(main.invoke('set-capture-intent', overlayContents(), intent), true);

    const first = await new Promise((resolve) => main.displayHandler({}, resolve));
    assert.equal(first.video.id, 'window:7:0');
    assert.equal(first.audio, 'loopback');
    const second = await new Promise((resolve) => main.displayHandler({}, resolve));
    assert.deepEqual(second, {}, 'no intent left: denied');
  });

  await t.test('the overlay cannot read screen sources through the main window channels and vice versa', async () => {
    assert.equal(await main.invoke('get-screen-sources', mainContents()), undefined);
    assert.equal((await main.invoke('get-screen-sources', overlayContents())).length, 2);
    assert.equal(await main.invoke('set-auth', overlayContents(), { token: 'x', user: {} }), undefined);
  });

  await t.test('permissions: microphone for main and overlay, screen capture for the overlay only', () => {
    const ask = (contents, permission) => new Promise((resolve) =>
      main.permission.request(contents, permission, resolve, { requestingUrl: contents.url }));
    return Promise.all([
      ask(mainContents(), 'media').then((v) => assert.equal(v, true)),
      ask(overlayContents(), 'media').then((v) => assert.equal(v, true)),
      ask(mainContents(), 'display-capture').then((v) => assert.equal(v, false)),
      ask(overlayContents(), 'display-capture').then((v) => assert.equal(v, true)),
      ask(mainContents(), 'geolocation').then((v) => assert.equal(v, false)),
      ask(mainContents(), 'notifications').then((v) => assert.equal(v, false))
    ]);
  });

  await t.test('logout-style end waits for the overlay to report the session stopped', async () => {
    main.emit('capture-state', overlayContents(), { state: 'live', sessionId: 's1' });
    let done = false;
    const ending = main.invoke('end-monitoring', mainContents(), { reason: 'logout' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(done, false, 'still waiting on the overlay');
    assert.deepEqual(main.overlay().webContents.sent.at(-1), ['monitoring-stopped', { reason: 'logout', mode: 'end' }]);
    main.emit('overlay-stopped', overlayContents(), { sessionId: 's1', ok: true });
    await ending;
    assert.equal(done, true);
    assert.equal(main.invoke('get-monitoring-state', mainContents()), 'idle');
  });

  await t.test('settings: only known keys are kept, and the API URL is restricted', async () => {
    await main.invoke('set-settings', mainContents(), { overlayOpacity: 0.8, evil: 'x', autoStart: 'yes' });
    const saved = main.storeData.get('settings');
    assert.equal(saved.overlayOpacity, 0.8);
    assert.equal('evil' in saved, false);
    assert.equal(saved.autoStart, false, 'wrong type ignored');

    await assert.rejects(main.invoke('set-settings', mainContents(), { apiUrl: 'https://evil.example' }));
    await assert.rejects(main.invoke('set-settings', mainContents(), { apiUrl: 'http://api.brutusai.coach' }));
    await main.invoke('set-settings', mainContents(), { apiUrl: 'http://localhost:3101' });
    assert.equal(main.storeData.get('settings').apiUrl, 'http://localhost:3101', 'dev builds may use a local backend');
  });

  await t.test('closing the overlay hides it instead of destroying it', () => {
    const overlay = main.overlay();
    let prevented = false;
    overlay.events.get('close')({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(overlay.destroyed, false);
  });

  await t.test('quitting mid-call ends the call before quitting', async () => {
    await main.invoke('set-auth', mainContents(), { token: 'tok-2', user: { id: 'u1' } });
    main.invoke('start-monitoring', mainContents());
    main.emit('capture-state', overlayContents(), { state: 'live', sessionId: 's2' });
    let prevented = false;
    main.appEvents.get('before-quit')({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'quit held back');
    assert.equal(main.quitCalls || 0, 0);
    main.emit('overlay-stopped', overlayContents(), { sessionId: 's2', ok: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(main.quitCalls, 1, 'quit resumed after the call ended');
  });
});

test('an installed (packaged) app only talks to the production API', async () => {
  const main = await loadMain({ packaged: true });
  const contents = main.mainWin().webContents;
  assert.equal(main.mainWin().options.webPreferences.devTools, false, 'no DevTools in the installed app');
  await assert.rejects(main.invoke('set-settings', contents, { apiUrl: 'http://localhost:3101' }));
  main.storeData.set('settings', { apiUrl: 'http://attacker.example' }); // left by an old build
  assert.equal((await main.invoke('get-settings', contents)).apiUrl, 'https://api.brutusai.coach');
});
