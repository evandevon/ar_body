// Shared camera + body tracker helpers.
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs';
export { PoseLandmarker };

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL_URL = name =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/latest/pose_landmarker_${name}.task`;

let vision;
export async function createPoseTracker({ model = 'lite', numPoses = 1 } = {}) {
  vision ??= await FilesetResolver.forVisionTasks(WASM_PATH);
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODEL_URL(model), delegate },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try { return await PoseLandmarker.createFromOptions(vision, opts('GPU')); }
  catch (e) { console.warn('GPU unavailable, using CPU', e); return PoseLandmarker.createFromOptions(vision, opts('CPU')); }
}

export const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

/** Starts a camera. facing: 'user' | 'environment'. Returns { stream, facing }. */
export async function openCamera(video, { facing = 'user', deviceId = '' } = {}) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { code: 'insecure' });
  const v = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = facing;
  const stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
  video.srcObject = stream;
  video.muted = true; video.playsInline = true;
  await video.play().catch(() => {});
  const s = stream.getVideoTracks()[0].getSettings();
  return { stream, facing: s.facingMode || facing };
}

export function cameraErrorMessage(e) {
  if (e.code === 'insecure') return 'The camera only works on https:// pages (like GitHub Pages) or localhost.';
  if (e.name === 'NotAllowedError') return 'Camera permission was blocked. Allow it in the browser settings and try again.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'No camera was found.';
  return `Camera error: ${e.message}`;
}
