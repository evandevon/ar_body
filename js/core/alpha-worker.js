// Records see-through WebM video without relying on the browser's recorder keeping transparency
// (many computers record through a graphics chip that silently drops it).
//
// Each frame arrives as RGBA pixels. The colour goes to one VP9 encoder and the see-through
// layer (as a grey picture) to a second; both are joined into one WebM the standard way
// (the colour as the frame, the see-through layer attached to it as "BlockAdditional"),
// the same layout FFmpeg and Chrome use, which video editors read.
import { ID, el, concat, idBytes, vintSize, uintEl, uintBytes, strEl, floatEl, readEl, readVint, readUint, fixWebm } from './webm-fix.js?v=44d6bc6b';

const X = { // extra Matroska element IDs
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  CodecID: 0x86, MaxBlockAdditionID: 0x55ee, PixelWidth: 0xb0, PixelHeight: 0xba, FlagLacing: 0x9c, Language: 0x22b59c,
  BlockAdditions: 0x75a1, BlockMore: 0xa6, BlockAddID: 0xee, BlockAdditional: 0xa5,
};

let W = 0, H = 0, colourEnc = null, alphaEnc = null, frames = new Map(), pending = 0, failed = null, keyEvery = 30, count = 0;

const codecs = ['vp09.00.10.08', 'vp09.00.31.08', 'vp09.00.41.08'];
async function pickConfig(w, h, bitrate) {
  for (const codec of codecs) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: 30, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
  }
  return null;
}

function makeEncoder(cfg, slot) {
  const enc = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      let f = frames.get(chunk.timestamp);
      if (!f) frames.set(chunk.timestamp, (f = { t: chunk.timestamp, key: false }));
      f[slot] = data;
      f[slot + 'Key'] = chunk.type === 'key';
      f.key = !!(f.colourKey && f.alphaKey); // a keyframe in the file must be one in both layers
      if (f.colour && f.alpha) pending--;
    },
    error: (e) => { failed = String(e?.message || e); },
  });
  enc.configure(cfg);
  return enc;
}

// BT.601 (limited range): what VP9 players assume when nothing else is said
function toI420(rgba, w, h, colour) {
  const ySize = w * h, cw = w >> 1, ch = h >> 1;
  const out = new Uint8Array(ySize + 2 * cw * ch);
  if (!colour) { // see-through layer: the alpha values themselves, as a grey picture
    for (let i = 0, j = 3; i < ySize; i++, j += 4) out[i] = rgba[j];
    out.fill(128, ySize);
    return out;
  }
  for (let i = 0, j = 0; i < ySize; i++, j += 4) out[i] = (16 + (66 * rgba[j] + 129 * rgba[j + 1] + 25 * rgba[j + 2] + 128) / 256) | 0;
  let u = ySize, v = ySize + cw * ch;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = ((y * 2) * w + x * 2) * 4, b = a + 4, c = a + w * 4, d = c + 4;
      const r = (rgba[a] + rgba[b] + rgba[c] + rgba[d]) / 4, g = (rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[d + 1]) / 4, bl = (rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[d + 2]) / 4;
      out[u++] = (128 + (-38 * r - 74 * g + 112 * bl + 128) / 256) | 0;
      out[v++] = (128 + (112 * r - 94 * g - 18 * bl + 128) / 256) | 0;
    }
  }
  return out;
}

const colorSpace = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };

function encode(rgba, t) {
  const key = count % keyEvery === 0;
  count++;
  pending++;
  for (const [enc, colour] of [[colourEnc, true], [alphaEnc, false]]) {
    const frame = new VideoFrame(toI420(rgba, W, H, colour), { format: 'I420', codedWidth: W, codedHeight: H, timestamp: t, colorSpace });
    enc.encode(frame, { keyFrame: key });
    frame.close();
  }
}

// ---------- joining it all into a WebM
function trackEntry(num, children) { return el(ID.TrackEntry, concat([uintEl(ID.TrackNumber, num), ...children])); }

/** Audio frames + track from the browser's own (audio-only) WebM recording. */
function readAudio(bytes) {
  if (!bytes?.length) return null;
  const d = bytes;
  const ebml = readEl(d, 0);
  const seg = readEl(d, ebml.end);
  const segEnd = seg.size < 0 ? d.length : Math.min(d.length, seg.end);
  let entry = null; const blocks = [];
  for (let p = seg.dataStart; p < segEnd;) {
    const e = readEl(d, p);
    if (e.id === ID.Tracks) {
      for (let q = e.dataStart; q < e.end;) {
        const t = readEl(d, q);
        if (t.id === ID.TrackEntry) { // keep everything except the number (it becomes track 2)
          const parts = [];
          for (let r = t.dataStart; r < t.end;) { const c = readEl(d, r); if (c.id !== ID.TrackNumber) parts.push(d.slice(c.start, c.end)); r = c.end; }
          entry = parts;
        }
        q = t.end;
      }
      p = e.end;
    } else if (e.id === ID.Cluster) {
      let tc = 0;
      const limit = e.size < 0 ? segEnd : e.end;
      let q = e.dataStart;
      while (q < limit) {
        let c; try { c = readEl(d, q); } catch { break; }
        if (c.id === ID.Cluster || c.id === ID.Cues || c.id === ID.Tags) break;
        if (c.size < 0 || c.end > d.length) { q = limit; break; }
        if (c.id === ID.Timecode) tc = readUint(d, c.dataStart, c.end);
        if (c.id === ID.SimpleBlock) {
          const tr = readVint(d, c.dataStart);
          const rel = new DataView(d.buffer, d.byteOffset + c.dataStart + tr.len, 2).getInt16(0);
          blocks.push({ t: tc + rel, body: d.slice(c.dataStart + tr.len + 3, c.end) });
        }
        q = c.end;
      }
      p = q;
    } else if (e.size < 0) break;
    else p = e.end;
  }
  return entry ? { entry, blocks } : null;
}

function blockHeader(track, rel, flags) {
  const b = new Uint8Array(3); new DataView(b.buffer).setInt16(0, rel); b[2] = flags;
  return concat([vintSize(track), b]);
}

function mux(list, audio, offsetMs) {
  const header = el(ID.EBML, concat([uintEl(X.EBMLVersion, 1), uintEl(X.EBMLReadVersion, 1), uintEl(X.EBMLMaxIDLength, 4), uintEl(X.EBMLMaxSizeLength, 8), strEl(X.DocType, 'webm'), uintEl(X.DocTypeVersion, 4), uintEl(X.DocTypeReadVersion, 2)]));
  const uid = Uint8Array.from({ length: 8 }, () => (Math.random() * 255) | 1);
  const tracks = [trackEntry(1, [el(ID.TrackUID, uid), uintEl(ID.TrackType, 1), uintEl(X.FlagLacing, 0), strEl(X.Language, 'und'), strEl(X.CodecID, 'V_VP9'), uintEl(X.MaxBlockAdditionID, 1),
    el(ID.Video, concat([uintEl(X.PixelWidth, W), uintEl(X.PixelHeight, H), uintEl(ID.AlphaMode, 1)]))])];
  if (audio) tracks.push(trackEntry(2, audio.entry));
  const info = el(ID.Info, concat([uintEl(ID.TimecodeScale, 1e6), strEl(ID.MuxingApp, 'AR Body'), strEl(ID.WritingApp, 'AR Body'), floatEl(ID.Duration, 0)]));

  // everything in time order; a new cluster at each video keyframe
  const start = list[0].t; // the file starts at the first picture
  const items = list.map(f => ({ t: Math.round((f.t - start) / 1000), video: f }));
  offsetMs -= Math.round(start / 1000);
  if (audio) for (const b of audio.blocks) { const t = b.t + offsetMs; if (t >= 0) items.push({ t, audio: b }); }
  items.sort((a, b) => a.t - b.t || (a.video ? -1 : 1));
  const clusters = [];
  let cur = null;
  for (const it of items) {
    if (!cur || (it.video?.key && it.t !== cur.tc) || it.t - cur.tc > 30000) { cur = { tc: it.t, parts: [] }; clusters.push(cur); }
    const rel = it.t - cur.tc;
    if (it.video) {
      const f = it.video;
      const kids = [el(ID.Block, concat([blockHeader(1, rel, 0), f.colour]))];
      if (!f.key) kids.push(el(ID.ReferenceBlock, new Uint8Array([0xff]))); // "depends on an earlier frame" (-1)
      kids.push(el(X.BlockAdditions, el(X.BlockMore, concat([uintEl(X.BlockAddID, 1), el(X.BlockAdditional, f.alpha)]))));
      cur.parts.push(el(ID.BlockGroup, concat(kids)));
    } else cur.parts.push(el(ID.SimpleBlock, concat([blockHeader(2, rel, 0x80), it.audio.body])));
  }
  const body = concat([info, el(ID.Tracks, concat(tracks)), ...clusters.map(c => el(ID.Cluster, concat([uintEl(ID.Timecode, c.tc), ...c.parts])))]);
  // fixWebm adds the length, seek index and the ALPHA_MODE tag editors look for
  return fixWebm(concat([header, idBytes(ID.Segment), vintSize(body.length, 8), body]));
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'start') {
      W = m.width & ~1; H = m.height & ~1;
      keyEvery = Math.max(1, Math.round(m.fps || 30));
      frames = new Map(); pending = 0; failed = null; count = 0;
      const cfg = await pickConfig(W, H, m.bitrate || 6e6);
      const acfg = cfg && { ...cfg, bitrate: Math.round((m.bitrate || 6e6) / 3) };
      if (!cfg || !(await VideoEncoder.isConfigSupported(acfg)).supported) { self.postMessage({ type: 'started', ok: false }); return; }
      colourEnc = makeEncoder(cfg, 'colour');
      alphaEnc = makeEncoder(acfg, 'alpha');
      self.postMessage({ type: 'started', ok: true, width: W, height: H });
    } else if (m.type === 'frame') {
      if (failed || !colourEnc) return;
      const rgba = new Uint8Array(m.data);
      if (m.width !== W || m.height !== H) { // odd sizes: crop to even
        const out = new Uint8Array(W * H * 4);
        for (let y = 0; y < H; y++) out.set(rgba.subarray(y * m.width * 4, y * m.width * 4 + W * 4), y * W * 4);
        encode(out, m.t);
      } else encode(rgba, m.t);
      self.postMessage({ type: 'ack', queue: pending + colourEnc.encodeQueueSize });
    } else if (m.type === 'finish') {
      if (colourEnc) { await Promise.all([colourEnc.flush(), alphaEnc.flush()]); colourEnc.close(); alphaEnc.close(); }
      colourEnc = alphaEnc = null;
      if (failed) throw new Error(failed);
      const list = [...frames.values()].filter(f => f.colour && f.alpha).sort((a, b) => a.t - b.t);
      if (!list.length) throw new Error('no frames');
      let audio = null;
      try { audio = readAudio(m.audio ? new Uint8Array(m.audio) : null); } catch (e) { console.warn('sound skipped', e); }
      const bytes = mux(list, audio, m.audioOffset || 0);
      self.postMessage({ type: 'done', bytes, frames: list.length, sound: !!audio }, [bytes.buffer]);
      frames = new Map();
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e) });
  }
};
