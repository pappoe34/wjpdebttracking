/* wjp-dashboard-header-compact.js v2 — Compact the dashboard header so
 * more information fits above the fold on first open.
 *
 * Winston 2026-05-29: "on the dashboard screen, i dont think we are using
 *   space very efficiently. greetings and settings, should at the very top
 *   not using space. also customize layout and auto fit should be inside
 *   settings icon tucked in the right top corner."
 *
 * What this does:
 *   1. Builds a compact horizontal header at the top of #page-dashboard:
 *        [👋 Good evening, Winston.] ........... [⚙ gear]
 *   2. Hides the original tall greeting card (#dash-greeting) and the
 *      original Customize Layout bar (#dash-customize-bar).
 *   3. The gear button opens a small popover menu with:
 *        • Customize layout    → clicks the original #dash-customize-btn
 *        • Auto-fit (toggle)   → clicks the original #dash-autofit-toggle
 *        • Reset to default    → clicks the original #dash-customize-reset
 *        • Settings            → navigates to #settings
 *
 * The original elements stay in the DOM (just hidden) so the existing
 * handlers and behaviours keep working — we just route user input to them.
 *
 * Safe: IIFE, idempotent install, no appState writes. Pure DOM compaction.
 */
(function () {
  'use strict';
  if (window._wjpDashboardHeaderCompactInstalled) return;
  window._wjpDashboardHeaderCompactInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var HEADER_ID = 'wjp-compact-header';
  var MENU_ID   = 'wjp-compact-header-menu';

  function injectStyle() {
    if (document.getElementById('wjp-dashboard-header-compact-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-dashboard-header-compact-style';
    st.textContent = [
      // Hide the originals so the page reclaims their vertical space
      '#page-dashboard { padding-top: 0 !important; }',
      '#page-dashboard > #' + HEADER_ID + ' { margin-top: 0 !important; }',
      '#page-dashboard #dash-greeting { display: none !important; }',
      '#page-dashboard #dash-customize-bar { display: none !important; }',
      // FIX 79: when the user enters customize mode (body gets dash-customizing),
      // surface the original customize bar so the reorder list / reset / hidden-card chips
      // are usable. We just hide it again the moment they exit customize mode.
      'body.dash-customizing #page-dashboard #dash-customize-bar { display: flex !important; align-items: center; gap: 10px; padding: 10px 4px; margin: 8px 0 12px; flex-wrap: wrap; }',

      // Compact header bar
      '#' + HEADER_ID + ' { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 4px 0; margin: 0; min-height: 0; font-family: inherit; flex: 0 0 100%; width: 100%; box-sizing: border-box; line-height: 1.2; }',
      '#' + HEADER_ID + ' .wjp-ch-greeting { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 1.2; font-weight: 600; color: var(--ink, var(--text-1, #1f1a14)); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + HEADER_ID + ' .wjp-ch-greeting .wjp-ch-wave { font-size: 13px; line-height: 1; }',
      'body.dark #' + HEADER_ID + ' .wjp-ch-greeting { color: #f4f4f6; }',

      // Gear button
      '#' + HEADER_ID + ' .wjp-ch-gear { background: transparent; border: 0; color: var(--ink-dim, #6b7280); width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 15px; line-height: 1; transition: background .15s ease, color .15s ease; padding: 0; flex-shrink: 0; }',
      '#' + HEADER_ID + ' .wjp-ch-gear:hover { background: rgba(31,122,74,0.10); color: #1f7a4a; }',
      'body.dark #' + HEADER_ID + ' .wjp-ch-gear { color: rgba(255,255,255,0.62); }',
      'body.dark #' + HEADER_ID + ' .wjp-ch-gear:hover { background: rgba(127,209,164,0.10); }',

      // Popover menu
      '#' + MENU_ID + ' { position: absolute; z-index: 99998; background: var(--card-bg, #fff); color: var(--ink, var(--text-1, #1f1a14)); border: 1px solid var(--border, rgba(0,0,0,0.10)); border-radius: 12px; box-shadow: 0 24px 60px rgba(20,30,25,0.18); min-width: 220px; padding: 6px; font-family: inherit; font-size: 13px; }',
      'body.dark #' + MENU_ID + ' { background: #1a2533; color: #e7e7ea; border-color: rgba(255,255,255,0.10); box-shadow: 0 24px 60px rgba(0,0,0,0.50); }',
      '#' + MENU_ID + ' .wjp-ch-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; cursor: pointer; transition: background .12s ease; user-select: none; }',
      '#' + MENU_ID + ' .wjp-ch-item:hover { background: rgba(31,122,74,0.07); }',
      'body.dark #' + MENU_ID + ' .wjp-ch-item:hover { background: rgba(127,209,164,0.10); }',
      '#' + MENU_ID + ' .wjp-ch-item i { font-size: 16px; color: var(--ink-dim, #6b7280); }',
      '#' + MENU_ID + ' .wjp-ch-item .wjp-ch-label { flex: 1; font-weight: 600; }',
      '#' + MENU_ID + ' .wjp-ch-item .wjp-ch-state { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(31,122,74,0.12); color: #1f7a4a; }',
      'body.dark #' + MENU_ID + ' .wjp-ch-item .wjp-ch-state { background: rgba(127,209,164,0.20); color: #7fd1a4; }',
      '#' + MENU_ID + ' .wjp-ch-divider { height: 1px; background: var(--border, rgba(0,0,0,0.07)); margin: 5px 4px; }',
      'body.dark #' + MENU_ID + ' .wjp-ch-divider { background: rgba(255,255,255,0.08); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // Build the greeting text from the original element if available, else
  // fall back to a reasonable default. We DON'T inject any user name —
  // existing code populates the original element, we just mirror its text.
  function readOriginalGreeting() {
    var src = document.getElementById('dash-greeting-text');
    if (src && (src.textContent || '').trim()) return (src.textContent || '').trim();
    return 'Welcome back.';
  }

  function syncGreetingText() {
    var headerText = document.querySelector('#' + HEADER_ID + ' .wjp-ch-greeting-text');
    if (!headerText) return;
    headerText.textContent = readOriginalGreeting();
  }

  function readAutofitState() {
    var btn = document.getElementById('dash-autofit-toggle');
    if (!btn) return 'On';
    var v = btn.getAttribute('aria-pressed');
    return (v === 'false') ? 'Off' : 'On';
  }

  function buildHeader() {
    if (document.getElementById(HEADER_ID)) return;
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    var header = document.createElement('div');
    header.id = HEADER_ID;
    header.innerHTML =
      '<div class="wjp-ch-greeting">' +
        '<span class="wjp-ch-wave" aria-hidden="true">👋</span>' +
        '<span class="wjp-ch-greeting-text">' + readOriginalGreeting().replace(/[<>"&]/g, '') + '</span>' +
      '</div>' +
      '<button type="button" class="wjp-ch-gear" id="wjp-ch-gear-btn" title="Dashboard settings" aria-label="Dashboard settings">' +
        '<i class="ph ph-gear"></i>' +
      '</button>';
    page.insertBefore(header, page.firstChild);
    wireGear();
    // Keep greeting text in sync if the original gets repopulated later
    try {
      var src = document.getElementById('dash-greeting-text');
      if (src) {
        var mo = new MutationObserver(syncGreetingText);
        mo.observe(src, { childList: true, characterData: true, subtree: true });
      }
    } catch (_) {}
  }

  function closeMenu() {
    var m = document.getElementById(MENU_ID);
    if (m) try { m.remove(); } catch (_) {}
    document.removeEventListener('click', outsideClick, true);
  }
  function outsideClick(e) {
    var m = document.getElementById(MENU_ID);
    if (!m) return;
    if (m.contains(e.target)) return;
    var btn = document.getElementById('wjp-ch-gear-btn');
    if (btn && btn.contains(e.target)) return;
    closeMenu();
  }

  function clickOriginal(id) {
    var el = document.getElementById(id);
    if (el && typeof el.click === 'function') el.click();
  }

  function openMenu() {
    closeMenu();
    var btn = document.getElementById('wjp-ch-gear-btn');
    if (!btn) return;
    var menu = document.createElement('div');
    menu.id = MENU_ID;
    var autofitState = readAutofitState();
    menu.innerHTML =
      '<div class="wjp-ch-item" data-action="reorder" role="menuitem">' +
        '<i class="ph ph-arrows-out-cardinal"></i>' +
        '<span class="wjp-ch-label">Re-order</span>' +
      '</div>' +
      '<div class="wjp-ch-item" data-action="reset" role="menuitem">' +
        '<i class="ph ph-arrow-counter-clockwise"></i>' +
        '<span class="wjp-ch-label">Reset layout</span>' +
      '</div>';
    document.body.appendChild(menu);
    // Position under gear, right-aligned
    var r = btn.getBoundingClientRect();
    var menuRect = menu.getBoundingClientRect();
    var top = r.bottom + 6;
    var left = Math.max(8, r.right - menuRect.width);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    // Wire actions
    menu.querySelectorAll('.wjp-ch-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var act = item.getAttribute('data-action');
        if (act === 'reorder') { clickOriginal('dash-customize-btn'); }
        else if (act === 'autofit') { clickOriginal('dash-autofit-toggle'); setTimeout(refreshAutofitState, 50); }
        else if (act === 'reset') { clickOriginal('dash-customize-reset'); }
        if (act !== 'autofit') closeMenu();
      });
    });
    setTimeout(function () { document.addEventListener('click', outsideClick, true); }, 0);
  }

  function refreshAutofitState() {
    var stateEl = document.querySelector('#' + MENU_ID + ' [data-autofit-state]');
    if (stateEl) stateEl.textContent = readAutofitState();
  }

  function wireGear() {
    var btn = document.getElementById('wjp-ch-gear-btn');
    if (!btn || btn.dataset.wjpWired === '1') return;
    btn.dataset.wjpWired = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (document.getElementById(MENU_ID)) closeMenu();
      else openMenu();
    });
  }

  // FIX 81: keep the header pinned to the very top. Other modules (e.g.
  // wjp-dashboard-audit-fix's Executive Summary inserter) call
  // `grid.insertBefore(card, grid.firstChild)` which can push our header
  // down to position 1+. Re-anchor whenever that happens.
  var _anchoring = false;
  function reanchorTop() {
    if (_anchoring) return;
    var page = document.getElementById('page-dashboard');
    var header = document.getElementById(HEADER_ID);
    if (!page || !header) return;
    if (page.firstElementChild === header) return;
    _anchoring = true;
    try { page.insertBefore(header, page.firstElementChild); } catch (_) {}
    setTimeout(function () { _anchoring = false; }, 50);
  }

  function attachAnchorObserver() {
    var page = document.getElementById('page-dashboard');
    if (!page || page.dataset.wjpAnchorObs === '1') return;
    page.dataset.wjpAnchorObs = '1';
    try {
      var mo = new MutationObserver(function () { reanchorTop(); });
      mo.observe(page, { childList: true });
    } catch (_) {}
  }

  // Build header once #page-dashboard exists. The dashboard is part of the
  // initial HTML so it should be there by DOMContentLoaded, but we retry
  // briefly just to be safe.
  function boot() {
    injectStyle();
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      buildHeader();
      if (document.getElementById(HEADER_ID)) {
        attachAnchorObserver();
        reanchorTop();
        clearInterval(iv);
      } else if (attempts > 40) {
        clearInterval(iv);
      }
    }, 200);
    // Re-sync greeting periodically (in case modules late-update it)
    setInterval(syncGreetingText, 5000);
    // Safety re-anchor on common re-render events
    window.addEventListener('wjp-data-restored', function () { setTimeout(reanchorTop, 400); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(reanchorTop, 200); });
    // Light safety tick — cheap (single child compare)
    setInterval(reanchorTop, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DashboardHeaderCompact = {
    version: 8,
    rebuild: function () { try { var h = document.getElementById(HEADER_ID); if (h) h.remove(); } catch (_) {}; buildHeader(); }
  };
})();
