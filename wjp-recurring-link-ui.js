/* wjp-recurring-link-ui.js v1 — UI for txn↔recurring linking
 *
 * Pairs with wjp-recurring-link.js (the engine). This module adds:
 *   1. Transaction row badge: when a row has t.linkedRecurringId, inject a
 *      pill in the SOURCE column area showing "🔁 <schedule name>" with a
 *      lifecycle-tinted color (pending=amber, cleared=blue, confirmed=green).
 *   2. Recurring table STATUS column: shows "Paid · confirmed", "Cleared
 *      (5BD)", "Pending · N day(s)", or "—".
 *   3. Click the txn badge → small popover with "Unlink" + "View schedule" +
 *      countdown to confirm.
 *   4. "+ Link transaction" mini-button on each recurring row → opens a
 *      picker modal listing unlinked Plaid txns sorted by amount proximity.
 *
 * Universal: post-render DOM injection (no need to patch the host
 * renderers). Throttled to every 1.5s + re-run on
 * `wjp-recurring-link-changed`. Idempotent install guard.
 */
(function () {
  'use strict';
  if (window._wjpRecurringLinkUiInstalled) return;
  window._wjpRecurringLinkUiInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // ───────── helpers ─────────
  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function getEngine() { return window.WJP_RecurringLink || null; }

  function statusColors(status) {
    switch (status) {
      case 'confirmed': return { bg: 'rgba(31,122,74,0.12)', border: 'rgba(31,122,74,0.35)', fg: '#1f7a4a', label: 'Paid · confirmed' };
      case 'cleared':   return { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', fg: '#2563eb', label: 'Cleared (5BD)' };
      case 'pending':   return { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.40)', fg: '#b45309', label: 'Pending' };
      default:          return { bg: 'rgba(0,0,0,0.04)',     border: 'rgba(0,0,0,0.10)',     fg: '#6b7280', label: '—' };
    }
  }

  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function findRecurring(rpId) {
    var s = getState();
    if (!s || !Array.isArray(s.recurringPayments)) return null;
    return s.recurringPayments.find(function (r) { return r && r.id === rpId; }) || null;
  }

  // ───────── style injection (once) ─────────
  function injectStyle() {
    if (document.getElementById('wjp-rec-link-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-rec-link-style';
    st.textContent = [
      '.wjp-rec-link-pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;border:1px solid;cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:6px;}',
      '.wjp-rec-link-pill .ph{font-size:11px;}',
      '.wjp-rec-link-pill:hover{filter:brightness(0.96);}',
      '.wjp-rec-status-cell{font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;border:1px solid;}',
      '.wjp-rec-link-btn{display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--border, rgba(0,0,0,0.10));color:var(--ink, var(--text-1,#1f1a14));font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;cursor:pointer;margin-left:6px;}',
      '.wjp-rec-link-btn:hover{background:var(--bg-3, rgba(0,0,0,0.04));}',
      '#wjp-rec-link-popover{position:absolute;z-index:99998;background:var(--bg-1,#fff);color:var(--ink,#0a0a0a);border:1px solid var(--border,rgba(0,0,0,0.12));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.18);padding:10px 12px;min-width:240px;font-size:12px;}',
      '#wjp-rec-link-popover .title{font-weight:700;margin-bottom:4px;}',
      '#wjp-rec-link-popover .sub{color:var(--ink-dim,#6b7280);margin-bottom:8px;font-size:11px;}',
      '#wjp-rec-link-popover button{display:block;width:100%;text-align:left;background:transparent;border:none;padding:6px 8px;border-radius:6px;font-size:12px;cursor:pointer;color:inherit;font-family:inherit;}',
      '#wjp-rec-link-popover button:hover{background:var(--bg-3, rgba(0,0,0,0.05));}',
      '#wjp-rec-link-popover button.danger{color:#c0594a;}',
      '#wjp-link-picker-modal{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:flex;align-items:center;justify-content:center;padding:20px;}',
      '#wjp-link-picker-modal .panel{background:var(--bg-1,#fff);color:var(--ink,#0a0a0a);border-radius:14px;padding:18px;max-width:520px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.30);}',
      '#wjp-link-picker-modal h3{margin:0 0 6px;font-size:16px;}',
      '#wjp-link-picker-modal .sub{color:var(--ink-dim,#6b7280);font-size:12px;margin-bottom:12px;}',
      '#wjp-link-picker-modal .list{flex:1;overflow:auto;border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:8px;}',
      '#wjp-link-picker-modal .row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border,rgba(0,0,0,0.06));cursor:pointer;}',
      '#wjp-link-picker-modal .row:hover{background:var(--bg-3, rgba(31,122,74,0.06));}',
      '#wjp-link-picker-modal .row:last-child{border-bottom:none;}',
      '#wjp-link-picker-modal .merchant{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#wjp-link-picker-modal .amt{font-weight:700;}',
      '#wjp-link-picker-modal .date{color:var(--ink-dim,#6b7280);font-size:11px;}',
      '#wjp-link-picker-modal .actions{margin-top:12px;display:flex;justify-content:flex-end;gap:8px;}',
      '#wjp-link-picker-modal .btn{padding:8px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;border:1px solid;font-family:inherit;}',
      '#wjp-link-picker-modal .btn-sec{background:var(--bg-3, rgba(0,0,0,0.05));color:var(--ink,#0a0a0a);border-color:var(--border,rgba(0,0,0,0.10));}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───────── Transaction row badges ─────────
  function injectTxnBadges() {
    var rows = document.querySelectorAll('.txn-row[data-txn-id]');
    if (!rows.length) return;
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return;
    rows.forEach(function (row) {
      var id = row.getAttribute('data-txn-id');
      var t = s.transactions.find(function (x) { return x && x.id === id; });
      var existing = row.querySelector('.wjp-rec-link-pill');
      if (!t || !t.linkedRecurringId) {
        if (existing) existing.remove();
        return;
      }
      var st = (window.WJP_RecurringLink && window.WJP_RecurringLink.getLinkStatus)
        ? window.WJP_RecurringLink.getLinkStatus(t) : null;
      var status = (st && st.status) || t.linkStatus || 'pending';
      var cols = statusColors(status);
      var name = (st && st.rpName) || 'Recurring';
      var label = name.length > 18 ? name.slice(0, 18) + '…' : name;
      var tip = name + ' · ' + cols.label
        + (st && st.daysUntilConfirm > 0 ? ' · locks in ' + st.daysUntilConfirm + 'd' : '');
      if (existing) {
        existing.title = tip;
        existing.style.cssText = 'background:' + cols.bg + ';border-color:' + cols.border + ';color:' + cols.fg + ';';
        existing.innerHTML = '<i class="ph ph-arrows-clockwise"></i><span>' + htmlEscape(label) + '</span>';
        return;
      }
      // Inject into the SOURCE column (first td) right after the source badge
      var firstTd = row.querySelector('td');
      if (!firstTd) return;
      var pill = document.createElement('span');
      pill.className = 'wjp-rec-link-pill';
      pill.setAttribute('data-txn-id', id);
      pill.setAttribute('data-rp-id', t.linkedRecurringId);
      pill.title = tip;
      pill.style.cssText = 'background:' + cols.bg + ';border-color:' + cols.border + ';color:' + cols.fg + ';';
      pill.innerHTML = '<i class="ph ph-arrows-clockwise"></i><span>' + htmlEscape(label) + '</span>';
      pill.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openLinkPopover(pill, id);
      });
      firstTd.appendChild(pill);
    });
  }

  // ───────── Popover for txn pill (Unlink / View schedule) ─────────
  function closePopover() {
    var p = document.getElementById('wjp-rec-link-popover');
    if (p) p.remove();
    document.removeEventListener('click', popoverClickAway, true);
  }
  function popoverClickAway(e) {
    var pop = document.getElementById('wjp-rec-link-popover');
    if (!pop) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.wjp-rec-link-pill')) return;
    closePopover();
  }
  function openLinkPopover(anchor, txnId) {
    closePopover();
    var s = getState();
    var t = s && s.transactions ? s.transactions.find(function (x) { return x && x.id === txnId; }) : null;
    if (!t) return;
    var st = (window.WJP_RecurringLink && window.WJP_RecurringLink.getLinkStatus)
      ? window.WJP_RecurringLink.getLinkStatus(t) : null;
    var name = (st && st.rpName) || 'Recurring';
    var status = (st && st.status) || 'pending';
    var cols = statusColors(status);
    var sub = cols.label;
    if (st && st.daysUntilConfirm > 0 && status !== 'confirmed') {
      sub += ' · locks in ' + st.daysUntilConfirm + ' day' + (st.daysUntilConfirm === 1 ? '' : 's');
    }
    var pop = document.createElement('div');
    pop.id = 'wjp-rec-link-popover';
    pop.innerHTML =
      '<div class="title">🔁 ' + htmlEscape(name) + '</div>' +
      '<div class="sub" style="color:' + cols.fg + ';">' + htmlEscape(sub) + '</div>' +
      '<button data-act="goto">View this schedule</button>' +
      '<button class="danger" data-act="unlink">Unlink from this recurring</button>';
    document.body.appendChild(pop);
    var rect = anchor.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 4;
    var left = rect.left + window.scrollX;
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    setTimeout(function () { document.addEventListener('click', popoverClickAway, true); }, 0);
    pop.querySelector('[data-act="unlink"]').onclick = function () {
      if (window.WJP_RecurringLink && window.WJP_RecurringLink.unlink) {
        window.WJP_RecurringLink.unlink(txnId);
      }
      closePopover();
      setTimeout(refreshAll, 100);
    };
    pop.querySelector('[data-act="goto"]').onclick = function () {
      closePopover();
      try { location.hash = '#debts'; } catch (_) {}
      // Try to switch to Recurring Payments sub-tab
      setTimeout(function () {
        var tab = Array.prototype.find.call(
          document.querySelectorAll('button, a, [role="tab"], .debts-tab'),
          function (el) { return /recurring payments/i.test((el.textContent || '').trim()); }
        );
        if (tab) try { tab.click(); } catch (_) {}
      }, 300);
    };
  }

  // ───────── Recurring table STATUS column injector ─────────
  // The recurring payments table renders rows with classes like "rec-row"
  // or generic tr elements. We target by looking for the table header
  // containing "STATUS" and finding its column index.
  function findRecurringTable() {
    var heads = document.querySelectorAll('table, .recurring-table, [class*="recurring"] table');
    var matches = [];
    heads.forEach(function (tbl) {
      var ths = tbl.querySelectorAll('th, .th, [class*="header"]');
      var hasPayment = false, hasStatus = false, statusIdx = -1, paymentIdx = -1;
      ths.forEach(function (th, i) {
        var t = (th.textContent || '').trim().toLowerCase();
        if (t === 'payment') { hasPayment = true; paymentIdx = i; }
        if (t === 'status')  { hasStatus = true; statusIdx = i; }
      });
      if (hasPayment && hasStatus) matches.push({ table: tbl, statusIdx: statusIdx, paymentIdx: paymentIdx });
    });
    return matches;
  }

  function injectRecurringStatus() {
    var s = getState();
    if (!s || !Array.isArray(s.recurringPayments)) return;
    var matches = findRecurringTable();
    matches.forEach(function (m) {
      var rows = m.table.querySelectorAll('tbody tr');
      rows.forEach(function (tr) {
        var paymentCell = tr.children[m.paymentIdx];
        var statusCell = tr.children[m.statusIdx];
        if (!paymentCell || !statusCell) return;
        var payName = (paymentCell.textContent || '').trim();
        if (!payName) return;
        // Find the matching recurring by name (case-insensitive contains)
        var rp = s.recurringPayments.find(function (r) {
          if (!r || !r.name) return false;
          return r.name.toLowerCase() === payName.toLowerCase()
              || payName.toLowerCase().indexOf(r.name.toLowerCase()) !== -1
              || r.name.toLowerCase().indexOf(payName.toLowerCase()) !== -1;
        });
        if (!rp) return;
        var status = 'unlinked';
        if (rp.openTxnId) {
          var t = s.transactions.find(function (x) { return x && x.id === rp.openTxnId; });
          if (t) status = t.linkStatus || 'pending';
        } else if (Array.isArray(rp.linkedTxnIds) && rp.linkedTxnIds.length > 0) {
          // Most recent confirmed link
          status = 'confirmed';
        }
        var cols = statusColors(status === 'unlinked' ? null : status);
        var existing = statusCell.querySelector('.wjp-rec-status-cell');
        var html = '<span class="wjp-rec-status-cell" style="background:' + cols.bg + ';border-color:' + cols.border + ';color:' + cols.fg + ';">' +
            (status === 'confirmed' ? '✓ ' : status === 'cleared' ? '⊙ ' : status === 'pending' ? '⏳ ' : '') +
            htmlEscape(status === 'unlinked' ? 'No match yet' : cols.label) +
          '</span>' +
          '<button class="wjp-rec-link-btn" data-act="open-picker" data-rp-id="' + htmlEscape(rp.id) + '" title="Manually link a transaction to this schedule">+ Link txn</button>';
        if (existing) {
          statusCell.innerHTML = html;
        } else {
          statusCell.innerHTML = html;
        }
        // Wire the picker button
        var btn = statusCell.querySelector('[data-act="open-picker"]');
        if (btn) {
          btn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            openLinkPicker(rp.id);
          };
        }
      });
    });
  }

  // ───────── Manual link picker modal ─────────
  function closePicker() {
    var m = document.getElementById('wjp-link-picker-modal');
    if (m) m.remove();
  }
  function openLinkPicker(rpId) {
    var s = getState();
    var rp = findRecurring(rpId);
    if (!rp) return;
    closePicker();
    var modal = document.createElement('div');
    modal.id = 'wjp-link-picker-modal';
    // Build candidates: unlinked Plaid txns from last 60d, sorted by amount proximity
    var target = Math.abs(Number(rp.amount) || 0);
    var cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
    // v1 (2026-05-26, FIX 31): exclude transfers from picker candidates so
    // the user can't accidentally link a bank-to-bank move as a bill payment.
    function isTransferLocal(t) {
      try {
        if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
          return !!window.WJP_TxSmartCategorize.isTransfer(t);
        }
      } catch (_) {}
      var fields = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
      return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(fields);
    }
    var candidates = (s.transactions || []).filter(function (t) {
      if (!t) return false;
      if (t.linkedRecurringId) return false;
      if (t.source !== 'plaid') return false;
      if (t.synthetic) return false;
      if (t._supersededBy) return false; // pending row already promoted to a completed one
      if (isTransferLocal(t)) return false;
      var ms = new Date(String(t.date || '').slice(0, 10) + 'T12:00:00').getTime();
      return ms >= cutoff;
    }).map(function (t) {
      var amt = Math.abs(Number(t.amount) || 0);
      var ratio = target > 0 && amt > 0 ? Math.min(amt, target) / Math.max(amt, target) : 0;
      return { t: t, ratio: ratio };
    }).sort(function (a, b) {
      // Highest amount-similarity first, then most recent
      if (b.ratio !== a.ratio) return b.ratio - a.ratio;
      return new Date(b.t.date) - new Date(a.t.date);
    }).slice(0, 50);

    var rowsHtml = candidates.length
      ? candidates.map(function (c) {
          var amtStr = (c.t.amount < 0 ? '-$' : '+$') + Math.abs(c.t.amount).toFixed(2);
          return '<div class="row" data-txn-id="' + htmlEscape(c.t.id) + '">' +
            '<div>' +
              '<div class="merchant">' + htmlEscape(c.t.merchant || c.t.name || 'Unknown') + '</div>' +
              '<div class="date">' + htmlEscape(c.t.date || '') + (c.ratio > 0.9 ? ' · close match' : '') + '</div>' +
            '</div>' +
            '<div class="amt" style="margin-left:auto;color:' + (c.t.amount < 0 ? '#c0594a' : '#1f7a4a') + ';">' + amtStr + '</div>' +
          '</div>';
        }).join('')
      : '<div class="row" style="cursor:default;color:var(--ink-dim,#6b7280);">No unlinked Plaid transactions in the last 60 days.</div>';

    modal.innerHTML =
      '<div class="panel">' +
        '<h3>Link a transaction</h3>' +
        '<div class="sub">Pick the transaction that paid <strong>' + htmlEscape(rp.name || 'this schedule') + '</strong>' +
          (target > 0 ? ' (~$' + target.toFixed(2) + ').' : '.') +
          ' Sorted by closest amount.</div>' +
        '<div class="list">' + rowsHtml + '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-sec" id="wjp-link-picker-cancel" type="button">Cancel</button>' +
        '</div>' +
      '</div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) closePicker(); });
    document.body.appendChild(modal);
    document.getElementById('wjp-link-picker-cancel').onclick = closePicker;
    modal.querySelectorAll('.row[data-txn-id]').forEach(function (r) {
      r.onclick = function () {
        var tid = r.getAttribute('data-txn-id');
        if (window.WJP_RecurringLink && window.WJP_RecurringLink.link) {
          window.WJP_RecurringLink.link(tid, rpId);
        }
        closePicker();
        setTimeout(refreshAll, 100);
      };
    });
  }

  // ───────── Throttled refresher ─────────
  var _refreshScheduled = false;
  function refreshAll() {
    if (_refreshScheduled) return;
    _refreshScheduled = true;
    setTimeout(function () {
      _refreshScheduled = false;
      try { injectTxnBadges(); } catch (_) {}
      try { injectRecurringStatus(); } catch (_) {}
    }, 60);
  }

  function boot() {
    injectStyle();
    refreshAll();
    // Re-inject on engine events
    window.addEventListener('wjp-recurring-link-changed', refreshAll);
    window.addEventListener('wjp-tx-rerendered', refreshAll);
    window.addEventListener('wjp-transactions-changed', refreshAll);
    window.addEventListener('wjp-recurring-changed', refreshAll);
    // Periodic safety re-inject (in case host re-renders without dispatching)
    setInterval(refreshAll, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_RecurringLinkUI = {
    version: 1,
    refresh: refreshAll,
    openLinkPicker: openLinkPicker,
    openLinkPopover: openLinkPopover
  };
})();
