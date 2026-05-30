/* wjp-credit-loading-indicator.js v1 — Show a tasteful loading spinner while
 * the Credit Health page builds its content on first navigation.
 *
 * Winston 2026-05-29: "credit health tab takes long to load"
 *
 * Why: the Credit Health page (#page-credit-wjp) is built by a stack of
 * heavy modules (WJP_CreditOverhaul, WJP_CreditHero, WJP_CreditActions,
 * WJP_CreditSimulator, WJP_CreditHistoryChart, etc.) that all execute on
 * first show. There's no skeleton state, so the user clicks the tab and
 * stares at empty space for 1-2 seconds while the modules build the DOM.
 *
 * What this does:
 *   - On any nav-click to `data-page="credit-wjp"` (or hashchange to
 *     #credit-wjp), immediately overlay a centered spinner inside
 *     #page-credit-wjp.
 *   - Hide the spinner as soon as the page has rendered "real" content
 *     (any descendant card / section that wasn't there before).
 *   - Belt-and-suspenders: 2.5s timeout auto-hides the spinner so we never
 *     trap the user behind it.
 *
 * Safe: IIFE, idempotent install, pure DOM overlay (no app state). Works
 * for every user.
 */
(function () {
  'use strict';
  if (window._wjpCreditLoadingIndicatorInstalled) return;
  window._wjpCreditLoadingIndicatorInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var OVERLAY_ID = 'wjp-credit-loading-overlay';

  function injectStyle() {
    if (document.getElementById('wjp-credit-loading-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-credit-loading-style';
    st.textContent = [
      '#' + OVERLAY_ID + ' { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: rgba(255,255,255,0.85); backdrop-filter: blur(6px); z-index: 50; transition: opacity .25s ease; }',
      'body.dark #' + OVERLAY_ID + ' { background: rgba(13,22,32,0.82); }',
      '#' + OVERLAY_ID + '.is-hiding { opacity: 0; pointer-events: none; }',
      '#' + OVERLAY_ID + ' .wjp-cl-spinner { width: 42px; height: 42px; border: 3px solid rgba(31,122,74,0.18); border-top-color: #1f7a4a; border-radius: 50%; animation: wjpClSpin .9s linear infinite; }',
      'body.dark #' + OVERLAY_ID + ' .wjp-cl-spinner { border-color: rgba(127,209,164,0.22); border-top-color: #7fd1a4; }',
      '@keyframes wjpClSpin { to { transform: rotate(360deg); } }',
      '#' + OVERLAY_ID + ' .wjp-cl-label { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #1f7a4a; }',
      'body.dark #' + OVERLAY_ID + ' .wjp-cl-label { color: #7fd1a4; }',
      // Make sure the credit page is a positioning context so the overlay
      // can absolute-position to fill it
      '#page-credit-wjp { position: relative; min-height: 200px; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function show() {
    var page = document.getElementById('page-credit-wjp');
    if (!page) return;
    if (document.getElementById(OVERLAY_ID)) return;
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML =
      '<div class="wjp-cl-spinner"></div>' +
      '<div class="wjp-cl-label">Loading Credit Health…</div>';
    page.appendChild(overlay);
    // Belt-and-suspenders: never trap the user behind the overlay
    setTimeout(function () { hide('timeout'); }, 2500);
    // Watch for first child added to page (other than our overlay) → hide
    try {
      var mo = new MutationObserver(function (mutations) {
        var hasNew = mutations.some(function (m) {
          return m.type === 'childList' && Array.from(m.addedNodes).some(function (n) {
            return n && n.nodeType === 1 && n.id !== OVERLAY_ID;
          });
        });
        if (hasNew) { hide('content-added'); try { mo.disconnect(); } catch (_) {} }
      });
      mo.observe(page, { childList: true });
    } catch (_) {}
  }

  function hide(reason) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.classList.add('is-hiding');
    setTimeout(function () { try { overlay.remove(); } catch (_) {} }, 280);
  }

  function shouldShow() {
    // Show only when target is credit-wjp AND we're navigating fresh to it
    var page = document.getElementById('page-credit-wjp');
    if (!page) return false;
    // If page already has substantive content, no need to show loader
    if (page.children.length > 1) return false;
    return true;
  }

  function boot() {
    injectStyle();
    document.addEventListener('click', function (e) {
      var target = e.target && e.target.closest && e.target.closest('.nav-item[data-page="credit-wjp"]');
      if (!target) return;
      if (shouldShow()) show();
    }, true);
    window.addEventListener('hashchange', function () {
      var h = (location.hash || '').replace(/^#/, '').toLowerCase();
      if (h === 'credit-wjp' && shouldShow()) show();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_CreditLoadingIndicator = { version: 1, show: show, hide: hide };
})();
