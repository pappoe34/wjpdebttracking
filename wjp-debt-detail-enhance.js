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
      var availPct = Math.max(0, Math.round(((limit - used) / limit) * 100));
      var usedPct = 100 - availPct;
      return {
        paid: used,
        target: limit,
        pct: availPct, // bar shows available credit (more = better)
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

  // ───────── build the enhancement block HTML ─────────
  function buildEnhancementHtml(debt) {
    var rp = findDerivedRecurring(debt.id);
    var prog = computeProgress(debt, rp);
    var linked = rp ? linkedTxnsFor(rp).slice(0, 6) : [];
    var annualFee = Number(debt.annualFee) || 0;
    var feeMonth = Number(debt.annualFeeMonth) || 0;
    var remDays = Number(debt.reminderDays) || 3;
    var remOn = debt.reminderEnabled === true;

    // PROGRESS BAR — label/subtext computed inside computeProgress per debt type
    var progTitle = (Number(debt.creditLimit) || Number(debt.limit)) > 0 ? 'Credit utilization' : 'Payment progress';
    var progBar = '<div class="wjp-debt-enh-section">' +
      '<div class="wjp-debt-enh-label">' + progTitle + '</div>' +
      '<div class="wjp-debt-enh-bar"><div style="width:' + prog.pct + '%;"></div></div>' +
      '<div class="wjp-debt-enh-progress-meta">' +
        '<span>' + htmlEscape(prog.label || '') + '</span>' +
        '<span>' + htmlEscape(prog.subtext || '') + '</span>' +
      '</div>' +
    '</div>';

    // LINKED PAYMENTS HISTORY
    var linkedHtml;
    if (!linked.length) {
      linkedHtml = '<div class="wjp-debt-enh-empty">No payments linked yet. Click <strong>Mark as Paid</strong> to attach a transaction.</div>';
    } else {
      linkedHtml = '<div class="wjp-debt-enh-linked-list">' + linked.map(function (t) {
        var amtStr = fmtUsd(Math.abs(Number(t.amount) || 0));
        var status = t.linkStatus || 'pending';
        return '<div class="wjp-debt-enh-linked-row" data-txn-id="' + htmlEscape(t.id) + '">' +
          '<span class="m">' + htmlEscape(t.merchant || t.name || 'Payment') + '</span>' +
          '<span class="d">' + htmlEscape(fmtDateShort(t.date)) + '</span>' +
          statusPill(status) +
          '<span class="a">' + amtStr + '</span>' +
        '</div>';
      }).join('') + '</div>';
    }
    var linkedSection = '<div class="wjp-debt-enh-section">' +
      '<div class="wjp-debt-enh-label">Linked payments (' + (rp ? (rp.linkedTxnIds || []).length : 0) + ')</div>' +
      linkedHtml +
    '</div>';

    // ANNUAL FEE FIELDS
    var monthOpts = ['<option value="">— none —</option>']
      .concat(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        .map(function (m, i) { var v = i+1; return '<option value="' + v + '"' + (feeMonth === v ? ' selected' : '') + '>' + m + '</option>'; }))
      .join('');
    var feeSection = '<div class="wjp-debt-enh-section">' +
      '<div class="wjp-debt-enh-label">Annual fee tracking</div>' +
      '<div class="wjp-debt-enh-row">' +
        '<label>Annual fee ($)</label>' +
        '<input type="number" step="0.01" min="0" data-field="annualFee" value="' + (annualFee || '') + '" placeholder="0.00" />' +
      '</div>' +
      '<div class="wjp-debt-enh-row">' +
        '<label>Fee charged in</label>' +
        '<select data-field="annualFeeMonth">' + monthOpts + '</select>' +
      '</div>' +
    '</div>';

    // REMINDERS
    var reminderSection = '<div class="wjp-debt-enh-section">' +
      '<div class="wjp-debt-enh-label">Reminders</div>' +
      '<div class="wjp-debt-enh-row">' +
        '<label class="wjp-debt-enh-toggle">' +
          '<input type="checkbox" data-field="reminderEnabled"' + (remOn ? ' checked' : '') + '/>' +
          ' Notify before due date / annual fee' +
        '</label>' +
      '</div>' +
      '<div class="wjp-debt-enh-row">' +
        '<label>Days before</label>' +
        '<input type="number" min="0" max="30" data-field="reminderDays" value="' + remDays + '" />' +
      '</div>' +
    '</div>';

    // ACTIONS
    var actionsSection = '<div class="wjp-debt-enh-section wjp-debt-enh-actions">' +
      '<button type="button" class="wjp-debt-enh-btn" data-action="mark-paid">' +
        '<i class="ph ph-check-circle"></i> Mark as Paid' +
      '</button>' +
      '<button type="button" class="wjp-debt-enh-btn sec" data-action="save-fields">' +
        '<i class="ph ph-floppy-disk"></i> Save fee & reminder' +
      '</button>' +
    '</div>';

    return '<div class="wjp-debt-enh" data-debt-id="' + htmlEscape(debt.id) + '">' +
      progBar + linkedSection + feeSection + reminderSection + actionsSection +
    '</div>';
  }

  // ───────── wire interactions on an injected block ─────────
  function wireBlock(block, debt) {
    if (!block || !debt) return;
    var rp = findDerivedRecurring(debt.id);
    // Save fee + reminder
    var saveBtn = block.querySelector('[data-action="save-fields"]');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var fee = parseFloat(block.querySelector('[data-field="annualFee"]').value);
        var month = parseInt(block.querySelector('[data-field="annualFeeMonth"]').value, 10);
        var remOn = block.querySelector('[data-field="reminderEnabled"]').checked;
        var remDays = parseInt(block.querySelector('[data-field="reminderDays"]').value, 10);
        debt.annualFee = isFinite(fee) && fee > 0 ? fee : 0;
        debt.annualFeeMonth = isFinite(month) && month >= 1 && month <= 12 ? month : 0;
        debt.reminderEnabled = !!remOn;
        debt.reminderDays = isFinite(remDays) && remDays >= 0 ? remDays : 3;
        saveState();
        try { window.dispatchEvent(new CustomEvent('wjp-debts-changed', { detail:{source:'debt-detail-enhance'} })); } catch (_) {}
        // Visual confirmation
        saveBtn.innerHTML = '<i class="ph ph-check"></i> Saved';
        setTimeout(function () { saveBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save fee & reminder'; }, 1800);
      };
    }
    // Mark as Paid → open the existing link picker scoped to this debt's recurring
    var markBtn = block.querySelector('[data-action="mark-paid"]');
    if (markBtn) {
      markBtn.onclick = function () {
        var rp2 = findDerivedRecurring(debt.id);
        if (!rp2) { alert('No recurring schedule exists for this debt yet.'); return; }
        if (window.WJP_RecurringLinkUI && window.WJP_RecurringLinkUI.openLinkPicker) {
          window.WJP_RecurringLinkUI.openLinkPicker(rp2.id);
        } else {
          alert('Link picker not ready.');
        }
      };
    }
    // Unlink action on linked rows (click row → confirm → unlink)
    Array.prototype.forEach.call(block.querySelectorAll('.wjp-debt-enh-linked-row'), function (row) {
      row.style.cursor = 'pointer';
      row.title = 'Click to unlink this payment';
      row.onclick = function (e) {
        e.preventDefault();
        var tid = row.getAttribute('data-txn-id');
        if (!tid) return;
        if (!confirm('Unlink this payment from ' + (debt.name || 'this debt') + '?')) return;
        if (window.WJP_RecurringLink && window.WJP_RecurringLink.unlink) {
          window.WJP_RecurringLink.unlink(tid);
        }
        setTimeout(refreshAll, 100);
      };
    });
  }

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
        // Already present — just refresh the dynamic bits (progress + linked list)
        try { patchProgressAndLinked(existing, debt); } catch (_) {}
        return;
      }
      var wrapper = document.createElement('div');
      wrapper.innerHTML = buildEnhancementHtml(debt);
      var block = wrapper.firstElementChild;
      card.appendChild(block);
      wireBlock(block, debt);
    });
  }

  // Refresh only the progress bar + linked payments list (the rest are
  // form inputs that must not be re-rendered while the user is editing).
  function patchProgressAndLinked(block, debt) {
    var rp = findDerivedRecurring(debt.id);
    var prog = computeProgress(debt, rp);
    var bar = block.querySelector('.wjp-debt-enh-bar > div');
    if (bar) bar.style.width = prog.pct + '%';
    var meta = block.querySelector('.wjp-debt-enh-progress-meta');
    if (meta) {
      meta.innerHTML = '<span>' + prog.label + '</span>' +
        '<span>' + (prog.subtext || '') + '</span>';
    }
    // Linked list — rebuild only that section, leave inputs alone
    var sections = block.querySelectorAll('.wjp-debt-enh-section');
    if (sections.length >= 2) {
      var linked = rp ? linkedTxnsFor(rp).slice(0, 6) : [];
      var html;
      if (!linked.length) {
        html = '<div class="wjp-debt-enh-empty">No payments linked yet. Click <strong>Mark as Paid</strong> to attach a transaction.</div>';
      } else {
        html = '<div class="wjp-debt-enh-linked-list">' + linked.map(function (t) {
          var amtStr = fmtUsd(Math.abs(Number(t.amount) || 0));
          var status = t.linkStatus || 'pending';
          return '<div class="wjp-debt-enh-linked-row" data-txn-id="' + htmlEscape(t.id) + '">' +
            '<span class="m">' + htmlEscape(t.merchant || t.name || 'Payment') + '</span>' +
            '<span class="d">' + htmlEscape(fmtDateShort(t.date)) + '</span>' +
            statusPill(status) +
            '<span class="a">' + amtStr + '</span>' +
          '</div>';
        }).join('') + '</div>';
      }
      var linkedLabel = sections[1].querySelector('.wjp-debt-enh-label');
      if (linkedLabel) linkedLabel.textContent = 'Linked payments (' + (rp ? (rp.linkedTxnIds || []).length : 0) + ')';
      // Replace just the inner content after the label
      var innerNodes = Array.prototype.slice.call(sections[1].children);
      innerNodes.forEach(function (n, i) { if (i > 0) n.remove(); });
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      sections[1].appendChild(tmp.firstElementChild);
      // Re-wire click-to-unlink on each row
      Array.prototype.forEach.call(sections[1].querySelectorAll('.wjp-debt-enh-linked-row'), function (row) {
        row.style.cursor = 'pointer';
        row.title = 'Click to unlink this payment';
        row.onclick = function (e) {
          e.preventDefault();
          var tid = row.getAttribute('data-txn-id');
          if (!tid) return;
          if (!confirm('Unlink this payment from ' + (debt.name || 'this debt') + '?')) return;
          if (window.WJP_RecurringLink && window.WJP_RecurringLink.unlink) {
            window.WJP_RecurringLink.unlink(tid);
          }
          setTimeout(refreshAll, 100);
        };
      });
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
    window.addEventListener('wjp-recurring-link-changed', refreshAll);
    window.addEventListener('wjp-recurring-changed', refreshAll);
    window.addEventListener('wjp-debts-changed', refreshAll);
    // MutationObserver-light: re-inject when the grid changes
    setInterval(refreshAll, 1500);
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
