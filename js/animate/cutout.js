// Finds a hand-drawn character on paper and turns it into a filled silhouette mask.
// Pure functions on RGBA pixel arrays, so they run in the browser or in tests.
//
//   1. Estimate the paper's brightness across the photo (handles shadows / uneven light).
//   2. Mark "ink" = anything clearly darker or more colourful than the paper nearby.
//   3. Thicken the ink a little to close small gaps in the outline.
//   4. Flood in from the photo's edges: whatever the flood can't reach is inside the character
//      (so the white paper inside the outline becomes part of the character).
//   5. Shrink back, and keep only the biggest shape (drops specks and stray marks).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Brightness of the paper at every pixel, from the bright end of each block of the image. */
export function paperMap(img) {
  const { width: w, height: h, data } = img;
  const B = Math.max(12, Math.round(Math.max(w, h) / 16));
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B);
  const grid = new Float32Array(gw * gh);
  const vals = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      vals.length = 0;
      for (let y = gy * B; y < Math.min(h, (gy + 1) * B); y += 2) {
        for (let x = gx * B; x < Math.min(w, (gx + 1) * B); x += 2) {
          const i = (y * w + x) * 4;
          vals.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }
      }
      vals.sort((a, b) => a - b);
      grid[gy * gw + gx] = vals[Math.floor(vals.length * 0.9)] ?? 255;
    }
  }
  // smooth the grid so a heavily-inked block borrows its neighbours' paper brightness
  const sm = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x >= 0 && y >= 0 && x < gw && y < gh) m = Math.max(m, grid[y * gw + x] * (dx || dy ? 0.97 : 1));
    }
    sm[gy * gw + gx] = m;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) / B - 0.5, 0, gh - 1), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) / B - 0.5, 0, gw - 1), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const a = sm[y0 * gw + x0] * (1 - tx) + sm[y0 * gw + x1] * tx;
      const b = sm[y1 * gw + x0] * (1 - tx) + sm[y1 * gw + x1] * tx;
      out[y * w + x] = Math.max(40, a * (1 - ty) + b * ty);
    }
  }
  return out;
}

/** Square dilate (grow) / erode (shrink) of a 0/1 mask by r pixels, using prefix sums. */
export function morph(mask, w, h, r, grow) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const pre = new Int32Array(Math.max(w, h) + 1);
  const pass = (src, dst, len, count, idx) => {
    for (let line = 0; line < count; line++) {
      pre[0] = 0;
      for (let k = 0; k < len; k++) pre[k + 1] = pre[k] + src[idx(line, k)];
      for (let k = 0; k < len; k++) {
        const a = Math.max(0, k - r), b = Math.min(len, k + r + 1);
        const s = pre[b] - pre[a];
        dst[idx(line, k)] = grow ? (s > 0 ? 1 : 0) : (s === b - a ? 1 : 0);
      }
    }
  };
  pass(mask, tmp, w, h, (y, x) => y * w + x);
  pass(tmp, out, h, w, (x, y) => y * w + x);
  return out;
}

/** Keep only the largest 4-connected shape. */
export function largestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  const q = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let head = 0, tail = 0, size = 0;
    q[tail++] = s; label[s] = next;
    while (head < tail) {
      const i = q[head++]; size++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; q[tail++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; q[tail++] = i + 1; }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = next; q[tail++] = i - w; }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = next; q[tail++] = i + w; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const out = new Uint8Array(w * h);
  if (best) for (let i = 0; i < w * h; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/**
 * @param img {data,width,height}
 * @param opts.sensitivity 0..1 — higher picks up fainter lines
 * @returns {{mask:Uint8Array, paper:Float32Array}}
 */
export function findCharacter(img, { sensitivity = 0.5, paper } = {}) {
  const { width: w, height: h, data } = img;
  paper ??= paperMap(img);
  const thr = 14 + (1 - sensitivity) * 46;
  const ink = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const dark = paper[i] - lum;
    ink[i] = dark > thr || sat > 40 + thr ? 1 : 0;
  }
  const gap = Math.max(2, Math.round(Math.max(w, h) / 160));
  const grown = morph(ink, w, h, gap, true);

  // flood fill the outside from the border
  const outside = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = i => { if (!grown[i] && !outside[i]) { outside[i] = 1; q[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const i = q[head++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = outside[i] ? 0 : 1;
  filled = morph(filled, w, h, gap, false);
  return { mask: largestComponent(filled, w, h), paper };
}

/** Combine the automatic mask with the user's brush strokes. */
export function applyEdits(auto, add, erase) {
  const out = new Uint8Array(auto.length);
  for (let i = 0; i < auto.length; i++) out[i] = (auto[i] || add[i]) && !erase[i] ? 1 : 0;
  return out;
}

export function bbox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Cut the character out: crop to its box (plus padding), evens out the lighting so the paper
 * inside the character looks clean white, and sets transparency from the mask (soft 1px edge).
 * @returns {{data:Uint8ClampedArray,width,height, offset:{x,y}}}
 */
export function cutOut(img, mask, paper, pad = 6) {
  const { width: w, height: h, data } = img;
  const bb = bbox(mask, w, h);
  if (!bb) return null;
  const ox = Math.max(0, bb.x - pad), oy = Math.max(0, bb.y - pad);
  const cw = Math.min(w, bb.x + bb.w + pad) - ox, ch = Math.min(h, bb.y + bb.h + pad) - oy;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = x + ox, sy = y + oy, si = sy * w + sx, s4 = si * 4, d4 = (y * cw + x) * 4;
      if (!mask[si]) continue;
      const k = 248 / paper[si];
      out[d4] = data[s4] * k; out[d4 + 1] = data[s4 + 1] * k; out[d4 + 2] = data[s4 + 2] * k;
      let edge = 0;
      if (sx > 0 && !mask[si - 1]) edge++;
      if (sx < w - 1 && !mask[si + 1]) edge++;
      if (sy > 0 && !mask[si - w]) edge++;
      if (sy < h - 1 && !mask[si + w]) edge++;
      out[d4 + 3] = edge ? 170 : 255;
    }
  }
  return { data: out, width: cw, height: ch, offset: { x: ox, y: oy } };
}

/** Mask from an image's transparency (used when reopening a saved character). */
export function maskFromAlpha(img) {
  const n = img.width * img.height, m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = img.data[i * 4 + 3] >= 128 ? 1 : 0;
  return m;
}
