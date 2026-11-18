'use strict';

// Call recording inside a live session, and the chunk timing the backend
// uses to time transcript lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaptureSession } = require('../renderer/capture/capture-session.js');
const { VIDEO_MIME, AUDIO_MIME } = require('../renderer/capture/call-recorder.js');
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
  await session.start({ screen: !!(options && options.screen) });
  assert.equal(session.state, 'live');
  await waitFor(() => env.sockets.length > 0 && env.sockets[0].readyState === 1, 'socket open');
  await tick(5);
  return session;
}

const callRecorder = (env) => env.recorders.find((r) => r.timeslice === 1000) || null;
const SPEECH = 0.05;
const CLOCKED = { heartbeatMs: 1e9 };

function say(env, ms) {
  env.repLevel = SPEECH;
  env.clock.advance(ms);
  env.repLevel = 0;
}

test('each chunk says when its audio began (for line times), not just when it was sent', async () => {
  const env = createEnv({ clock: true });
  const session = await startLive(env, { config: CLOCKED });
  env.clock.advance(3000);
  say(env, 1000);
  env.clock.advance(700); // first chunk cut at 4.7s
  await waitFor(() => env.monitoringMessages().length === 1, 'first chunk');
  say(env, 2500);
  env.clock.advance(700); // second chunk: began at 4.7s, cut at 7.9s
  await waitFor(() => env.monitoringMessages().length === 2, 'second chunk');
  const [first, second] = env.monitoringMessages().map((m) => m.payload);
  assert.equal(first.chunkStartMs, 0);
  assert.equal(second.chunkStartMs, 4700);
  assert.equal(second.timeIntoCall, 7, 'timeIntoCall is still the send time');
  assert.equal(second.prospectStartMs, 4700, 'both channels restart together');
  await session.stop({});
});

test("the prospect channel's later start in the first chunk is reported", async () => {
  const env = createEnv({ clock: true });
  env.displayGate = deferred();
  const session = createCaptureSession(env.deps(CLOCKED));
  const started = session.start({ screen: false });
  await waitFor(() => env.intents.length === 1, 'display requested');
  env.clock.advance(1200); // call audio attaches 1.2s into the call
  env.displayGate.resolve();
  await started;
  await waitFor(() => env.sockets.length && env.sockets[0].readyState === 1, 'socket');
  say(env, 1500);
  env.clock.advance(700);
  await waitFor(() => env.monitoringMessages().length === 1, 'chunk');
  const chunk = env.monitoringMessages()[0].payload;
  assert.equal(chunk.chunkStartMs, 0);
  assert.equal(chunk.prospectStartMs, 1200);
  await session.stop({});
});

test('with a shared window the call is recorded as 720p video + mixed audio, ended at Stop before the mic closes', async () => {
  const env = createEnv({ autoPick: 'window:7:0', recording: {} });
  let micLiveAtEnd = null;
  const end = env.ipc.recordingEnd;
  env.ipc.recordingEnd = async (p) => { micLiveAtEnd = env.micStream.getTracks()[0].readyState; return end(p); };
  const session = await startLive(env, { screen: true });

  assert.deepEqual(env.recordingCalls[0], ['begin', { sessionId: 'sess-1', wantVideo: true, manual: false }]);
  const rec = callRecorder(env);
  assert.ok(rec, 'a call recorder runs');
  assert.equal(rec.mimeType, VIDEO_MIME);
  assert.equal(rec.options.videoBitsPerSecond, 900000);
  const video = rec.stream.getVideoTracks()[0];
  assert.ok(video.cloneOf, 'records a copy of the window track (screenshots keep the original)');
  assert.deepEqual(video.constraints, { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } });
  assert.equal(rec.stream.getAudioTracks().length, 1, 'one mixed audio track');

  rec.emitPiece(4000);
  rec.emitPiece(3000);
  await tick(5);
  await session.stop({});

  const ended = env.recordingCalls.find(([k]) => k === 'end');
  assert.ok(ended, 'recording finished');
  assert.equal(ended[1].hasVideo, true);
  assert.equal(ended[1].failed, undefined);
  assert.ok(ended[1].startOffsetMs >= 0);
  assert.equal(micLiveAtEnd, 'live', 'recording ended before the tracks were released');
  assert.deepEqual(env.recordingCalls.filter(([k]) => k === 'data').map(([, n]) => n).slice(0, 2), [4000, 3000]);
  assert.ok(env.requestsTo('/live/end').length === 1, 'the call is still saved');
});

test('no window picked: an audio-only recording of both voices', async () => {
  const env = createEnv({ recording: {} });
  const session = await startLive(env, { screen: false });
  assert.deepEqual(env.recordingCalls[0], ['begin', { sessionId: 'sess-1', wantVideo: false, manual: false }]);
  const rec = callRecorder(env);
  assert.equal(rec.mimeType, AUDIO_MIME);
  assert.equal(rec.stream.getVideoTracks().length, 0);
  await session.stop({});
  assert.equal(env.recordingCalls.find(([k]) => k === 'end')[1].hasVideo, false);
});

test('an audio-only recording starts with the call, before the computer audio attaches, and mixes it in', async () => {
  const env = createEnv({ recording: {} });
  env.displayGate = deferred();
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: false });
  await waitFor(() => env.recordingCalls.length === 1 && callRecorder(env), 'recording started early');
  assert.equal(env.intents.length, 1, 'display capture still pending');
  env.displayGate.resolve();
  await started;
  const mix = env.destinations[0].mixed;
  assert.equal(mix.length, 2, 'mic and computer audio both in the mix');
  assert.ok(mix.includes(env.micStream));
  await session.stop({});
  assert.ok(env.recordingCalls.find(([k]) => k === 'end'));
});

test('recording off in Settings: nothing is recorded; video off: audio only', async () => {
  const off = createEnv({ autoPick: 'window:7:0', recording: { settings: { recordCalls: false } } });
  const a = await startLive(off, { screen: true });
  assert.equal(off.recordingCalls.length, 0);
  assert.equal(callRecorder(off), null);
  await a.stop({});

  const noVideo = createEnv({ autoPick: 'window:7:0', recording: { settings: { recordVideo: false } } });
  const b = await startLive(noVideo, { screen: true });
  assert.deepEqual(noVideo.recordingCalls[0][1], { sessionId: 'sess-1', wantVideo: false, manual: false });
  assert.equal(callRecorder(noVideo).mimeType, AUDIO_MIME);
  await b.stop({});
});

test('main refusing to record (low disk) never affects the call', async () => {
  const env = createEnv({ recording: { refuse: 'disk' } });
  const session = await startLive(env);
  assert.equal(callRecorder(env), null);
  await session.stop({});
  assert.equal(env.requestsTo('/live/end').length, 1);
  assert.equal(env.recordingCalls.filter(([k]) => k === 'end').length, 0);
});

test('the shared window closing mid-call keeps the audio recording going', async () => {
  const env = createEnv({ autoPick: 'window:7:0', recording: {} });
  const session = await startLive(env, { screen: true });
  const rec = callRecorder(env);
  env.displayStream.getVideoTracks()[0].sourceEnded();
  assert.equal(rec.stream.getVideoTracks()[0].readyState, 'ended');
  assert.equal(rec.state, 'recording', 'still recording the sound');
  await session.stop({});
  assert.ok(env.recordingCalls.find(([k]) => k === 'end'));
});

test('turning screen capture off mid-call stops the recorded picture too', async () => {
  const env = createEnv({ autoPick: 'window:7:0', recording: {} });
  const session = await startLive(env, { screen: true });
  const rec = callRecorder(env);
  await session.setScreen(false);
  assert.equal(rec.stream.getVideoTracks()[0].readyState, 'ended');
  assert.equal(rec.state, 'recording');
  await session.stop({});
});

test('stop while main is still deciding throws the recording away', async () => {
  const env = createEnv({ recording: { beginGate: deferred() } });
  const session = createCaptureSession(env.deps());
  const started = session.start({ screen: false });
  await waitFor(() => env.recordingCalls.length === 1, 'recording requested');
  const stopping = session.stop({ reason: 'user' });
  env.recording.beginGate.resolve();
  await started;
  await stopping;
  const ended = env.recordingCalls.find(([k]) => k === 'end');
  assert.ok(ended && ended[1].failed, 'the file is discarded, not uploaded');
  assert.equal(session.state, 'idle');
});

// ---------------- the overlay's record button ----------------

test('record button off mid-call: silence and a black picture until it is pressed again; the off stretches are reported', async () => {
  const env = createEnv({ clock: true, autoPick: 'window:7:0', recording: {} });
  const shown = [];
  env.ui.recording = (info) => shown.push(info);
  const session = await startLive(env, { screen: true, config: CLOCKED });
  const rec = callRecorder(env);
  assert.equal(session.recording, true, 'each call starts recorded');
  assert.deepEqual(shown[0], { on: true, video: true, manual: false });

  env.clock.advance(10000);
  assert.equal(await session.setRecording(false), false);
  assert.equal(session.recording, false);
  assert.equal(rec.stream.getAudioTracks()[0].enabled, false, 'nothing heard is recorded');
  assert.equal(rec.stream.getVideoTracks()[0].enabled, false, 'nothing seen is recorded');
  assert.equal(rec.state, 'recording', 'the file keeps its place in time, so the transcript still lines up');
  assert.deepEqual(shown[1], { on: false, video: true, toggled: true });

  env.clock.advance(5000);
  assert.equal(await session.setRecording(true), true);
  assert.equal(rec.stream.getAudioTracks()[0].enabled, true);
  assert.equal(rec.stream.getVideoTracks()[0].enabled, true);
  env.clock.advance(3000);
  await session.setRecording(false); // and off until the end of the call
  env.clock.advance(2000);
  await session.stop({});

  const ended = env.recordingCalls.find(([k]) => k === 'end')[1];
  assert.deepEqual(ended.pauses, [{ startMs: 10000, endMs: 15000 }, { startMs: 18000, endMs: 20000 }]);
  assert.equal(ended.durationMs, 20000);
  assert.ok(env.requestsTo('/live/end').length === 1, 'the call is saved as usual');
});

test('recording off in Settings: the call starts unrecorded, and the record button records the rest of it', async () => {
  const env = createEnv({ clock: true, recording: { settings: { recordCalls: false } } });
  const shown = [];
  env.ui.recording = (info) => shown.push(info);
  const session = await startLive(env, { config: CLOCKED });
  assert.equal(env.recordingCalls.length, 0);
  assert.equal(session.recording, false);
  assert.deepEqual(shown, [{ on: false, reason: 'off' }]);

  env.clock.advance(60000);
  assert.equal(await session.setRecording(true), true);
  assert.deepEqual(env.recordingCalls[0], ['begin', { sessionId: 'sess-1', wantVideo: false, manual: true }]);
  assert.deepEqual(shown[1], { on: true, video: false, manual: true });
  await session.stop({});
  const ended = env.recordingCalls.find(([k]) => k === 'end')[1];
  assert.equal(ended.startOffsetMs, 60000, 'the recording starts a minute into the call');
  assert.deepEqual(ended.pauses, []);
});

test('the record button when main will not record (low disk) says so and the call carries on', async () => {
  const env = createEnv({ recording: { refuse: 'disk' } });
  const shown = [];
  env.ui.recording = (info) => shown.push(info);
  const session = await startLive(env);
  assert.deepEqual(shown[0], { on: false, reason: 'disk', manual: false });
  assert.equal(await session.setRecording(true), false);
  assert.deepEqual(shown[1], { on: false, reason: 'disk', manual: true });
  assert.equal(session.state, 'live');
  await session.stop({});
  assert.equal(env.requestsTo('/live/end').length, 1);
});

test('the record button does nothing outside a live call, and Stop waits for a recording it started', async () => {
  const env = createEnv({ recording: { settings: { recordCalls: false } } });
  const session = createCaptureSession(env.deps());
  assert.equal(await session.setRecording(true), false, 'not live yet');
  await session.start({ screen: false });
  await waitFor(() => env.sockets.length > 0 && env.sockets[0].readyState === 1, 'socket open');
  env.recording.beginGate = deferred();
  const pressing = session.setRecording(true);
  await waitFor(() => env.recordingCalls.length === 1, 'manual recording requested');
  const stopping = session.stop({});
  env.recording.beginGate.resolve();
  await pressing;
  await stopping;
  const ended = env.recordingCalls.find(([k]) => k === 'end');
  assert.ok(ended && !ended[1].failed, 'the recording is finished and kept, not left open');
});
