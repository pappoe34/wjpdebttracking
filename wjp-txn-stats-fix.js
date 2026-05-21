/* wjp-txn-stats-fix.js v16 — wire Close/X to closeAll() + custom delete confirmation modal v15 — raise panel z-index above backdrop so dim only paints OUTSIDE the modal v14 — closeAll removes body.wjp-txn-detail-open class (owner module gates backdrop visibility on it) v13 — closeAll uses display:none (centered panel ignored right:-440) v12 — soften backdrop dim (0.35→0.18) + robust click-outside/save dismiss v11 — kill backdrop-filter blur (was blurring whole app) v10 — respect bank chip filter v9 — group paychecks by employer v8 — exclude synthetic recurring v7 — memo compares against live DOM v6 — always-run recompute (memo guarded) v5 — fingerprint-skip host calls — memo updates kill flicker v2 — magnitude display + income tooltip v1 — 2026-05-20
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
      '#txn-detail-backdrop{background:rgba(0,0,0,0.18) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;cursor:pointer !important;z-index:9998 !important;}','#txn-detail-panel{z-index:9999 !important;}',
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

  // v12 — Harden txn-detail dismiss:
  //   - rebind backdrop click → close panel + backdrop (idempotent)
  //   - Esc closes when backdrop visible
  //   - listen for global txn edit save events (toast 'Saved' or appState
  //     change after Edit) so save also hides the backdrop.
  function hardenTxnDetailDismiss() {
    if (window._wjpTxnDetailDismissHardened) return;
    window._wjpTxnDetailDismissHardened = true;
    function closeAll() {
      var p = document.getElementById('txn-detail-panel');
      var b = document.getElementById('txn-detail-backdrop');
      // v14 fix: the owner module (wjp-txn-detail-modal.js) gates backdrop
      // visibility on `body.wjp-txn-detail-open` via `display:block !important`.
      // Inline display:none can't beat that, so we MUST drop the body class
      // first. Then class+inline cleanup on panel.
      try { document.body.classList.remove('wjp-txn-detail-open'); } catch (_) {}
      if (p) {
        p.classList.add('wjp-detail-empty');
        p.classList.remove('wjp-detail-has-content');
        p.style.display = 'none';
        p.style.right = '-440px';
        p.style.opacity = '0';
      }
      if (b) {
        b.style.display = 'none';
      }
      // Clear inner content so the owner module's empty-detection path
      // also marks the panel as not-open on its next tick.
      var c = document.getElementById('txn-detail-content');
      if (c) c.innerHTML = '';
    }
    // Wrap the global txnShowDetail so EVERY open also re-shows display:block
    // (in case a prior close left display:none stuck on the panel).
    try {
      if (typeof window.txnShowDetail === 'function' && !window.txnShowDetail._wjpWrapped) {
        var origShow = window.txnShowDetail;
        window.txnShowDetail = function () {
          var p = document.getElementById('txn-detail-panel');
          var b = document.getElementById('txn-detail-backdrop');
          if (p) p.style.display = '';
          if (b) b.style.display = '';
          return origShow.apply(this, arguments);
        };
        window.txnShowDetail._wjpWrapped = true;
      }
    } catch (_) {}

    // v16 — Replace the panel's Close/X buttons + Delete confirmation each
    // time the panel re-renders, by walking the panel after content changes.
    function rewirePanelActions() {
      var p = document.getElementById('txn-detail-panel');
      if (!p) return;
      var content = document.getElementById('txn-detail-content');
      if (!content) return;
      // Find buttons by label text since they're inline-rendered each open
      var buttons = p.querySelectorAll('button');
      buttons.forEach(function (btn) {
        var label = (btn.textContent || '').trim().toLowerCase();
        // X close (the ✕ at top-right)
        if (label === '✕' && !btn._wjpRewired) {
          btn._wjpRewired = true;
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeAll();
          }, true);
        }
        // Footer Close button
        if (label === 'close' && !btn._wjpRewired) {
          btn._wjpRewired = true;
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeAll();
          }, true);
        }
        // Footer Delete button — intercept and show custom confirmation
        if (label.indexOf('delete') !== -1 && !btn._wjpDeleteRewired) {
          btn._wjpDeleteRewired = true;
          btn.addEventListener('click', function (e) {
            // Try to recover the txnId from the panel's inline edit button data
            var editBtn = document.getElementById('txn-detail-edit-btn');
            var txnId = editBtn && editBtn.getAttribute('data-txn-id');
            if (!txnId) return; // let original handler run
            e.preventDefault();
            e.stopPropagation();
            showDeleteConfirm(txnId);
          }, true);
        }
      });
    }

    // Custom delete confirmation modal — much clearer than native confirm()
    function showDeleteConfirm(txnId) {
      var s; try { s = appState; } catch (_) {}
      var t = s && Array.isArray(s.transactions) && s.transactions.find(function (x) { return x.id === txnId; });
      var merchantName = (t && t.merchant) || 'this transaction';
      var amount = t && typeof t.amount === 'number'
        ? (t.amount < 0 ? '-$' : '+$') + Math.abs(t.amount).toFixed(2)
        : '';
      var existing = document.getElementById('wjp-delete-confirm');
      if (existing) existing.remove();
      var modal = document.createElement('div');
      modal.id = 'wjp-delete-confirm';
      modal.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif;';
      modal.innerHTML =
        '<div style="background:var(--card,#fff);color:var(--ink,#0a0a0a);max-width:420px;width:100%;border-radius:16px;border:1px solid var(--border,rgba(0,0,0,0.1));box-shadow:0 30px 80px rgba(0,0,0,0.40);padding:24px;">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:rgba(255,77,109,0.14);display:flex;align-items:center;justify-content:center;font-size:20px;">🗑️</div>' +
            '<div>' +
              '<div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;">Delete this transaction?</div>' +
              '<div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:2px;">This can\'t be undone.</div>' +
            '</div>' +
          '</div>' +
          '<div style="background:var(--bg-3,rgba(0,0,0,0.04));border:1px solid var(--border,rgba(0,0,0,0.08));border-radius:10px;padding:11px 14px;margin-bottom:18px;">' +
            '<div style="font-size:12.5px;font-weight:700;">' + escapeHtml(merchantName) + '</div>' +
            (amount ? '<div style="font-size:13px;font-weight:800;color:' + (t && t.amount < 0 ? '#c0594a' : '#1f7a4a') + ';margin-top:2px;">' + amount + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
            '<button id="wjp-dc-cancel" type="button" style="padding:9px 18px;border-radius:9px;background:var(--bg-3,rgba(0,0,0,0.05));color:var(--ink,#0a0a0a);border:1px solid var(--border,rgba(0,0,0,0.10));font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;">Cancel</button>' +
            '<button id="wjp-dc-confirm" type="button" style="padding:9px 18px;border-radius:9px;background:#ff4d6d;color:#fff;border:1px solid #ff4d6d;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;">Delete</button>' +
          '</div>' +
        '</div>';
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
      document.getElementById('wjp-dc-cancel').onclick = function () { modal.remove(); };
      document.getElementById('wjp-dc-confirm').onclick = function () {
        try {
          if (s && Array.isArray(s.transactions)) {
            s.transactions = s.transactions.filter(function (x) { return x.id !== txnId; });
          }
          if (typeof window.saveState === 'function') window.saveState();
          if (typeof window.renderTransactions === 'function') window.renderTransactions();
          if (typeof window.txnRenderAll === 'function') window.txnRenderAll();
          if (typeof window.showToast === 'function') window.showToast('Transaction deleted.');
        } catch (e2) { console.warn('[wjp-tx-delete]', e2); }
        modal.remove();
        closeAll();
      };
      // Esc closes the confirm
      var k = function (e) {
        if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', k); }
      };
      document.addEventListener('keydown', k);
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // Run rewire whenever the panel content changes (each time a row is clicked)
    function watchPanelForRewire() {
      var content = document.getElementById('txn-detail-content');
      if (!content || content._wjpRewireObserved) return;
      content._wjpRewireObserved = true;
      var mo = new MutationObserver(function () {
        // Debounce via rAF
        if (content._wjpRewirePending) return;
        content._wjpRewirePending = true;
        requestAnimationFrame(function () {
          content._wjpRewirePending = false;
          try { rewirePanelActions(); } catch (_) {}
        });
      });
      mo.observe(content, { childList: true, subtree: true });
    }
    setInterval(watchPanelForRewire, 4000);
    setTimeout(watchPanelForRewire, 1500);
    function bindBackdrop() {
      var b = document.getElementById('txn-detail-backdrop');
      if (!b || b._wjpDismissBound) return;
      b._wjpDismissBound = true;
      b.addEventListener('click', function (e) {
        // Only close if click landed on the backdrop itself (not bubbling from panel)
        if (e.target === b) closeAll();
      }, true);
    }
    bindBackdrop();
    setInterval(bindBackdrop, 4000);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var b = document.getElementById('txn-detail-backdrop');
      if (b && b.style.display !== 'none') closeAll();
    });
    // Hook into the txn edit modal — when user saves, app fires renderTransactions
    // + showToast('Saved!') etc. We listen for the post-save event by wrapping
    // saveState (existing global) if available.
    try {
      if (typeof window.saveState === 'function' && !window.saveState._wjpDismissWrapped) {
        var orig = window.saveState;
        window.saveState = function () {
          var r = orig.apply(this, arguments);
          // If the txn edit modal is open and we just saved, close detail too.
          var em = document.querySelector('.wjp-txn-edit-modal, #txn-edit-modal, [data-txn-edit-modal]');
          if (em) closeAll();
          return r;
        };
        window.saveState._wjpDismissWrapped = true;
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hardenTxnDetailDismiss);
  } else {
    hardenTxnDetailDismiss();
  }

})();
