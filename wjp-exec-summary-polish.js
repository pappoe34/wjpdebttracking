/* wjp-exec-summary-polish.js v1 — Center the Executive Summary card and
 * make the freedom progress bar register tiny but real payment activity.
 *
 * Winston 2026-05-29: "exclusive summary information should be centered.
 *   also noticed the bar never moves and makes it look like user hasnt
 *   paid anything or make any breakthroughs"
 *
 * What this does:
 *   1. Centers the content inside `.dfd-hero` (Executive Summary card)
 *      so the eyebrow, "You'll be debt-free on", date, and meta line all
 *      sit on the panel's vertical axis.
 *   2. Boosts the `#freedom-progress-fill` element so when totalPaid > 0
 *      it gets a visible minimum slice (12%) — small actual payments
 *      stop looking like zero progress. Adds a subtle glow pulse on the
 *      filled portion so the bar always feels alive.
 *   3. Watches the bar via MutationObserver — every time app.js re-renders
 *      and writes a new inline width, we re-evaluate the boost so the bar
 *      visual stays meaningful without breaking the underlying math.
 *
 * Safe: IIFE, idempotent install, bare appState access via try/catch, no
 * hardcoded user data. Works for every account out of the box.
 */
(function () {
  'use strict';
  if (window._wjpExecSummaryPolishInstalled) return;
  window._wjpExecSummaryPolishInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // ────────── styles ──────────
  function injectStyle() {
    if (document.getElementById('wjp-exec-summary-polish-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-exec-summary-polish-style';
    st.textContent = [
      /* Center exec summary card content */
      '.dfd-hero { text-align: center !important; }',
      '.dfd-hero .section-label, .dfd-hero .dfd-eyebrow, .dfd-hero .dfd-date, .dfd-hero .dfd-meta { text-align: center; }',
      '.dfd-hero .dfd-meta { justify-content: center; margin-left: auto !important; margin-right: auto !important; }',
      '.dfd-hero .section-label, .dfd-hero .dfd-eyebrow, .dfd-hero .dfd-date { margin-left: auto !important; margin-right: auto !important; }',
      '.dfd-hero .dfd-meta span, .dfd-hero .dfd-meta b, .dfd-hero .dfd-meta strong { display: inline; }',

      /* Progress labels — keep paid on left, strategy in middle, target on right */
      '.dfd-hero .dfd-labels { justify-content: space-between !important; }',

      /* Progress fill — subtle glow pulse so the bar always feels alive */
      '#freedom-progress-fill { position: relative; box-shadow: 0 0 12px rgba(31,122,74,0.35); transition: width .55s cubic-bezier(.16,1,.3,1), min-width .35s ease; }',
      '#freedom-progress-fill.wjp-has-progress { animation: wjpExecPulse 2.4s ease-in-out infinite; }',
      '@keyframes wjpExecPulse { 0%, 100% { box-shadow: 0 0 8px rgba(31,122,74,0.25); } 50% { box-shadow: 0 0 18px rgba(43,155,114,0.55); } }',

      /* Subtle visible floor — when there is any progress, show at least a meaningful slice */
      /* Achieved via JS below; this fallback ensures the fill height is consistent */
      '.dfd-progress { overflow: visible !important; }',

      /* Tiny check mark indicator at the leading edge of the fill when boosted */
      '#freedom-progress-fill.wjp-has-progress::after { content: ""; position: absolute; top: 50%; right: -4px; width: 8px; height: 8px; border-radius: 50%; background: #2b9b72; transform: translateY(-50%); box-shadow: 0 0 8px rgba(43,155,114,0.7); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── progress bar boost ──────────
  // Visible minimum so a tiny but real payment ($218 of $33K) actually
  // looks like progress. We never DROP the underlying width that app.js
  // sets — we only widen via inline style override + min-width. The
  // underlying math (totalPaid / targetGoal) stays accurate.
  var MIN_VISIBLE_PCT = 12;

  // Some other module leaves stuck CSS width transitions in 'running'
  // state on the dashboard. Like the sidebar, this pins the rendered
  // width at the from-value regardless of cascade. Cancel them before
  // toggling so the new width takes effect.
  function killStuckAnimations(el) {
    try {
      if (!el || !el.getAnimations) return;
      el.getAnimations().forEach(function (a) { try { a.cancel(); } catch (_) {} });
    } catch (_) {}
  }

  function boostFill() {
    try {
      var fill = document.getElementById('freedom-progress-fill');
      if (!fill) return;
      var widthStr = fill.style.width || '';
      var m = /^(\d+(?:\.\d+)?)%/.exec(widthStr);
      if (!m) return;
      var pct = parseFloat(m[1]);
      var paidEl = document.getElementById('freedom-paid-amt');
      var paidTxt = paidEl ? (paidEl.textContent || '') : '';
      var paidNum = parseFloat(paidTxt.replace(/[^0-9.]/g, '')) || 0;

      // ALWAYS clear stuck animations first — they otherwise pin the rendered
      // width regardless of CSS specificity (same root cause as FIX 64 v5).
      killStuckAnimations(fill);

      if (paidNum > 0 && pct < MIN_VISIBLE_PCT) {
        fill.dataset.wjpRealPct = String(pct);
        fill.style.setProperty('width', MIN_VISIBLE_PCT + '%', 'important');
        fill.classList.add('wjp-has-progress');
      } else if (paidNum > 0) {
        fill.classList.add('wjp-has-progress');
        delete fill.dataset.wjpRealPct;
      } else {
        fill.classList.remove('wjp-has-progress');
        delete fill.dataset.wjpRealPct;
      }
    } catch (_) {}
  }

  // ────────── watch for app.js re-renders ──────────
  function wireBoostObserver() {
    var fill = document.getElementById('freedom-progress-fill');
    if (!fill) return false;
    if (fill.dataset.wjpBoostWired === '1') return true;
    fill.dataset.wjpBoostWired = '1';
    try {
      var mo = new MutationObserver(function (mutations) {
        // Only re-boost if app.js (not us) changed the width — avoid recursion
        var sourceIsOurs = false;
        mutations.forEach(function (m) {
          if (m.attributeName === 'style' && fill.style.getPropertyPriority('width') === 'important') {
            // Could be ours — read data-wjp-real-pct to know
            if (fill.dataset.wjpRealPct) sourceIsOurs = true;
          }
        });
        if (sourceIsOurs) return;
        boostFill();
      });
      mo.observe(fill, { attributes: true, attributeFilter: ['style'] });
    } catch (_) {}
    // Initial pass
    boostFill();
    // Also re-boost on common state-change events
    window.addEventListener('wjp-data-restored', function () { setTimeout(boostFill, 400); });
    window.addEventListener('wjp-debts-changed', function () { setTimeout(boostFill, 200); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(boostFill, 200); });
    return true;
  }

  // ────────── boot ──────────
  function boot() {
    injectStyle();
    var attempts = 0;
    function tryWire() {
      attempts++;
      if (wireBoostObserver()) return;
      if (attempts < 40) setTimeout(tryWire, 250);
    }
    tryWire();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_ExecSummaryPolish = {
    version: 3,
    boostFill: boostFill
  };
})();
