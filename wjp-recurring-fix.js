/* wjp-recurring-fix.js — Populate Payment Optimization AI + Payoff Countdown.
 *
 * Both sections in the Recurring Payments tab show empty states despite the
 * user having data. Root causes (per app.js audit):
 *   - Payoff Countdown filters appState.recurringPayments for `r.cat==='debt'`
 *     but the actual schema uses `r.category`. So the filter always returns 0.
 *   - Payment Optimization AI has no renderer at all in app.js. The default
 *     index.html state is the empty placeholder; nothing ever toggles it.
 *
 * This module sidesteps both bugs:
 *   - For Payoff Countdown: detect empty state, recompute from window.calculate-
 *     DebtPayoff (which uses internal appState.debts directly) and populate.
 *   - For Payment Optimization: compute fee-prevention + cash-flow tips from
 *     data we can harvest (debts visible in DOM, recurring rows in table) and
 *     fill the existing content panel structure.
 */
(function () {
  'use strict';
  if (window._wjpRecurringFixInstalled) return;
  window._wjpRecurringFixInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return '-';
    return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  // Harvest debts from any visible Current Obligations cards
  function harvestDebts() {
    var debts = [];
    var cards = document.querySelectorAll('[data-debt-id], .debt-card, .obligation-card');
    cards.forEach(function (card) {
      try {
        var nameEl = card.querySelector('h3, h4, .debt-name, .obligation-name, [class*="title"]');
        var name = nameEl ? nameEl.textContent.trim() : null;
        if (!name) return;
        var text = card.textContent.replace(/\s+/g, ' ');
        var balance = parseFloat((text.match(/Balance[\s:]*\$?([\d,]+\.?\d*)/i) || [])[1] || '0'.replace(/,/g, ''));
        var apr = parseFloat((text.match(/APR[\s:]*([\d.]+)%/i) || text.match(/([\d.]+)%[\s]*APR/i) || [])[1] || '0');
        var min = parseFloat((text.match(/Min[\.]?\s*Payment[\s:]*\$?([\d,]+\.?\d*)/i) || [])[1] || '0'.replace(/,/g, ''));
        var util = parseFloat((text.match(/Utilization[\s:]*([\d.]+)%/i) || [])[1] || '0');
        var stmtDay = parseInt((text.match(/(?:Pay\s*by|Statement)[^0-9]*([\d]+)/i) || [])[1] || '0', 10);
        debts.push({ id: card.dataset.debtId || name, name: name, balance: balance, apr: apr, min: min, utilization: util, statementDay: stmtDay });
      } catch (_) {}
    });
    return debts;
  }

  // === Fix 1: Payoff Countdown ===
  function fixPayoffCountdown() {
    var el = document.getElementById('rec-countdown');
    if (!el) return;
    var visible = el.offsetParent !== null;
    if (!visible) return;
    var txt = (el.textContent || '').trim();
    // Only intervene if the empty state is showing OR the panel was rendered with bad data
    var alreadyOurs = el.dataset.wjpFixed === '1';
    var isEmpty = /no\s+debt\s+payments\s+found/i.test(txt);
    if (alreadyOurs && !isEmpty) return;
    if (typeof window.calculateDebtPayoff !== 'function') return;

    var debts = harvestDebts();
    if (!debts.length) return;

    // Compute payoff stats per debt using the engine
    var results;
    try { results = window.calculateDebtPayoff('avalanche'); } catch (e) { results = null; }

    var html = debts.slice(0, 6).map(function (d) {
      var months = 0, totalInt = 0;
      if (results && results[d.id]) {
        months = results[d.id].months || 0;
        totalInt = results[d.id].totalInterest || 0;
      } else if (d.min > 0 && d.balance > 0 && d.apr > 0) {
        // Quick fallback: months ≈ balance / (min - monthly interest) capped
        var monthlyInt = (d.balance * d.apr / 100) / 12;
        var principal = Math.max(1, d.min - monthlyInt);
        months = Math.min(600, Math.ceil(d.balance / principal));
        totalInt = monthlyInt * months;
      }
      var dateStr;
      if (months >= 600 || months <= 0) {
        dateStr = '∞ (never at min)';
      } else {
        var pdate = new Date();
        pdate.setMonth(pdate.getMonth() + months);
        dateStr = pdate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }
      var monthsStr = months >= 600 ? '∞' : months + ' mo';
      var barColor = d.apr > 20 ? '#dc2626' : d.apr > 10 ? '#c99a2a' : '#1f7a4a';
      var pct = d.balance > 0 ? Math.min(100, Math.round(((d.utilization || 0)))) : 0;
      return '<div style="margin-bottom:14px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:12px;font-weight:700;color:var(--text,#0a0a0a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</div>'
        +     '<div style="font-size:10px;color:var(--text-3,#9ca3af);margin-top:1px;">Free: ' + dateStr + ' · ' + fmtUSD(d.balance) + ' left</div>'
        +   '</div>'
        +   '<div style="font-size:12px;font-weight:800;color:' + barColor + ';flex-shrink:0;margin-left:10px;">' + monthsStr + '</div>'
        + '</div>'
        + '<div style="height:5px;background:rgba(0,0,0,0.06);border-radius:999px;overflow:hidden;">'
        +   '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:999px;transition:width .3s;"></div>'
        + '</div>'
        + '</div>';
    }).join('');

    el.innerHTML = html || '<div style="color:#9ca3af;font-size:11px;">No debt data harvested yet — visit Debts → Overview tab once.</div>';
    el.dataset.wjpFixed = '1';
  }

  // === Fix 2: Payment Optimization AI ===
  function fixPaymentOptimization() {
    var emptyEl = document.getElementById('rec-optimization-empty');
    var contentEl = document.getElementById('rec-optimization-content');
    if (!emptyEl || !contentEl) return;
    if (emptyEl.offsetParent === null && contentEl.style.display !== 'none') return; // already showing content

    var debts = harvestDebts();
    if (!debts.length) return;

    // === Fee Prevention insight: find the highest-utilization card ===
    var highestUtil = debts.filter(function (d) { return d.utilization > 0; }).sort(function (a, b) { return b.utilization - a.utilization; })[0];
    var feeMsg = '';
    if (highestUtil && highestUtil.utilization >= 30) {
      var dropTo30 = Math.max(0, highestUtil.balance - (highestUtil.balance * (30 / highestUtil.utilization)));
      feeMsg = '<b>' + highestUtil.name + '</b> is at <b style="color:#dc2626;">' + Math.round(highestUtil.utilization) + '% utilization</b>. '
        + 'Pay <b>' + fmtUSD(dropTo30) + '</b> before the statement closes to drop it under 30% — that’s the threshold where credit-score damage starts.';
    } else if (debts.length > 0) {
      var topApr = debts.sort(function(a,b){return b.apr-a.apr;})[0];
      feeMsg = '<b>' + topApr.name + '</b> at <b style="color:#dc2626;">' + topApr.apr + '% APR</b> is your most expensive debt. Every $100 extra here saves <b>' + fmtUSD(topApr.apr) + '/year</b> in interest forever.';
    } else {
      feeMsg = 'Add debt details to see fee-prevention recommendations.';
    }

    // === Cash Flow insight: cluster of bills due in same week ===
    var withDates = debts.filter(function (d) { return d.statementDay > 0; });
    var cashMsg = '';
    if (withDates.length >= 3) {
      // Group by week of month (day // 7)
      var weeks = {};
      withDates.forEach(function (d) {
        var wk = Math.floor((d.statementDay - 1) / 7);
        if (!weeks[wk]) weeks[wk] = [];
        weeks[wk].push(d);
      });
      var biggest = null;
      Object.keys(weeks).forEach(function (k) {
        if (!biggest || weeks[k].length > biggest.count) {
          biggest = { week: k, count: weeks[k].length, items: weeks[k] };
        }
      });
      if (biggest && biggest.count >= 3) {
        var totalDue = biggest.items.reduce(function (s, x) { return s + (x.min || 0); }, 0);
        var weekStart = parseInt(biggest.week, 10) * 7 + 1;
        cashMsg = 'You have <b>' + biggest.count + ' bills</b> due between day ' + weekStart + '–' + (weekStart + 6) + ' totaling <b>' + fmtUSD(totalDue) + '</b>. '
          + 'Call one or two creditors and ask to shift the due date to a different week — most will say yes once a year. Smooths your cash flow and lowers overdraft risk.';
      }
    }
    if (!cashMsg) {
      var totalMin = debts.reduce(function (s, d) { return s + (d.min || 0); }, 0);
      cashMsg = 'Your minimums total <b>' + fmtUSD(totalMin) + '/mo</b> across ' + debts.length + ' debts. Set up auto-pay 2 days BEFORE each due date so a payment never lands late even if a bank holiday delays it.';
    }

    var feeEl = document.getElementById('rec-fee-prevention-msg');
    var cashEl = document.getElementById('rec-cashflow-msg');
    if (feeEl) feeEl.innerHTML = feeMsg;
    if (cashEl) cashEl.innerHTML = cashMsg;

    emptyEl.style.display = 'none';
    contentEl.style.display = '';
  }

  function tick() {
    try { fixPayoffCountdown(); } catch (e) {}
    try { fixPaymentOptimization(); } catch (e) {}
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WJP_RecurringFix = { refresh: tick, harvest: harvestDebts };
})();
