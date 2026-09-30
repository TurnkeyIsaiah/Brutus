// Holds every audio chunk of a live session until the backend confirms it.
// Protocol v2 backends ack each chunk (`chunk_ack`); unacked chunks are replayed
// in seq order after a reconnect. Older backends never ack, so in legacy mode a
// chunk counts as delivered once it has been written to an open socket, and
// chunks produced while offline wait for the next connection instead of being
// dropped. Memory only — audio is never written to disk.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrutusChunkOutbox = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TERMINAL = new Set(['stored', 'empty', 'failed', 'rejected']);

  function createChunkOutbox(options) {
    const opts = options || {};
    const send = opts.send;
    const maxPending = opts.maxPending || 20;
    const maxInFlight = opts.maxInFlight || 3;
    const setTimer = opts.setTimeout || setTimeout;
    const clearTimer = opts.clearTimeout || clearTimeout;
    const onFatal = opts.onFatal || function () {};
    const onChange = opts.onChange || function () {};

    let sessionId = null;
    let seq = 0;
    let ackMode = false;
    let connected = false;
    let lost = 0;
    let entries = []; // { seq, payload, sent: bool, replay: bool, notBefore: number }
    let retryTimer = null;
    let drainWaiters = [];

    function counts() {
      let inFlight = 0;
      for (const e of entries) if (e.sent) inFlight++;
      return { pending: entries.length, inFlight, lost };
    }

    function notify() {
      onChange(counts());
      if (entries.length === 0 && drainWaiters.length) {
        const waiters = drainWaiters;
        drainWaiters = [];
        waiters.forEach((w) => w.finish(true));
      }
    }

    function clearRetry() {
      if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
    }

    function scheduleRetry(delayMs) {
      clearRetry();
      retryTimer = setTimer(() => { retryTimer = null; pump(); }, Math.max(0, delayMs));
    }

    function message(entry) {
      const payload = Object.assign({}, entry.payload, { sessionId, seq: entry.seq });
      if (entry.replay) {
        payload.replay = true;
        payload.screenshot = null; // a stale screen is useless to the coach
      }
      return { type: 'monitoring_data', payload };
    }

    function pump() {
      if (!connected || !sessionId) return;
      const now = Date.now();
      let inFlight = 0;
      for (const e of entries) if (e.sent) inFlight++;
      let waitMs = null;
      for (const e of entries.slice()) {
        if (e.sent) continue;
        if (ackMode && inFlight >= maxInFlight) break;
        if (e.notBefore && e.notBefore > now) {
          const wait = e.notBefore - now;
          waitMs = waitMs === null ? wait : Math.min(waitMs, wait);
          continue;
        }
        if (!send(message(e))) break; // socket closed underneath us
        if (ackMode) {
          e.sent = true;
          inFlight++;
        } else {
          entries = entries.filter((x) => x !== e);
        }
      }
      if (waitMs !== null) scheduleRetry(waitMs);
      notify();
    }

    return {
      reset(nextSessionId) {
        clearRetry();
        sessionId = nextSessionId || null;
        seq = 0;
        lost = 0;
        entries = [];
        const waiters = drainWaiters;
        drainWaiters = [];
        waiters.forEach((w) => w.finish(false));
        notify();
      },

      enqueue(payload) {
        if (!sessionId) return null;
        seq += 1;
        entries.push({ seq, payload, sent: false, replay: false, notBefore: 0 });
        while (entries.length > maxPending) {
          entries.shift();
          lost += 1;
        }
        pump();
        return seq;
      },

      onConnected(info) {
        connected = true;
        ackMode = !!(info && info.ackMode);
        // Anything written to the old socket but never acked goes again.
        for (const e of entries) {
          if (e.sent) { e.sent = false; e.replay = true; }
        }
        pump();
      },

      onDisconnected() {
        connected = false;
        clearRetry();
        notify();
      },

      onAck(ack) {
        if (!ack || ack.sessionId !== sessionId) return;
        const entry = entries.find((e) => e.seq === ack.seq);
        if (!entry) return; // duplicate or already settled
        if (ack.status === 'retry') {
          entry.sent = false;
          entry.replay = true;
          entry.notBefore = Date.now() + (Number(ack.retryAfterMs) || 2000);
          pump();
          return;
        }
        if (!TERMINAL.has(ack.status)) return;
        entries = entries.filter((e) => e !== entry);
        if (ack.status === 'rejected' && ack.reason === 'session_not_active') {
          onFatal(ack);
        }
        pump();
      },

      // Resolves true once every chunk is settled, false on timeout.
      drain(timeoutMs) {
        if (entries.length === 0) return Promise.resolve(true);
        return new Promise((resolve) => {
          const waiter = {
            finish(ok) { clearTimer(waiter.timer); resolve(ok); }
          };
          waiter.timer = setTimer(() => {
            drainWaiters = drainWaiters.filter((w) => w !== waiter);
            resolve(false);
          }, timeoutMs);
          drainWaiters.push(waiter);
        });
      },

      lastSeq() { return seq; },
      isAckMode() { return ackMode; },
      stats() { return counts(); }
    };
  }

  return { createChunkOutbox };
});
