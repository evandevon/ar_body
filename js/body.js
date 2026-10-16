// Turns MediaPipe's 33 pose landmarks into "anchors" — named spots on the body
// (head, hands, torso…) each with a position, rotation and size in canvas pixels.

// BlazePose landmark indices
const I = {
  nose: 0, lEye: 2, rEye: 5, lEar: 7, rEar: 8, mouthL: 9, mouthR: 10,
  lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

// size = default overlay width as a multiple of the body scale (roughly shoulder width)
export const ANCHORS = [
  { id: 'hat',       label: 'Top of head (hat)',  group: 'Head', size: 0.9 },
  { id: 'head',      label: 'Whole head',         group: 'Head', size: 0.9 },
  { id: 'eyes',      label: 'Eyes (glasses)',     group: 'Head', size: 0.75 },
  { id: 'face',      label: 'Nose',               group: 'Head', size: 0.3 },
  { id: 'mouth',     label: 'Mouth',              group: 'Head', size: 0.35 },
  { id: 'chest',     label: 'Chest',              group: 'Body', size: 0.8 },
  { id: 'torso',     label: 'Tummy',              group: 'Body', size: 1.1 },
  { id: 'hips',      label: 'Hips / waist',       group: 'Body', size: 1.2 },
  { id: 'body',      label: 'Whole body',         group: 'Body', size: 2.6 },
  { id: 'lShoulder', label: 'Left shoulder',      group: 'Arms', size: 0.45 },
  { id: 'rShoulder', label: 'Right shoulder',     group: 'Arms', size: 0.45 },
  { id: 'lHand',     label: 'Left hand',          group: 'Arms', size: 0.5 },
  { id: 'rHand',     label: 'Right hand',         group: 'Arms', size: 0.5 },
  { id: 'lFoot',     label: 'Left foot',          group: 'Legs', size: 0.5 },
  { id: 'rFoot',     label: 'Right foot',         group: 'Legs', size: 0.5 },
  // Bones stretch between two joints. For these, size = picture height as a multiple of the
  // bone's length (1.15 = reaches a little past each joint), and the picture's TOP sits at the
  // joint nearer the body (shoulder, elbow, hip, knee, neck).
  { id: 'lUpperArm', label: 'Left upper arm',     group: 'Bones', size: 1.15, bone: true },
  { id: 'lForearm',  label: 'Left forearm',       group: 'Bones', size: 1.15, bone: true },
  { id: 'rUpperArm', label: 'Right upper arm',    group: 'Bones', size: 1.15, bone: true },
  { id: 'rForearm',  label: 'Right forearm',      group: 'Bones', size: 1.15, bone: true },
  { id: 'lThigh',    label: 'Left thigh',         group: 'Bones', size: 1.15, bone: true },
  { id: 'lShin',     label: 'Left shin',          group: 'Bones', size: 1.15, bone: true },
  { id: 'rThigh',    label: 'Right thigh',        group: 'Bones', size: 1.15, bone: true },
  { id: 'rShin',     label: 'Right shin',         group: 'Bones', size: 1.15, bone: true },
  { id: 'spine',     label: 'Spine (neck to hips)', group: 'Bones', size: 1.05, bone: true },
];
export const ANCHOR_BY_ID = Object.fromEntries(ANCHORS.map(a => [a.id, a]));

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
const avg = (...p) => ({
  x: p.reduce((s, q) => s + q.x, 0) / p.length,
  y: p.reduce((s, q) => s + q.y, 0) / p.length,
  v: Math.min(...p.map(q => q.v)),
});
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, v: Math.min(a.v, b.v) });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const along = (p, dir, d) => ({ x: p.x + dir.x * d, y: p.y + dir.y * d, v: p.v });

/**
 * @param lm      one pose's landmarks (normalised 0..1)
 * @param W,H     canvas size in pixels
 * @param mirror  true when the picture is shown mirrored (selfie view)
 * @returns {Record<string,{x,y,angle,scale,vis}>}
 */
export function computeAnchors(lm, W, H, mirror) {
  const p = lm.map(q => ({ x: (mirror ? 1 - q.x : q.x) * W, y: q.y * H, v: q.visibility ?? 1 }));
  const P = k => p[I[k]];

  // Angle of a left/right pair, measured so that 0 = level, whichever way the view is flipped.
  // Facing the camera, the person's right side is on the image's left (unless mirrored).
  const across = (right, left) => (mirror ? ang(left, right) : ang(right, left));

  const lSh = P('lSh'), rSh = P('rSh'), lHip = P('lHip'), rHip = P('rHip');
  const lEar = P('lEar'), rEar = P('rEar');
  const shMid = mid(lSh, rSh), hipMid = mid(lHip, rHip), earMid = mid(lEar, rEar);

  // Body scale: roughly shoulder width, estimated from whatever is reliably visible.
  const cands = [dist(lEar, rEar) * 2.6];
  if (Math.min(lSh.v, rSh.v) > 0.5) cands.push(dist(lSh, rSh));
  if (Math.min(lSh.v, rSh.v, lHip.v, rHip.v) > 0.5) cands.push(dist(shMid, hipMid) * 0.75);
  const S = Math.max(...cands, 4);

  const aHead = across(rEar, lEar);
  const aSh = across(rSh, lSh);
  const aHip = across(rHip, lHip);
  const up = a => ({ x: Math.sin(a), y: -Math.cos(a) }); // "up" perpendicular to a level line
  const headUp = up(aHead), shDown = { x: -up(aSh).x, y: -up(aSh).y };

  const out = {};
  const set = (id, pt, angle) => (out[id] = { x: pt.x, y: pt.y, angle, scale: S, vis: pt.v });

  const nose = P('nose');
  set('hat', { ...along(earMid, headUp, 0.45 * S), v: nose.v }, aHead);
  set('head', { ...along(earMid, headUp, 0.05 * S), v: nose.v }, aHead);
  set('eyes', mid(P('lEye'), P('rEye')), across(P('rEye'), P('lEye')));
  set('face', nose, aHead);
  set('mouth', mid(P('mouthL'), P('mouthR')), across(P('mouthR'), P('mouthL')));

  set('chest', along(shMid, shDown, 0.3 * S), aSh);
  set('torso', lerp(shMid, hipMid, 0.55), aSh);
  set('hips', hipMid, aHip);

  const top = along(earMid, headUp, 0.4 * S);
  const feet = mid(P('lAnk'), P('rAnk'));
  const bodyC = mid(top, feet);
  set('body', { ...bodyC, v: Math.min(nose.v, Math.max(P('lAnk').v, P('rAnk').v)) }, ang(feet, top) + Math.PI / 2);

  set('lShoulder', lSh, aSh);
  set('rShoulder', rSh, aSh);

  // Bones: centred between the joints, turned to lie along the limb, length = joint-to-joint
  const bone = (id, a, b) => {
    out[id] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: ang(a, b) - Math.PI / 2, scale: S, len: Math.max(dist(a, b), 1), vis: Math.min(a.v, b.v) };
  };
  for (const s of ['l', 'r']) {
    bone(s + 'UpperArm', P(s + 'Sh'), P(s + 'El'));
    bone(s + 'Forearm', P(s + 'El'), P(s + 'Wr'));
    bone(s + 'Thigh', P(s + 'Hip'), P(s + 'Knee'));
    bone(s + 'Shin', P(s + 'Knee'), P(s + 'Ank'));
  }
  bone('spine', shMid, hipMid);

  for (const s of ['l', 'r']) {
    const el = P(s + 'El'), wr = P(s + 'Wr');
    const hand = { ...avg(wr, P(s + 'Index'), P(s + 'Pinky')), v: wr.v };
    set(s + 'Hand', hand, ang(el, wr) + Math.PI / 2); // forearm pointing up = upright

    const kn = P(s + 'Knee'), an = P(s + 'Ank');
    const foot = { ...avg(an, P(s + 'Heel'), P(s + 'Toe')), v: an.v };
    set(s + 'Foot', foot, ang(kn, an) - Math.PI / 2); // shin pointing down = upright
  }
  return out;
}

/** Shortest signed difference between two angles (radians). */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
