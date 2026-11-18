// Main-process side of call recordings: decides whether a call is recorded,
// writes what the overlay sends to disk, and hands finished files to the
// uploader. main.js only registers the IPC channels and forwards events here.
'use strict';

const fs = require('fs');
const path = require('path');
const { createRecordingStore } = require('./recordingStore');
const { createUploader } = require('./uploader');
const { fixWebmInPlace } = require('./webmFix');

const MIN_FREE_BYTES = 500 * 1024 * 1024;        // below this: no recording at all
const MIN_FREE_FOR_VIDEO = 3 * 1024 * 1024 * 1024; // below this: audio only
const CONFIG_TTL_MS = 10 * 60 * 1000;
const MAX_PIECE_BYTES = 64 * 1024 * 1024;

// Indexes the file off the main thread (an hour of video takes a few seconds).
// Falls back to doing it inline if a worker cannot start.
function fixInWorker(filePath) {
  return new Promise((resolve, reject) => {
    let Worker;
    try {
      ({ Worker } = require('worker_threads'));
    } catch (_) {
      try { resolve(fixWebmInPlace(filePath)); } catch (err) { reject(err); }
      return;
    }
    let worker;
    try {
      worker = new Worker(path.join(__dirname, 'fixWorker.js'), { workerData: { filePath } });
    } catch (_) {
      try { resolve(fixWebmInPlace(filePath)); } catch (err) { reject(err); }
      return;
    }
    worker.once('message', (msg) => {
      if (msg && msg.ok) resolve(msg.result);
      else reject(new Error((msg && msg.error) || 'fix failed'));
    });
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`fix worker exited ${code}`)); });
  });
}

function createRecordingService(deps) {
  const log = deps.log || ((...args) => console.log('[recordings]', ...args));
  const fetchFn = deps.fetch;
  const readSettings = deps.readSettings;
  const getAuth = deps.getAuth;     // () => { token, userId }
  const getApiUrl = deps.getApiUrl;
  const freeBytes = deps.freeBytes || ((dir) => {
    try {
      const target = fs.existsSync(dir) ? dir : path.dirname(dir);
      const st = fs.statfsSync(target);
      return Number(st.bavail) * Number(st.bsize);
    } catch (_) {
      return Infinity; // unknown: do not block recording on it
    }
  });

  const store = createRecordingStore({
    dir: deps.dir,
    fixWebm: deps.fixWebm || fixInWorker,
    log
  });
  const uploader = createUploader({
    store,
    fetch: fetchFn,
    getAuth,
    getApiUrl,
    isLiveSession: (id) => store.isOpen(id) || (deps.isLiveSession ? deps.isLiveSession(id) : false),
    onChange: deps.onStatus,
    log,
    timers: deps.timers
  });

  let serverConfig = null;
  let serverConfigAt = 0;

  // GET /calls/recordings/config, cached. Unreachable: the last answer, or
  // "on" (the call itself needs the server, so this is rarely the case).
  async function recordingsEnabledOnServer(auth) {
    if (serverConfig && Date.now() - serverConfigAt < CONFIG_TTL_MS) return serverConfig.enabled !== false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      let res;
      try {
        res = await fetchFn(`${getApiUrl()}/calls/recordings/config`, {
          headers: { Authorization: `Bearer ${auth.token}`, 'X-Brutus-Client': 'brutus-desktop' },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 404) {
        // A backend from before call recordings.
        serverConfig = { enabled: false };
      } else if (res.ok) {
        serverConfig = await res.json();
      }
      serverConfigAt = Date.now();
    } catch (_) {
      /* keep the last answer */
    }
    return !serverConfig || serverConfig.enabled !== false;
  }

  // The overlay asks right before it starts recording a call. manual: the rep
  // pressed record in the overlay, which overrides "Record calls" being off
  // in Settings for that call (nothing else is overridden).
  async function begin(request) {
    const req = request && typeof request === 'object' ? request : {};
    const settings = readSettings() || {};
    if (settings.recordCalls === false && req.manual !== true) return { ok: false, reason: 'off' };
    const auth = getAuth();
    if (!auth || !auth.token) return { ok: false, reason: 'signed_out' };
    if (typeof req.sessionId !== 'string') return { ok: false, reason: 'invalid' };
    if (!(await recordingsEnabledOnServer(auth))) return { ok: false, reason: 'unavailable' };
    const free = freeBytes(deps.dir);
    if (free < MIN_FREE_BYTES) {
      log('not recording: low disk space');
      return { ok: false, reason: 'disk' };
    }
    const video = !!req.wantVideo && settings.recordVideo !== false && free >= MIN_FREE_FOR_VIDEO;
    let id;
    try {
      id = store.begin({ sessionId: req.sessionId, userId: auth.userId, apiUrl: getApiUrl(), wantVideo: video });
    } catch (err) {
      log('could not start a recording file:', err && err.message);
      return { ok: false, reason: 'disk' };
    }
    return { ok: true, id, video };
  }

  function data(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (typeof p.id !== 'string' || !store.isOpen(p.id)) throw new Error('no such recording');
    const bytes = p.data;
    const len = bytes && (bytes.byteLength != null ? bytes.byteLength : bytes.length);
    if (!len) return true;
    if (len > MAX_PIECE_BYTES) throw new Error('recording piece too large');
    store.append(p.id, Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes));
    return true;
  }

  // Closes the file at once and makes it seekable in the background, so
  // saving the call (/live/end) never waits on it. A quit before that is done
  // leaves it 'finishing', which the next launch completes.
  function end(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (typeof p.id !== 'string') return false;
    store.finish(p.id, {
      durationMs: Number(p.durationMs),
      startOffsetMs: Number(p.startOffsetMs),
      hasVideo: typeof p.hasVideo === 'boolean' ? p.hasVideo : undefined,
      pauses: p.pauses,
      failed: p.failed === true
    }).then(() => uploader.kick(), (err) => log('could not finish the recording:', err && err.message));
    return true;
  }

  // The overlay renderer died mid-call: keep what was written. Main ends the
  // session itself, so the upload will find a saved call.
  async function overlayGone() {
    for (const id of store.openIds()) {
      try { await store.finish(id, {}); } catch (err) { log('could not finish after a crash:', err && err.message); }
    }
    uploader.kick();
  }

  async function init() {
    try {
      const recovered = await store.recover();
      if (recovered.length) log(`recovered ${recovered.length} recording(s) left by a crash`);
    } catch (err) {
      log('recovery failed:', err && err.message);
    }
    uploader.kick();
  }

  // Called when a call starts, so begin() does not wait on the network.
  function warm() {
    const auth = getAuth();
    if (auth && auth.token) recordingsEnabledOnServer(auth).catch(() => {});
  }

  return {
    init,
    warm,
    begin,
    data,
    end,
    overlayGone,
    status: () => uploader.status(),
    retry: () => uploader.kick(),
    authChanged: () => uploader.authChanged(),
    callFinished: () => uploader.kick(),
    stop: () => uploader.stop(),
    store
  };
}

module.exports = { createRecordingService, MIN_FREE_BYTES, MIN_FREE_FOR_VIDEO };
