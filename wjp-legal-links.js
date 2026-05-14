/* wjp-legal-links.js v1 — point footer legal links at the published HTML pages.
 *
 * The host app.js binds #btn-footer-terms and #btn-footer-data to placeholder
 * drawers with stale copy. This overlay re-binds them (capture phase, so it runs
 * before app.js's bubble-phase handler and stops it) to open the real, current
 * terms.html / privacy.html. The auth-screen footer link is patched in index.html.
 */
(function () {
  'use strict';
  if (window._wjpLegalLinksInstalled) return;
  window._wjpLegalLinksInstalled = true;

  var MAP = {
    'btn-footer-terms':   '/terms.html',
    'btn-footer-privacy': '/privacy.html',
    'btn-footer-data':    '/privacy.html'
  };

  function bind() {
    Object.keys(MAP).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el._wjpLegalBound) return;
      el._wjpLegalBound = true;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation(); // beat app.js's drawer handler
        window.open(MAP[id], '_blank', 'noopener');
      }, true); // capture phase
      el.style.cursor = 'pointer';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(bind, 400); });
  } else {
    setTimeout(bind, 400);
  }
  setTimeout(bind, 1500); // retry — footer can render late
})();
