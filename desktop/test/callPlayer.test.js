'use strict';

// The call recording player: which transcript line is lit while it plays,
// jumping from a line, and the signed-URL refresh. Uses a tiny fake DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../renderer/app/call-player.js');

test('the active line is the last one that has started (a touch early, as the voice starts)', () => {
  const starts = [0.5, 4.2, 9.8, 15];
  assert.equal(P.activeIndex(starts, 0), -1, 'before the first line nothing is lit');
  assert.equal(P.activeIndex(starts, 0.4), 0, 'lit 0.15s early');
  assert.equal(P.activeIndex(starts, 4.19), 1);
  assert.equal(P.activeIndex(starts, 9.7), 2);
  assert.equal(P.activeIndex(starts, 14.9), 3);
  assert.equal(P.activeIndex(starts, 600), 3, 'stays on the last line');
  assert.equal(P.activeIndex([], 3), -1);
  assert.equal(P.activeIndex(starts, NaN), -1);
});

test('line time and media time differ by when the recording started', () => {
  assert.equal(P.mediaTimeForLine(12.5, 0.4), 12.1);
  assert.equal(P.mediaTimeForLine(0.2, 0.4), 0, 'never before the start of the file');
  assert.equal(P.callTimeForMedia(12.1, 0.4), 12.5);
  assert.equal(P.formatClock(3725), '1:02:05');
  assert.equal(P.formatClock(65.9), '1:05');
});

test('callLines keeps text order and only trusts real numbers as times', () => {
  const lines = P.callLines({ transcriptLines: [
    { speaker: 'rep', text: 'hi', startSec: 0.4 },
    { speaker: 'prospect', text: 'hello', startSec: null },
    { speaker: 'weird', text: '   ' },
    { speaker: 'prospect', text: 'ok', startSec: -2 }
  ] });
  assert.deepEqual(lines, [
    { speaker: 'rep', text: 'hi', startSec: 0.4 },
    { speaker: 'prospect', text: 'hello', startSec: null },
    { speaker: 'prospect', text: 'ok', startSec: null }
  ]);
  assert.equal(P.callLines({ transcript: 'REP: hi' }), null, 'old calls have no timed lines');
  assert.equal(P.recordingState({ recording: { status: 'ready' } }), 'ready');
  assert.equal(P.recordingState({ recording: { status: 'uploading' } }), 'uploading');
  assert.equal(P.recordingState({ recording: null }), 'none');
});

// ---------------- fake DOM ----------------

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}

class El {
  constructor(tag, classes, attrs) {
    this.tagName = tag.toUpperCase();
    this.classList = new ClassList(this);
    (classes || []).forEach((c) => this.classList.add(c));
    this.attrs = Object.assign({}, attrs || {});
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.hidden = false;
    this.isConnected = true;
    this.offsetTop = 0;
    this.offsetHeight = 20;
    this.clientHeight = 100;
    this.scrollTop = 0;
    this.scrolledTo = [];
  }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  dispatch(t, extra) {
    const ev = Object.assign({ type: t, target: this, preventDefault() {}, stopPropagation() {} }, extra || {});
    let node = this;
    while (node) { (node.listeners[t] || []).forEach((fn) => fn(ev)); node = node.parent; }
  }
  matches(sel) {
    return sel.split(',').some((part) => {
      const m = /^\s*([a-z]*)((?:\.[\w-]+)*)(\[([\w-]+)\])?\s*$/.exec(part);
      if (!m) return false;
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      const classes = m[2].split('.').filter(Boolean);
      if (!classes.every((c) => this.classList.contains(c))) return false;
      if (m[4] && !this.hasAttribute(m[4])) return false;
      return true;
    });
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.all().find((e) => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter((e) => e.matches(sel)); }
  closest(sel) { let n = this; while (n) { if (n.matches(sel)) return n; n = n.parent; } return null; }
  scrollTo(opts) { this.scrolledTo.push(opts.top); this.scrollTop = opts.top; }
  getBoundingClientRect() { return { left: 0, width: 200 }; }
  setPointerCapture() {}
}

class Media extends El {
  constructor(tag) {
    super(tag, [tag === 'video' ? 'p-rec-video' : 'p-rec-audio']);
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.ended = false;
    this.readyState = 0;
  }
  play() { this.paused = false; this.dispatch('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatch('pause'); }
  load() {}
}

function buildPanel({ offsetMs = 0, durationMs = 60000, starts = [0.5, 4, 9, 20], pauses = '' } = {}) {
  const panel = new El('div', [], { id: 'call-recording-panel' });
  const rec = new El('div', ['p-rec'], { 'data-call-id': 'call-1', 'data-rec-state': 'ready', 'data-offset-ms': String(offsetMs), 'data-duration-ms': String(durationMs), 'data-pauses': pauses });
  const media = new Media('video');
  const play = new El('button', ['p-rec-play']);
  const track = new El('div', ['p-rec-track']);
  const fill = new El('div', ['p-rec-fill']);
  track.append(fill);
  const pos = new El('div', ['p-rec-pos']);
  const dur = new El('div', ['p-rec-dur']);
  const status = new El('div', ['p-rec-status']);
  const list = new El('div', ['p-rec-turns']);
  const turns = starts.map((s, i) => {
    const t = new El('div', ['p-rec-turn'], { 'data-start': String(s) });
    t.offsetTop = i * 150; // far apart, so each line needs scrolling into view
    const text = new El('div', ['p-rec-text']);
    t.append(text);
    return t;
  });
  list.append(...turns);
  rec.append(media, play, track, pos, dur, status, list);
  panel.append(rec);
  return { panel, media, play, track, fill, pos, list, turns, status };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('playing lights up the spoken line, moves on, and keeps it in view', async () => {
  const urls = [];
  const ui = buildPanel({ offsetMs: 400 });
  const player = P.mount(ui.panel, { getUrl: async (id) => { urls.push(id); return { url: 'https://signed/1' }; } });
  assert.ok(player);
  assert.equal(P.mount(ui.panel, {}), player, 'mounted once per panel');

  ui.play.dispatch('click');
  await tick();
  assert.deepEqual(urls, ['call-1'], 'the signed URL is fetched on first play');
  assert.equal(ui.media.getAttribute('src'), 'https://signed/1');
  assert.equal(ui.media.paused, false);
  assert.ok(ui.play.classList.contains('is-playing'));

  ui.media.readyState = 4;
  ui.media.duration = 60;
  ui.media.currentTime = 3.7; // call time 4.1: second line
  ui.media.dispatch('timeupdate');
  assert.ok(ui.turns[1].classList.contains('is-active'));
  assert.equal(ui.turns[1].getAttribute('aria-current'), 'true');
  assert.equal(ui.turns.filter((t) => t.classList.contains('is-active')).length, 1);
  assert.equal(ui.pos.textContent, '0:03');
  assert.match(ui.fill.style.width, /^6\.1\d*%$/);

  ui.media.currentTime = 8.7; // call time 9.1: third line
  ui.media.dispatch('timeupdate');
  assert.ok(!ui.turns[1].classList.contains('is-active'));
  assert.ok(ui.turns[2].classList.contains('is-active'));
  assert.ok(ui.list.scrolledTo.length > 0, 'scrolled to keep the line in view');

  ui.play.dispatch('click');
  assert.equal(ui.media.paused, true, 'second click pauses');
});

test('a manual scroll is respected for a few seconds; a click on a line jumps and plays', async () => {
  const ui = buildPanel({ offsetMs: 500 });
  P.mount(ui.panel, { getUrl: async () => ({ url: 'https://signed/2' }) });
  ui.media.readyState = 4;
  ui.media.duration = 60;

  ui.list.dispatch('wheel');
  ui.media.currentTime = 19.6; // call time 20.1: last line, far below
  ui.media.dispatch('timeupdate');
  assert.ok(ui.turns[3].classList.contains('is-active'));
  assert.equal(ui.list.scrolledTo.length, 0, 'does not yank the list back while the rep is reading');

  ui.turns[2].children[0].dispatch('click'); // click on the line's text
  await tick();
  assert.equal(ui.media.currentTime, 8.5, 'line at 9s on the call clock = 8.5s into the recording');
  assert.equal(ui.media.paused, false);
  assert.ok(ui.turns[2].classList.contains('is-active'));
  assert.ok(ui.list.scrolledTo.length > 0, 'a jump brings its line into view');
});

test('seeking from the progress bar, by pointer and by keyboard', async () => {
  const ui = buildPanel();
  P.mount(ui.panel, { getUrl: async () => ({ url: 'https://signed/3' }) });
  ui.media.readyState = 4;
  ui.media.duration = 100;
  ui.track.dispatch('pointerdown', { clientX: 50, pointerId: 1 }); // a quarter of 200px
  await tick();
  assert.equal(ui.media.currentTime, 25);
  ui.track.dispatch('keydown', { key: 'ArrowRight' });
  await tick();
  assert.equal(ui.media.currentTime, 30);
  assert.equal(ui.track.getAttribute('role'), 'slider');
});

test('an expired signed URL is replaced once and playback resumes where it was', async () => {
  let n = 0;
  const ui = buildPanel();
  P.mount(ui.panel, { getUrl: async () => ({ url: `https://signed/${++n}` }) });
  ui.play.dispatch('click');
  await tick();
  ui.media.readyState = 4;
  ui.media.duration = 100;
  ui.media.currentTime = 42;
  ui.media.dispatch('error');
  await tick();
  assert.equal(ui.media.getAttribute('src'), 'https://signed/2');
  ui.media.dispatch('loadedmetadata');
  assert.equal(ui.media.currentTime, 42);

  ui.media.dispatch('error'); // again right away: give up with a message, no loop
  await tick();
  assert.equal(n, 2);
  assert.equal(ui.status.hidden, false);
});

test('a URL that cannot be fetched shows a message instead of a dead player', async () => {
  const ui = buildPanel();
  P.mount(ui.panel, { getUrl: async () => { throw new Error('offline'); } });
  ui.play.dispatch('click');
  await tick();
  await tick();
  assert.equal(ui.media.getAttribute('src'), null);
  assert.match(ui.status.textContent, /couldn't load the recording/);
  assert.equal(ui.media.paused, true);
});

test('stretches where recording was off: parsed, found, and never landed in again', () => {
  const pauses = P.parsePauses('30000-40000,5000-12000,junk,9-3');
  assert.deepEqual(pauses, [[5, 12], [30, 40]]);
  assert.deepEqual(P.parsePauses(''), []);
  assert.equal(P.pauseAt(pauses, 4), null);
  assert.deepEqual(P.pauseAt(pauses, 5), [5, 12]);
  assert.deepEqual(P.pauseAt(pauses, 11.5), [5, 12]);
  assert.equal(P.pauseAt(pauses, 11.8), null, 'the end of a stretch counts as past it');
  assert.deepEqual(P.pauseAt(pauses, 35), [30, 40]);
  assert.equal(P.pauseAt(pauses, 50), null);
});

test('playback skips where recording was off; lines said then are marked not recorded', async () => {
  // The recording started 1s into the call and was off from 5s to 12s of the file.
  const ui = buildPanel({ offsetMs: 1000, starts: [0.2, 3, 8, 15], pauses: '5000-12000' });
  P.mount(ui.panel, { getUrl: async () => ({ url: 'https://signed/1' }) });
  assert.ok(ui.turns[0].classList.contains('is-unrecorded'), 'said before the recording started');
  assert.ok(!ui.turns[1].classList.contains('is-unrecorded'));
  assert.ok(ui.turns[2].classList.contains('is-unrecorded'), 'said while recording was off (file time 7s)');
  assert.ok(!ui.turns[3].classList.contains('is-unrecorded'));

  ui.play.dispatch('click');
  await tick();
  ui.media.readyState = 4;
  ui.media.duration = 60;
  ui.media.currentTime = 5.2;
  ui.media.dispatch('timeupdate');
  assert.equal(ui.media.currentTime, 12, 'jumped to where recording came back on');
  assert.match(ui.status.textContent, /wasn't recorded/);
  assert.equal(ui.status.hidden, false);

  ui.media.currentTime = 0;
  ui.list.dispatch('click', { target: ui.turns[2] }); // a line inside the off stretch
  await tick();
  ui.media.dispatch('seeked');
  assert.equal(ui.media.currentTime, 12, 'a jump there lands where the recording picks up');
});
