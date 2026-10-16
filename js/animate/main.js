import { findCharacter, paperMap, applyEdits, cutOut, maskFromAlpha } from './cutout.js?v=af729520';
import { JOINTS, LINKS, guessJoints, buildRig, Puppet, readPerformer } from './rig.js?v=3734807e';
import { PuppetRenderer } from './renderer.js?v=b2e675e8';
import { SCENES, drawCover } from './backgrounds.js?v=b50d8b94';
import { saveCharacter, listCharacters, deleteCharacter, getCharacter } from './storage.js?v=53955991';
import { openCamera, stopStream, cameraErrorMessage, deviceList, waitForFrames, openMic, micErrorMessage, levelMeter } from '../core/camera.js?v=2afbfead';
import { createProgress, nextPaint } from '../core/progress.js?v=4da3a204';

const work = createProgress({ delay: 150 }); // photo processing, preparing the character
const trackerProg = createProgress();       // body tracker download

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MAX_SIDE = 720; // photos are processed at this size — plenty for a drawing, fast on phones
const STAGE = { landscape: [1280, 720], portrait: [720, 1280], square: [960, 960] };
const GREEN = '#00ff00'; // bright chroma-key green
const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

// ------------------------------------------------------------------ state
const S = {
  step: 'drawing',
  photo: null,              // { canvas, data: ImageData, w, h }
  paper: null, auto: null, add: null, erase: null, mask: null,
  maskVersion: 0,
  undo: [],
  cut: null,                // { canvas, w, h, mask }
  joints: null, jointsEdit: 0, cutVersion: -1, rigVersion: -1,
  rig: null, puppet: null,
  charId: null,
  bgImage: null,
  cam: { stream: null, facing: isPhone ? 'environment' : 'user', mirror: !isPhone },
  tracker: null, trackerLoading: null,
  result: null, lastVideoTime: -1, lastTs: 0, lastSeen: 0,
  recorder: null,
};

const DEFAULT_SETTINGS = { scene: 'sky', colour: '#ffffff', inset: 'tr', insetDots: false, shape: isPhone ? 'portrait' : 'landscape', size: 0.72, move: true, sound: false, camId: '', micId: '' };
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
    const b = li.querySelector('button');
    if (i === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  syncStepButtons();
  if (prev === 'perform' && step !== 'perform') leavePerform(step);
  if (prev === 'scene' && step !== 'perform' && step !== 'scene') releaseMic();
  if (step === 'drawing') renderSaved();
  if (step === 'cutout') { fitCanvas($('#cutCanvas'), S.photo.w, S.photo.h); S.cutBaseVersion = -1; fitDisplay($('#cutCanvas')); renderCut(); }
  if (step === 'joints') { fitCanvas($('#jointCanvas'), S.cut.w, S.cut.h); fitDisplay($('#jointCanvas')); renderJoints(); }
  if (step === 'scene') enterScene();
  if (step === 'perform') enterPerform();
}
$$('[data-go]').forEach(b => (b.onclick = () => {
  const to = b.dataset.go;
  if (to === 'cutout' && !S.photo) return goTo('drawing'); // reopened characters have no photo to re-cut
  goTo(to);
}));

// Which steps can be reached yet (a step needs the ones before it)
function canReach(step) {
  if (step === 'drawing') return true;
  if (step === 'cutout') return !!S.photo;
  return !!(S.photo || S.cut);
}
function syncStepButtons() {
  for (const b of $$('.steps button')) {
    const ok = canReach(b.dataset.goto);
    b.disabled = !ok;
    b.title = ok ? '' : 'Start with a drawing first';
  }
}
$$('.steps button').forEach(b => (b.onclick = () => goTo(b.dataset.goto)));

/** Moves to any step, doing whatever the skipped Next buttons would have done. */
let going = false;
async function goTo(step) {
  if (going || step === S.step || !canReach(step)) return;
  going = true;
  try {
    const i = ORDER.indexOf(step);
    if (i >= ORDER.indexOf('joints') && !ensureCut()) return;
    if (i >= ORDER.indexOf('scene') && !(await ensureRig())) return;
    await show(step);
  } finally { going = false; }
}

// Cut-out from the current mask (redone only if the mask changed since last time)
function ensureCut() {
  if (!S.photo) return !!S.cut; // a reopened character: already cut out
  if (S.cut && S.cutVersion === S.maskVersion) return true;
  const cut = cutOut(S.photo.data, S.mask, S.paper);
  if (!cut || cut.width * cut.height < 400) { toast('No character found — try painting it in with “Add”.', { error: true }); return false; }
  const canvas = document.createElement('canvas');
  canvas.width = cut.width; canvas.height = cut.height;
  const id = new ImageData(cut.data, cut.width, cut.height);
  canvas.getContext('2d').putImageData(id, 0, 0);
  S.cut = { canvas, w: cut.width, h: cut.height, mask: maskFromAlpha(id) };
  S.cutVersion = S.maskVersion;
  S.joints = guessJoints(S.cut.mask, S.cut.w, S.cut.h);
  S.jointsEdit++;
  return true;
}

// The bendable character, rebuilt only if the dots moved since last time
async function ensureRig() {
  if (S.rig && S.rigVersion === S.jointsEdit) return true;
  work.set('Getting your character ready…', 0.3);
  await nextPaint();
  try { await prepareRig(true); }
  finally { work.done(); }
  S.rigVersion = S.jointsEdit;
  return !!S.rig;
}

function fitCanvas(c, w, h) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }

// Sizes a canvas on screen to fit its box (keeping its shape), so it never pushes buttons off
// screen and pointer positions map exactly onto the picture.
function fitDisplay(c) {
  const box = c.parentElement.getBoundingClientRect();
  if (!box.width || !box.height || !c.width) return;
  const k = Math.min(box.width / c.width, box.height / c.height);
  c.style.width = `${Math.floor(c.width * k)}px`;
  c.style.height = `${Math.floor(c.height * k)}px`;
}
const fitAll = () => $$('.work canvas, #stageCanvas').forEach(c => c.offsetParent && fitDisplay(c));
new ResizeObserver(fitAll).observe(document.body);

// ------------------------------------------------------------------ 1. drawing
async function loadPhoto(src) {
  let img;
  work.set('Opening picture…', 0.1);
  try { img = await loadImg(src); }
  catch { work.done(); toast('That picture couldn’t be opened.', { error: true }); return; }
  work.set('Finding your character…', 0.35);
  await nextPaint();
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  S.photo = { canvas, data, w, h };
  S.paper = paperMap(data);
  work.set('Finding your character…', 0.6);
  await nextPaint();
  S.auto = findCharacter(data, { sensitivity: +$('#sensitivity').value, paper: S.paper }).mask;
  work.set('Finding your character…', 1);
  S.add = new Uint8Array(w * h);
  S.cutBaseVersion = -1;
  S.erase = new Uint8Array(w * h);
  S.undo = [];
  updateMask();
  S.joints = null; S.charId = null; S.cut = null; S.rig = null; S.cutVersion = -1;
  work.done();
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

// ---- "Take a photo": the phone's own camera app on phones, a live webcam view on computers
$('#photoBtn').onclick = () => (isPhone ? $('#photoInput').click() : openPhotoSheet());
const photoVideo = $('#photoVideo');
const photo = { stream: null, rotate: 0, raf: 0, camId: '', token: 0 };
try { photo.camId = localStorage.getItem('photo-cam') || ''; photo.rotate = +(localStorage.getItem('photo-rotate') || 0); } catch {}

async function startPhotoCamera() {
  const token = ++photo.token;
  stopStream(photo.stream); photo.stream = null;
  $('#photoMsg').textContent = 'Starting camera…';
  try {
    // higher resolution than performing: drawings have fine lines
    const r = await openCamera(photoVideo, { deviceId: photo.camId, facing: 'environment' });
    if (token !== photo.token) { stopStream(r.stream); return; }
    photo.stream = r.stream;
    photo.camId = r.deviceId || '';
    try { localStorage.setItem('photo-cam', photo.camId); } catch {}
    await r.stream.getVideoTracks()[0]?.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 } }).catch(() => {});
    photoCams.refresh();
    $('#photoMsg').textContent = (await waitForFrames(photoVideo)) ? '' : 'The camera is on but not sending a picture. Close other apps using it, or choose another camera.';
  } catch (e) {
    console.error(e);
    if (token !== photo.token) return;
    $('#photoMsg').textContent = cameraErrorMessage(e) + ' You can also use “Choose a picture”.';
    photoCams.refresh();
  }
}
const photoCams = deviceList($('#photoCam'), {
  kind: 'videoinput',
  getCurrent: () => photo.stream?.getVideoTracks()[0]?.getSettings().deviceId || photo.camId,
  onChange: id => { photo.camId = id; startPhotoCamera(); },
});

function drawPhotoFrame(target, v) {
  const rot = ((photo.rotate % 360) + 360) % 360, side = rot % 180 !== 0;
  const w = side ? v.videoHeight : v.videoWidth, h = side ? v.videoWidth : v.videoHeight;
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const g = target.getContext('2d');
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((rot * Math.PI) / 180);
  g.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2); // not mirrored, so writing reads the right way
  g.restore();
}

function openPhotoSheet() {
  $('#photoSheet').hidden = false;
  startPhotoCamera();
  const loop = () => {
    if ($('#photoSheet').hidden) return;
    photo.raf = requestAnimationFrame(loop);
    if (photoVideo.readyState >= 2 && photoVideo.videoWidth) drawPhotoFrame($('#photoCanvas'), photoVideo);
  };
  cancelAnimationFrame(photo.raf);
  loop();
  $('#photoShoot').focus();
}
function closePhotoSheet() {
  $('#photoSheet').hidden = true;
  cancelAnimationFrame(photo.raf);
  photo.token++;
  stopStream(photo.stream); photo.stream = null;
  photoVideo.srcObject = null;
  $('#photoBtn').focus();
}
$('#photoCancel').onclick = closePhotoSheet;
$('#photoRotate').onclick = () => { photo.rotate = (photo.rotate + 90) % 360; try { localStorage.setItem('photo-rotate', photo.rotate); } catch {} };
$('#photoShoot').onclick = async () => {
  if (!(photoVideo.readyState >= 2 && photoVideo.videoWidth)) { toast('The camera isn’t showing a picture yet.', { error: true }); return; }
  const shot = document.createElement('canvas');
  drawPhotoFrame(shot, photoVideo);
  $('#photoCanvas').classList.add('flash-white');
  setTimeout(() => $('#photoCanvas').classList.remove('flash-white'), 260);
  const blob = await toBlob(shot, 'image/jpeg', 0.92);
  closePhotoSheet();
  if (blob) loadPhoto(URL.createObjectURL(blob));
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#photoSheet').hidden) closePhotoSheet(); });

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
  S.jointsEdit++;
  work.set('Getting your character ready…', 0.4);
  await nextPaint();
  try { await prepareRig(false); } finally { work.done(); }
  S.rigVersion = S.jointsEdit;
  show('scene');
}

// ------------------------------------------------------------------ 2. cut out
function updateMask() {
  S.mask = applyEdits(S.auto, S.add, S.erase);
  S.maskVersion++;
}

let cutQueued = false;
S.cutBase = document.createElement('canvas');
S.cutBaseVersion = -1;
S.brushPos = null; // where the brush circle is drawn (picture pixels), or null when hidden

function buildCutBase() {
  const { w, h, data } = S.photo;
  const base = S.cutBase;
  fitCanvas(base, w, h);
  const g = base.getContext('2d');
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
  S.cutBaseVersion = S.maskVersion;
}

function renderCut() {
  if (cutQueued) return;
  cutQueued = true;
  requestAnimationFrame(() => {
    cutQueued = false;
    if (!S.photo) return;
    if (S.cutBaseVersion !== S.maskVersion) buildCutBase();
    const c = $('#cutCanvas'), g = c.getContext('2d');
    g.drawImage(S.cutBase, 0, 0);
    if (S.brushPos) {
      // the circle shows exactly what a click will add or erase
      const { x, y } = S.brushPos, r = brushRadius(c);
      const add = brushMode === 'add', k = c.width / (c.getBoundingClientRect().width || c.width);
      g.save();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = add ? 'rgba(255,255,255,.18)' : 'rgba(255,80,80,.22)';
      g.fill();
      g.lineWidth = 3 * k; g.strokeStyle = 'rgba(0,0,0,.8)'; g.stroke();
      g.lineWidth = 1.5 * k; g.strokeStyle = add ? '#ffffff' : '#ff6b6b';
      if (!add) g.setLineDash([5 * k, 4 * k]);
      g.stroke();
      g.setLineDash([]);
      // + or − in the middle
      const t = Math.min(r * 0.5, 9 * k);
      g.beginPath(); g.moveTo(x - t, y); g.lineTo(x + t, y);
      if (add) { g.moveTo(x, y - t); g.lineTo(x, y + t); }
      g.lineWidth = 3 * k; g.strokeStyle = 'rgba(0,0,0,.8)'; g.stroke();
      g.lineWidth = 1.5 * k; g.strokeStyle = add ? '#ffffff' : '#ff6b6b'; g.stroke();
      g.restore();
    }
  });
}
// brush size slider is in screen pixels, so the circle looks the same size at any zoom
const brushRadius = c => (+$('#brushSize').value / 2) * (c.width / (c.getBoundingClientRect().width || c.width));

let brushMode = 'add';
const setBrush = mode => {
  brushMode = mode;
  renderCut();
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
  const at = e => { const p = canvasPoint(c, e); return { x: p.x, y: p.y }; };
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId);
    S.undo.push([S.add.slice(), S.erase.slice()]);
    if (S.undo.length > 20) S.undo.shift();
    const p = at(e);
    last = p; S.brushPos = p;
    paint(p.x, p.y, brushRadius(c));
    updateMask(); renderCut();
  });
  c.addEventListener('pointermove', e => {
    const p = at(e);
    S.brushPos = p;
    if (last) {
      const r = brushRadius(c);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (r * 0.5)));
      for (let k = 1; k <= steps; k++) paint(last.x + ((p.x - last.x) * k) / steps, last.y + ((p.y - last.y) * k) / steps, r);
      last = p;
      updateMask();
    }
    renderCut();
  });
  const end = e => { last = null; if (e.pointerType !== 'mouse') S.brushPos = null; renderCut(); };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.addEventListener('pointerleave', () => { if (!last) { S.brushPos = null; renderCut(); } });
}
// show the brush size while the slider moves
let sizePreviewTimer;
$('#brushSize').addEventListener('input', () => {
  const c = $('#cutCanvas');
  if (!S.brushPos || S.brushPos.preview) S.brushPos = { x: c.width / 2, y: c.height / 2, preview: true };
  renderCut();
  clearTimeout(sizePreviewTimer);
  sizePreviewTimer = setTimeout(() => { if (S.brushPos?.preview) { S.brushPos = null; renderCut(); } }, 900);
});
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

$('#cutNext').onclick = () => goTo('joints');

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
    S.jointsEdit++;
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
      S.jointsEdit++;
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
$('#resetDots').onclick = () => { S.joints = guessJoints(S.cut.mask, S.cut.w, S.cut.h); S.jointsEdit++; renderJoints(); };
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
$('#jointsNext').onclick = () => goTo('scene');

// ------------------------------------------------------------------ drawing the stage
function stageSize() { return STAGE[settings.shape] || STAGE.landscape; }

const currentScene = () => SCENES.find(s => s.id === settings.scene) || SCENES[0];
function drawBackground(g, W, H, t) {
  const sc = currentScene();
  g.clearRect(0, 0, W, H);
  if (sc.draw) return sc.draw(g, W, H, t);
  if (sc.id === 'transparent') return; // left see-through
  if (sc.id === 'green') { g.fillStyle = GREEN; g.fillRect(0, 0, W, H); return; }
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
    // soft shadow on the ground under the character (not on keyable backgrounds: it would
    // leave a dark smudge after the green / transparency is removed)
    const root = S.puppet?.joints?.root ?? rig.joints.root;
    const lift = Math.max(0, (rig.joints.root.y - root.y) * scale);
    g.save();
    if (currentScene().key) g.globalAlpha = 0;
    else
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
      if (sc.id === 'transparent') {
        for (let y = 0; y < 100; y += 12) for (let x = 0; x < 160; x += 12) { g.fillStyle = (x + y) % 24 ? '#9aa4ad' : '#e4e8eb'; g.fillRect(x, y, 12, 12); }
      } else {
        g.fillStyle = sc.id === 'colour' ? settings.colour : sc.id === 'green' ? GREEN : '#2a333c';
        g.fillRect(0, 0, 160, 100);
      }
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
  const note = $('#bgNote');
  note.textContent = settings.scene === 'transparent'
    ? (canRecordAlpha() ? 'Videos save as see-through WebM. Not every video editor can read these — use Green screen if yours can’t.' : 'This browser can’t record see-through video. Use Chrome or Edge, or choose Green screen.')
    : settings.scene === 'green' ? 'Remove the green later with your video editor’s chroma key (green screen) effect. Keep green clothes and drawings out of the picture.'
    : '';
  note.hidden = !note.textContent;
  $('.preview').classList.toggle('see-through', settings.scene === 'transparent');
  $('#bgColour').value = settings.colour;
  $$('[data-inset]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.inset === settings.inset)));
  $$('[data-shape]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.shape === settings.shape)));
  $$('#insetSeg .seg-btn, #shapeSeg .seg-btn').forEach(b => b.setAttribute('role', 'radio'));
  $('#insetDots').checked = settings.insetDots;
  $('#charSize').value = settings.size;
  $('#moveAround').checked = settings.move;
  const [W, H] = stageSize();
  fitCanvas($('#previewCanvas'), W, H);
  fitDisplay($('#previewCanvas'));
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
  syncSoundUI();
  cameras.refresh();
  if (settings.sound) ensureMic();
  loadTracker(); // get it downloading now, so it's ready when performing starts
  S.puppet = new Puppet(S.rig);
  const restPose = S.puppet.pose();
  cancelAnimationFrame(previewRAF);
  const loop = now => {
    if (S.step !== 'scene') return;
    previewRAF = requestAnimationFrame(loop);
    const c = $('#previewCanvas');
    const [W, H] = stageSize();
    if (c.width !== W || c.height !== H) { fitCanvas(c, W, H); fitDisplay(c); }
    drawStage(c.getContext('2d'), W, H, now / 1000, restPose);
  };
  previewRAF = requestAnimationFrame(loop);
}
$('#sceneNext').onclick = () => goTo('perform');

// ------------------------------------------------------------------ 5. perform
const cam = $('#camera');
let tracking; // js/core/tracker.js, loaded when first needed (downloads a few MB from the internet)
let wakeLock = null;
let camToken = 0;

function setHint(msg, error = false) {
  const h = $('#performHint');
  h.textContent = msg;
  h.classList.toggle('error', error && !!msg);
  h.dataset.sticky = error ? '1' : '';
}

async function startCamera() {
  const token = ++camToken;
  stopCamera();
  let r;
  try { r = await openCamera(cam, { deviceId: settings.camId, facing: S.cam.facing }); }
  catch (e) {
    console.error(e);
    if (token === camToken) setHint(cameraErrorMessage(e), true);
    cameras.refresh();
    return;
  }
  if (token !== camToken) { stopStream(r.stream); return; }
  S.cam.stream = r.stream;
  if (r.facing) S.cam.facing = r.facing;
  S.cam.mirror = r.facing ? r.facing !== 'environment' : !isPhone;
  S.lastVideoTime = -1;
  if (r.deviceId) { settings.camId = r.deviceId; saveSettings(); }
  r.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (S.cam.stream !== r.stream) return;
    setHint('The camera stopped (unplugged or taken by another app). Choose a camera from the list.', true);
    cameras.refresh();
  });
  cameras.refresh();
  if (!(await waitForFrames(cam))) {
    if (token === camToken) setHint('The camera is on but not sending a picture. Close other apps using it, or choose another camera.', true);
    return;
  }
  if (token === camToken && $('#performHint').dataset.sticky && !S.trackerError) setHint('');
}
function stopCamera() {
  stopStream(S.cam.stream);
  S.cam.stream = null;
}

// every camera list on the page stays up to date as cameras are plugged in or out
const cameras = deviceList([$('#camSelect'), $('#camSelectScene')], {
  kind: 'videoinput',
  getCurrent: () => S.cam.stream?.getVideoTracks()[0]?.getSettings().deviceId || settings.camId,
  onChange: id => { settings.camId = id; saveSettings(); cameras.refresh(); if (S.step === 'perform') startCamera(); },
  onListChange: devices => { $('#flipCam').hidden = devices.length < 2; },
});

async function loadTracker() {
  if (S.tracker) return;
  S.trackerLoading ??= (async () => {
    try {
      trackerProg.set('Loading body tracker…', 0);
      tracking ??= await import('../core/tracker.js?v=96d3e1a2');
      S.tracker = await tracking.createPoseTracker({
        model: 'lite',
        onProgress: p => p.stage === 'starting'
          ? trackerProg.set('Starting body tracker…', 1, 'Almost ready')
          : trackerProg.bytes('Downloading body tracker…', p.loaded, p.total),
      });
      trackerProg.done();
      S.trackerError = null;
      if (S.step === 'perform' && !$('#performHint').dataset.sticky) setHint('');
    } catch (e) {
      console.error(e);
      trackerProg.done();
      S.trackerError = e;
      setHint(tracking ? tracking.trackerErrorMessage(e) : 'Body tracking couldn’t load. The camera still works.', true);
      S.trackerLoading = null;
    }
  })();
  return S.trackerLoading;
}

// ---------- microphone (optional)
let meter = null;
async function ensureMic() {
  if (!settings.sound) return null;
  if (S.mic?.active) return S.mic;
  try {
    S.mic = await openMic(settings.micId);
    const id = S.mic.getAudioTracks()[0]?.getSettings().deviceId;
    if (id) { settings.micId = id; saveSettings(); }
    mics.refresh();
    meter?.stop();
    meter = levelMeter(S.mic, lvl => {
      document.documentElement.style.setProperty('--mic-level', lvl.toFixed(2));
    });
    syncSoundUI();
    return S.mic;
  } catch (e) {
    console.error(e);
    toast(micErrorMessage(e), { error: true, ms: 6000 });
    settings.sound = false; saveSettings(); syncSoundUI();
    return null;
  }
}
function releaseMic() {
  meter?.stop(); meter = null;
  stopStream(S.mic); S.mic = null;
  document.documentElement.style.setProperty('--mic-level', '0');
}
const mics = deviceList($('#micSelect'), {
  kind: 'audioinput',
  getCurrent: () => S.mic?.getAudioTracks()[0]?.getSettings().deviceId || settings.micId,
  onChange: async id => { settings.micId = id; saveSettings(); releaseMic(); await ensureMic(); },
});
function syncSoundUI() {
  $('#soundOn').checked = settings.sound;
  $('#micRow').hidden = !settings.sound;
  const b = $('#micBtn');
  b.setAttribute('aria-pressed', String(settings.sound));
  b.setAttribute('aria-label', settings.sound ? 'Sound on — tap to turn off' : 'Sound off — tap to record sound');
  b.classList.toggle('off', !settings.sound);
}
async function setSound(on) {
  settings.sound = on; saveSettings(); syncSoundUI();
  if (on) await ensureMic(); else releaseMic();
}
$('#soundOn').onchange = e => setSound(e.target.checked);
$('#micBtn').onclick = () => { if (!S.recorder) setSound(!settings.sound); };

let performRAF = 0, lastFrame = 0;
async function enterPerform() {
  if (!S.rig) { show('drawing'); return; }
  const [W, H] = stageSize();
  fitCanvas($('#stageCanvas'), W, H);
  requestAnimationFrame(() => fitDisplay($('#stageCanvas')));
  $('.stage-wrap').classList.toggle('see-through', settings.scene === 'transparent');
  S.puppet = new Puppet(S.rig);
  setHint('');
  syncSoundUI();
  $('#fullBtn').hidden = !document.documentElement.requestFullscreen;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  cancelAnimationFrame(performRAF);
  performRAF = requestAnimationFrame(performLoop);
  // camera first: it must work even if the tracker can't download
  await startCamera();
  ensureMic();
  loadTracker();
}

function leavePerform(next) {
  if (S.recorder) S.recorder.stop();
  cancelAnimationFrame(performRAF);
  camToken++;
  stopCamera();
  if (next !== 'scene') releaseMic();
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

  if (S.tracker && S.cam.stream && !S.recorder && !$('#performHint').dataset.sticky) {
    setHint(now - S.lastSeen > 1200 ? 'Point the camera at the performer — whole body in view works best' : '');
  } else if (S.recorder && !$('#performHint').dataset.sticky) setHint('');
}

// cycles through the cameras (front/back on phones)
$('#flipCam').onclick = async () => {
  const devices = await cameras.refresh();
  const cur = S.cam.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const i = devices.findIndex(d => d.deviceId === cur);
  if (devices.length > 1 && devices[0].deviceId) settings.camId = devices[(i + 1) % devices.length].deviceId;
  else { settings.camId = ''; S.cam.facing = S.cam.facing === 'user' ? 'environment' : 'user'; }
  saveSettings();
  await startCamera();
};
$('#fullBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}));

// --- recording
const isChromium = !!window.chrome || /Edg\//.test(navigator.userAgent);
const canRecordAlpha = () => isChromium && window.MediaRecorder && ['video/webm;codecs=vp8', 'video/webm;codecs=vp9'].some(t => MediaRecorder.isTypeSupported(t));

function pickType(transparent, withAudio) {
  const list = transparent
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
    : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const usable = withAudio ? list : list.filter(t => !/opus|mp4a/.test(t));
  return usable.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

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
  const mic = settings.sound ? await ensureMic() : null;
  await countdown(3);
  recBusy = false;
  if (S.step !== 'perform') return;
  const transparent = settings.scene === 'transparent';
  if (transparent && !canRecordAlpha()) toast('This browser can’t record see-through video, so the background will be black. Use Chrome or Edge, or the Green screen background.', { error: true, ms: 7000 });
  const stream = c.captureStream(30);
  const audioTrack = mic?.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);
  const type = pickType(transparent, !!audioTrack);
  let rec;
  try {
    rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 5e6, audioBitsPerSecond: 128e3 } : {});
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer);
      S.recorder = null;
      $('#recBtn').classList.remove('recording');
      $('#recBtn').setAttribute('aria-label', 'Start recording');
      $('#recTime').hidden = true;
      $('#micBtn').disabled = false;
      const mime = rec.mimeType || type || 'video/webm';
      showResult(new Blob(chunks, { type: mime }), mime, { transparent: transparent && canRecordAlpha(), sound: !!audioTrack });
    };
    rec.start(1000);
  } catch (e) {
    console.error(e);
    toast('Recording couldn’t start.', { error: true });
    return;
  }
  S.recorder = rec;
  $('#micBtn').disabled = true;
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
function showResult(blob, mime, { transparent = false, sound = false } = {}) {
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  resultFile = new File([blob], `my-animation-${transparent ? 'transparent-' : ''}${stamp}.${ext}`, { type: mime });
  $('#resultNote').textContent = transparent
    ? 'This video has a see-through background (WebM). Some video editors can’t read see-through WebM — if yours shows black behind the character, record again with the Green screen background.'
    : settings.scene === 'green' || settings.scene === 'colour' ? 'Use your video editor’s chroma key (green screen) effect to remove the background.' : '';
  $('#resultNote').hidden = !$('#resultNote').textContent;
  $('#resultSheet').classList.toggle('see-through', transparent);
  const v = $('#resultVideo');
  v.muted = !sound;
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
window.__appReady = true;
