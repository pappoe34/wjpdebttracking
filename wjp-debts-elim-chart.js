/* wjp-debts-elim-chart.js — Reorder bottom grid + rebuild Elimination Projection
 *
 * Two things on the Debts → Overview page:
 *   1) Move the .debts-bottom-grid (which holds "Latest Transactions" + "WJP
 *      Elimination Projection") so it sits ABOVE the "Current Obligations"
 *      section instead of below it. Reasoning: the projection chart is a
 *      headline planning view; users want it visible before they scroll into
 *      individual card tiles.
 *
 *   2) Replace the placeholder #eliminationChart (currently shows 8 generic
 *      green bars labeled CURRENT → DEBT-FREE with no real numbers) with a
 *      real Chart.js line/bar chart using:
 *         • starting balance: appState totalDebt (or sum of debts[])
 *         • payoff months:    appState.payoffMonths OR derived from
 *                              wjp_budget_state.strategyComparison[Avalanche]
 *         • monthly schedule: smooth amortization curve from
 *                              startBalance → $0 over payoffMonths months,
 *                              weighted toward early plateau then steeper
 *                              late-month drop (matches APR-on-declining-
 *                              principal reality).
 *      Adds proper Y-axis dollars, month-labeled X-axis, gradient fill, and a
 *      "today" marker dot.
 *
 * Dark mode aware. Safe — only touches the canvas + sibling reorder; no
 * Sync Bank / Plaid hooks.
 */
(function () {
  'use strict';
  if (window._wjpElimChartInstalled) return;
  window._wjpElimChartInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CHART_ID = 'eliminationChart';
  var REORDER_MARK = 'data-wjp-grid-reordered';

  // ---------- helpers ----------
  function fmtMoneyShort(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0';
    if (Math.abs(n) >= 1000) return '$' + (n/1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return '$' + Math.round(n);
  }
  function fmtMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function isOnDebts() {
    var pageEl = document.getElementById('page-debts');
    return !!(pageEl && (pageEl.classList.contains('active') || pageEl.offsetParent !== null));
  }
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) { return fallback; }
  }

  // ---------- 1) Reorder bottom-grid above Current Obligations ----------
  function reorderBottomGrid() {
    if (!isOnDebts()) return;
    var grid = document.querySelector('.debts-bottom-grid');
    if (!grid || grid.getAttribute(REORDER_MARK) === '1') return;
    // Find the "Current Obligations" section by its heading
    var headings = document.querySelectorAll('h2, h3, .card-title, [class*="title"], [class*="Title"]');
    var curOblHeader = null;
    for (var i = 0; i < headings.length; i++) {
      var t = (headings[i].textContent || '').trim();
      if (t === 'Current Obligations') { curOblHeader = headings[i]; break; }
    }
    if (!curOblHeader) return;
    // Walk up until we find a sibling of `.debts-bottom-grid`'s parent OR until
    // we have a node whose nextSibling is the parent of the grid.
    // Simpler: insert grid IMMEDIATELY BEFORE the closest ancestor of the heading
    // that is a direct child of the grid's parent (or any ancestor that's
    // before the grid in the same parent).
    var gridParent = grid.parentNode;
    var insertBefore = curOblHeader;
    while (insertBefore && insertBefore.parentNode !== gridParent) {
      insertBefore = insertBefore.parentNode;
    }
    if (!insertBefore || insertBefore === grid) return;
    try {
      gridParent.insertBefore(grid, insertBefore);
      grid.setAttribute(REORDER_MARK, '1');
    } catch (_) {}
  }

  // ---------- 2) Rebuild #eliminationChart with real data ----------
  function getDebtsData() {
    // Try multiple sources for current data state
    var totalBalance = 0;
    var debts = [];
    var payoffMonths = null;
    var strategyLabel = 'Avalanche';

    try {
      if (window.appState && Array.isArray(window.appState.debts)) {
        debts = window.appState.debts;
      } else {
        var raw = localStorage.getItem('wjp_budget_state');
        if (raw) {
          var s = JSON.parse(raw);
          if (Array.isArray(s.debts)) debts = s.debts;
        }
      }
    } catch (_) {}

    debts.forEach(function (d) {
      var b = (typeof d.balance === 'number') ? d.balance
            : (typeof d.currentBalance === 'number') ? d.currentBalance
            : (typeof d.amount === 'number') ? d.amount
            : 0;
      totalBalance += Math.abs(b);
    });

    // Try to pick up the computed payoff timeline (the dashboard already
    // computes this — "October 2030" came from somewhere).
    try {
      if (window.appState) {
        if (typeof window.appState.payoffMonths === 'number') payoffMonths = window.appState.payoffMonths;
        else if (window.appState.strategyComparison && window.appState.strategyComparison.avalanche)
          payoffMonths = window.appState.strategyComparison.avalanche.months;
      }
    } catch (_) {}
    if (!payoffMonths) {
      // Pull the displayed value from the hero card if visible (e.g. "53 Months")
      var monthsText = (document.body.innerText || '').match(/(\d{1,3})\s*Months/);
      if (monthsText) payoffMonths = parseInt(monthsText[1], 10);
    }
    if (!payoffMonths || payoffMonths < 1) payoffMonths = 36; // sane default

    return { totalBalance: totalBalance, payoffMonths: payoffMonths, strategy: strategyLabel };
  }

  // Generate amortization-shaped schedule: starts at totalBalance, ends at 0
  // over `months` periods. Real amortization tapers: balance falls slowly at
  // first (most of payment goes to interest), accelerates toward the end.
  // We approximate with a quadratic ease-in curve.
  function buildSchedule(totalBalance, months) {
    // Pick ~12-18 data points across the timeline so the chart reads cleanly
    var nPoints = Math.min(18, Math.max(8, Math.round(months / 3)));
    var points = [];
    for (var i = 0; i <= nPoints; i++) {
      var t = i / nPoints; // 0..1
      // Easing: balance falls slowly first, steeper later (amortization shape)
      // f(t) = 1 - t^1.4 produces gentle early decline, steeper late
      var remaining = Math.max(0, 1 - Math.pow(t, 1.4));
      var bal = totalBalance * remaining;
      points.push({
        monthIndex: Math.round(t * months),
        balance: Math.round(bal)
      });
    }
    return points;
  }

  function monthLabel(dt) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[dt.getMonth()] + ' ' + (dt.getFullYear() % 100 < 10 ? "'0" + (dt.getFullYear() % 100) : "'" + (dt.getFullYear() % 100));
  }

  function buildLabelsForSchedule(schedule) {
    // Anchor at the current month; project forward by schedule[].monthIndex
    var today = new Date();
    return schedule.map(function (pt) {
      var d = new Date(today.getFullYear(), today.getMonth() + pt.monthIndex, 1);
      return monthLabel(d);
    });
  }

  var _chartInstance = null;
  function rebuildChart() {
    if (!isOnDebts()) return;
    var canvas = document.getElementById(CHART_ID);
    if (!canvas) return;
    if (typeof window.Chart === 'undefined') return; // Chart.js not loaded yet

    var data = getDebtsData();
    if (data.totalBalance <= 0) return; // nothing to chart yet

    var schedule = buildSchedule(data.totalBalance, data.payoffMonths);
    var labels = buildLabelsForSchedule(schedule);
    var values = schedule.map(function (p) { return p.balance; });

    var ctx = canvas.getContext('2d');
    if (_chartInstance && typeof _chartInstance.destroy === 'function') {
      try { _chartInstance.destroy(); } catch (_) {}
      _chartInstance = null;
    } else {
      // If a non-wjp chart exists for this canvas (e.g. the placeholder),
      // Chart.js v3+ exposes Chart.getChart()
      try {
        if (typeof window.Chart.getChart === 'function') {
          var existing = window.Chart.getChart(canvas);
          if (existing) existing.destroy();
        }
      } catch (_) {}
    }

    var ink = cssVar('--ink', '#0a0a0a');
    var inkDim = cssVar('--ink-dim', '#6b7280');
    var border = cssVar('--border', 'rgba(0,0,0,0.08)');

    // Build the gradient fill
    var gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(31,122,74,0.32)');
    gradient.addColorStop(1, 'rgba(31,122,74,0.02)');

    _chartInstance = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Projected balance',
          data: values,
          fill: true,
          backgroundColor: gradient,
          borderColor: '#1f7a4a',
          borderWidth: 2.5,
          pointBackgroundColor: '#1f7a4a',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: function (ctx) {
            // Larger dot for first (today) and last (debt-free) points
            var i = ctx.dataIndex;
            if (i === 0 || i === values.length - 1) return 6;
            return 3;
          },
          pointHoverRadius: 6,
          tension: 0.32,
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10,10,10,0.92)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#1f7a4a',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (ctx) {
                return ' Balance: ' + fmtMoney(ctx.parsed.y);
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: inkDim,
              font: { size: 10, family: 'inherit', weight: '600' },
              callback: function (v) { return fmtMoneyShort(v); }
            },
            grid: { color: border, drawBorder: false, lineWidth: 0.5 }
          },
          x: {
            ticks: {
              color: inkDim,
              font: { size: 10, family: 'inherit', weight: '600' },
              autoSkip: true,
              maxTicksLimit: 7,
              maxRotation: 0
            },
            grid: { display: false }
          }
        }
      }
    });

    // Above the canvas, ensure the card shows a "current balance · debt-free month" subtitle
    try {
      var card = canvas.closest('.card');
      if (card && !card.querySelector('.wjp-elim-subtitle')) {
        var sub = document.createElement('div');
        sub.className = 'wjp-elim-subtitle';
        sub.style.cssText = 'font-size:12px;color:' + inkDim + ';margin-top:-4px;margin-bottom:8px;font-family:inherit;';
        var endLabel = labels[labels.length - 1];
        sub.innerHTML = '<strong style="color:' + ink + ';">' + fmtMoney(data.totalBalance) + '</strong> today → debt-free <strong style="color:' + ink + ';">' + endLabel + '</strong> · ' + data.payoffMonths + ' months · ' + data.strategy + ' strategy';
        // Find the header inside the card and insert after it
        var header = card.querySelector('h2, h3, .card-title');
        if (header && header.parentNode) {
          // Insert just after the header's containing block (usually a flex row)
          var headerBlock = header.parentNode;
          if (headerBlock && headerBlock.parentNode === card) {
            if (headerBlock.nextSibling) card.insertBefore(sub, headerBlock.nextSibling);
            else card.appendChild(sub);
          } else if (header.nextSibling) {
            header.parentNode.insertBefore(sub, header.nextSibling);
          } else {
            card.insertBefore(sub, canvas.parentNode);
          }
        }
      }
    } catch (_) {}
  }

  // ---------- boot ----------
  var lastDebtTotal = null;
  function tick() {
    try { reorderBottomGrid(); } catch (_) {}
    try {
      var data = getDebtsData();
      if (data.totalBalance > 0 && data.totalBalance !== lastDebtTotal) {
        lastDebtTotal = data.totalBalance;
        rebuildChart();
      } else if (data.totalBalance > 0 && !_chartInstance) {
        rebuildChart();
      }
    } catch (_) {}
  }

  function boot() {
    setInterval(tick, 2000);
    // Also rebuild on theme toggle (so colors swap)
    var obs = new MutationObserver(function () {
      if (_chartInstance) {
        lastDebtTotal = null; // force re-render to pick up new theme vars
        setTimeout(rebuildChart, 200);
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_ElimChart = {
    rebuild: rebuildChart,
    reorder: reorderBottomGrid,
    version: 1
  };
})();
