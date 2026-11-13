// The call recording player in the call detail ("Show call recording").
//
// - Video when the call has it (the window the rep shared), otherwise the
//   waveform layout with an <audio> element.
// - The recording is fetched only when the panel opens, through a short-lived
//   signed URL from the backend (owner only). If that URL runs out while
//   watching, a fresh one is fetched and playback resumes where it was.
// - The transcript line being spoken lights up and is kept in view; clicking a
//   line (or its timestamp) jumps there.
//
// Line times are on the call clock (seconds from the start of the call); the
// recording started startOffsetMs later, so media time = line time - offset.
// Where the rep switched recording off mid-call the file holds silence and a
// black picture; playback skips those stretches ("pauses", in media time), and
// lines spoken while it was off are marked as not recorded.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BrutusCallPlayer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MANUAL_SCROLL_HOLD_MS = 4000;
  const LEAD_SEC = 0.15; // light a line up a touch early, as the voice starts

  // ---------------- pure helpers (tested in Node) ----------------

  // Index of the line being spoken at call time `t`: the last line that has
  // started. starts must be ascending; -1 before the first line.
  function activeIndex(starts, t) {
    if (!starts.length || !(t >= starts[0] - LEAD_SEC)) return -1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] - LEAD_SEC <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function mediaTimeForLine(lineSec, offsetSec) {
    return Math.max(0, lineSec - (offsetSec || 0));
  }

  function callTimeForMedia(mediaSec, offsetSec) {
    return mediaSec + (offsetSec || 0);
  }

  // "5000-12000,30000-40000" (ms) -> [[5, 12], [30, 40]] (seconds), sorted.
  function parsePauses(attr) {
    if (!attr || typeof attr !== 'string') return [];
    return attr.split(',')
      .map((part) => part.split('-').map(Number))
      .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > p[0] && p[0] >= 0)
      .map((p) => [p[0] / 1000, p[1] / 1000])
      .sort((a, b) => a[0] - b[0]);
  }

  // The off-stretch media time `t` is in (worth skipping), or null. The last
  // 0.3 s of a stretch counts as past it, so a skip never lands back inside.
  function pauseAt(pauses, t) {
    for (const p of pauses || []) {
      if (t >= p[0] - 0.05 && t < p[1] - 0.3) return p;
      if (p[0] > t) break;
    }
    return null;
  }

  function formatClock(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // The timed lines of a call, for the templates: [{ speaker, text, startSec }]
  // with startSec a number or null. Lines out of order (should not happen)
  // are kept in transcript order; only timed ones take part in highlighting.
  function callLines(call) {
    const raw = call && Array.isArray(call.transcriptLines) ? call.transcriptLines : null;
    if (!raw || !raw.length) return null;
    return raw
      .filter((l) => l && typeof l.text === 'string' && l.text.trim())
      .map((l) => ({
        speaker: l.speaker === 'prospect' ? 'prospect' : 'rep',
        text: l.text,
        startSec: typeof l.startSec === 'number' && Number.isFinite(l.startSec) && l.startSec >= 0 ? l.startSec : null
      }));
  }

  // 'ready' | 'uploading' | 'none'
  function recordingState(call) {
    const rec = call && call.recording;
    if (rec && rec.status === 'ready') return 'ready';
    if (rec && rec.status === 'uploading') return 'uploading';
    return 'none';
  }

  // ---------------- DOM controller ----------------

  const players = new Set();

  function mount(panel, options) {
    if (!panel || panel._brutusPlayer) return panel && panel._brutusPlayer;
    const opts = options || {};
    const rec = panel.querySelector('.p-rec');
    if (!rec) return null;
    const media = rec.querySelector('video.p-rec-video, audio.p-rec-audio');
    const callId = rec.getAttribute('data-call-id');
    const offsetSec = (Number(rec.getAttribute('data-offset-ms')) || 0) / 1000;
    const knownDuration = (Number(rec.getAttribute('data-duration-ms')) || 0) / 1000;
    const playBtn = rec.querySelector('.p-rec-play');
    const track = rec.querySelector('.p-rec-track');
    const fill = rec.querySelector('.p-rec-fill');
    const posEl = rec.querySelector('.p-rec-pos');
    const durEl = rec.querySelector('.p-rec-dur');
    const statusEl = rec.querySelector('.p-rec-status');
    const list = rec.querySelector('.p-rec-turns');
    const turns = Array.from(rec.querySelectorAll('.p-rec-turn[data-start]'));
    const starts = turns.map((el) => Number(el.getAttribute('data-start')));
    const pauses = parsePauses(rec.getAttribute('data-pauses'));
    let skipNoticeTimer = null;

    // Lines said before the recording started or while it was off.
    turns.forEach((el, i) => {
      const mt = starts[i] - offsetSec;
      if (mt < -0.5 || pauseAt(pauses, mt)) {
        el.classList.add('is-unrecorded');
        el.setAttribute('title', 'Not recorded: recording was off here');
      }
    });

    let loading = null;
    let lastRefetch = 0;
    let current = -1;
    let userScrolledAt = 0;
    let programmaticScroll = false;
    let pendingSeek = null;

    const player = { panel, media, seekCallTime, load, pause, destroy };
    panel._brutusPlayer = player;
    players.add(player);

    function setStatus(text) {
      if (statusEl) {
        statusEl.textContent = text || '';
        statusEl.hidden = !text;
      }
    }

    function duration() {
      const d = media && Number(media.duration);
      return Number.isFinite(d) && d > 0 ? d : knownDuration;
    }

    function load() {
      if (!media) return Promise.resolve(false);
      if (media.getAttribute('src')) return Promise.resolve(true);
      if (loading) return loading;
      if (!callId || typeof opts.getUrl !== 'function') return Promise.resolve(false);
      setStatus('loading the recording...');
      loading = Promise.resolve(opts.getUrl(callId))
        .then((res) => {
          if (!res || !res.url) throw new Error('no url');
          media.setAttribute('src', res.url);
          setStatus('');
          return true;
        })
        .catch(() => {
          setStatus("couldn't load the recording. check your connection and try again.");
          return false;
        })
        .finally(() => { loading = null; });
      return loading;
    }

    function setPlayIcon() {
      if (!playBtn) return;
      const playing = media && !media.paused && !media.ended;
      playBtn.classList.toggle('is-playing', !!playing);
      playBtn.setAttribute('aria-label', playing ? 'Pause recording' : 'Play recording');
    }

    function paintProgress() {
      const d = duration();
      const t = media ? Number(media.currentTime) || 0 : 0;
      if (fill) fill.style.width = d > 0 ? `${Math.min(100, (t / d) * 100)}%` : '0%';
      if (posEl) posEl.textContent = formatClock(t);
      if (durEl) durEl.textContent = d > 0 ? formatClock(d) : '';
      if (track) {
        track.setAttribute('aria-valuemax', String(Math.round(d)));
        track.setAttribute('aria-valuenow', String(Math.round(t)));
        track.setAttribute('aria-valuetext', `${formatClock(t)} of ${formatClock(d)}`);
      }
    }

    function scrollLineIntoView(el) {
      if (!list || !el) return;
      if (Date.now() - userScrolledAt < MANUAL_SCROLL_HOLD_MS) return;
      if (list.scrollHeight <= list.clientHeight && typeof el.scrollIntoView === 'function') {
        // The list is not its own scroll box here: scroll the page instead.
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      const top = el.offsetTop - list.offsetTop;
      const bottom = top + el.offsetHeight;
      const viewTop = list.scrollTop;
      const viewBottom = viewTop + list.clientHeight;
      if (top >= viewTop + 8 && bottom <= viewBottom - 8) return;
      programmaticScroll = true;
      const target = Math.max(0, top - list.clientHeight / 3);
      if (typeof list.scrollTo === 'function') list.scrollTo({ top: target, behavior: 'smooth' });
      else list.scrollTop = target;
      setTimeout(() => { programmaticScroll = false; }, 600);
    }

    // Playing (or jumping) into a stretch where recording was off goes straight
    // to where it came back on.
    function skipPause() {
      if (!media || !pauses.length) return false;
      const p = pauseAt(pauses, Number(media.currentTime) || 0);
      if (!p) return false;
      try { media.currentTime = Math.min(p[1], duration() || p[1]); } catch (_) { return false; }
      setStatus("skipped a part of the call that wasn't recorded.");
      if (skipNoticeTimer) clearTimeout(skipNoticeTimer);
      skipNoticeTimer = setTimeout(() => { skipNoticeTimer = null; setStatus(''); }, 4000);
      return true;
    }

    function highlight() {
      if (!media) return;
      const idx = activeIndex(starts, callTimeForMedia(Number(media.currentTime) || 0, offsetSec));
      if (idx === current) return;
      if (current >= 0 && turns[current]) {
        turns[current].classList.remove('is-active');
        turns[current].removeAttribute('aria-current');
      }
      current = idx;
      if (idx >= 0 && turns[idx]) {
        turns[idx].classList.add('is-active');
        turns[idx].setAttribute('aria-current', 'true');
        scrollLineIntoView(turns[idx]);
      }
    }

    function applySeek(mediaSec) {
      try {
        media.currentTime = Math.max(0, Math.min(mediaSec, duration() || mediaSec));
      } catch (_) {
        pendingSeek = mediaSec; // not seekable yet: applied once metadata loads
      }
      paintProgress();
      highlight();
    }

    async function seekMedia(mediaSec, play) {
      if (!media) return;
      userScrolledAt = 0; // a jump always brings its line into view
      const ok = await load();
      if (!ok) return;
      if (media.readyState >= 1) applySeek(mediaSec);
      else pendingSeek = mediaSec;
      if (play) playNow();
    }

    function seekCallTime(callSec, play) {
      return seekMedia(mediaTimeForLine(callSec, offsetSec), play !== false);
    }

    function playNow() {
      const p = media.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }

    async function toggle() {
      if (!media) return;
      if (!media.paused && !media.ended) {
        media.pause();
        return;
      }
      if (await load()) playNow();
    }

    function pause() {
      if (media && !media.paused) media.pause();
    }

    function onTrackPointer(e) {
      const d = duration();
      if (!track || !(d > 0)) return;
      const rect = track.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
      seekMedia(frac * d, false);
    }

    const handlers = [];
    function on(el, type, fn, opt) {
      if (!el) return;
      el.addEventListener(type, fn, opt);
      handlers.push([el, type, fn, opt]);
    }

    on(playBtn, 'click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
    if (track) {
      track.setAttribute('role', 'slider');
      track.setAttribute('tabindex', '0');
      track.setAttribute('aria-label', 'Recording position');
      track.setAttribute('aria-valuemin', '0');
      let dragging = false;
      on(track, 'pointerdown', (e) => {
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch (_) {}
        onTrackPointer(e);
      });
      on(track, 'pointermove', (e) => { if (dragging) onTrackPointer(e); });
      on(track, 'pointerup', () => { dragging = false; });
      on(track, 'pointercancel', () => { dragging = false; });
      on(track, 'keydown', (e) => {
        const t = Number(media && media.currentTime) || 0;
        if (e.key === 'ArrowRight') { e.preventDefault(); seekMedia(t + 5, false); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); seekMedia(t - 5, false); }
        if (e.key === 'Home') { e.preventDefault(); seekMedia(0, false); }
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
    }
    on(list, 'click', (e) => {
      const turn = e.target && e.target.closest ? e.target.closest('.p-rec-turn[data-start]') : null;
      if (!turn) return;
      e.preventDefault();
      seekCallTime(Number(turn.getAttribute('data-start')), true);
    });
    on(list, 'keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const turn = e.target && e.target.closest ? e.target.closest('.p-rec-turn[data-start]') : null;
      if (!turn) return;
      e.preventDefault();
      seekCallTime(Number(turn.getAttribute('data-start')), true);
    });
    on(list, 'scroll', () => { if (!programmaticScroll) userScrolledAt = Date.now(); }, { passive: true });
    on(list, 'wheel', () => { userScrolledAt = Date.now(); }, { passive: true });

    if (media) {
      on(media, 'timeupdate', () => { if (!skipPause()) { paintProgress(); highlight(); } });
      on(media, 'seeked', () => { if (!skipPause()) { paintProgress(); highlight(); } });
      on(media, 'play', setPlayIcon);
      on(media, 'pause', setPlayIcon);
      on(media, 'ended', setPlayIcon);
      on(media, 'durationchange', paintProgress);
      on(media, 'loadedmetadata', () => {
        if (pendingSeek !== null) {
          const s = pendingSeek;
          pendingSeek = null;
          applySeek(s);
        }
        paintProgress();
      });
      on(media, 'error', () => {
        // Most likely the signed URL expired: fetch a fresh one once, resume.
        if (Date.now() - lastRefetch < 10000 || typeof opts.getUrl !== 'function') {
          setStatus("the recording stopped loading. try again in a minute.");
          return;
        }
        lastRefetch = Date.now();
        const at = Number(media.currentTime) || 0;
        const wasPlaying = !media.paused;
        media.removeAttribute('src');
        load().then((ok) => {
          if (!ok) return;
          pendingSeek = at;
          try { media.load(); } catch (_) {}
          if (wasPlaying) playNow();
        });
      });
    }

    function destroy() {
      pause();
      if (skipNoticeTimer) { clearTimeout(skipNoticeTimer); skipNoticeTimer = null; }
      for (const [el, type, fn, opt] of handlers) el.removeEventListener(type, fn, opt);
      handlers.length = 0;
      players.delete(player);
      delete panel._brutusPlayer;
    }

    paintProgress();
    setPlayIcon();
    return player;
  }

  // Pauses every player (the call modal closed or another call opened).
  function stopAll() {
    for (const p of Array.from(players)) {
      if (!p.panel.isConnected) p.destroy();
      else p.pause();
    }
  }

  return {
    activeIndex,
    parsePauses,
    pauseAt,
    mediaTimeForLine,
    callTimeForMedia,
    formatClock,
    callLines,
    recordingState,
    mount,
    stopAll
  };
});
