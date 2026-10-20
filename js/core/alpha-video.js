// See-through video recording and reading, done by the page itself (WebCodecs), so the
// transparency doesn't depend on the computer's video recorder or player keeping it.
// Recording: frames → alpha-worker.js → WebM (VP9 + transparency layer).
// Reading:   decodeFrames() turns such a WebM back into see-through pictures (used for GIFs).
import { ID, readEl, readVint, readUint } from './webm-fix.js?v=aa8263ee';

const hasWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** True if this browser can record see-through video itself. */
export async function canRecordAlphaItself(w = 1280, h = 720) {
  if (!hasWebCodecs() || typeof Worker === 'undefined') return false;
  for (const codec of ['vp09.00.10.08', 'vp09.00.31.08', 'vp09.00.41.08']) {
    try {
      const [e, d] = await Promise.all([
        VideoEncoder.isConfigSupported({ codec, width: w & ~1, height: h & ~1, bitrate: 6e6, framerate: 30 }),
        VideoDecoder.isConfigSupported({ codec }),
      ]);
      if (e.supported && d.supported) return true;
    } catch {}
  }
  return false;
}

/**
 * @param canvas the stage (2D canvas, see-through where nothing is drawn)
 * @param opts.audioTrack microphone track (optional)  opts.fps (default 30)
 * Call capture() after every redraw of the canvas; stop() resolves to { blob, frames, sound }.
 */
export async function createAlphaRecorder(canvas, { audioTrack = null, fps = 30, bitrate = 6e6 } = {}) {
  const worker = new Worker(new URL('./alpha-worker.js?v=ee3fe622', import.meta.url), { type: 'module' });
  const call = (msg, transfer) => new Promise((resolve, reject) => {
    const on = ({ data: m }) => {
      if (m.type === 'error') { worker.removeEventListener('message', on); reject(new Error(m.message)); }
      else if (m.type === (msg.type === 'start' ? 'started' : 'done')) { worker.removeEventListener('message', on); resolve(m); }
    };
    worker.addEventListener('message', on);
    worker.postMessage(msg, transfer || []);
  });
  const started = await call({ type: 'start', width: canvas.width, height: canvas.height, fps, bitrate });
  if (!started.ok) { worker.terminate(); throw new Error('encoder unavailable'); }

  // Back-pressure: frames sent but not yet taken by the worker (inFlight), and frames waiting
  // inside the encoders (encQueue). If the computer can't keep up, frames are skipped — the
  // video keeps its full length, it just moves a little less smoothly.
  let inFlight = 0, encQueue = 0, last = -1e9, t0 = performance.now(), dropped = 0, stopped = false;
  worker.addEventListener('message', ({ data: m }) => {
    if (m.type === 'ack') { inFlight = Math.max(0, inFlight - 1); encQueue = m.queue; }
    else if (m.type === 'status') encQueue = m.queue;
  });
  const g = canvas.getContext('2d');

  // sound: the browser's own recorder, sound only (it never had the transparency problem)
  let audioRec = null, audioChunks = [], audioOffset = 0;
  if (audioTrack && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    try {
      audioRec = new MediaRecorder(new MediaStream([audioTrack]), { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128e3 });
      audioRec.ondataavailable = e => e.data.size && audioChunks.push(e.data);
      audioRec.start(1000);
      audioOffset = performance.now() - t0;
    } catch (e) { console.warn('sound recording failed', e); audioRec = null; }
  }
  const step = 1000 / fps;

  return {
    get dropped() { return dropped; },
    capture(now = performance.now()) {
      if (stopped || now - last < step * 0.85 || now < t0) return;
      if (inFlight > 2 || encQueue > 4) { dropped++; return; } // behind: skip this frame rather than pile up
      last = now;
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      inFlight++;
      worker.postMessage({ type: 'frame', data: img.data.buffer, width: img.width, height: img.height, t: Math.round((now - t0) * 1000) }, [img.data.buffer]);
    },
    async stop() {
      stopped = true;
      let audio = null;
      if (audioRec) {
        await new Promise(r => { audioRec.onstop = r; audioRec.stop(); });
        audio = await new Blob(audioChunks).arrayBuffer();
      }
      try {
        const res = await call({ type: 'finish', audio, audioOffset: Math.round(audioOffset) }, audio ? [audio] : []);
        return { blob: new Blob([res.bytes], { type: 'video/webm' }), frames: res.frames, sent: res.sent, outputs: res.outputs, sound: res.sound };
      } finally { worker.terminate(); }
    },
    cancel() { stopped = true; try { audioRec?.stop(); } catch {} worker.terminate(); },
  };
}

// ------------------------------------------------------------------ reading
const BLOCK_ADDITIONS = 0x75a1, BLOCK_MORE = 0xa6, BLOCK_ADDITIONAL = 0xa5;

/** Video frames of a see-through WebM: [{ t (ms), key, colour, alpha }] */
function readFrames(d) {
  const out = [];
  const ebml = readEl(d, 0);
  const seg = readEl(d, ebml.end);
  const segEnd = seg.size < 0 ? d.length : Math.min(d.length, seg.end);
  let vt = 1, codec = 'vp09.00.10.08';
  for (let p = seg.dataStart; p < segEnd;) {
    const e = readEl(d, p);
    if (e.id === ID.Tracks) {
      for (let q = e.dataStart; q < e.end;) {
        const t = readEl(d, q); let num = 0, type = 0;
        for (let r = t.dataStart; r < t.end;) { const c = readEl(d, r); if (c.id === ID.TrackNumber) num = readUint(d, c.dataStart, c.end); if (c.id === ID.TrackType) type = readUint(d, c.dataStart, c.end); r = c.end; }
        if (type === 1) vt = num;
        q = t.end;
      }
    }
    if (e.id === ID.Cluster && e.size >= 0) {
      let tc = 0;
      for (let q = e.dataStart; q < e.end;) {
        const c = readEl(d, q);
        if (c.id === ID.Timecode) tc = readUint(d, c.dataStart, c.end);
        if (c.id === ID.BlockGroup || c.id === ID.SimpleBlock) {
          let blk = c.id === ID.SimpleBlock ? c : null, key = c.id === ID.SimpleBlock ? null : true, alpha = null;
          if (c.id === ID.BlockGroup) for (let r = c.dataStart; r < c.end;) {
            const b = readEl(d, r);
            if (b.id === ID.Block) blk = b;
            if (b.id === ID.ReferenceBlock) key = false;
            if (b.id === BLOCK_ADDITIONS) for (let s = b.dataStart; s < b.end;) {
              const m = readEl(d, s);
              if (m.id === BLOCK_MORE) for (let u = m.dataStart; u < m.end;) { const a = readEl(d, u); if (a.id === BLOCK_ADDITIONAL) alpha = d.subarray(a.dataStart, a.end); u = a.end; }
              s = m.end;
            }
            r = b.end;
          }
          if (blk) {
            const tr = readVint(d, blk.dataStart);
            if (tr.value === vt) {
              const h = blk.dataStart + tr.len;
              const rel = new DataView(d.buffer, d.byteOffset + h, 2).getInt16(0);
              if (key === null) key = !!(d[h + 2] & 0x80);
              out.push({ t: tc + rel, key, colour: d.subarray(h + 3, blk.end), alpha });
            }
          }
        }
        q = c.end;
      }
    }
    if (e.size < 0) break;
    p = e.end;
  }
  return { frames: out.sort((a, b) => a.t - b.t), codec };
}

/** VP9 frames say in their first byte whether they are a keyframe (frame_type 0, profile 0–2). */
const isKey = b => !!b && b.length > 0 && (b[0] & 0xc0) === 0x80 && !(b[0] & 0x08) && !(b[0] & 0x04);

/** How much of a WebM is see-through-capable: { frames, withAlpha } */
export function alphaFrameCount(bytes) {
  try { const { frames } = readFrames(bytes); return { frames: frames.length, withAlpha: frames.filter(f => f.alpha).length }; }
  catch { return { frames: 0, withAlpha: 0 }; }
}

/**
 * Decodes a see-through WebM into pictures at the given times.
 * @param bytes Uint8Array  @param times ms, ascending  @param w,h output size
 * @param onFrame(i, ImageData) called once per time, in order (the same picture may repeat)
 * @param before optional async hook, awaited before each frame is decoded (to slow decoding down;
 *        resolving to false stops decoding)
 */
export async function decodeFrames(bytes, { times, width, height, onFrame, before }) {
  const { frames } = readFrames(bytes);
  if (!frames.length) throw new Error('no frames');
  const c = new OffscreenCanvas(width, height), g = c.getContext('2d', { willReadFrequently: true });
  const ac = new OffscreenCanvas(width, height), ag = ac.getContext('2d', { willReadFrequently: true });
  let ti = 0, prev = null, failed = null;
  const emitUntil = (limit) => { // every wanted time before `limit` shows the previous picture
    while (ti < times.length && (limit == null || times[ti] < limit) && prev) { onFrame(ti, prev); ti++; }
  };
  const colours = [], alphas = [];
  const pair = () => {
    while (colours.length && alphas.length) {
      const cf = colours.shift(), af = alphas.shift();
      const t = cf.timestamp / 1000;
      emitUntil(t);
      g.clearRect(0, 0, width, height); g.drawImage(cf, 0, 0, width, height);
      ag.drawImage(af, 0, 0, width, height);
      cf.close(); af.close();
      const img = g.getImageData(0, 0, width, height), a = ag.getImageData(0, 0, width, height).data;
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = a[i - 3];
      prev = img;
    }
  };
  const mk = (list) => new VideoDecoder({ output: f => { list.push(f); pair(); }, error: e => (failed = e) });
  const cd = mk(colours), adc = mk(alphas);
  const codec = await (async () => { for (const k of ['vp09.00.10.08', 'vp09.00.31.08']) if ((await VideoDecoder.isConfigSupported({ codec: k })).supported) return k; return 'vp09.00.10.08'; })();
  cd.configure({ codec }); adc.configure({ codec });
  const opaque = new Uint8Array(0);
  let started = false;
  for (const f of frames) {
    if (failed) throw failed;
    if (times.length && f.t > times[times.length - 1] + 200) break; // past the end of what's wanted
    if (before && (await before(f.t)) === false) break; // asked to stop
    const ts = Math.round(f.t * 1000);
    if (!started) { if (!(isKey(f.colour) && isKey(f.alpha))) continue; started = true; }
    cd.decode(new EncodedVideoChunk({ type: isKey(f.colour) ? 'key' : 'delta', timestamp: ts, data: f.colour }));
    adc.decode(new EncodedVideoChunk({ type: isKey(f.alpha) ? 'key' : 'delta', timestamp: ts, data: f.alpha || opaque }));
    while (!failed && cd.decodeQueueSize + adc.decodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
  }
  if (failed) throw failed;
  await Promise.all([cd.flush(), adc.flush()]);
  cd.close(); adc.close();
  if (failed) throw failed;
  emitUntil(null);
}
