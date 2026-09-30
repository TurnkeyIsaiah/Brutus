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
  assert.equal(env.requestsTo('/live/end').length, 2, 'retried once');
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
