'use strict';

// Main's decision to record a call: Settings, sign-in, the server, disk space.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecordingService, MIN_FREE_FOR_VIDEO } = require('../src/recordings/recordingService');

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SESSION = '11111111-2222-3333-4444-555555555555';
const GB = 1024 * 1024 * 1024;

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brutus-svc-'));
  dirs.push(dir);
  const settings = Object.assign({ recordCalls: true, recordVideo: true }, opts.settings || {});
  const configCalls = [];
  const svc = createRecordingService({
    dir: path.join(dir, 'recordings'),
    fetch: async (url) => {
      configCalls.push(url);
      if (opts.server === 'old') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ enabled: opts.server !== 'off' }) };
    },
    readSettings: () => settings,
    getAuth: () => (opts.signedOut ? null : { token: 't', userId: 'u1' }),
    getApiUrl: () => 'https://api.test',
    freeBytes: () => (opts.free === undefined ? 50 * GB : opts.free),
    fixWebm: async () => null,
    log: () => {},
    timers: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} }
  });
  return { svc, configCalls, dir };
}

test('records with video when a window is shared and everything allows it', async () => {
  const { svc } = setup();
  const res = await svc.begin({ sessionId: SESSION, wantVideo: true });
  assert.deepEqual(res, { ok: true, id: SESSION, video: true });
  svc.data({ id: SESSION, data: new Uint8Array([1, 2, 3]).buffer });
  assert.equal(fs.statSync(svc.store.mediaPath(SESSION)).size, 3);
  assert.equal(svc.end({ id: SESSION, durationMs: 1000, startOffsetMs: 20, hasVideo: true }), true, 'end returns at once');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(svc.store.get(SESSION).state, 'ready');
});

test('off in Settings, signed out, or the server without recordings: no recording', async () => {
  assert.equal((await setup({ settings: { recordCalls: false } }).svc.begin({ sessionId: SESSION })).reason, 'off');
  assert.equal((await setup({ signedOut: true }).svc.begin({ sessionId: SESSION })).reason, 'signed_out');
  assert.equal((await setup({ server: 'off' }).svc.begin({ sessionId: SESSION })).reason, 'unavailable');
  assert.equal((await setup({ server: 'old' }).svc.begin({ sessionId: SESSION })).reason, 'unavailable', 'a backend from before recordings');
});

test('low disk: audio only below 3 GB free, nothing below 500 MB', async () => {
  const tight = await setup({ free: MIN_FREE_FOR_VIDEO - 1 }).svc.begin({ sessionId: SESSION, wantVideo: true });
  assert.deepEqual([tight.ok, tight.video], [true, false]);
  const full = await setup({ free: 100 * 1024 * 1024 }).svc.begin({ sessionId: SESSION, wantVideo: true });
  assert.deepEqual([full.ok, full.reason], [false, 'disk']);
  const novideo = await setup({ settings: { recordVideo: false } }).svc.begin({ sessionId: SESSION, wantVideo: true });
  assert.equal(novideo.video, false);
});

test('the server is asked once (warm at Start), not on every call', async () => {
  const { svc, configCalls } = setup();
  svc.warm();
  await new Promise((r) => setTimeout(r, 5));
  await svc.begin({ sessionId: SESSION, wantVideo: false });
  assert.equal(configCalls.length, 1);
});

test('pieces for a recording that is not open are refused (the overlay stops writing)', () => {
  const { svc } = setup();
  assert.throws(() => svc.data({ id: SESSION, data: new Uint8Array([1]).buffer }));
  assert.throws(() => svc.data({ id: '../../evil', data: new Uint8Array([1]).buffer }));
});

test('the overlay record button overrides "Record calls" being off, and nothing else', async () => {
  const manual = await setup({ settings: { recordCalls: false } }).svc.begin({ sessionId: SESSION, wantVideo: false, manual: true });
  assert.deepEqual([manual.ok, manual.video], [true, false]);
  assert.equal((await setup({ settings: { recordCalls: false }, signedOut: true }).svc.begin({ sessionId: SESSION, manual: true })).reason, 'signed_out');
  assert.equal((await setup({ settings: { recordCalls: false }, server: 'off' }).svc.begin({ sessionId: SESSION, manual: true })).reason, 'unavailable');
});

test('the stretches the rep switched recording off are kept with the file for the upload', async () => {
  const { svc } = setup();
  await svc.begin({ sessionId: SESSION, wantVideo: false });
  svc.data({ id: SESSION, data: new Uint8Array([1, 2, 3]).buffer });
  svc.end({ id: SESSION, durationMs: 30000, startOffsetMs: 0, hasVideo: false, pauses: [{ startMs: 20000, endMs: 25000 }, { startMs: 5000, endMs: 9000 }, { startMs: 'x' }] });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(svc.store.get(SESSION).pauses, [{ startMs: 5000, endMs: 9000 }, { startMs: 20000, endMs: 25000 }]);
});
