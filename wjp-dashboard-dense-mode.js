/* wjp-dashboard-dense-mode.js v1 — Optional Dense mode for the dashboard:
 * tighter card padding, smaller Exec Summary date font, smaller row gaps.
 * Goal: fit more cards above the fold on first open.
 *
 * Winston 2026-05-29: "lets give it a shot" (Plan A — CSS-only dense mode
 * with a one-toggle revert).
 *
 * How it works:
 *   - Reads prefs.dashboardDense (default false). When true, adds body class
 *     `dashboard-dense` and a `<style>` block tightens dashboard layout.
 *   - Watches for the compact-header gear menu to open and injects a new
 *     "Dense mode" row at the top of the menu with an On/Off pill that
 *     toggles the pref.
 *   - All styles live in a single injected element so the feature is
 *     genuinely 1-line revert: remove the body class → original layout
 *     returns exactly as-is.
 *   - URL flag `?dense=0` forces it off; `?dense=1` forces it on (handy for
 *     A/B comparison without changing the saved pref).
 *
 * Safe: IIFE, idempotent install, bare appState access, no DOM rewrites.
 */
(function () {
  'use strict';
  if (window._wjpDashboardDenseInstalled) return;
  window._wjpDashboardDenseInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-dashboard-dense-style';
  var BODY_CLASS = 'dashboard-dense';
  var MENU_ID = 'wjp-compact-header-menu';

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function isDenseEnabled() {
    // URL override wins
    try {
      var q = (location.search || '').toLowerCase();
      if (q.indexOf('dense=1') !== -1) return true;
      if (q.indexOf('dense=0') !== -1) return false;
    } catch (_) {}
    var s = getState();
    return !!(s && s.prefs && s.prefs.dashboardDense);
  }

  function setDenseEnabled(v) {
    var s = getState();
    if (s) {
      if (!s.prefs) s.prefs = {};
      s.prefs.dashboardDense = !!v;
      saveState();
    }
    apply();
  }

  function apply() {
    var on = isDenseEnabled();
    document.body.classList.toggle(BODY_CLASS, on);
    // Reflect in the menu pill if open
    var pill = document.querySelector('#' + MENU_ID + ' [data-dense-state]');
    if (pill) pill.textContent = on ? 'On' : 'Off';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      // ───── Card padding (every reorderable card) ─────
      'body.' + BODY_CLASS + ' #page-dashboard .card, body.' + BODY_CLASS + ' #page-dashboard .reorderable, body.' + BODY_CLASS + ' #page-dashboard .reorderable.card { padding: 14px 16px !important; }',
      // ───── Inter-card gaps ─────
      'body.' + BODY_CLASS + ' #page-dashboard { gap: 12px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .dash-grid { gap: 12px !important; }',
      // ───── Executive Summary card — the giant ─────
      'body.' + BODY_CLASS + ' #dfd-hero { padding: 16px 18px !important; }',
      'body.' + BODY_CLASS + ' #dfd-date { font-size: clamp(36px, 4.2vw, 50px) !important; line-height: 1.05 !important; margin-bottom: 6px !important; }',
      'body.' + BODY_CLASS + ' #dfd-eyebrow { font-size: 11px !important; margin-bottom: 2px !important; }',
      'body.' + BODY_CLASS + ' .dfd-meta { font-size: 11.5px !important; margin-bottom: 10px !important; }',
      'body.' + BODY_CLASS + ' .dfd-hero .section-label { margin-bottom: 4px !important; font-size: 10px !important; }',
      'body.' + BODY_CLASS + ' .dfd-progress { margin-bottom: 6px !important; }',
      'body.' + BODY_CLASS + ' .progress-bar-tall { height: 8px !important; }',
      'body.' + BODY_CLASS + ' .dfd-labels { font-size: 10.5px !important; }',
      // ───── Card titles ─────
      'body.' + BODY_CLASS + ' #page-dashboard .card h3, body.' + BODY_CLASS + ' #page-dashboard .card-title { font-size: 14px !important; margin-bottom: 6px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .card-sub { margin-bottom: 8px !important; }',
      // ───── Bank Balances / Linked Assets — collapse to first 3, keep "show more" cue ─────
      'body.' + BODY_CLASS + ' #wjp-dash-debit-balances .bank-row:nth-child(n+5), body.' + BODY_CLASS + ' #linked-assets-body > div:nth-child(n+4) { display: none !important; }',
      // ───── Math Breakdown body — collapsible feel by default ─────
      'body.' + BODY_CLASS + ' #math-breakdown { padding: 12px 14px !important; }',
      'body.' + BODY_CLASS + ' #math-breakdown .math-breakdown-title { font-size: 15px !important; }',
      // ───── Compact header gap to next card ─────
      'body.' + BODY_CLASS + ' #wjp-compact-header { padding-top: 10px !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───── Patch the gear menu when it opens ─────
  function patchMenu(menu) {
    if (!menu || menu.dataset.wjpDensePatched === '1') return;
    menu.dataset.wjpDensePatched = '1';
    var item = document.createElement('div');
    item.className = 'wjp-ch-item';
    item.setAttribute('data-action', 'dense');
    item.setAttribute('role', 'menuitem');
    item.innerHTML =
      '<i class="ph ph-rows"></i>' +
      '<span class="wjp-ch-label">Dense mode</span>' +
      '<span class="wjp-ch-state" data-dense-state>' + (isDenseEnabled() ? 'On' : 'Off') + '</span>';
    menu.insertBefore(item, menu.firstChild);
    item.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setDenseEnabled(!isDenseEnabled());
    });
  }

  function attachMenuObserver() {
    try {
      var mo = new MutationObserver(function () {
        var menu = document.getElementById(MENU_ID);
        if (menu) patchMenu(menu);
      });
      mo.observe(document.body, { childList: true });
    } catch (_) {}
    // Catch the menu if it's already there
    var m = document.getElementById(MENU_ID);
    if (m) patchMenu(m);
  }

  function boot() {
    injectStyle();
    apply();
    // Re-apply when appState lands
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (getState() && getState().prefs) { apply(); clearInterval(iv); }
      if (attempts > 40) clearInterval(iv);
    }, 250);
    window.addEventListener('wjp-data-restored', function () { setTimeout(apply, 300); });
    attachMenuObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DashboardDense = {
    version: 1,
    isEnabled: isDenseEnabled,
    setEnabled: setDenseEnabled,
    apply: apply
  };
})();
