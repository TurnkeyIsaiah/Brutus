'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./helpers/fake-electron.js');

test('main process wiring', async (t) => {
  const main = loadMain();

  await t.test('registers the monitoring and capture channels', () => {
    for (const channel of ['start-monitoring', 'stop-monitoring', 'end-monitoring', 'is-monitoring',
      'get-monitoring-state', 'set-capture-intent', 'get-auth', 'set-auth', 'clear-auth', 'get-settings', 'set-settings']) {
      assert.ok(main.handlers.has(channel), `handler ${channel}`);
    }
    for (const channel of ['overlay-ready', 'capture-state', 'overlay-stopped']) {
      assert.ok(main.listeners.has(channel), `listener ${channel}`);
    }
    for (const gone of ['set-selected-source', 'get-session-mode', 'set-session-mode', 'show-settings']) {
      assert.ok(!main.handlers.has(gone), `${gone} removed`);
    }
  });

  await t.test('start is refused while signed out', () => {
    assert.deepEqual(main.invoke('start-monitoring'), { ok: false, reason: 'signed_out' });
    assert.equal(main.overlay(), undefined, 'no overlay created');
  });

  await t.test('auth is stored encrypted and read back', async () => {
    await main.invoke('set-auth', null, { token: 'tok-1', user: { id: 'u1' } });
    assert.match(main.storeData.get('authToken'), /^[A-Za-z0-9+/=]+$/);
    assert.notEqual(main.storeData.get('authToken'), 'tok-1');
    assert.deepEqual(await main.invoke('get-auth'), { token: 'tok-1', user: { id: 'u1' } });
  });

  await t.test('start creates a content-protected overlay and waits for its handshake', () => {
    assert.deepEqual(main.invoke('start-monitoring'), { ok: true });
    const overlay = main.overlay();
    assert.ok(overlay, 'overlay created');
    assert.equal(overlay.contentProtection, true);
    assert.equal(overlay.webContents.sent.length, 0, 'nothing sent before the page is ready');

    main.emit('overlay-ready', overlay.webContents);
    assert.deepEqual(overlay.webContents.sent.map(([c]) => c), ['monitoring-started']);
    assert.equal(main.invoke('get-monitoring-state'), 'live');
  });

  await t.test('only the overlay may set a capture intent, and it is used once', async () => {
    const overlay = main.overlay();
    assert.equal(main.invoke('set-capture-intent', {}, { screenSourceId: 'window:7:0', systemAudio: true }), false);
    assert.equal(main.invoke('set-capture-intent', overlay.webContents, { screenSourceId: 'window:7:0', systemAudio: true }), true);

    const first = await new Promise((resolve) => main.displayHandler({}, resolve));
    assert.equal(first.video.id, 'window:7:0');
    assert.equal(first.audio, 'loopback');
    const second = await new Promise((resolve) => main.displayHandler({}, resolve));
    assert.deepEqual(second, {}, 'no intent left: denied');
  });

  await t.test('logout-style end waits for the overlay to report the session stopped', async () => {
    const overlay = main.overlay();
    main.emit('capture-state', overlay.webContents, { state: 'live', sessionId: 's1' });
    let done = false;
    const ending = main.invoke('end-monitoring', null, { reason: 'logout' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(done, false, 'still waiting on the overlay');
    assert.deepEqual(overlay.webContents.sent.at(-1), ['monitoring-stopped', { reason: 'logout', mode: 'end' }]);
    main.emit('overlay-stopped', overlay.webContents, { sessionId: 's1', ok: true });
    await ending;
    assert.equal(done, true);
    assert.equal(main.invoke('get-monitoring-state'), 'idle');
  });

  await t.test('closing the overlay hides it instead of destroying it', () => {
    const overlay = main.overlay();
    let prevented = false;
    overlay.events.get('close')({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(overlay.destroyed, false);
  });

  await t.test('quitting mid-call ends the call before quitting', async () => {
    main.invoke('start-monitoring');
    const overlay = main.overlay();
    main.emit('capture-state', overlay.webContents, { state: 'live', sessionId: 's2' });
    let prevented = false;
    main.appEvents.get('before-quit')({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'quit held back');
    assert.equal(main.quitCalls || 0, 0);
    main.emit('overlay-stopped', overlay.webContents, { sessionId: 's2', ok: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(main.quitCalls, 1, 'quit resumed after the call ended');
  });
});
