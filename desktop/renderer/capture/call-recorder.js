// The call recording: one file per live call, for watching it back later.
//
// - Audio: the rep's mic and the computer's call audio, mixed in the session's
//   AudioContext into one track (the coaching chunks keep their two separate
//   channels; this file is only for playback).
// - Video: when the rep picked a window to share at the start, a copy of that
//   window's video track, capped at 720p / 15 fps. No window, or video turned
//   off in Settings: audio only. If the window closes or screen capture is
//   turned off mid-call, the picture stops there and the sound carries on.
// - The recorder hands main a piece every second; main appends it to a file on
//   disk, so a crash or a quit loses at most about a second.
// - The rep can switch recording off and on during the call (the overlay's
//   record button). While off, the recorder's tracks are disabled, so the file
//   holds silence and a black picture: nothing from that stretch is captured,
//   and the file's timeline still matches the call's. Those stretches are
//   reported as pauses ({ startMs, endMs } from the recording's start) and the
//   player skips them.
// - The recording's time zero is when its first frame was captured. That
//   moment, relative to the call's startedAt (the zero of the transcript line
//   times), is reported as startOffsetMs so the player can line them up.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BrutusCallRecorder = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VIDEO_MIME = 'video/webm;codecs=vp8,opus';
  const AUDIO_MIME = 'audio/webm;codecs=opus';
  const DEFAULTS = {
    timesliceMs: 1000,
    videoBitsPerSecond: 900000, // ~1 Mbps with audio: ~430 MB per hour
    audioBitsPerSecond: 48000,
    maxWidth: 1280,
    maxHeight: 720,
    maxFrameRate: 15,
    stopTimeoutMs: 10000
  };

  function createCallRecorder(deps) {
    const ipc = deps.ipc;
    const media = deps.media;
    const log = deps.log || function () {};
    const now = (deps.timers && deps.timers.now) || (() => Date.now());
    const cfg = Object.assign({}, DEFAULTS, deps.config || {});

    let recorder = null;
    let id = null;
    let dest = null;
    let videoClone = null;
    let hasVideo = false;
    let startedAt = 0;   // the call's zero (capture-session startedAt)
    let firstAt = 0;     // when the recorder actually started
    let writeChain = Promise.resolve();
    let writeFailed = false;
    let bytes = 0;
    let connected = [];
    let pendingSources = []; // added before start() finished creating the mix
    let paused = false;
    let pausedAt = 0;
    let pauses = [];
    let lastReason = null;   // why main refused the last start ('off', 'disk', ...)

    function supported(audioCtx) {
      return !!(ipc && typeof ipc.recordingBegin === 'function' &&
        audioCtx && typeof audioCtx.createMediaStreamDestination === 'function');
    }

    function connectSource(source) {
      if (!source || typeof source.connect !== 'function') return;
      if (!dest) {
        if (!pendingSources.includes(source)) pendingSources.push(source);
        return;
      }
      if (connected.includes(source)) return;
      try {
        source.connect(dest);
        connected.push(source);
      } catch (err) {
        log('recording', 'could not mix a source:', err && err.message);
      }
    }

    // opts: { audioCtx, sources: [AudioNode], videoTrack|null, sessionId,
    //         startedAt, wantVideo, manual }
    // manual: the rep pressed record in the overlay, so Settings being off
    // does not stop it. Resolves true when recording, false when off or refused.
    async function start(opts) {
      if (recorder) return true;
      lastReason = null;
      if (!supported(opts.audioCtx)) { lastReason = 'unsupported'; return false; }
      const wantVideo = !!(opts.wantVideo && opts.videoTrack && opts.videoTrack.readyState === 'live');
      let res;
      try {
        res = await ipc.recordingBegin({ sessionId: opts.sessionId, wantVideo, manual: opts.manual === true });
      } catch (err) {
        log('recording', 'main refused:', err && err.message);
        lastReason = 'error';
        return false;
      }
      if (!res || !res.ok) {
        log('recording', 'off:', res && res.reason);
        lastReason = (res && res.reason) || 'error';
        return false;
      }
      id = res.id;
      startedAt = opts.startedAt;
      firstAt = 0;
      bytes = 0;
      writeFailed = false;
      writeChain = Promise.resolve();
      paused = false;
      pausedAt = 0;
      pauses = [];

      try {
        dest = opts.audioCtx.createMediaStreamDestination();
        (opts.sources || []).concat(pendingSources).forEach(connectSource);
        pendingSources = [];
        const tracks = dest.stream.getAudioTracks().slice(0, 1);
        hasVideo = false;
        if (res.video && wantVideo) {
          videoClone = opts.videoTrack.clone();
          try {
            await videoClone.applyConstraints({
              width: { max: cfg.maxWidth },
              height: { max: cfg.maxHeight },
              frameRate: { max: cfg.maxFrameRate }
            });
          } catch (err) {
            log('recording', 'video constraints not applied:', err && err.message);
          }
          tracks.unshift(videoClone);
          hasVideo = true;
        }
        const mimeType = hasVideo ? VIDEO_MIME : AUDIO_MIME;
        recorder = media.createRecorder(media.createStream(tracks), mimeType, {
          videoBitsPerSecond: hasVideo ? cfg.videoBitsPerSecond : undefined,
          audioBitsPerSecond: cfg.audioBitsPerSecond
        });
        recorder.ondataavailable = (e) => {
          if (!e || !e.data || !e.data.size) return;
          const blob = e.data;
          writeChain = writeChain.then(async () => {
            if (writeFailed) return;
            try {
              const buf = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : blob;
              await ipc.recordingData({ id, data: buf });
              bytes += blob.size;
            } catch (err) {
              writeFailed = true; // disk full or main gone: stop writing, keep the call going
              log('recording', 'write failed:', err && err.message);
            }
          });
        };
        recorder.onstart = () => { firstAt = now(); };
        recorder.start(cfg.timesliceMs);
        if (!firstAt) firstAt = now(); // until onstart says otherwise
        log('recording', 'started', hasVideo ? 'video + audio' : 'audio only');
        return true;
      } catch (err) {
        log('recording', 'could not start:', err && err.message);
        await abandon();
        return false;
      }
    }

    // The computer's call audio arrives after the recording starts.
    function addSource(source) {
      connectSource(source);
    }

    function recordedTracks() {
      const tracks = [];
      if (dest && dest.stream) tracks.push(...dest.stream.getAudioTracks());
      if (videoClone) tracks.push(videoClone);
      return tracks;
    }

    // Record button: off disables the tracks (silence, black), on enables
    // them again. Returns whether it is recording afterwards.
    function setPaused(on) {
      if (!recorder) return false;
      const want = !!on;
      if (want === paused) return !paused;
      for (const t of recordedTracks()) {
        try { t.enabled = !want; } catch (_) {}
      }
      const at = now();
      const base = firstAt || at;
      if (want) {
        pausedAt = at;
      } else {
        pauses.push({ startMs: Math.max(0, pausedAt - base), endMs: Math.max(0, at - base) });
        pausedAt = 0;
      }
      paused = want;
      log('recording', want ? 'switched off by the rep' : 'switched back on');
      return !paused;
    }

    // Screen capture turned off mid-call: stop the picture, keep the sound.
    function stopVideo() {
      if (videoClone) {
        try { videoClone.stop(); } catch (_) {}
      }
    }

    function waitForStop() {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === 'inactive') { resolve(); return; }
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const prev = recorder.onstop;
        recorder.onstop = (e) => { if (typeof prev === 'function') prev(e); finish(); };
        setTimeout(finish, cfg.stopTimeoutMs);
        try { recorder.stop(); } catch (_) { finish(); }
      });
    }

    function release() {
      stopVideo();
      for (const source of connected) {
        try { source.disconnect(dest); } catch (_) {}
      }
      connected = [];
      if (dest && dest.stream) {
        for (const t of dest.stream.getTracks()) { try { t.stop(); } catch (_) {} }
      }
      dest = null;
      videoClone = null;
      recorder = null;
      pendingSources = [];
      paused = false;
    }

    // Ends the recording: last piece written, then main finishes the file.
    async function stop() {
      if (!recorder || !id) return null;
      const endAt = now();
      if (paused) {
        pauses.push({ startMs: Math.max(0, pausedAt - firstAt), endMs: Math.max(0, endAt - firstAt) });
        paused = false;
      }
      await waitForStop();
      await writeChain;
      const info = {
        id,
        durationMs: Math.max(0, endAt - firstAt),
        startOffsetMs: Math.max(0, firstAt - startedAt),
        hasVideo,
        bytes,
        pauses: pauses.filter((p) => p.endMs > p.startMs)
      };
      release();
      try {
        await ipc.recordingEnd(info);
      } catch (err) {
        log('recording', 'finish failed:', err && err.message);
      }
      id = null;
      return info;
    }

    async function abandon() {
      const was = id;
      release();
      id = null;
      if (was && ipc && typeof ipc.recordingEnd === 'function') {
        try { await ipc.recordingEnd({ id: was, durationMs: 0, startOffsetMs: 0, hasVideo: false, bytes: 0, failed: true }); } catch (_) {}
      }
    }

    return {
      start,
      addSource,
      setPaused,
      stopVideo,
      stop,
      abandon,
      get active() { return !!recorder; },
      get paused() { return !!recorder && paused; },
      get hasVideo() { return hasVideo; },
      get lastReason() { return lastReason; }
    };
  }

  return { createCallRecorder, VIDEO_MIME, AUDIO_MIME };
});
