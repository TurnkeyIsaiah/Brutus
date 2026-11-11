'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSayThisCard } = require('../renderer/say-this-card.js');
const { createCaptureSession } = require('../renderer/capture/capture-session.js');
const { createEnv, tick } = require('./helpers/fake-capture-env.js');

const cardA = { id: 'card-a', trigger: 'objection', objectionType: 'price', line: "what's it costing you to leave this unfixed?", why: 'back to their pain', source: 'generated', timestamp: 12 };
const cardB = { id: 'card-b', trigger: 'buying_signal', objectionType: null, line: 'want me to walk you through onboarding?', why: 'they asked how it starts', source: 'generated', timestamp: 40 };

function harness(overrides) {
  const view = { shown: [], hides: 0, archived: [] };
  const pings = [];
  const posts = [];
  let clock = 1000;
  const card = createSayThisCard(Object.assign({
    view: {
      show: (c) => view.shown.push(c),
      hide: () => { view.hides += 1; },
      archive: (c, shownAt) => view.archived.push([c, shownAt])
    },
    post: async (path, body) => { posts.push({ path, body }); return { ok: true, status: 200 }; },
    sessionId: () => 'sess-1',
    ping: () => pings.push(1),
    now: () => clock
  }, overrides || {}));
  return { card, view, pings, posts, advance: (ms) => { clock += ms; } };
}

test('a say_this card is shown with a ping; one without an id or line is ignored', () => {
  const h = harness();
  assert.equal(h.card.show(cardA), true);
  assert.deepEqual(h.view.shown, [cardA]);
  assert.equal(h.pings.length, 1);
  assert.equal(h.card.current, cardA);

  assert.equal(h.card.show({ id: 'x', line: '   ' }), false);
  assert.equal(h.card.show({ line: 'no id' }), false);
  assert.equal(h.card.show(null), false);
  assert.equal(h.view.shown.length, 1);
  assert.equal(h.card.current, cardA);
});

test('the card stays up: nothing times it out', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = harness();
  h.card.show(cardA);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(h.card.current, cardA);
  assert.equal(h.view.hides, 0);
  assert.equal(typeof h.card.resolve, 'undefined', 'say_this_resolved has nothing to clear');
});

test('a newer card replaces the one on screen and moves the old line into the feed', () => {
  const h = harness();
  h.card.show(cardA);
  h.advance(5000);
  h.card.show(cardB);
  assert.deepEqual(h.view.shown, [cardA, cardB]);
  assert.equal(h.card.current, cardB);
  assert.equal(h.view.hides, 0, 'replaced in place, not hidden first');
  assert.deepEqual(h.view.archived, [[cardA, 1000]], 'old line in the feed with the time it was shown');

  h.card.show(cardB); // the same card again is not a replacement
  assert.equal(h.view.archived.length, 1);
});

test('stop clears the card without moving it into the feed', () => {
  const h = harness();
  h.card.show(cardA);
  h.card.clear();
  assert.equal(h.view.hides, 1);
  assert.equal(h.card.current, null);
  assert.deepEqual(h.view.archived, []);
  h.card.clear();
  assert.equal(h.view.hides, 1, 'clearing with nothing on screen is a no-op');
});

// × goes through the live session's own POST (session.post), which carries the
// session's token and the X-Brutus-Client header.
async function liveCard(routes) {
  const env = createEnv({ routes });
  const session = createCaptureSession(env.deps());
  await session.start({ screen: false });
  await tick(5);
  const h = harness({ post: (path, body) => session.post(path, body), sessionId: () => session.sessionId });
  return { env, session, h };
}

test('× posts the dismiss with the sessionId through the session, then hides the card', async () => {
  const { env, session, h } = await liveCard({
    '/live/say-this/card-a/dismiss': () => ({ status: 200, body: { ok: true } })
  });
  h.card.show(cardA);
  await h.card.dismiss();

  const [req] = env.requestsTo('/live/say-this/card-a/dismiss');
  assert.deepEqual(req.body, { sessionId: 'sess-1' });
  assert.equal(req.headers['X-Brutus-Client'], 'brutus-desktop');
  assert.equal(req.token, 'token-A');
  assert.equal(h.card.current, null);
  assert.equal(h.view.hides, 1);
  assert.deepEqual(h.view.archived, [], 'a dismissed card does not go into the feed');
  await session.stop({});
});

test('a 404 on dismiss (already cleared on the server) still hides the card', async () => {
  const { env, session, h } = await liveCard({}); // no route: the fake backend answers 404
  h.card.show(cardA);
  await h.card.dismiss();
  assert.equal(env.requestsTo('/live/say-this/card-a/dismiss').length, 1);
  assert.equal(h.card.current, null);
  assert.equal(h.view.hides, 1);
  await session.stop({});
});

test('a failed dismiss still hides the card, and a newer card is left alone', async () => {
  let release;
  const h = harness({ post: () => new Promise((resolve, reject) => { release = reject; }) });
  h.card.show(cardA);
  const dismissing = h.card.dismiss();
  h.card.show(cardB); // a new card lands while the dismiss is in flight
  release(new Error('offline'));
  await dismissing;
  assert.equal(h.card.current, cardB, 'the newer card stays');
  assert.deepEqual(h.view.archived, [], 'the line being dismissed does not go into the feed');

  const failing = harness({ post: async () => { throw new Error('offline'); } });
  failing.card.show(cardA);
  await failing.card.dismiss();
  assert.equal(failing.card.current, null);
  h.card.clear();
});
