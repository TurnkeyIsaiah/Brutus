// Uploads finished call recordings, one at a time, and keeps trying.
//
// For each 'ready' recording on disk:
//   1. POST /calls/recordings/upload {sessionId, bytes, hasVideo, ...}
//      -> a one-time token for <user>/<call>.webm (or "already uploaded")
//   2. resumable upload straight to storage (tusUpload), progress reported
//   3. POST /calls/:id/recording/complete -> the server checks the size
//   4. only then is the local file deleted
//
// Rules:
// - Only the account that recorded a call uploads it. Signed out, or signed
//   in as someone else: the file waits.
// - Offline / server trouble: retry with backoff (30s doubling to 15 min), and
//   again on the next launch. Nothing is deleted because of an error.
// - The server says the call does not exist (never saved, too short, deleted):
//   the local file is deleted, there is nothing to attach it to.
// - A recording a crash left behind can have a session that was never ended;
//   it is ended (POST /live/end) so the call is saved, then uploaded.
'use strict';

const { tusUpload, UploadError } = require('./tusUpload');

const BACKOFF_MS = [30000, 60000, 120000, 300000, 900000];
const SESSION_ACTIVE_RETRY_MS = 15000;

function createUploader(deps) {
  const store = deps.store;
  const fetchFn = deps.fetch;
  const getAuth = deps.getAuth;           // () => { token, userId } | null
  const getApiUrl = deps.getApiUrl;       // () => 'https://api...'
  const isLiveSession = deps.isLiveSession || (() => false); // (sessionId) => bool
  const onChange = deps.onChange || (() => {});
  const log = deps.log || (() => {});
  const T = Object.assign({
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    now: () => Date.now()
  }, deps.timers || {});
  const clientId = deps.clientId || 'brutus-desktop';

  let running = false;
  let wakeTimer = null;
  let wakeAt = 0;
  let stopped = false;
  let current = null;       // { sessionId, sent, total }
  let abort = null;
  const attempts = new Map(); // sessionId -> consecutive failures
  const notBefore = new Map(); // sessionId -> time
  const lastError = new Map(); // sessionId -> short reason

  function status() {
    return store.list()
      .filter((m) => m.state === 'ready' || m.state === 'finishing' || m.state === 'recording')
      .map((m) => {
        const uploading = current && current.sessionId === m.sessionId;
        return {
          sessionId: m.sessionId,
          callId: (m.upload && m.upload.callId) || null,
          state: m.state === 'ready' ? (uploading ? 'uploading' : (lastError.get(m.sessionId) ? 'waiting' : 'queued')) : m.state,
          sent: uploading ? current.sent : ((m.upload && m.upload.sent) || 0),
          total: m.bytes || (uploading ? current.total : 0),
          hasVideo: !!m.hasVideo,
          reason: lastError.get(m.sessionId) || null
        };
      });
  }

  function emit() {
    try { onChange(status()); } catch (_) { /* window gone */ }
  }

  function schedule(ms) {
    if (stopped) return;
    const at = T.now() + Math.max(0, ms);
    if (wakeTimer && wakeAt <= at) return; // an earlier wake is already set
    if (wakeTimer) T.clearTimeout(wakeTimer);
    wakeAt = at;
    wakeTimer = T.setTimeout(() => { wakeTimer = null; run(); }, Math.max(0, ms));
  }

  function kick() {
    schedule(0);
  }

  function backoff(sessionId, reason) {
    const n = (attempts.get(sessionId) || 0) + 1;
    attempts.set(sessionId, n);
    const delay = BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)];
    notBefore.set(sessionId, T.now() + delay);
    lastError.set(sessionId, reason);
    log('recording', `upload of ${sessionId} waits ${Math.round(delay / 1000)}s: ${reason}`);
    return delay;
  }

  function settle(sessionId) {
    attempts.delete(sessionId);
    notBefore.delete(sessionId);
    lastError.delete(sessionId);
  }

  async function api(method, path, body, auth) {
    const res = await fetchFn(`${getApiUrl()}${path}`, {
      method,
      headers: Object.assign({
        Authorization: `Bearer ${auth.token}`,
        'X-Brutus-Client': clientId
      }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty */ }
    return { ok: res.ok, status: res.status, data, code: data && data.error && data.error.code };
  }

  // One recording, start to finish. Returns a delay before the next try, or
  // 0 when this recording is done (uploaded or discarded).
  async function uploadOne(meta, auth) {
    const id = meta.sessionId;
    let begin;
    try {
      begin = await api('POST', '/calls/recordings/upload', {
        sessionId: id,
        bytes: meta.bytes,
        hasVideo: !!meta.hasVideo,
        durationMs: meta.durationMs || 0,
        startOffsetMs: meta.startOffsetMs || 0,
        pauses: Array.isArray(meta.pauses) ? meta.pauses : []
      }, auth);
    } catch (err) {
      return backoff(id, 'offline');
    }

    if (begin.status === 401) return backoff(id, 'signed out');
    if (begin.status === 409 && begin.code === 'SESSION_ACTIVE') {
      if (isLiveSession(id)) return SESSION_ACTIVE_RETRY_MS;
      if (meta.crashRecovered && !meta.endRequested) {
        // The app died mid-call: save the call from what reached the server.
        store.update(id, { endRequested: true });
        try {
          await api('POST', '/live/end', { sessionId: id }, auth);
        } catch (_) {
          return backoff(id, 'offline');
        }
        return 1000;
      }
      notBefore.set(id, T.now() + SESSION_ACTIVE_RETRY_MS);
      lastError.set(id, 'call still saving');
      return SESSION_ACTIVE_RETRY_MS;
    }
    if (begin.status === 409 && begin.code === 'CALL_SAVING') {
      // The call ended and its analysis is still running: it will exist soon.
      notBefore.set(id, T.now() + SESSION_ACTIVE_RETRY_MS);
      lastError.set(id, 'call still saving');
      return SESSION_ACTIVE_RETRY_MS;
    }
    if (begin.status === 404 && begin.code === 'NO_CALL') {
      log('recording', `no saved call for ${id}; deleting the local recording`);
      store.remove(id);
      settle(id);
      return 0;
    }
    if (begin.status === 413) {
      store.update(id, { state: 'failed', failure: 'too large' });
      lastError.set(id, 'too large to upload');
      return 0;
    }
    if (!begin.ok) return backoff(id, begin.status === 503 ? 'recordings unavailable' : `server error ${begin.status}`);

    const callId = begin.data && begin.data.callId;
    if (!callId) return backoff(id, 'bad server answer');
    if (!begin.data.alreadyUploaded) {
      const up = begin.data.upload || {};
      const sameTarget = meta.upload && meta.upload.objectName === up.objectName;
      store.update(id, {
        upload: Object.assign({}, sameTarget ? meta.upload : {}, { callId, objectName: up.objectName })
      });
      current = { sessionId: id, sent: (sameTarget && meta.upload.sent) || 0, total: meta.bytes };
      emit();
      let lastEmit = 0;
      const controller = new AbortController();
      abort = controller;
      try {
        await tusUpload({
          fetch: fetchFn,
          endpoint: up.endpoint,
          token: up.token,
          bucket: up.bucket,
          objectName: up.objectName,
          contentType: up.contentType,
          chunkSize: up.chunkSize,
          filePath: store.mediaPath(id),
          size: meta.bytes,
          resumeUrl: sameTarget ? meta.upload.url : null,
          signal: controller.signal,
          onUrl: (url) => {
            const m = store.get(id);
            store.update(id, { upload: Object.assign({}, m && m.upload, { url, callId, objectName: up.objectName }) });
          },
          onProgress: (sent, total) => {
            current = { sessionId: id, sent, total };
            if (T.now() - lastEmit > 500 || sent >= total) {
              lastEmit = T.now();
              const m = store.get(id);
              if (m) store.update(id, { upload: Object.assign({}, m.upload, { sent }) });
              emit();
            }
          }
        });
      } catch (err) {
        if (err instanceof UploadError && (err.status === 404 || err.status === 410)) {
          const m = store.get(id);
          if (m) store.update(id, { upload: Object.assign({}, m.upload, { url: null, sent: 0 }) });
        }
        if (err instanceof UploadError && !err.retryable && /cancelled/.test(err.message)) return 0;
        return backoff(id, err instanceof UploadError && err.status ? `upload error ${err.status}` : 'offline');
      } finally {
        abort = null;
        current = null;
      }
    }

    let done;
    try {
      done = await api('POST', `/calls/${encodeURIComponent(callId)}/recording/complete`, {}, auth);
    } catch (_) {
      return backoff(id, 'offline');
    }
    if (done.ok) {
      log('recording', `uploaded ${id} (${meta.bytes} bytes)`);
      store.remove(id);
      settle(id);
      return 0;
    }
    if (done.status === 409) {
      // The server does not have the whole file: start the upload over.
      const m = store.get(id);
      if (m) store.update(id, { upload: Object.assign({}, m.upload, { url: null, sent: 0 }) });
      return backoff(id, 'incomplete upload');
    }
    if (done.status === 404) {
      store.remove(id);
      settle(id);
      return 0;
    }
    return backoff(id, `server error ${done.status}`);
  }

  async function run() {
    if (running || stopped) return;
    running = true;
    let nextWake = null;
    const wake = (ms) => { if (ms > 0 && (nextWake === null || ms < nextWake)) nextWake = ms; };
    try {
      const auth = getAuth();
      for (const meta of store.list()) {
        if (stopped) break;
        if (meta.state !== 'ready') continue;
        if (store.isOpen(meta.sessionId)) continue;
        // The call this recording belongs to is still being stopped or saved:
        // wait for it to finish (callFinished kicks the uploader again).
        if (isLiveSession(meta.sessionId)) { lastError.set(meta.sessionId, 'call still saving'); continue; }
        if (!auth || !auth.token) { lastError.set(meta.sessionId, 'signed out'); continue; }
        if (meta.userId && auth.userId && meta.userId !== auth.userId) { lastError.set(meta.sessionId, 'another account'); continue; }
        if (meta.apiUrl && meta.apiUrl !== getApiUrl()) { lastError.set(meta.sessionId, 'another server'); continue; }
        const wait = (notBefore.get(meta.sessionId) || 0) - T.now();
        if (wait > 0) { wake(wait); continue; }
        try {
          wake(await uploadOne(meta, auth));
        } catch (err) {
          wake(backoff(meta.sessionId, 'unexpected error'));
          log('recording', 'upload failed:', err && err.message);
        }
      }
    } finally {
      running = false;
      emit();
    }
    if (nextWake !== null) schedule(nextWake);
  }

  return {
    kick,
    status,
    // Auth changed (login / logout / another account): re-evaluate now.
    authChanged() {
      for (const [id, reason] of lastError) {
        if (reason === 'signed out' || reason === 'another account') { attempts.delete(id); notBefore.delete(id); lastError.delete(id); }
      }
      kick();
    },
    stop() {
      stopped = true;
      if (wakeTimer) { T.clearTimeout(wakeTimer); wakeTimer = null; }
      if (abort) abort.abort();
    },
    // tests
    _run: run
  };
}

module.exports = { createUploader, BACKOFF_MS };
