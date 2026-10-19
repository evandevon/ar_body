# Changelog

## v11
- **Transparent WebM fixed for video editors**: recordings are now VP9 (not VP8), and rebuilt before saving with their total length, a seek index and the ALPHA_MODE tag — the same layout FFmpeg produces. (Applies to AR Body Tracker recordings too.)
- AR drawing animation: **Save as WebM, MP4 or GIF** (Background step). Transparent GIFs keep the see-through background; GIF size and smoothness options; up to 30 s.
- MP4 is only offered where the browser makes real H.264 MP4; a Transparent background is saved on green screen in MP4.

## v10
- New **Skeleton** pack: skull, neck, spine, ribs, collarbones, pelvis, humerus, radius & ulna, hand bones, femur, tibia & fibula, foot bones (18 layers; pictures in `assets/skeleton/`).
- New layer option **Match left & right**: one picture serves both sides, flipped automatically for the right-hand limb (and with the mirror switch).

## v9
- AR Body Tracker: removed the *Remove green screen* option from layers (old links that used it still open).

## v8
- AR Overlays and the planned Body Explorer are merged into **AR Body Tracker** (`tracker.html`). Old `overlays.html` links and QR codes still work.
- "Animate my drawing" is now **AR drawing animation**.
- **Packs**: layouts stored as files in `packs/`, opened with short links (`tracker.html#pack=skeleton`) that make simple QR codes. *Save as pack file…* creates one.
- **QR code** button for the current layout.
- Layers: an **eye** to show/hide each one (saved in the link); only one layer's settings open at a time; clicking the camera picture closes them; each layer shows what it's stuck to.
- Bones tilt in depth (squash along their length, keeping their width) when a limb points toward the camera, instead of shrinking.

## v7
- Progress bars with percentages for anything slow: downloading the body tracker (Animate starts it early, on the Background step), finding the character in a photo, preparing the character, animated GIFs and shared layouts in AR Overlays.
- Animate: the numbered steps at the top are now buttons — jump to any step once there's a drawing.
- Animate: "Scene" is now called "Background".
- Animate: the character's arms are drawn in front of the body and head.

## v6
- Body tracking is bundled with the site (`vendor/mediapipe/`, Apache-2.0) and model files can be added to `models/`, so it works without outside servers.
- Animate: **Take a photo** on a computer now opens a live webcam view (camera list, rotate for document cameras). Phones still use the phone's camera app.
- Pages say straight away if part of the page didn't load, instead of buttons silently doing nothing; the version shows on the home page.
- Script/style links carry content fingerprints so browsers can't mix old and new files.

## v5
- Camera starts even if body tracking can't load; clear messages for every camera problem; backup source for the tracker.
- Live-updating camera lists (both tools), microphone list.
- Animate: brush preview circle; Green screen and Transparent backgrounds; optional sound recording; record button no longer cut off.

## v4
- Home page; **Animate my drawing**; AR Overlays moved to `overlays.html`.

## v3
- Bone anchors (arms, legs, spine) and the Skeleton example.

## v2
- Layouts saved in the link; overlays from web addresses; skeleton debug toggle.

## v1
- First version: AR Overlays with body tracking.
