// The "say this" card: one line for the rep to say. It stays on screen, like
// feedback, so a rep who reads slowly or isn't ready yet can still use it,
// until a newer card replaces it (the old one moves into the feed), the rep
// dismisses it with ×, or the session stops. The server's say_this_resolved
// does not hide it. Drawing is injected (overlay.js renders it) so these rules
// can be tested in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrutusSayThisCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createSayThisCard(deps) {
    const view = deps.view;
    const now = deps.now || (() => Date.now());
    const log = deps.log || function () {};

    let current = null;
    let shownAt = 0;
    let dismissing = null;

    function clear() {
      if (!current) return;
      current = null;
      view.hide();
    }

    return {
      // A newer card replaces the one on screen, which moves into the feed
      // (unless the rep was already dismissing it). Cards come from the
      // server, so one without an id or a line is ignored.
      show(card) {
        if (!card || typeof card.id !== 'string' || typeof card.line !== 'string' || !card.line.trim()) return false;
        if (current && current.id !== card.id && current !== dismissing) view.archive(current, shownAt);
        current = card;
        shownAt = now();
        view.show(card);
        if (deps.ping) deps.ping();
        return true;
      },

      // Tells the server the rep waved the card off, then hides it (it does not
      // go into the feed) whatever the answer: a 404 means the server had
      // already cleared it, and on any other failure the rep still asked for
      // it to go.
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

      // The session stopped.
      clear,
      get current() { return current; }
    };
  }

  return { createSayThisCard };
});
