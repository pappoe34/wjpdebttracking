/* wjp-txn-stats-fix.js v10 — respect bank chip filter v9 — group paychecks by employer v8 — exclude synthetic recurring v7 — memo compares against live DOM v6 — always-run recompute (memo guarded) v5 — fingerprint-skip host calls — memo updates kill flicker v2 — magnitude display + income tooltip v1 — 2026-05-20
 *
 * Two fixes in one module:
 *   1) Smart Summary + Total Spend in Debts > Transactions now EXCLUDES
 *      bank transfers from income/spend totals (transfers are double-counted
 *      otherwise: same $ leaves checking, arrives at credit card).
 *   2) Polishes the transaction detail modal — stronger contrast, cleaner
 *      sections, proper readable provenance + meta rows.
 */
(function () {
  "use strict";
  if (window._wjpTxnStatsFixInstalled) return;
  window._wjpTxnStatsFixInstalled = true;

  // Group income merchants by employer/source so multiple payroll IDs from
  // the same company show as one entry instead of 4 different paychecks.
  function canonicalizeMerchant(m) {
    if (!m) return 'Unknown';
    var raw = String(m);
    var cutMarkers = [' ID:', ' INDN:', ' CO ID:', ' Conf#', ' Confirmation#', ' DES:'];
    var cleaned = raw;
    cutMarkers.forEach(function (mk) {
      var idx = cleaned.indexOf(mk);
      if (idx > 0) cleaned = cleaned.slice(0, idx);
    });
    cleaned = cleaned.replace(/\bPAYROLL\b.*$/i, 'PAYROLL').replace(/\s+/g, ' ').trim();
    if (/freshrealm/i.test(cleaned)) return 'FreshRealm Payroll';
    if (/adp\s*total\s*source|ach.*adp\s*total/i.test(cleaned)) return 'ADP TotalSource Payroll';
    if (/etsy/i.test(cleaned)) return 'Etsy';
    if (/amazon/i.test(cleaned)) return 'Amazon';
    if (/origin\s*financial/i.test(cleaned)) return 'Origin Financial';
    if (/stash/i.test(cleaned)) return 'Stash';
    return cleaned.slice(0, 60);
  }

  // Returns true if a transaction is a bank transfer (account-to-account).
  function isTransfer(t) {
    if (!t) return false;
    var cat = String(t.category || '').toLowerCase();
    var merch = String(t.merchant || '').toLowerCase();
    var method = String(t.method || '').toLowerCase();
    // Common transfer signals
    if (/transfer|interbank|ach\s*transfer|p2p|venmo|zelle|cashapp|paypal\s*transfer/.test(cat)) return true;
    if (/transfer to|transfer from|to checking|from checking|to savings|from savings|to credit/.test(merch)) return true;
    if (/transfer/.test(method)) return true;
    return false;
  }

  // Inject CSS for the modal polish
  function injectModalStyles() {
    if (document.getElementById('wjp-txn-modal-polish')) return;
    var s = document.createElement('style');
    s.id = 'wjp-txn-modal-polish';
    s.textContent = [
      // Solid panel surface with strong contrast in both themes
      'body.light #txn-detail-panel{background:#ffffff !important;color:#0a0a0a !important;}',
      'body.dark #txn-detail-panel,body:not(.light) #txn-detail-panel{background:#13192a !important;color:#f1f5f9 !important;}',
      // Header row above the content (TRANSACTION DETAIL)
      '#txn-detail-panel .txn-detail-header,#txn-detail-panel [class*="detail-header"]{padding:18px 22px 8px !important;border-bottom:1px solid var(--border, rgba(0,0,0,0.08)) !important;}',
      // Inner cards
      '#txn-detail-panel .card{box-shadow:none !important;}',
      'body.light #txn-detail-panel .card{background:#f7f9fc !important;border:1px solid rgba(10,10,10,0.08) !important;}',
      'body.dark #txn-detail-panel .card,body:not(.light) #txn-detail-panel .card{background:#0b1322 !important;border:1px solid rgba(255,255,255,0.08) !important;}',
      // Better contrast on muted text
      'body.light #txn-detail-panel [style*="color: var(--text-3"],body.light #txn-detail-panel [style*="color:var(--text-3"]{color:rgba(10,10,10,0.62) !important;}',
      'body.dark #txn-detail-panel [style*="color: var(--text-3"],body.dark #txn-detail-panel [style*="color:var(--text-3"]{color:rgba(241,245,249,0.6) !important;}',
      // Provenance card pop
      'body.light #txn-detail-panel [style*="PROVENANCE"]+*,body.light #txn-detail-panel .card[style*="margin-top:14px"]{background:#f0f4ff !important;border-color:rgba(99,102,241,0.20) !important;}',
      // Footer buttons row — make Close/Edit/Delete bigger and cleaner
      '#txn-detail-panel button{font-weight:700 !important;}',
      // Backdrop softer (less harsh than 0.55)
      '#txn-detail-backdrop{background:rgba(0,0,0,0.35) !important;backdrop-filter:blur(2px) !important;}',
      // Modal animation: fade in only, no slide
      '#txn-detail-panel.wjp-detail-has-content{animation:wjp-tx-fade-in 0.16s ease both;}',
      '@keyframes wjp-tx-fade-in{from{opacity:0;transform:translate(-50%,-50%) scale(0.96);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}'
    ].join('');
    document.head.appendChild(s);
  }

  // Wrap txnRenderStats to exclude transfers from income/spend
  function patchTxnRenderStats() {
    try {
      // Find the original by tagging window — app.js's txnRenderStats is module-local
      // BUT we can intercept by watching for its output element and recomputing.
      // Simpler: patch the txnGetFiltered (window.txnGetFiltered) to remove transfers
      // before stats are calculated. That changes the table too, which the user wants.
      // We'll wrap the global helpers if exposed.
    } catch (_) {}
  }

  // Memo of last-applied values so we only touch DOM when something actually
  // changed. Eliminates the visible flicker that came from writing textContent
  // on every wrapped renderer call (~6x/sec after rAF coalesce).
  var _lastStats = {};

  // Direct approach: re-render the stats bar ourselves after each render.
  function recomputeStats() {
    try {
      var bar = document.getElementById('txn-stats-bar');
      if (!bar) return;
      var state = (typeof appState !== 'undefined') ? appState : window.appState;
      if (!state || !Array.isArray(state.transactions)) return;
      // Try to read current filter state — txnState is module-private. Best effort:
      // recompute totals on all transactions, excluding transfers.
      // Also exclude synthetic transactions — those are auto-materialized
      // from recurring-payment schedules and shouldn't count until either:
      //   (a) the matching real Plaid transaction confirms, or
      //   (b) the user manually marks the synthetic as confirmed/paid.
      // Plus respect the active account filter (set by the bank chips).
      var accountFilter = 'all';
      try { accountFilter = localStorage.getItem('wjp.tx.accountFilter') || 'all'; } catch (_) {}
      var txns = state.transactions.filter(function (t) {
        if (!t) return false;
        if (t.synthetic === true) return false;
        if (isTransfer(t)) return false;
        if (accountFilter !== 'all' && t.institutionName !== accountFilter) return false;
        return true;
      });
      var income = 0, spend = 0;
      txns.forEach(function (t) {
        var a = Number(t.amount) || 0;
        if (a > 0) income += a;
        else if (a < 0) spend += a;
      });
      var net = income + spend;
      var fmt = function (n) {
        var v = Math.abs(Math.round(n));
        var sign = n > 0 ? '+' : (n < 0 ? '-' : '');
        return sign + '$' + v.toLocaleString('en-US');
      };
      // Income merchant breakdown — grouped by employer/source for clean tooltip
      var incomeMerchants = {};
      txns.forEach(function (t) {
        var a = Number(t.amount) || 0;
        if (a > 0) {
          var m = canonicalizeMerchant(t.merchant || 'Unknown');
          incomeMerchants[m] = (incomeMerchants[m] || 0) + a;
        }
      });
      var topIncome = Object.keys(incomeMerchants)
        .sort(function (a, b) { return incomeMerchants[b] - incomeMerchants[a]; })
        .slice(0, 6)
        .map(function (m) { return m + ': $' + Math.round(incomeMerchants[m]).toLocaleString('en-US'); })
        .join('\n');

      // Display helpers — total spend shows as a clean positive magnitude (e.g. "$134,721")
      // since the column label already says "Total Spend". The minus on a money figure was confusing users.
      var fmtMagnitude = function (n) { return '$' + Math.abs(Math.round(n)).toLocaleString('en-US'); };
      var fmtNet = function (n) {
        var sign = n > 0 ? '+' : (n < 0 ? '-' : '');
        return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
      };

      // Update the four stats cards by querying their labels — but ONLY when
      // the value actually changed (memo). Prevents DOM churn / flicker.
      function setIfChanged(el, key, newVal) {
        // Compare against the CURRENT DOM value (host may have rewritten the
        // card after we last set it). Only writes when truly different.
        if (el.textContent === newVal) {
          _lastStats[key] = newVal;
          return;
        }
        _lastStats[key] = newVal;
        el.textContent = newVal;
      }
      var cards = bar.querySelectorAll('.card');
      cards.forEach(function (c) {
        var labelEl = c.querySelector('.card-label');
        var valueEl = c.querySelector('div:last-child');
        if (!labelEl || !valueEl) return;
        var label = labelEl.textContent.trim().toLowerCase();
        if (label === 'transactions') {
          setIfChanged(valueEl, 'txns', txns.length.toLocaleString());
        } else if (label === 'total income') {
          setIfChanged(valueEl, 'income', '+' + fmtMagnitude(income));
          // Only set title once per change (avoids repaints)
          var nextTitle = 'Top income sources (all time, transfers excluded):\n' + topIncome;
          if (_lastStats.incomeTitle !== nextTitle) { c.title = nextTitle; _lastStats.incomeTitle = nextTitle; c.style.cursor = 'help'; }
        } else if (label === 'total spend') {
          setIfChanged(valueEl, 'spend', fmtMagnitude(spend));
          if (!_lastStats.spendTitle) { c.title = 'Total spent (all time, transfers excluded).'; _lastStats.spendTitle = 1; }
        } else if (label === 'net cash flow') {
          setIfChanged(valueEl, 'net', fmtNet(net));
        }
      });
      // Append a small "excluding transfers" footnote to the bar
      if (!bar.querySelector('.wjp-tsf-note')) {
        var note = document.createElement('div');
        note.className = 'wjp-tsf-note';
        note.style.cssText = 'grid-column:1 / -1;font-size:11px;color:var(--text-3,#94a3b8);padding-top:4px;font-style:italic;';
        note.textContent = '— totals exclude bank transfers';
        bar.appendChild(note);
      }
    } catch (e) {
      try { console.warn('[wjp-txn-stats-fix] recompute fail', e); } catch (_) {}
    }
  }

  // Hook into the host renderer with fingerprint-skip. Host updateUI hammers
  // txnRenderAll ~6-60x/sec; nearly all those calls re-render the same data.
  // We compute a cheap fingerprint of the txn list and SKIP the entire host
  // function when nothing has changed. Eliminates the visible stats flicker.
  function txnFingerprint() {
    try {
      var st = (typeof appState !== 'undefined') ? appState : window.appState;
      if (!st || !Array.isArray(st.transactions)) return '0';
      // Fingerprint only REAL (non-synthetic) transactions. Synthetic recurring
      // schedules tick automatically and would otherwise force re-renders.
      var real = st.transactions.filter(function (t) { return t && !t.synthetic; });
      return real.length + '|' + (real.length ? (real[real.length-1].id || real[real.length-1].date || '') : '');
    } catch (_) { return Date.now() + ''; }
  }
  function wrapRenderer() {
    try {
      var fn = window.txnRenderAll;
      if (typeof fn !== 'function' || fn.__wjpTsfWrapped) return false;
      var lastFp = '';
      var wrapped = function () {
        var fp = txnFingerprint();
        var changed = (fp !== lastFp);
        var r;
        if (changed) {
          lastFp = fp;
          r = fn.apply(this, arguments); // host runs (writes its own values)
        }
        // ALWAYS run our recompute. It's memo-guarded so a no-op when values
        // haven't changed (no DOM writes). When the host just ran, this
        // overwrites the host's unfiltered values with our transfer-excluded
        // ones. On skip-host cycles, this catches any case where the host's
        // values are still showing because we beat it on a previous call.
        try { recomputeStats(); } catch (_) {}
        return r;
      };
      wrapped.__wjpTsfWrapped = true;
      window.txnRenderAll = wrapped;
      return true;
    } catch (_) { return false; }
  }

  function boot() {
    injectModalStyles();
    if (!wrapRenderer()) {
      [500, 1500, 4000, 9000].forEach(function (ms) {
        setTimeout(wrapRenderer, ms);
      });
    }
    setTimeout(recomputeStats, 1500);
    // React to bank-chip clicks: recompute stats immediately when filter changes.
    document.addEventListener('wjp-account-filter-changed', function () {
      try { recomputeStats(); } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
