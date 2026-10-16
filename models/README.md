# Body tracking models

Put Google's pose model files here so the site doesn't need to reach storage.googleapis.com. Keep these exact file names:

| Accuracy setting | File name | Download | Size |
|---|---|---|---|
| Fast (used by Animate, and the default) | `pose_landmarker_lite.task` | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task | ~6 MB |
| Balanced | `pose_landmarker_full.task` | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task | ~9 MB |
| Most accurate | `pose_landmarker_heavy.task` | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task | ~30 MB |

Any file that's missing is downloaded from Google instead, so you only need the ones you use. GitHub's website upload accepts files up to 25 MB, so the "Most accurate" model needs GitHub Desktop or git — or just leave it out.

Licence: Apache License 2.0 (Google, *Model Card BlazePose GHUM 3D*). See `../vendor/mediapipe/LICENSE.txt`.
