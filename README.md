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
4. **Background** — pick a background (animated sunny day, night sky, under the sea, stage, **green screen**, **transparent**, a plain colour, your own picture, or the live camera), the camera to use, where the **camera in the corner** goes (or off), the video shape (wide / tall / square), the character's size, and whether it moves around when the performer does.
The numbered steps along the top are buttons: jump to any step once there's a drawing (anything in between is done automatically). Anything that takes time — downloading the body tracker, finding the character in a photo — shows a progress bar with a percentage.

5. **Perform** — a partner points the camera (the back camera on phones) at the performer. The drawing copies their movements: each bone of the drawing copies the *angle* of the performer's matching bone, so any drawing works whatever its proportions. Press record for a 3-2-1 countdown; afterwards **Save video** (on phones this opens the share sheet, so it can go to Photos).

The limb on the left of the camera picture moves the limb on the left of the drawing, so the character moves like the person looks on screen. Body parts the camera can't see (e.g. legs out of frame) relax back to the drawn pose.

**For video editing:** *Green screen* records the character on bright green — remove it with any editor's chroma-key effect. *Transparent* records a WebM video with a genuinely see-through background, in Chrome and Edge only (Safari and Firefox can't record transparency). Some editors don't read transparent WebM; if yours shows black behind the character, use Green screen. To convert a transparent WebM for Final Cut / Premiere / After Effects: `ffmpeg -c:v libvpx -i my-animation.webm -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le my-animation.mov`. Snapshots (◉) on Transparent save as see-through PNGs. Neither background draws the ground shadow, so keying is clean.

**Sound:** tick *Record sound from the microphone* in Background (or tap the microphone button while performing) to include sound in the video. It's off by default. The level bar shows the microphone is hearing you; pick a different microphone from the list if needed.

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

## If the camera doesn't appear

The camera starts on its own, even if body tracking can't load, and the page says what went wrong:

- **"opened as a file"** — open the page from its web address, not by double-clicking the file.
- **"Part of this page didn't load"** — refresh with Ctrl+Shift+R (Cmd+Shift+R on a Mac). If it keeps happening, a file is missing from the website: upload all the files from the latest update. The page version is shown on the home page and in the message.
- **"Camera permission is blocked"** — click the camera/lock icon in the address bar and allow the camera. On a Mac, also allow the browser in System Settings → Privacy & Security → Camera.
- **"The camera is busy"** / **"not sending a picture"** — another app (Teams, Zoom, Camera) is using it. Close it, or pick another camera.
- **"Body tracking couldn't …"** — see *Body tracking files* below.

The camera lists update by themselves when a webcam or document camera is plugged in or out.

## Body tracking files

Body tracking is Google's MediaPipe, released under the Apache License 2.0, which allows hosting it yourself:

- `vendor/mediapipe/` — the tracker library and engine (about 26 MB), bundled with the site, unmodified, with its licence.
- `models/` — the trained body model. Download the model file(s) into this folder — links and exact names are in `models/README.md`. "Fast" (`pose_landmarker_lite.task`) is the one most people need.

The site uses its own copies first, and only falls back to the internet (cdn.jsdelivr.net / unpkg.com for the library, storage.googleapis.com for the model) for anything missing. With both folders uploaded, the site needs nothing but your github.io address — handy on school networks.

The model card notes the tracker is designed for people within about 4 m of the camera, works best with one person, and does not do — and cannot be used for — identity recognition.

## Updates

Each update comes as a zip of **only the files that changed**, in the same folders. Upload its contents over the top of the repository (GitHub: *Add file → Upload files*, drag in the contents, commit). If an update deletes a file, its notes say which. `CHANGELOG.md` lists every version. Script and style links carry a fingerprint (`?v=…`) of their contents, so browsers never mix old and new files.

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
js/core/camera.js        shared camera, camera/mic lists, microphone
js/core/tracker.js       body tracker loader (with backup source)
js/core/failsafe.js      explains what's wrong if the page can't run
vendor/mediapipe/        bundled body-tracking library + engine (Apache-2.0)
models/                  body model files (you add these; see models/README.md)
CHANGELOG.md             what changed in each version
assets/                  sample stickers, skeleton pictures, example drawing — host your own here too
.nojekyll         tells GitHub Pages to serve files as-is
```
