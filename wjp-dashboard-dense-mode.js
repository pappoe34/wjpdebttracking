/* wjp-dashboard-dense-mode.js v3 — Optional Dense mode for the dashboard:
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
    var pill = document.querySelector('#' + MENU_ID + ' [data-dense-state]');
    if (pill) pill.textContent = on ? 'On' : 'Off';
    // FIX 93: also force inline styles on every card so we win over the
    // JS-set inline padding the dashboard renderer applies.
    applyInline(on);
  }

  // FIX 93: walk every reorderable card and set inline styles directly.
  // CSS !important loses to inline styles set after page load, so we go nuclear.
  function applyInline(on) {
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    var cards = page.querySelectorAll(':scope > .reorderable');
    cards.forEach(function (card) {
      if (on) {
        // Remember original padding so we can restore on off
        if (!card.dataset.wjpDenseOrigPad) {
          card.dataset.wjpDenseOrigPad = card.style.padding || '';
        }
        card.style.setProperty('padding', '12px 14px', 'important');
        // Shrink h1, h2, h3, .card-title, .section-label
        card.querySelectorAll('h1, h2, h3, .card-title, [class*="title"]').forEach(function (h) {
          if (!h.dataset.wjpDenseOrig) {
            h.dataset.wjpDenseOrig = h.style.cssText || '';
          }
          var tag = h.tagName.toLowerCase();
          var size = tag === 'h1' ? '18px' : tag === 'h2' ? '16px' : '14px';
          h.style.setProperty('font-size', size, 'important');
          h.style.setProperty('line-height', '1.2', 'important');
          h.style.setProperty('margin', '0 0 6px', 'important');
        });
        // Big stat numbers (anything > 28px font in inline style)
        card.querySelectorAll('[style*="font-size"]').forEach(function (e) {
          var m = (e.getAttribute('style') || '').match(/font-size:\s*(\d+)px/);
          if (!m) return;
          var px = parseInt(m[1], 10);
          if (px >= 28) {
            if (!e.dataset.wjpDenseOrigInlineSize) e.dataset.wjpDenseOrigInlineSize = String(px);
            var newPx = Math.max(20, Math.round(px * 0.65));
            e.style.setProperty('font-size', newPx + 'px', 'important');
          }
        });
        // Section labels / eyebrows
        card.querySelectorAll('.section-label, [class*="eyebrow"]').forEach(function (e) {
          e.style.setProperty('font-size', '9.5px', 'important');
          e.style.setProperty('margin-bottom', '3px', 'important');
        });
        // Subtitles / sub text
        card.querySelectorAll('.card-sub, [class*="sub"]').forEach(function (e) {
          // Skip elements that don't look like text/subtitles (avoid grid cells)
          if (e.children && e.children.length > 4) return;
          e.style.setProperty('font-size', '11px', 'important');
          e.style.setProperty('margin-bottom', '6px', 'important');
        });
        // List rows / row items
        card.querySelectorAll('.bank-row, .row-item, [class*="row-"]').forEach(function (e) {
          if (e.children && e.children.length > 6) return;
          e.style.setProperty('padding', '6px 10px', 'important');
          e.style.setProperty('min-height', '0', 'important');
        });
      } else {
        // Restore original padding
        if (card.dataset.wjpDenseOrigPad !== undefined) {
          if (card.dataset.wjpDenseOrigPad) {
            card.style.padding = card.dataset.wjpDenseOrigPad;
          } else {
            card.style.removeProperty('padding');
          }
          delete card.dataset.wjpDenseOrigPad;
        }
        // Restore titles
        card.querySelectorAll('h1, h2, h3, .card-title').forEach(function (h) {
          if (h.dataset.wjpDenseOrig !== undefined) {
            if (h.dataset.wjpDenseOrig) h.style.cssText = h.dataset.wjpDenseOrig;
            else h.removeAttribute('style');
            delete h.dataset.wjpDenseOrig;
          }
        });
        // Restore inline stat sizes
        card.querySelectorAll('[data-wjp-dense-orig-inline-size]').forEach(function (e) {
          e.style.setProperty('font-size', e.dataset.wjpDenseOrigInlineSize + 'px');
          delete e.dataset.wjpDenseOrigInlineSize;
        });
        // Clear forced section labels / subs / rows (let CSS take back over)
        card.querySelectorAll('.section-label, [class*="eyebrow"], .card-sub, [class*="sub"], .bank-row, .row-item, [class*="row-"]').forEach(function (e) {
          e.style.removeProperty('font-size');
          e.style.removeProperty('margin-bottom');
          e.style.removeProperty('padding');
          e.style.removeProperty('min-height');
          e.style.removeProperty('line-height');
        });
      }
    });
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      // ───── FIX 88 v2: aggressive density across every card ─────
      // Grid mode stretches cards to row height, so shrinking outer padding
      // alone is invisible. We aggressively shrink CONTENT (titles, sub-text,
      // list rows, internal paddings) so the tallest card in each row is
      // physically shorter — that pulls the whole row down.

      // ───── 1) Card shell padding — tight all-around ─────
      'body.' + BODY_CLASS + ' #page-dashboard > .reorderable { padding: 12px 14px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .card, body.' + BODY_CLASS + ' #page-dashboard .reorderable.card { padding: 12px 14px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard { gap: 10px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .dash-grid { gap: 10px !important; }',
      // Pull grid rows tighter
      'body.dashboard-grid-slots.' + BODY_CLASS + ' #page-dashboard.active { gap: 10px !important; }',

      // ───── 2) Section labels + card headers — shrink fonts ─────
      'body.' + BODY_CLASS + ' #page-dashboard .reorderable .section-label { font-size: 9.5px !important; margin-bottom: 3px !important; letter-spacing: 0.08em !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .reorderable h1, body.' + BODY_CLASS + ' #page-dashboard .reorderable h2 { font-size: 16px !important; line-height: 1.2 !important; margin: 0 0 6px !important; letter-spacing: -0.2px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .reorderable h3, body.' + BODY_CLASS + ' #page-dashboard .reorderable .card-title { font-size: 13px !important; margin: 0 0 4px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .reorderable .card-sub { font-size: 11px !important; margin-bottom: 6px !important; }',

      // ───── 3) Big dollar amounts (assets/bank balance/exec summary) ─────
      'body.' + BODY_CLASS + ' #page-dashboard .reorderable .h-big, body.' + BODY_CLASS + ' #page-dashboard .reorderable [class*="-big"], body.' + BODY_CLASS + ' #page-dashboard .reorderable [style*="font-size:38px"], body.' + BODY_CLASS + ' #page-dashboard .reorderable [style*="font-size: 38px"], body.' + BODY_CLASS + ' #page-dashboard .reorderable [style*="font-size:32px"], body.' + BODY_CLASS + ' #page-dashboard .reorderable [style*="font-size: 32px"] { font-size: 24px !important; line-height: 1.15 !important; letter-spacing: -0.6px !important; }',

      // ───── 4) Executive Summary card ─────
      'body.' + BODY_CLASS + ' #dfd-hero { padding: 14px 16px !important; }',
      'body.' + BODY_CLASS + ' #dfd-date { font-size: clamp(32px, 4vw, 44px) !important; line-height: 1.05 !important; margin-bottom: 4px !important; letter-spacing: -1px !important; }',
      'body.' + BODY_CLASS + ' #dfd-eyebrow { font-size: 10px !important; margin-bottom: 2px !important; }',
      'body.' + BODY_CLASS + ' .dfd-meta { font-size: 11px !important; margin-bottom: 8px !important; }',
      'body.' + BODY_CLASS + ' .dfd-hero .section-label { margin-bottom: 4px !important; font-size: 9.5px !important; }',
      'body.' + BODY_CLASS + ' .dfd-progress { margin-bottom: 4px !important; }',
      'body.' + BODY_CLASS + ' .progress-bar-tall { height: 6px !important; }',
      'body.' + BODY_CLASS + ' .dfd-labels { font-size: 10px !important; }',

      // ───── 5) List rows (bank balances, assets, transactions, debts) ─────
      'body.' + BODY_CLASS + ' #page-dashboard .bank-row, body.' + BODY_CLASS + ' #page-dashboard .row-item, body.' + BODY_CLASS + ' #linked-assets-body > div { padding: 6px 10px !important; min-height: 0 !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .bank-row .row-name, body.' + BODY_CLASS + ' #page-dashboard .row-item .row-name { font-size: 12px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .bank-row .row-meta, body.' + BODY_CLASS + ' #page-dashboard .row-item .row-meta, body.' + BODY_CLASS + ' #page-dashboard .row-sub { font-size: 10px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .bank-row .row-amount, body.' + BODY_CLASS + ' #page-dashboard .row-item .row-amount { font-size: 13px !important; font-weight: 700 !important; }',
      // Collapse to first 4 list items per card (was first 4-5)
      'body.' + BODY_CLASS + ' #wjp-dash-debit-balances .bank-row:nth-child(n+5), body.' + BODY_CLASS + ' #linked-assets-body > div:nth-child(n+4) { display: none !important; }',

      // ───── 6) Math breakdown / strategy details ─────
      'body.' + BODY_CLASS + ' #math-breakdown { padding: 10px 12px !important; }',
      'body.' + BODY_CLASS + ' #math-breakdown .math-breakdown-title { font-size: 13px !important; }',
      'body.' + BODY_CLASS + ' #math-breakdown .math-row { padding: 4px 0 !important; font-size: 11px !important; }',

      // ───── 7) Active Target / Snowball indicators ─────
      'body.' + BODY_CLASS + ' #wjp-dashboard-hero h1, body.' + BODY_CLASS + ' #wjp-dashboard-hero .hero-title { font-size: 17px !important; line-height: 1.15 !important; }',
      'body.' + BODY_CLASS + ' #wjp-dashboard-hero .hero-meta { font-size: 11px !important; }',
      'body.' + BODY_CLASS + ' #wjp-dashboard-hero .hero-progress { height: 6px !important; }',

      // ───── 8) Strategy / Spending / Math cards body trim ─────
      'body.' + BODY_CLASS + ' #dash-strategy-card .card-body, body.' + BODY_CLASS + ' #dash-spending-card .card-body { padding: 10px 0 0 !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard p { line-height: 1.4 !important; margin: 0 0 4px !important; }',
      'body.' + BODY_CLASS + ' #page-dashboard .card-footer, body.' + BODY_CLASS + ' #page-dashboard .row-footer { padding-top: 6px !important; font-size: 10.5px !important; }',

      // ───── 9) Buttons inside cards — tighter padding ─────
      'body.' + BODY_CLASS + ' #page-dashboard .reorderable button:not(.card-rc-btn):not(.wjp-gcal-btn):not(.wjp-card-slot-toolbar > *) { padding: 7px 12px !important; font-size: 12px !important; }',

      // ───── 10) Compact header gap ─────
      'body.' + BODY_CLASS + ' #wjp-compact-header { padding-top: 8px !important; padding-bottom: 4px !important; }'
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
      if (getState() && getState().prefs) { apply(); setTimeout(apply, 1500); clearInterval(iv); }
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
    version: 3,
    isEnabled: isDenseEnabled,
    setEnabled: setDenseEnabled,
    apply: apply
  };
})();
