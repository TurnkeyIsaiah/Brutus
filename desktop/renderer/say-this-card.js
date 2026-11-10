// The "say this" card: one line for the rep to say, on screen until the
// server resolves it, the rep dismisses it, a newer card replaces it, 60s pass
// (the server only times cards out when the next chunk arrives), or the
// session stops. Drawing is injected (overlay.js renders it) so these rules
// can be tested in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrutusSayThisCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createSayThisCard(deps) {
    const view = deps.view;
    const T = Object.assign({
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    }, deps.timers || {});
    const lifetimeMs = deps.lifetimeMs || 60000;
    const log = deps.log || function () {};

    let current = null;
    let timer = null;
    let dismissing = null;

    function clear() {
      if (timer) { T.clearTimeout(timer); timer = null; }
      if (!current) return;
      current = null;
      view.hide();
    }

    return {
      // A newer card replaces the one on screen. Cards come from the server,
      // so one without an id or a line is ignored.
      show(card) {
        if (!card || typeof card.id !== 'string' || typeof card.line !== 'string' || !card.line.trim()) return false;
        if (timer) T.clearTimeout(timer);
        current = card;
        view.show(card);
        if (deps.ping) deps.ping();
        timer = T.setTimeout(() => { timer = null; clear(); }, lifetimeMs);
        return true;
      },

      // Only the card on screen is cleared; a late resolution for a card that
      // was already replaced is ignored.
      resolve(info) {
        if (current && info && info.id === current.id) clear();
      },

      // Tells the server the rep waved the card off, then hides it whatever
      // the answer: a 404 means the server had already cleared it, and on any
      // other failure the rep still asked for it to go.
      async dismiss() {
        const card = current;
        if (!card || card === dismissing) return;
        dismissing = card;
        const sessionId = deps.sessionId();
        try {
          if (sessionId) {
            const res = await deps.post(`/live/say-this/${encodeURIComponent(card.id)}/dismiss`, { sessionId });
            if (!res.ok && res.status !== 404) log(`dismiss failed (${res.status})`);
          }
        } catch (err) {
          log('dismiss failed', err && err.message);
        } finally {
          dismissing = null;
        }
        if (current === card) clear();
      },

      clear,
      get current() { return current; }
    };
  }

  return { createSayThisCard };
});
