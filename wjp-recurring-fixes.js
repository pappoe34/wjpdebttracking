/* wjp-recurring-fixes.js v7 — sibling-clone strategy.
 *
 * v6 polled at 600ms which still lost the race against app.js's
 * recRenderCountdown clobbering #rec-countdown after tab clicks.
 *
 * v7: stop fighting. Hide #rec-countdown and #rec-optimization-content
 * with display:none, inject sibling elements WE own. App.js writes to
 * the originals harmlessly — user only ever sees our siblings.
 *
 * Data source: window.calculateDebtPayoff('avalanche') — gives us all 12
 * debts directly. Names from [data-debt-id] DOM nodes.
 */
(function () {
  'use strict';
  if (window._wjpRecurringFixesInstalled) return;
  window._wjpRecurringFixesInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CD_CLONE = 'wjp-rec-countdown-clone';
  var OPT_CLONE = 'wjp-rec-optimization-clone';
  var debtCache = {};

  function fmtUSD(n) { if (!isFinite(n)) return '-'; return '$' + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function fmtUSDc(n) { if (!isFinite(n)) return '-'; return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

  function harvest() {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return;
      var calc = window.calculateDebtPayoff('avalanche');
      if (!calc || typeof calc !== 'object') return;
      var nameMap = {};
      document.querySelectorAll('[data-debt-id]').forEach(function (n) {
        var id = n.dataset.debtId;
        if (!id || nameMap[id]) return;
        var nameEl = n.querySelector('.obligation-name, .debt-name, h3, h4');
        if (nameEl && nameEl.textContent.trim()) { nameMap[id] = nameEl.textContent.trim(); return; }
        var text = (n.textContent || '').replace(/\s+/g, ' ').trim();
        var stripped = text.replace(/^(Priority|Autopay|\d+)\s+/i, '');
        var m = stripped.match(/^(.+?)\s+(Managed Liability|\d+(?:\.\d+)?%\s+APR)/i);
        if (m) nameMap[id] = m[1].trim();
      });
      Object.keys(calc).forEach(function (id) {
        var e = calc[id] || {};
        debtCache[id] = {
          id: id, name: nameMap[id] || ('Debt ' + id.slice(-6)),
          balance: e.balance, apr: e.apr, minPayment: e.min,
          months: e.months, totalInterest: e.totalInterest, type: e.type
        };
      });
    } catch (err) {
      try { console.warn('[wjp-recurring-fixes v7] harvest threw', err); } catch (_) {}
    }
  }

  function ensureClone(originalId, cloneId) {
    var orig = document.getElementById(originalId);
    if (!orig) return null;
    // Hide original — app.js can clobber freely, user never sees it.
    if (orig.style.display !== 'none') orig.style.display = 'none';
    var clone = document.getElementById(cloneId);
    if (!clone) {
      clone = document.createElement('div');
      clone.id = cloneId;
      clone.style.cssText = 'font-family:Inter,system-ui,sans-serif;';
      orig.parentNode.insertBefore(clone, orig.nextSibling);
    }
    return clone;
  }

  function buildCountdownHTML() {
    var debts = Object.values(debtCache).filter(function (d) { return d.name && d.balance != null && d.balance > 0; });
    if (!debts.length) return '';
    var maxMonths = 0;
    debts.forEach(function (d) { if (d.months && d.months < 600 && d.months > maxMonths) maxMonths = d.months; });
    if (!maxMonths) maxMonths = 60;
    debts.sort(function (a, b) { return (b.apr || 0) - (a.apr || 0); });
    var html = '';
    debts.forEach(function (d) {
      var months = d.months || 0;
      var pct = months >= 600 ? 0 : Math.max(2, Math.min(100, Math.round(100 - (months / maxMonths * 100))));
      var color = (d.apr || 0) >= 20 ? '#dc2626' : (d.apr || 0) >= 10 ? '#c99a2a' : '#1f7a4a';
      var dateStr;
      if (months >= 600) dateStr = '50+ years';
      else { var dt = new Date(); dt.setMonth(dt.getMonth() + months); dateStr = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
      html += '<div style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.06);">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px;">'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:12.5px;font-weight:700;color:#0a0a0a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + d.name + '</div>'
        +     '<div style="font-size:10.5px;color:#9ca3af;font-weight:500;">Freedom: ' + dateStr + ' · ' + fmtUSD(d.balance) + ' remaining</div>'
        +   '</div>'
        +   '<div style="font-size:12.5px;font-weight:800;color:' + color + ';flex-shrink:0;">' + (months >= 600 ? '∞' : months + ' mo') + '</div>'
        + '</div>'
        + '<div style="height:5px;background:rgba(0,0,0,0.05);border-radius:999px;overflow:hidden;">'
        +   '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:999px;transition:width .3s;"></div>'
        + '</div>'
        + '</div>';
    });
    return html;
  }

  function buildOptimizationHTML() {
    var debts = Object.values(debtCache).filter(function (d) { return d.name && (d.balance || d.minPayment); });
    if (!debts.length) return '';
    var insights = [];
    var topAPR = null;
    debts.forEach(function (d) { if (d.apr && d.balance && (!topAPR || d.apr > topAPR.apr)) topAPR = d; });
    if (topAPR) {
      var monthlyInterest = (topAPR.balance * topAPR.apr / 100) / 12;
      insights.push({
        title: 'Your biggest interest bleed',
        body: topAPR.name + ' costs you ' + fmtUSDc(monthlyInterest) + '/mo in interest at ' + topAPR.apr + '% APR. Every dollar above the minimum here saves more than the same dollar anywhere else.',
        action: 'Add $50–$100/mo extra to ' + topAPR.name + ' specifically. Use the Aggressive tab to see the impact.'
      });
    }
    var topBal = null;
    debts.forEach(function (d) { if (d.balance && (!topBal || d.balance > topBal.balance)) topBal = d; });
    if (topBal && topBal !== topAPR) {
      insights.push({
        title: 'Your largest balance',
        body: topBal.name + ' carries the most weight at ' + fmtUSD(topBal.balance) + (topBal.apr ? ' (' + topBal.apr + '% APR)' : '') + '. Avalanche says hit it after the high-APR card; Snowball says hit it last. Either way, paying minimums alone leaves it lingering.',
        action: 'After clearing the highest-APR debt, redirect all freed-up payments to ' + topBal.name + '.'
      });
    }
    var totalMin = debts.reduce(function (s, d) { return s + (d.minPayment || 0); }, 0);
    if (totalMin > 0) {
      insights.push({
        title: 'Your full minimum stack',
        body: "You're paying " + fmtUSDc(totalMin) + '/mo across all debts just to stay current — ' + fmtUSDc(totalMin * 12) + '/year. As each debt clears, redirect its minimum to the next target. That payment cascade is what gets you free in years instead of decades.',
        action: 'Set up auto-pay for the minimums and a separate auto-transfer for the extra. Pay debt FIRST, not LAST out of every paycheck.'
      });
    }
    insights.push({
      title: 'Cash flow alignment',
      body: 'Stack your due dates within 5 days of payday. Late fees and overdrafts almost always come from due-date misalignment, not lack of money. One 30-min call to each issuer can shift due dates.',
      action: 'List due dates next to your payday. Move any that fall before payday by calling the issuer.'
    });
    var html = '<div style="display:grid;gap:10px;">';
    insights.forEach(function (i) {
      html += '<div style="background:rgba(31,122,74,0.04);border:1px solid rgba(31,122,74,0.18);border-radius:10px;padding:12px 14px;">'
        + '<div style="font-weight:700;font-size:13px;color:#0a0a0a;margin-bottom:4px;letter-spacing:-0.005em;">' + i.title + '</div>'
        + '<div style="font-size:12.5px;color:#1a1a1a;line-height:1.55;">' + i.body + '</div>'
        + '<div style="background:#fff;border-left:3px solid #1f7a4a;padding:8px 12px;border-radius:0 6px 6px 0;margin-top:10px;">'
        +   '<div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:2px;">Action</div>'
        +   '<div style="font-size:12px;color:#1a1a1a;line-height:1.5;">' + i.action + '</div>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderCountdown() {
    var clone = ensureClone('rec-countdown', CD_CLONE);
    if (!clone) return;
    var html = buildCountdownHTML();
    if (!html) return;
    if (clone.dataset.wjpHtml !== html) {
      clone.dataset.wjpHtml = html;
      clone.innerHTML = html;
    }
    clone.style.display = 'block';
  }

  function renderOptimization() {
    var clone = ensureClone('rec-optimization-content', OPT_CLONE);
    if (!clone) return;
    // Hide the empty-state too if present
    var emptyEl = document.getElementById('rec-optimization-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    var html = buildOptimizationHTML();
    if (!html) return;
    if (clone.dataset.wjpHtml !== html) {
      clone.dataset.wjpHtml = html;
      clone.innerHTML = html;
    }
    clone.style.display = 'block';
  }

  function tick() {
    try {
      harvest();
      renderCountdown();
      renderOptimization();
    } catch (e) {
      try { console.warn('[wjp-recurring-fixes v7] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 600);
    setTimeout(tick, 1500);
    setInterval(tick, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WJP_RecurringFixes = { refresh: tick, _cache: debtCache };
})();
