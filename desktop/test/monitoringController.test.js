'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMonitoringController } = require('../src/monitoringController.js');

function harness(overrides) {
  const sent = [];
  const ended = [];
  const changes = [];
  const finished = [];
  let ready = true;
  let authed = true;
  const ctl = createMonitoringController(Object.assign({
    showOverlay: () => sent.push(['show']),
    sendToOverlay: (channel, payload) => sent.push([channel, payload]),
    isOverlayReady: () => ready,
    hasAuth: () => authed,
    endSessionRemote: async (id) => { ended.push(id); },
    onChange: (state) => changes.push(state),
    onFinished: (info) => finished.push(info),
    stopTimeoutMs: 50
  }, overrides || {}));
  return {
    ctl, sent, ended, changes, finished,
    setReady(v) { ready = v; },
    setAuthed(v) { authed = v; },
    channels: () => sent.map(([c]) => c)
  };
}

test('start requires a signed-in user', () => {
  const h = harness();
  h.setAuthed(false);
  assert.deepEqual(h.ctl.start(), { ok: false, reason: 'signed_out' });
  assert.equal(h.ctl.state(), 'idle');
  assert.equal(h.sent.length, 0);
});

test('a start requested while the overlay loads is delivered once, when it is ready', () => {
  const h = harness();
  h.setReady(false);
  h.ctl.start();
  assert.ok(!h.channels().includes('monitoring-started'));
  h.setReady(true);
  h.ctl.overlayReady();
  h.ctl.overlayReady();
  assert.equal(h.channels().filter((c) => c === 'monitoring-started').length, 1);
});

test('requestStop resolves when the overlay reports it stopped', async () => {
  const h = harness();
  h.ctl.start();
  h.ctl.onCaptureState({ state: 'live', sessionId: 's1' });
  const stopping = h.ctl.requestStop({ reason: 'logout' });
  assert.equal(h.ctl.state(), 'stopping');
  assert.deepEqual(h.sent.at(-1), ['monitoring-stopped', { reason: 'logout', mode: 'end' }]);
  h.ctl.onOverlayStopped({ sessionId: 's1', ok: true });
  const info = await stopping;
  assert.equal(info.stopped, true);
  assert.equal(h.ctl.state(), 'idle');
  assert.equal(h.finished.length, 1);
});

test('concurrent stop requests share one promise', () => {
  const h = harness();
  h.ctl.start();
  const a = h.ctl.requestStop({});
  const b = h.ctl.requestStop({ reason: 'quit' });
  assert.equal(a, b);
  assert.equal(h.channels().filter((c) => c === 'monitoring-stopped').length, 1);
});

test('requestStop times out if the overlay never answers', async () => {
  const h = harness();
  h.ctl.start();
  const info = await h.ctl.requestStop({});
  assert.equal(info.timedOut, true);
  assert.equal(h.ctl.state(), 'idle');
});

test('start is refused while the previous call is still being saved', () => {
  const h = harness();
  h.ctl.start();
  h.ctl.requestStop({});
  assert.deepEqual(h.ctl.start(), { ok: false, reason: 'stopping' });
});

test('needsStop covers an overlay that is still consenting or stopping on its own', () => {
  const h = harness();
  assert.equal(h.ctl.needsStop(), false);
  h.ctl.onCaptureState({ state: 'consenting', sessionId: null });
  assert.equal(h.ctl.needsStop(), true);
});

test('when the overlay renderer dies, the session is ended from main', async () => {
  const h = harness();
  h.ctl.start();
  h.ctl.onCaptureState({ state: 'live', sessionId: 's9' });
  h.ctl.onOverlayGone();
  await Promise.resolve();
  assert.deepEqual(h.ended, ['s9']);
  assert.equal(h.ctl.state(), 'idle');
  assert.equal(h.ctl.needsStop(), false);
});

test('an overlay that stops on its own (failed start, billing) resets main', () => {
  const h = harness();
  h.ctl.start();
  h.ctl.onOverlayStopped({ sessionId: null, ok: true, reason: 'billing' });
  assert.equal(h.ctl.state(), 'idle');
  assert.equal(h.finished.length, 1);
});

test('stopping with no overlay loaded resolves immediately', async () => {
  const h = harness();
  h.ctl.start();
  h.setReady(false);
  const info = await h.ctl.requestStop({});
  assert.equal(info.noOverlay, true);
});
