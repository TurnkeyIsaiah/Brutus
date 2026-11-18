'use strict';

// webmFix turns a "live" MediaRecorder WebM (unknown sizes, no Duration, no
// Cues) into a seekable one. These tests build such files byte by byte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixWebm, fixWebmInPlace, _internal } = require('../src/recordings/webmFix');

const { ID, element, idBytes, uintBytes, FileReader, readHeader } = _internal;
const UNKNOWN = Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);

function simpleBlock(track, rel, key, payloadLen) {
  const head = Buffer.alloc(4);
  head[0] = 0x80 | track;
  head.writeInt16BE(rel, 1);
  head[3] = key ? 0x80 : 0x00;
  return element(ID.SIMPLE_BLOCK, Buffer.concat([head, Buffer.alloc(payloadLen, track)]));
}

// clusters: [{ tc, blocks: [[track, rel, key, len]] }]
function liveWebm(clusters, { video = true } = {}) {
  const ebml = element(ID.EBML, element(0x4282, Buffer.from('webm')));
  const info = element(ID.INFO, Buffer.concat([
    element(ID.TIMECODE_SCALE, uintBytes(1000000, 3)),
    element(0x4D80, Buffer.from('Chrome'))
  ]));
  const entries = [];
  if (video) entries.push(element(ID.TRACK_ENTRY, Buffer.concat([element(ID.TRACK_NUMBER, Buffer.from([1])), element(ID.TRACK_TYPE, Buffer.from([1]))])));
  entries.push(element(ID.TRACK_ENTRY, Buffer.concat([element(ID.TRACK_NUMBER, Buffer.from([video ? 2 : 1])), element(ID.TRACK_TYPE, Buffer.from([2]))])));
  const tracks = element(ID.TRACKS, Buffer.concat(entries));
  const parts = [ebml, idBytes(ID.SEGMENT), UNKNOWN, info, tracks];
  const payloads = [];
  for (const c of clusters) {
    const payload = Buffer.concat([element(ID.TIMECODE, uintBytes(c.tc, 2)), ...c.blocks.map((b) => simpleBlock(...b))]);
    payloads.push(payload);
    parts.push(idBytes(ID.CLUSTER), UNKNOWN, payload);
  }
  return { file: Buffer.concat(parts), payloads };
}

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tmpFile(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brutus-webm-'));
  dirs.push(dir);
  const file = path.join(dir, 'in.webm');
  fs.writeFileSync(file, buf);
  return { dir, file, out: path.join(dir, 'out.webm') };
}

// Reads the rebuilt file back: every size must be known and consistent.
function inspect(file) {
  const buf = fs.readFileSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const r = new FileReader(fd, buf.length);
    const ebml = readHeader(r, 0);
    const seg = readHeader(r, ebml.dataStart + ebml.size);
    assert.equal(seg.id, ID.SEGMENT);
    assert.equal(seg.dataStart + seg.size, buf.length, 'segment size covers the file exactly');
    const out = { order: [], clusters: [], cues: [], duration: null, segStart: seg.dataStart };
    let pos = seg.dataStart;
    while (pos < buf.length) {
      const h = readHeader(r, pos);
      assert.ok(h.size >= 0, 'no unknown sizes left');
      out.order.push(h.id);
      if (h.id === ID.INFO) {
        let p = h.dataStart;
        while (p < h.dataStart + h.size) {
          const c = readHeader(r, p);
          if (c.id === ID.DURATION) out.duration = buf.readDoubleBE(c.dataStart);
          p = c.dataStart + c.size;
        }
      }
      if (h.id === ID.CLUSTER) out.clusters.push({ pos: pos - seg.dataStart, payload: buf.subarray(h.dataStart, h.dataStart + h.size) });
      if (h.id === ID.CUES) {
        let p = h.dataStart;
        while (p < h.dataStart + h.size) {
          const cp = readHeader(r, p);
          let q = cp.dataStart;
          const cue = {};
          while (q < cp.dataStart + cp.size) {
            const c = readHeader(r, q);
            if (c.id === ID.CUE_TIME) cue.time = buf.readBigUInt64BE(c.dataStart);
            if (c.id === ID.CUE_TRACK_POSITIONS) {
              let z = c.dataStart;
              while (z < c.dataStart + c.size) {
                const d = readHeader(r, z);
                if (d.id === ID.CUE_CLUSTER_POSITION) cue.position = Number(buf.readBigUInt64BE(d.dataStart));
                if (d.id === ID.CUE_TRACK) cue.track = buf[d.dataStart];
                z = d.dataStart + d.size;
              }
            }
            q = c.dataStart + c.size;
          }
          out.cues.push(cue);
          p = cp.dataStart + cp.size;
        }
      }
      pos = h.dataStart + h.size;
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

test('a live recording gets a duration, a seek index and known sizes; media bytes are untouched', () => {
  const { file: input, payloads } = liveWebm([
    { tc: 0, blocks: [[1, 0, true, 300], [2, 0, true, 40], [1, 66, false, 120], [2, 20, true, 40]] },
    { tc: 1000, blocks: [[1, 0, true, 300], [2, 10, true, 40], [1, 933, false, 100]] },
    { tc: 2000, blocks: [[2, 0, true, 40], [1, 5, false, 90]] }, // starts without a key frame
    { tc: 3000, blocks: [[1, 0, true, 300], [2, 480, true, 40]] }
  ]);
  const t = tmpFile(input);
  const result = fixWebm(t.file, t.out);
  assert.equal(result.durationMs, 3480);
  assert.equal(result.hasVideo, true);
  assert.equal(result.clusters, 4);
  assert.equal(result.cues, 3, 'no cue on a cluster that does not start on a key frame');

  const out = inspect(t.out);
  assert.deepEqual(out.order.slice(0, 4), [ID.SEEK_HEAD, ID.INFO, ID.TRACKS, ID.CUES], 'index before the media');
  assert.equal(out.duration, 3480);
  assert.equal(out.clusters.length, 4);
  out.clusters.forEach((c, i) => assert.ok(c.payload.equals(payloads[i]), `cluster ${i} copied byte for byte`));
  const positions = out.clusters.map((c) => c.pos);
  assert.deepEqual(out.cues.map((c) => c.position), [positions[0], positions[1], positions[3]], 'cues point at the clusters');
  assert.deepEqual(out.cues.map((c) => Number(c.time)), [0, 1000, 3000]);
  assert.ok(out.cues.every((c) => c.track === 1), 'video track is the cue track');
});

test('audio-only recordings index every cluster on the audio track', () => {
  const { file: input } = liveWebm([
    { tc: 0, blocks: [[1, 0, true, 40], [1, 20, true, 40]] },
    { tc: 1000, blocks: [[1, 0, true, 40], [1, 960, true, 40]] }
  ], { video: false });
  const t = tmpFile(input);
  const result = fixWebm(t.file, t.out);
  assert.equal(result.hasVideo, false);
  assert.equal(result.durationMs, 1960);
  const out = inspect(t.out);
  assert.equal(out.cues.length, 2);
  assert.ok(out.cues.every((c) => c.track === 1));
});

test('a recording cut off by a crash keeps every complete block and drops the partial one', () => {
  const { file: input, payloads } = liveWebm([
    { tc: 0, blocks: [[1, 0, true, 300], [2, 0, true, 40]] },
    { tc: 1000, blocks: [[1, 0, true, 300], [2, 500, true, 40], [1, 900, false, 200]] }
  ]);
  const cut = input.subarray(0, input.length - 50); // inside the last block
  const t = tmpFile(cut);
  const result = fixWebm(t.file, t.out);
  assert.equal(result.clusters, 2);
  assert.equal(result.durationMs, 1500, 'the cut block (at 1900ms) is gone');
  const out = inspect(t.out);
  assert.ok(out.clusters[0].payload.equals(payloads[0]));
  assert.ok(payloads[1].subarray(0, out.clusters[1].payload.length).equals(out.clusters[1].payload));
});

test('fixing is repeatable (a fixed file fixes to the same bytes) and in place', () => {
  const { file: input } = liveWebm([
    { tc: 0, blocks: [[1, 0, true, 300], [2, 0, true, 40]] },
    { tc: 1000, blocks: [[1, 0, true, 300], [2, 700, true, 40]] }
  ]);
  const t = tmpFile(input);
  const first = fixWebmInPlace(t.file);
  const once = fs.readFileSync(t.file);
  const second = fixWebmInPlace(t.file);
  assert.deepEqual(second, first);
  assert.ok(fs.readFileSync(t.file).equals(once));
  assert.equal(fs.existsSync(`${t.file}.fixing`), false, 'no temp file left');
});

test('a file that is not a WebM is refused and leaves no output', () => {
  const t = tmpFile(Buffer.from('definitely not a webm file'));
  assert.throws(() => fixWebm(t.file, t.out));
  assert.equal(fs.existsSync(t.out), false);
});
