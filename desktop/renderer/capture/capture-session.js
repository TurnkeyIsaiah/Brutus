// One live coaching session in the overlay: consent → source pick → start →
// live → stop, with every browser, network and IPC dependency injected so the
// lifecycle can be tested in Node.
//
// Rules this module enforces:
// - Stop works from any state. A generation counter is bumped on stop, and the
//   start flow checks it after every await, so a late /live/start, mic grant or
//   capture grant can never begin recording after the user pressed Stop.
// - Credentials are read at each start and snapshotted, so logout or an API URL
// change during a call cannot orphan the session or leak one account's token
//   into the next.
// - Audio chunks go through the outbox, which replays them after a reconnect,
//   and stop waits for delivery before POST /live/end.
// - Failures are reported as failures.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chunk-outbox.js'));
  } else {
    root.BrutusCaptureSession = factory(root.BrutusChunkOutbox);
  }
})(typeof self !== 'undefined' ? self : this, function (Outbox) {
  'use strict';

  const DEFAULT_API_URL = 'https://api.brutusai.coach';
  const MIC_CONSTRAINTS = {
    audio: {
      echoCancellation: false, // keep both voices intact for transcription
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 16000
    }
  };
  const DISPLAY_VIDEO = { width: { max: 1920 }, height: { max: 1080 } };
  const AUDIO_MIME = 'audio/webm;codecs=opus';

  function normalizeApiUrl(value) {
    const url = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
    return url || DEFAULT_API_URL;
  }

  function stopTracks(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch (_) { /* already stopped */ }
    }
  }

  function hasLiveTrack(tracks) {
    return tracks.some((t) => t.readyState === 'live');
  }

  function errorFromResponse(kind, res) {
    const err = (res && res.data && res.data.error) || {};
    if (res && res.status === 401) return "you're signed out. log in to Brutus again, then start monitoring.";
    if (err.code === 'OUT_OF_TOKENS') return err.message || "you're out of tokens. add credits to keep Brutus watching.";
    if (err.code === 'SUBSCRIPTION_REQUIRED') return err.message || 'a starter subscription is required for live coaching.';
    if (err.message) return err.message;
    return `couldn't ${kind} the session (error ${res ? res.status : 'unknown'}).`;
  }

  function networkError() {
    return "can't reach Brutus. check your internet connection and try again.";
  }

  function micError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return "Brutus can't use your microphone. allow microphone access for Brutus in your system settings, then start again.";
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'no microphone found. connect one and start again.';
    }
    if (name === 'NotReadableError') {
      return 'your microphone is busy in another app. close it there and start again.';
    }
    return "couldn't open your microphone. check it and start again.";
  }

  function createCaptureSession(deps) {
    const ipc = deps.ipc;
    const ui = deps.ui;
    const media = deps.media;
    const fetchFn = deps.fetch;
    const T = Object.assign({
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id)
    }, deps.timers || {});
    const cfg = Object.assign({
      chunkMs: 30000,
      screenshotEvery: 4,
      drainMs: 20000,
      legacyGraceMs: 8000,
      startTimeoutMs: 20000,
      endTimeoutMs: 90000,
      minChunkBytes: 1200,
      clientId: 'brutus-desktop'
    }, deps.config || {});

    let state = 'idle';
    let gen = 0;
    let creds = null;
    let sessionId = null;
    let startPromise = null;
    let stopPromise = null;
    let aiNotes = false;

    let micStream = null;
    let audioCtx = null;
    let analyser = null;
    let repRecorder = null;
    let prospectRecorder = null;
    let prospectStream = null;
    let videoStream = null;
    let displayStreams = [];
    let chunkTimer = null;
    let flushChain = Promise.resolve();
    let captureStopping = false;
    let chunkCounter = 0;
    let startedAt = 0;

    let ws = null;
    let wsId = 0;
    let wsConnected = false;
    let socketWanted = false;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    const outbox = Outbox.createChunkOutbox({
      send: sendRaw,
      setTimeout: T.setTimeout,
      clearTimeout: T.clearTimeout,
      onFatal: () => {
        if (state !== 'live') return;
        ui.feedback('critical', 'this session was closed on the server. start monitoring again.');
        endFromInside('session_not_active');
      },
      onChange: (stats) => ui.connection(connectionLabel(), stats)
    });

    function connectionLabel() {
      if (wsConnected) return 'online';
      return socketWanted ? 'reconnecting' : 'offline';
    }

    function setState(next) {
      state = next;
      try { ipc.reportCaptureState({ state: next, sessionId }); } catch (_) { /* main gone */ }
    }

    // ---------------- network ----------------

    async function api(path, body, options) {
      const opts = options || {};
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const onAbort = () => controller && controller.abort();
      if (opts.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = opts.timeoutMs ? T.setTimeout(onAbort, opts.timeoutMs) : null;
      try {
        const res = await fetchFn(`${creds.apiUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${creds.token}`,
            'X-Brutus-Client': cfg.clientId
          },
          body: JSON.stringify(body || {}),
          signal: controller ? controller.signal : undefined
        });
        let data = null;
        try { data = await res.json(); } catch (_) { /* empty or non-JSON body */ }
        return { ok: res.ok, status: res.status, data };
      } finally {
        if (timer) T.clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      }
    }

    async function cancelRemote(id) {
      if (!id || !creds) return;
      try { await api('/live/cancel', { sessionId: id }, { timeoutMs: 15000 }); } catch (_) { /* best effort */ }
    }

    async function endRemote(id, lastSeq) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await api('/live/end', { sessionId: id, lastSeq }, { timeoutMs: cfg.endTimeoutMs });
          if (res.ok) return { ok: true, data: res.data };
          if (res.status < 500) return { ok: false, message: errorFromResponse('save', res) };
        } catch (_) {
          if (attempt === 1) return { ok: false, message: "couldn't reach Brutus to save the call. it may still appear in your dashboard." };
        }
      }
      return { ok: false, message: "Brutus couldn't save the call. it may still appear in your dashboard." };
    }

    function rawPost(path, body) {
      if (!creds) return Promise.reject(new Error('no active session'));
      return fetchFn(`${creds.apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.token}`,
          'X-Brutus-Client': cfg.clientId
        },
        body: JSON.stringify(body || {})
      });
    }

    // ---------------- socket ----------------

    function sendRaw(message) {
      if (!ws || !wsConnected || ws.readyState !== 1) return false;
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (_) {
        return false;
      }
    }

    function clearReconnect() {
      if (reconnectTimer) { T.clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    function scheduleReconnect() {
      clearReconnect();
      reconnectAttempts += 1;
      const delay = state === 'stopping' ? 1000 : Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
      reconnectTimer = T.setTimeout(() => { reconnectTimer = null; connectSocket(); }, delay);
      ui.connection('reconnecting', outbox.stats());
    }

    function connectSocket() {
      if (!creds || !socketWanted) return;
      clearReconnect();
      const id = ++wsId;
      const url = creds.apiUrl.replace(/^http/i, 'ws') + '/ws';
      let sock;
      try {
        sock = deps.createWebSocket(url);
      } catch (_) {
        scheduleReconnect();
        return;
      }
      ws = sock;
      sock.onopen = () => {
        if (id !== wsId) return;
        try { sock.send(JSON.stringify({ type: 'auth', token: creds.token, client: cfg.clientId })); } catch (_) {}
      };
      sock.onmessage = (event) => {
        if (id !== wsId) return;
        handleMessage(event && event.data);
      };
      sock.onerror = () => {};
      sock.onclose = (event) => {
        if (id !== wsId) return; // an older socket, already replaced
        ws = null;
        wsConnected = false;
        outbox.onDisconnected();
        if (event && event.code === 4001) {
          // Token rejected or revoked: reconnecting with it cannot work.
          socketWanted = false;
          ui.connection('offline', outbox.stats());
          if (state === 'live') {
            ui.feedback('critical', 'you were signed out, so Brutus stopped listening.');
            endFromInside('signed_out');
          }
          return;
        }
        if (socketWanted) scheduleReconnect();
      };
    }

    function closeSocket() {
      socketWanted = false;
      clearReconnect();
      wsId += 1;
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
      ws = null;
      wsConnected = false;
      reconnectAttempts = 0;
      outbox.onDisconnected();
    }

    function handleMessage(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      const payload = msg.payload || {};

      if (msg.type === 'connected') {
        wsConnected = true;
        reconnectAttempts = 0;
        const caps = Array.isArray(payload.capabilities) ? payload.capabilities : [];
        outbox.onConnected({ ackMode: caps.includes('chunk_ack') });
        ui.connection('online', outbox.stats());
        return;
      }
      if (msg.type === 'chunk_ack') {
        outbox.onAck(payload);
        return;
      }
      if ((msg.type === 'brutus_feedback' || msg.type === 'error') &&
          (payload.code === 'OUT_OF_TOKENS' || payload.code === 'SUBSCRIPTION_REQUIRED')) {
        if (state !== 'live') return;
        ui.feedback('critical', payload.text || payload.message ||
          (payload.code === 'OUT_OF_TOKENS' ? "you're out of tokens. add credits to keep Brutus watching." : 'a starter subscription is required for live coaching.'));
        endFromInside('billing');
        return;
      }
      if (msg.type === 'brutus_feedback' && payload.coach === true) {
        ui.feedback('brutus', payload.feedback, payload.short || null);
        return;
      }
      if (msg.type === 'chat_response') {
        ui.chat('brutus', payload.message);
      }
    }

    // ---------------- recording ----------------

    function attachCollector(recorder) {
      recorder._chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recorder._chunks.push(e.data);
      };
    }

    function takeBufferedBlob(recorder) {
      const chunks = recorder._chunks || [];
      recorder._chunks = [];
      if (chunks.length === 0) return null;
      const blob = media.createBlob(chunks, 'audio/webm');
      return blob.size < cfg.minChunkBytes ? null : blob;
    }

    // Resolves once the recorder has flushed its final dataavailable.
    function stopAndGetBlob(recorder) {
      return new Promise((resolve) => {
        if (!recorder) { resolve(null); return; }
        if (recorder.state === 'inactive') { resolve(takeBufferedBlob(recorder)); return; }
        recorder.addEventListener('stop', () => resolve(takeBufferedBlob(recorder)), { once: true });
        recorder.stop();
      });
    }

    // Periodic flushes and the final flush share one chain so they never overlap.
    function enqueueFlush(fn) {
      const run = flushChain.then(fn, fn);
      flushChain = run.catch(() => {});
      return run;
    }

    async function flushChunk(isFinal) {
      try {
        const [repBlob, prospectBlob] = await Promise.all([
          stopAndGetBlob(repRecorder),
          stopAndGetBlob(prospectRecorder)
        ]);

        // Restart before the slow encode/send so the gap between windows is only
        // the stop round-trip. Never restart once teardown has begun.
        if (!isFinal && !captureStopping) {
          if (repRecorder && repRecorder.state === 'inactive') {
            try { repRecorder.start(); } catch (_) {}
          }
          if (prospectRecorder && prospectRecorder.state === 'inactive') {
            if (prospectStream && hasLiveTrack(prospectStream.getAudioTracks())) {
              try { prospectRecorder.start(); } catch (_) { prospectRecorder = null; }
            } else {
              prospectRecorder = null; // system audio ended; continue with the rep only
            }
          }
        }

        const [repAudio, prospectAudio] = await Promise.all([
          media.blobToBase64(repBlob),
          media.blobToBase64(prospectBlob)
        ]);
        if (!repAudio && !prospectAudio) return;

        chunkCounter += 1;
        const canShoot = videoStream && hasLiveTrack(videoStream.getVideoTracks());
        const screenshot = canShoot && chunkCounter % cfg.screenshotEvery === 0
          ? await media.captureScreenshot(videoStream)
          : null;

        outbox.enqueue({
          repAudio,
          prospectAudio,
          screenshot,
          timestamp: T.now(),
          timeIntoCall: Math.floor((T.now() - startedAt) / 1000),
          mimeType: 'audio/webm',
          aiNotesEnabled: aiNotes
        });
      } catch (_) {
        if (!isFinal && !captureStopping && repRecorder && repRecorder.state === 'inactive') {
          try { repRecorder.start(); } catch (__) {}
        }
      }
    }

    function stopVideo() {
      stopTracks(videoStream);
      videoStream = null;
    }

    // Asks main for one display capture. With a sourceId the chosen window's video
    // is kept for screenshots; without one the video is dropped at once and only
    // the computer's audio is kept.
    async function attachDisplay(g, sourceId, systemAudio) {
      try {
        await ipc.setCaptureIntent({ screenSourceId: sourceId || null, systemAudio: !!systemAudio });
      } catch (_) {
        return false;
      }
      let stream;
      try {
        stream = await media.getDisplayMedia({ video: DISPLAY_VIDEO, audio: !!systemAudio });
      } catch (_) {
        if (g !== gen) return false;
        ui.feedback('warning', systemAudio
          ? "couldn't capture the call audio on this computer. coaching on your voice only."
          : "couldn't capture that window. screen capture stays off.");
        return false;
      }
      displayStreams.push(stream);
      if (g !== gen) return false; // stopped while waiting; teardown stops this stream

      const videoTracks = stream.getVideoTracks();
      if (sourceId && videoTracks.length) {
        stopVideo();
        videoStream = media.createStream(videoTracks);
      } else {
        videoTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
      }

      if (systemAudio) {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length && repRecorder && chunkTimer) {
          try {
            prospectStream = media.createStream(audioTracks);
            prospectRecorder = media.createRecorder(prospectStream, AUDIO_MIME);
            attachCollector(prospectRecorder);
            prospectRecorder.start();
            ui.feedback('insight', 'capturing both sides of the conversation.');
          } catch (_) {
            prospectRecorder = null;
            ui.feedback('insight', "couldn't record the call audio. coaching on your voice only.");
          }
        } else {
          audioTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
          ui.feedback('insight', 'no call audio on this computer. coaching on your voice only.');
        }
      }
      return !!(sourceId && videoStream);
    }

    function stopCapture() {
      captureStopping = true;
      if (chunkTimer) { T.clearInterval(chunkTimer); chunkTimer = null; }
      for (const recorder of [repRecorder, prospectRecorder]) {
        if (recorder && recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (_) {}
        }
      }
      repRecorder = null;
      prospectRecorder = null;
      stopTracks(micStream);
      micStream = null;
      stopTracks(prospectStream);
      prospectStream = null;
      stopVideo();
      displayStreams.forEach(stopTracks);
      displayStreams = [];
      if (audioCtx) {
        try { audioCtx.close(); } catch (_) {}
      }
      audioCtx = null;
      analyser = null;
    }

    // ---------------- lifecycle ----------------

    function start(options) {
      if (state !== 'idle' || stopPromise) return startPromise || Promise.resolve(false);
      const g = ++gen;
      const screen = !!(options && options.screen);
      const run = runStart(g, screen)
        .catch(() => abortStart(g, "couldn't start the session. try again."))
        .finally(() => { if (startPromise === run) startPromise = null; });
      startPromise = run;
      return run;
    }

    async function runStart(g, screen) {
      const alive = () => g === gen;

      setState('consenting');
      const consented = await ui.consent();
      if (!alive()) return false;
      if (!consented) {
        setState('idle');
        ipc.stopMonitoring();
        return false;
      }

      let sourceId = null;
      if (screen) {
        setState('picking');
        sourceId = await ui.pickSource();
        if (!alive()) return false;
      }

      setState('starting');
      ui.resetMetrics();
      const auth = await ipc.getAuth();
      const settings = await ipc.getSettings();
      if (!alive()) return false;
      if (!auth || !auth.token) {
        return abortStart(g, "you're signed out. log in to Brutus, then start monitoring.");
      }
      creds = { apiUrl: normalizeApiUrl(settings && settings.apiUrl), token: auth.token };

      // Not aborted by Stop on purpose: the server may create the session anyway,
      // so a stop waits for the id and cancels exactly that session.
      let res;
      try {
        res = await api('/live/start', {}, { timeoutMs: cfg.startTimeoutMs });
      } catch (_) {
        if (!alive()) return false;
        return abortStart(g, networkError());
      }
      const createdId = res.ok && res.data && res.data.session && res.data.session.id;
      if (!alive()) {
        if (createdId) await cancelRemote(createdId);
        return false;
      }
      if (!createdId) {
        return abortStart(g, res.ok ? 'Brutus sent back an invalid session. try again.' : errorFromResponse('start', res));
      }
      sessionId = createdId;
      outbox.reset(sessionId);
      setState('starting');

      try {
        micStream = await media.getUserMedia(MIC_CONSTRAINTS);
      } catch (err) {
        if (!alive()) return false;
        return abortStart(g, micError(err));
      }
      if (!alive()) return false;

      audioCtx = media.createAudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      audioCtx.createMediaStreamSource(micStream).connect(analyser);

      captureStopping = false;
      chunkCounter = 0;
      flushChain = Promise.resolve();
      repRecorder = media.createRecorder(micStream, AUDIO_MIME);
      attachCollector(repRecorder);
      repRecorder.start();
      startedAt = T.now();
      chunkTimer = T.setInterval(() => { enqueueFlush(() => flushChunk(false)); }, cfg.chunkMs);

      socketWanted = true;
      connectSocket();

      const screenOn = await attachDisplay(g, sourceId, true);
      if (!alive()) return false;

      setState('live');
      ui.live({ analyser, screen: screenOn, startedAt });
      return true;
    }

    // The start failed on its own (not because the user stopped): undo it and
    // tell main, which resets its monitoring state and hides the overlay.
    async function abortStart(g, message) {
      if (g !== gen) return false;
      gen += 1;
      if (message) ui.feedback('critical', message);
      stopCapture();
      closeSocket();
      if (sessionId) await cancelRemote(sessionId);
      sessionId = null;
      creds = null;
      outbox.reset(null);
      setState('idle');
      ipc.stopMonitoring();
      return false;
    }

    function endFromInside(reason) {
      try { ipc.stopMonitoring(); } catch (_) {}
      return stop({ mode: 'end', reason });
    }

    function stop(options) {
      if (stopPromise) return stopPromise;
      if (state === 'idle' && !startPromise) {
        try { ipc.overlayStopped({ sessionId: null, ok: true, reason: options && options.reason }); } catch (_) {}
        return Promise.resolve({ ok: true, sessionId: null });
      }
      stopPromise = runStop(options || {}).finally(() => { stopPromise = null; });
      return stopPromise;
    }

    async function runStop(options) {
      const mode = options.mode === 'cancel' ? 'cancel' : 'end';
      const wasLive = state === 'live';
      gen += 1;
      setState('stopping');
      ui.cancelPrompts();
      if (startPromise) { try { await startPromise; } catch (_) {} }

      const id = sessionId;
      let result = { ok: true, sessionId: id, data: null, message: null };

      if (id && wasLive && mode === 'end') {
        ui.feedback('insight', 'ending session...');
        captureStopping = true;
        if (chunkTimer) { T.clearInterval(chunkTimer); chunkTimer = null; }
        try { await enqueueFlush(() => flushChunk(true)); } catch (_) {}
        stopCapture();

        if (!wsConnected && socketWanted && !reconnectTimer) connectSocket();
        const delivered = await outbox.drain(cfg.drainMs);
        if (delivered && !outbox.isAckMode()) {
          // Older backends cannot confirm chunks: give the last one time to be
          // transcribed before the call is closed.
          ui.feedback('insight', 'finishing the call...');
          await new Promise((resolve) => T.setTimeout(resolve, cfg.legacyGraceMs));
        }
        if (!delivered) {
          const stats = outbox.stats();
          ui.feedback('warning', `${stats.pending} piece(s) of audio could not be sent. the end of the call may be missing.`);
        }
        const lastSeq = outbox.lastSeq();
        closeSocket();
        result = Object.assign({ sessionId: id }, await endRemote(id, lastSeq));
      } else {
        stopCapture();
        closeSocket();
        if (id) await cancelRemote(id);
        result = { ok: true, sessionId: id, cancelled: !!id, data: null, message: null };
      }

      result.reason = options.reason || null;
      outbox.reset(null);
      sessionId = null;
      creds = null;
      setState('idle');
      try { ipc.overlayStopped({ sessionId: id, ok: result.ok, reason: result.reason }); } catch (_) {}
      ui.stopped(result);
      return result;
    }

    async function setScreen(on) {
      if (state !== 'live') return !!on;
      if (!on) {
        stopVideo();
        ui.feedback('insight', 'screen capture off. Brutus still hears the call.');
        return false;
      }
      const g = gen;
      const sourceId = await ui.pickSource();
      if (g !== gen || state !== 'live') return false;
      if (!sourceId) {
        ui.feedback('insight', 'no window picked. screen capture stays off.');
        return false;
      }
      const ok = await attachDisplay(g, sourceId, false);
      if (ok) ui.feedback('insight', 'screen capture on.');
      return ok;
    }

    return {
      start,
      stop,
      setScreen,
      setAiNotes(on) { aiNotes = !!on; },
      sendChat(text) {
        return sendRaw({ type: 'chat_message', payload: { message: text } });
      },
      post: rawPost,
      get state() { return state; },
      get sessionId() { return sessionId; },
      stats() { return outbox.stats(); }
    };
  }

  return { createCaptureSession, normalizeApiUrl, micError, errorFromResponse };
});
