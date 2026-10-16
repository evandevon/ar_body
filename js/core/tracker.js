// Loads Google's MediaPipe body tracker, only when needed.
// Tries this site's own copy first (vendor/ and models/ folders), then public servers, so it
// works on networks that block the internet sources and can't stop the camera from working.

const VERSION = '1.1.1';
const SOURCES = [
  { name: 'this site', base: new URL('../../vendor/mediapipe', import.meta.url).href },
  { name: 'cdn.jsdelivr.net', base: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}` },
  { name: 'unpkg.com', base: `https://unpkg.com/@mediapipe/tasks-vision@${VERSION}` },
];
const LOCAL_MODEL = name => new URL(`../../models/pose_landmarker_${name}.task`, import.meta.url).href;
const GOOGLE_MODEL = name =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/latest/pose_landmarker_${name}.task`;

let lib; // { FilesetResolver, PoseLandmarker, vision }
export const trackerSource = { library: '', model: '' };

async function loadLibrary() {
  if (lib) return lib;
  let lastErr;
  for (const src of SOURCES) {
    try {
      const m = await import(`${src.base}/vision_bundle.mjs`);
      const vision = await m.FilesetResolver.forVisionTasks(`${src.base}/wasm`);
      lib = { ...m, vision };
      trackerSource.library = src.name;
      return lib;
    } catch (e) { lastErr = e; console.warn('Tracker source failed:', src.name, e); }
  }
  throw Object.assign(new Error('blocked'), { code: 'library', cause: lastErr });
}

async function modelUrl(name) {
  const local = LOCAL_MODEL(name);
  try {
    const r = await fetch(local, { method: 'HEAD' });
    if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) { trackerSource.model = 'this site'; return local; }
  } catch {}
  trackerSource.model = 'storage.googleapis.com';
  return GOOGLE_MODEL(name);
}

/** Lines between body points, for drawing a skeleton (empty until the tracker has loaded). */
export const poseConnections = () => lib?.PoseLandmarker.POSE_CONNECTIONS ?? [];

export async function createPoseTracker({ model = 'lite', numPoses = 1 } = {}) {
  const { PoseLandmarker, vision } = await loadLibrary();
  const path = await modelUrl(model);
  const opts = delegate => ({
    baseOptions: { modelAssetPath: path, delegate },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    let t;
    try { t = await PoseLandmarker.createFromOptions(vision, opts('GPU')); }
    catch (e) { console.warn('GPU unavailable, using CPU', e); t = await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
    console.info(`Body tracker loaded — library from ${trackerSource.library}, model from ${trackerSource.model}`);
    return t;
  } catch (e) {
    throw Object.assign(new Error('model'), { code: 'model', cause: e });
  }
}

export function trackerErrorMessage(e) {
  if (e?.code === 'library') return 'Body tracking couldn’t load. Check the vendor/mediapipe folder was uploaded to the website. The camera still works.';
  if (e?.code === 'model') return `Body tracking couldn’t get its model${trackerSource.model === 'storage.googleapis.com' ? ' — this network may block storage.googleapis.com. Add the model file to the website’s models/ folder (see models/README.md)' : ''}. The camera still works.`;
  return 'Body tracking couldn’t start on this device.';
}
