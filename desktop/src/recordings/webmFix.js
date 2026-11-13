// Makes a MediaRecorder WebM seekable.
//
// Chromium's MediaRecorder writes a "live" WebM: the Segment and every Cluster
// have unknown sizes, Info has no Duration, and there are no Cues (seek index).
// Played from a URL, such a file shows no length, and a jump forward makes the
// player read every byte up to that point. On an hour of video that is the
// whole file.
//
// fixWebm() rewrites the file once, after recording:
//   EBML header (copied)
//   Segment (known size)
//     SeekHead -> Info, Tracks, Cues
//     Info (copied, with Duration)
//     Tracks (copied)
//     Cues (one point per cluster that starts on a key frame)
//     Clusters (payload copied byte for byte, now with known sizes)
// A recording cut off by a crash is handled the same way: the last, partial
// element is dropped. The file is streamed (never loaded whole), so an hour of
// video needs only a little memory plus its own size in free disk for the
// temporary copy.
'use strict';

const fs = require('fs');

const ID = {
  EBML: 0x1A45DFA3,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114D9B74,
  SEEK: 0x4DBB,
  SEEK_ID: 0x53AB,
  SEEK_POSITION: 0x53AC,
  INFO: 0x1549A966,
  TIMECODE_SCALE: 0x2AD7B1,
  DURATION: 0x4489,
  TRACKS: 0x1654AE6B,
  TRACK_ENTRY: 0xAE,
  TRACK_NUMBER: 0xD7,
  TRACK_TYPE: 0x83,
  CLUSTER: 0x1F43B675,
  TIMECODE: 0xE7,
  SIMPLE_BLOCK: 0xA3,
  BLOCK_GROUP: 0xA0,
  BLOCK: 0xA1,
  CUES: 0x1C53BB6B,
  CUE_POINT: 0xBB,
  CUE_TIME: 0xB3,
  CUE_TRACK_POSITIONS: 0xB7,
  CUE_TRACK: 0xF7,
  CUE_CLUSTER_POSITION: 0xF1,
  VOID: 0xEC
};

// Children of Segment. Meeting one of these inside an unknown-size Cluster
// means that Cluster has ended.
const LEVEL1 = new Set([
  ID.SEEK_HEAD, ID.INFO, ID.TRACKS, ID.CLUSTER, ID.CUES,
  0x1254C367, // Tags
  0x1043A770, // Chapters
  0x1941A469  // Attachments
]);

class Truncated extends Error {}

// Random-access reader over a file with a sliding window, so tiny header reads
// do not each cost a system call.
class FileReader {
  constructor(fd, size) {
    this.fd = fd;
    this.size = size;
    this.winStart = 0;
    this.win = Buffer.alloc(0);
  }

  bytes(pos, len) {
    if (pos < 0 || pos + len > this.size) throw new Truncated();
    if (pos < this.winStart || pos + len > this.winStart + this.win.length) {
      const want = Math.max(len, 1 << 20);
      const n = Math.min(want, this.size - pos);
      const buf = Buffer.alloc(n);
      let got = 0;
      while (got < n) {
        const r = fs.readSync(this.fd, buf, got, n - got, pos + got);
        if (r <= 0) break;
        got += r;
      }
      this.winStart = pos;
      this.win = buf.subarray(0, got);
      if (len > got) throw new Truncated();
    }
    const off = pos - this.winStart;
    return this.win.subarray(off, off + len);
  }

  byte(pos) {
    return this.bytes(pos, 1)[0];
  }
}

function vintLength(first) {
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i)) return i + 1;
  }
  return 0;
}

// Element id (marker bits kept, as ids are written in the spec).
function readId(r, pos) {
  const first = r.byte(pos);
  const len = vintLength(first);
  if (!len || len > 4) throw new Error(`bad element id at ${pos}`);
  const b = r.bytes(pos, len);
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[i];
  return { id, len };
}

// Element size; unknown sizes (all value bits set) come back as -1.
function readSize(r, pos) {
  const first = r.byte(pos);
  const len = vintLength(first);
  if (!len) throw new Error(`bad element size at ${pos}`);
  const b = r.bytes(pos, len);
  let value = first & (0xFF >> len);
  let allOnes = value === (0xFF >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[i];
    if (b[i] !== 0xFF) allOnes = false;
  }
  return { size: allOnes ? -1 : value, len };
}

function readHeader(r, pos) {
  const id = readId(r, pos);
  const size = readSize(r, pos + id.len);
  return { id: id.id, size: size.size, dataStart: pos + id.len + size.len };
}

function readUint(buf) {
  let v = 0;
  for (const b of buf) v = v * 256 + b;
  return v;
}

function readSigned16(buf, off) {
  const v = (buf[off] << 8) | buf[off + 1];
  return v & 0x8000 ? v - 0x10000 : v;
}

// ---------------- writing helpers ----------------

function idBytes(id) {
  const out = [];
  let v = id;
  while (v > 0) { out.unshift(v & 0xFF); v = Math.floor(v / 256); }
  return Buffer.from(out);
}

function sizeVint(n, width) {
  let w = width || 1;
  if (!width) while (w < 8 && n >= Math.pow(2, 7 * w) - 1) w++;
  const buf = Buffer.alloc(w);
  let v = n;
  for (let i = w - 1; i >= 0; i--) { buf[i] = v % 256; v = Math.floor(v / 256); }
  buf[0] |= 0x80 >> (w - 1);
  return buf;
}

function uintBytes(n, width) {
  const buf = Buffer.alloc(width);
  let v = n;
  for (let i = width - 1; i >= 0; i--) { buf[i] = v % 256; v = Math.floor(v / 256); }
  return buf;
}

function element(id, payload) {
  return Buffer.concat([idBytes(id), sizeVint(payload.length), payload]);
}

function floatElement(id, value) {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(value, 0);
  return element(id, buf);
}

// ---------------- parse ----------------

function parseTracks(r, start, end) {
  const tracks = [];
  let pos = start;
  while (pos < end) {
    const h = readHeader(r, pos);
    if (h.size < 0) break;
    if (h.id === ID.TRACK_ENTRY) {
      const t = { number: 0, type: 0 };
      let p = h.dataStart;
      const e = h.dataStart + h.size;
      while (p < e) {
        const c = readHeader(r, p);
        if (c.size < 0) break;
        if (c.id === ID.TRACK_NUMBER) t.number = readUint(r.bytes(c.dataStart, c.size));
        if (c.id === ID.TRACK_TYPE) t.type = readUint(r.bytes(c.dataStart, c.size));
        p = c.dataStart + c.size;
      }
      tracks.push(t);
    }
    pos = h.dataStart + h.size;
  }
  return tracks;
}

// Block header inside a SimpleBlock/Block payload: track, relative time, key.
function blockInfo(r, dataStart, size, simple) {
  const head = r.bytes(dataStart, Math.min(size, 12));
  const tl = vintLength(head[0]);
  if (!tl || tl + 3 > head.length) return null;
  let track = head[0] & (0xFF >> tl);
  for (let i = 1; i < tl; i++) track = track * 256 + head[i];
  const rel = readSigned16(head, tl);
  const flags = head[tl + 2];
  return { track, rel, key: simple ? (flags & 0x80) !== 0 : null };
}

// Walks one cluster's children. Returns where its payload really ends and
// the facts needed for Duration and Cues.
function scanCluster(r, dataStart, declaredEnd, ctx) {
  const limit = declaredEnd >= 0 ? declaredEnd : r.size;
  let pos = dataStart;
  let timecode = null;
  let lastGood = dataStart;
  let firstVideoKey = null; // true/false once the first block of the cue track is seen
  let maxTime = null;
  while (pos < limit) {
    let h;
    try {
      h = readHeader(r, pos);
    } catch (err) {
      if (err instanceof Truncated) break;
      throw err;
    }
    if (declaredEnd < 0 && LEVEL1.has(h.id)) break; // next top-level element
    if (h.size < 0) break; // not something a cluster holds: stop here
    const end = h.dataStart + h.size;
    if (end > r.size) break; // cut off mid-element: drop it
    if (h.id === ID.TIMECODE) {
      timecode = readUint(r.bytes(h.dataStart, h.size));
    } else if (h.id === ID.SIMPLE_BLOCK || h.id === ID.BLOCK_GROUP) {
      let info = null;
      if (h.id === ID.SIMPLE_BLOCK) {
        info = blockInfo(r, h.dataStart, h.size, true);
      } else {
        let p = h.dataStart;
        while (p < end) {
          const c = readHeader(r, p);
          if (c.size < 0) break;
          if (c.id === ID.BLOCK) { info = blockInfo(r, c.dataStart, c.size, false); break; }
          p = c.dataStart + c.size;
        }
        if (info) info.key = true; // BlockGroup without ReferenceBlock is a key frame; good enough for cues
      }
      if (info && timecode !== null) {
        const t = timecode + info.rel;
        if (maxTime === null || t > maxTime) maxTime = t;
        if (info.track === ctx.cueTrack && firstVideoKey === null) firstVideoKey = !!info.key;
      }
    }
    pos = end;
    lastGood = end;
  }
  return { end: lastGood, timecode, maxTime, startsWithKey: firstVideoKey !== false };
}

function parse(r) {
  let pos = 0;
  const ebml = readHeader(r, pos);
  if (ebml.id !== ID.EBML || ebml.size < 0) throw new Error('not a WebM file');
  const ebmlEnd = ebml.dataStart + ebml.size;
  const seg = readHeader(r, ebmlEnd);
  if (seg.id !== ID.SEGMENT) throw new Error('no Segment');
  const segEnd = seg.size < 0 ? r.size : Math.min(r.size, seg.dataStart + seg.size);

  const out = {
    ebmlEnd,
    infoChildren: [],
    timecodeScale: 1000000,
    tracksRange: null,
    tracks: [],
    clusters: [],
    maxTime: 0
  };

  pos = seg.dataStart;
  while (pos < segEnd) {
    let h;
    try {
      h = readHeader(r, pos);
    } catch (err) {
      if (err instanceof Truncated) break;
      throw err;
    }
    if (h.id === ID.CLUSTER) {
      const declaredEnd = h.size < 0 ? -1 : h.dataStart + h.size;
      if (!out.cueTrackPicked) {
        const video = out.tracks.find((t) => t.type === 1);
        const audio = out.tracks.find((t) => t.type === 2);
        out.cueTrack = (video || audio || { number: 1 }).number;
        out.hasVideo = !!video;
        out.cueTrackPicked = true;
      }
      const scan = scanCluster(r, h.dataStart, declaredEnd, { cueTrack: out.cueTrack });
      if (scan.timecode !== null && scan.end > h.dataStart) {
        out.clusters.push({ payloadStart: h.dataStart, payloadEnd: scan.end, timecode: scan.timecode, key: scan.startsWithKey });
        if (scan.maxTime !== null && scan.maxTime > out.maxTime) out.maxTime = scan.maxTime;
      }
      if (declaredEnd >= 0) {
        if (scan.end < declaredEnd) break; // cut off inside a known-size cluster
        pos = declaredEnd;
        continue;
      }
      // Unknown size: the scan stopped at the next top-level element, at a
      // partial element (the loop then ends on it), or at the end of the file.
      if (scan.end >= r.size || scan.end <= h.dataStart) break;
      pos = scan.end;
      continue;
    }
    if (h.size < 0) throw new Error(`unknown-size element 0x${h.id.toString(16)} in Segment`);
    const end = h.dataStart + h.size;
    if (end > r.size) break;
    if (h.id === ID.INFO) {
      let p = h.dataStart;
      while (p < end) {
        const c = readHeader(r, p);
        if (c.size < 0) break;
        const cEnd = c.dataStart + c.size;
        if (c.id === ID.TIMECODE_SCALE) out.timecodeScale = readUint(r.bytes(c.dataStart, c.size)) || 1000000;
        if (c.id !== ID.DURATION) out.infoChildren.push(Buffer.from(r.bytes(p, cEnd - p)));
        p = cEnd;
      }
    } else if (h.id === ID.TRACKS) {
      out.tracksRange = [pos, end];
      out.tracks = parseTracks(r, h.dataStart, end);
    }
    // SeekHead, Cues, Void, Tags...: dropped and rebuilt (or not needed).
    pos = end;
  }

  if (!out.tracksRange) throw new Error('no Tracks');
  if (out.clusters.length === 0) throw new Error('no media clusters');
  return out;
}

// ---------------- rebuild ----------------

function buildCues(points, cueTrack) {
  // Fixed widths, so the size is known before cluster positions are.
  const cuePoints = points.map((p) => element(ID.CUE_POINT, Buffer.concat([
    element(ID.CUE_TIME, uintBytes(p.time, 8)),
    element(ID.CUE_TRACK_POSITIONS, Buffer.concat([
      element(ID.CUE_TRACK, uintBytes(cueTrack, 1)),
      element(ID.CUE_CLUSTER_POSITION, uintBytes(p.position, 8))
    ]))
  ])));
  return element(ID.CUES, Buffer.concat(cuePoints));
}

function buildSeekHead(entries) {
  return element(ID.SEEK_HEAD, Buffer.concat(entries.map((e) => element(ID.SEEK, Buffer.concat([
    element(ID.SEEK_ID, idBytes(e.id)),
    element(ID.SEEK_POSITION, uintBytes(e.position, 8))
  ])))));
}

const CLUSTER_HEADER = 4 + 8; // id + 8-byte size

// Rewrites `inputPath` into `outputPath`. Returns { durationMs, hasVideo,
// clusters, cues, bytes }. Throws (and leaves no output) if the input is not a
// WebM it can read.
function fixWebm(inputPath, outputPath) {
  const fd = fs.openSync(inputPath, 'r');
  let out = null;
  try {
    const size = fs.fstatSync(fd).size;
    const r = new FileReader(fd, size);
    const p = parse(r);

    const ticksToMs = p.timecodeScale / 1e6;
    const durationTicks = p.maxTime;

    const info = element(ID.INFO, Buffer.concat([...p.infoChildren, floatElement(ID.DURATION, durationTicks)]));
    const tracks = Buffer.from(r.bytes(p.tracksRange[0], p.tracksRange[1] - p.tracksRange[0]));
    const header = Buffer.from(r.bytes(0, p.ebmlEnd));

    let cueClusters = p.clusters.filter((c) => c.key);
    if (cueClusters.length === 0) cueClusters = p.clusters;
    const cueIndex = new Set(cueClusters);

    // Sizes first (all fixed width), then positions.
    const seekHeadLen = buildSeekHead([
      { id: ID.INFO, position: 0 }, { id: ID.TRACKS, position: 0 }, { id: ID.CUES, position: 0 }
    ]).length;
    const cuesLen = buildCues(cueClusters.map(() => ({ time: 0, position: 0 })), p.cueTrack).length;
    const infoPos = seekHeadLen;
    const tracksPos = infoPos + info.length;
    const cuesPos = tracksPos + tracks.length;
    let clusterPos = cuesPos + cuesLen;

    const points = [];
    for (const c of p.clusters) {
      if (cueIndex.has(c)) points.push({ time: c.timecode, position: clusterPos });
      c.outPos = clusterPos;
      clusterPos += CLUSTER_HEADER + (c.payloadEnd - c.payloadStart);
    }
    const segmentDataLen = clusterPos;

    const seekHead = buildSeekHead([
      { id: ID.INFO, position: infoPos },
      { id: ID.TRACKS, position: tracksPos },
      { id: ID.CUES, position: cuesPos }
    ]);
    const cues = buildCues(points, p.cueTrack);

    out = fs.openSync(outputPath, 'w');
    let written = 0;
    const write = (buf) => {
      let off = 0;
      while (off < buf.length) off += fs.writeSync(out, buf, off, buf.length - off);
      written += buf.length;
    };
    write(header);
    write(idBytes(ID.SEGMENT));
    write(sizeVint(segmentDataLen, 8));
    write(seekHead);
    write(info);
    write(tracks);
    write(cues);
    const copyBuf = Buffer.alloc(1 << 20);
    for (const c of p.clusters) {
      const len = c.payloadEnd - c.payloadStart;
      write(idBytes(ID.CLUSTER));
      write(sizeVint(len, 8));
      let at = c.payloadStart;
      while (at < c.payloadEnd) {
        const n = fs.readSync(fd, copyBuf, 0, Math.min(copyBuf.length, c.payloadEnd - at), at);
        if (n <= 0) throw new Error('read failed while copying');
        write(copyBuf.subarray(0, n));
        at += n;
      }
    }
    fs.closeSync(out);
    out = null;
    return {
      durationMs: Math.round(durationTicks * ticksToMs),
      hasVideo: !!p.hasVideo,
      clusters: p.clusters.length,
      cues: points.length,
      bytes: written
    };
  } catch (err) {
    if (out !== null) {
      try { fs.closeSync(out); } catch (_) {}
      try { fs.unlinkSync(outputPath); } catch (_) {}
    }
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}

// Fixes a file in place (via a temporary copy + rename).
function fixWebmInPlace(filePath) {
  const tmp = `${filePath}.fixing`;
  const result = fixWebm(filePath, tmp);
  fs.renameSync(tmp, filePath);
  return result;
}

module.exports = {
  fixWebm,
  fixWebmInPlace,
  // exposed for tests
  _internal: { ID, element, idBytes, sizeVint, uintBytes, floatElement, readHeader, FileReader }
};
