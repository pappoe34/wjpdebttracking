/* wjp-tx-analysis-relocate.js v1 — move "Transaction Analysis & Wealth
 * Signals" card to the BOTTOM of the Transactions sub-tab.
 *
 * Winston 2026-05-27: "move transaction analysis down".
 *
 * Currently sits above Billing History + Total spent by transaction. The
 * card itself is mostly informational ("Add a few transactions and your
 * trends will be analyzed here…") so it should sit BELOW the data
 * widgets, not above them.
 *
 * Strategy: find the .ai-performance-card inside the transactions sub-tab
 * and append it to the end of the same sub-tab's content container. Safe
 * + idempotent — uses a data-attribute flag to avoid re-moving on every
 * tick. Re-checks periodically in case the host re-renders.
 */
(function () {
  'use strict';
  if (window._wjpTxAnalysisRelocateInstalled) return;
  window._wjpTxAnalysisRelocateInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function relocate() {
    var sub = document.querySelector('.debts-subtab-content[data-subtab="transactions"]');
    if (!sub) return false;
    // Find the AI Transaction Analysis card. It's the one whose title contains
    // "Transaction Analysis" inside the transactions sub-tab.
    var card = null;
    var candidates = sub.querySelectorAll('.ai-performance-card');
    Array.prototype.forEach.call(candidates, function (c) {
      var title = c.querySelector('.ai-perf-title');
      if (title && /transaction analysis/i.test(title.textContent || '')) {
        card = c;
      }
    });
    if (!card) return false;

    // If it's already the last meaningful child of the sub-tab, nothing to do.
    var lastReal = sub.lastElementChild;
    while (lastReal && (lastReal === card || lastReal.tagName === 'SCRIPT' || lastReal.style.display === 'none')) {
      lastReal = lastReal.previousElementSibling;
    }
    if (card.getAttribute('data-wjp-relocated') === '1' && sub.lastElementChild === card) {
      return true; // already moved
    }
    sub.appendChild(card);
    card.setAttribute('data-wjp-relocated', '1');
    card.style.marginTop = '24px';
    return true;
  }

  function boot() {
    relocate();
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      relocate();
      if (attempts > 40) clearInterval(iv);
    }, 1000);
    window.addEventListener('wjp-tx-rerendered', function () { setTimeout(relocate, 200); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(relocate, 200); });
    setInterval(relocate, 4000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TxAnalysisRelocate = { version: 1, relocate: relocate };
})();
