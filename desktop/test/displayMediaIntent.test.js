'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIntentStore, resolveDisplayMedia, INTENT_TTL_MS } = require('../src/displayMediaIntent.js');

const sources = [
  { id: 'screen:0:0', name: 'Entire screen' },
  { id: 'window:7:0', name: 'Zoom Meeting' },
  { id: 'window:9:0', name: 'Brutus live coaching' }
];

test('a request without an intent is denied (no fallback to the first screen)', () => {
  assert.deepEqual(resolveDisplayMedia(null, sources, 'window:9:0'), {});
});

test('a picked window is captured with the computer audio', () => {
  const out = resolveDisplayMedia({ screenSourceId: 'window:7:0', systemAudio: true }, sources, 'window:9:0');
  assert.equal(out.video.id, 'window:7:0');
  assert.equal(out.audio, 'loopback');
});

test('a picked window that has closed is denied, not swapped for another source', () => {
  assert.deepEqual(resolveDisplayMedia({ screenSourceId: 'window:404:0', systemAudio: true }, sources, null), {});
});

test('audio-only uses the overlay window as the carrier, else a screen', () => {
  const a = resolveDisplayMedia({ screenSourceId: null, systemAudio: true }, sources, 'window:9:0');
  assert.equal(a.video.id, 'window:9:0');
  assert.equal(a.audio, 'loopback');
  const b = resolveDisplayMedia({ screenSourceId: null, systemAudio: true }, sources, 'window:missing');
  assert.equal(b.video.id, 'screen:0:0');
});

test('re-enabling the screen mid-call asks for video only', () => {
  const out = resolveDisplayMedia({ screenSourceId: 'window:7:0', systemAudio: false }, sources, null);
  assert.equal(out.video.id, 'window:7:0');
  assert.equal(out.audio, undefined);
});

test('an intent is used once and expires', () => {
  let now = 1000;
  const store = createIntentStore({ now: () => now });
  assert.equal(store.set({ screenSourceId: 'window:7:0', systemAudio: true }), true);
  assert.deepEqual(store.take(), { screenSourceId: 'window:7:0', systemAudio: true });
  assert.equal(store.take(), null, 'one shot');

  store.set({ screenSourceId: null, systemAudio: true });
  now += INTENT_TTL_MS + 1;
  assert.equal(store.take(), null, 'stale intent ignored');
});

test('empty or malformed intents are refused', () => {
  const store = createIntentStore();
  assert.equal(store.set({ screenSourceId: '', systemAudio: false }), false);
  assert.equal(store.set('window:7:0'), false);
  assert.equal(store.take(), null);
});
