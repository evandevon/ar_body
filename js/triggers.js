// Pose triggers for AR Body Tracker: "someone is doing this pose right now".
// A trigger only describes a pose (preset or captured) and how closely/long it must be held.
// What appears is set on each overlay ("When to show?" in app.js), which asks `showing()` whether
// its trigger has fired for a person. Also runs the Pose triggers window (pick a preset pose or
// capture your own, with a live match bar) and saves triggers in the link/pack.
import { PRESETS, PRESET_BY_ID, PART_CHOICES, matchPose, captureSignature } from './poses.js?v=dd7498cd';

export const DEFAULT_CLOSE = 0.7; // default "close enough" — 70% match
const DEFAULTS = { th: DEFAULT_CLOSE, hold: 0.3, parts: 'all', enabled: true };
const RELEASE = 0.08; // the match has to drop this far below "close enough" before it can fire again
const FADE_IN = 120, FADE_OUT = 250; // ms

const $ = s => document.querySelector(s);
const round = v => Math.round(v * 1000) / 1000;

/**
 * @param deps.save() → layout changed            @param deps.status(msg, opts)
 * @param deps.usedBy(t) → names of overlays that show on this trigger
 * @param deps.changed() → the list of triggers changed (names, added, removed)
 * @param deps.onRemove(t) → a trigger is about to be removed
 * @param deps.onFire(t, person) → a trigger just fired for that person
 */
export function createTriggers(deps) {
  const list = [];
  let nextId = 1;

  // ------------------------------------------------------------ saving in the link / packs
  // Entry keys: n name, p pose, g signature, pa parts, th %, h hold, off disabled.
  const toEntry = t => {
    const e = { n: t.name, p: t.pose };
    if (t.pose === 'custom') { e.g = t.sig; if (t.parts !== 'all') e.pa = t.parts; }
    if (t.th !== DEFAULTS.th) e.th = Math.round(t.th * 100);
    if (t.hold !== DEFAULTS.hold) e.h = round(t.hold);
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
    enabled: !e.off,
  });
  const isEntry = e => e && typeof e === 'object';
  const serialise = () => list.map(toEntry);
  const normalise = arr => (Array.isArray(arr) ? arr.filter(isEntry).map(e => toEntry(fromEntry(e))) : []);

  function add(settings, { save = true } = {}) {
    const t = { id: nextId++, ...DEFAULTS, ...settings, people: [] };
    list.push(t);
    renderList();
    if (save) { deps.changed(); deps.save(); }
    return t;
  }
  function load(arr) {
    list.length = 0;
    for (const e of Array.isArray(arr) ? arr : []) if (isEntry(e)) add(fromEntry(e), { save: false });
    renderList();
  }
  function remove(t) {
    deps.onRemove(t);
    const i = list.indexOf(t);
    if (i >= 0) list.splice(i, 1);
    renderList();
    deps.changed();
    deps.save();
  }

  // ------------------------------------------------------------ every frame
  // Per trigger + person: smoothed score; fires when ≥ "close enough" for the hold time; then
  // `held` until the match drops RELEASE below it (which also re-arms it).
  /** @param people array of MediaPipe landmark lists; vw,vh camera size */
  function update(people, vw, vh, now) {
    for (const t of list) {
      t.best = 0;
      people.forEach((lm, i) => {
        const r = (t.people[i] ??= { score: 0, holdFrom: 0, armed: true, held: false, start: 0, releasedAt: 0 });
        const m = lm && t.enabled ? matchPose(t, lm, vw, vh) : null;
        r.score = m == null ? r.score * 0.6 : r.score * 0.4 + m * 0.6; // a little smoothing
        t.best = Math.max(t.best, r.score);
        if (r.score >= t.th) {
          r.holdFrom ||= now;
          if (r.armed && now - r.holdFrom >= t.hold * 1000) {
            r.armed = false; r.held = true; r.start = now; r.releasedAt = Infinity;
            t.flash = now;
            deps.onFire(t, i);
          }
        } else {
          r.holdFrom = 0;
          if (r.score < t.th - RELEASE && !r.armed) { r.armed = true; r.held = false; r.releasedAt = now; }
        }
      });
      t.people.length = people.length;
    }
    if (!winEl.hidden) updateMeters();
  }

  /**
   * Is something linked to trigger t showing for person i right now?
   * @param whileHeld show as long as the pose is held (else for `dur` seconds)
   * @returns null, or { alpha (fade in/out), since (ms since it fired) }
   */
  function showing(t, i, now, whileHeld, dur) {
    const r = t?.enabled ? t.people[i] : null;
    if (!r || !r.start) return null;
    const end = whileHeld ? (r.held ? Infinity : r.releasedAt) : r.start + dur * 1000;
    if (now > end + FADE_OUT) return null;
    const fadeIn = Math.min(1, (now - r.start) / FADE_IN);
    const fadeOut = end === Infinity ? 1 : Math.min(1, Math.max(0, (end + FADE_OUT - now) / FADE_OUT));
    return { alpha: Math.min(fadeIn, fadeOut), since: now - r.start };
  }

  // ------------------------------------------------------------ the Triggers window
  const winEl = $('#trigWin');
  const listEl = $('#trigList');
  const form = $('#trigForm');
  let editing = null;   // trigger being edited, or 'new'
  let draft = null;     // settings in the form
  let afterForm = null; // callback(trigger | null) when the form was opened from an overlay
  let getLandmarks = () => null;

  const poseLabel = t => (t.pose === 'custom' ? 'My own pose' : PRESET_BY_ID[t.pose]?.label ?? t.pose);
  const poseIcon = t => (t.pose === 'custom' ? '🧍' : PRESET_BY_ID[t.pose]?.icon ?? '•');

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
      const used = deps.usedBy(t);
      li.querySelector('.trig-what').textContent = `${poseLabel(t)} · ${used.length ? `shows ${used.join(', ')}` : 'not used by any overlay yet'}`;
      const on = li.querySelector('.trig-on');
      on.textContent = t.enabled ? '●' : '○';
      on.setAttribute('aria-label', `${t.enabled ? 'Turn off' : 'Turn on'} ${t.name}`);
      on.onclick = () => { t.enabled = !t.enabled; renderList(); deps.save(); };
      li.querySelector('.trig-edit').setAttribute('aria-label', `Edit ${t.name}`);
      li.querySelector('.trig-edit').onclick = () => openForm(t);
      li.querySelector('.trig-del').setAttribute('aria-label', `Remove ${t.name}`);
      li.querySelector('.trig-del').onclick = () => {
        const msg = used.length ? `Remove the “${t.name}” trigger? ${used.length === 1 ? 'The overlay that uses it' : `The ${used.length} overlays that use it`} will show all the time instead.` : `Remove the “${t.name}” trigger?`;
        if (confirm(msg)) remove(t);
      };
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
    const parts = $('#tfParts');
    parts.innerHTML = '';
    for (const c of PART_CHOICES) parts.append(new Option(c.label, c.id));
  }

  function openWindow() {
    winEl.hidden = false;
    $('#trigBtn').setAttribute('aria-expanded', 'true');
  }
  function closeWindow() {
    winEl.hidden = true;
    closeForm();
    $('#trigBtn').setAttribute('aria-expanded', 'false');
  }

  function openForm(t, done = null) {
    afterForm = done;
    editing = t || 'new';
    draft = t ? { ...t } : { ...DEFAULTS, name: PRESET_BY_ID.handsTogether.label, pose: 'handsTogether', sig: null };
    $('#tfTitle').textContent = t ? 'Edit trigger' : 'New trigger';
    $('#tfName').value = draft.name;
    $('#tfPose').value = draft.pose;
    $('#tfParts').value = draft.parts;
    $('#tfClose').value = Math.round(draft.th * 100);
    $('#tfHold').value = draft.hold;
    $('#tfFromOverlay').hidden = !done;
    syncForm();
    form.hidden = false;
    $('#trigListWrap').hidden = true;
    $('#tfName').focus();
  }
  function closeForm(saved = null) {
    const done = afterForm;
    afterForm = null;
    form.hidden = true; $('#trigListWrap').hidden = false;
    editing = draft = null;
    if (done) { closeWindow(); done(saved); }
  }
  function syncForm() {
    $('#tfCustom').hidden = draft.pose !== 'custom';
    $('#tfCaptured').textContent = draft.sig ? 'Pose captured ✓ — capture again to change it.' : 'Strike the pose in front of the camera, then press Capture.';
    $('#tfCloseOut').textContent = `${Math.round(draft.th * 100)}%`;
    $('#tfHoldOut').textContent = `${(+draft.hold).toFixed(1)} s`;
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
    $('#trigBtn').onclick = () => { openWindow(); $('#trigAdd').focus(); };
    $('#trigWinClose').onclick = () => {
      const fromOverlay = !!afterForm;
      if (fromOverlay) closeForm(null); else { closeWindow(); $('#trigBtn').focus(); }
    };
    $('#trigAdd').onclick = () => openForm(null);
    $('#tfCancel').onclick = () => closeForm(null);
    $('#tfPose').onchange = e => {
      const wasDefaultName = !draft.name || PRESETS.some(p => p.label === draft.name) || draft.name === 'My pose';
      draft.pose = e.target.value;
      if (wasDefaultName) $('#tfName').value = draft.name = draft.pose === 'custom' ? 'My pose' : PRESET_BY_ID[draft.pose].label;
      syncForm();
    };
    $('#tfName').oninput = e => (draft.name = e.target.value);
    $('#tfParts').onchange = e => (draft.parts = e.target.value);
    $('#tfClose').oninput = e => { draft.th = +e.target.value / 100; syncForm(); };
    $('#tfHold').oninput = e => { draft.hold = +e.target.value; syncForm(); };
    $('#tfCapture').onclick = async () => {
      if (!getLandmarks()) { deps.status('Start the camera and stand where it can see you, then capture.', { error: true }); return; }
      await captureCountdown();
      const r = getLandmarks();
      if (!r) { deps.status('Nobody was in view — try again.', { error: true }); return; }
      draft.sig = captureSignature(r.lm, r.vw, r.vh);
      if (draft.sig.slice(0, 8).filter(v => v != null).length < 2) { draft.sig = null; deps.status('Not enough of the body was in view — step back and try again.', { error: true }); }
      syncForm();
    };
    $('#tfSave').onclick = () => {
      if (draft.pose === 'custom' && !draft.sig) { deps.status('Capture your pose first.', { error: true }); return; }
      draft.name = (draft.name || '').trim() || (draft.pose === 'custom' ? 'My pose' : PRESET_BY_ID[draft.pose].label);
      const settings = { name: draft.name, pose: draft.pose, sig: draft.pose === 'custom' ? draft.sig : null, parts: draft.parts, th: draft.th, hold: draft.hold };
      let t;
      if (editing === 'new') t = add(settings);
      else {
        t = editing;
        Object.assign(t, settings);
        t.people = [];
        renderList(); deps.changed(); deps.save();
      }
      closeForm(t);
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !winEl.hidden) (form.hidden ? $('#trigWinClose') : $('#tfCancel')).click(); });
  }

  /** Opens the window straight onto "New trigger"; done(trigger | null) when saved or cancelled. */
  function openNew(done) { openWindow(); openForm(null, done); }

  return { list, add, load, remove, update, showing, serialise, normalise, wire, openNew, renderList, poseIcon };
}
