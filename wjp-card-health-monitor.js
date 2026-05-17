/* wjp-card-health-monitor.js v2 — Keep-cards-active monitor with mark-paid integration
 *
 * Status taxonomy:
 *   ACTIVE   — used in the last 30 days
 *   DORMANT  — 30–60 days since last charge (issuer may flag soon)
 *   AT-RISK  — 60+ days (issuers commonly close inactive cards)
 *   NO-DATA  — could not match transactions (card may not be Plaid-synced)
 *   UNPAID   — balance > $5 AND no payment posted in 35+ days AND no pending
 *   PENDING  — user marked-paid; suppresses UNPAID for 14 days while real tx posts
 *   UNCONFIRMED — pending expired without a matching transaction
 *
 * Renders a Card Health panel above Current Obligations + dispatches reminders
 * via window.pushNotification (throttled 1×/7d per card per alert type).
 *
 * Safe: read-only on data side; localStorage-only writes. No Sync Bank hooks.
 */
(function () {
  'use strict';
  if (window._wjpCardHealthInstalled) return;
  window._wjpCardHealthInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var PANEL_ID = 'wjp-card-health-panel';
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DORMANT_DAYS = 30;
  var AT_RISK_DAYS = 60;
  var UNPAID_DAYS = 35;
  var THROTTLE_MS = 7 * DAY_MS;

  // ===================== helpers =====================
  async function getCurrentUid() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.uid;
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) {
        return window.__wjpAuth.currentUser.uid;
      }
    } catch (_) {}
    return null;
  }

  function isOnDebts() {
    var pageEl = document.getElementById('page-debts');
    return !!(pageEl && (pageEl.classList.contains('active') || pageEl.offsetParent !== null));
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtUsd(n) {
    return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function daysUntil(ts) {
    return Math.max(0, Math.ceil((ts - Date.now()) / DAY_MS));
  }

  function getBudgetState() {
    try {
      var raw = localStorage.getItem('wjp_budget_state');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveBudgetState(s) {
    try {
      localStorage.setItem('wjp_budget_state', JSON.stringify(s));
      if (window.appState) window.appState.notifications = s.notifications;
      return true;
    } catch (_) { return false; }
  }

  function throttleKey(uid) { return 'wjp.card_health.throttle.uid_' + uid; }

  async function readThrottle() {
    var uid = await getCurrentUid();
    if (!uid) return {};
    try {
      var raw = localStorage.getItem(throttleKey(uid));
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  async function writeThrottle(map) {
    var uid = await getCurrentUid();
    if (!uid) return;
    try { localStorage.setItem(throttleKey(uid), JSON.stringify(map)); } catch (_) {}
  }

  function isCreditCard(d) {
    var t = (d.type || '').toLowerCase();
    return t.indexOf('credit') !== -1 || t.indexOf('card') !== -1;
  }

  function txDate(t) {
    var d = t.date || t.authorized_date || t.timestamp;
    if (!d) return 0;
    var ms = typeof d === 'number' ? d : Date.parse(d);
    return isFinite(ms) ? ms : 0;
  }

  function findCardTransactions(debt, allTx) {
    var dAccountId = debt.plaidAccountId || debt.accountId || debt.plaid_account_id;
    if (dAccountId) {
      var matched = allTx.filter(function (t) {
        return t.plaidAccountId === dAccountId || t.account_id === dAccountId;
      });
      if (matched.length > 0) return matched;
    }
    if (debt.institutionName) {
      var inst = (debt.institutionName || '').toLowerCase();
      return allTx.filter(function (t) {
        return (t.institutionName || '').toLowerCase() === inst;
      });
    }
    return [];
  }

  function pendingFor(debtId) {
    try {
      if (window.WJP_PendingPayments && typeof window.WJP_PendingPayments.getStatus === 'function') {
        return window.WJP_PendingPayments.getStatus(debtId);
      }
    } catch (_) {}
    return null;
  }

  function classifyCard(debt, txs) {
    var now = Date.now();
    var charges = txs.filter(function (t) { return (t.amount || 0) < 0; });
    var payments = txs.filter(function (t) {
      if (t.payment_channel === 'payment') return true;
      var m = ((t.merchant || t.merchant_name || t.name || '') + '').toLowerCase();
      return m.indexOf('payment') !== -1 || m.indexOf('autopay') !== -1;
    });
    var lastCharge = charges.length ? Math.max.apply(null, charges.map(txDate)) : 0;
    var lastPayment = payments.length ? Math.max.apply(null, payments.map(txDate)) : 0;
    var daysSinceCharge = lastCharge ? Math.floor((now - lastCharge) / DAY_MS) : null;
    var daysSincePayment = lastPayment ? Math.floor((now - lastPayment) / DAY_MS) : null;

    var balance = (typeof debt.balance === 'number') ? debt.balance : 0;
    var status = 'ACTIVE';
    var reason = '';

    if (daysSinceCharge == null) {
      status = 'NO-DATA';
      reason = 'No matched transactions yet — connect/refresh bank.';
    } else if (daysSinceCharge >= AT_RISK_DAYS) {
      status = 'AT-RISK';
      reason = daysSinceCharge + ' days since last charge. Issuers can close inactive accounts.';
    } else if (daysSinceCharge >= DORMANT_DAYS) {
      status = 'DORMANT';
      reason = daysSinceCharge + ' days since last charge. Run a small purchase to keep this card live.';
    } else {
      status = 'ACTIVE';
      reason = 'Used ' + daysSinceCharge + ' days ago — healthy.';
    }

    // Pending payment suppresses UNPAID.
    var pending = pendingFor(debt.id);
    var hasPending = pending && pending.status === 'pending';
    var hasExpired = pending && pending.status === 'expired';
    var hasConfirmed = pending && pending.status === 'confirmed';

    var unpaid = false;
    if (hasPending) {
      unpaid = false;
    } else if (status === 'NO-DATA') {
      unpaid = false;
    } else {
      unpaid = (balance > 5 && (daysSincePayment == null || daysSincePayment > UNPAID_DAYS));
    }

    return {
      name: debt.name || 'Card',
      balance: balance,
      apr: debt.apr,
      lastChargeAt: lastCharge,
      lastPaymentAt: lastPayment,
      daysSinceCharge: daysSinceCharge,
      daysSincePayment: daysSincePayment,
      status: status,
      reason: reason,
      unpaid: unpaid,
      pending: hasPending ? pending : null,
      expired: hasExpired ? pending : null,
      confirmed: hasConfirmed ? pending : null,
      debtId: debt.id
    };
  }

  function genId() { return 'ch' + Date.now() + '_' + Math.floor(Math.random() * 100000); }

  async function dispatchToInbox(card, type, title, text, priority) {
    var throttle = await readThrottle();
    var tKey = card.debtId + ':' + type;
    var now = Date.now();
    if (throttle[tKey] && (now - throttle[tKey]) < THROTTLE_MS) return false;

    var state = getBudgetState();
    if (!state) return false;
    if (!Array.isArray(state.notifications)) state.notifications = [];

    var notif = {
      id: genId(),
      type: 'card-health',
      title: title,
      text: text,
      priority: priority || 'medium',
      link: '#debts',
      timestamp: now,
      cleared: false
    };
    state.notifications.unshift(notif);
    saveBudgetState(state);

    try {
      if (typeof window.pushNotification === 'function') {
        window.pushNotification(notif, 'card-health');
      }
    } catch (_) {}

    throttle[tKey] = now;
    await writeThrottle(throttle);
    return true;
  }

  async function runMonitor() {
    var state = getBudgetState();
    if (!state || !Array.isArray(state.debts)) return [];
    var cards = state.debts.filter(isCreditCard);
    if (cards.length === 0) return [];
    var allTx = Array.isArray(state.transactions) ? state.transactions : [];

    var results = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var txs = findCardTransactions(card, allTx);
      var c = classifyCard(card, txs);
      results.push(c);

      // Inbox dispatches — only for actionable situations
      if (c.status === 'DORMANT') {
        await dispatchToInbox(card, 'dormant',
          'Keep your ' + c.name + ' active',
          c.reason + ' A $5–$10 charge on a recurring bill (Netflix, gas) restarts the activity clock.',
          'medium');
      } else if (c.status === 'AT-RISK') {
        await dispatchToInbox(card, 'at-risk',
          c.name + ' may be closed by your issuer',
          c.reason + ' Make a small charge in the next 7 days to avoid an issuer-initiated closure (which can drop your FICO score 5-15 points).',
          'high');
      }
      if (c.unpaid) {
        await dispatchToInbox(card, 'unpaid',
          c.name + ' needs a payment',
          'Balance is ' + fmtUsd(c.balance) + ' and no payment has posted in the last ' + UNPAID_DAYS + ' days. Even the minimum payment protects your score and avoids late fees.',
          'high');
      }
      if (c.expired) {
        await dispatchToInbox(card, 'pending-expired',
          'Pending payment didn\'t confirm — ' + c.name,
          'You marked ' + fmtUsd(c.expired.amount) + ' as paid on ' + c.expired.paidDate + ', but no matching transaction posted in 14 days. Verify the payment cleared.',
          'high');
      }
    }
    return results;
  }

  // ===================== visual panel =====================
  function statusColor(status) {
    return status === 'AT-RISK' ? '#c0594a'
         : status === 'DORMANT' ? '#a16207'
         : status === 'ACTIVE'  ? '#1f7a4a'
         : '#6b7280';
  }
  function statusBg(status) {
    return status === 'AT-RISK' ? 'rgba(192,89,74,0.10)'
         : status === 'DORMANT' ? 'rgba(161,98,7,0.10)'
         : status === 'ACTIVE'  ? 'rgba(31,122,74,0.10)'
         : 'rgba(0,0,0,0.04)';
  }

  function findCurrentObligationsHeader() {
    var headings = document.querySelectorAll('h2, h3, [class*="title"], [class*="Title"]');
    for (var i = 0; i < headings.length; i++) {
      var t = (headings[i].textContent || '').trim();
      if (t === 'Current Obligations') return headings[i];
    }
    return null;
  }

  function rowHtml(c) {
    var pendingLine = '';
    if (c.pending) {
      pendingLine = '<span style="color:#1f7a4a;font-weight:700;">Pending confirmation</span> · ' +
        fmtUsd(c.pending.amount) + ' marked ' + c.pending.paidDate + ' · ~' + daysUntil(c.pending.expiresAt) + 'd window';
    } else if (c.expired) {
      pendingLine = '<span style="color:#a16207;font-weight:700;">Pending expired</span> · No matching tx posted in 14d — re-check the payment.';
    } else if (c.confirmed) {
      pendingLine = '<span style="color:#1f7a4a;font-weight:700;">Payment confirmed</span> · ' + fmtUsd(c.confirmed.amount);
    }

    var sub = c.status === 'NO-DATA'
      ? (pendingLine || c.reason)
      : (pendingLine || (
          'Last charge: ' + (c.daysSinceCharge != null ? c.daysSinceCharge + 'd ago' : '—') +
          ' · Last payment: ' + (c.daysSincePayment != null ? c.daysSincePayment + 'd ago' : '—') +
          ' · Balance: ' + fmtUsd(c.balance)
        ));

    var badges = [
      '<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:' + statusBg(c.status) + ';color:' + statusColor(c.status) + ';">' + c.status + '</span>'
    ];
    if (c.pending) {
      badges.push('<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:rgba(31,122,74,0.10);color:#1f7a4a;">PENDING</span>');
    } else if (c.unpaid) {
      badges.push('<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:rgba(192,89,74,0.10);color:#c0594a;">UNPAID</span>');
    } else if (c.expired) {
      badges.push('<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:rgba(161,98,7,0.10);color:#a16207;">UNCONFIRMED</span>');
    } else if (c.status === 'NO-DATA' && c.balance > 5) {
      badges.push('<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:rgba(107,114,128,0.10);color:#6b7280;">NOT SYNCED</span>');
    }

    var actionBtn = '';
    if (c.balance > 5 && !c.pending && !c.confirmed) {
      actionBtn = '<button type="button" class="wjp-ch-mark-paid" data-debt-id="' + escapeHtml(c.debtId) + '" ' +
        'style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink,var(--text-1,#0a0a0a));' +
        'border-radius:7px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0;">Mark paid</button>';
    } else if (c.pending) {
      actionBtn = '<button type="button" class="wjp-ch-clear-pending" data-debt-id="' + escapeHtml(c.debtId) + '" ' +
        'style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink-dim,var(--text-2,#6b7280));' +
        'border-radius:7px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0;">Clear</button>';
    }

    return (
      '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-3,rgba(0,0,0,0.02));border-radius:10px;border-left:3px solid ' + statusColor(c.status) + ';">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<div style="font-weight:700;font-size:13.5px;color:var(--ink,var(--text-1,#0a0a0a));">' + escapeHtml(c.name) + '</div>' +
            badges.join('') +
          '</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:3px;">' + sub + '</div>' +
        '</div>' +
        actionBtn +
      '</div>'
    );
  }

  function buildPanel(results) {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText =
      'background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:14px;' +
      'padding:18px 22px;margin:18px 0;font-family:inherit;font-size:13px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.04);';

    var counts = { ACTIVE: 0, DORMANT: 0, 'AT-RISK': 0, 'NO-DATA': 0, UNPAID: 0, PENDING: 0 };
    results.forEach(function (c) {
      counts[c.status] = (counts[c.status] || 0) + 1;
      if (c.unpaid) counts.UNPAID++;
      if (c.pending) counts.PENDING++;
    });
    var alertCount = counts.DORMANT + counts['AT-RISK'] + counts.UNPAID;

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<div>' +
          '<div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;color:var(--ink,var(--text-1,#0a0a0a));">Card health</div>' +
          '<div style="font-size:11.5px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">' +
            counts.ACTIVE + ' active · ' +
            counts.DORMANT + ' dormant · ' +
            counts['AT-RISK'] + ' at-risk · ' +
            counts.UNPAID + ' unpaid · ' +
            counts.PENDING + ' pending' +
          '</div>' +
        '</div>' +
        (alertCount > 0
          ? '<span style="font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;background:rgba(192,89,74,0.10);color:#c0594a;letter-spacing:0.04em;">' + alertCount + ' need attention</span>'
          : '<span style="font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;background:rgba(31,122,74,0.10);color:#1f7a4a;letter-spacing:0.04em;">All healthy</span>') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' + results.map(rowHtml).join('') + '</div>' +
      '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border,rgba(0,0,0,0.06));font-size:10.5px;color:var(--ink-dim,var(--text-2,#6b7280));">' +
        'Bank-to-card payments take 3–5 business days to post. Click <strong>Mark paid</strong> to suppress late-payment alerts during that window; the app auto-confirms when the real transaction lands. Issuers may close cards inactive 6–12 months — run a small recurring charge to keep cards alive.' +
      '</div>';
    return panel;
  }

  async function mountPanel() {
    if (!isOnDebts()) {
      var old = document.getElementById(PANEL_ID);
      if (old) try { old.remove(); } catch (_) {}
      return;
    }
    var header = findCurrentObligationsHeader();
    if (!header) return;

    var results = await runMonitor();
    if (!results.length) return;

    var existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    var panel = buildPanel(results);
    var insertBefore = header;
    while (insertBefore.parentElement && !insertBefore.parentElement.classList.contains('debts-subtab-content')) {
      insertBefore = insertBefore.parentElement;
    }
    if (insertBefore && insertBefore.parentElement) {
      insertBefore.parentElement.insertBefore(panel, insertBefore);
    }

    // Wire up Mark paid + Clear pending buttons
    Array.prototype.forEach.call(panel.querySelectorAll('.wjp-ch-mark-paid'), function (btn) {
      btn.onclick = function () {
        var debtId = btn.getAttribute('data-debt-id');
        if (!debtId) return;
        try {
          if (window.WJP_PendingPayments && typeof window.WJP_PendingPayments.promptMarkPaid === 'function') {
            var entry = window.WJP_PendingPayments.promptMarkPaid(debtId);
            if (entry) {
              btn.disabled = true;
              btn.textContent = 'Marked';
              setTimeout(function () { mountPanel().catch(function () {}); }, 600);
            }
          } else {
            alert('Pending Payments module not loaded yet — try again in a few seconds.');
          }
        } catch (e) {
          alert('Could not mark paid: ' + e.message);
        }
      };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('.wjp-ch-clear-pending'), function (btn) {
      btn.onclick = function () {
        var debtId = btn.getAttribute('data-debt-id');
        if (!debtId) return;
        if (!confirm('Clear the pending payment for this card?')) return;
        try {
          if (window.WJP_PendingPayments && typeof window.WJP_PendingPayments.clear === 'function') {
            window.WJP_PendingPayments.clear(debtId);
            mountPanel().catch(function () {});
          }
        } catch (_) {}
      };
    });

    // Listen for confirmations to auto-refresh the panel
    if (!window._wjpCardHealthListening) {
      window._wjpCardHealthListening = true;
      window.addEventListener('wjp-pending-payment-confirmed', function () {
        mountPanel().catch(function () {});
      });
      window.addEventListener('wjp-pending-payment-changed', function () {
        mountPanel().catch(function () {});
      });
    }
  }

  // ===================== boot =====================
  function start() {
    setInterval(function () {
      mountPanel().catch(function () {});
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_CardHealth = {
    runMonitor: runMonitor,
    mountPanel: mountPanel,
    version: 2
  };
})();
