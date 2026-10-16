// Loads Google's MediaPipe body tracker, only when needed, and reports download progress.
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

// Real (uncompressed) sizes, so progress is right even when a server sends the files compressed.
const KNOWN_SIZE = {
  'vision_wasm_internal.wasm': 13519922,
  'vision_wasm_nosimd_internal.wasm': 12627509,
  lite: 5.8e6, full: 9.4e6, heavy: 29.2e6, // model estimates until the server says
};

let lib;          // { FilesetResolver, PoseLandmarker, fileset }
let libLoading;   // promise while the library downloads
const models = {}; // name -> Uint8Array once downloaded
export const trackerSource = { library: '', model: '' };

/**
 * Downloads a file, calling onBytes(loaded, total) as it arrives.
 * Uses the browser cache, so a second visit is near-instant.
 */
async function fetchWithProgress(url, expected, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  if ((r.headers.get('content-type') || '').includes('text/html')) throw new Error(`not a file: ${url}`);
  const header = +r.headers.get('content-length') || 0;
  // a compressed download reports its compressed size; prefer the known real size
  let total = r.headers.get('content-encoding') ? expected || 0 : header || expected || 0;
  if (!r.body?.getReader) { const b = new Uint8Array(await r.arrayBuffer()); onBytes(Math.max(b.length, 1), Math.max(b.length, 1)); return b; }
  const reader = r.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded > total) total = loaded * 1.05;
    onBytes(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  onBytes(Math.max(loaded, 1), Math.max(loaded, 1));
  return out;
}

/** Combines several downloads into one percentage. */
function progressTracker(onProgress) {
  const parts = {};
  let stage = 'download';
  const emit = () => {
    if (!onProgress) return;
    let loaded = 0, total = 0;
    for (const p of Object.values(parts)) { loaded += p.loaded; total += p.total; }
    onProgress({ stage, loaded, total, fraction: total ? Math.min(1, loaded / total) : 0 });
  };
  return {
    part(name, expected) {
      parts[name] = { loaded: 0, total: expected || 0 };
      emit();
      return (loaded, total) => { parts[name] = { loaded, total: total || parts[name].total }; emit(); };
    },
    finishPart(name) { if (parts[name]) { parts[name].loaded = parts[name].total = parts[name].total || 1; emit(); } },
    stage(s) { stage = s; emit(); },
  };
}

async function loadLibrary(prog) {
  if (lib) return lib;
  libLoading ??= (async () => {
    let lastErr;
    for (const src of SOURCES) {
      try {
        const m = await import(`${src.base}/vision_bundle.mjs`);
        const fileset = await m.FilesetResolver.forVisionTasks(`${src.base}/wasm`);
        // download the engine ourselves (to show progress), then hand it over from memory
        const file = fileset.wasmBinaryPath.split('/').pop();
        const bytes = await fetchWithProgress(fileset.wasmBinaryPath, KNOWN_SIZE[file], prog.part('engine', KNOWN_SIZE[file]));
        fileset.wasmBinaryPath = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
        lib = { ...m, fileset };
        trackerSource.library = src.name;
        return lib;
      } catch (e) { lastErr = e; console.warn('Tracker source failed:', src.name, e); }
    }
    libLoading = null;
    throw Object.assign(new Error('blocked'), { code: 'library', cause: lastErr });
  })();
  return libLoading;
}

async function loadModel(name, prog) {
  if (models[name]) { prog.finishPart('model'); return models[name]; }
  const onBytes = prog.part('model', KNOWN_SIZE[name]);
  try {
    models[name] = await fetchWithProgress(LOCAL_MODEL(name), KNOWN_SIZE[name], onBytes);
    trackerSource.model = 'this site';
  } catch {
    try {
      models[name] = await fetchWithProgress(GOOGLE_MODEL(name), KNOWN_SIZE[name], onBytes);
      trackerSource.model = 'storage.googleapis.com';
    } catch (e) {
      trackerSource.model = 'storage.googleapis.com';
      throw Object.assign(new Error('model'), { code: 'model', cause: e });
    }
  }
  return models[name];
}

/** Lines between body points, for drawing a skeleton (empty until the tracker has loaded). */
export const poseConnections = () => lib?.PoseLandmarker.POSE_CONNECTIONS ?? [];

/**
 * @param onProgress ({stage:'download'|'starting', fraction, loaded, total}) => void
 */
export async function createPoseTracker({ model = 'lite', numPoses = 1, onProgress } = {}) {
  const prog = progressTracker(onProgress);
  // engine and model download at the same time
  const [{ PoseLandmarker, fileset }, buffer] = await Promise.all([loadLibrary(prog), loadModel(model, prog)]);
  prog.stage('starting');
  const opts = delegate => ({
    baseOptions: { modelAssetBuffer: buffer, delegate },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    let t;
    try { t = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { console.warn('GPU unavailable, using CPU', e); t = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    console.info(`Body tracker loaded — library from ${trackerSource.library}, model from ${trackerSource.model}`);
    return t;
  } catch (e) {
    throw Object.assign(new Error('start'), { code: 'start', cause: e });
  }
}

export function trackerErrorMessage(e) {
  if (e?.code === 'library') return 'Body tracking couldn’t load. Check the vendor/mediapipe folder was uploaded to the website. The camera still works.';
  if (e?.code === 'model') return 'Body tracking couldn’t get its model. Add the model file to the website’s models/ folder (see models/README.md) — this network may block storage.googleapis.com. The camera still works.';
  return 'Body tracking couldn’t start on this device. The camera still works.';
}
