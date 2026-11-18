// Call recordings on disk, in <userData>/recordings/:
//   <sessionId>.webm   the recording, appended to every second while recording
//   <sessionId>.json   what it is and where it is in its life:
//     state: 'recording'  being written (left like this by a crash)
//            'finishing'  made seekable (webmFix) after the call
//            'ready'      waiting to upload (or uploading: see upload.*)
//
// The file is only deleted after the backend confirms the upload, after the
// backend says the call no longer exists, or when the rep throws it away
// (a cancelled call). Nothing here talks to the network.
'use strict';

const fs = require('fs');
const path = require('path');

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function createRecordingStore(options) {
  const dir = options.dir;
  const fixWebm = options.fixWebm; // async (filePath) => { durationMs, hasVideo, bytes }
  const log = options.log || (() => {});
  const now = options.now || (() => Date.now());
  const open = new Map(); // id -> { fd, bytes }

  const mediaPath = (id) => path.join(dir, `${id}.webm`);
  const metaPath = (id) => path.join(dir, `${id}.json`);

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  function readMeta(id) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
      return meta && typeof meta === 'object' ? meta : null;
    } catch (_) {
      return null;
    }
  }

  // Atomic: a crash mid-write leaves the old file, never half a file.
  function writeMeta(id, meta) {
    const tmp = `${metaPath(id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, metaPath(id));
    return meta;
  }

  function update(id, patch) {
    const meta = readMeta(id);
    if (!meta) return null;
    return writeMeta(id, Object.assign(meta, patch, { updatedAt: new Date(now()).toISOString() }));
  }

  function validId(id) {
    return typeof id === 'string' && ID_RE.test(id);
  }

  // Starts a recording file. `info`: { sessionId, userId, apiUrl, wantVideo }.
  function begin(info) {
    const id = info.sessionId;
    if (!validId(id)) throw new Error('invalid session id');
    if (open.has(id)) return id;
    ensureDir();
    const fd = fs.openSync(mediaPath(id), 'a');
    open.set(id, { fd, bytes: 0 });
    writeMeta(id, {
      version: 1,
      sessionId: id,
      userId: info.userId || null,
      apiUrl: info.apiUrl || null,
      hasVideo: !!info.wantVideo,
      state: 'recording',
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      durationMs: 0,
      startOffsetMs: 0,
      bytes: 0,
      upload: null
    });
    return id;
  }

  function append(id, data) {
    const entry = open.get(id);
    if (!entry) throw new Error('recording is not open');
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    let off = 0;
    while (off < buf.length) off += fs.writeSync(entry.fd, buf, off, buf.length - off);
    entry.bytes += buf.length;
    return entry.bytes;
  }

  function closeFile(id) {
    const entry = open.get(id);
    if (!entry) return;
    open.delete(id);
    try { fs.fsyncSync(entry.fd); } catch (_) {}
    try { fs.closeSync(entry.fd); } catch (_) {}
  }

  function remove(id) {
    if (!validId(id)) return;
    closeFile(id);
    for (const p of [mediaPath(id), metaPath(id), `${mediaPath(id)}.fixing`, `${metaPath(id)}.tmp`]) {
      try { fs.unlinkSync(p); } catch (_) { /* already gone */ }
    }
  }

  // Stretches the rep switched recording off: [{ startMs, endMs }] from the
  // recording's start, sorted, merged, at most 500.
  function cleanPauses(raw) {
    if (!Array.isArray(raw)) return [];
    const list = raw.slice(0, 500)
      .map((p) => ({ startMs: Math.round(Number(p && p.startMs)), endMs: Math.round(Number(p && p.endMs)) }))
      .filter((p) => Number.isFinite(p.startMs) && Number.isFinite(p.endMs) && p.startMs >= 0 && p.endMs > p.startMs)
      .sort((a, b) => a.startMs - b.startMs);
    const merged = [];
    for (const p of list) {
      const last = merged[merged.length - 1];
      if (last && p.startMs <= last.endMs) last.endMs = Math.max(last.endMs, p.endMs);
      else merged.push(p);
    }
    return merged;
  }

  // Ends a recording: closes the file, makes it seekable, marks it ready.
  // info: { durationMs, startOffsetMs, hasVideo, pauses, failed }
  async function finish(id, info) {
    if (!validId(id)) return null;
    closeFile(id);
    const meta = readMeta(id);
    if (!meta) return null;
    if (info && info.failed) {
      remove(id);
      return null;
    }
    let size = 0;
    try { size = fs.statSync(mediaPath(id)).size; } catch (_) { size = 0; }
    if (size === 0) {
      remove(id);
      return null;
    }
    update(id, {
      state: 'finishing',
      durationMs: Number.isFinite(info && info.durationMs) ? Math.round(info.durationMs) : meta.durationMs,
      startOffsetMs: Number.isFinite(info && info.startOffsetMs) ? Math.round(info.startOffsetMs) : meta.startOffsetMs,
      hasVideo: info && typeof info.hasVideo === 'boolean' ? info.hasVideo : meta.hasVideo,
      pauses: cleanPauses(info && info.pauses)
    });
    return seal(id);
  }

  // webmFix + 'ready'. A file the fixer cannot read is still uploaded as is:
  // it plays, it just seeks slowly.
  async function seal(id) {
    let fixed = null;
    try {
      fixed = await fixWebm(mediaPath(id));
    } catch (err) {
      log('recording', 'could not index the file:', err && err.message);
    }
    let size = 0;
    try { size = fs.statSync(mediaPath(id)).size; } catch (_) { size = 0; }
    if (size === 0) {
      remove(id);
      return null;
    }
    const meta = readMeta(id) || {};
    return update(id, {
      state: 'ready',
      bytes: size,
      durationMs: fixed && fixed.durationMs > 0 ? fixed.durationMs : meta.durationMs,
      hasVideo: fixed ? fixed.hasVideo : meta.hasVideo,
      indexed: !!fixed
    });
  }

  // On launch: recordings a crash left 'recording' or 'finishing' are sealed
  // (crashRecovered: their session may still be open on the server).
  async function recover() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    const recovered = [];
    for (const name of names) {
      if (name.endsWith('.webm.fixing') || name.endsWith('.json.tmp')) {
        try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!validId(id) || open.has(id)) continue;
      const meta = readMeta(id);
      if (!meta) continue;
      if (!fs.existsSync(mediaPath(id))) {
        remove(id);
        continue;
      }
      if (meta.state === 'recording' || meta.state === 'finishing') {
        update(id, { crashRecovered: meta.state === 'recording' ? true : !!meta.crashRecovered });
        if (await seal(id)) recovered.push(id);
      }
    }
    return recovered;
  }

  function list() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => readMeta(n.slice(0, -5)))
      .filter((m) => m && validId(m.sessionId))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  return {
    dir,
    begin,
    append,
    finish,
    recover,
    list,
    get: readMeta,
    update,
    remove,
    mediaPath,
    isOpen: (id) => open.has(id),
    openIds: () => [...open.keys()]
  };
}

module.exports = { createRecordingStore };
