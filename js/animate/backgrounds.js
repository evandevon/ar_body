// Built-in animated scenes, drawn with code so they need no files and look sharp at any size.
// Each draws the whole stage for time t (seconds).

const rand = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function sky(g, w, h, t) {
  const sk = g.createLinearGradient(0, 0, 0, h);
  sk.addColorStop(0, '#5ab6f5'); sk.addColorStop(0.75, '#bfe6ff');
  g.fillStyle = sk; g.fillRect(0, 0, w, h);
  const u = Math.min(w, h);
  g.fillStyle = '#ffe36b';
  g.beginPath(); g.arc(w * 0.85, h * 0.16, u * 0.08, 0, Math.PI * 2); g.fill();
  const r = rand(3);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const sp = 0.01 + r() * 0.02, y = h * (0.08 + r() * 0.35), s = u * (0.05 + r() * 0.05);
    const x = ((r() + t * sp) % 1.3) * (w + s * 6) - s * 3;
    for (const [dx, dy, k] of [[0, 0, 1], [s * 0.9, -s * 0.35, 0.85], [s * 1.8, 0, 0.9], [s * 0.9, s * 0.2, 1]]) {
      g.beginPath(); g.arc(x + dx, y + dy, s * k, 0, Math.PI * 2); g.fill();
    }
  }
  // hills + grass
  g.fillStyle = '#7bcf6b';
  g.beginPath(); g.moveTo(0, h * 0.8);
  g.quadraticCurveTo(w * 0.25, h * 0.66, w * 0.5, h * 0.78); g.quadraticCurveTo(w * 0.78, h * 0.68, w, h * 0.76);
  g.lineTo(w, h); g.lineTo(0, h); g.fill();
  g.fillStyle = '#5bb44d'; g.fillRect(0, h * 0.86, w, h * 0.14);
}

function night(g, w, h, t) {
  const sk = g.createLinearGradient(0, 0, 0, h);
  sk.addColorStop(0, '#0b1030'); sk.addColorStop(1, '#2b2a6b');
  g.fillStyle = sk; g.fillRect(0, 0, w, h);
  const r = rand(11), u = Math.min(w, h);
  for (let i = 0; i < 120; i++) {
    const x = r() * w, y = r() * h * 0.8, s = 0.6 + r() * 1.8, ph = r() * 6;
    g.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.5 + r()) + ph));
    g.fillStyle = '#fff'; g.fillRect(x, y, s * u / 500, s * u / 500);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#fff6d5';
  g.beginPath(); g.arc(w * 0.18, h * 0.2, u * 0.07, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b1030';
  g.beginPath(); g.arc(w * 0.18 + u * 0.03, h * 0.2 - u * 0.015, u * 0.06, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#161a3d'; g.fillRect(0, h * 0.86, w, h * 0.14);
}

function sea(g, w, h, t) {
  const sk = g.createLinearGradient(0, 0, 0, h);
  sk.addColorStop(0, '#1fa3c9'); sk.addColorStop(1, '#0b3d6b');
  g.fillStyle = sk; g.fillRect(0, 0, w, h);
  const u = Math.min(w, h);
  // light rays
  g.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < 5; i++) {
    const x = w * (0.1 + i * 0.2) + Math.sin(t * 0.4 + i) * w * 0.03;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w * 0.08, 0); g.lineTo(x + w * 0.2, h); g.lineTo(x + w * 0.05, h); g.fill();
  }
  const r = rand(5);
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = Math.max(1, u / 300);
  for (let i = 0; i < 26; i++) {
    const x0 = r() * w, sp = 0.05 + r() * 0.08, s = u * (0.006 + r() * 0.014);
    const y = h - ((r() + t * sp) % 1) * h * 1.1;
    const x = x0 + Math.sin(t * 2 + i) * u * 0.01;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.stroke();
  }
  // seaweed
  g.strokeStyle = '#2f9e5b'; g.lineWidth = u * 0.018; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const bx = w * (0.05 + i * 0.18), len = h * (0.18 + (i % 3) * 0.06);
    g.beginPath(); g.moveTo(bx, h * 0.9);
    for (let k = 1; k <= 6; k++) g.lineTo(bx + Math.sin(t * 1.2 + k * 0.8 + i) * u * 0.02 * k / 3, h * 0.9 - (len * k) / 6);
    g.stroke();
  }
  g.fillStyle = '#e8d29a'; g.fillRect(0, h * 0.88, w, h * 0.12);
}

function stage(g, w, h, t) {
  g.fillStyle = '#1a0d14'; g.fillRect(0, 0, w, h);
  const sp = g.createRadialGradient(w / 2, h * 0.7, 10, w / 2, h * 0.7, Math.max(w, h) * 0.55);
  sp.addColorStop(0, 'rgba(255,240,200,.55)'); sp.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = sp; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5a2d1a'; g.fillRect(0, h * 0.86, w, h * 0.14);
  g.fillStyle = '#7a3e22'; g.fillRect(0, h * 0.86, w, h * 0.012);
  // curtains
  const cw = w * 0.14;
  for (const side of [0, 1]) {
    const x0 = side ? w - cw : 0;
    const cg = g.createLinearGradient(x0, 0, x0 + cw, 0);
    for (let k = 0; k <= 6; k++) cg.addColorStop(k / 6, k % 2 ? '#8e1020' : '#c21d33');
    g.fillStyle = cg;
    g.beginPath();
    if (!side) { g.moveTo(0, 0); g.lineTo(cw, 0); g.quadraticCurveTo(cw * 0.6, h * 0.5, cw * (0.8 + Math.sin(t) * 0.03), h); g.lineTo(0, h); }
    else { g.moveTo(w, 0); g.lineTo(w - cw, 0); g.quadraticCurveTo(w - cw * 0.6, h * 0.5, w - cw * (0.8 + Math.sin(t + 1) * 0.03), h); g.lineTo(w, h); }
    g.fill();
  }
  g.fillStyle = '#a3172a'; g.fillRect(0, 0, w, h * 0.07);
}

export const SCENES = [
  { id: 'sky', label: 'Sunny day', draw: sky },
  { id: 'night', label: 'Night sky', draw: night },
  { id: 'sea', label: 'Under the sea', draw: sea },
  { id: 'stage', label: 'Stage', draw: stage },
  { id: 'colour', label: 'Plain colour' },
  { id: 'picture', label: 'My picture' },
  { id: 'camera', label: 'Camera' },
];

/** Draws an image/video to fill the stage, cropping the overflow (like CSS "cover"). */
export function drawCover(g, src, sw, sh, w, h, mirror = false) {
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh), dw = sw * s, dh = sh * s;
  g.save();
  if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  g.restore();
}
