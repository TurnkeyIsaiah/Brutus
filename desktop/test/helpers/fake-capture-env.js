// Fake browser + backend for driving renderer/capture/capture-session.js in Node.
'use strict';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.readyState = 'live';
  }
  stop() { this.readyState = 'ended'; }
}

class FakeStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks.slice(); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
}

// Emits one data chunk per recording window, then 'stop'.
class FakeRecorder {
  constructor(stream, env) {
    this.stream = stream;
    this.env = env;
    this.state = 'inactive';
    this.listeners = {};
    this.ondataavailable = null;
    env.recorders.push(this);
  }
  start() {
    if (this.stream.getTracks().every((t) => t.readyState !== 'live')) throw new Error('tracks ended');
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') throw new Error('not recording');
    this.state = 'inactive';
    setTimeout(() => {
      if (this.ondataavailable) this.ondataavailable({ data: { size: this.env.chunkBytes } });
      (this.listeners.stop || []).forEach((fn) => fn());
      this.listeners.stop = [];
    }, 0);
  }
  addEventListener(name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
  }
}

class FakeSocket {
  constructor(url, env) {
    this.url = url;
    this.env = env;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    env.sockets.push(this);
  }
  send(data) {
    if (this.readyState !== 1) throw new Error('socket not open');
    const msg = JSON.parse(data);
    this.sent.push(msg);
    this.env.onSocketMessage(this, msg);
  }
  close(code) { this.serverClose(code || 1000); }
  // test controls
  serverOpen() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }
  serverSend(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
  serverClose(code) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.onclose) this.onclose({ code: code || 1006 });
  }
}

function createEnv(overrides) {
  const opts = overrides || {};
  const env = {
    chunkBytes: 5000,
    recorders: [],
    sockets: [],
    requests: [],
    feedback: [],
    connections: [],
    ipcCalls: [],
    stoppedResults: [],
    intents: [],
    screenshots: 0,
    token: 'token-A',
    apiUrl: 'https://api.test',
    // backend behaviour
    ackMode: opts.ackMode !== false,
    autoOpen: opts.autoOpen !== false,
    autoAck: opts.autoAck !== false,
    routes: Object.assign({
      '/live/start': () => ({ status: 200, body: { session: { id: 'sess-1' } } }),
      '/live/end': () => ({ status: 200, body: { callId: 'call-1', analysis: { overallScore: 80 } } }),
      '/live/cancel': () => ({ status: 200, body: {} })
    }, opts.routes || {}),
    consent: null,
    picker: null,
    micGate: null,
    displayGate: null,
    micError: null,
    displayVideo: true,
    displayAudio: true
  };

  env.onSocketMessage = (sock, msg) => {
    if (msg.type === 'auth' && env.autoOpen !== 'no-connected') {
      setTimeout(() => sock.serverSend({
        type: 'connected',
        payload: env.ackMode ? { protocol: 2, capabilities: ['chunk_ack'] } : { message: 'ok' }
      }), 0);
    }
    if (msg.type === 'monitoring_data' && env.ackMode && env.autoAck) {
      setTimeout(() => sock.serverSend({
        type: 'chunk_ack',
        payload: { sessionId: msg.payload.sessionId, seq: msg.payload.seq, status: 'stored' }
      }), 0);
    }
  };

  env.fetch = async (url, init) => {
    const path = url.replace(env.apiUrl, '');
    const body = init && init.body ? JSON.parse(init.body) : null;
    const headers = (init && init.headers) || {};
    const req = { path, body, token: String(headers.Authorization || '').replace('Bearer ', ''), headers };
    env.requests.push(req);
    const route = env.routes[path];
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const out = await route(req, init);
    if (init && init.signal && init.signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  };

  env.ipc = {
    getAuth: async () => ({ token: env.token }),
    getSettings: async () => ({ apiUrl: env.apiUrl }),
    setCaptureIntent: async (intent) => { env.intents.push(intent); return true; },
    reportCaptureState: (s) => env.ipcCalls.push(['state', s.state]),
    overlayStopped: (info) => env.ipcCalls.push(['overlayStopped', info]),
    stopMonitoring: () => env.ipcCalls.push(['stopMonitoring'])
  };

  env.media = {
    getUserMedia: async () => {
      if (env.micGate) await env.micGate.promise;
      if (env.micError) throw env.micError;
      env.micStream = new FakeStream([new FakeTrack('audio')]);
      return env.micStream;
    },
    getDisplayMedia: async () => {
      if (env.displayGate) await env.displayGate.promise;
      const tracks = [];
      if (env.displayVideo) tracks.push(new FakeTrack('video'));
      if (env.displayAudio) tracks.push(new FakeTrack('audio'));
      env.displayStream = new FakeStream(tracks);
      return env.displayStream;
    },
    createRecorder: (stream) => new FakeRecorder(stream, env),
    createStream: (tracks) => new FakeStream(tracks),
    createBlob: (parts) => ({ size: parts.reduce((n, p) => n + (p.size || 0), 0) }),
    createAudioContext: () => ({
      createAnalyser: () => ({ fftSize: 0, frequencyBinCount: 32, getByteFrequencyData() {} }),
      createMediaStreamSource: () => ({ connect() {} }),
      close() { this.closed = true; }
    }),
    blobToBase64: async (blob) => (blob ? `b64:${blob.size}` : null),
    captureScreenshot: async () => { env.screenshots += 1; return 'shot'; }
  };

  env.ui = {
    consent: () => {
      env.consent = deferred();
      if (opts.autoConsent !== false) env.consent.resolve(true);
      return env.consent.promise;
    },
    pickSource: () => {
      env.picker = deferred();
      if (opts.autoPick !== undefined) env.picker.resolve(opts.autoPick);
      return env.picker.promise;
    },
    cancelPrompts: () => {
      if (env.consent) env.consent.resolve(false);
      if (env.picker) env.picker.resolve(null);
    },
    resetMetrics: () => {},
    feedback: (type, text) => env.feedback.push([type, text]),
    chat: () => {},
    connection: (state, stats) => env.connections.push([state, stats && stats.pending]),
    live: (info) => { env.liveInfo = info; },
    stopped: (result) => env.stoppedResults.push(result)
  };

  env.createWebSocket = (url) => {
    const sock = new FakeSocket(url, env);
    if (env.autoOpen) setTimeout(() => sock.serverOpen(), 0);
    return sock;
  };

  env.deps = (config) => ({
    ipc: env.ipc,
    ui: env.ui,
    media: env.media,
    fetch: env.fetch,
    createWebSocket: env.createWebSocket,
    config: Object.assign({
      chunkMs: 60 * 60 * 1000, // tests flush explicitly via stop
      drainMs: 200,
      legacyGraceMs: 20,
      endTimeoutMs: 1000,
      startTimeoutMs: 1000
    }, config || {})
  });

  env.requestsTo = (path) => env.requests.filter((r) => r.path === path);
  env.monitoringMessages = () => env.sockets.flatMap((s) => s.sent.filter((m) => m.type === 'monitoring_data'));
  return env;
}

module.exports = { createEnv, deferred, tick, FakeTrack, FakeStream };
