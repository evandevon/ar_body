// Loads Google's MediaPipe body tracker. Loaded only when needed, and from a second source if
// the first is blocked, so a blocked network can't stop the camera from working.

const VERSION = '1.1.1';
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`,
  `https://unpkg.com/@mediapipe/tasks-vision@${VERSION}`,
];
const MODEL_URL = name =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/latest/pose_landmarker_${name}.task`;

let lib; // { FilesetResolver, PoseLandmarker, vision }

async function loadLibrary() {
  if (lib) return lib;
  let lastErr;
  for (const base of SOURCES) {
    try {
      const m = await import(`${base}/vision_bundle.mjs`);
      const vision = await m.FilesetResolver.forVisionTasks(`${base}/wasm`);
      lib = { ...m, vision };
      return lib;
    } catch (e) { lastErr = e; console.warn('Tracker source failed:', base, e); }
  }
  throw Object.assign(new Error('blocked'), { code: 'library', cause: lastErr });
}

/** Lines between body points, for drawing a skeleton (empty until the tracker has loaded). */
export const poseConnections = () => lib?.PoseLandmarker.POSE_CONNECTIONS ?? [];

export async function createPoseTracker({ model = 'lite', numPoses = 1 } = {}) {
  const { PoseLandmarker, vision } = await loadLibrary();
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODEL_URL(model), delegate },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    try { return await PoseLandmarker.createFromOptions(vision, opts('GPU')); }
    catch (e) { console.warn('GPU unavailable, using CPU', e); return await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
  } catch (e) {
    throw Object.assign(new Error('model'), { code: 'model', cause: e });
  }
}

export function trackerErrorMessage(e) {
  if (e?.code === 'library') return 'Body tracking couldn’t load — this network may block cdn.jsdelivr.net and unpkg.com. The camera still works; ask IT to allow one of them.';
  if (e?.code === 'model') return 'Body tracking couldn’t download its model — this network may block storage.googleapis.com. The camera still works.';
  return 'Body tracking couldn’t start on this device.';
}
