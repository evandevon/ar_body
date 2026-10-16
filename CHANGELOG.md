# Changelog

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
