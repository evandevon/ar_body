// Camera + microphone helpers shared by every page. No outside downloads, so the camera still
// works even if a school network blocks the body tracker's servers.

export const isPhone = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

export function cameraErrorMessage(e) {
  if (location.protocol === 'file:') return 'This page was opened as a file. Open it from its web address (https://…github.io/…) instead.';
  if (e?.code === 'insecure' || !window.isSecureContext) return 'The camera only works on https:// pages (like GitHub Pages) or localhost.';
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Camera permission is blocked. Click the camera or lock icon in the address bar, allow the camera, then try again. On a Mac, also check System Settings → Privacy & Security → Camera.';
    case 'NotReadableError': case 'AbortError':
      return 'The camera is busy or couldn’t start. Close other apps or tabs using it (Teams, Zoom, Camera) and try again.';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'No camera was found. Plug one in — it will appear in the camera list.';
    case 'OverconstrainedError':
      return 'That camera isn’t available any more. Choose another from the list.';
  }
  return `Camera error: ${e?.message || e}`;
}

export function micErrorMessage(e) {
  if (e?.name === 'NotAllowedError') return 'Microphone permission is blocked. Allow it in the address bar to record sound.';
  if (e?.name === 'NotFoundError') return 'No microphone was found.';
  return `Microphone error: ${e?.message || e}`;
}

/**
 * Starts a camera on a <video> element.
 * @param opts.deviceId  a specific camera (from the list), or '' to use opts.facing
 * @param opts.facing    'user' (front/selfie) | 'environment' (back)
 * @returns {{stream, deviceId, facing}}
 */
export async function openCamera(video, { deviceId = '', facing = 'user' } = {}) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { code: 'insecure' });
  const v = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = { ideal: facing };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); }
  catch (e) {
    // a remembered camera that's been unplugged: fall back to any camera
    if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    else throw e;
  }
  video.muted = true; video.playsInline = true; video.autoplay = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  const s = stream.getVideoTracks()[0]?.getSettings() ?? {};
  return { stream, deviceId: s.deviceId || deviceId, facing: s.facingMode || (deviceId ? '' : facing) };
}

export const stopStream = stream => stream?.getTracks().forEach(t => t.stop());

/** Resolves true once the video is actually showing pictures (false after `ms`). */
export function waitForFrames(video, ms = 4000) {
  return new Promise(resolve => {
    if (video.readyState >= 2 && video.videoWidth) return resolve(true);
    const t = setTimeout(() => { cleanup(); resolve(video.readyState >= 2 && !!video.videoWidth); }, ms);
    const ok = () => { if (video.videoWidth) { cleanup(); resolve(true); } };
    const cleanup = () => { clearTimeout(t); video.removeEventListener('loadeddata', ok); video.removeEventListener('resize', ok); };
    video.addEventListener('loadeddata', ok);
    video.addEventListener('resize', ok);
  });
}

/** Friendly name for a camera, when the browser doesn't give one. */
function cameraName(d, i) {
  if (d.label) return d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, ''); // drop USB ids
  return `Camera ${i + 1}`;
}

/**
 * Keeps one or more <select> elements filled with the current cameras (or microphones),
 * updating live when one is plugged in or unplugged.
 * @param kind 'videoinput' | 'audioinput'
 * @param getCurrent () => deviceId currently in use
 * @param onChange (deviceId) => void — called when the user picks one
 * @param onListChange (devices) => void — optional, e.g. to show/hide a flip button
 */
export function deviceList(selects, { kind = 'videoinput', getCurrent, onChange, onListChange, emptyLabel } = {}) {
  selects = [selects].flat().filter(Boolean);
  let last = '';
  async function refresh() {
    let devices = [];
    try { devices = (await navigator.mediaDevices?.enumerateDevices() ?? []).filter(d => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications'); }
    catch { /* not allowed yet */ }
    const current = getCurrent?.() || '';
    const key = JSON.stringify([devices.map(d => d.deviceId + d.label), current]);
    if (key !== last) {
      last = key;
      for (const sel of selects) {
        sel.innerHTML = '';
        if (!devices.length) sel.add(new Option(emptyLabel || (kind === 'videoinput' ? 'No camera found' : 'No microphone found'), ''));
        devices.forEach((d, i) => sel.add(new Option(cameraName(d, i).replace(/^Camera/, kind === 'audioinput' ? 'Microphone' : 'Camera'), d.deviceId || `#${i}`, false, d.deviceId === current)));
        sel.disabled = !devices.length;
        // before permission, ids are hidden: a single unnamed entry can't be chosen meaningfully
        if (devices.length && !devices[0].label) sel.title = 'Start the camera to see camera names';
      }
      onListChange?.(devices);
    }
    return devices;
  }
  for (const sel of selects) sel.addEventListener('change', () => { if (sel.value && !sel.value.startsWith('#')) onChange?.(sel.value); });
  navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
  // some browsers miss devicechange events; a cheap check every few seconds while visible
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  refresh();
  return { refresh, stop: () => { clearInterval(timer); navigator.mediaDevices?.removeEventListener?.('devicechange', refresh); } };
}

/** Opens a microphone. Returns the stream (audio only). */
export async function openMic(deviceId = '') {
  const a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) a.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio: a, video: false });
}

/** Small live level meter: calls draw(level 0..1) every frame until stopped. */
export function levelMeter(stream, draw) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return { stop() {} };
  const ac = new AC();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf = 0, alive = true;
  const tick = () => {
    if (!alive) return;
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    draw(Math.min(1, peak / 90));
    raf = requestAnimationFrame(tick);
  };
  ac.resume?.().catch(() => {});
  tick();
  return { stop() { alive = false; cancelAnimationFrame(raf); src.disconnect(); ac.close?.().catch(() => {}); } };
}
