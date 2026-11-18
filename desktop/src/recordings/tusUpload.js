// Minimal resumable (TUS 1.0) upload to Supabase Storage, from a file on disk.
//
// Auth is the one-time signed upload token from our backend, sent as
// `x-signature` (Supabase's signed-upload header for TUS). No storage key ever
// reaches the app.
//
// Resume: the upload URL the server creates stays valid for 24 hours. It is
// handed to onUrl() so the caller can save it; passing it back as resumeUrl
// asks the server where it got to (HEAD) and continues from there. A URL the
// server no longer knows starts a new upload.
'use strict';

const fs = require('fs');

const TUS_VERSION = '1.0.0';

class UploadError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.name = 'UploadError';
    this.status = status || 0;
    this.retryable = retryable !== false;
  }
}

function b64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function readChunk(filePath, offset, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = fs.readSync(fd, buf, got, length - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    return got === length ? buf : buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

// opts: { fetch, endpoint, token, bucket, objectName, contentType, filePath,
//         size, chunkSize, resumeUrl, onUrl(url), onProgress(sent, total),
//         signal, timeoutMs }
async function tusUpload(opts) {
  const fetchFn = opts.fetch;
  const size = opts.size;
  const chunkSize = opts.chunkSize || 6 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 120000;
  const base = {
    'Tus-Resumable': TUS_VERSION,
    'x-signature': opts.token,
    'x-upsert': 'true'
  };

  async function request(url, init) {
    if (opts.signal && opts.signal.aborted) throw new UploadError('upload cancelled', 0, false);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, timeoutMs);
    try {
      return await fetchFn(url, Object.assign({}, init, { signal: controller.signal }));
    } catch (err) {
      if (opts.signal && opts.signal.aborted) throw new UploadError('upload cancelled', 0, false);
      throw new UploadError(`network error: ${err && err.message}`, 0, true);
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }

  function header(res, name) {
    return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null;
  }

  async function serverOffset(url) {
    const res = await request(url, { method: 'HEAD', headers: base });
    if (res.status === 404 || res.status === 410 || res.status === 403) return null; // expired or unknown
    if (!res.ok) throw new UploadError(`resume check answered ${res.status}`, res.status, res.status >= 500 || res.status === 429);
    const offset = Number(header(res, 'upload-offset'));
    const length = header(res, 'upload-length');
    if (!Number.isFinite(offset)) return null;
    if (length != null && Number(length) !== size) return null; // a different file
    return offset;
  }

  async function create() {
    const metadata = [
      `bucketName ${b64(opts.bucket)}`,
      `objectName ${b64(opts.objectName)}`,
      `contentType ${b64(opts.contentType || 'video/webm')}`,
      `cacheControl ${b64('3600')}`
    ].join(',');
    const res = await request(opts.endpoint, {
      method: 'POST',
      headers: Object.assign({}, base, { 'Upload-Length': String(size), 'Upload-Metadata': metadata })
    });
    if (!res.ok) {
      throw new UploadError(`create answered ${res.status}`, res.status, res.status >= 500 || res.status === 429);
    }
    const location = header(res, 'location');
    if (!location) throw new UploadError('no upload location', res.status, true);
    return new URL(location, opts.endpoint).toString();
  }

  let url = opts.resumeUrl || null;
  let offset = 0;
  if (url) {
    const at = await serverOffset(url);
    if (at === null) url = null;
    else offset = at;
  }
  if (!url) {
    url = await create();
    offset = 0;
  }
  if (typeof opts.onUrl === 'function') opts.onUrl(url);
  if (typeof opts.onProgress === 'function') opts.onProgress(offset, size);

  let conflicts = 0;
  while (offset < size) {
    const length = Math.min(chunkSize, size - offset);
    const body = readChunk(opts.filePath, offset, length);
    if (body.length !== length) throw new UploadError('the recording file changed while uploading', 0, false);
    const res = await request(url, {
      method: 'PATCH',
      headers: Object.assign({}, base, {
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream'
      }),
      body
    });
    if (res.status === 409 && conflicts < 3) {
      // Our idea of the offset is stale (a previous PATCH landed after all).
      conflicts += 1;
      const at = await serverOffset(url);
      if (at === null) throw new UploadError('upload expired', 410, true);
      offset = at;
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new UploadError('upload expired', res.status, true);
    if (!res.ok) throw new UploadError(`upload answered ${res.status}`, res.status, res.status >= 500 || res.status === 429 || res.status === 403);
    const next = Number(header(res, 'upload-offset'));
    offset = Number.isFinite(next) && next > offset ? next : offset + length;
    conflicts = 0;
    if (typeof opts.onProgress === 'function') opts.onProgress(offset, size);
  }
  return { url, bytes: size };
}

module.exports = { tusUpload, UploadError };
