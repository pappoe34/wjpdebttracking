/* wjp-dashboard-money.js v1 — fix Money Left + Upcoming Payments to use
 * cleaned transactions AND real due dates.
 *
 * THREE FIXES:
 *   1. Money Left math (computeMoneyLeft) → wraps to use WJP_TxnHygiene-cleaned
 *      transactions so Zelle / internal transfers don't inflate income or
 *      spending. Numbers stay in sync with Calendar.
 *   2. computeRealMonthlyIncome → same wrap so Income comes from real payroll
 *      only, not from inflated Zelle credits.
 *   3. renderUpcomingList → rebuild using rp.nextDate (real due date) instead
 *      of rp.anchorDay (which is just a day-of-month). Filter via
 *      WJP_PaymentStatus so already-paid bills don't show.
 */
(function () {
  'use strict';
  if (window._wjpDashMoneyInstalled) return;
  window._wjpDashMoneyInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function getAppState() {
    try { return (typeof appState !== 'undefined') ? appState : null; } catch (_) { return null; }
  }

  // ── Wrap helper — swap in cleaned transactions for the duration of fn ──
  function wrapWithCleanTxns(fn) {
    return function () {
      var s = getAppState();
      if (!s || !window.WJP_TxnHygiene || typeof window.WJP_TxnHygiene.buildClean !== 'function') {
        return fn.apply(this, arguments);
      }
      var raw = s.transactions;
      if (!raw || !raw.length) return fn.apply(this, arguments);
      var clean = window.WJP_TxnHygiene.buildClean(raw);
      s.transactions = clean;
      try {
        return fn.apply(this, arguments);
      } finally {
        s.transactions = raw;
      }
    };
  }

  function patchMoneyFunctions() {
    var patched = false;
    ['computeMoneyLeft', 'computeRealMonthlyIncome', 'detectSpendingVariance'].forEach(function (name) {
      try {
        if (typeof window[name] === 'function' && !window[name].__wjpMoneyWrapped) {
          var orig = window[name];
          var wrapped = wrapWithCleanTxns(orig);
          wrapped.__wjpMoneyWrapped = true;
          window[name] = wrapped;
          patched = true;
        }
      } catch (_) {}
    });
    return patched;
  }

  // ── Replace renderUpcomingList with a version that uses real nextDate ──
  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0); }
  function todayMs() {
    var d = new Date(); d.setHours(0,0,0,0); return d.getTime();
  }

  function renderUpcomingCorrected() {
    try {
      var listView = document.getElementById('upcoming-list-view');
      if (!listView) return false;
      var s = getAppState();
      if (!s) return false;

      var debts = s.debts || [];
      var rps = s.recurringPayments || [];
      var ps = window.WJP_PaymentStatus;
      var txns = s.transactions || [];

      var now = new Date();
      var nowMs = todayMs();

      // Empty state
      var hasDebts = debts.length > 0;
      var activeRec = rps.filter(function (r) { return r && !r.linkedIncome && (r.category || '').toLowerCase() !== 'income' && (!r.status || (r.status !== 'cancelled' && r.status !== 'paused')); }).length;
      if (!hasDebts && activeRec === 0) {
        listView.innerHTML =
          '<div style="text-align:center; padding:40px 16px;">'
        + '  <i class="ph ph-calendar-x" style="font-size:36px; color:rgba(255,255,255,0.2); display:block; margin-bottom:12px;"></i>'
        + '  <div style="font-size:13px; font-weight:600; color:rgba(255,255,255,0.4); margin-bottom:4px;">No upcoming payments</div>'
        + '  <div style="font-size:11px; color:rgba(255,255,255,0.25); line-height:1.5;">Add your debts or recurring bills<br>to see your schedule here</div>'
        + '</div>';
        return true;
      }

      // Build items list
      var items = [];

      // Recurring payments — use nextDate as real due date, skip income, skip already-paid
      rps.forEach(function (r) {
        if (!r) return;
        if (r.linkedIncome) return;
        if ((r.category || '').toLowerCase() === 'income') return;
        if (r.status === 'cancelled' || r.status === 'paused') return;
        if (!r.nextDate) return;

        // Use payment-status to filter out already-paid + stale
        var status = ps ? ps.classify(r, txns) : null;
        if (status === 'paid' || status === 'stale') return;

        var nextDate = new Date(String(r.nextDate).slice(0, 10) + 'T12:00:00');
        if (isNaN(nextDate.getTime())) return;
        var daysUntil = Math.round((nextDate.getTime() - nowMs) / 86400000);

        items.push({
          name: r.name || 'Recurring',
          minPayment: Math.abs(parseFloat(r.amount) || 0),
          apr: 0,
          daysUntil: daysUntil,
          nextDate: nextDate,
          dueDate: nextDate.getDate(),
          _kind: 'recurring',
          rpId: r.id
        });
      });

      // Debts — fall back to dueDate day-of-month if no nextDate on linked recurring
      debts.forEach(function (d) {
        if (!d) return;
        // Skip debts that already have a recurring entry (already added above)
        var hasRecurring = rps.some(function (r) { return r && r.linkedDebtId === d.id; });
        if (hasRecurring) return;
        var dueDay = parseInt(d.dueDate) || 15;
        var nextDate = new Date(now.getFullYear(), now.getMonth(), dueDay, 12, 0, 0);
        if (nextDate < now) nextDate.setMonth(nextDate.getMonth() + 1);
        var daysUntil = Math.round((nextDate.getTime() - nowMs) / 86400000);
        items.push({
          name: d.name,
          minPayment: parseFloat(d.minPayment) || 0,
          apr: parseFloat(d.apr) || 0,
          daysUntil: daysUntil,
          nextDate: nextDate,
          dueDate: dueDay,
          _kind: 'debt'
        });
      });

      items.sort(function (a, b) { return a.daysUntil - b.daysUntil; });

      var iconMap = { mortgage: 'ph-house', loan: 'ph-student', car: 'ph-car', auto: 'ph-car', credit: 'ph-credit-card', card: 'ph-credit-card', insurance: 'ph-shield-check', electric: 'ph-lightning', power: 'ph-lightning', water: 'ph-drop', internet: 'ph-wifi-high' };
      var bgMap  = { 'ph-house': 'rgba(255,77,109,0.12)', 'ph-student': 'var(--accent-dim)', 'ph-car': 'rgba(102,126,234,0.12)', 'ph-credit-card': 'rgba(255,171,64,0.12)', 'ph-shield-check': 'rgba(34,197,94,0.12)', 'ph-lightning': 'rgba(251,191,36,0.12)', 'ph-drop': 'rgba(14,165,233,0.12)', 'ph-wifi-high': 'rgba(167,139,250,0.12)', 'ph-currency-dollar': 'rgba(255,255,255,0.05)' };
      var clrMap = { 'ph-house': 'var(--danger)', 'ph-student': 'var(--accent)', 'ph-car': '#667eea', 'ph-credit-card': '#ffab40', 'ph-shield-check': '#22c55e', 'ph-lightning': '#fbbf24', 'ph-drop': '#0ea5e9', 'ph-wifi-high': '#a78bfa', 'ph-currency-dollar': 'var(--text-2)' };

      listView.innerHTML = items.map(function (d) {
        var key = Object.keys(iconMap).find(function (k) { return (d.name || '').toLowerCase().indexOf(k) >= 0; }) || 'dollar';
        var icon = iconMap[key] || 'ph-currency-dollar';
        var isOverdue = d.daysUntil < 0;
        var isUrgent = d.daysUntil >= 0 && d.daysUntil <= 5;
        var label = isOverdue ? Math.abs(d.daysUntil) + ' day' + (Math.abs(d.daysUntil) === 1 ? '' : 's') + ' overdue'
                  : d.daysUntil === 0 ? 'Due today'
                  : 'Due in ' + d.daysUntil + ' day' + (d.daysUntil === 1 ? '' : 's');
        var dateStr = d.nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return ''
        + '<div class="card upcoming-item" style="padding:14px; margin-bottom:10px; display:flex; align-items:center;">'
        +   '<div class="upcoming-icon" style="background:' + (bgMap[icon]||'rgba(255,255,255,0.05)') + '; color:' + (clrMap[icon]||'var(--text-2)') + '; width:36px; height:36px; border-radius:8px; display:grid; place-items:center;">'
        +     '<i class="ph ' + icon + '" style="font-size:18px;"></i>'
        +   '</div>'
        +   '<div style="flex:1; margin-left:12px; min-width:0;">'
        +     '<div class="upcoming-name" style="font-size:13px; font-weight:700;">' + (d.name || '').replace(/</g,'&lt;') + '</div>'
        +     '<div class="upcoming-due" style="font-size:10px; color:' + (isOverdue ? 'var(--danger)' : 'var(--text-3)') + '; margin-top:2px; font-weight:' + (isOverdue ? '700' : '500') + ';">' + label + ' · ' + dateStr + (d.apr ? ' · APR ' + d.apr + '%' : '') + '</div>'
        +   '</div>'
        +   '<div class="upcoming-amount" style="text-align:right; flex-shrink:0;">'
        +     '<div class="upcoming-val" style="font-size:13px; font-weight:800;">' + fmtUSD(d.minPayment) + '</div>'
        +     '<div class="' + (isOverdue ? 'badge badge-danger' : isUrgent ? 'badge badge-danger' : 'card-sub') + '" style="margin-top:4px; font-size:9px; padding:2px 6px;">' + (isOverdue ? 'OVERDUE' : isUrgent ? 'URGENT' : 'SCHEDULED') + '</div>'
        +   '</div>'
        + '</div>';
      }).join('');
      return true;
    } catch (e) { try { console.warn('[wjp-dashboard-money] upcoming threw', e); } catch (_) {} return false; }
  }

  function patchUpcoming() {
    if (typeof window.renderUpcomingList !== 'function') return false;
    if (window.renderUpcomingList.__wjpMoneyWrapped) return true;
    var orig = window.renderUpcomingList;
    var wrapped = function () {
      // Our corrected version replaces the host's — call ours INSTEAD of orig
      if (!renderUpcomingCorrected()) {
        // If our render failed, fall back to the original
        return orig.apply(this, arguments);
      }
    };
    wrapped.__wjpMoneyWrapped = true;
    window.renderUpcomingList = wrapped;
    return true;
  }

  function patchAll() {
    var a = patchMoneyFunctions();
    var b = patchUpcoming();
    return a || b;
  }

  function whenReady(fn) {
    if (getAppState()) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (getAppState()) { clearInterval(iv); fn(); }
      else if (++tries > 60) clearInterval(iv);
    }, 400);
  }

  function boot() {
    whenReady(function () {
      patchAll();
      // Re-patch periodically in case host reassigns
      setInterval(patchAll, 1500);
      // Re-render upcoming once we've wrapped
      setTimeout(function () {
        try { if (typeof window.renderUpcomingList === 'function') window.renderUpcomingList(); } catch (_) {}
        try { if (typeof window.renderMoneyLeftWidget === 'function') window.renderMoneyLeftWidget(); } catch (_) {}
      }, 1000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 700); });
  else setTimeout(boot, 700);

  window.WJP_DashboardMoney = { patchAll: patchAll, renderUpcoming: renderUpcomingCorrected };
})();
