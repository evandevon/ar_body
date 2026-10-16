# AR Body

Camera tools that track a person's body, for the classroom. No server, no build step, no accounts — everything runs in the browser using Google's MediaPipe pose tracker, so it can be hosted free on GitHub Pages.

The home page links to:

- **Animate my drawing** (`animate.html`) — photograph a drawn character; the camera copies a real person's movements onto it; record a video.
- **AR Overlays** (`overlays.html`) — stick pictures and videos to a head, hands, bones and body; share a setup as a link.
- **Body Explorer** — coming soon.

Nothing from the camera leaves the device. Snapshots and recordings are saved straight to the device.

## Put it on GitHub Pages

1. Create a new repository on GitHub (e.g. `ar-body`), public.
2. Upload everything in this folder to it (**Add file → Upload files**, drag the contents in, commit). Keep the folder structure: `index.html` must be at the top level.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/ar-body/`.

The camera needs `https://`, which GitHub Pages provides.

## Animate my drawing

1. **Drawing** — take a photo of a drawing (or choose one, or *Try the example*). Best results: one character on plain white paper, thick dark lines, standing like a star with arms and legs apart and not touching the body.
2. **Cut out** — the page removes the paper and evens out the lighting. White paper *inside* the outline stays part of the character. Paint with **Add / Erase** to fix mistakes; **Faint lines** picks up lighter pencil.
3. **Joints** — drag the dots onto the head, neck, shoulders, elbows, hands, hips, knees and feet. Blue dots are limbs on the left of the picture, orange on the right. (Keyboard: Tab to the picture, `[` `]` choose a dot, arrows move it.)
4. **Scene** — pick a background (animated sunny day, night sky, under the sea, stage, a plain colour, your own picture, or the live camera), where the **camera in the corner** goes (or off), the video shape (wide / tall / square), the character's size, and whether it moves around when the performer does.
5. **Perform** — a partner points the camera (the back camera on phones) at the performer. The drawing copies their movements: each bone of the drawing copies the *angle* of the performer's matching bone, so any drawing works whatever its proportions. Press record for a 3-2-1 countdown; afterwards **Save video** (on phones this opens the share sheet, so it can go to Photos).

The limb on the left of the camera picture moves the limb on the left of the drawing, so the character moves like the person looks on screen. Body parts the camera can't see (e.g. legs out of frame) relax back to the drawn pose.

Characters are kept on that device (browser storage) and appear under **Your characters** next time. They are not uploaded or put in a link. Recordings can leave out the camera picture entirely (camera corner **Off**), so students can share work without appearing in it.

## AR Overlays

- **Start camera**, then step back so the tracker can see the body. Sticking points the camera can't see fade out.
- **Add pictures and videos by web address.** The address must go straight to the file (ending in `.png`, `.gif`, `.svg`, `.mp4`, `.webm`…). You can also drag a picture in from another browser tab, or paste an address anywhere on the page.
- Each overlay card sets what it **sticks to**, its size, position, turn, see-through level, and whether it **tilts with the body**. Double-click a slider to reset it.
- **Bones** (upper arms, forearms, thighs, shins and spine) stretch a picture from one joint to the next, so it turns and lengthens with the limb. The top of the picture sits at the joint nearer the body (shoulder, elbow, hip, knee, neck), so draw bone pictures standing upright, cropped close. **Size** is then the length: 100% = joint to joint.
- **Examples** loads a ready-made layout: *Crown & sparkles*, or a full *Skeleton* (skull, ribs, spine, pelvis and all eight limb bones).
- **Remove green screen** keys out green backgrounds — film something against a green sheet and it becomes a cut-out.
- **↑ / ↓** change which overlay is in front. **⧉** duplicates.
- **People** tracks up to 4 people; every overlay is applied to each person.

### Debugging

- **Skeleton** (toolbar button, the checkbox under Tracking, or press **S**) draws the tracked points and bones. Points the tracker is unsure about are drawn faded orange, each person is numbered, and the tracking speed (fps) shows in the corner.
- **Show sticking points** labels every anchor the overlays can attach to.

## Layouts live in the link

There's nothing to save or upload. The whole layout — every overlay's web address and settings, plus the number of people and accuracy setting — is compressed into the page's address after the `#`, and the address bar updates as you make changes.

- **Copy link to this layout** copies it. Bookmark it, or share it with students or colleagues.
- Opening the link rebuilds the layout exactly, on any device.
- A link with no layout (`https://<your-username>.github.io/ar-body/overlays.html`) opens with the example crown, sunglasses and sparkles. **Clear all** gives a link to an empty layout.
- Nothing about the camera is stored in the link.

### Where to host pictures and videos

Any web address works for showing an overlay. But some websites don't allow their files to be used by other sites, and for those the browser blocks **snapshots, recording and green screen** while that overlay is on screen (the page tells you which overlay). Hosts that do allow it:

- **Your own GitHub repo** — put files in the `assets` folder and use `https://<your-username>.github.io/ar-body/assets/<file>`. This is the most reliable option.
- Most image CDNs and GIF sites' direct file links.

Links to file *pages* (e.g. a Google Drive or Google Photos page) won't work — they're web pages, not the file itself.

## Testing on your own computer

Opening `index.html` by double-clicking won't work (browsers block the scripts from `file://`). Run a tiny local server in the folder instead:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Notes

- The tracker loads from `cdn.jsdelivr.net` and `storage.googleapis.com` the first time (a few MB). If a school network blocks those, the page will say it can't load the body tracker.
- **Accuracy**: *Fast* suits most laptops, tablets and phones; *Most accurate* needs a strong computer.

## Files

```
index.html               home page
animate.html             Animate my drawing
overlays.html            AR Overlays
css/                     styling
js/app.js, js/body.js    AR Overlays: camera, overlays, sticking points
js/animate/              Animate: cut-out, rig (mesh + bones), WebGL renderer, scenes, storage
js/core/tracker.js       shared camera + body tracker helpers
assets/                  sample stickers, skeleton pictures, example drawing — host your own here too
.nojekyll         tells GitHub Pages to serve files as-is
```
