/* wjp-debt-detail-enhance.js v1 — Inject the 5 Winston-requested
 * improvements into the existing AI Breakdown / debt detail card on the
 * Recurring Payments tab.
 *
 * Winston 2026-05-26: "this already exist in recurring, just improve and
 * add to it to make it better." Plus: payment progress bar.
 *
 * Adds to each expanded card under #wjp-rt-grid > div[data-wjp-rt-key=…]:
 *   1. Payment progress bar — "Paid $X of $Y this cycle (Z%)"
 *   2. Linked payments history — last 6 txns linked to this debt's
 *      derived recurring schedule, with status pill + amount + date.
 *   3. "Mark as Paid" button — opens the link picker scoped to this debt.
 *   4. Annual fee + fee charge month fields (in Edit Data area).
 *   5. Reminder controls — toggle 'Notify before due/fee', days-out picker.
 *
 * Storage:
 *   • appState.debts[i].annualFee        (number, optional)
 *   • appState.debts[i].annualFeeMonth   (1-12, optional)
 *   • appState.debts[i].reminderDays     (default 3)
 *   • appState.debts[i].reminderEnabled  (default false)
 *
 * Universal — works for any user. No hardcoded names. Idempotent install.
 * Re-injects on appState/recurring change via 1.5s throttled tick.
 */
(function () {
  'use strict';
  if (window._wjpDebtDetailEnhanceInstalled) return;
  window._wjpDebtDetailEnhanceInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function fmtUsd(n) {
    n = Number(n) || 0;
    return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtDateShort(s) {
    if (!s) return '';
    try { var d = new Date(String(s).slice(0,10) + 'T12:00:00'); return d.toLocaleDateString('en-US', { month:'short', day:'numeric' }); } catch (_) { return s; }
  }
  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function statusPill(status) {
    var palette = {
      confirmed: { bg:'rgba(31,122,74,0.12)', border:'rgba(31,122,74,0.35)', fg:'#1f7a4a', label:'✓ Confirmed' },
      cleared:   { bg:'rgba(59,130,246,0.12)', border:'rgba(59,130,246,0.35)', fg:'#2563eb', label:'⊙ Cleared' },
      pending:   { bg:'rgba(251,191,36,0.15)', border:'rgba(251,191,36,0.40)', fg:'#b45309', label:'⏳ Pending' }
    };
    var c = palette[status] || palette.pending;
    return '<span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:6px;background:'+c.bg+';border:1px solid '+c.border+';color:'+c.fg+';font-size:10px;font-weight:700;">'+c.label+'</span>';
  }

  function findDebtById(debtId) {
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return null;
    return s.debts.find(function (d) { return d && d.id === debtId; }) || null;
  }
  function findDerivedRecurring(debtId) {
    var s = getState();
    if (!s || !Array.isArray(s.recurringPayments)) return null;
    return s.recurringPayments.find(function (r) { return r && r.derivedFromDebtId === debtId; }) || null;
  }
  function linkedTxnsFor(rp) {
    var s = getState();
    if (!s || !Array.isArray(s.transactions) || !rp) return [];
    var ids = Array.isArray(rp.linkedTxnIds) ? rp.linkedTxnIds : [];
    return ids.map(function (id) {
      return s.transactions.find(function (t) { return t && t.id === id; });
    }).filter(Boolean).sort(function (a, b) {
      return new Date(b.date||0) - new Date(a.date||0);
    });
  }

  // ───────── style injection (once) ─────────
  function injectStyle() {
    if (document.getElementById('wjp-debt-detail-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-debt-detail-style';
    st.textContent = [
      '.wjp-debt-enh{margin:14px 16px;padding:14px;border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:12px;background:var(--bg-2, rgba(31,122,74,0.03));font-family:inherit;}',
      '.wjp-debt-enh-section{margin-bottom:14px;}',
      '.wjp-debt-enh-section:last-child{margin-bottom:0;}',
      '.wjp-debt-enh-label{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim, #6b7280);margin-bottom:6px;}',
      '.wjp-debt-enh-bar{height:8px;border-radius:999px;background:var(--bg-3, rgba(0,0,0,0.06));overflow:hidden;}',
      '.wjp-debt-enh-bar > div{height:100%;border-radius:999px;background:linear-gradient(90deg, #1f7a4a, #15a065);transition:width 0.4s ease;}',
      '.wjp-debt-enh-progress-meta{display:flex;justify-content:space-between;font-size:11px;color:var(--ink, var(--text-1, #1f1a14));margin-top:6px;font-weight:600;}',
      '.wjp-debt-enh-linked-list{display:flex;flex-direction:column;gap:6px;max-height:180px;overflow:auto;}',
      '.wjp-debt-enh-linked-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;background:var(--bg-1, #fff);border:1px solid var(--border, rgba(0,0,0,0.06));border-radius:8px;font-size:12px;}',
      '.wjp-debt-enh-linked-row .m{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '.wjp-debt-enh-linked-row .a{font-weight:700;color:#1f7a4a;}',
      '.wjp-debt-enh-linked-row .d{color:var(--ink-dim, #6b7280);font-size:11px;}',
      '.wjp-debt-enh-empty{font-size:12px;color:var(--ink-dim, #6b7280);padding:10px;text-align:center;border:1px dashed var(--border, rgba(0,0,0,0.10));border-radius:8px;}',
      '.wjp-debt-enh-row{display:flex;gap:10px;align-items:center;margin-bottom:8px;}',
      '.wjp-debt-enh-row label{font-size:11px;font-weight:600;color:var(--ink-dim, #6b7280);flex-shrink:0;min-width:110px;}',
      '.wjp-debt-enh-row input, .wjp-debt-enh-row select{flex:1;padding:6px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:6px;font-size:12px;font-family:inherit;background:var(--bg-1, #fff);color:var(--ink, var(--text-1, #1f1a14));}',
      '.wjp-debt-enh-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid;font-family:inherit;background:#1f7a4a;color:#fff;border-color:#1f7a4a;}',
      '.wjp-debt-enh-btn:hover{filter:brightness(1.05);}',
      '.wjp-debt-enh-btn.sec{background:var(--bg-3, rgba(0,0,0,0.05));color:var(--ink, var(--text-1, #1f1a14));border-color:var(--border, rgba(0,0,0,0.15));}',
      '.wjp-debt-enh-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
      '.wjp-debt-enh-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ink, var(--text-1, #1f1a14));cursor:pointer;}',
      '.wjp-debt-enh-toggle input{margin:0;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───────── compute progress (FIX 36C — Winston) ─────────
  // For credit cards (has .limit / .creditLimit): show paydown progress
  //   pct = (limit - balance) / limit * 100  → "available credit"
  //   label = 'Used $X of $Y limit (Z% used)'
  // For loans (originalBalance > balance): show paydown progress
  //   pct = (originalBalance - balance) / originalBalance * 100
  //   label = 'Paid $X of $Y (Z%)'
  // For everything else: fallback to per-cycle payment progress.
  function computeProgress(debt, rp) {
    if (!debt) return { paid: 0, target: 0, pct: 0, label: '', subtext: '' };

    var balance = Math.abs(Number(debt.balance) || Number(debt.currentBalance) || 0);
    var limit = Math.abs(Number(debt.creditLimit) || Number(debt.limit) || Number(debt.creditLine) || 0);
    var origBal = Math.abs(Number(debt.originalBalance) || Number(debt.startingBalance) || 0);

    // Credit card path — non-zero limit + (it's truly a card, not a loan)
    var isCard = limit > 0 && (debt.type === 'credit' || debt.type === 'card' || debt.type === 'creditCard' || limit >= balance);
    if (isCard && limit > 0) {
      var used = Math.min(balance, limit);
      var usedPct = Math.min(100, Math.round((used / limit) * 100));
      // v2 (Winston 2026-05-26): bar shows UTILIZATION directly — fuller bar
      // means more of the limit is used (worse for credit score). Matches the
      // existing '88% util' badge in the AI Breakdown summary.
      return {
        paid: used,
        target: limit,
        pct: usedPct,
        mode: 'utilization',
        label: 'Used ' + fmtUsd(used) + ' of ' + fmtUsd(limit) + ' limit (' + usedPct + '% utilization)',
        subtext: (rp && rp.nextDate) ? ('Next due ' + fmtDateShort(rp.nextDate)) : ''
      };
    }

    // Loan path — original balance present and > current balance
    if (origBal > 0 && origBal >= balance) {
      var paid = origBal - balance;
      var pct = origBal > 0 ? Math.min(100, Math.round((paid / origBal) * 100)) : 0;
      return {
        paid: paid,
        target: origBal,
        pct: pct,
        label: 'Paid ' + fmtUsd(paid) + ' of ' + fmtUsd(origBal) + ' (' + pct + '%)',
        subtext: (rp && rp.nextDate) ? ('Next due ' + fmtDateShort(rp.nextDate)) : ''
      };
    }

    // Fallback per-cycle progress (original behaviour)
    if (!rp) return { paid: 0, target: 0, pct: 0, label: 'No progress data yet', subtext: '' };
    var target = Math.abs(Number(rp.amount) || Number(debt.minimumPayment) || Number(debt.minPayment) || 0);
    if (!target) return { paid: 0, target: 0, pct: 0, label: 'No payment target set', subtext: '' };
    var nextMs = rp.nextDate ? new Date(rp.nextDate + 'T12:00:00').getTime() : 0;
    var freqDays = 30;
    if (rp.frequency === 'weekly') freqDays = 7;
    else if (rp.frequency === 'biweekly') freqDays = 14;
    else if (rp.frequency === 'quarterly') freqDays = 91;
    else if (rp.frequency === 'yearly') freqDays = 365;
    var cycleStartMs = nextMs - (freqDays * 24 * 60 * 60 * 1000);
    var linked = linkedTxnsFor(rp);
    var paidCycle = 0;
    linked.forEach(function (t) {
      var ms = new Date(String(t.date || '').slice(0,10) + 'T12:00:00').getTime();
      if (ms >= cycleStartMs && ms <= nextMs) paidCycle += Math.abs(Number(t.amount) || 0);
    });
    var pctCycle = Math.min(100, Math.round((paidCycle / target) * 100));
    return {
      paid: paidCycle,
      target: target,
      pct: pctCycle,
      label: 'Paid ' + fmtUsd(paidCycle) + ' of ' + fmtUsd(target) + ' this cycle (' + pctCycle + '%)',
      subtext: (rp && rp.nextDate) ? ('Next due ' + fmtDateShort(rp.nextDate)) : ''
    };
  }

  // ───────── build the enhancement block HTML (v4 — utilization-only) ─────────
  // Winston 2026-05-26 (FIX 37): "credit utilization should show but
  // everything else should exist in setting and work in the background."
  // We now render only the utilization/paydown bar here. Linked payments,
  // Mark as Paid, annual fee, reminders moved to Settings and operate
  // automatically via the link engine + reminder runner.
  function buildEnhancementHtml(debt) {
    var rp = findDerivedRecurring(debt.id);
    var prog = computeProgress(debt, rp);

    var progTitle = (Number(debt.creditLimit) || Number(debt.limit)) > 0 ? 'Credit utilization' : 'Payment progress';
    var barGradient;
    if (prog.mode === 'utilization') {
      if (prog.pct >= 70) barGradient = 'linear-gradient(90deg, #c0594a, #b91c1c)';
      else if (prog.pct >= 30) barGradient = 'linear-gradient(90deg, #fbbf24, #d97706)';
      else barGradient = 'linear-gradient(90deg, #1f7a4a, #15a065)';
    } else {
      barGradient = 'linear-gradient(90deg, #1f7a4a, #15a065)';
    }
    var progBar = '<div class="wjp-debt-enh-section">' +
      '<div class="wjp-debt-enh-label">' + progTitle + '</div>' +
      '<div class="wjp-debt-enh-bar"><div style="width:' + prog.pct + '%;background:' + barGradient + ';"></div></div>' +
      '<div class="wjp-debt-enh-progress-meta">' +
        '<span>' + htmlEscape(prog.label || '') + '</span>' +
        '<span>' + htmlEscape(prog.subtext || '') + '</span>' +
      '</div>' +
    '</div>';

    return '<div class="wjp-debt-enh" data-debt-id="' + htmlEscape(debt.id) + '">' + progBar + '</div>';
  }

  // No-op kept so injectAll's call site remains valid. All editable
  // controls moved to Settings (FIX 38 — wjp-debt-settings.js).
  function wireBlock(block, debt) { /* intentionally empty */ }

  // ───────── inject into every expanded debt card ─────────
  // FIX 36B (2026-05-26 Winston): NEVER rebuild a block that already exists,
  // or input fields lose focus / their typed values every 1.5s. Only inject
  // when the block is missing. Updates to linked-payments + progress flow
  // through targeted DOM patches via patchProgressAndLinked().
  function injectAll() {
    var grid = document.getElementById('wjp-rt-grid');
    if (!grid) return;
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return;
    Array.prototype.forEach.call(grid.querySelectorAll('[data-wjp-rt-key]'), function (card) {
      var key = card.getAttribute('data-wjp-rt-key');
      var debt = s.debts.find(function (d) {
        return d && (d.id === key || ('plaid:' + d.id) === key || d.id === ('plaid:' + key));
      });
      if (!debt) return;
      var bodyText = (card.textContent || '');
      var isExpanded = bodyText.length > 200 && /AI breakdown|EDIT DATA|Min\/mo|What this is/i.test(bodyText);
      var existing = card.querySelector('.wjp-debt-enh');
      if (!isExpanded) {
        if (existing) existing.remove();
        return;
      }
      if (existing) {
        // Already present — just refresh the progress bar
        try { patchProgressAndLinked(existing, debt); } catch (_) {}
        return;
      }
      var wrapper = document.createElement('div');
      wrapper.innerHTML = buildEnhancementHtml(debt);
      var block = wrapper.firstElementChild;
      // v4 (FIX 37, Winston 2026-05-26): block now contains ONLY the
      // utilization/progress bar — always visible, no toggle.
      card.appendChild(block);
    });
  }

  // Refresh just the progress bar in place.
  function patchProgressAndLinked(block, debt) {
    var rp = findDerivedRecurring(debt.id);
    var prog = computeProgress(debt, rp);
    var bar = block.querySelector('.wjp-debt-enh-bar > div');
    if (bar) {
      bar.style.width = prog.pct + '%';
      var grad;
      if (prog.mode === 'utilization') {
        if (prog.pct >= 70) grad = 'linear-gradient(90deg, #c0594a, #b91c1c)';
        else if (prog.pct >= 30) grad = 'linear-gradient(90deg, #fbbf24, #d97706)';
        else grad = 'linear-gradient(90deg, #1f7a4a, #15a065)';
      } else {
        grad = 'linear-gradient(90deg, #1f7a4a, #15a065)';
      }
      bar.style.background = grad;
    }
    var meta = block.querySelector('.wjp-debt-enh-progress-meta');
    if (meta) {
      meta.innerHTML = '<span>' + htmlEscape(prog.label || '') + '</span>' +
        '<span>' + htmlEscape(prog.subtext || '') + '</span>';
    }
  }

  // ───────── throttled refresher ─────────
  var _scheduled = false;
  function refreshAll() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(function () {
      _scheduled = false;
      try { injectAll(); } catch (_) {}
    }, 80);
  }

  function boot() {
    injectStyle();
    refreshAll();
    // Suppress 'silent' debts-changed (our own auto-save) — only refresh on
    // genuine state changes from elsewhere.
    window.addEventListener('wjp-recurring-link-changed', refreshAll);
    window.addEventListener('wjp-recurring-changed', refreshAll);
    window.addEventListener('wjp-debts-changed', function (e) {
      try { if (e && e.detail && e.detail.silent) return; } catch (_) {}
      refreshAll();
    });
    // v2 (FIX 36-D): use MutationObserver instead of a polling interval so
    // we only react when the host actually rebuilds cards. The interval was
    // competing with user keystrokes and rebuilding the block underneath
    // the cursor.
    try {
      var grid = document.getElementById('wjp-rt-grid');
      if (grid && window.MutationObserver) {
        var mo = new MutationObserver(function (mutations) {
          // Only react if a card's children changed (host re-rendered it)
          var relevant = false;
          for (var i = 0; i < mutations.length; i++) {
            var tgt = mutations[i].target;
            if (tgt && tgt.closest && tgt.closest('[data-wjp-rt-key]') && !tgt.closest('.wjp-debt-enh')) {
              relevant = true; break;
            }
          }
          if (relevant) refreshAll();
        });
        mo.observe(grid, { childList: true, subtree: true });
      } else {
        // Fallback to slow safety tick (much less frequent than before)
        setInterval(refreshAll, 8000);
      }
    } catch (_) { setInterval(refreshAll, 8000); }
    // Also watch for late-arriving grid (Recurring tab not yet mounted on boot)
    var lateAttempts = 0;
    var lateIv = setInterval(function () {
      lateAttempts++;
      if (lateAttempts > 30) return clearInterval(lateIv);
      var g = document.getElementById('wjp-rt-grid');
      if (g && !g._wjpEnhObserved) {
        g._wjpEnhObserved = true;
        try {
          var mo2 = new MutationObserver(function () { refreshAll(); });
          mo2.observe(g, { childList: true, subtree: true });
          refreshAll();
        } catch (_) {}
      }
    }, 1500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_DebtDetailEnhance = {
    version: 1,
    refresh: refreshAll,
    computeProgress: computeProgress
  };
})();
