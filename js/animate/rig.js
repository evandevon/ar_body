// Turns a cut-out drawing + joint dots into a bendable puppet, and poses it from a tracked person.
//
// "Left" and "right" here always mean the SCREEN side (as you look at the drawing), because
// that's how a child places the dots. The performer's limbs are matched the same way: the arm
// that appears on the left of the camera picture drives the drawing's left-side arm, so the
// character moves like the person's image on screen.

export const JOINTS = [
  { id: 'head', label: 'Head', side: 'c' },
  { id: 'neck', label: 'Neck', side: 'c' },
  { id: 'lShoulder', label: 'Shoulder', side: 'l' },
  { id: 'lElbow', label: 'Elbow', side: 'l' },
  { id: 'lHand', label: 'Hand', side: 'l' },
  { id: 'rShoulder', label: 'Shoulder', side: 'r' },
  { id: 'rElbow', label: 'Elbow', side: 'r' },
  { id: 'rHand', label: 'Hand', side: 'r' },
  { id: 'lHip', label: 'Hip', side: 'l' },
  { id: 'lKnee', label: 'Knee', side: 'l' },
  { id: 'lFoot', label: 'Foot', side: 'l' },
  { id: 'rHip', label: 'Hip', side: 'r' },
  { id: 'rKnee', label: 'Knee', side: 'r' },
  { id: 'rFoot', label: 'Foot', side: 'r' },
];

// [bone id, from joint, to joint, which performer angle drives it]
// 'root' = midpoint of the hips.
export const BONES = [
  ['spine', 'root', 'neck', 'spine'],
  ['head', 'neck', 'head', 'head'],
  ['lClav', 'neck', 'lShoulder', 'shoulders'],
  ['rClav', 'neck', 'rShoulder', 'shoulders'],
  ['lUpper', 'lShoulder', 'lElbow', 'lUpper'],
  ['lFore', 'lElbow', 'lHand', 'lFore'],
  ['rUpper', 'rShoulder', 'rElbow', 'rUpper'],
  ['rFore', 'rElbow', 'rHand', 'rFore'],
  ['lPelvis', 'root', 'lHip', 'hips'],
  ['rPelvis', 'root', 'rHip', 'hips'],
  ['lThigh', 'lHip', 'lKnee', 'lThigh'],
  ['lShin', 'lKnee', 'lFoot', 'lShin'],
  ['rThigh', 'rHip', 'rKnee', 'rThigh'],
  ['rShin', 'rKnee', 'rFoot', 'rShin'],
];
// Lines connecting the dots in the editor (skeleton display)
export const LINKS = BONES.filter(b => b[1] !== 'root').map(b => [b[1], b[2]]).concat([['lHip', 'rHip'], ['neck', 'hipMid']]);

const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const withRoot = j => ({ ...j, root: mid(j.lHip, j.rHip), hipMid: mid(j.lHip, j.rHip) });

// ------------------------------------------------------------ first guess at the joints
/** Guesses joint positions from the silhouette, assuming a roughly star-shaped pose. */
export function guessJoints(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const at = (x, y) => mask[(y | 0) * w + (x | 0)];

  // centroid of mask pixels in a box
  const centroid = (bx0, by0, bx1, by1) => {
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.max(0, by0 | 0); y <= Math.min(h - 1, by1 | 0); y++)
      for (let x = Math.max(0, bx0 | 0); x <= Math.min(w - 1, bx1 | 0); x++)
        if (mask[y * w + x]) { sx += x; sy += y; n++; }
    return n ? { x: sx / n, y: sy / n } : null;
  };

  const head = centroid(x0, y0, x1, y0 + 0.14 * H) ?? { x: x0 + W / 2, y: y0 + 0.07 * H };
  const cx = head.x;

  // hands: furthest-out ink on each side, within the upper/middle body
  const band0 = y0 + 0.15 * H, band1 = y0 + 0.72 * H;
  let lx = w, rx = -1;
  for (let y = band0 | 0; y <= band1; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) { if (x < lx) lx = x; if (x > rx) rx = x; }
  const lHand = centroid(lx, band0, lx + 0.05 * W, band1) ?? { x: x0, y: y0 + 0.4 * H };
  const rHand = centroid(rx - 0.05 * W, band0, rx, band1) ?? { x: x1, y: y0 + 0.4 * H };

  // feet: lowest ink on each side of the centre line
  const footBand = y1 - 0.05 * H;
  const lFoot = centroid(x0, footBand, cx - 1, y1) ?? { x: cx - 0.15 * W, y: y1 };
  const rFoot = centroid(cx + 1, footBand, x1, y1) ?? { x: cx + 0.15 * W, y: y1 };

  // hips: around 55-60% down. Measure the torso's width there to place hips and shoulders.
  const hipY = y0 + 0.57 * H;
  let tl = Math.round(cx), tr = Math.round(cx);
  while (tl > x0 && at(tl - 1, hipY)) tl--;
  while (tr < x1 && at(tr + 1, hipY)) tr++;
  const torsoHalf = Math.max(0.05 * W, Math.min((tr - tl) / 2, 0.3 * W));
  const tcx = (tl + tr) / 2;
  const lHip = { x: tcx - torsoHalf * 0.5, y: hipY }, rHip = { x: tcx + torsoHalf * 0.5, y: hipY };

  const neck = { x: cx, y: head.y + (hipY - head.y) * 0.32 };
  const shY = neck.y + 0.035 * H;
  const lShoulder = { x: tcx - torsoHalf * 0.85, y: shY }, rShoulder = { x: tcx + torsoHalf * 0.85, y: shY };
  const j = {
    head, neck, lShoulder, rShoulder, lHand, rHand, lHip, rHip, lFoot, rFoot,
    lElbow: mid(lShoulder, lHand), rElbow: mid(rShoulder, rHand),
    lKnee: mid(lHip, lFoot), rKnee: mid(rHip, rFoot),
  };
  for (const k of Object.keys(j)) j[k] = snapInside(mask, w, h, j[k]);
  return j;
}

/** Moves a point to the nearest pixel inside the mask (if it isn't already). */
export function snapInside(mask, w, h, p) {
  const px = Math.round(p.x), py = Math.round(p.y);
  if (px >= 0 && py >= 0 && px < w && py < h && mask[py * w + px]) return { x: p.x, y: p.y };
  const R = Math.max(w, h);
  for (let r = 1; r < R; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (best) return best;
  }
  return { x: p.x, y: p.y };
}

// ------------------------------------------------------------ mesh + weights
/**
 * Builds a triangle mesh covering the character and works out how much each bone pulls on
 * each mesh point. Distances are measured THROUGH the drawing (along the mesh), so an arm held
 * near the body still bends with the arm, not the body.
 */
export function buildRig(mask, w, h, joints) {
  const J = withRoot(joints);
  const step = Math.max(4, Math.round(Math.max(w, h) / 64));
  const cols = Math.ceil(w / step), rows = Math.ceil(h / step);
  const cellIn = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    let found = 0;
    for (let y = cy * step; y < Math.min(h, (cy + 1) * step) && !found; y++)
      for (let x = cx * step; x < Math.min(w, (cx + 1) * step); x++) if (mask[y * w + x]) { found = 1; break; }
    cellIn[cy * cols + cx] = found;
  }
  const vid = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
  const pos = [], tris = [];
  const v = (gx, gy) => {
    const k = gy * (cols + 1) + gx;
    if (vid[k] < 0) { vid[k] = pos.length / 2; pos.push(Math.min(gx * step, w), Math.min(gy * step, h)); }
    return vid[k];
  };
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    if (!cellIn[cy * cols + cx]) continue;
    const a = v(cx, cy), b = v(cx + 1, cy), c = v(cx, cy + 1), d = v(cx + 1, cy + 1);
    tris.push(a, b, c, b, d, c);
  }
  const n = pos.length / 2;
  const rest = new Float32Array(pos);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = rest[i * 2] / w; uv[i * 2 + 1] = rest[i * 2 + 1] / h; }

  // neighbours along triangle edges
  const nbr = Array.from({ length: n }, () => new Map());
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const d = Math.hypot(rest[p * 2] - rest[q * 2], rest[p * 2 + 1] - rest[q * 2 + 1]);
      nbr[p].set(q, d); nbr[q].set(p, d);
    }
  }

  const segDist = (px, py, a, b, from = 0) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(from, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L));
    return Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
  };
  // Limb and head bones are measured from a little way along the bone, so they don't reach
  // back past their joint into the body (otherwise lowering an arm drags the face with it).
  const SEED_FROM = { head: 0.3, lUpper: 0.2, rUpper: 0.2, lThigh: 0.2, rThigh: 0.2, lFore: 0.1, rFore: 0.1, lShin: 0.1, rShin: 0.1 };

  const nb = BONES.length;
  const D = new Float32Array(n * nb).fill(Infinity);
  for (let bi = 0; bi < nb; bi++) {
    const [bid, f, t] = BONES[bi];
    const A = J[f], B = J[t], from = SEED_FROM[bid] ?? 0;
    // seeds: mesh points right on the bone
    const dist0 = new Float64Array(n).fill(Infinity); // must match the heap's precision
    let nearest = 0, nd = Infinity;
    const heap = new MinHeap();
    for (let i = 0; i < n; i++) {
      const sd = segDist(rest[i * 2], rest[i * 2 + 1], A, B, from);
      if (sd < nd) { nd = sd; nearest = i; }
      if (sd <= step * 0.75) { dist0[i] = sd; heap.push(sd, i); }
    }
    if (!heap.size) { dist0[nearest] = nd; heap.push(nd, nearest); }
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > dist0[i]) continue;
      for (const [j, len] of nbr[i]) {
        const nd2 = d + len;
        if (nd2 < dist0[j]) { dist0[j] = nd2; heap.push(nd2, j); }
      }
    }
    for (let i = 0; i < n; i++) D[i * nb + bi] = dist0[i];
  }

  // keep the 3 nearest bones per point, weight ~ 1/d^4
  const K = 3;
  const bIdx = new Uint8Array(n * K), bW = new Float32Array(n * K);
  const eps = step * 0.6;
  for (let i = 0; i < n; i++) {
    const order = [...Array(nb).keys()].sort((a, b) => D[i * nb + a] - D[i * nb + b]);
    if (!Number.isFinite(D[i * nb + order[0]])) {
      // piece not connected to any bone (e.g. a separate hat): follow the nearest bone in a straight line
      let best = 0, bd = Infinity;
      for (let bi = 0; bi < nb; bi++) {
        const [, f, t] = BONES[bi];
        const sd = segDist(rest[i * 2], rest[i * 2 + 1], J[f], J[t]);
        if (sd < bd) { bd = sd; best = bi; }
      }
      bIdx[i * K] = best; bW[i * K] = 1;
      continue;
    }
    let sum = 0;
    for (let k = 0; k < K; k++) {
      const bi = order[k], d = D[i * nb + bi];
      const wgt = Number.isFinite(d) ? 1 / Math.pow(d + eps, 4) : 0;
      bIdx[i * K + k] = bi; bW[i * K + k] = wgt; sum += wgt;
    }
    for (let k = 0; k < K; k++) bW[i * K + k] /= sum;
  }

  // Drawing order: triangles are drawn back-to-front, so sort them by body part —
  // legs at the back, then body, then head, then arms in front (so a waving arm crosses
  // over the body and face instead of disappearing behind them).
  const LAYER = { lThigh: 0, lShin: 0, rThigh: 0, rShin: 0, spine: 1, lClav: 1, rClav: 1, lPelvis: 1, rPelvis: 1, head: 2, lUpper: 3, lFore: 3, rUpper: 3, rFore: 3 };
  const triLayer = [];
  const sum = new Float32Array(nb);
  for (let t = 0; t < tris.length; t += 3) {
    sum.fill(0);
    for (let k = 0; k < 3; k++) {
      const v = tris[t + k];
      for (let j = 0; j < K; j++) sum[bIdx[v * K + j]] += bW[v * K + j];
    }
    let best = 0;
    for (let bi = 1; bi < nb; bi++) if (sum[bi] > sum[best]) best = bi;
    triLayer.push(LAYER[BONES[best][0]]);
  }
  const order = [...triLayer.keys()].sort((x, y) => triLayer[x] - triLayer[y] || x - y);
  const sorted = new Array(tris.length);
  order.forEach((ti, o) => { sorted[o * 3] = tris[ti * 3]; sorted[o * 3 + 1] = tris[ti * 3 + 1]; sorted[o * 3 + 2] = tris[ti * 3 + 2]; });

  // rest angles of each bone in the drawing
  const restAngle = {};
  for (const [id, f, t] of BONES) restAngle[id] = ang(J[f], J[t]);
  restAngle.shoulders = ang(J.lShoulder, J.rShoulder);
  restAngle.hips = ang(J.lHip, J.rHip);

  const ys = joints.lFoot.y > joints.rFoot.y ? joints.lFoot.y : joints.rFoot.y;
  return {
    w, h, step, rest, uv, indices: new Uint32Array(sorted), weights: { idx: bIdx, w: bW, K },
    joints: J, restAngle,
    feetY: ys,
    torsoLen: dist(J.root, J.neck),
    height: h,
  };
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}

// ------------------------------------------------------------ reading the performer
/**
 * Angles of the performer's body parts as they appear on screen.
 * @param lm  MediaPipe pose landmarks (normalised)
 * @param vw,vh  camera picture size in pixels (angles need real proportions)
 */
export function readPerformer(lm, vw, vh, mirror) {
  const P = i => ({ x: (mirror ? 1 - lm[i].x : lm[i].x) * vw, y: lm[i].y * vh, v: lm[i].visibility ?? 1 });
  // the person's own left side appears on the screen's left only when mirrored
  const sL = mirror ? { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 } : { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 };
  const sR = mirror ? { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 } : { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 };
  const L = Object.fromEntries(Object.entries(sL).map(([k, i]) => [k, P(i)]));
  const R = Object.fromEntries(Object.entries(sR).map(([k, i]) => [k, P(i)]));
  const ears = [P(7), P(8)];
  const shMid = { ...mid(L.sh, R.sh), v: Math.min(L.sh.v, R.sh.v) };
  const hipMid = { ...mid(L.hip, R.hip), v: Math.min(L.hip.v, R.hip.v) };
  const earMid = { ...mid(ears[0], ears[1]), v: Math.min(ears[0].v, ears[1].v) };
  const b = (a, c) => ({ a: ang(a, c), v: Math.min(a.v, c.v) });
  return {
    angles: {
      spine: b(hipMid, shMid),
      head: b(shMid, earMid),
      shoulders: b(L.sh, R.sh),
      hips: b(L.hip, R.hip),
      lUpper: b(L.sh, L.el), lFore: b(L.el, L.wr),
      rUpper: b(R.sh, R.el), rFore: b(R.el, R.wr),
      lThigh: b(L.hip, L.kn), lShin: b(L.kn, L.an),
      rThigh: b(R.hip, R.kn), rShin: b(R.kn, R.an),
    },
    hip: { x: hipMid.x / vw, y: hipMid.y / vh, v: hipMid.v },
    torso: dist(hipMid, shMid) / vh,
  };
}

// The performer's head points from shoulders to ears; the drawing's head bone goes neck → head.
// Both mean "upright", so their rest directions match and copying the angle works.
const DRIVER_FOR = Object.fromEntries(BONES.map(b => [b[0], b[3]]));

/** Holds the smoothed pose. Unseen body parts drift back to the drawing's own pose. */
export class Puppet {
  constructor(rig) {
    this.rig = rig;
    this.delta = Object.fromEntries(['spine', 'head', 'shoulders', 'hips', 'lUpper', 'lFore', 'rUpper', 'rFore', 'lThigh', 'lShin', 'rThigh', 'rShin'].map(k => [k, 0]));
    this.offset = { x: 0, y: 0 };
    this.baseY = null;
    this.out = new Float32Array(rig.rest.length);
  }

  /** @param perf result of readPerformer, or null when nobody is seen */
  update(perf, { smoothing = 0.5, dt = 1 / 30, move = true } = {}) {
    const k = 1 - Math.pow(smoothing * 0.9, dt * 30 * 0.5); // frame-rate independent-ish
    const rig = this.rig;
    for (const id of Object.keys(this.delta)) {
      let target = 0;
      const a = perf?.angles[id];
      if (a && a.v > 0.5) {
        const restId = id === 'shoulders' || id === 'hips' ? id : BONES.find(b => b[3] === id)[0];
        target = angleDiff(rig.restAngle[restId], a.a);
      }
      // body parts out of view relax back to the drawn pose more gently
      const kk = a && a.v > 0.5 ? k : k * 0.25;
      this.delta[id] += angleDiff(this.delta[id], target) * kk;
    }
    // whole-character movement (in units of the drawing's torso length)
    if (perf && perf.hip.v > 0.5 && perf.torso > 0.01) {
      if (this.baseY == null) this.baseY = perf.hip.y;
      this.baseY += (perf.hip.y - this.baseY) * Math.min(1, dt / 3); // slowly settles where they stand
      const tx = move ? ((perf.hip.x - 0.5) / perf.torso) * 0.6 : 0;
      const ty = (perf.hip.y - this.baseY) / perf.torso;
      this.offset.x += (tx - this.offset.x) * k;
      this.offset.y += (ty - this.offset.y) * k;
    }
    return this.pose();
  }

  /** Bends the mesh. Returns positions in drawing pixels (before placing on stage). */
  pose() {
    const { rig, delta, out } = this;
    const J = rig.joints, T = rig.torsoLen;
    const rot = (p, o, a) => {
      const c = Math.cos(a), s = Math.sin(a), dx = p.x - o.x, dy = p.y - o.y;
      return { x: dx * c - dy * s, y: dx * s + dy * c };
    };
    const add = (o, v) => ({ x: o.x + v.x, y: o.y + v.y });
    const N = {};
    N.root = { x: J.root.x + this.offset.x * T, y: J.root.y + this.offset.y * T };
    N.lHip = add(N.root, rot(J.lHip, J.root, delta.hips));
    N.rHip = add(N.root, rot(J.rHip, J.root, delta.hips));
    N.neck = add(N.root, rot(J.neck, J.root, delta.spine));
    N.head = add(N.neck, rot(J.head, J.neck, delta.head));
    for (const s of ['l', 'r']) {
      N[s + 'Shoulder'] = add(N.neck, rot(J[s + 'Shoulder'], J.neck, delta.shoulders));
      N[s + 'Elbow'] = add(N[s + 'Shoulder'], rot(J[s + 'Elbow'], J[s + 'Shoulder'], delta[s + 'Upper']));
      N[s + 'Hand'] = add(N[s + 'Elbow'], rot(J[s + 'Hand'], J[s + 'Elbow'], delta[s + 'Fore']));
      N[s + 'Knee'] = add(N[s + 'Hip'], rot(J[s + 'Knee'], J[s + 'Hip'], delta[s + 'Thigh']));
      N[s + 'Foot'] = add(N[s + 'Knee'], rot(J[s + 'Foot'], J[s + 'Knee'], delta[s + 'Shin']));
    }
    // per-bone transform: v -> N[from] + R(theta) (v - J[from])
    const tf = BONES.map(([, f, , drv]) => {
      const a = delta[drv];
      return [Math.cos(a), Math.sin(a), J[f].x, J[f].y, N[f].x, N[f].y];
    });
    const { idx, w, K } = rig.weights;
    const r = rig.rest;
    for (let i = 0, n = r.length / 2; i < n; i++) {
      const x = r[i * 2], y = r[i * 2 + 1];
      let ox = 0, oy = 0;
      for (let k = 0; k < K; k++) {
        const wt = w[i * K + k];
        if (!wt) continue;
        const [c, s, fx, fy, nx, ny] = tf[idx[i * K + k]];
        const dx = x - fx, dy = y - fy;
        ox += wt * (nx + dx * c - dy * s);
        oy += wt * (ny + dx * s + dy * c);
      }
      out[i * 2] = ox; out[i * 2 + 1] = oy;
    }
    this.joints = N;
    return out;
  }
}
