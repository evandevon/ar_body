// Pose matching for triggers. Every pose gives a "match" from 0 to 1 (shown as %), and a
// trigger fires when the match stays above its "close enough" level for long enough.
//
// Distances are measured in shoulder-widths and angles in degrees, so poses work the same for
// a small child near the camera and an adult further back. "Left" and "right" are the person's
// OWN left and right (their left hand is the one they'd call their left).

// MediaPipe body point numbers (11 = the person's left shoulder, etc.)
const P = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28 };

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 1 when x has reached `full`, 0 when it's at `zero`, straight line in between (either direction). */
const ramp = (x, zero, full) => clamp01((x - zero) / (full - zero));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = r => (r * 180) / Math.PI;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function jointAngle(a, b, c) { // angle at b, 0..180
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d))));
}

/** Body points in real proportions (pixels), unmirrored, with visibility. */
function points(lm, vw, vh) {
  const pt = {};
  for (const [k, i] of Object.entries(P)) pt[k] = { x: lm[i].x * vw, y: lm[i].y * vh, v: lm[i].visibility ?? 1 };
  pt.S = Math.max(dist(pt.lSh, pt.rSh), dist(pt.lEar, pt.rEar) * 2.2, 1);
  pt.shMid = mid(pt.lSh, pt.rSh);
  pt.hipMid = mid(pt.lHip, pt.rHip);
  return pt;
}
const seen = (pt, ...keys) => keys.every(k => pt[k].v > 0.5);

// ---- preset poses: (pt) => 0..1, or null if the needed body parts can't be seen
export const PRESETS = [
  { id: 'handsTogether', label: 'Hands together', icon: '🙏', needs: ['lWr', 'rWr'],
    score: pt => ramp(dist(pt.lWr, pt.rWr) / pt.S, 0.9, 0.3) },
  { id: 'handsUp', label: 'Both hands up', icon: '🙌', needs: ['lWr', 'rWr', 'nose'],
    score: pt => Math.min(ramp((pt.nose.y - pt.lWr.y) / pt.S, -0.3, 0.3), ramp((pt.nose.y - pt.rWr.y) / pt.S, -0.3, 0.3)) },
  { id: 'leftHandUp', label: 'Left hand up', icon: '✋', needs: ['lWr', 'nose'],
    score: pt => ramp((pt.nose.y - pt.lWr.y) / pt.S, -0.3, 0.3) },
  { id: 'rightHandUp', label: 'Right hand up', icon: '✋', needs: ['rWr', 'nose'],
    score: pt => ramp((pt.nose.y - pt.rWr.y) / pt.S, -0.3, 0.3) },
  { id: 'tPose', label: 'Arms out (T-pose)', icon: '✈️', needs: ['lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr'],
    score: pt => {
      const arm = (sh, el, wr) => {
        const level = 1 - Math.abs(deg(Math.atan2(wr.y - sh.y, Math.abs(wr.x - sh.x)))) / 40; // how flat
        const straight = ramp(jointAngle(sh, el, wr), 120, 160);
        const out = ramp(Math.abs(wr.x - sh.x) / pt.S, 0.5, 1.1);
        return Math.min(clamp01(level), straight, out);
      };
      return Math.min(arm(pt.lSh, pt.lEl, pt.lWr), arm(pt.rSh, pt.rEl, pt.rWr));
    } },
  { id: 'starJump', label: 'Star jump', icon: '⭐', needs: ['lWr', 'rWr', 'lSh', 'rSh', 'lAnk', 'rAnk'],
    score: pt => {
      const up = Math.min(ramp((pt.lSh.y - pt.lWr.y) / pt.S, -0.1, 0.5), ramp((pt.rSh.y - pt.rWr.y) / pt.S, -0.1, 0.5));
      const wide = ramp(Math.abs(pt.lWr.x - pt.rWr.x) / pt.S, 1.2, 2.2);
      const legs = ramp(Math.abs(pt.lAnk.x - pt.rAnk.x) / pt.S, 0.6, 1.3);
      return Math.min(up, wide, legs);
    } },
  { id: 'squat', label: 'Squat / crouch', icon: '🏋️', needs: ['lHip', 'rHip', 'lKnee', 'rKnee', 'lAnk', 'rAnk'],
    score: pt => {
      const bent = (ramp(jointAngle(pt.lHip, pt.lKnee, pt.lAnk), 165, 115) + ramp(jointAngle(pt.rHip, pt.rKnee, pt.rAnk), 165, 115)) / 2;
      const low = ramp((Math.max(pt.lAnk.y, pt.rAnk.y) - pt.hipMid.y) / pt.S, 1.45, 1.05); // hips have dropped towards the (lower) foot
      return Math.min(bent, low);
    } },
  { id: 'handsOnHead', label: 'Hands on head', icon: '🤯', needs: ['lWr', 'rWr', 'lEar', 'rEar'],
    score: pt => { const head = mid(pt.lEar, pt.rEar); return Math.min(ramp(dist(pt.lWr, head) / pt.S, 1.0, 0.5), ramp(dist(pt.rWr, head) / pt.S, 1.0, 0.5)); } },
  { id: 'handsOnHips', label: 'Hands on hips', icon: '🦸', needs: ['lWr', 'rWr', 'lHip', 'rHip', 'lEl', 'rEl', 'lSh', 'rSh'],
    score: pt => {
      const near = Math.min(ramp(dist(pt.lWr, pt.lHip) / pt.S, 0.8, 0.35), ramp(dist(pt.rWr, pt.rHip) / pt.S, 0.8, 0.35));
      const bent = Math.min(ramp(jointAngle(pt.lSh, pt.lEl, pt.lWr), 165, 125), ramp(jointAngle(pt.rSh, pt.rEl, pt.rWr), 165, 125));
      const out = ramp(Math.abs(pt.lEl.x - pt.rEl.x) / pt.S, 1.15, 1.5); // elbows pointing outwards
      return Math.min(near, bent, out);
    } },
  { id: 'armsCrossed', label: 'Arms crossed (X)', icon: '❌', needs: ['lWr', 'rWr', 'lSh', 'rSh'],
    score: pt => {
      // each wrist has crossed over to the other side of the body's middle line
      const side = Math.sign(pt.lSh.x - pt.rSh.x) || 1; // which way "the person's left" points in the picture
      const l = ramp(((pt.shMid.x - pt.lWr.x) * side) / pt.S, -0.05, 0.25);
      const r = ramp(((pt.rWr.x - pt.shMid.x) * side) / pt.S, -0.05, 0.25);
      const chest = Math.min(ramp(Math.abs(pt.lWr.y - pt.shMid.y) / pt.S, 1.4, 0.8), ramp(Math.abs(pt.rWr.y - pt.shMid.y) / pt.S, 1.4, 0.8));
      return Math.min(l, r, chest);
    } },
  { id: 'kick', label: 'Kick (either leg)', icon: '🦵', needs: ['lAnk', 'rAnk'],
    score: pt => Math.max(ramp((pt.rAnk.y - pt.lAnk.y) / pt.S, 0.25, 0.8), ramp((pt.lAnk.y - pt.rAnk.y) / pt.S, 0.25, 0.8)) },
];
export const PRESET_BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

// ---- custom poses: the direction of each limb part, relative to the body's own "up"
const SEGMENTS = [
  ['lUpper', 'lSh', 'lEl', 'arms'], ['lFore', 'lEl', 'lWr', 'arms'],
  ['rUpper', 'rSh', 'rEl', 'arms'], ['rFore', 'rEl', 'rWr', 'arms'],
  ['lThigh', 'lHip', 'lKnee', 'legs'], ['lShin', 'lKnee', 'lAnk', 'legs'],
  ['rThigh', 'rHip', 'rKnee', 'legs'], ['rShin', 'rKnee', 'rAnk', 'legs'],
];
export const PART_CHOICES = [
  { id: 'all', label: 'Whole body' },
  { id: 'arms', label: 'Arms only' },
  { id: 'legs', label: 'Legs only' },
];

/** Captures the current pose as 8 limb directions (whole degrees; null where not seen). */
export function captureSignature(lm, vw, vh) {
  const pt = points(lm, vw, vh);
  const up = Math.atan2(pt.shMid.y - pt.hipMid.y, pt.shMid.x - pt.hipMid.x);
  // mirror-proof: measure sideways angles from the person's left, whichever way they appear
  const flip = Math.sign(pt.lSh.x - pt.rSh.x) || 1;
  return SEGMENTS.map(([, a, b]) => {
    if (!seen(pt, a, b)) return null;
    let d = deg(Math.atan2(pt[b].y - pt[a].y, pt[b].x - pt[a].x) - up);
    d = ((d + 540) % 360) - 180;
    return Math.round(d * flip);
  });
}

function similarity(sig, lm, vw, vh, parts = 'all') {
  const now = captureSignature(lm, vw, vh);
  let sum = 0, n = 0;
  SEGMENTS.forEach(([, , , group], i) => {
    if (parts !== 'all' && parts !== group) return;
    if (sig[i] == null || now[i] == null) return;
    let d = Math.abs(sig[i] - now[i]) % 360;
    if (d > 180) d = 360 - d;
    sum += d; n++;
  });
  if (n < 2) return null;
  return ramp(sum / n, 50, 5); // 5° or less off on average = 100%; 50° or more = 0%
}

/** Match (0..1) of one trigger's pose for one person, or null if it can't be judged. */
export function matchPose(trigger, lm, vw, vh) {
  if (trigger.pose === 'custom') return trigger.sig ? similarity(trigger.sig, lm, vw, vh, trigger.parts) : null;
  const pr = PRESET_BY_ID[trigger.pose];
  if (!pr) return null;
  const pt = points(lm, vw, vh);
  if (!seen(pt, ...pr.needs)) return null;
  return clamp01(pr.score(pt));
}
