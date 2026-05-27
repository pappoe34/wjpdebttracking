/* wjp-txn-stats-bankfilter.js v3 — HIDE the 4 stat boxes (FIX 42).
 *
 * Winston 2026-05-26: "smart summary is basically better than the boxes
 * below and seem to do the same job please get rid of transaction,
 * income, total spend and net cashflow counter. smart summary does
 * the same."
 *
 * Prior v1/v2 of this module tried to make the boxes honor the bank
 * chip filter. Winston decided to simply remove them since Smart
 * Summary already shows the same totals (filtered, transfer-excluded).
 *
 * This module now does ONE thing: injects a small CSS rule that hides
 * #txn-stats-bar and the explanatory subtitle right below it
 * ("— totals exclude bank transfers"). Keeps the file in case we want
 * to re-enable them later — just remove the style block.
 */
(function () {
  'use strict';
  if (window._wjpTxnStatsBankFilterInstalled) return;
  window._wjpTxnStatsBankFilterInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function injectHideStyle() {
    if (document.getElementById('wjp-hide-stats-bar-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-hide-stats-bar-style';
    st.textContent = [
      '/* FIX 42 (Winston 2026-05-26): Smart Summary already shows the same',
      '   numbers, so hide the redundant 4-box stats bar + its subtitle. */',
      '#txn-stats-bar{display:none !important;}',
      // The "— totals exclude bank transfers" subtitle is a sibling div
      // right after the bar. We can't target it by id (host doesn't set one)
      // but it usually has a small font + the exact text. Use the immediately
      // following sibling rule when possible.
      '#txn-stats-bar + div, #txn-stats-bar + p, #txn-stats-bar + span{display:none !important;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);

    // Also walk the DOM for any literal "totals exclude bank transfers"
    // text node sibling that didn't match the CSS adjacent-sibling rule
    // (host might wrap it in extra elements). Defensive — hide via class.
    try {
      var nodes = document.querySelectorAll('div, p, span');
      Array.prototype.forEach.call(nodes, function (n) {
        var t = (n.textContent || '').trim().toLowerCase();
        if (t === '— totals exclude bank transfers' || t === 'totals exclude bank transfers' || /^— totals exclude bank transfers$/i.test(t)) {
          n.style.display = 'none';
        }
      });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHideStyle);
  } else {
    injectHideStyle();
  }
  // Re-run periodically in case the host injects after our CSS
  setInterval(injectHideStyle, 5000);

  window.WJP_TxnStatsBankFilter = { version: 3, hidden: true };
})();
