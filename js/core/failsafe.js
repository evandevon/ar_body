// Plain (non-module) script, loaded before the page's main script. If the page's scripts can't
// run — opened as a file, a file missing from the site, a network filter, an old browser —
// it says so straight away instead of leaving buttons that do nothing.
(function () {
  var shown = false;
  function show(msg, detail) {
    if (shown) return;
    shown = true;
    var put = function () {
      var d = document.createElement('div');
      d.id = 'failsafe';
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:99;max-width:min(92vw,600px);' +
        'background:#2a1416;color:#ffe3e3;border:1px solid #ff6b6b;border-radius:12px;padding:12px 16px;font:15px/1.45 system-ui,sans-serif;';
      d.textContent = msg;
      if (detail) {
        var s = document.createElement('div');
        s.style.cssText = 'margin-top:6px;font-size:12px;opacity:.75;word-break:break-word';
        s.textContent = detail;
        d.appendChild(s);
      }
      var v = document.querySelector('meta[name="version"]');
      if (v) { var t = document.createElement('div'); t.style.cssText = 'margin-top:4px;font-size:12px;opacity:.6'; t.textContent = 'Page version ' + v.content; d.appendChild(t); }
      document.body.appendChild(d);
    };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
  }
  window.__failsafe = show;

  if (location.protocol === 'file:') {
    show('This page was opened as a file, so the browser blocks its scripts and the camera. Open it from its web address instead (https://<your-name>.github.io/…), or run a local server — see README.');
    return;
  }
  var broken = 'Part of this page didn’t load, so some buttons won’t work. Refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). If it keeps happening, a file may be missing from the website — upload all the files from the latest update.';
  // a script or stylesheet that failed to download
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'SCRIPT' || el.tagName === 'LINK')) show(broken, 'Couldn’t load: ' + (el.src || el.href || '').replace(location.origin, ''));
    else if (!window.__appReady && e.message) show(broken, e.message);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (!window.__appReady) show(broken, String(e.reason && e.reason.message || e.reason));
  });
  // a module whose imports fail never fires a useful error; notice that it didn't finish starting
  window.addEventListener('load', function () {
    setTimeout(function () { if (!window.__appReady) show(broken); }, 2500);
  });
})();
