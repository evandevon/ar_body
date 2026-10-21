// Pose triggers for AR Body Tracker: "when someone does this pose, show that picture/GIF/video".
// Holds the list of triggers, checks them every frame, draws what they show, saves them in the
// link/pack, and runs the Triggers window (where people pick a preset pose or capture their own).
import { PRESETS, PRESET_BY_ID, PART_CHOICES, matchPose, captureSignature } from './poses.js?v=dd7498cd';

export const DEFAULT_CLOSE = 0.7; // default "close enough" — 70% match
const DEFAULTS = { th: DEFAULT_CLOSE, hold: 0.3, size: 1, x: 0, y: 0, dur: 2, mode: 'time', parts: 'all', enabled: true };
const RELEASE = 0.08; // the match has to drop this far below "close enough" before it can fire again
const FADE_IN = 120, FADE_OUT = 250; // ms

// where each preset's effect appears by default
const DEFAULT_PLACE = { handsTogether: 'betweenHands', handsUp: 'hat', leftHandUp: 'lHand', rightHandUp: 'rHand', tPose: 'chest', starJump: 'chest', squat: 'hips', handsOnHead: 'hat', handsOnHips: 'chest', armsCrossed: 'chest', kick: 'hips', palmsOut: 'betweenHands', stopHand: 'chest' };
const EFFECTS = [
  { file: 'assets/effects/energy-ball.gif', label: 'Energy ball' },
  { file: 'assets/effects/star-burst.gif', label: 'Star burst' },
];

const $ = s => document.querySelector(s);
const round = v => Math.round(v * 1000) / 1000;

/**
 * @param deps.loadMedia(src) → media for drawing   @param deps.drawItem(item, anchor, time)
 * @param deps.anchors list of {id,label,group}      @param deps.save() → layout changed
 * @param deps.site base URL of the site             @param deps.status(msg, opts)
 */
export function createTriggers(deps) {
  const list = [];
  let nextId = 1;

  // ------------------------------------------------------------ saving in the link / packs
  const toEntry = t => {
    const e = { n: t.name, p: t.pose, u: t.src, a: t.anchor };
    if (t.pose === 'custom') { e.g = t.sig; if (t.parts !== 'all') e.pa = t.parts; }
    if (t.th !== DEFAULTS.th) e.th = Math.round(t.th * 100);
    if (t.hold !== DEFAULTS.hold) e.h = round(t.hold);
    if (t.size !== DEFAULTS.size) e.s = round(t.size);
    if (t.x) e.x = round(t.x);
    if (t.y) e.y = round(t.y);
    if (t.mode === 'while') e.wm = 1; else if (t.dur !== DEFAULTS.dur) e.d = round(t.dur);
    if (!t.enabled) e.off = 1;
    return e;
  };
  const fromEntry = e => ({
    name: String(e.n || PRESET_BY_ID[e.p]?.label || 'My pose').slice(0, 40),
    pose: e.p === 'custom' || PRESET_BY_ID[e.p] ? e.p : 'handsTogether',
    sig: Array.isArray(e.g) ? e.g.map(v => (v == null ? null : +v)).slice(0, 12) : null,
    parts: PART_CHOICES.some(c => c.id === e.pa) ? e.pa : 'all',
    th: Number.isFinite(+e.th) ? Math.min(0.99, Math.max(0.2, +e.th / 100)) : DEFAULTS.th,
    hold: Number.isFinite(+e.h) ? Math.min(5, Math.max(0, +e.h)) : DEFAULTS.hold,
    src: String(e.u || ''),
    anchor: deps.anchors.some(a => a.id === e.a) ? e.a : 'chest',
    size: Number.isFinite(+e.s) ? +e.s : DEFAULTS.size,
    x: +e.x || 0, y: +e.y || 0,
    mode: e.wm ? 'while' : 'time',
    dur: Number.isFinite(+e.d) ? Math.max(0.2, +e.d) : DEFAULTS.dur,
    enabled: !e.off,
  });
  const serialise = () => list.map(toEntry);
  const normalise = arr => (Array.isArray(arr) ? arr.filter(e => e && typeof e.u === 'string').map(e => toEntry(fromEntry(e))) : []);

  async function add(settings, { save = true } = {}) {
    const t = { id: nextId++, ...DEFAULTS, ...settings, people: [] };
    t.media = null;
    if (t.src) {
      try { const m = await deps.loadMedia(t.src); t.media = m.media; t.kind = m.kind; } catch (e) { console.warn('Trigger picture failed', e); }
    }
    list.push(t);
    renderList();
    if (save) deps.save();
    return t;
  }
  async function load(arr) {
    list.length = 0;
    for (const e of Array.isArray(arr) ? arr : []) if (e && typeof e.u === 'string') await add(fromEntry(e), { save: false });
    renderList();
  }
  function remove(t) {
    const i = list.indexOf(t);
    if (i >= 0) list.splice(i, 1);
    renderList();
    deps.save();
  }

  // ------------------------------------------------------------ every frame
  /** @param people array of MediaPipe landmark lists; vw,vh camera size */
  function update(people, vw, vh, now) {
    for (const t of list) {
      t.best = 0;
      people.forEach((lm, i) => {
        const r = (t.people[i] ??= { score: 0, holdFrom: 0, active: false, start: 0, until: 0, armed: true });
        const m = lm && t.enabled ? matchPose(t, lm, vw, vh) : null;
        r.score = m == null ? r.score * 0.6 : r.score * 0.4 + m * 0.6; // a little smoothing
        t.best = Math.max(t.best, r.score);
        const on = r.score >= t.th;
        if (on) {
          r.holdFrom ||= now;
          if (r.armed && !r.active && now - r.holdFrom >= t.hold * 1000) {
            r.active = true; r.armed = false; r.start = now;
            r.until = t.mode === 'while' ? Infinity : now + t.dur * 1000;
            if (t.kind === 'video' && t.media?.el) { t.media.el.currentTime = 0; t.media.el.play().catch(() => {}); }
            t.flash = now;
          }
        } else {
          r.holdFrom = 0;
          if (r.score < t.th - RELEASE) {
            r.armed = true;
            if (t.mode === 'while' && r.active) r.until = Math.min(r.until, now);
          }
        }
        if (r.active && now > r.until + FADE_OUT) r.active = false;
      });
      t.people.length = people.length;
    }
    if (!winEl.hidden) updateMeters();
  }

  /** Draws whatever the triggers are showing. anchorsFor(i) → that person's sticking points */
  function draw(anchorsFor, now) {
    for (const t of list) {
      if (!t.media || !t.enabled) continue;
      t.people.forEach((r, i) => {
        if (!r?.active) return;
        const a = anchorsFor(i)?.[t.anchor];
        if (!a) return;
        const fadeIn = Math.min(1, (now - r.start) / FADE_IN);
        const fadeOut = r.until === Infinity ? 1 : Math.min(1, Math.max(0, (r.until + FADE_OUT - now) / FADE_OUT));
        deps.drawItem({ media: t.media, kind: t.kind, anchor: t.anchor, size: t.size, x: t.x, y: t.y, rot: 0, opacity: Math.min(fadeIn, fadeOut), follow: t.anchor !== 'betweenHands', flip: false, side: false, visible: true },
          { ...a, vis: Math.max(a.vis, 0.7) }, now - r.start);
      });
    }
  }

  // ------------------------------------------------------------ the Triggers window
  const winEl = $('#trigWin');
  const listEl = $('#trigList');
  const form = $('#trigForm');
  let editing = null;   // trigger being edited, or 'new'
  let draft = null;     // settings in the form
  let getLandmarks = () => null;

  function poseLabel(t) { return t.pose === 'custom' ? `${t.name} (my pose)` : PRESET_BY_ID[t.pose]?.label ?? t.pose; }
  function poseIcon(t) { return t.pose === 'custom' ? '🧍' : PRESET_BY_ID[t.pose]?.icon ?? '•'; }
  function showLabel(src) {
    const e = EFFECTS.find(x => new URL(x.file, deps.site).href === src);
    return e ? e.label : decodeURIComponent(src.split('/').pop() || src);
  }

  function renderList() {
    listEl.innerHTML = '';
    $('#trigEmpty').hidden = list.length > 0;
    $('#trigCount').textContent = list.length ? ` (${list.length})` : '';
    for (const t of list) {
      const li = document.createElement('li');
      li.className = 'trig' + (t.enabled ? '' : ' off');
      li.innerHTML = `
        <div class="trig-row">
          <span class="trig-icon" aria-hidden="true"></span>
          <div class="trig-words"><b class="trig-name"></b><span class="trig-what"></span></div>
          <button type="button" class="icon-btn trig-on" title="Turn on/off"></button>
          <button type="button" class="icon-btn trig-edit" title="Edit">✎</button>
          <button type="button" class="icon-btn trig-del" title="Remove">✕</button>
        </div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100"><span class="fill"></span><span class="mark"></span></div>`;
      li.querySelector('.trig-icon').textContent = poseIcon(t);
      li.querySelector('.trig-name').textContent = t.name;
      li.querySelector('.trig-what').textContent = `${poseLabel(t)} → ${showLabel(t.src)}${t.media ? '' : ' (couldn’t load)'}`;
      const on = li.querySelector('.trig-on');
      on.textContent = t.enabled ? '●' : '○';
      on.setAttribute('aria-label', `${t.enabled ? 'Turn off' : 'Turn on'} ${t.name}`);
      on.onclick = () => { t.enabled = !t.enabled; renderList(); deps.save(); };
      li.querySelector('.trig-edit').setAttribute('aria-label', `Edit ${t.name}`);
      li.querySelector('.trig-edit').onclick = () => openForm(t);
      li.querySelector('.trig-del').setAttribute('aria-label', `Remove ${t.name}`);
      li.querySelector('.trig-del').onclick = () => { if (confirm(`Remove the “${t.name}” trigger?`)) remove(t); };
      li.querySelector('.mark').style.left = `${t.th * 100}%`;
      t.li = li;
      listEl.append(li);
    }
  }

  function setMeter(el, score, th) {
    const fill = el.querySelector('.fill');
    fill.style.width = `${Math.round(score * 100)}%`;
    el.classList.toggle('hit', score >= th);
    el.setAttribute('aria-valuenow', String(Math.round(score * 100)));
    el.title = `${Math.round(score * 100)}% match (needs ${Math.round(th * 100)}%)`;
  }
  function updateMeters() {
    const now = performance.now();
    for (const t of list) {
      if (!t.li) continue;
      setMeter(t.li.querySelector('.meter'), t.best || 0, t.th);
      t.li.classList.toggle('fired', !!t.flash && now - t.flash < 600);
    }
    if (draft) {
      const r = getLandmarks();
      const m = r ? matchPose(draft, r.lm, r.vw, r.vh) : null;
      setMeter($('#tfMeter'), m ?? 0, draft.th);
      $('#tfMeterText').textContent = m == null ? (draft.pose === 'custom' && !draft.sig ? 'Capture a pose first' : 'Nobody in view') : `${Math.round(m * 100)}% match right now`;
    }
  }

  // --- the form
  function fillSelects() {
    const sel = $('#tfPose');
    sel.innerHTML = '';
    const g1 = document.createElement('optgroup'); g1.label = 'Preset poses';
    for (const p of PRESETS) g1.append(new Option(`${p.icon} ${p.label}`, p.id));
    const g2 = document.createElement('optgroup'); g2.label = 'Your own';
    g2.append(new Option('🧍 My own pose (capture it)', 'custom'));
    sel.append(g1, g2);
    const pl = $('#tfPlace');
    pl.innerHTML = '';
    const groups = {};
    for (const a of deps.anchors) {
      if (!groups[a.group]) { groups[a.group] = document.createElement('optgroup'); groups[a.group].label = a.group; pl.append(groups[a.group]); }
      groups[a.group].append(new Option(a.label, a.id));
    }
    const sh = $('#tfShow');
    sh.innerHTML = '';
    for (const e of EFFECTS) sh.append(new Option(e.label, new URL(e.file, deps.site).href));
    sh.append(new Option('A picture, GIF or video from a web address…', 'url'));
    const parts = $('#tfParts');
    parts.innerHTML = '';
    for (const c of PART_CHOICES) parts.append(new Option(c.label, c.id));
  }

  function openForm(t) {
    editing = t || 'new';
    draft = t ? { ...t } : { ...DEFAULTS, name: '', pose: 'handsTogether', sig: null, src: new URL(EFFECTS[0].file, deps.site).href, anchor: 'betweenHands' };
    $('#tfTitle').textContent = t ? 'Edit trigger' : 'New trigger';
    $('#tfName').value = draft.name;
    $('#tfPose').value = draft.pose;
    $('#tfParts').value = draft.parts;
    $('#tfClose').value = Math.round(draft.th * 100);
    $('#tfHold').value = draft.hold;
    const known = [...$('#tfShow').options].some(o => o.value === draft.src);
    $('#tfShow').value = known ? draft.src : 'url';
    $('#tfUrl').value = known ? '' : draft.src;
    $('#tfPlace').value = draft.anchor;
    $('#tfSize').value = draft.size;
    $('#tfMode').value = draft.mode;
    $('#tfDur').value = draft.dur;
    syncForm();
    form.hidden = false;
    $('#trigListWrap').hidden = true;
    $('#tfName').focus();
  }
  function closeForm() {
    form.hidden = true; $('#trigListWrap').hidden = false;
    editing = draft = null;
  }
  function syncForm() {
    const custom = draft.pose === 'custom';
    $('#tfCustom').hidden = !custom;
    $('#tfCaptured').textContent = draft.sig ? 'Pose captured ✓ — capture again to change it.' : 'Strike the pose in front of the camera, then press Capture.';
    $('#tfUrlRow').hidden = $('#tfShow').value !== 'url';
    $('#tfDurRow').hidden = draft.mode === 'while';
    $('#tfCloseOut').textContent = `${Math.round(draft.th * 100)}%`;
    $('#tfHoldOut').textContent = `${(+draft.hold).toFixed(1)} s`;
    $('#tfSizeOut').textContent = `${Math.round(draft.size * 100)}%`;
    $('#tfDurOut').textContent = `${(+draft.dur).toFixed(1)} s`;
    $('#tfMeter .mark').style.left = `${draft.th * 100}%`;
  }

  async function captureCountdown() {
    const el = $('#trigCountdown');
    el.hidden = false;
    for (let i = 3; i > 0; i--) { el.textContent = i; await new Promise(r => setTimeout(r, 900)); }
    el.textContent = '📸';
    await new Promise(r => setTimeout(r, 250));
    el.hidden = true;
  }

  function wire(landmarkGetter) {
    getLandmarks = landmarkGetter;
    fillSelects();
    renderList();
    $('#trigBtn').onclick = () => { winEl.hidden = false; $('#trigBtn').setAttribute('aria-expanded', 'true'); $('#trigAdd').focus(); };
    $('#trigWinClose').onclick = () => { winEl.hidden = true; closeForm(); $('#trigBtn').setAttribute('aria-expanded', 'false'); $('#trigBtn').focus(); };
    $('#trigAdd').onclick = () => openForm(null);
    $('#tfCancel').onclick = closeForm;
    $('#tfPose').onchange = e => {
      const wasDefaultName = !draft.name || PRESETS.some(p => p.label === draft.name);
      draft.pose = e.target.value;
      if (draft.pose !== 'custom') {
        if (wasDefaultName) $('#tfName').value = draft.name = PRESET_BY_ID[draft.pose].label;
        if (DEFAULT_PLACE[draft.pose]) $('#tfPlace').value = draft.anchor = DEFAULT_PLACE[draft.pose];
      }
      syncForm();
    };
    $('#tfName').oninput = e => (draft.name = e.target.value);
    $('#tfParts').onchange = e => (draft.parts = e.target.value);
    $('#tfClose').oninput = e => { draft.th = +e.target.value / 100; syncForm(); };
    $('#tfHold').oninput = e => { draft.hold = +e.target.value; syncForm(); };
    $('#tfShow').onchange = e => { if (e.target.value !== 'url') draft.src = e.target.value; syncForm(); };
    $('#tfUrl').oninput = e => (draft.src = e.target.value.trim());
    $('#tfPlace').onchange = e => (draft.anchor = e.target.value);
    $('#tfSize').oninput = e => { draft.size = +e.target.value; syncForm(); };
    $('#tfMode').onchange = e => { draft.mode = e.target.value; syncForm(); };
    $('#tfDur').oninput = e => { draft.dur = +e.target.value; syncForm(); };
    $('#tfCapture').onclick = async () => {
      if (!getLandmarks()) { deps.status('Start the camera and stand where it can see you, then capture.', { error: true }); return; }
      await captureCountdown();
      const r = getLandmarks();
      if (!r) { deps.status('Nobody was in view — try again.', { error: true }); return; }
      draft.sig = captureSignature(r.lm, r.vw, r.vh);
      if (draft.sig.slice(0, 8).filter(v => v != null).length < 2) { draft.sig = null; deps.status('Not enough of the body was in view — step back and try again.', { error: true }); }
      syncForm();
    };
    $('#tfSave').onclick = async () => {
      if (draft.pose === 'custom' && !draft.sig) { deps.status('Capture your pose first.', { error: true }); return; }
      if ($('#tfShow').value === 'url') {
        try { const u = new URL(draft.src); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { deps.status('Enter a web address (https://…) for what to show.', { error: true }); return; }
      }
      draft.name = (draft.name || '').trim() || (draft.pose === 'custom' ? 'My pose' : PRESET_BY_ID[draft.pose].label);
      const settings = { name: draft.name, pose: draft.pose, sig: draft.pose === 'custom' ? draft.sig : null, parts: draft.parts, th: draft.th, hold: draft.hold, src: draft.src, anchor: draft.anchor, size: draft.size, x: draft.x || 0, y: draft.y || 0, mode: draft.mode, dur: draft.dur, enabled: editing === 'new' ? true : editing.enabled };
      if (editing === 'new') { closeForm(); await add(settings); }
      else {
        const t = editing;
        const srcChanged = t.src !== settings.src;
        Object.assign(t, settings);
        t.people = [];
        if (srcChanged) { try { const m = await deps.loadMedia(t.src); t.media = m.media; t.kind = m.kind; } catch { t.media = null; } }
        closeForm(); renderList(); deps.save();
      }
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !winEl.hidden) (form.hidden ? $('#trigWinClose') : $('#tfCancel')).click(); });
  }

  return { list, add, load, remove, update, draw, serialise, normalise, wire, resolve: arr => (arr || []).map(e => ({ ...e, u: e.u ? new URL(e.u, deps.site).href : e.u })) };
}
