# Packs

A pack is a ready-made set of overlays for AR Body Tracker, opened with a short link such as

    https://<your-name>.github.io/<repo>/tracker.html#pack=skeleton

Short links make simple QR codes that scan easily from across a room.

**Make a pack:** set up the overlays in AR Body Tracker, choose **Save as pack file**, and put the downloaded file in this folder (e.g. `packs/my-heart.json`). Add it to `index.json` so it appears in the Packs list:

    { "id": "my-heart", "name": "My heart lesson" }

The id is the file name without `.json` — letters, numbers and dashes only.

Picture addresses inside a pack can be full web addresses, or paths inside this website like `assets/bone.svg` (put your own pictures in `assets/`).

If someone changes a pack after opening it, the page switches to a full link that holds their changes; undoing the changes switches back to the short pack link.

Pose triggers go in the pack too (`"t"`, poses only). An overlay that shows on a pose has `"w"` = the trigger's number in that list (1 = first), plus `"wm": 1` to show while the pose is held, or `"d"` = seconds. See `energy-poses.json`.
