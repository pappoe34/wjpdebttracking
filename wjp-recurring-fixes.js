/* wjp-recurring-fixes.js — Surgical fixes for Recurring Payments tab.
 *
 * Bug 1: Pay-Off Countdown (#rec-countdown) shows "No debt payments found"
 *        because app.js filters on r.cat==='debt' && r.debtId, but user's
 *        recurringPayments items aren't linked to debt IDs. Override: render
 *        from appState.debts via the public window.calculateDebtPayoff API.
 *
 * Bug 2: Payment Optimization AI (#rec-optimization-ai) shows empty state
 *        with no toggle logic. Override: detect when debts exist, hide
 *        #rec-optimization-empty, populate #rec-optimization-content with
 *        real, plain-language optimization tips.
 *
 * Hardened: IIFE, idempotent, path-guarded, no MutationObservers, polled.
 */
(function () {
  'use strict';
  if (window._wjpRecurringFixesInstalled) return;
  window._wjpRecurringFixesInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var debtCache = {};

  function fmtUSD(n) {
    if (!isFinite(n)) return '-';
    return '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function fmtUSDc(n) {
    if (!isFinite(n)) return '-';
    return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  }

  function harvestDebtsFromObligations() {
    // Supports 3 card formats found in the DOM:
    // 1) Current Obligations card: "Balance: $X · APR X% · Min Payment: $X"
    // 2) Top-3 card: "Avant Credit Card 30.00% APR Highest APR 30% \u00b7 bleeds $59/mo $0 paid 0% $2,356 left"
    // 3) Indicator/strategy chip cards
    var cards = document.querySelectorAll('[data-debt-id], .debt-card, .obligation-card, .top3-card');
    cards.forEach(function (card) {
      try {
        var id = card.dataset.debtId || null;
        // Name: text BEFORE the first APR-like number, OR explicit name elements
        var nameEl = card.querySelector('.debt-name, .obligation-name, h3, h4, [class*="title"]');
        var name = nameEl ? nameEl.textContent.trim() : null;
        var text = card.textContent.replace(/\s+/g, ' ').trim();
        if (!name) {
          // Strip leading rank number "1 " then capture up to " <num>.<num>% APR"
          var nameMatch = text.replace(/^\s*\d+[\s.\u00a0]+/, '').match(/^(.+?)\s+\d+(?:\.\d+)?%\s+APR/i);
          if (nameMatch) name = nameMatch[1].trim();
        }
        if (!name) return;
        // APR — try multiple shapes
        var apr = null;
        var aprMatch = text.match(/(\d+(?:\.\d+)?)%\s+APR/i) || text.match(/APR[\s:]*?(\d+(?:\.\d+)?)%/i);
        if (aprMatch) apr = parseFloat(aprMatch[1]);
        // Balance — "Balance: $X" OR "$X left"
        var balance = null;
        var balMatch = text.match(/Balance[\s:]*\$?([\d,]+\.?\d*)/i)
          || text.match(/\$([\d,]+\.?\d*)\s+left/i)
          || text.match(/\$([\d,]+\.?\d*)\s+balance/i);
        if (balMatch) balance = parseFloat(balMatch[1].replace(/,/g, ''));
        // Min payment — "Min: $X" OR "bleeds $X/mo" OR "$X/mo min"
        var minPayment = null;
        var minMatch = text.match(/Min[\.]?\s*Payment[\s:]*\$?([\d,]+\.?\d*)/i)
          || text.match(/bleeds\s+\$([\d,]+\.?\d*)\s*\/?mo/i)
          || text.match(/\$([\d,]+\.?\d*)\s*\/mo\s+min/i);
        if (minMatch) minPayment = parseFloat(minMatch[1].replace(/,/g, ''));
        var key = id || ('name:' + name);
        var prev = debtCache[key] || {};
        debtCache[key] = {
          id: key,
          name: name,
          balance: balance != null ? balance : prev.balance,
          apr: apr != null ? apr : prev.apr,
          minPayment: minPayment != null ? minPayment : prev.minPayment
        };
      } catch (_) {}
    });
  }

  function getCalcResults() {
    try {
      if (typeof window.calculateDebtPayoff === 'function') {
        var r = window.calculateDebtPayoff('avalanche');
        return r && typeof r === 'object' ? r : null;
      }
    } catch (_) {}
    return null;
  }

  // === Fix 1: Pay-Off Countdown ===
  function renderCountdown() {
    var el = document.getElementById('rec-countdown');
    if (!el) return;
    var debts = Object.values(debtCache).filter(function (d) { return d.name && (d.balance || d.minPayment); });
    if (!debts.length) return;

    var calcs = getCalcResults();
    var maxMonths = 0;
    if (calcs) {
      Object.keys(calcs).forEach(function (k) {
        var m = calcs[k] && calcs[k].months;
        if (m && m < 600 && m > maxMonths) maxMonths = m;
      });
    }
    if (!maxMonths) maxMonths = 60;

    var html = '';
    debts.sort(function (a, b) { return (b.apr || 0) - (a.apr || 0); }).forEach(function (d) {
      // Find calc by NAME match — calculateDebtPayoff returns map keyed by debt ID,
      // but our cached debts have names. We need a way to match. Try by amount or balance.
      var match = null;
      if (calcs) {
        Object.keys(calcs).forEach(function (k) {
          var c = calcs[k];
          if (c && Math.abs((c.startBalance || c.balance || 0) - (d.balance || 0)) < 1) match = c;
        });
      }
      var months = match ? (match.months || 0) : null;
      // Fallback: compute from balance + apr + min payment
      if (!months && d.balance && d.minPayment) {
        var monthlyRate = (d.apr || 0) / 100 / 12;
        var bal = d.balance;
        var min = d.minPayment;
        var m = 0;
        while (bal > 0.01 && m < 600) {
          var interest = bal * monthlyRate;
          var principal = Math.max(0, min - interest);
          if (principal <= 0) { m = 600; break; }
          bal -= principal;
          m++;
        }
        months = m;
      }
      if (!months) months = 60;
      var pct = months >= 600 ? 0 : Math.max(2, Math.min(100, Math.round(100 - (months / maxMonths * 100))));
      var color = (d.apr || 0) > 20 ? '#dc2626' : (d.apr || 0) > 10 ? '#c99a2a' : '#1f7a4a';
      var dateStr;
      if (months >= 600) dateStr = '50+ years';
      else {
        var dt = new Date();
        dt.setMonth(dt.getMonth() + months);
        dateStr = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }
      html += '<div style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.06);">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;font-family:Inter,system-ui,sans-serif;">'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:12px;font-weight:700;color:#0a0a0a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + d.name + '</div>'
        +     '<div style="font-size:10px;color:#9ca3af;font-weight:500;">Freedom: ' + dateStr + (d.balance ? ' · ' + fmtUSD(d.balance) + ' remaining' : '') + '</div>'
        +   '</div>'
        +   '<div style="font-size:12px;font-weight:800;color:' + color + ';flex-shrink:0;margin-left:10px;">' + (months >= 600 ? '∞' : months + ' mo') + '</div>'
        + '</div>'
        + '<div style="height:5px;background:rgba(0,0,0,0.05);border-radius:999px;overflow:hidden;">'
        +   '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:999px;transition:width .3s;"></div>'
        + '</div>'
        + '</div>';
    });
    if (el.dataset.wjpFixed === html) return; // no-op if unchanged
    el.dataset.wjpFixed = html;
    el.innerHTML = html;
    el.style.display = 'block';
  }

  // === Fix 2: Payment Optimization AI ===
  function renderOptimization() {
    var ai = document.getElementById('rec-optimization-ai');
    if (!ai) return;
    var emptyEl = document.getElementById('rec-optimization-empty');
    var contentEl = document.getElementById('rec-optimization-content');
    var debts = Object.values(debtCache).filter(function (d) { return d.name && (d.balance || d.minPayment); });
    if (!debts.length) return; // leave empty state

    // Identify top 3 issues + fixes
    var insights = [];

    // (a) Highest-APR debt = biggest interest bleed
    var topAPR = null;
    debts.forEach(function (d) {
      if (d.apr && d.balance && (!topAPR || (d.apr > topAPR.apr))) topAPR = d;
    });
    if (topAPR) {
      var monthlyInterest = (topAPR.balance * topAPR.apr / 100) / 12;
      insights.push({
        icon: '🔥',
        title: 'Your biggest interest bleed',
        body: topAPR.name + ' costs you ' + fmtUSDc(monthlyInterest) + '/mo in interest at ' + topAPR.apr + '% APR. Every dollar above the minimum here saves more than the same dollar anywhere else.',
        action: 'Add $50–$100/mo extra to ' + topAPR.name + ' specifically. Use the Aggressive tab to see the impact.'
      });
    }

    // (b) Biggest balance = longest tail
    var topBal = null;
    debts.forEach(function (d) {
      if (d.balance && (!topBal || d.balance > topBal.balance)) topBal = d;
    });
    if (topBal && topBal !== topAPR) {
      insights.push({
        icon: '📉',
        title: 'Your largest balance',
        body: topBal.name + ' carries the most weight at ' + fmtUSD(topBal.balance) + (topBal.apr ? ' (' + topBal.apr + '% APR)' : '') + '. Avalanche math says hit it after the high-APR card; Snowball math says hit it last. Either way, paying minimums alone leaves it lingering.',
        action: 'After clearing the highest-APR debt, pivot all freed-up payments to ' + topBal.name + '.'
      });
    }

    // (c) Total monthly minimum + opportunity
    var totalMin = debts.reduce(function (s, d) { return s + (d.minPayment || 0); }, 0);
    if (totalMin > 0) {
      insights.push({
        icon: '💵',
        title: 'Your full minimum stack',
        body: 'You\'re paying ' + fmtUSDc(totalMin) + '/mo across all debts just to stay current — ' + fmtUSDc(totalMin * 12) + '/year. As each debt clears, redirect its minimum to the next target. That payment cascade is what gets you free in years instead of decades.',
        action: 'Set up auto-pay for the minimums and a separate auto-transfer for the extra. Pay debt FIRST, not LAST out of every paycheck.'
      });
    }

    // (d) Cash flow alignment — if income data is exposed
    insights.push({
      icon: '🗓️',
      title: 'Cash flow alignment',
      body: 'Stack your due dates within 5 days of payday. Late fees and overdrafts almost always come from due-date misalignment, not lack of money. One 30-min call to each issuer can shift due dates.',
      action: 'List due dates next to your payday. Move any that fall before payday by calling the issuer.'
    });

    // Render into contentEl, hide emptyEl
    if (emptyEl) emptyEl.style.display = 'none';
    if (contentEl) {
      var html = '<div style="font-family:Inter,system-ui,sans-serif;display:grid;gap:10px;">';
      insights.forEach(function (i) {
        html += '<div style="background:rgba(31,122,74,0.04);border:1px solid rgba(31,122,74,0.18);border-radius:10px;padding:12px 14px;">'
          + '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:6px;">'
          +   '<div style="font-size:18px;flex-shrink:0;">' + i.icon + '</div>'
          +   '<div style="flex:1;">'
          +     '<div style="font-weight:700;font-size:13px;color:#0a0a0a;margin-bottom:3px;">' + i.title + '</div>'
          +     '<div style="font-size:12.5px;color:#1a1a1a;line-height:1.55;">' + i.body + '</div>'
          +   '</div>'
          + '</div>'
          + '<div style="background:#fff;border-left:3px solid #1f7a4a;padding:8px 12px;border-radius:0 6px 6px 0;margin-top:8px;">'
          +   '<div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:2px;">Action</div>'
          +   '<div style="font-size:12px;color:#1a1a1a;line-height:1.5;">' + i.action + '</div>'
          + '</div>'
          + '</div>';
      });
      html += '</div>';
      if (contentEl.dataset.wjpFixed !== html) {
        contentEl.dataset.wjpFixed = html;
        contentEl.innerHTML = html;
      }
      contentEl.style.display = 'block';
    }
  }

  function tick() {
    try {
      harvestDebtsFromObligations();
      renderCountdown();
      renderOptimization();
    } catch (e) {
      try { console.warn('[wjp-recurring-fixes] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WJP_RecurringFixes = { refresh: tick };
})();
