'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSayThisCard } = require('../renderer/say-this-card.js');
const { createCaptureSession } = require('../renderer/capture/capture-session.js');
const { createEnv, tick } = require('./helpers/fake-capture-env.js');

const cardA = { id: 'card-a', trigger: 'objection', objectionType: 'price', line: "what's it costing you to leave this unfixed?", why: 'back to their pain', source: 'generated', timestamp: 12 };
const cardB = { id: 'card-b', trigger: 'buying_signal', objectionType: null, line: 'want me to walk you through onboarding?', why: 'they asked how it starts', source: 'generated', timestamp: 40 };

function harness(overrides) {
  const view = { shown: [], hides: 0 };
  const pings = [];
  const posts = [];
  const card = createSayThisCard(Object.assign({
    view: { show: (c) => view.shown.push(c), hide: () => { view.hides += 1; } },
    post: async (path, body) => { posts.push({ path, body }); return { ok: true, status: 200 }; },
    sessionId: () => 'sess-1',
    ping: () => pings.push(1)
  }, overrides || {}));
  return { card, view, pings, posts };
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
  h.card.clear();
});

test('only a resolution for the card on screen clears it', () => {
  const h = harness();
  h.card.show(cardA);
  h.card.resolve({ id: 'some-other-card', resolution: 'used' });
  assert.equal(h.view.hides, 0);
  assert.equal(h.card.current, cardA);

  h.card.resolve({ id: 'card-a', resolution: 'handled' });
  assert.equal(h.view.hides, 1);
  assert.equal(h.card.current, null);
});

test('a newer card replaces the one on screen', () => {
  const h = harness();
  h.card.show(cardA);
  h.card.show(cardB);
  assert.deepEqual(h.view.shown, [cardA, cardB]);
  assert.equal(h.card.current, cardB);
  assert.equal(h.view.hides, 0, 'replaced in place, not hidden first');

  h.card.resolve({ id: 'card-a', resolution: 'replaced' }); // the old card's late resolution
  assert.equal(h.card.current, cardB);
  h.card.clear();
});

test('the card clears itself after 60 seconds, counted from the newest card', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  h.card.show(cardA);
  t.mock.timers.tick(40000);
  h.card.show(cardB); // restarts the clock
  t.mock.timers.tick(59999);
  assert.equal(h.card.current, cardB);
  assert.equal(h.view.hides, 0);
  t.mock.timers.tick(1);
  assert.equal(h.card.current, null);
  assert.equal(h.view.hides, 1);
});

test('stop clears the card and its timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  h.card.show(cardA);
  h.card.clear();
  assert.equal(h.view.hides, 1);
  assert.equal(h.card.current, null);
  t.mock.timers.tick(60000);
  assert.equal(h.view.hides, 1, 'the 60s timer was cancelled');
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

  const failing = harness({ post: async () => { throw new Error('offline'); } });
  failing.card.show(cardA);
  await failing.card.dismiss();
  assert.equal(failing.card.current, null);
  h.card.clear();
});
