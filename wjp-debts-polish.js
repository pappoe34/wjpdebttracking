/* wjp-debts-polish.js — visual polish for Debts Overview cards
 *
 * Targeted upgrades only — does NOT change layout or break anything.
 *   1) Spending This Month + Expense Categories cards (.debts-spend-grid .card)
 *      get subtle elevation, hairline border, slight inner gradient.
 *   2) Strategy Simulator + Payoff Strategy cards (the parent of those headings)
 *      get matched padding/height so the row aligns visually.
 *   3) Trims residual empty gap below the strategy simulator row.
 *
 * Dark mode aware — every color uses cascading var(--*, fallback) chains.
 * Pure CSS injection — no DOM changes that could conflict with other overlays.
 */
(function () {
  'use strict';
  if (window._wjpDebtsPolishInstalled) return;
  window._wjpDebtsPolishInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-debts-polish-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* Spending This Month + Expense Categories — better depth, subtle accent */
      '.debts-spend-grid .card {',
      '  border-radius: 14px !important;',
      '  border: 1px solid var(--border, rgba(0,0,0,0.08)) !important;',
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03) !important;',
      '  background: linear-gradient(180deg, var(--card-bg, var(--bg-2, #ffffff)) 0%, var(--card-bg-2, var(--bg-2, #fafaf7)) 100%) !important;',
      '  transition: box-shadow 0.18s ease, transform 0.18s ease;',
      '}',
      '.debts-spend-grid .card:hover {',
      '  box-shadow: 0 4px 14px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04) !important;',
      '  transform: translateY(-1px);',
      '}',
      /* Better internal spacing for those cards */
      '.debts-spend-grid .card { padding: 22px 26px !important; }',
      /* Dark mode tweaks — softer accents */
      'body.dark .debts-spend-grid .card {',
      '  background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%) !important;',
      '  border-color: rgba(255,255,255,0.08) !important;',
      '}',
      /* Strategy Simulator + Payoff Strategy: match heights so the row aligns */
      '.debts-subtab-content.active > div:has(> .what-if-card), ',
      '.debts-subtab-content.active > div:has(> .payoff-strategy-card) { align-items: stretch; }',
      /* Reduce residual gap between strategy grid and the next section */
      '.debts-subtab-content.active > .debts-strategy-grid, ',
      '.debts-subtab-content.active > .what-if-grid { margin-bottom: 18px !important; }',
      /* Tighter typography on card headings */
      '.debts-spend-grid .card h2, .debts-spend-grid .card h3 {',
      '  letter-spacing: -0.01em;',
      '  font-weight: 700;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function boot() {
    injectStyle();
    // Re-inject if a style purge ever happens (defensive)
    setInterval(function () {
      if (!document.getElementById(STYLE_ID)) injectStyle();
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
