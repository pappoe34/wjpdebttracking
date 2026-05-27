/* wjp-txn-stats-bankfilter.js v1 — Fix the 4 stats boxes to honor the
 * active bank chip filter.
 *
 * Winston FIX 39C: clicking a bank chip changes the Smart Summary but
 * the TRANSACTIONS / TOTAL INCOME / TOTAL SPEND / NET CASH FLOW boxes
 * stay at the all-time numbers. Root cause: wjp-txn-stats-fix uses
 * `t.institutionName !== accountFilter` for the bank filter, but
 * accountFilter is the chip key (e.g. "Bank of America Checking… ··9298")
 * while institutionName is the bare bank name ("Bank of America").
 * They never match, so the filter has no effect.
 *
 * Fix: this module re-computes the 4 boxes using window.WJP_TxAccountKey
 * (the same key derivation the chips use) and writes the values back to
 * the existing DOM elements. Runs on the same triggers as the host
 * (account-filter-changed event + transactions-changed + 2s tick).
 */
(function () {
  'use strict';
  if (window._wjpTxnStatsBankFilterInstalled) return;
  window._wjpTxnStatsBankFilterInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }

  function isTransfer(t) {
    if (!t) return false;
    if (t.userCategoryId === 'transfer') return true;
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
        return !!window.WJP_TxSmartCategorize.isTransfer(t);
      }
    } catch (_) {}
    var fields = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(fields);
  }

  function accountKey(t) {
    if (window.WJP_TxAccountKey) {
      try { return window.WJP_TxAccountKey(t); } catch (_) {}
    }
    return t.institutionName || 'Bank';
  }

  function getActiveFilter() {
    try { return localStorage.getItem('wjp.tx.accountFilter') || 'all'; } catch (_) { return 'all'; }
  }

  function fmtUsdSigned(n) {
    if (!isFinite(n)) return '$0';
    var s = n >= 0 ? '+' : '-';
    return s + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:0 });
  }
  function fmtUsd(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:0 });
  }

  // Find the stat values inside #txn-stats-bar. The host renders cards
  // each with a label + a number. We grab the 4 cards by the label text.
  function findStatCard(bar, label) {
    var cards = bar.querySelectorAll('div, section, article');
    var match = null;
    var lbl = label.toLowerCase().replace(/\s+/g,' ');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var txt = (c.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      // The label is at the start of the card text
      if (txt.indexOf(lbl) === 0 && c.children.length <= 6) {
        match = c;
        break;
      }
    }
    return match;
  }

  function valueElementOf(card) {
    // The host renders a big number child — find the largest-font child
    if (!card) return null;
    var best = null, bestSize = 0;
    Array.prototype.forEach.call(card.querySelectorAll('div, span, h1, h2, h3, h4, p, strong'), function (e) {
      var cs = window.getComputedStyle(e);
      var size = parseFloat(cs.fontSize) || 0;
      if (size > bestSize) {
        bestSize = size;
        best = e;
      }
    });
    return best;
  }

  var _last = '';
  function recompute() {
    try {
      var s = getState();
      if (!s || !Array.isArray(s.transactions)) return;
      var bar = document.getElementById('txn-stats-bar');
      if (!bar) return;
      var filter = getActiveFilter();
      var txns = s.transactions.filter(function (t) {
        if (!t) return false;
        if (t.synthetic) return false;
        if (isTransfer(t)) return false;
        if (filter && filter !== 'all') {
          if (accountKey(t) !== filter) return false;
        }
        return true;
      });
      var income = 0, spend = 0;
      txns.forEach(function (t) {
        var a = Number(t.amount) || 0;
        if (a > 0) income += a;
        else if (a < 0) spend += Math.abs(a);
      });
      var net = income - spend;
      var sig = filter + '|' + txns.length + '|' + income.toFixed(2) + '|' + spend.toFixed(2);
      if (sig === _last) return;
      _last = sig;

      var txCard = findStatCard(bar, 'transactions');
      var incCard = findStatCard(bar, 'total income');
      var spdCard = findStatCard(bar, 'total spend');
      var netCard = findStatCard(bar, 'net cash flow');

      var txEl = valueElementOf(txCard);
      var incEl = valueElementOf(incCard);
      var spdEl = valueElementOf(spdCard);
      var netEl = valueElementOf(netCard);

      if (txEl) txEl.textContent = txns.length.toLocaleString('en-US');
      if (incEl) incEl.textContent = fmtUsdSigned(income);
      if (spdEl) spdEl.textContent = fmtUsd(spend);
      if (netEl) netEl.textContent = fmtUsdSigned(net);

      // Update subtitle if we can find "totals exclude bank transfers"
      var subtitle = bar.parentElement ? bar.parentElement.querySelector('div, span, p') : null;
      // Add filter pill in the bar header if not present
      var fp = bar.querySelector('.wjp-stats-filter-pill');
      if (filter && filter !== 'all') {
        if (!fp) {
          fp = document.createElement('div');
          fp.className = 'wjp-stats-filter-pill';
          fp.style.cssText = 'font-size:10px;font-weight:700;color:#1f7a4a;background:rgba(31,122,74,0.10);border:1px solid rgba(31,122,74,0.30);border-radius:6px;padding:3px 8px;margin:0 0 8px 4px;display:inline-block;';
          bar.insertBefore(fp, bar.firstChild);
        }
        fp.textContent = '↓ filtered to ' + filter;
      } else if (fp) {
        fp.remove();
      }
    } catch (_) {}
  }

  function boot() {
    // Initial
    setTimeout(recompute, 1500);
    // React to chip clicks
    document.addEventListener('wjp-account-filter-changed', function () {
      setTimeout(recompute, 50);
    });
    // React to txn data changes
    window.addEventListener('wjp-transactions-changed', function () {
      setTimeout(recompute, 50);
    });
    window.addEventListener('wjp-tx-rerendered', function () {
      setTimeout(recompute, 50);
    });
    // Safety tick — runs every 2s. Sig check makes the no-op path free.
    setInterval(recompute, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TxnStatsBankFilter = { version: 1, recompute: recompute };
})();
