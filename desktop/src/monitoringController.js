// Main-process owner of "is Brutus monitoring a call". The overlay does the
// recording; this decides when it may start and makes every way of leaving a
// call (Stop, logout, quit, update, closing the overlay, a renderer crash) end
// the session instead of dropping it.

function createMonitoringController(deps) {
  const {
    showOverlay,
    sendToOverlay,
    isOverlayReady,
    hasAuth,
    endSessionRemote,
    onChange = () => {},
    onFinished = () => {},
    setTimeout: setTimer = setTimeout,
    clearTimeout: clearTimer = clearTimeout,
    stopTimeoutMs = 45000
  } = deps;

  let active = false;
  let pendingStart = false;
  let stopping = null;
  let capture = { state: 'idle', sessionId: null };

  function overlayBusy() {
    return capture.state !== 'idle';
  }

  function state() {
    if (stopping) return 'stopping';
    return active ? 'live' : 'idle';
  }

  function start() {
    if (stopping) return { ok: false, reason: 'stopping' };
    if (!hasAuth()) return { ok: false, reason: 'signed_out' };
    if (active) {
      showOverlay();
      return { ok: true, already: true };
    }
    active = true;
    showOverlay();
    if (isOverlayReady()) sendToOverlay('monitoring-started');
    else pendingStart = true;
    onChange(state());
    return { ok: true };
  }

  // The overlay page announces itself once its listeners exist, so a start
  // requested while it was still loading is delivered exactly once.
  function overlayReady() {
    if (pendingStart && active) {
      pendingStart = false;
      sendToOverlay('monitoring-started');
    }
  }

  function finishStop(info) {
    if (!stopping) return;
    const current = stopping;
    stopping = null;
    clearTimer(current.timer);
    onChange(state());
    onFinished(info);
    current.resolve(info);
  }

  function requestStop(options) {
    const opts = options || {};
    if (stopping) return stopping.promise;
    if (!active && !overlayBusy()) return Promise.resolve({ stopped: false });
    active = false;
    pendingStart = false;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const timer = setTimer(() => finishStop({ timedOut: true }), opts.timeoutMs || stopTimeoutMs);
    stopping = { promise, resolve, timer };
    onChange(state());
    if (isOverlayReady()) {
      sendToOverlay('monitoring-stopped', { reason: opts.reason || 'user', mode: opts.mode === 'cancel' ? 'cancel' : 'end' });
    } else {
      finishStop({ noOverlay: true });
    }
    return promise;
  }

  function onCaptureState(next) {
    if (!next || typeof next.state !== 'string') return;
    capture = { state: next.state, sessionId: next.sessionId || null };
  }

  function onOverlayStopped(info) {
    capture = { state: 'idle', sessionId: null };
    if (stopping) {
      finishStop(Object.assign({ stopped: true }, info || {}));
    } else if (active) {
      // The overlay ended on its own (declined consent, failed start, billing).
      active = false;
      pendingStart = false;
      onChange(state());
      onFinished(Object.assign({ stopped: true }, info || {}));
    }
  }

  // The overlay renderer died mid-call. Whatever reached the server is kept by
  // ending the session from here.
  function onOverlayGone() {
    const sessionId = capture.sessionId;
    capture = { state: 'idle', sessionId: null };
    active = false;
    pendingStart = false;
    if (sessionId) {
      Promise.resolve(endSessionRemote(sessionId)).catch(() => {});
    }
    if (stopping) finishStop({ crashed: true, sessionId });
    else {
      onChange(state());
      onFinished({ crashed: true, sessionId });
    }
  }

  return {
    start,
    requestStop,
    overlayReady,
    onCaptureState,
    onOverlayStopped,
    onOverlayGone,
    state,
    isActive: () => active,
    needsStop: () => active || overlayBusy() || !!stopping
  };
}

module.exports = { createMonitoringController };
