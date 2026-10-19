// Background GIF maker (runs as a module worker, so recording doesn't stutter).
// Frames are encoded as they arrive, so long recordings don't pile up in memory.
//
// Transparent-GIF details handled here (the usual sources of bugs):
//  • GIF pixels are either fully see-through or solid: anything under half-transparent becomes
//    see-through, the rest keeps its own (un-darkened) colour — no dark fringes.
//  • The see-through colour gets its OWN palette slot. Using a "key colour" instead would also
//    erase any matching colour in the drawing.
//  • Each frame clears itself before the next ("dispose: restore to background"), otherwise old
//    frames show through the see-through parts (ghosting/smearing).
//  • Frame times are kept to GIF's 1/100 s steps without drifting, and never below 2/100 s
//    (browsers slow shorter frames right down).
//  • The palette is made from the solid pixels only, so empty background doesn't waste colours.
import { GIFEncoder, quantize, applyPalette } from '../../vendor/gifenc/gifenc.esm.js?v=21776124';

let gif, W, H, transparent, done = 0, total = 0, timeMs = 0, sentCs = 0;

function encode({ data, delay }) {
  const px = new Uint8Array(data);
  const n = W * H;
  // keep frame timing exact over the whole GIF (GIF stores 1/100 s)
  timeMs += delay;
  let cs = Math.round(timeMs / 10) - sentCs;
  if (cs < 2) cs = 2;
  sentCs += cs;

  let palette, index;
  if (transparent) {
    let solid = 0;
    for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= 128) solid++;
    const opaque = new Uint8Array(Math.max(1, solid) * 4);
    for (let i = 0, o = 0; i < n; i++) if (px[i * 4 + 3] >= 128) { opaque[o++] = px[i * 4]; opaque[o++] = px[i * 4 + 1]; opaque[o++] = px[i * 4 + 2]; opaque[o++] = 255; }
    palette = quantize(opaque, 255, { format: 'rgb565' });
    // solid colours for every pixel (alpha ignored), then mark the see-through ones
    const rgb = px.slice();
    for (let i = 0; i < n; i++) rgb[i * 4 + 3] = 255;
    index = applyPalette(rgb, palette, 'rgb565');
    const clear = palette.length;
    palette.push([0, 0, 0]);
    for (let i = 0; i < n; i++) if (px[i * 4 + 3] < 128) index[i] = clear;
    gif.writeFrame(index, W, H, { palette, delay: cs * 10, transparent: true, transparentIndex: clear, dispose: 2, repeat: 0 });
  } else {
    palette = quantize(px, 256, { format: 'rgb565' });
    index = applyPalette(px, palette, 'rgb565');
    gif.writeFrame(index, W, H, { palette, delay: cs * 10, repeat: 0 });
  }
  done++;
}

const queue = [];
let busy = false, finishing = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    encode(queue.shift());
    if (finishing) postMessage({ type: 'progress', done, total });
    await new Promise(r => setTimeout(r, 0)); // let newly recorded frames arrive
  }
  busy = false;
  if (finishing) {
    gif.finish();
    const bytes = gif.bytes();
    postMessage({ type: 'done', bytes }, [bytes.buffer]);
    finishing = false;
  }
}

onmessage = ({ data: m }) => {
  if (m.type === 'start') {
    gif = GIFEncoder(); W = m.width; H = m.height; transparent = !!m.transparent;
    done = total = timeMs = sentCs = 0; queue.length = 0; finishing = false;
  } else if (m.type === 'frame') {
    total++;
    queue.push(m);
    pump();
  } else if (m.type === 'finish') {
    finishing = true;
    postMessage({ type: 'progress', done, total });
    pump();
  }
};
