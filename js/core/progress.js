// A small loading card with a progress bar and percentage, shared by every page.
// Shows nothing for quick jobs (under ~300 ms), so fast devices don't flicker.

const MB = n => (n / 1e6).toFixed(n >= 1e7 ? 0 : 1);

// all cards share one column, so two loads at once stack instead of overlapping
function stack() {
  let st = document.querySelector('.loadstack');
  if (!st) { st = document.createElement('div'); st.className = 'loadstack'; document.body.append(st); }
  return st;
}

export function createProgress({ parent, delay = 300 } = {}) {
  parent ??= stack();
  const el = document.createElement('div');
  el.className = 'loadcard';
  el.hidden = true;
  el.innerHTML = `
    <div class="loadcard-row"><span class="loadcard-label"></span><span class="loadcard-pct"></span></div>
    <div class="loadcard-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    <div class="loadcard-sub"></div>`;
  parent.append(el);
  const label = el.querySelector('.loadcard-label'), pct = el.querySelector('.loadcard-pct');
  const bar = el.querySelector('.loadcard-bar'), fill = bar.querySelector('span'), sub = el.querySelector('.loadcard-sub');
  let timer = 0, active = false;

  return {
    /** fraction 0..1, or null for "working…" with no percentage */
    set(text, fraction = null, detail = '') {
      if (!active) { active = true; clearTimeout(timer); timer = setTimeout(() => { if (active) el.hidden = false; }, delay); }
      label.textContent = text;
      bar.setAttribute('aria-label', text);
      const indeterminate = fraction == null;
      el.classList.toggle('indeterminate', indeterminate);
      if (indeterminate) { pct.textContent = ''; bar.removeAttribute('aria-valuenow'); fill.style.width = ''; }
      else {
        const p = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
        pct.textContent = `${p}%`;
        bar.setAttribute('aria-valuenow', String(p));
        fill.style.width = `${p}%`;
      }
      sub.textContent = detail;
    },
    /** convenience for byte downloads */
    bytes(text, loaded, total) {
      this.set(text, total ? loaded / total : null, total ? `${MB(loaded)} of ${MB(total)} MB` : `${MB(loaded)} MB`);
    },
    done() { active = false; clearTimeout(timer); el.hidden = true; },
    get visible() { return !el.hidden; },
  };
}

/** Lets the browser draw the progress card before starting heavy work. */
export const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
