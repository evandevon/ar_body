# MediaPipe Tasks Vision (bundled copy)

Unmodified files from the npm package [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) version **1.1.1**, by Google / The MediaPipe Authors.

- `vision_bundle.mjs` — the library
- `wasm/` — the WebAssembly engine (`vision_wasm_internal.*` for current browsers, `vision_wasm_nosimd_internal.*` for older devices)

Licensed under the Apache License, Version 2.0 — see `LICENSE.txt`. These files have not been changed. AR Body loads them from here first, and from cdn.jsdelivr.net / unpkg.com only if they are missing.

The body model files go in the site's `models/` folder (see `models/README.md`); they are also Apache-2.0 (see Google's *Model Card BlazePose GHUM 3D*).
