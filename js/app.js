import { ANCHORS, ANCHOR_BY_ID, computeAnchors, angleDiff } from './body.js?v=9a501ef9';
import { openCamera, stopStream, cameraErrorMessage, deviceList, waitForFrames } from './core/camera.js?v=2afbfead';
import { createProgress } from './core/progress.js?v=4da3a204';
import { createTriggers } from './triggers.js?v=00302682';
import { handInfo } from './poses.js?v=dd7498cd';

const trackerProgress = createProgress();
const mediaProgress = createProgress();

// The body tracker downloads from the internet, so it's loaded separately: if a network blocks
// it, the camera and overlays still work.
let tracker; // module js/core/tracker.js once loaded

// ---------------------------------------------------------------- config

// ---------------------------------------------------------------- elements
const $ = s => document.querySelector(s);
const cam = $('#camera');
const view = $('#view');
const ctx = view.getContext('2d');
const stage = $('#stage');
const statusEl = $('#status');
const list = $('#overlayList');

// ---------------------------------------------------------------- state
const state = {
  stream: null,
  facing: 'user',
  deviceId: '',
  mirror: true,
  model: 'lite',
  numPoses: 1,
  smoothing: 0.5,
  skeleton: false,
  showAnchors: false,
  landmarker: null,
  result: null,
  lastVideoTime: -1,
  lastTs: 0,
  people: [],     // smoothed anchors per tracked person
  overlays: [],
  recorder: null,
};

// ---------------------------------------------------------------- status
let statusTimer;
function setStatus(msg, { sticky = false, error = false } = {}) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', error);
  statusEl.hidden = !msg;
  if (msg && !sticky) statusTimer = setTimeout(() => (statusEl.hidden = true), 4000);
}

// ---------------------------------------------------------------- body tracker
let modelToken = 0;
async function loadModel() {
  const token = ++modelToken;
  setStatus('');
  trackerProgress.set('Loading body tracker…', 0);
  try {
    tracker ??= await import('./core/tracker.js?v=96d3e1a2');
    const lm = await tracker.createPoseTracker({
      model: state.model, numPoses: state.numPoses,
      onProgress: p => p.stage === 'starting'
        ? trackerProgress.set('Starting body tracker…', 1, 'Almost ready')
        : trackerProgress.bytes('Downloading body tracker…', p.loaded, p.total),
    });
    trackerProgress.done();
    if (token !== modelToken) { lm.close(); return; }
    state.landmarker?.close();
    state.landmarker = lm;
    state.trackerMsg = '';
    state.lastTs = 0;
    setStatus(state.stream ? 'Body tracker ready' : 'Body tracker ready — start the camera');
  } catch (e) {
    console.error(e);
    if (token !== modelToken) return;
    trackerProgress.done();
    state.trackerMsg = tracker ? tracker.trackerErrorMessage(e) : 'Body tracking couldn’t load. The camera still works.';
    setStatus(state.trackerMsg, { sticky: true, error: true });
  }
}

// ---------------------------------------------------------------- camera
let camToken = 0;
function stopCamera() {
  stopStream(state.stream);
  state.stream = null;
}

async function startCamera() {
  const token = ++camToken;
  stopCamera();
  setStatus('Starting camera…', { sticky: true });
  let r;
  try { r = await openCamera(cam, { deviceId: state.deviceId, facing: state.facing }); }
  catch (e) {
    console.error(e);
    if (token === camToken) setStatus(cameraErrorMessage(e), { sticky: true, error: true });
    cameras.refresh();
    return;
  }
  if (token !== camToken) { stopStream(r.stream); return; }
  state.stream = r.stream;
  state.deviceId = r.deviceId;
  if (r.facing) state.facing = r.facing;
  state.mirror = r.facing ? r.facing !== 'environment' : state.mirror;
  $('#mirror').checked = state.mirror;
  state.lastVideoTime = -1;
  $('#splash').hidden = true;
  document.body.classList.add('live');
  r.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (state.stream !== r.stream) return;
    setStatus('The camera stopped (unplugged or taken by another app). Choose a camera from the list.', { sticky: true, error: true });
    state.deviceId = '';
    cameras.refresh();
  });
  await cameras.refresh();
  if (!(await waitForFrames(cam))) {
    if (token === camToken) setStatus('The camera is on but not sending a picture. It may be in use by another app, or try another camera from the list.', { sticky: true, error: true });
    return;
  }
  if (token !== camToken) return;
  if (state.landmarker) setStatus('');
  else if (state.trackerMsg) setStatus(state.trackerMsg, { sticky: true, error: true });
  else setStatus('Camera on — body tracker still loading…', { sticky: true });
}

// live-updating camera list (plugging in a USB/document camera adds it straight away)
const cameras = deviceList($('#cameraSelect'), {
  kind: 'videoinput',
  getCurrent: () => state.stream?.getVideoTracks()[0]?.getSettings().deviceId || state.deviceId,
  onChange: id => { state.deviceId = id; startCamera(); },
  onListChange: devices => { $('#flipBtn').hidden = devices.length < 2; $('#splashCameraRow').hidden = devices.length < 2; },
});
const splashCams = deviceList($('#splashCamera'), {
  kind: 'videoinput',
  getCurrent: () => state.deviceId,
  onChange: id => { state.deviceId = id; },
});

// ---------------------------------------------------------------- media loading
const isRemote = src => /^https?:/i.test(src) && new URL(src, location.href).origin !== location.origin;

function kindOf(type, src) {
  const t = (type || '').toLowerCase();
  const ext = (src.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  if (t.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (t === 'image/gif' || ext === 'gif') return 'gif';
  return 'image';
}

// Websites that allow sharing (CORS) load normally. Others still show, but the browser then
// blocks snapshots and recording for safety — we remember that as "tainted".
async function withCorsFallback(src, load) {
  if (!isRemote(src)) return load(false);
  try { return await load(true); }
  catch { return { ...(await load(false)), tainted: true }; }
}

function loadImage(src) {
  return withCorsFallback(src, async cors => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    return { el: img, w: img.naturalWidth || 300, h: img.naturalHeight || 300 };
  });
}

function loadVideo(src) {
  return withCorsFallback(src, async cors => {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    if (cors) v.crossOrigin = 'anonymous';
    v.src = src;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video failed to load')); });
    v.play().catch(() => {}); // may need a tap on some phones; retried in the render loop
    return { el: v, w: v.videoWidth, h: v.videoHeight };
  });
}

// Animated GIFs don't animate when drawn to a canvas, so decode their frames where the browser can.
async function loadGif(src) {
  if (!('ImageDecoder' in window)) return loadImage(src); // first frame only (e.g. Safari)
  try {
    const blob = await (await fetch(src)).blob();
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack.frameCount;
    const frames = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (n > 8) mediaProgress.set('Preparing animated GIF…', i / n, `Frame ${i + 1} of ${n}`);
      const { image } = await dec.decode({ frameIndex: i });
      const bmp = await createImageBitmap(image);
      const dur = Math.max(20, (image.duration ?? 100000) / 1000);
      image.close();
      frames.push({ bmp, start: total, dur });
      total += dur;
    }
    dec.close();
    mediaProgress.done();
    if (!frames.length) return loadImage(src);
    return { frames, total, w: frames[0].bmp.width, h: frames[0].bmp.height };
  } catch (e) {
    mediaProgress.done();
    console.warn('GIF decode failed, using first frame', e);
    return loadImage(src);
  }
}

// ---------------------------------------------------------------- overlays
let nextId = 1;
const DEFAULTS = { anchor: 'head', size: 1, x: 0, y: 0, rot: 0, opacity: 1, follow: true, flip: false, side: false, visible: true };

const nameFromUrl = src => {
  try { const u = new URL(src); return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname); }
  catch { return src; }
};

// An overlay that fails to load is kept (marked as broken) so it isn't silently dropped from the link.
async function addOverlay({ src, settings = {} }) {
  const name = nameFromUrl(src);
  const kind = kindOf('', src);
  let media = null;
  try {
    media = kind === 'video' ? await loadVideo(src) : kind === 'gif' ? await loadGif(src) : await loadImage(src);
  } catch (e) {
    console.error(e);
    setStatus(`Couldn’t load “${name}”. Check the address goes straight to a picture or video file.`, { error: true, sticky: true });
  }
  const o = { id: nextId++, src, name, kind, media, ...DEFAULTS, ...settings };
  if (!ANCHOR_BY_ID[o.anchor]) o.anchor = DEFAULTS.anchor;
  state.overlays.push(o);
  renderCard(o);
  if (!applying) openCard(o);
  updateEmpty();
  saveToLink();
  return o;
}

function removeOverlay(o, { save = true } = {}) {
  state.overlays = state.overlays.filter(x => x !== o);
  if (o.kind === 'video' && o.media) { o.media.el.pause(); o.media.el.removeAttribute('src'); o.media.el.load(); }
  o.media?.frames?.forEach(f => f.bmp.close());
  o.card?.remove();
  updateEmpty();
  if (save) saveToLink();
}

function updateEmpty() {
  $('#emptyMsg').hidden = state.overlays.length > 0;
  $('#clearBtn').disabled = state.overlays.length === 0;
}

// Returns something drawable for "now", plus a stamp that changes when the picture changes.
function currentFrame(o, now) {
  const m = o.media;
  if (m.frames) {
    const t = now % m.total;
    let i = m.frames.findIndex(f => t < f.start + f.dur);
    if (i < 0) i = 0;
    return { img: m.frames[i].bmp, w: m.w, h: m.h, stamp: i };
  }
  if (o.kind === 'video') {
    const v = m.el;
    if (v.paused) v.play().catch(() => {});
    return { img: v, w: v.videoWidth || m.w, h: v.videoHeight || m.h, stamp: v.currentTime, ready: v.readyState >= 2 };
  }
  return { img: m.el, w: m.w, h: m.h, stamp: 0 };
}


// ---------------------------------------------------------------- overlay cards (UI)
function anchorSelect() {
  const sel = document.createElement('select');
  const groups = {};
  for (const a of ANCHORS) {
    if (!groups[a.group]) { groups[a.group] = document.createElement('optgroup'); groups[a.group].label = a.group; sel.append(groups[a.group]); }
    groups[a.group].append(new Option(a.label, a.id));
  }
  return sel;
}

const SLIDERS = [
  { k: 'size', label: 'Size', min: 0.1, max: 4, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { k: 'x', label: 'Left ↔ right', min: -3, max: 3, step: 0.02, fmt: v => v.toFixed(2) },
  { k: 'y', label: 'Down ↕ up', min: -3, max: 3, step: 0.02, fmt: v => v.toFixed(2) },
  { k: 'rot', label: 'Turn', min: -180, max: 180, step: 1, fmt: v => `${v}°` },
  { k: 'opacity', label: 'See-through', min: 0.05, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
];
const CHECKS = [
  { k: 'follow', label: 'Tilt with body' },
  { k: 'flip', label: 'Flip' },
  { k: 'side', label: 'Match left & right', title: 'Draw the picture for the left side of the screen; it is flipped automatically for the matching right-side body part' },
];

function renderCard(o) {
  const li = document.createElement('li');
  li.className = 'card';
  const uid = `ov${o.id}`;

  const head = document.createElement('div');
  head.className = 'card-head';
  const thumb = o.kind === 'video' ? Object.assign(document.createElement('video'), { muted: true, src: o.src, preload: 'metadata', playsInline: true }) : Object.assign(new Image(), { src: o.src, alt: '' });
  thumb.className = 'thumb';
  // eye: quick show/hide (saved in the link)
  const eye = document.createElement('button');
  eye.type = 'button'; eye.className = 'icon-btn eye';
  eye.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="open" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle class="open" cx="12" cy="12" r="3"/><path class="shut" d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
  const syncEye = () => {
    eye.setAttribute('aria-pressed', String(!o.visible));
    eye.setAttribute('aria-label', `${o.visible ? 'Hide' : 'Show'} ${o.name}`);
    eye.title = o.visible ? 'Hide' : 'Show';
    li.classList.toggle('hidden-layer', !o.visible);
  };
  eye.onclick = () => { o.visible = !o.visible; syncEye(); saveToLink(); };
  // the name (with picture) opens and closes the layer's settings
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'card-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', `${uid}-body`);
  const title = document.createElement('span');
  title.className = 'name';
  title.textContent = o.name;
  const where = document.createElement('span');
  where.className = 'where';
  const syncWhere = () => (where.textContent = ANCHOR_BY_ID[o.anchor]?.label.replace(/ \(.*\)/, '') ?? '');
  syncWhere();
  const words = document.createElement('span');
  words.className = 'words';
  words.append(title, where);
  toggle.title = `${o.name} — show or hide settings`;
  toggle.append(thumb, words);
  toggle.onclick = () => openCard(li.classList.contains('open') ? null : o);
  const btns = document.createElement('div');
  btns.className = 'card-btns';
  const mk = (txt, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.textContent = txt; b.setAttribute('aria-label', `${label} ${o.name}`); b.title = label; b.onclick = fn; btns.append(b); };
  mk('↑', 'Move forward', () => moveOverlay(o, 1));
  mk('↓', 'Move back', () => moveOverlay(o, -1));
  mk('⧉', 'Duplicate', () => duplicateOverlay(o));
  mk('✕', 'Remove', () => removeOverlay(o));
  btns.lastChild.classList.add('remove');
  head.append(eye, toggle, btns);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.id = `${uid}-body`;

  const aWrap = document.createElement('label');
  aWrap.className = 'row';
  aWrap.innerHTML = '<span>Stick to</span>';
  const sel = anchorSelect();
  sel.value = o.anchor;
  sel.dataset.k = 'anchor';
  sel.onchange = () => { o.anchor = sel.value; syncWhere(); };
  aWrap.append(sel);
  body.append(aWrap);

  for (const s of SLIDERS) {
    const id = `${uid}-${s.k}`;
    const row = document.createElement('div');
    row.className = 'row slider';
    row.innerHTML = `<label for="${id}">${s.label}</label><output for="${id}"></output>`;
    const inp = Object.assign(document.createElement('input'), { type: 'range', id, min: s.min, max: s.max, step: s.step, value: o[s.k] });
    inp.dataset.k = s.k;
    const out = row.querySelector('output');
    const sync = () => { o[s.k] = +inp.value; out.textContent = s.fmt(o[s.k]); };
    inp.oninput = sync;
    inp.ondblclick = () => { inp.value = DEFAULTS[s.k]; sync(); };
    sync();
    row.append(inp);
    body.append(row);
  }

  const checks = document.createElement('div');
  checks.className = 'checks';
  for (const c of CHECKS) {
    const lab = document.createElement('label');
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: o[c.k] });
    cb.dataset.k = c.k;
    cb.onchange = () => { o[c.k] = cb.checked; };
    lab.append(cb, ` ${c.label}`);
    if (c.title) lab.title = c.title;
    checks.append(lab);
  }
  body.append(checks);


  li.append(head);
  if (!o.media || o.media.tainted) {
    const note = document.createElement('p');
    note.className = 'card-note' + (o.media ? '' : ' bad');
    note.textContent = o.media
      ? 'This website doesn’t allow sharing, so snapshots and recording won’t work while it’s showing.'
      : 'Couldn’t load this address. It needs to go straight to a picture or video file.';
    li.append(note);
  }
  li.append(body);
  li.addEventListener('input', () => saveToLink());
  li.addEventListener('change', () => saveToLink());
  o.card = li;
  syncEye();
  list.prepend(li); // top of list = front-most layer
}

/** Opens one layer's settings and closes the rest (null closes all). */
function openCard(o) {
  for (const x of state.overlays) {
    const open = x === o;
    x.card?.classList.toggle('open', open);
    x.card?.querySelector('.card-toggle')?.setAttribute('aria-expanded', String(open));
  }
  if (o) o.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function moveOverlay(o, dir) {
  const i = state.overlays.indexOf(o);
  const j = i + dir;
  if (j < 0 || j >= state.overlays.length) return;
  [state.overlays[i], state.overlays[j]] = [state.overlays[j], state.overlays[i]];
  // list shows front-most first, i.e. reverse of draw order
  [...state.overlays].reverse().forEach(x => list.append(x.card));
  o.card.querySelector(dir > 0 ? '[title="Move forward"]' : '[title="Move back"]').focus();
  saveToLink();
}

async function duplicateOverlay(o) {
  const settings = pickSettings(o);
  settings.x = Math.min(3, settings.x + 0.3);
  await addOverlay({ src: o.src, settings });
}

const pickSettings = o => Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, o[k]]));

// ---------------------------------------------------------------- layout stored in the link
// The whole layout lives after the # in the address: #l=<compressed settings>.
// Only web addresses of the pictures/videos are stored, so the link works anywhere.
const SHORT = { anchor: 'a', size: 's', x: 'x', y: 'y', rot: 'r', opacity: 'o', follow: 'f', flip: 'm', side: 'sd', visible: 'vi' };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const round = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

const entryOf = (src, settings) => {
  const e = { u: src };
  for (const [k, sk] of Object.entries(SHORT)) {
    const v = settings[k] ?? DEFAULTS[k];
    if (v !== DEFAULTS[k]) e[sk] = typeof v === 'boolean' ? +v : round(v);
  }
  return e;
};
function serialise() {
  const out = { v: 1, p: state.numPoses, q: state.model, o: state.overlays.map(o => entryOf(o.src, o)) };
  const t = triggers.serialise();
  if (t.length) out.t = t; // pose triggers
  return out;
}
/** The layout a link/pack describes, in the same form as serialise(), without loading it. */
function normalise(data) {
  return {
    v: 1,
    p: [1, 2, 3, 4].includes(data.p) ? data.p : state.numPoses,
    q: ['lite', 'full', 'heavy'].includes(data.q) ? data.q : state.model,
    o: (data.o || []).filter(e => typeof e?.u === 'string' && /^https?:/i.test(e.u)).map(e => entryOf(e.u, parseEntry(e))),
    ...(Array.isArray(data.t) && data.t.length ? { t: triggers.normalise(data.t) } : {}),
  };
}
function parseEntry(e) {
  const settings = {};
  for (const [sk, val] of Object.entries(e)) {
    const k = LONG[sk];
    if (!k) continue;
    settings[k] = typeof DEFAULTS[k] === 'boolean' ? !!val : typeof DEFAULTS[k] === 'number' ? (Number.isFinite(+val) ? +val : DEFAULTS[k]) : String(val);
  }
  if (settings.anchor && !ANCHOR_BY_ID[settings.anchor]) settings.anchor = DEFAULTS.anchor;
  return settings;
}

const toB64u = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64u = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

async function encodeLayout(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if ('CompressionStream' in window) return 'z' + toB64u(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j' + toB64u(json);
}
async function decodeLayout(str) {
  const bytes = fromB64u(str.slice(1));
  const json = str[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(json));
}

let applying = false, saveTimer, lastHash = '';
function saveToLink() {
  if (applying) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeLink, 300);
}
async function writeLink() {
  clearTimeout(saveTimer);
  const hash = state.pack && signature() === state.pack.sig
    ? `#pack=${state.pack.id}`
    : '#l=' + (await encodeLayout(state.pack ? { ...serialise(), pk: state.pack.id } : serialise()));
  if (hash !== location.hash) history.replaceState(null, '', location.pathname + location.search + hash);
  lastHash = hash;
}

async function applyLayout(data) {
  applying = true;
  try {
    [...state.overlays].forEach(o => removeOverlay(o, { save: false }));
    if ([1, 2, 3, 4].includes(data.p) && data.p !== state.numPoses) {
      state.numPoses = data.p; $('#people').value = String(data.p);
      try { await state.landmarker?.setOptions({ numPoses: data.p }); } catch {}
    }
    if (['lite', 'full', 'heavy'].includes(data.q) && data.q !== state.model) {
      state.model = data.q; $('#model').value = data.q; if (tracker) loadModel();
    }
    const list = Array.isArray(data.o) ? data.o : [];
    let done = 0;
    for (const e of list) {
      if (list.length > 2) mediaProgress.set('Loading overlays…', done / list.length, `${done} of ${list.length}`);
      done++;
      if (typeof e?.u !== 'string' || !/^https?:\/\//i.test(e.u)) continue;
      await addOverlay({ src: e.u, settings: parseEntry(e) });
    }
    await triggers.load((Array.isArray(data.t) ? data.t : []).filter(e => typeof e?.u === 'string' && /^https?:\/\//i.test(e.u)));
  } finally {
    mediaProgress.done();
    applying = false;
  }
}

// ---------------------------------------------------------------- packs (short links)
// Packs are files in the site's packs/ folder. #pack=skeleton opens packs/skeleton.json — a short
// link that makes a simple QR code. While the layout still matches the pack, the address stays
// short; any change switches it to the full #l= link (and undoing the change switches back).
const SITE = new URL('.', location.href);
const packUrl = id => new URL(`packs/${id}.json`, SITE).href;
const validId = id => /^[a-z0-9][a-z0-9_-]{0,60}$/i.test(id || '');
state.pack = null; // { id, sig } of the pack currently loaded

/** Turns a pack file's picture paths ("assets/bone.svg") into full addresses. */
function resolvePack(data) {
  return { ...data, o: (data.o || []).map(e => ({ ...e, u: new URL(e.u, SITE).href })), t: triggers.resolve(data.t) };
}

// pose triggers: "when someone does this pose, show that"
const triggers = createTriggers({
  loadMedia: async src => {
    const kind = kindOf('', src);
    const media = kind === 'video' ? await loadVideo(src) : kind === 'gif' ? await loadGif(src) : await loadImage(src);
    return { media, kind };
  },
  drawItem: (item, a, t) => drawOverlay(item, a, t),
  anchors: ANCHORS,
  save: () => saveToLink(),
  site: SITE.href,
  status: (msg, o) => setStatus(msg, o),
});
const signature = () => JSON.stringify(serialise());

async function fetchPack(id) {
  const r = await fetch(packUrl(id), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`pack ${id}: ${r.status}`);
  return resolvePack(await r.json());
}

async function openPack(id, { ask = true } = {}) {
  if (!validId(id)) return false;
  if (ask && state.overlays.length && !confirm('Replace the current overlays with this pack?')) return false;
  let data;
  try { data = await fetchPack(id); }
  catch (e) { console.error(e); setStatus(`The “${id}” pack couldn’t be found. Check packs/${id}.json is on the website.`, { error: true, sticky: true }); return false; }
  await applyLayout(data);
  state.pack = { id, sig: signature() };
  await writeLink();
  return true;
}

async function buildPackButtons() {
  const wrap = $('#packList');
  let packs = [];
  try {
    const r = await fetch(new URL('packs/index.json', SITE), { cache: 'no-cache' });
    if (r.ok) packs = (await r.json()).packs || [];
  } catch {}
  if (!packs.length) packs = [{ id: 'crown', name: 'Crown & sparkles' }, { id: 'skeleton', name: 'Skeleton' }];
  wrap.innerHTML = '';
  for (const p of packs) {
    if (!validId(p.id)) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn small';
    b.textContent = p.name || p.id;
    b.onclick = () => openPack(p.id);
    wrap.append(b);
  }
}

async function loadFromLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const str = params.get('l'), pack = params.get('pack');
  if (pack) { if (!(await openPack(pack, { ask: false }))) await applyLayout({ o: [] }); lastHash = location.hash; return; }
  if (str == null) { await openPack('crown', { ask: false }); return; }
  try {
    const data = await decodeLayout(str);
    await applyLayout(data);
    state.pack = null;
    lastHash = location.hash;
    // a changed pack: remember the pack, so undoing the changes brings back its short link
    if (validId(data.pk)) fetchPack(data.pk).then(pk => { state.pack = { id: data.pk, sig: JSON.stringify(normalise(pk)) }; }).catch(() => {});
  }
  catch (e) { console.error(e); setStatus('This link’s layout couldn’t be read — it may have been cut short when copied.', { error: true, sticky: true }); }
}

async function copyLink() {
  await writeLink();
  try { await navigator.clipboard.writeText(location.href); setStatus('Link copied — paste it anywhere to share this layout'); }
  catch { prompt('Copy this link:', location.href); }
}

/** Downloads the current layout as a pack file for the packs/ folder. */
function savePackFile() {
  const data = serialise();
  // pictures on this website are saved as paths, so the pack works wherever the site is hosted
  const local = e => {
    const u = new URL(e.u);
    return u.origin === location.origin && u.pathname.startsWith(SITE.pathname) ? { ...e, u: decodeURIComponent(u.pathname.slice(SITE.pathname.length)) } : e;
  };
  data.o = data.o.map(local);
  if (data.t) data.t = data.t.map(local);
  const name = prompt('Name for this pack (shown on the Packs button):', state.pack?.id || 'My pack');
  if (name == null) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-pack';
  const file = { name, ...data };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${id}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  setStatus(`Saved ${id}.json — put it in the website’s packs/ folder and add { "id": "${id}", "name": "${name.replace(/"/g, '')}" } to packs/index.json. Its link: tracker.html#pack=${id}`, { sticky: true });
}

// ---------------------------------------------------------------- QR code
let qrLib;
function loadQrLib() {
  qrLib ??= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = new URL('vendor/qrcode/qrcode.js', SITE).href;
    sc.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode missing')));
    sc.onerror = () => { qrLib = null; reject(new Error('qrcode failed')); };
    document.head.append(sc);
  });
  return qrLib;
}
async function showQr() {
  await writeLink();
  const url = location.href;
  let qrcode;
  try { qrcode = await loadQrLib(); }
  catch { setStatus('The QR code maker didn’t load — check vendor/qrcode/ is on the website.', { error: true }); return; }
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const c = $('#qrCanvas'), cell = Math.max(4, Math.floor(720 / (n + 8)));
  c.width = c.height = (n + 8) * cell;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell);
  $('#qrUrl').textContent = url;
  const short = !!state.pack && location.hash.startsWith('#pack=');
  $('#qrNote').textContent = short
    ? 'A short pack link — this QR code scans easily, even from across the room.'
    : n > 57 ? 'This link holds the whole layout, so the QR code is dense and needs a close, steady scan. For an easy scan, save the layout as a pack file and share its pack link.'
    : 'This link holds the whole layout. For an even simpler QR code, save the layout as a pack file.';
  $('#qrSheet').hidden = false;
  $('#qrClose').focus();
}

// ---------------------------------------------------------------- tracking + drawing
function updatePeople() {
  const res = state.result;
  const W = view.width, H = view.height;
  const k = 1 - state.smoothing * 0.88;
  for (let i = 0; i < state.numPoses; i++) {
    const lm = res?.landmarks?.[i];
    const person = (state.people[i] ??= {});
    if (!lm) { for (const a of Object.values(person)) a.vis *= 0.75; continue; }
    const target = computeAnchors(lm, W, H, state.mirror);
    for (const [id, t] of Object.entries(target)) {
      const s = person[id];
      if (!s || s.vis < 0.05) { person[id] = { ...t, full: t.len ? Math.max(t.len / t.scale, (BONE_PRIOR[id] || 0) * 0.8) : 0 }; continue; }
      s.x += (t.x - s.x) * k;
      s.y += (t.y - s.y) * k;
      s.scale += (t.scale - s.scale) * k;
      if (t.len) s.len += (t.len - s.len) * k;
      s.angle += angleDiff(s.angle, t.angle) * k;
      s.vis += (t.vis - s.vis) * Math.max(k, 0.3);
      // Remember each bone's full length (relative to body size). When it looks shorter while
      // the body stays the same size, the limb is pointing toward/away from the camera.
      if (t.len && s.vis > 0.5) s.full = Math.max(s.len / s.scale, (s.full || 0) * 0.9993, (BONE_PRIOR[id] || 0) * 0.8);
    }
  }
  state.people.length = state.numPoses;
}

const fade = v => Math.min(1, Math.max(0, (v - 0.35) / 0.3));
// typical bone length as a multiple of shoulder width, so tilting works from the first moment
const BONE_PRIOR = { lUpperArm: 0.8, rUpperArm: 0.8, lForearm: 0.7, rForearm: 0.7, lThigh: 1.05, rThigh: 1.05, lShin: 1.05, rShin: 1.05, spine: 1.3 };

function drawOverlay(o, a, now) {
  if (!o.media || !o.visible) return;
  const alpha = o.opacity * fade(a.vis);
  if (alpha < 0.01) return;
  const f = currentFrame(o, now);
  if (f.ready === false || !f.w || !f.h) return;
  const img = f.img;
  const def = ANCHOR_BY_ID[o.anchor];
  let w, h;
  if (def.bone) {
    // full-length picture, squashed only along the bone when the limb points toward the camera —
    // like a card tilting in depth, instead of the whole picture shrinking
    const fullLen = Math.max(a.len, (a.full || 0) * a.scale);
    w = def.size * o.size * fullLen * (f.w / f.h);
    h = def.size * o.size * a.len;
  }
  else { w = def.size * o.size * a.scale; h = w * (f.h / f.w); }
  ctx.save();
  ctx.translate(a.x, a.y);
  if (o.follow) ctx.rotate(a.angle);
  ctx.translate(o.x * a.scale, -o.y * a.scale);
  ctx.rotate((o.rot * Math.PI) / 180);
  // "Match left & right": pictures are drawn for limbs on the left of the screen, and flipped
  // for the limb on the right. Decided by which limb it is (not where it is right now), so a
  // hand crossing the body doesn't suddenly flip.
  const side = /^([lr])[A-Z]/.exec(o.anchor)?.[1];
  const onRight = side && (side === 'l') !== state.mirror;
  if (o.flip !== (o.side && !!onRight)) ctx.scale(-1, 1);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Debug view: bones between confident points; every point drawn, faded orange when the
// tracker is unsure (low visibility), with the person's number by their nose.
function drawSkeleton() {
  const W = view.width, H = view.height;
  const lw = Math.max(2, W / 400);
  const X = q => (state.mirror ? 1 - q.x : q.x) * W;
  const vis = q => q.visibility ?? 1;
  ctx.save();
  ctx.lineWidth = lw;
  ctx.font = `700 ${Math.round(lw * 7)}px system-ui, sans-serif`;
  (state.result?.landmarks ?? []).forEach((lm, n) => {
    ctx.strokeStyle = 'rgba(120, 255, 200, 0.85)';
    ctx.beginPath();
    for (const { start, end } of tracker?.poseConnections() ?? []) {
      const a = lm[start], b = lm[end];
      if (vis(a) < 0.5 || vis(b) < 0.5) continue;
      ctx.moveTo(X(a), a.y * H);
      ctx.lineTo(X(b), b.y * H);
    }
    ctx.stroke();
    for (const q of lm) {
      const v = vis(q);
      ctx.globalAlpha = v < 0.5 ? 0.25 + v * 0.5 : 1;
      ctx.fillStyle = v < 0.5 ? '#ff9a3c' : '#ffffff';
      ctx.beginPath();
      ctx.arc(X(q), q.y * H, lw * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(120, 255, 200, 1)';
    ctx.fillText(`#${n + 1}`, X(lm[0]) + lw * 5, lm[0].y * H - lw * 5);
    // hands: which way the fingers point, and the guess at which side faces the camera
    const hi = handInfo(lm, cam.videoWidth || W, cam.videoHeight || H);
    for (const [s, w, ix, pk] of [['l', 15, 19, 17], ['r', 16, 20, 18]]) {
      const h = hi[s];
      if (!h) continue;
      const kx = (X(lm[ix]) + X(lm[pk])) / 2, ky = (lm[ix].y + lm[pk].y) / 2 * H;
      ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = lw * 1.5;
      ctx.beginPath(); ctx.moveTo(X(lm[w]), lm[w].y * H); ctx.lineTo(kx, ky); ctx.stroke();
      const label = h.palm > 0.3 ? 'palm' : h.palm < -0.3 ? 'back' : '?';
      ctx.fillStyle = h.palm > 0.3 ? '#ffd34d' : h.palm < -0.3 ? '#8fd3ff' : 'rgba(255,255,255,.7)';
      ctx.fillText(`${label} ${Math.round(Math.abs(h.palm) * 100)}%`, kx + lw * 4, ky);
    }
  });
  // tracking speed, handy when comparing accuracy settings
  if (state.fps) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(lw * 4, lw * 4, lw * 34, lw * 11);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.round(state.fps)} fps`, lw * 7, lw * 12.5);
  }
  ctx.restore();
}

function drawAnchorPoints() {
  const r = Math.max(4, view.width / 220);
  ctx.save();
  ctx.font = `600 ${Math.round(r * 3)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const person of state.people) {
    for (const [id, a] of Object.entries(person ?? {})) {
      if (fade(a.vis) < 0.5) continue;
      ctx.fillStyle = '#ffcc33';
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = r * 0.8; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      const label = ANCHOR_BY_ID[id].label.replace(/ \(.*\)/, '');
      ctx.strokeText(label, a.x + r * 1.8, a.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, a.x + r * 1.8, a.y);
    }
  }
  ctx.restore();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!state.stream || cam.readyState < 2 || !cam.videoWidth) return;
  if (view.width !== cam.videoWidth || view.height !== cam.videoHeight) {
    view.width = cam.videoWidth; view.height = cam.videoHeight;
  }

  if (state.landmarker && cam.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = cam.currentTime;
    const ts = Math.max(performance.now(), state.lastTs + 1);
    state.lastTs = ts;
    if (state.lastDetect) state.fps = (state.fps || 30) * 0.9 + (1000 / Math.max(1, ts - state.lastDetect)) * 0.1;
    state.lastDetect = ts;
    try { state.result = state.landmarker.detectForVideo(cam, ts); }
    catch (e) { console.warn(e); }
    updatePeople();
    triggers.update(Array.from({ length: state.numPoses }, (_, i) => state.result?.landmarks?.[i]), cam.videoWidth, cam.videoHeight, now);
  }

  ctx.save();
  if (state.mirror) { ctx.translate(view.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(cam, 0, 0, view.width, view.height);
  ctx.restore();

  if (state.skeleton) drawSkeleton();
  for (const person of state.people) {
    if (!person) continue;
    for (const o of state.overlays) {
      const a = person[o.anchor];
      if (a) drawOverlay(o, a, now);
    }
  }
  triggers.draw(i => state.people[i], now);
  if (state.showAnchors) drawAnchorPoints();
}

// ---------------------------------------------------------------- snapshot + recording
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const stampName = ext => `ar-body-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;

function blockedByTaint(action) {
  const t = state.overlays.filter(o => o.media?.tainted);
  if (!t.length) return false;
  setStatus(`Can’t ${action} while “${t[0].name}” is showing — its website doesn’t allow sharing. Remove it, or host a copy somewhere that does (e.g. your GitHub repo).`, { error: true, sticky: true });
  return true;
}

function snapshot() {
  if (!state.stream || blockedByTaint('save a snapshot')) return;
  try {
    view.toBlob(b => (b ? download(b, stampName('png')) : setStatus('Snapshot failed', { error: true })), 'image/png');
    stage.classList.add('flash');
    setTimeout(() => stage.classList.remove('flash'), 200);
  } catch {
    setStatus('Can’t save a snapshot while a picture from another website is showing. Download that picture and add the file instead.', { error: true });
  }
}

function toggleRecording() {
  const btn = $('#recordBtn');
  if (state.recorder) { state.recorder.stop(); return; }
  if (!state.stream || blockedByTaint('record')) return;
  if (!window.MediaRecorder || !view.captureStream) { setStatus('Recording isn’t supported in this browser', { error: true }); return; }
  const type = ['video/mp4;codecs=avc1', 'video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try { rec = new MediaRecorder(view.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 6e6 } : {}); }
  catch { setStatus('Can’t record while a picture from another website is showing.', { error: true }); return; }
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    state.recorder = null;
    btn.classList.remove('recording');
    btn.setAttribute('aria-label', 'Start recording');
    btn.querySelector('.lbl').textContent = 'Record';
    const mime = rec.mimeType || type || 'video/webm';
    let blob = new Blob(chunks, { type: mime });
    // browsers write WebM as a live stream; rebuild it into the standard layout editors expect
    if (mime.includes('webm')) {
      const { fixWebm } = await import('./core/webm-fix.js?v=aa8263ee');
      blob = new Blob([fixWebm(new Uint8Array(await blob.arrayBuffer()))], { type: 'video/webm' });
    }
    download(blob, stampName(mime.includes('mp4') ? 'mp4' : 'webm'));
  };
  try { rec.start(1000); } catch { setStatus('Recording couldn’t start in this browser', { error: true }); return; }
  state.recorder = rec;
  btn.classList.add('recording');
  btn.setAttribute('aria-label', 'Stop recording');
  btn.querySelector('.lbl').textContent = 'Stop';
}

// ---------------------------------------------------------------- wiring
$('#startBtn').onclick = startCamera;
// cycles through cameras (front/back on phones)
$('#flipBtn').onclick = async () => {
  const devices = await cameras.refresh();
  const cur = state.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const i = devices.findIndex(d => d.deviceId === cur);
  if (devices.length > 1 && devices[0].deviceId) state.deviceId = devices[(i + 1) % devices.length].deviceId;
  else { state.deviceId = ''; state.facing = state.facing === 'user' ? 'environment' : 'user'; }
  startCamera();
};
$('#mirror').onchange = e => (state.mirror = e.target.checked);
$('#snapBtn').onclick = snapshot;
$('#recordBtn').onclick = toggleRecording;
$('#fullBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}));
$('#panelBtn').onclick = () => {
  const hidden = document.body.classList.toggle('panel-hidden');
  $('#panelBtn').setAttribute('aria-expanded', String(!hidden));
};

async function addFromAddress(text) {
  let u;
  try { u = new URL(text.trim()); } catch { setStatus('That doesn’t look like a web address', { error: true }); return false; }
  if (!/^https?:$/.test(u.protocol)) { setStatus('Use a web address starting with https://', { error: true }); return false; }
  const o = await addOverlay({ src: u.href });
  return !!o?.media;
}

$('#urlForm').onsubmit = async e => {
  e.preventDefault();
  const inp = $('#urlInput');
  if (inp.value.trim() && (await addFromAddress(inp.value))) inp.value = '';
};
$('#copyLinkBtn').onclick = copyLink;
buildPackButtons();
$('#qrBtn').onclick = showQr;
$('#savePackBtn').onclick = savePackFile;
triggers.wire(() => { const lm = state.result?.landmarks?.[0]; return lm && state.stream ? { lm, vw: cam.videoWidth, vh: cam.videoHeight } : null; });
$('#qrClose').onclick = () => { $('#qrSheet').hidden = true; $('#qrBtn').focus(); };
$('#qrCopy').onclick = copyLink;
$('#qrDownload').onclick = () => $('#qrCanvas').toBlob(b => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `ar-body-qr${state.pack ? '-' + state.pack.id : ''}.png` });
  document.body.append(a); a.click(); a.remove();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#qrSheet').hidden) $('#qrClose').click(); });
// clicking the camera picture closes any open layer settings
$('#view').addEventListener('pointerdown', () => openCard(null));
$('#clearBtn').onclick = () => { if (confirm('Remove all overlays?')) { [...state.overlays].forEach(o => removeOverlay(o, { save: false })); saveToLink(); } };

$('#model').onchange = e => { state.model = e.target.value; loadModel(); saveToLink(); };
$('#people').onchange = async e => {
  state.numPoses = +e.target.value;
  saveToLink();
  try { await state.landmarker?.setOptions({ numPoses: state.numPoses }); } catch { loadModel(); }
};
$('#smoothing').oninput = e => (state.smoothing = +e.target.value);

// Skeleton (debug view): checkbox in the panel, button in the toolbar, or press S
function setSkeleton(on) {
  state.skeleton = on;
  $('#skeleton').checked = on;
  $('#skeletonBtn').setAttribute('aria-pressed', String(on));
}
$('#skeleton').onchange = e => setSkeleton(e.target.checked);
$('#skeletonBtn').onclick = () => setSkeleton(!state.skeleton);
$('#anchorsToggle').onchange = e => (state.showAnchors = e.target.checked);
window.addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 's' || e.key === 'S') setSkeleton(!state.skeleton);
});

// Drag a picture from another browser tab, or paste a copied web address, to add it
let dragDepth = 0;
const dragsLink = e => ['text/uri-list', 'text/plain'].some(t => e.dataTransfer?.types.includes(t));
window.addEventListener('dragenter', e => { if (dragsLink(e)) { dragDepth++; $('#dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').hidden = true;
  const dt = e.dataTransfer;
  const url = (dt?.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#')) || dt?.getData('text/plain');
  if (url && /^https?:\/\//i.test(url.trim())) addFromAddress(url);
  else if (dt?.files?.length) setStatus('Files from your computer can’t go in a link. Upload them somewhere online (e.g. your GitHub repo) and add the web address.', { error: true, sticky: true });
});
window.addEventListener('paste', e => {
  if (e.target.closest?.('input, textarea')) return;
  const text = e.clipboardData?.getData('text/plain')?.trim();
  if (text && /^https?:\/\//i.test(text)) addFromAddress(text);
});

// A different layout link pasted into this tab's address bar
window.addEventListener('hashchange', () => { if (location.hash !== lastHash) loadFromLink(); });

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.stream) cam.play().catch(() => {}); });

// ---------------------------------------------------------------- start
if (!window.isSecureContext) $('#splashHint').textContent = 'Open this page over https:// (e.g. GitHub Pages) or http://localhost for the camera to work.';
updateEmpty();
loadModel();
loadFromLink();
requestAnimationFrame(frame);
window.__appReady = true;
