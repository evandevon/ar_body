import { findCharacter, paperMap, applyEdits, cutOut, maskFromAlpha } from './cutout.js';
import { JOINTS, LINKS, guessJoints, buildRig, Puppet, readPerformer } from './rig.js';
import { PuppetRenderer } from './renderer.js';
import { SCENES, drawCover } from './backgrounds.js';
import { saveCharacter, listCharacters, deleteCharacter, getCharacter } from './storage.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MAX_SIDE = 720; // photos are processed at this size — plenty for a drawing, fast on phones
const STAGE = { landscape: [1280, 720], portrait: [720, 1280], square: [960, 960] };
const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

// ------------------------------------------------------------------ state
const S = {
  step: 'drawing',
  photo: null,              // { canvas, data: ImageData, w, h }
  paper: null, auto: null, add: null, erase: null, mask: null,
  maskVersion: 0,
  undo: [],
  cut: null,                // { canvas, w, h, mask }
  joints: null, jointsVersion: -1,
  rig: null, puppet: null,
  charId: null,
  bgImage: null,
  cam: { stream: null, facing: isPhone ? 'environment' : 'user', mirror: !isPhone },
  tracker: null, trackerLoading: null,
  result: null, lastVideoTime: -1, lastTs: 0, lastSeen: 0,
  recorder: null,
};

const DEFAULT_SETTINGS = { scene: 'sky', colour: '#ffd9e8', inset: 'tr', insetDots: false, shape: isPhone ? 'portrait' : 'landscape', size: 0.72, move: true };
let settings = { ...DEFAULT_SETTINGS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('animate-settings') || '{}')); } catch {}
const saveSettings = () => { try { localStorage.setItem('animate-settings', JSON.stringify(settings)); } catch {} };

// ------------------------------------------------------------------ helpers
let toastTimer;
function toast(msg, { error = false, ms = 3500 } = {}) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('error', error); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const canvasPoint = (canvas, e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height, k: canvas.width / r.width };
};
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed')); i.src = src; });
const toBlob = (canvas, type = 'image/png', q) => new Promise(res => canvas.toBlob(res, type, q));

// ------------------------------------------------------------------ steps
const ORDER = ['drawing', 'cutout', 'joints', 'scene', 'perform'];
async function show(step) {
  const prev = S.step;
  S.step = step;
  $$('.step').forEach(s => (s.hidden = s.dataset.step !== step));
  const at = ORDER.indexOf(step);
  $$('.steps li').forEach((li, i) => {
    li.classList.toggle('current', i === at);
    li.classList.toggle('done', i < at);
    if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  if (prev === 'perform' && step !== 'perform') leavePerform();
  if (step === 'drawing') renderSaved();
  if (step === 'cutout') { fitCanvas($('#cutCanvas'), S.photo.w, S.photo.h); renderCut(); }
  if (step === 'joints') { fitCanvas($('#jointCanvas'), S.cut.w, S.cut.h); renderJoints(); }
  if (step === 'scene') enterScene();
  if (step === 'perform') enterPerform();
}
$$('[data-go]').forEach(b => (b.onclick = () => {
  const to = b.dataset.go;
  if (to === 'cutout' && !S.photo) return show('drawing'); // reopened characters have no photo to re-cut
  show(to);
}));

function fitCanvas(c, w, h) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }

// ------------------------------------------------------------------ 1. drawing
async function loadPhoto(src) {
  let img;
  try { img = await loadImg(src); }
  catch { toast('That picture couldn’t be opened.', { error: true }); return; }
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  S.photo = { canvas, data, w, h };
  S.paper = paperMap(data);
  S.auto = findCharacter(data, { sensitivity: +$('#sensitivity').value, paper: S.paper }).mask;
  S.add = new Uint8Array(w * h);
  S.erase = new Uint8Array(w * h);
  S.undo = [];
  updateMask();
  S.joints = null; S.charId = null; S.jointsVersion = -1;
  show('cutout');
}
for (const id of ['#photoInput', '#fileInput']) {
  $(id).onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) loadPhoto(URL.createObjectURL(f));
  };
}
$('#exampleBtn').onclick = () => loadPhoto('assets/example-drawing.jpg');

async function renderSaved() {
  let items = [];
  try { items = await listCharacters(); } catch (e) { console.warn(e); }
  const list = $('#savedList');
  list.innerHTML = '';
  $('#savedWrap').hidden = !items.length;
  for (const c of items) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open'; open.type = 'button';
    open.setAttribute('aria-label', `Open character saved ${new Date(c.updated).toLocaleDateString()}`);
    const im = new Image(); im.alt = ''; im.src = URL.createObjectURL(c.thumb);
    open.append(im);
    open.onclick = () => openSaved(c.id);
    const del = document.createElement('button');
    del.className = 'del'; del.type = 'button'; del.textContent = '✕'; del.setAttribute('aria-label', 'Delete this character');
    del.onclick = async () => { if (confirm('Delete this character from this device?')) { await deleteCharacter(c.id); renderSaved(); } };
    li.append(open, del);
    list.append(li);
  }
}

async function openSaved(id) {
  const c = await getCharacter(id);
  if (!c) return;
  const img = await loadImg(URL.createObjectURL(c.image));
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  S.cut = { canvas, w: canvas.width, h: canvas.height, mask: maskFromAlpha(data) };
  S.joints = c.joints;
  S.photo = null;
  S.charId = c.id;
  await prepareRig(false);
  show('scene');
}

// ------------------------------------------------------------------ 2. cut out
function updateMask() {
  S.mask = applyEdits(S.auto, S.add, S.erase);
  S.maskVersion++;
}

let cutQueued = false;
function renderCut() {
  if (cutQueued) return;
  cutQueued = true;
  requestAnimationFrame(() => {
    cutQueued = false;
    const { w, h, data } = S.photo;
    const c = $('#cutCanvas'), g = c.getContext('2d');
    const out = g.createImageData(w, h);
    const m = S.mask, src = data.data, o = out.data;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      if (m[i]) {
        const x = i % w;
        const edge = (x > 0 && !m[i - 1]) || (x < w - 1 && !m[i + 1]) || (i >= w && !m[i - w]) || (i < w * (h - 1) && !m[i + w]);
        if (edge) { o[p] = 255; o[p + 1] = 200; o[p + 2] = 61; }
        else { o[p] = src[p]; o[p + 1] = src[p + 1]; o[p + 2] = src[p + 2]; }
      } else {
        o[p] = src[p] * 0.28; o[p + 1] = src[p + 1] * 0.28; o[p + 2] = src[p + 2] * 0.32;
      }
      o[p + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  });
}

let brushMode = 'add';
const setBrush = mode => {
  brushMode = mode;
  $('#addBrush').setAttribute('aria-pressed', String(mode === 'add'));
  $('#eraseBrush').setAttribute('aria-pressed', String(mode === 'erase'));
};
$('#addBrush').onclick = () => setBrush('add');
$('#eraseBrush').onclick = () => setBrush('erase');

function paint(x, y, r) {
  const { w, h } = S.photo;
  const on = brushMode === 'add' ? S.add : S.erase, off = brushMode === 'add' ? S.erase : S.add;
  const r2 = r * r;
  for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(h - 1, Math.ceil(y + r)); yy++)
    for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, Math.ceil(x + r)); xx++)
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r2) { const i = yy * w + xx; on[i] = 1; off[i] = 0; }
}
{
  const c = $('#cutCanvas');
  let last = null;
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId);
    S.undo.push([S.add.slice(), S.erase.slice()]);
    if (S.undo.length > 20) S.undo.shift();
    const p = canvasPoint(c, e);
    last = p;
    paint(p.x, p.y, (+$('#brushSize').value / 2) * p.k);
    updateMask(); renderCut();
  });
  c.addEventListener('pointermove', e => {
    if (!last) return;
    const p = canvasPoint(c, e), r = (+$('#brushSize').value / 2) * p.k;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (r * 0.5)));
    for (let k = 1; k <= steps; k++) paint(last.x + ((p.x - last.x) * k) / steps, last.y + ((p.y - last.y) * k) / steps, r);
    last = p;
    updateMask(); renderCut();
  });
  const end = () => (last = null);
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}
$('#undoBtn').onclick = () => {
  const u = S.undo.pop();
  if (!u) return;
  [S.add, S.erase] = u;
  updateMask(); renderCut();
};
let sensTimer;
$('#sensitivity').oninput = e => {
  clearTimeout(sensTimer);
  sensTimer = setTimeout(() => {
    S.auto = findCharacter(S.photo.data, { sensitivity: +e.target.value, paper: S.paper }).mask;
    updateMask(); renderCut();
  }, 120);
};

$('#cutNext').onclick = () => {
  const cut = cutOut(S.photo.data, S.mask, S.paper);
  if (!cut || cut.width * cut.height < 400) { toast('No character found — try painting it in with “Add”.', { error: true }); return; }
  const canvas = document.createElement('canvas');
  canvas.width = cut.width; canvas.height = cut.height;
  const id = new ImageData(cut.data, cut.width, cut.height);
  canvas.getContext('2d').putImageData(id, 0, 0);
  S.cut = { canvas, w: cut.width, h: cut.height, mask: maskFromAlpha(id) };
  if (!S.joints || S.jointsVersion !== S.maskVersion) {
    S.joints = guessJoints(S.cut.mask, S.cut.w, S.cut.h);
    S.jointsVersion = S.maskVersion;
  }
  show('joints');
};

// ------------------------------------------------------------------ 3. joints
const SIDE_COLOUR = { l: '#3d9bff', r: '#ff9a3c', c: '#ffffff' };
const sideWord = { l: 'left', r: 'right', c: '' };
let selected = null;

function renderJoints() {
  const c = $('#jointCanvas'), g = c.getContext('2d');
  const k = c.width / (c.getBoundingClientRect().width || c.width);
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(S.cut.canvas, 0, 0);
  const J = { ...S.joints, hipMid: { x: (S.joints.lHip.x + S.joints.rHip.x) / 2, y: (S.joints.lHip.y + S.joints.rHip.y) / 2 } };
  g.lineCap = 'round';
  for (const [a, b] of LINKS) {
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 6 * k;
    g.beginPath(); g.moveTo(J[a].x, J[a].y); g.lineTo(J[b].x, J[b].y); g.stroke();
    g.strokeStyle = '#78ffc8'; g.lineWidth = 3 * k; g.stroke();
  }
  g.font = `700 ${Math.round(12 * k)}px system-ui, sans-serif`;
  g.textBaseline = 'middle';
  for (const jt of JOINTS) {
    const p = S.joints[jt.id], r = (jt.id === selected ? 13 : 10) * k;
    g.fillStyle = SIDE_COLOUR[jt.side];
    g.strokeStyle = '#000'; g.lineWidth = 2.5 * k;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    const tx = p.x + (jt.side === 'l' ? -r - 4 * k : r + 4 * k);
    g.textAlign = jt.side === 'l' ? 'right' : 'left';
    g.lineWidth = 4 * k; g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(jt.label, tx, p.y); g.fillStyle = '#fff'; g.fillText(jt.label, tx, p.y);
  }
}
{
  const c = $('#jointCanvas');
  let drag = null;
  c.addEventListener('pointerdown', e => {
    const p = canvasPoint(c, e);
    let best = null, bd = 30 * p.k;
    for (const jt of JOINTS) {
      const q = S.joints[jt.id], d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = jt.id; }
    }
    if (!best) return;
    drag = { id: best, dx: S.joints[best].x - p.x, dy: S.joints[best].y - p.y };
    selected = best;
    c.setPointerCapture(e.pointerId);
    describeSelected();
    renderJoints();
  });
  c.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = canvasPoint(c, e);
    S.joints[drag.id] = { x: Math.max(0, Math.min(c.width, p.x + drag.dx)), y: Math.max(0, Math.min(c.height, p.y + drag.dy)) };
    renderJoints();
  });
  const end = () => (drag = null);
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  // keyboard: Tab to the canvas, then [ / ] to pick a dot and arrow keys to move it
  c.tabIndex = 0;
  c.addEventListener('keydown', e => {
    const ids = JOINTS.map(j => j.id);
    if (e.key === ']' || e.key === '[') {
      const i = ids.indexOf(selected);
      selected = ids[(i + (e.key === ']' ? 1 : ids.length - 1)) % ids.length] ?? ids[0];
    } else if (selected && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 2, p = S.joints[selected];
      S.joints[selected] = { x: p.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), y: p.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) };
    } else return;
    e.preventDefault();
    describeSelected();
    renderJoints();
  });
}
function describeSelected() {
  const jt = JOINTS.find(j => j.id === selected);
  $('#jointHint').textContent = jt ? `${jt.label}${sideWord[jt.side] ? ` (${sideWord[jt.side]} side)` : ''}` : '';
}
$('#resetDots').onclick = () => { S.joints = guessJoints(S.cut.mask, S.cut.w, S.cut.h); renderJoints(); };
$('#jointCanvas').setAttribute('aria-description', 'Drag the dots, or press [ and ] to choose a dot and arrow keys to move it.');
window.addEventListener('resize', () => { if (S.step === 'joints') renderJoints(); });

// ------------------------------------------------------------------ rig + saving
let renderer;
async function prepareRig(save = true) {
  S.rig = buildRig(S.cut.mask, S.cut.w, S.cut.h, S.joints);
  S.puppet = new Puppet(S.rig);
  try {
    renderer ??= new PuppetRenderer($('#glCanvas'));
    renderer.setCharacter(S.cut.canvas, S.rig);
  } catch (e) {
    console.error(e);
    toast('This device can’t draw the animation (WebGL is turned off or missing).', { error: true, ms: 8000 });
  }
  if (!save) return;
  try {
    const thumb = document.createElement('canvas');
    const s = 200 / Math.max(S.cut.w, S.cut.h);
    thumb.width = Math.round(S.cut.w * s); thumb.height = Math.round(S.cut.h * s);
    thumb.getContext('2d').drawImage(S.cut.canvas, 0, 0, thumb.width, thumb.height);
    S.charId ??= `c${Date.now().toString(36)}`;
    await saveCharacter({ id: S.charId, image: await toBlob(S.cut.canvas), thumb: await toBlob(thumb), joints: S.joints });
  } catch (e) { console.warn('Could not save character', e); }
}
$('#jointsNext').onclick = async () => { await prepareRig(true); show('scene'); };

// ------------------------------------------------------------------ drawing the stage
function stageSize() { return STAGE[settings.shape] || STAGE.landscape; }

function drawBackground(g, W, H, t) {
  const sc = SCENES.find(s => s.id === settings.scene) || SCENES[0];
  if (sc.draw) return sc.draw(g, W, H, t);
  if (sc.id === 'colour') { g.fillStyle = settings.colour; g.fillRect(0, 0, W, H); return; }
  g.fillStyle = '#20262d'; g.fillRect(0, 0, W, H);
  if (sc.id === 'picture' && S.bgImage) drawCover(g, S.bgImage, S.bgImage.naturalWidth, S.bgImage.naturalHeight, W, H);
  if (sc.id === 'camera' && S.cam.stream && cam.videoWidth) drawCover(g, cam, cam.videoWidth, cam.videoHeight, W, H, S.cam.mirror);
  if ((sc.id === 'picture' && !S.bgImage) || (sc.id === 'camera' && !S.cam.stream)) {
    g.fillStyle = '#7d8a96'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${Math.round(Math.min(W, H) / 22)}px system-ui, sans-serif`;
    g.fillText(sc.id === 'picture' ? 'Choose a background picture' : 'The camera shows here when you perform', W / 2, H * 0.4);
  }
}

function insetRect(W, H) {
  const vw = cam.videoWidth || 16, vh = cam.videoHeight || 9;
  const iw = Math.round((W > H ? 0.27 : 0.38) * W), ih = Math.round((iw * vh) / vw);
  const m = Math.round(Math.min(W, H) * 0.03);
  const pos = settings.inset;
  return { x: pos.endsWith('l') ? m : W - iw - m, y: pos.startsWith('t') ? m : H - ih - m, w: iw, h: ih };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function drawInset(g, W, H) {
  if (settings.inset === 'off') return;
  const r = insetRect(W, H), rad = Math.round(r.w * 0.06);
  g.save();
  roundRect(g, r.x, r.y, r.w, r.h, rad);
  g.fillStyle = '#000'; g.fill();
  g.clip();
  if (S.cam.stream && cam.videoWidth) {
    g.translate(r.x, r.y);
    if (S.cam.mirror) { g.translate(r.w, 0); g.scale(-1, 1); }
    g.drawImage(cam, 0, 0, r.w, r.h);
    if (settings.insetDots && S.result?.landmarks?.[0]) {
      g.fillStyle = '#78ffc8';
      for (const q of S.result.landmarks[0]) {
        if ((q.visibility ?? 1) < 0.5) continue;
        g.beginPath(); g.arc(q.x * r.w, q.y * r.h, Math.max(2, r.w / 120), 0, Math.PI * 2); g.fill();
      }
    }
  } else {
    g.fillStyle = '#7d8a96'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${Math.round(r.w / 9)}px system-ui, sans-serif`;
    g.fillText('camera', r.x + r.w / 2, r.y + r.h / 2);
  }
  g.restore();
  g.save();
  roundRect(g, r.x, r.y, r.w, r.h, rad);
  g.lineWidth = Math.max(3, r.w / 80); g.strokeStyle = '#fff'; g.stroke();
  g.restore();
}

function drawStage(g, W, H, t, positions) {
  drawBackground(g, W, H, t);
  if (S.rig && renderer) {
    const rig = S.rig;
    const scale = (settings.size * H) / rig.h;
    const ground = H * 0.93;
    const offX = W / 2 - (rig.w / 2) * scale;
    const offY = ground - rig.h * scale;
    // soft shadow on the ground under the character
    const root = S.puppet?.joints?.root ?? rig.joints.root;
    const lift = Math.max(0, (rig.joints.root.y - root.y) * scale);
    g.save();
    g.globalAlpha = Math.max(0.08, 0.28 - lift / H);
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(offX + root.x * scale, ground - H * 0.01, rig.w * scale * 0.3, H * 0.018, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    renderer.resize(W, H);
    renderer.draw(positions, scale, offX, offY);
    g.drawImage(renderer.canvas, 0, 0);
  }
  drawInset(g, W, H);
}

// ------------------------------------------------------------------ 4. scene
function buildSceneTiles() {
  const wrap = $('#sceneTiles');
  wrap.innerHTML = '';
  for (const sc of SCENES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tile'; b.setAttribute('role', 'radio'); b.dataset.scene = sc.id;
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 100;
    const g = cv.getContext('2d');
    if (sc.draw) sc.draw(g, 160, 100, 2);
    else {
      g.fillStyle = sc.id === 'colour' ? settings.colour : '#2a333c'; g.fillRect(0, 0, 160, 100);
      g.fillStyle = '#cfd8e0'; g.font = '34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(sc.id === 'picture' ? '🖼' : sc.id === 'camera' ? '📷' : '', 80, 52);
    }
    const lab = document.createElement('span'); lab.textContent = sc.label;
    b.append(cv, lab);
    b.onclick = () => { settings.scene = sc.id; saveSettings(); syncSceneUI(); if (sc.id === 'picture' && !S.bgImage) $('#bgPicture').click(); };
    wrap.append(b);
  }
}
function syncSceneUI() {
  $$('.tile').forEach(t => t.setAttribute('aria-checked', String(t.dataset.scene === settings.scene)));
  $('#colourRow').hidden = settings.scene !== 'colour';
  $('#pictureRow').hidden = settings.scene !== 'picture';
  $('#bgColour').value = settings.colour;
  $$('[data-inset]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.inset === settings.inset)));
  $$('[data-shape]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.shape === settings.shape)));
  $$('#insetSeg .seg-btn, #shapeSeg .seg-btn').forEach(b => b.setAttribute('role', 'radio'));
  $('#insetDots').checked = settings.insetDots;
  $('#charSize').value = settings.size;
  $('#moveAround').checked = settings.move;
  const [W, H] = stageSize();
  fitCanvas($('#previewCanvas'), W, H);
}
$$('[data-inset]').forEach(b => (b.onclick = () => { settings.inset = b.dataset.inset; saveSettings(); syncSceneUI(); }));
$$('[data-shape]').forEach(b => (b.onclick = () => { settings.shape = b.dataset.shape; saveSettings(); syncSceneUI(); }));
$('#bgColour').oninput = e => { settings.colour = e.target.value; saveSettings(); buildSceneTiles(); syncSceneUI(); };
$('#bgPicture').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { S.bgImage = await loadImg(URL.createObjectURL(f)); settings.scene = 'picture'; saveSettings(); syncSceneUI(); }
  catch { toast('That picture couldn’t be opened.', { error: true }); }
};
$('#insetDots').onchange = e => { settings.insetDots = e.target.checked; saveSettings(); };
$('#charSize').oninput = e => { settings.size = +e.target.value; saveSettings(); };
$('#moveAround').onchange = e => { settings.move = e.target.checked; saveSettings(); };

let previewRAF = 0;
function enterScene() {
  if (!S.rig) { show('drawing'); return; }
  buildSceneTiles();
  syncSceneUI();
  S.puppet = new Puppet(S.rig);
  const restPose = S.puppet.pose();
  cancelAnimationFrame(previewRAF);
  const loop = now => {
    if (S.step !== 'scene') return;
    previewRAF = requestAnimationFrame(loop);
    const c = $('#previewCanvas');
    const [W, H] = stageSize();
    fitCanvas(c, W, H);
    drawStage(c.getContext('2d'), W, H, now / 1000, restPose);
  };
  previewRAF = requestAnimationFrame(loop);
}
$('#sceneNext').onclick = () => show('perform');

// ------------------------------------------------------------------ 5. perform
const cam = $('#camera');
let tracking; // the tracker module, loaded when first needed (it downloads a few MB)
let wakeLock = null;

async function startCamera() {
  tracking ??= await import('../core/tracker.js');
  stopCamera();
  try {
    const r = await tracking.openCamera(cam, { facing: S.cam.facing });
    S.cam.stream = r.stream;
    S.cam.facing = r.facing;
    S.cam.mirror = r.facing !== 'environment';
    S.lastVideoTime = -1;
    const n = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').length;
    $('#flipCam').hidden = n < 2;
  } catch (e) {
    console.error(e);
    $('#performHint').textContent = tracking.cameraErrorMessage(e);
  }
}
function stopCamera() {
  S.cam.stream?.getTracks().forEach(t => t.stop());
  S.cam.stream = null;
}

async function loadTracker() {
  if (S.tracker) return;
  S.trackerLoading ??= (async () => {
    tracking ??= await import('../core/tracker.js');
    $('#performHint').textContent = 'Loading body tracker…';
    try { S.tracker = await tracking.createPoseTracker({ model: 'lite' }); $('#performHint').textContent = ''; }
    catch (e) {
      console.error(e);
      $('#performHint').textContent = 'Couldn’t load the body tracker. Check the internet connection.';
      S.trackerLoading = null;
    }
  })();
  return S.trackerLoading;
}

let performRAF = 0, lastFrame = 0;
async function enterPerform() {
  if (!S.rig) { show('drawing'); return; }
  const [W, H] = stageSize();
  fitCanvas($('#stageCanvas'), W, H);
  S.puppet = new Puppet(S.rig);
  $('#fullBtn').hidden = !document.documentElement.requestFullscreen;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  cancelAnimationFrame(performRAF);
  performRAF = requestAnimationFrame(performLoop);
  await startCamera();
  await loadTracker();
}

function leavePerform() {
  if (S.recorder) S.recorder.stop();
  cancelAnimationFrame(performRAF);
  stopCamera();
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function performLoop(now) {
  if (S.step !== 'perform') return;
  performRAF = requestAnimationFrame(performLoop);
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000) || 1 / 30;
  lastFrame = now;
  let perf = null;
  if (S.tracker && S.cam.stream && cam.readyState >= 2 && cam.currentTime !== S.lastVideoTime) {
    S.lastVideoTime = cam.currentTime;
    const ts = Math.max(performance.now(), S.lastTs + 1);
    S.lastTs = ts;
    try { S.result = S.tracker.detectForVideo(cam, ts); } catch (e) { console.warn(e); }
  }
  const lm = S.result?.landmarks?.[0];
  if (lm && S.cam.stream) {
    perf = readPerformer(lm, cam.videoWidth, cam.videoHeight, S.cam.mirror);
    S.lastSeen = now;
  }
  const positions = S.puppet.update(perf, { dt, move: settings.move, smoothing: 0.5 });
  const c = $('#stageCanvas');
  const [W, H] = stageSize();
  drawStage(c.getContext('2d'), W, H, now / 1000, positions);

  const hint = $('#performHint');
  if (S.tracker && S.cam.stream && !S.recorder) {
    hint.textContent = now - S.lastSeen > 1200 ? 'Point the camera at the performer — whole body in view works best' : '';
  } else if (S.recorder && hint.textContent && S.tracker) hint.textContent = '';
}

$('#flipCam').onclick = async () => {
  S.cam.facing = S.cam.facing === 'user' ? 'environment' : 'user';
  await startCamera();
};
$('#fullBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}));

// --- recording
async function countdown(n) {
  const el = $('#countdown');
  el.hidden = false;
  for (let i = n; i > 0; i--) { el.textContent = i; await new Promise(r => setTimeout(r, 1000)); }
  el.hidden = true;
}
let recBusy = false;
$('#recBtn').onclick = async () => {
  if (S.recorder) { S.recorder.stop(); return; }
  if (recBusy) return;
  const c = $('#stageCanvas');
  if (!window.MediaRecorder || !c.captureStream) { toast('Recording isn’t supported in this browser.', { error: true }); return; }
  recBusy = true;
  await countdown(3);
  recBusy = false;
  if (S.step !== 'perform') return;
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try {
    rec = new MediaRecorder(c.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 5e6 } : {});
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer);
      S.recorder = null;
      $('#recBtn').classList.remove('recording');
      $('#recBtn').setAttribute('aria-label', 'Start recording');
      $('#recTime').hidden = true;
      const mime = rec.mimeType || type || 'video/webm';
      showResult(new Blob(chunks, { type: mime }), mime);
    };
    rec.start(1000);
  } catch (e) {
    console.error(e);
    toast('Recording couldn’t start.', { error: true });
    return;
  }
  S.recorder = rec;
  $('#recBtn').classList.add('recording');
  $('#recBtn').setAttribute('aria-label', 'Stop recording');
  const t0 = Date.now();
  const rt = $('#recTime');
  rt.hidden = false; rt.textContent = '● 0:00';
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    rt.textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
};

let resultFile = null;
function showResult(blob, mime) {
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  resultFile = new File([blob], `my-animation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`, { type: mime });
  const v = $('#resultVideo');
  if (v.src) URL.revokeObjectURL(v.src);
  v.src = URL.createObjectURL(blob);
  $('#resultSheet').hidden = false;
  $('#saveVideo').focus();
}
async function saveFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'My animation' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('#saveVideo').onclick = () => resultFile && saveFile(resultFile);
$('#closeResult').onclick = () => { $('#resultSheet').hidden = true; $('#resultVideo').pause(); };
$('#snapBtn').onclick = async () => {
  const blob = await toBlob($('#stageCanvas'));
  if (blob) saveFile(new File([blob], `my-animation-${Date.now()}.png`, { type: 'image/png' }));
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#resultSheet').hidden) $('#closeResult').click(); });
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && S.step === 'perform') {
    cam.play().catch(() => {});
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  }
});

// ------------------------------------------------------------------ start
show('drawing');
