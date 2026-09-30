'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChunkOutbox } = require('../renderer/capture/chunk-outbox.js');

function harness(options) {
  const sent = [];
  let open = true;
  const fatal = [];
  const outbox = createChunkOutbox(Object.assign({
    send: (msg) => { if (!open) return false; sent.push(msg); return true; },
    onFatal: (ack) => fatal.push(ack)
  }, options || {}));
  return {
    outbox,
    sent,
    fatal,
    setOpen(value) { open = value; },
    seqs: () => sent.map((m) => m.payload.seq)
  };
}

const chunk = (n) => ({ repAudio: `a${n}`, prospectAudio: null, screenshot: `s${n}`, timeIntoCall: n * 30 });

test('assigns seq 1, 2, 3 per session and stamps the session id', () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  h.outbox.enqueue(chunk(1));
  h.outbox.enqueue(chunk(2));
  assert.deepEqual(h.seqs(), [1, 2]);
  assert.equal(h.sent[0].payload.sessionId, 's1');
  assert.equal(h.outbox.lastSeq(), 2);

  h.outbox.reset('s2');
  h.outbox.enqueue(chunk(1));
  assert.equal(h.outbox.lastSeq(), 1);
});

test('ack mode keeps chunks until acked and replays unacked ones in order after reconnect', () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  h.outbox.enqueue(chunk(1));
  h.outbox.enqueue(chunk(2));
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'stored' });

  h.outbox.onDisconnected();
  h.setOpen(false);
  h.outbox.enqueue(chunk(3)); // produced while offline
  h.setOpen(true);
  h.sent.length = 0;
  h.outbox.onConnected({ ackMode: true });

  assert.deepEqual(h.seqs(), [2, 3]);
  assert.equal(h.sent[0].payload.replay, true, 'seq 2 was sent before, so it is a replay');
  assert.equal(h.sent[0].payload.screenshot, null, 'replays drop the stale screenshot');
  assert.equal(h.sent[1].payload.replay, undefined, 'seq 3 was never sent');
});

test('never more than three unacked chunks in flight', () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  for (let i = 1; i <= 5; i++) h.outbox.enqueue(chunk(i));
  assert.deepEqual(h.seqs(), [1, 2, 3]);
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'stored' });
  assert.deepEqual(h.seqs(), [1, 2, 3, 4]);
});

test('duplicate, unknown and other-session acks are ignored', () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  h.outbox.enqueue(chunk(1));
  h.outbox.onAck({ sessionId: 'other', seq: 1, status: 'stored' });
  assert.equal(h.outbox.stats().pending, 1);
  h.outbox.onAck({ sessionId: 's1', seq: 99, status: 'stored' });
  assert.equal(h.outbox.stats().pending, 1);
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'stored' });
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'stored' });
  assert.equal(h.outbox.stats().pending, 0);
});

test('failed and rejected acks settle the chunk; session_not_active is fatal', () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  h.outbox.enqueue(chunk(1));
  h.outbox.enqueue(chunk(2));
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'failed' });
  h.outbox.onAck({ sessionId: 's1', seq: 2, status: 'rejected', reason: 'session_not_active' });
  assert.equal(h.outbox.stats().pending, 0);
  assert.equal(h.fatal.length, 1);
});

test('a retry ack resends the same seq after the delay', async () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  h.outbox.enqueue(chunk(1));
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'retry', retryAfterMs: 20 });
  assert.deepEqual(h.seqs(), [1]);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(h.seqs(), [1, 1]);
  assert.equal(h.sent[1].payload.replay, true);
});

test('legacy mode (old backend) sends when connected and holds chunks while offline', () => {
  const h = harness();
  h.outbox.reset('s1');
  h.setOpen(false);
  h.outbox.enqueue(chunk(1));
  assert.equal(h.sent.length, 0);
  h.setOpen(true);
  h.outbox.onConnected({ ackMode: false });
  assert.deepEqual(h.seqs(), [1]);
  assert.equal(h.outbox.stats().pending, 0, 'no ack expected from an old backend');
});

test('the cap evicts the oldest chunk and counts it as lost', () => {
  const h = harness({ maxPending: 2 });
  h.outbox.reset('s1');
  h.setOpen(false);
  h.outbox.enqueue(chunk(1));
  h.outbox.enqueue(chunk(2));
  h.outbox.enqueue(chunk(3));
  assert.equal(h.outbox.stats().lost, 1);
  h.setOpen(true);
  h.outbox.onConnected({ ackMode: true });
  assert.deepEqual(h.seqs(), [2, 3]);
});

test('drain resolves true once everything is acked and false on timeout', async () => {
  const h = harness();
  h.outbox.reset('s1');
  h.outbox.onConnected({ ackMode: true });
  h.outbox.enqueue(chunk(1));
  const draining = h.outbox.drain(1000);
  h.outbox.onAck({ sessionId: 's1', seq: 1, status: 'stored' });
  assert.equal(await draining, true);

  h.outbox.enqueue(chunk(2));
  assert.equal(await h.outbox.drain(20), false);
});

test('enqueue without a session is refused', () => {
  const h = harness();
  assert.equal(h.outbox.enqueue(chunk(1)), null);
  assert.equal(h.sent.length, 0);
});
