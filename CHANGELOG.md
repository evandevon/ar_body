# Changelog

## v17
- No changes to how anything works. Added header comments to the main scripts and stylesheets, for developers.

## v16
- **Palm estimate.** Each hand's direction comes from the wrist and knuckles, plus a guess at whether the palm or the back of the hand faces the camera. The guess comes from which side the index knuckle is on.
- New ready-made poses: **Palms out (push)** and **Stop hand (one palm out)**.
- Captured poses now include hand direction and, when it's clear, which way the palms face, so "palms out" and "backs of hands out" count as different poses. Triggers captured before v16 still work.
- Skeleton view labels each hand *palm*, *back* or *?*, with how sure the guess is.
- Hand pictures turn with the hand (wrist to knuckles) rather than with the forearm, when the knuckles are clear.

## v15
- AR drawing animation: the **Take a photo** button is gone. Drawings now come from **Choose a picture**, *Try the example*, or a new **web address** box. A drawing opened from a web address is saved in the page's link (`animate.html#drawing=…`), so sharing the link shares the drawing.

## v14
- AR drawing animation, **fixed: see-through recordings could stop after the first second or so.** On larger videos, the page's own recorder (new in v13) could stall and quietly stop taking frames, so the saved WebM, GIF and MP4 were much shorter than the performance. It now skips the odd frame when the computer is busy, instead of stopping. Tested with a 20-second, 1280×720 recording: the full 20 seconds were saved.
- **Fixed: green-screen MP4s from see-through recordings could lose their ending.** On a slower computer the pictures fell behind the sound, and the end was cut off. The conversion now waits for the pictures to catch up, and nothing gets cut off.
- Saved WebMs now report their full length even when the sound runs slightly past the last picture.

## v13
- AR Body Tracker: **Pose triggers**. Show a picture, GIF or video when someone strikes a pose. There are 11 ready-made poses, or capture your own. Each trigger has a *close enough* level (default 70%), a live match bar, a hold time, where the effect appears, its size, and how long it shows. Triggers are saved in links and packs.
- New sticking point **Between hands**, and new effects **Energy ball** and **Star burst** (`assets/effects/`).
- New **Energy poses** pack.
- AR drawing animation: **see-through recording rebuilt**. The page now records the transparency layer itself instead of relying on the computer's video recorder, which was silently dropping it. GIFs and green-screen MP4s are made from that layer directly. If the browser's own recorder has to be used, the page checks the file and warns you when the transparency is missing.

## v12
- AR drawing animation: **WebM / MP4 / GIF is now chosen in the save window**, after recording, and one recording can be saved in several formats (GIF and MP4 are converted from it).
- Laptops and desktops download straight away; the share popup is only used on phones and tablets.

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
