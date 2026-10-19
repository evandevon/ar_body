// Rebuilds a WebM recorded by the browser (MediaRecorder) into the standard layout video
// editors expect. Browsers write recordings as a live stream: no total length, no seek index,
// and "unknown size" sections. Many editors then fail to import them properly — often
// dropping the transparency layer. This copies every frame (including the transparency data)
// unchanged and adds: total duration, a seek index (Cues), and a SeekHead pointing to it.

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
  Tags: 0x1254c367, Tag: 0x7373, Targets: 0x63c0, TagTrackUID: 0x63c5, SimpleTag: 0x67c8, TagName: 0x45a3, TagString: 0x4487,
  TrackUID: 0x73c5, AlphaMode: 0x53c0, Video: 0xe0, Void: 0xec,
};
const SEGMENT_CHILDREN = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, ID.Tags, 0x1043a770 /* Chapters */, 0x1941a469 /* Attachments */]);

// ---------- reading
function readVint(d, p, keepMarker) {
  const b = d[p];
  if (!b) throw new Error('bad vint');
  let len = 1;
  while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
  let v = keepMarker ? b : b & (0xff >> len);
  let allOnes = (b & (0xff >> len)) === (0xff >> len);
  for (let i = 1; i < len; i++) { v = v * 256 + d[p + i]; if (d[p + i] !== 0xff) allOnes = false; }
  return { value: v, len, unknown: !keepMarker && allOnes };
}
function readEl(d, p) {
  const id = readVint(d, p, true);
  const size = readVint(d, p + id.len);
  const dataStart = p + id.len + size.len;
  return { id: id.value, start: p, dataStart, size: size.unknown ? -1 : size.value, end: size.unknown ? -1 : dataStart + size.value };
}
const readUint = (d, s, e) => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + d[i]; return v; };

// ---------- writing
function vintSize(n, width) {
  if (!width) { width = 1; while (n >= 2 ** (7 * width) - 1) width++; }
  const out = new Uint8Array(width);
  let v = n;
  for (let i = width - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (width - 1);
  return out;
}
function idBytes(id) { const b = []; let v = id; while (v > 0) { b.unshift(v & 0xff); v = Math.floor(v / 256); } return Uint8Array.from(b); }
function concat(parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function el(id, data, sizeWidth) { return concat([idBytes(id), vintSize(data.length, sizeWidth), data]); }
function uintBytes(v, width) {
  if (!width) { width = 1; while (v >= 2 ** (8 * width)) width++; }
  const out = new Uint8Array(width); let x = v;
  for (let i = width - 1; i >= 0; i--) { out[i] = x % 256; x = Math.floor(x / 256); }
  return out;
}
const uintEl = (id, v, width) => el(id, uintBytes(v, width));
const floatEl = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };
const strEl = (id, s) => el(id, new TextEncoder().encode(s));

/** @param {ArrayBuffer|Uint8Array} input  @returns {Uint8Array} fixed WebM (or the input if it can't be parsed) */
export function fixWebm(input) {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  try { return rebuild(d); }
  catch (e) { console.warn('WebM fix skipped:', e); return d; }
}

function rebuild(d) {
  const ebml = readEl(d, 0);
  if (ebml.id !== ID.EBML) throw new Error('not WebM');
  const header = d.subarray(0, ebml.end);
  const seg = readEl(d, ebml.end);
  if (seg.id !== ID.Segment) throw new Error('no segment');
  const segEnd = seg.size < 0 ? d.length : Math.min(d.length, seg.end);

  let info = null, tracks = null, timecodeScale = 1e6;
  const clusters = []; // { timecode, blocks: [Uint8Array], keyTimes: [] }
  let videoTrack = 1, videoUid = null, hasAlpha = false, lastTime = 0, frameStep = 33;

  let p = seg.dataStart;
  while (p < segEnd) {
    const e = readEl(d, p);
    if (e.id === ID.Info) {
      info = e;
      for (let q = e.dataStart; q < e.end;) { const c = readEl(d, q); if (c.id === ID.TimecodeScale) timecodeScale = readUint(d, c.dataStart, c.end); q = c.end; }
      p = e.end;
    } else if (e.id === ID.Tracks) {
      tracks = d.subarray(e.start, e.end);
      for (let q = e.dataStart; q < e.end;) {
        const t = readEl(d, q);
        if (t.id === ID.TrackEntry) {
          let num = 0, type = 0, uid = null, alpha = false;
          for (let r = t.dataStart; r < t.end;) {
            const c = readEl(d, r);
            if (c.id === ID.TrackNumber) num = readUint(d, c.dataStart, c.end);
            if (c.id === ID.TrackType) type = readUint(d, c.dataStart, c.end);
            if (c.id === ID.TrackUID) uid = d.slice(c.dataStart, c.end);
            if (c.id === ID.Video) for (let v = c.dataStart; v < c.end;) { const a = readEl(d, v); if (a.id === ID.AlphaMode && readUint(d, a.dataStart, a.end)) alpha = true; v = a.end; }
            r = c.end;
          }
          if (type === 1) { videoTrack = num; videoUid = uid; hasAlpha = alpha; }
        }
        q = t.end;
      }
      p = e.end;
    } else if (e.id === ID.Cluster) {
      // children until the cluster's end (or, for unknown size, the next top-level element)
      const cl = { timecode: 0, parts: [], keys: [] };
      let q = e.dataStart;
      const limit = e.size < 0 ? segEnd : e.end;
      while (q < limit) {
        let c;
        try { c = readEl(d, q); } catch { q = limit; break; }
        if (SEGMENT_CHILDREN.has(c.id) || c.id === ID.Segment) break; // next cluster etc.
        if (c.end > d.length || c.size < 0) { q = limit; break; } // truncated tail
        if (c.id === ID.Timecode) cl.timecode = readUint(d, c.dataStart, c.end);
        else if (c.id === ID.SimpleBlock || c.id === ID.BlockGroup) {
          const blk = c.id === ID.SimpleBlock ? c : (() => { for (let r = c.dataStart; r < c.end;) { const b = readEl(d, r); if (b.id === ID.Block) return b; r = b.end; } return null; })();
          if (blk) {
            const track = readVint(d, blk.dataStart);
            const rel = new DataView(d.buffer, d.byteOffset + blk.dataStart + track.len, 2).getInt16(0);
            const t = cl.timecode + rel;
            let key;
            if (c.id === ID.SimpleBlock) key = !!(d[blk.dataStart + track.len + 2] & 0x80);
            else { key = true; for (let r = c.dataStart; r < c.end;) { const b = readEl(d, r); if (b.id === ID.ReferenceBlock) key = false; r = b.end; } }
            if (track.value === videoTrack) {
              if (t > lastTime) frameStep = Math.max(1, Math.min(200, t - lastTime));
              lastTime = Math.max(lastTime, t);
              if (key) cl.keys.push(t);
            }
          }
          cl.parts.push(d.subarray(c.start, c.end));
        }
        q = c.end;
      }
      clusters.push(cl);
      p = q;
    } else if (e.size < 0) {
      throw new Error('unknown-size element');
    } else {
      p = e.end; // Cues/Tags/Void from the original are dropped and rebuilt
    }
  }
  if (!tracks || !clusters.length) throw new Error('incomplete');

  // ---- build the new segment: SeekHead, Info, Tracks, Clusters, Cues
  const durationTicks = lastTime + frameStep; // in timecode units (normally ms)
  const infoEl = el(ID.Info, concat([
    uintEl(ID.TimecodeScale, timecodeScale),
    strEl(ID.MuxingApp, 'AR Body'),
    strEl(ID.WritingApp, 'AR Body (browser recording, re-indexed)'),
    floatEl(ID.Duration, durationTicks),
  ]));
  const clusterEls = clusters.map(cl => el(ID.Cluster, concat([uintEl(ID.Timecode, cl.timecode), ...cl.parts])));

  // SeekHead has a fixed size (positions written as 8 bytes), so offsets can be worked out first
  const seekEntry = (id, pos) => el(ID.Seek, concat([el(ID.SeekID, idBytes(id)), el(ID.SeekPosition, uintBytes(pos, 8))]));
  // Also the text tag ALPHA_MODE=1 that FFmpeg writes, which some editors look for
  const tagsEl = hasAlpha && videoUid ? el(ID.Tags, el(ID.Tag, concat([
    el(ID.Targets, el(ID.TagTrackUID, videoUid)),
    el(ID.SimpleTag, concat([strEl(ID.TagName, 'ALPHA_MODE'), strEl(ID.TagString, '1')])),
  ]))) : new Uint8Array(0);
  const seekHeadSize = el(ID.SeekHead, concat([seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0), ...(tagsEl.length ? [seekEntry(ID.Tags, 0)] : [])])).length;
  const infoPos = seekHeadSize;
  const tracksPos = infoPos + infoEl.length;
  let pos = tracksPos + tracks.length;
  const cuePoints = [];
  clusters.forEach((cl, i) => {
    const times = cl.keys.length ? cl.keys : (i === 0 ? [cl.timecode] : []);
    for (const t of times) cuePoints.push(el(ID.CuePoint, concat([
      uintEl(ID.CueTime, t),
      el(ID.CueTrackPositions, concat([uintEl(ID.CueTrack, videoTrack), uintEl(ID.CueClusterPosition, pos, 8)])),
    ])));
    pos += clusterEls[i].length;
  });
  const cuesPos = pos;
  const cuesEl = el(ID.Cues, concat(cuePoints));
  const tagsPos = cuesPos + cuesEl.length;
  const seekHead = el(ID.SeekHead, concat([seekEntry(ID.Info, infoPos), seekEntry(ID.Tracks, tracksPos), seekEntry(ID.Cues, cuesPos), ...(tagsEl.length ? [seekEntry(ID.Tags, tagsPos)] : [])]));
  const body = concat([seekHead, infoEl, tracks, ...clusterEls, cuesEl, tagsEl]);
  return concat([header, idBytes(ID.Segment), vintSize(body.length, 8), body]);
}
