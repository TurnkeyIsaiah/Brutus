'use strict';

// Recording store (disk) + uploader (backend + resumable storage upload),
// against a fake backend and a fake TUS server. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecordingStore } = require('../src/recordings/recordingStore');
const { createUploader, BACKOFF_MS } = require('../src/recordings/uploader');

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brutus-rec-'));
  dirs.push(dir);
  return dir;
}

const SESSION = '11111111-2222-3333-4444-555555555555';
const API = 'https://api.test';
const TUS = 'https://ref.storage.supabase.co/storage/v1/upload/resumable';

function res(status, body, headers) {
  const h = Object.assign({}, headers || {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (h[name.toLowerCase()] !== undefined ? String(h[name.toLowerCase()]) : null) },
    json: async () => body
  };
}

// The backend's recording routes + Supabase TUS, in memory.
function createServer() {
  const server = {
    calls: new Map([['call-1', { id: 'call-1', userId: 'user-1', sessionId: SESSION, recording: null }]]),
    sessions: new Map([[SESSION, { status: 'completed' }]]),
    uploads: new Map(), // url -> { length, data: Buffer }
    stored: new Map(),  // objectName -> Buffer
    log: [],
    offline: false,
    failPatchAfter: null, // drop the connection after N successful PATCHes
    patches: 0,
    chunkSize: 10
  };
  server.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    server.log.push(`${method} ${url.replace(API, '').replace(TUS, 'TUS')}`);
    if (server.offline) throw new TypeError('fetch failed');
    const headers = init.headers || {};
    if (url === `${API}/calls/recordings/upload`) {
      const body = JSON.parse(init.body);
      if (headers.Authorization !== 'Bearer token-1') return res(401, { error: { code: 'UNAUTHORIZED' } });
      const call = [...server.calls.values()].find((c) => c.sessionId === body.sessionId);
      if (!call) {
        const sess = server.sessions.get(body.sessionId);
        return sess && sess.status === 'active'
          ? res(409, { error: { code: 'SESSION_ACTIVE' } })
          : res(404, { error: { code: 'NO_CALL' } });
      }
      if (call.recording && call.recording.status === 'ready') return res(200, { callId: call.id, alreadyUploaded: true });
      call.recording = { status: 'uploading', bytes: body.bytes, path: `user-1/${call.id}.webm` };
      return res(200, {
        callId: call.id,
        upload: { endpoint: TUS, bucket: 'call-recordings', objectName: call.recording.path, token: 'sig', contentType: 'audio/webm', chunkSize: server.chunkSize }
      });
    }
    let m = /\/calls\/([^/]+)\/recording\/complete$/.exec(url);
    if (m) {
      const call = server.calls.get(decodeURIComponent(m[1]));
      const stored = call && server.stored.get(call.recording.path);
      if (!stored) return res(409, { error: { code: 'NOT_UPLOADED' } });
      if (stored.length !== call.recording.bytes) return res(409, { error: { code: 'SIZE_MISMATCH' } });
      call.recording.status = 'ready';
      return res(200, { recording: { status: 'ready' } });
    }
    if (url === `${API}/live/end`) {
      const body = JSON.parse(init.body);
      server.sessions.set(body.sessionId, { status: 'completed' });
      server.calls.set('call-2', { id: 'call-2', userId: 'user-1', sessionId: body.sessionId, recording: null });
      return res(200, { callId: 'call-2' });
    }
    if (url === TUS && method === 'POST') {
      assert.equal(headers['x-signature'], 'sig');
      const meta = Object.fromEntries(headers['Upload-Metadata'].split(',').map((kv) => {
        const [k, v] = kv.split(' ');
        return [k, Buffer.from(v, 'base64').toString()];
      }));
      const loc = `/storage/v1/upload/resumable/${server.uploads.size + 1}`;
      server.uploads.set(`https://ref.storage.supabase.co${loc}`, { length: Number(headers['Upload-Length']), data: Buffer.alloc(0), objectName: meta.objectName });
      return res(201, null, { location: loc });
    }
    const up = server.uploads.get(url);
    if (up && method === 'HEAD') return res(200, null, { 'upload-offset': up.data.length, 'upload-length': up.length });
    if (up && method === 'PATCH') {
      if (server.failPatchAfter !== null && server.patches >= server.failPatchAfter) {
        server.failPatchAfter = null;
        throw new TypeError('socket hang up');
      }
      const offset = Number(headers['Upload-Offset']);
      if (offset !== up.data.length) return res(409, null);
      up.data = Buffer.concat([up.data, init.body]);
      server.patches += 1;
      if (up.data.length === up.length) server.stored.set(up.objectName, up.data);
      return res(204, null, { 'upload-offset': up.data.length });
    }
    return res(404, {});
  };
  return server;
}

function setup(opts = {}) {
  const dir = tempDir();
  const store = createRecordingStore({ dir, fixWebm: async () => ({ durationMs: 5000, hasVideo: false }) });
  const server = createServer();
  let now = 1000000;
  const statuses = [];
  const auth = { token: 'token-1', userId: 'user-1', ...(opts.auth || {}) };
  const uploader = createUploader({
    store,
    fetch: server.fetch,
    getAuth: () => auth,
    getApiUrl: () => API,
    onChange: (s) => statuses.push(s),
    timers: { now: () => now, setTimeout: () => 0, clearTimeout: () => {} }
  });
  return { dir, store, server, uploader, statuses, auth, advance: (ms) => { now += ms; } };
}

async function record(store, bytes, extra) {
  store.begin({ sessionId: SESSION, userId: 'user-1', apiUrl: API, wantVideo: false });
  store.append(SESSION, Buffer.from(bytes));
  await store.finish(SESSION, Object.assign({ durationMs: 5000, startOffsetMs: 300 }, extra || {}));
}

test('a finished recording uploads in chunks, is confirmed, then deleted from disk', async () => {
  const { store, server, uploader, statuses } = setup();
  const content = 'x'.repeat(35);
  await record(store, content);
  assert.equal(store.get(SESSION).state, 'ready');
  assert.equal(store.get(SESSION).startOffsetMs, 300);

  await uploader._run();
  assert.equal(server.stored.get('user-1/call-1.webm').toString(), content);
  assert.equal(server.patches, 4, '35 bytes in 10-byte chunks');
  assert.equal(server.calls.get('call-1').recording.status, 'ready');
  assert.equal(fs.existsSync(store.mediaPath(SESSION)), false, 'local copy deleted after the confirmed upload');
  assert.equal(store.list().length, 0);
  assert.ok(statuses.some((list) => list.some((s) => s.state === 'uploading' && s.sent > 0)), 'progress was reported');
});

test('offline: nothing is deleted, it waits with backoff and then uploads', async () => {
  const { store, server, uploader, advance } = setup();
  await record(store, 'abcdefghijklmnopqrstuvwxyz');
  server.offline = true;
  await uploader._run();
  assert.ok(fs.existsSync(store.mediaPath(SESSION)));
  assert.equal(uploader.status()[0].reason, 'offline');

  server.offline = false;
  const before = server.log.length;
  await uploader._run();
  assert.equal(server.log.length, before, 'no retry before the backoff has passed');
  advance(BACKOFF_MS[0] + 1);
  await uploader._run();
  assert.equal(server.stored.get('user-1/call-1.webm').toString(), 'abcdefghijklmnopqrstuvwxyz');
  assert.equal(store.list().length, 0);
});

test('a dropped connection resumes from where the server got to, never from zero', async () => {
  const { store, server, uploader, advance } = setup();
  const content = '0123456789abcdefghijklmnopqrstuvwxyz'; // 36 bytes: 4 chunks
  await record(store, content);
  server.failPatchAfter = 2; // two chunks land, then the network drops
  await uploader._run();
  assert.ok(store.get(SESSION).upload.url, 'upload url saved for resuming');
  assert.equal([...server.uploads.values()][0].data.length, 20);

  advance(BACKOFF_MS[0] + 1);
  await uploader._run();
  assert.equal(server.uploads.size, 1, 'the same upload was resumed, not a new one');
  assert.equal(server.patches, 4, 'each chunk sent once');
  assert.ok(server.log.some((l) => l.startsWith('HEAD ')), 'asked the server for its offset');
  assert.equal(server.stored.get('user-1/call-1.webm').toString(), content);
});

test('a resumed upload survives an app restart (a new uploader on the same files)', async () => {
  const first = setup();
  await record(first.store, 'z'.repeat(30));
  first.server.failPatchAfter = 1;
  await first.uploader._run();
  // New launch: same folder, same server.
  const store = createRecordingStore({ dir: first.dir, fixWebm: async () => null });
  await store.recover();
  const uploader = createUploader({
    store,
    fetch: first.server.fetch,
    getAuth: () => first.auth,
    getApiUrl: () => API,
    timers: { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => {} }
  });
  await uploader._run();
  assert.equal(first.server.stored.get('user-1/call-1.webm').length, 30);
  assert.equal(store.list().length, 0);
});

test('no saved call for the recording (cancelled or too short): the local file is deleted', async () => {
  const { store, server, uploader } = setup();
  server.calls.clear();
  await record(store, 'abc');
  await uploader._run();
  assert.equal(store.list().length, 0);
  assert.equal(server.stored.size, 0);
});

test('signed in as another account (or signed out): the recording waits, untouched', async () => {
  const other = setup({ auth: { userId: 'user-2' } });
  await record(other.store, 'abc');
  await other.uploader._run();
  assert.equal(other.server.log.length, 0, 'nothing sent with the wrong account');
  assert.equal(other.store.list().length, 1);
  assert.equal(other.uploader.status()[0].reason, 'another account');
});

test('a crash left the session open: it is ended (call saved), then the recording uploads', async () => {
  const { store, server, uploader, advance } = setup();
  server.calls.clear();
  server.sessions.set(SESSION, { status: 'active' });
  store.begin({ sessionId: SESSION, userId: 'user-1', apiUrl: API, wantVideo: false });
  store.append(SESSION, Buffer.from('crash-recording'));
  // The app dies here. Next launch:
  const relaunched = createRecordingStore({ dir: store.dir, fixWebm: async () => null });
  // (the old process held the file open; a new process sees it as not open)
  assert.deepEqual(await relaunched.recover(), [SESSION]);
  assert.equal(relaunched.get(SESSION).crashRecovered, true);
  const up = createUploader({
    store: relaunched,
    fetch: server.fetch,
    getAuth: () => ({ token: 'token-1', userId: 'user-1' }),
    getApiUrl: () => API,
    timers: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} }
  });
  await up._run();
  assert.ok(server.log.includes('POST /live/end'));
  await up._run();
  assert.equal(server.stored.get('user-1/call-2.webm').toString(), 'crash-recording');
  void uploader; void advance;
});

test('the server not having the whole file restarts the upload instead of deleting', async () => {
  const { store, server, uploader, advance } = setup();
  await record(store, 'abcdefghij');
  const realFetch = server.fetch;
  let lie = true;
  server.fetch = async (url, init) => {
    if (lie && /recording\/complete$/.test(url)) { lie = false; return res(409, { error: { code: 'SIZE_MISMATCH' } }); }
    return realFetch(url, init);
  };
  let clock = 0;
  const up = createUploader({
    store,
    fetch: (u, i) => server.fetch(u, i),
    getAuth: () => ({ token: 'token-1', userId: 'user-1' }),
    getApiUrl: () => API,
    timers: { now: () => clock, setTimeout: () => 0, clearTimeout: () => {} }
  });
  await up._run();
  assert.equal(store.list().length, 1, 'kept after the incomplete answer');
  assert.equal(store.get(SESSION).upload.url, null, 'next try starts a fresh upload');
  clock += BACKOFF_MS[0] + 1;
  await up._run();
  assert.equal(store.list().length, 0);
  void uploader; void advance;
});

test('right after Stop the call is still being saved: the recording waits, it is never deleted', async () => {
  const { store, server, uploader, advance } = setup();
  const call = server.calls.get('call-1');
  server.calls.clear(); // analysis still running: the session ended, no call row yet
  const realFetch = server.fetch;
  server.fetch = async (url, init) => {
    if (url === `${API}/calls/recordings/upload` && !server.calls.size) {
      return res(409, { error: { code: 'CALL_SAVING' } });
    }
    return realFetch(url, init);
  };
  const up = createUploader({
    store,
    fetch: (u, i) => server.fetch(u, i),
    getAuth: () => ({ token: 'token-1', userId: 'user-1' }),
    getApiUrl: () => API,
    timers: { now: () => clock, setTimeout: () => 0, clearTimeout: () => {} }
  });
  let clock = 0;
  await record(store, 'saved-later');
  await up._run();
  assert.equal(store.list().length, 1, 'kept while the call saves');
  assert.equal(up.status()[0].reason, 'call still saving');
  server.calls.set('call-1', call); // analysis done, call saved
  clock += 16000;
  await up._run();
  assert.equal(server.stored.get('user-1/call-1.webm').toString(), 'saved-later');
  assert.equal(store.list().length, 0);
  void uploader; void advance;
});

test('a recording whose call is still live or stopping is not touched until the call finishes', async () => {
  const dir = tempDir();
  const store = createRecordingStore({ dir, fixWebm: async () => null });
  const server = createServer();
  let live = true;
  const up = createUploader({
    store,
    fetch: server.fetch,
    getAuth: () => ({ token: 'token-1', userId: 'user-1' }),
    getApiUrl: () => API,
    isLiveSession: () => live,
    timers: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} }
  });
  await record(store, 'abc');
  await up._run();
  assert.equal(server.log.length, 0, 'no request while the call is still ending');
  live = false;
  await up._run();
  assert.equal(store.list().length, 0);
});

test('a cancelled call (recording thrown away) and an empty file leave nothing behind', async () => {
  const { store } = setup();
  store.begin({ sessionId: SESSION, userId: 'user-1', apiUrl: API });
  store.append(SESSION, Buffer.from('abc'));
  await store.finish(SESSION, { failed: true });
  assert.equal(store.list().length, 0);
  store.begin({ sessionId: SESSION, userId: 'user-1', apiUrl: API });
  await store.finish(SESSION, {});
  assert.equal(store.list().length, 0);
  assert.deepEqual(fs.readdirSync(store.dir), []);
});
