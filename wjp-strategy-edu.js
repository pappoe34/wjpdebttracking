/* wjp-strategy-edu.js v1 — Strategy-selection education modal (discipline-first).
 *
 * Winston's directive: when user picks/changes a payoff strategy, pop a one-time
 * modal that frames the choice as a COMMITMENT, not a math experiment.
 *
 *   "This is a commitment. Pick what you'll actually stick to. Discipline beats math."
 *
 * One sentence per strategy:
 *   - Avalanche  : math-optimal — pays least interest, but requires patience
 *                  before you see a debt disappear.
 *   - Snowball   : motivation-optimal — clears smallest debts fast for early wins;
 *                  costs slightly more in total interest.
 *   - Hybrid     : middle path — weighted by balance × APR (interest contribution),
 *                  balances momentum and math.
 *
 * Show on FIRST strategy change per device (localStorage flag). After that, never
 * shown unless user resets via WJP_StrategyEdu.reset() in DevTools.
 *
 * Click handler approach: capture-phase listener on the entire document watching
 * for clicks on `[data-strategy]` elements. We intercept BEFORE app.js's onclick
 * runs, show the modal, and when the user clicks Continue we re-fire the click
 * (with a bypass flag) to let app.js's logic take over.
 *
 * Safe: IIFE, idempotent, path-guarded, uses bare appState per memory rule.
 */
(function () {
  'use strict';
  if (window._wjpStrategyEduInstalled) return;
  window._wjpStrategyEduInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var LS_FLAG = 'wjp.strategy.eduShown.v1';
  var MODAL_ID = 'wjp-strategy-edu-modal';
  var STYLE_ID = 'wjp-strategy-edu-style';
  var BYPASS_ATTR = 'data-wjp-edu-bypass';

  function alreadyShown() {
    try { return localStorage.getItem(LS_FLAG) === '1'; } catch (_) { return false; }
  }
  function markShown() {
    try { localStorage.setItem(LS_FLAG, '1'); } catch (_) {}
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + MODAL_ID + ' {' +
      '  position: fixed; inset: 0; z-index: 99999;' +
      '  background: rgba(0,0,0,0.55);' +
      '  display: flex; align-items: center; justify-content: center;' +
      '  padding: 20px; font-family: Inter, system-ui, sans-serif;' +
      '}' +
      '#' + MODAL_ID + ' .card {' +
      '  background: var(--card-bg, var(--bg-2, #fff));' +
      '  color: var(--ink, var(--text-1, #0a0a0a));' +
      '  border: 1px solid var(--border, rgba(0,0,0,0.10));' +
      '  border-radius: 18px;' +
      '  width: 100%; max-width: 580px;' +
      '  padding: 26px 28px 22px;' +
      '  box-shadow: 0 30px 80px rgba(0,0,0,0.40);' +
      '  max-height: 90vh; overflow-y: auto;' +
      '}' +
      '#' + MODAL_ID + ' .eyebrow {' +
      '  font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase;' +
      '  color: #1f7a4a; font-weight: 800; margin-bottom: 6px;' +
      '}' +
      '#' + MODAL_ID + ' h2 {' +
      '  margin: 0 0 8px; font-family: Fraunces, Georgia, serif;' +
      '  font-size: 24px; letter-spacing: -0.02em; line-height: 1.2;' +
      '}' +
      '#' + MODAL_ID + ' .sub {' +
      '  font-size: 13.5px; color: var(--ink-dim, var(--text-2, #6b7280));' +
      '  line-height: 1.6; margin-bottom: 16px;' +
      '}' +
      '#' + MODAL_ID + ' .strat-row {' +
      '  display: flex; align-items: flex-start; gap: 10px;' +
      '  padding: 11px 12px; border-radius: 10px;' +
      '  background: var(--bg-3, rgba(0,0,0,0.03));' +
      '  margin-bottom: 7px;' +
      '}' +
      '#' + MODAL_ID + ' .strat-row.selected {' +
      '  background: rgba(31,122,74,0.08);' +
      '  border: 1px solid rgba(31,122,74,0.25);' +
      '}' +
      '#' + MODAL_ID + ' .strat-pill {' +
      '  font-size: 10px; font-weight: 800; letter-spacing: 0.05em;' +
      '  padding: 3px 9px; border-radius: 999px;' +
      '  flex-shrink: 0; text-transform: uppercase;' +
      '}' +
      '#' + MODAL_ID + ' .strat-pill.avalanche { background: rgba(255,171,64,0.18); color: #c87b1a; }' +
      '#' + MODAL_ID + ' .strat-pill.snowball  { background: rgba(168,85,247,0.18); color: #7a5fc8; }' +
      '#' + MODAL_ID + ' .strat-pill.hybrid    { background: rgba(102,126,234,0.18); color: #4856b8; }' +
      '#' + MODAL_ID + ' .strat-body {' +
      '  font-size: 12.5px; color: var(--ink, var(--text-1, #0a0a0a)); line-height: 1.55;' +
      '}' +
      '#' + MODAL_ID + ' .strat-body strong { font-weight: 800; }' +
      '#' + MODAL_ID + ' .commit-box {' +
      '  margin: 14px 0 12px; padding: 12px 14px;' +
      '  background: rgba(255,171,64,0.10);' +
      '  border-left: 3px solid #c99a2a;' +
      '  border-radius: 8px;' +
      '  font-size: 12.5px; color: var(--ink, var(--text-1, #0a0a0a));' +
      '  line-height: 1.55;' +
      '}' +
      '#' + MODAL_ID + ' .commit-box strong { color: #c99a2a; }' +
      '#' + MODAL_ID + ' .btn-row {' +
      '  display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;' +
      '}' +
      '#' + MODAL_ID + ' .btn {' +
      '  border-radius: 10px; padding: 10px 18px; font-size: 13px; font-weight: 700;' +
      '  cursor: pointer; font-family: inherit;' +
      '}' +
      '#' + MODAL_ID + ' .btn-secondary {' +
      '  background: transparent; color: var(--ink, var(--text-1, #0a0a0a));' +
      '  border: 1px solid var(--border, rgba(0,0,0,0.18));' +
      '}' +
      '#' + MODAL_ID + ' .btn-primary {' +
      '  background: #1f7a4a; color: #fff; border: none;' +
      '  box-shadow: 0 1px 3px rgba(31,122,74,0.30);' +
      '}' +
      '#' + MODAL_ID + ' .btn-primary:hover { background: #1a6840; }';
    (document.head || document.documentElement).appendChild(s);
  }

  function getStrategyExplain(s) {
    var map = {
      avalanche: {
        name: 'Avalanche',
        pillClass: 'avalanche',
        body: '<strong>Math-optimal.</strong> Pays your highest-APR debts first — least interest paid over the life of the plan. Trade-off: it can take longer before you see any single debt disappear, which can sap motivation.'
      },
      snowball: {
        name: 'Snowball',
        pillClass: 'snowball',
        body: '<strong>Motivation-optimal.</strong> Pays your smallest-balance debts first — you knock out cards fast and feel momentum quickly. Trade-off: slightly higher total interest than Avalanche.'
      },
      hybrid: {
        name: 'Hybrid',
        pillClass: 'hybrid',
        body: '<strong>Middle path.</strong> Ranks debts by balance × APR (the actual dollars of interest each debt is bleeding). Captures most of Avalanche\'s math advantage while still favoring smaller debts when their APR is moderate.'
      }
    };
    return map[s] || null;
  }

  function buildModal(selectedStrategy) {
    if (document.getElementById(MODAL_ID)) return null;
    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var strategies = ['avalanche', 'snowball', 'hybrid'];
    var rowsHtml = strategies.map(function (s) {
      var info = getStrategyExplain(s);
      var sel = s === selectedStrategy ? ' selected' : '';
      return '<div class="strat-row' + sel + '">' +
        '<span class="strat-pill ' + info.pillClass + '">' + info.name + '</span>' +
        '<div class="strat-body">' + info.body + '</div>' +
      '</div>';
    }).join('');

    overlay.innerHTML =
      '<div class="card">' +
        '<div class="eyebrow">Before you commit</div>' +
        '<h2>Pick the plan you\'ll actually stick to.</h2>' +
        '<div class="sub">All three of these will clear your debt. The math differs by a few months and a few hundred dollars of interest — but the strategy you stop following costs infinitely more than that.</div>' +
        rowsHtml +
        '<div class="commit-box"><strong>Discipline beats math.</strong> The right plan is the one you can keep doing for the next 12–60 months without quitting. If quick wins keep you going, that\'s Snowball — pay the small math premium gladly. If you trust the spreadsheet, that\'s Avalanche. Either way: pick one and run it.</div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn btn-secondary" data-action="cancel">Maybe later</button>' +
          '<button type="button" class="btn btn-primary" data-action="confirm">Commit to ' + (getStrategyExplain(selectedStrategy) ? getStrategyExplain(selectedStrategy).name : selectedStrategy) + ' &rarr;</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    return overlay;
  }

  // Capture-phase click interceptor. Runs BEFORE app.js's bubble-phase handlers.
  function onClickCapture(e) {
    var target = e.target;
    // Walk up to find a [data-strategy] element
    var match = null;
    while (target && target !== document.body) {
      if (target.getAttribute && target.getAttribute('data-strategy')) { match = target; break; }
      target = target.parentElement;
    }
    if (!match) return;
    // If bypass attribute set (we already re-fired), let through
    if (match.getAttribute(BYPASS_ATTR) === '1') {
      match.removeAttribute(BYPASS_ATTR);
      return;
    }
    if (alreadyShown()) return;
    var newStrat = match.getAttribute('data-strategy');
    if (!newStrat) return;
    // Stop the original click
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // Show modal
    var modal = buildModal(newStrat);
    if (!modal) return;
    var confirmBtn = modal.querySelector('[data-action="confirm"]');
    var cancelBtn = modal.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.onclick = function () { modal.remove(); };
    }
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        markShown();
        modal.remove();
        // Re-fire the click on the original target with bypass flag
        try {
          match.setAttribute(BYPASS_ATTR, '1');
          match.click();
        } catch (_) {}
      };
    }
  }

  function reset() {
    try { localStorage.removeItem(LS_FLAG); } catch (_) {}
  }

  function boot() {
    injectStyle();
    // Use capture phase so we intercept BEFORE app.js's bubble handlers
    document.addEventListener('click', onClickCapture, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_StrategyEdu = {
    show: function (s) { var m = buildModal(s || 'avalanche'); return !!m; },
    reset: reset,
    alreadyShown: alreadyShown,
    version: 1
  };
})();
