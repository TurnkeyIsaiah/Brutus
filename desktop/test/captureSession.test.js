'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaptureSession } = require('../renderer/capture/capture-session.js');
const { createEnv, deferred, tick } = require('./helpers/fake-capture-env.js');

async function waitFor(predicate, label, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await tick(2);
  }
}

async function startLive(env, options) {
  const session = createCaptureSession(env.deps(options && options.config));
  const started = session.start({ screen: !!(options && options.screen) });
  await started;
  assert.equal(session.state, 'live');
  await waitFor(() => env.sockets.length > 0 && env.sockets[0].readyState === 1, 'socket open');
  await tick(5);
  return session;
}

test('stop during the consent screen starts nothing', async () => {
  const env = createEnv({ autoConsent: false });
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: true });
  await waitFor(() => env.consent, 'consent prompt');

  await session.stop({ reason: 'user' });
  await started;

  assert.equal(session.state, 'idle');
  assert.equal(env.requestsTo('/live/start').length, 0);
  assert.equal(env.micStream, undefined, 'mic never opened');
  assert.equal(env.sockets.length, 0);
  assert.ok(env.ipcCalls.some(([name]) => name === 'overlayStopped'));
});

test('declining consent stops monitoring without contacting the server', async () => {
  const env = createEnv({ autoConsent: false });
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: false });
  await waitFor(() => env.consent, 'consent prompt');
  env.consent.resolve(false);
  await started;

  assert.equal(session.state, 'idle');
  assert.equal(env.requests.length, 0);
  assert.ok(env.ipcCalls.some(([name]) => name === 'stopMonitoring'));
});

test('the notice the rep accepted goes to /live/start as consent evidence', async () => {
  const notice = {
    accepted: true,
    version: 'REC-2026-11-12',
    variant: 'audio',
    text: 'recording notice\nget consent before you record',
    action: 'i have consent — continue',
    shownAt: '2026-11-12T10:00:00.000Z',
    acceptedAt: '2026-11-12T10:00:04.000Z'
  };
  const env = createEnv({ autoConsent: false });
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: false });
  await waitFor(() => env.consent, 'consent prompt');
  env.consent.resolve(notice);
  await started;

  assert.equal(session.state, 'live');
  assert.deepEqual(env.requestsTo('/live/start')[0].body, { consent: notice });
  await session.stop({});
});

test('a plain yes from the consent prompt starts with an empty body', async () => {
  const env = createEnv();
  const session = await startLive(env);
  assert.deepEqual(env.requestsTo('/live/start')[0].body, {});
  await session.stop({});
});

test('stop during the source picker starts nothing', async () => {
  const env = createEnv();
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: true });
  await waitFor(() => env.picker, 'picker');

  await session.stop({});
  await started;

  assert.equal(env.requestsTo('/live/start').length, 0);
  assert.equal(env.micStream, undefined);
});

test('stop while /live/start is in flight cancels the session it created, and never opens the mic', async () => {
  const gate = deferred();
  const env = createEnv({
    routes: {
      '/live/start': async () => { await gate.promise; return { status: 200, body: { session: { id: 'late-1' } } }; }
    }
  });
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: false });
  await waitFor(() => env.requestsTo('/live/start').length === 1, '/live/start');

  const stopped = session.stop({});
  gate.resolve();
  await Promise.all([started, stopped]);

  assert.equal(env.micStream, undefined, 'mic never opened');
  assert.equal(env.sockets.length, 0, 'no socket opened');
  const cancels = env.requestsTo('/live/cancel');
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].body.sessionId, 'late-1');
  assert.equal(env.requestsTo('/live/end').length, 0);
  assert.equal(session.state, 'idle');
});

test('stop while the mic permission is pending releases the mic when it arrives', async () => {
  const env = createEnv();
  env.micGate = deferred();
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: false });
  await waitFor(() => env.requestsTo('/live/start').length === 1, '/live/start');
  await tick(5);

  const stopped = session.stop({});
  env.micGate.resolve();
  await Promise.all([started, stopped]);

  assert.ok(env.micStream, 'mic was granted');
  assert.ok(env.micStream.getTracks().every((t) => t.readyState === 'ended'), 'mic released');
  assert.equal(env.recorders.length, 0, 'never recorded');
  assert.equal(env.requestsTo('/live/cancel').length, 1);
});

test('a denied microphone aborts the start, cancels the session and says why', async () => {
  const env = createEnv();
  env.micError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const session = createCaptureSession(env.deps());
  await session.start({ screen: false });

  assert.equal(session.state, 'idle');
  assert.equal(env.requestsTo('/live/cancel').length, 1);
  assert.ok(env.feedback.some(([type, text]) => type === 'critical' && /microphone/.test(text)));
  assert.ok(env.ipcCalls.some(([name]) => name === 'stopMonitoring'));
  assert.equal(env.sockets.length, 0);
});

test('an out-of-tokens start shows the real reason, not "check your backend"', async () => {
  const env = createEnv({
    routes: {
      '/live/start': () => ({ status: 403, body: { error: { code: 'OUT_OF_TOKENS', message: "you're out of tokens." } } })
    }
  });
  const session = createCaptureSession(env.deps());
  await session.start({ screen: false });

  assert.deepEqual(env.feedback.at(-1), ['critical', "you're out of tokens."]);
  assert.equal(env.micStream, undefined);
});

test('audio-only asks main for computer audio with no window and never keeps video', async () => {
  const env = createEnv({ autoPick: null });
  const session = await startLive(env, { screen: true });

  assert.deepEqual(env.intents[0], { screenSourceId: null, systemAudio: true });
  assert.ok(env.displayStream.getVideoTracks().every((t) => t.readyState === 'ended'), 'video dropped');
  assert.ok(env.displayStream.getAudioTracks().every((t) => t.readyState === 'live'), 'call audio kept');
  assert.equal(env.liveInfo.screen, false);

  await session.stop({});
  assert.equal(env.screenshots, 0);
});

test('a picked window is requested by id', async () => {
  const env = createEnv({ autoPick: 'window:42:0' });
  const session = await startLive(env, { screen: true });
  assert.deepEqual(env.intents[0], { screenSourceId: 'window:42:0', systemAudio: true });
  assert.equal(env.liveInfo.screen, true);
  await session.stop({});
});

test('stop sends the final chunk, waits for its ack, then ends with lastSeq', async () => {
  const env = createEnv();
  const session = await startLive(env);

  const result = await session.stop({ reason: 'user' });

  const chunks = env.monitoringMessages();
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].payload.seq, 1);
  assert.equal(chunks[0].payload.sessionId, 'sess-1');
  const ends = env.requestsTo('/live/end');
  assert.equal(ends.length, 1);
  assert.deepEqual(ends[0].body, { sessionId: 'sess-1', lastSeq: 1 });
  assert.equal(result.ok, true);
  assert.equal(session.state, 'idle');
  assert.ok(env.micStream.getTracks().every((t) => t.readyState === 'ended'));
});

test('against an old backend (no acks) the final chunk is sent, then a grace period, then /live/end', async () => {
  const env = createEnv({ ackMode: false });
  const session = await startLive(env);
  const result = await session.stop({});

  assert.equal(env.monitoringMessages().length, 1);
  assert.equal(env.requestsTo('/live/end').length, 1);
  assert.ok(env.feedback.some(([, text]) => /finishing/.test(text)));
  assert.equal(result.ok, true);
});

test('audio recorded while offline is delivered after the socket reconnects', async () => {
  const env = createEnv();
  const session = await startLive(env, { config: { drainMs: 3000 } });

  env.autoOpen = false;
  env.sockets[0].serverClose(1006); // connection drops
  const stopping = session.stop({});

  // The reconnect (1s backoff while stopping) opens a new socket; let it through.
  await waitFor(() => env.sockets.length === 2, 'reconnect', 3000);
  env.sockets[1].serverOpen();
  await stopping;

  const chunks = env.sockets[1].sent.filter((m) => m.type === 'monitoring_data');
  assert.equal(chunks.length, 1, 'chunk delivered on the new socket');
  assert.equal(env.requestsTo('/live/end')[0].body.lastSeq, 1);
});

test('stop uses the credentials the session started with, even after a login change', async () => {
  const env = createEnv();
  const session = await startLive(env);
  env.token = 'token-B'; // someone else logs in mid-call

  await session.stop({});
  assert.equal(env.requestsTo('/live/end')[0].token, 'token-A');

  // The next session picks up the new account.
  await session.start({ screen: false });
  await tick(5);
  assert.equal(env.requestsTo('/live/start').at(-1).token, 'token-B');
  await session.stop({});
});

test('a revoked token (close 4001) stops the session instead of reconnecting', async () => {
  const env = createEnv();
  const session = await startLive(env);
  env.sockets[0].serverClose(4001);
  await waitFor(() => session.state === 'idle', 'session stopped');
  await tick(50);

  assert.equal(env.sockets.length, 1, 'no reconnect attempt');
  assert.ok(env.ipcCalls.some(([name]) => name === 'stopMonitoring'));
  assert.ok(env.feedback.some(([type, text]) => type === 'critical' && /signed out/.test(text)));
});

test('no socket is opened after the session has stopped', async () => {
  const env = createEnv();
  const session = await startLive(env);
  env.autoOpen = false;
  env.sockets[0].serverClose(1006); // schedules a reconnect
  await session.stop({});
  const count = env.sockets.length;
  await tick(1200);
  assert.equal(env.sockets.length, count, 'reconnect timer was cleared');
});

test('a failed /live/end is reported as a failure', async () => {
  const env = createEnv({
    routes: { '/live/end': () => ({ status: 500, body: { error: { message: 'boom' } } }) }
  });
  const session = await startLive(env);
  const result = await session.stop({});
  assert.equal(result.ok, false);
  assert.equal(env.requestsTo('/live/end').length, 3, 'retried twice');
  assert.equal(env.stoppedResults.at(-1).ok, false);
});

test('an out-of-tokens message mid-call ends the session', async () => {
  const env = createEnv();
  const session = await startLive(env);
  env.sockets[0].serverSend({ type: 'brutus_feedback', payload: { type: 'error', code: 'OUT_OF_TOKENS', text: 'out of tokens' } });
  await waitFor(() => session.state === 'idle', 'session stopped');
  assert.ok(env.feedback.some(([type, text]) => type === 'critical' && text === 'out of tokens'));
  assert.equal(env.requestsTo('/live/end').length, 1);
});

test('stop is idempotent while a stop is running', async () => {
  const env = createEnv();
  const session = await startLive(env);
  const a = session.stop({});
  const b = session.stop({});
  assert.equal(a, b);
  await a;
  assert.equal(env.requestsTo('/live/end').length, 1);
});

test('a connection that silently stops answering is replaced and unacked audio is replayed', async () => {
  const env = createEnv();
  const session = await startLive(env, { config: { heartbeatMs: 40, drainMs: 3000 } });
  env.sockets[0].silent = true; // still looks open, but nothing reaches the server any more
  const stopping = session.stop({});
  await waitFor(() => env.sockets.length >= 2, 'heartbeat replaced the dead socket', 3000);
  await stopping;
  const replayed = env.sockets.slice(1).flatMap((s) => s.sent.filter((m) => m.type === 'monitoring_data'));
  assert.ok(replayed.some((m) => m.payload.seq === 1 && m.payload.replay === true), 'final chunk replayed on the new socket');
  assert.equal(env.requestsTo('/live/end')[0].body.lastSeq, 1);
  assert.ok(!env.feedback.some(([, text]) => /could not be sent/.test(text)), 'nothing lost');
});

test('the client pings while connected and a live socket is kept', async () => {
  const env = createEnv();
  const session = await startLive(env, { config: { heartbeatMs: 30 } });
  await tick(200);
  assert.equal(env.sockets.length, 1, 'healthy socket not replaced');
  assert.ok(env.sockets[0].sent.filter((m) => m.type === 'ping').length >= 3, 'pings sent');
  await session.stop({});
});

test('a slow handshake (4001 Auth timeout) reconnects instead of ending the call', async () => {
  const env = createEnv();
  const session = await startLive(env);
  env.sockets[0].serverClose(4001, 'Auth timeout');
  await waitFor(() => env.sockets.length === 2, 'reconnect', 3000);
  assert.equal(session.state, 'live');
  assert.ok(!env.ipcCalls.some(([name]) => name === 'stopMonitoring'));
  await session.stop({});
});

test('a socket that never finishes its handshake is replaced', async () => {
  const env = createEnv();
  const session = await startLive(env, { config: { connectTimeoutMs: 60, reconnectMaxMs: 50 } });
  env.autoOpen = 'no-connected'; // next sockets open but the server never says connected
  env.sockets[0].serverClose(1006);
  await waitFor(() => env.sockets.length >= 3, 'hung handshake replaced', 3000);
  await session.stop({ mode: 'cancel' });
});

// ---------------- utterance chunking (fake clock, shipped thresholds) ----------------

const SPEECH = 0.05;
const CLOCKED = { heartbeatMs: 1e9 }; // keep the heartbeat out of fake time

function say(env, ms, channel = 'rep') {
  env[`${channel}Level`] = SPEECH;
  env.clock.advance(ms);
  env[`${channel}Level`] = 0;
}

test('a pause after speech ends the chunk; silence and a short pause do not', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: CLOCKED });

  env.clock.advance(3000); // nobody talking
  say(env, 1000);
  env.clock.advance(500); // a 500ms pause is not the end of the utterance
  await tick(20);
  assert.equal(env.monitoringMessages().length, 0);

  say(env, 500);
  env.clock.advance(700);
  await waitFor(() => env.monitoringMessages().length === 1, 'chunk after the pause');
  const chunk = env.monitoringMessages()[0].payload;
  assert.equal(chunk.seq, 1);
  assert.ok(chunk.repAudio && chunk.prospectAudio, 'both channels flushed together');
  assert.deepEqual(env.chunkLogs()[0].slice(0, 3), ['chunk', 'pause', '5700ms']);

  // The final flush, acks and lastSeq work as before.
  await session.stop({});
  const chunks = env.monitoringMessages();
  assert.deepEqual(chunks.map((m) => m.payload.seq), [1, 2]);
  assert.equal(env.requestsTo('/live/end')[0].body.lastSeq, 2);
  assert.ok(!env.feedback.some(([, text]) => /could not be sent/.test(text)), 'every chunk acked');
});

test('a pause never flushes a chunk shorter than 1.5s', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: CLOCKED });

  say(env, 300);
  env.clock.advance(700); // utterance over at 1.0s
  await tick(20);
  assert.equal(env.monitoringMessages().length, 0);

  env.clock.advance(500);
  await waitFor(() => env.monitoringMessages().length === 1, 'chunk at the floor');
  assert.deepEqual(env.chunkLogs()[0].slice(0, 3), ['chunk', 'pause', '1500ms']);
  await session.stop({});
});

test('a long monologue is cut every 8 seconds', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: CLOCKED });

  say(env, 20000);
  await waitFor(() => env.monitoringMessages().length === 2, 'two capped chunks');
  assert.deepEqual(env.chunkLogs().map((entry) => entry.slice(1, 3)), [['cap', '8000ms'], ['cap', '8000ms']]);
  await session.stop({});
});

test('the prospect finishing ends the chunk even while the rep keeps talking', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: CLOCKED });

  env.repLevel = SPEECH;
  say(env, 2000, 'prospect');
  env.clock.advance(700);
  env.repLevel = 0;
  await waitFor(() => env.monitoringMessages().length === 1, 'chunk after the prospect stopped');
  assert.deepEqual(env.chunkLogs()[0].slice(0, 3), ['chunk', 'pause', '2700ms']);
  await session.stop({});
});

test('no more than maxChunksPerMinute chunks go out in any minute', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: Object.assign({ maxChunksPerMinute: 3 }, CLOCKED) });

  for (let i = 0; i < 20; i++) { // a pause every 1.7s, for 34s
    say(env, 1000);
    env.clock.advance(700);
  }
  assert.equal(env.chunkLogs().length, 3);

  env.clock.advance(27000); // 61s in: the first chunk (at 1.7s) is still inside the minute
  assert.equal(env.chunkLogs().length, 3);
  env.clock.advance(1000);
  assert.equal(env.chunkLogs().length, 4, 'budget frees up after a minute');

  await waitFor(() => env.monitoringMessages().length === 4, 'four chunks sent');
  await session.stop({});
});

test('screenshots are taken about every 2 minutes, whatever the chunk count', async () => {
  const env = createEnv({ clock: true, autoPick: 'window:42:0' });
  const session = await startLive(env, { screen: true, config: CLOCKED });

  for (let i = 1; i <= 38; i++) { // ~5 minutes of 8s chunks
    env.clock.advance(8000);
    await waitFor(() => env.monitoringMessages().length === i, `chunk ${i}`);
  }
  assert.equal(env.screenshots, 2);
  const shotSeqs = env.monitoringMessages().filter((m) => m.payload.screenshot).map((m) => m.payload.seq);
  assert.deepEqual(shotSeqs, [15, 30]);
  await session.stop({});
});

// ---------------- "say this" events ----------------

test('say_this, say_this_resolved and awaiting_rep_reply reach the ui with their timing', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: CLOCKED });

  say(env, 1000);
  env.clock.advance(700);
  await waitFor(() => env.monitoringMessages().length === 1, 'chunk sent');
  const { timeIntoCall } = env.monitoringMessages()[0].payload;

  const card = {
    id: 'card-1', trigger: 'objection', objectionType: 'price',
    line: "what's it costing you to leave this unfixed?", why: 'back to their pain',
    source: 'generated', timestamp: timeIntoCall
  };
  env.clock.advance(1200);
  env.sockets[0].serverSend({ type: 'say_this', payload: card });
  env.clock.advance(300);
  const question = { sessionId: 'sess-1', questionText: 'how long does setup take?', timestamp: timeIntoCall };
  env.sockets[0].serverSend({ type: 'awaiting_rep_reply', payload: question });
  env.sockets[0].serverSend({ type: 'say_this_resolved', payload: { id: 'card-1', resolution: 'used' } });

  assert.deepEqual(env.sayThis, [[card, { sinceChunkMs: 1200 }]]);
  assert.deepEqual(env.awaiting, [[question, { sinceChunkMs: 1500 }]]);
  assert.deepEqual(env.resolved, [[{ id: 'card-1', resolution: 'used' }, { sinceChunkMs: 1500 }]]);
  assert.equal(session.state, 'live');
  await session.stop({});
});
