/* wjp-debts-elim-chart.js v2 — real strategy-cascade payoff curve.
 *
 * v1 used a hand-crafted ease-in approximation `1 - t^1.4`. That looked ok
 * but didn't reflect the actual debt cascade (where the curve gets steeper
 * as each debt clears and its minimum payment rolls forward).
 *
 * v2 runs the same month-by-month simulation app.js does in calcSimTotals,
 * producing a TRUE balance schedule with kinks at each debt-clearance point.
 * Adds milestone annotations showing when each debt is paid off.
 *
 * Strategy rollover engine: when debt[i].balance hits 0, its minimumPayment
 * flows into the `cascade` budget for the next-highest-priority debt the
 * following month. Avalanche=APR-first, Snowball=balance-first, Hybrid=
 * weighted-balance (whichever app.js's sortDebtsByStrategy returns).
 *
 * Uses bare appState per the permanent memory rule.
 */
(function () {
  'use strict';
  if (window._wjpDebtsElimChartInstalled) return;
  window._wjpDebtsElimChartInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CHART_ID = 'eliminationChart';
  var STYLE_ID = 'wjp-debts-elim-chart-style';

  function isOnDebts() {
    var p = document.getElementById('page-debts');
    return !!(p && p.classList.contains('active'));
  }

  function fmtMoney(n) {
    if (n == null) return '$0';
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }

  function getStrategy() {
    var s = getAppState();
    return (s && s.settings && s.settings.strategy) || 'avalanche';
  }

  // Sort debts according to strategy. Mirrors app.js's sortDebtsByStrategy.
  function sortDebts(debts, strategy) {
    var d = debts.slice();
    if (strategy === 'avalanche') {
      d.sort(function (a, b) { return (b.apr || 0) - (a.apr || 0); });
    } else if (strategy === 'snowball') {
      d.sort(function (a, b) { return (a.balance || 0) - (b.balance || 0); });
    } else if (strategy === 'hybrid') {
      // Hybrid: rank by balance × APR (interest cost contribution)
      d.sort(function (a, b) {
        var aScore = (a.balance || 0) * (a.apr || 0);
        var bScore = (b.balance || 0) * (b.apr || 0);
        return bScore - aScore;
      });
    }
    return d;
  }

  // Run the month-by-month simulation. Returns:
  //   { months, schedule: [{month, totalBalance, clearedThisMonth: [debtName,...] }, ...],
  //     milestones: [{ month, name, label }] }
  function simulatePayoff(strategy, extraMonthly) {
    var state = getAppState();
    if (!state || !Array.isArray(state.debts) || state.debts.length === 0) {
      return null;
    }
    extraMonthly = Math.max(0, extraMonthly || 0);
    var debts = state.debts.map(function (d) {
      return {
        id: d.id,
        name: d.name || 'Debt',
        balance: Number(d.balance) || 0,
        apr: Number(d.apr) || 0,
        minPayment: Number(d.minPayment) || 0,
        type: (d.type || '').toString().toLowerCase()
      };
    }).filter(function (d) { return d.balance > 0; });
    if (!debts.length) return null;
    debts = sortDebts(debts, strategy);

    var schedule = [];
    var milestones = [];
    var months = 0;

    // Initial point
    var totalBal0 = debts.reduce(function (s, d) { return s + d.balance; }, 0);
    schedule.push({ month: 0, totalBalance: totalBal0, clearedThisMonth: [] });

    while (months < 600) {
      months++;
      var cleared = [];
      // Build cascade from previously-cleared debts' minimums
      var cascade = extraMonthly;
      debts.forEach(function (d) { if (d.balance <= 0) cascade += d.minPayment; });

      var allPaid = true;
      for (var i = 0; i < debts.length; i++) {
        var d = debts[i];
        if (d.balance <= 0) continue;
        allPaid = false;

        var isCard = d.type.indexOf('credit') !== -1 || d.type.indexOf('card') !== -1;
        var pay = d.minPayment + cascade;
        // Apply interest unless we're paying in full this cycle
        if (!(isCard && pay >= d.balance)) {
          var interest = d.balance * (d.apr / 100 / 12);
          d.balance += interest;
        }
        cascade = 0;
        if (d.balance <= pay) {
          cascade += pay - d.balance;
          d.balance = 0;
          cleared.push(d.name);
        } else {
          d.balance -= pay;
        }
      }

      var totalBalance = debts.reduce(function (s, d) { return s + Math.max(0, d.balance); }, 0);
      schedule.push({ month: months, totalBalance: totalBalance, clearedThisMonth: cleared });

      cleared.forEach(function (name) {
        milestones.push({ month: months, name: name, label: 'Cleared ' + name });
      });

      if (allPaid) break;
    }

    return { months: months, schedule: schedule, milestones: milestones };
  }

  // Reduce schedule to a manageable number of data points (~24 max for chart clarity)
  function downsample(schedule, maxPoints) {
    maxPoints = maxPoints || 24;
    if (schedule.length <= maxPoints) return schedule;
    var step = schedule.length / maxPoints;
    var out = [];
    for (var i = 0; i < maxPoints; i++) {
      out.push(schedule[Math.floor(i * step)]);
    }
    // Always include the last point (which has the milestone)
    out.push(schedule[schedule.length - 1]);
    return out;
  }

  function monthLabel(dt) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[dt.getMonth()] + ' \'' + String(dt.getFullYear() % 100).padStart(2, '0');
  }

  function buildLabelsForSchedule(schedule) {
    var today = new Date();
    return schedule.map(function (pt) {
      var d = new Date(today.getFullYear(), today.getMonth() + pt.month, 1);
      return monthLabel(d);
    });
  }

  function strategyLabelFull(strategy) {
    if (strategy === 'avalanche') return 'Avalanche';
    if (strategy === 'snowball') return 'Snowball';
    if (strategy === 'hybrid') return 'Hybrid';
    return 'Avalanche';
  }

  var _chartInstance = null;

  function rebuildChart() {
    if (!isOnDebts()) return;
    var canvas = document.getElementById(CHART_ID);
    if (!canvas) return;
    if (typeof window.Chart === 'undefined') return;

    var strategy = getStrategy();
    var sim = simulatePayoff(strategy, 0);
    if (!sim || !sim.schedule.length) return;

    var downsampled = downsample(sim.schedule, 22);
    var labels = buildLabelsForSchedule(downsampled);
    var data = downsampled.map(function (pt) { return pt.totalBalance; });

    // Identify milestones in the original (full-fidelity) schedule
    var milestonePoints = sim.milestones.map(function (m) {
      // Find nearest downsampled point
      var nearestIdx = 0;
      var minDiff = Infinity;
      downsampled.forEach(function (pt, idx) {
        var diff = Math.abs(pt.month - m.month);
        if (diff < minDiff) { minDiff = diff; nearestIdx = idx; }
      });
      return { x: labels[nearestIdx], y: downsampled[nearestIdx].totalBalance, label: m.name };
    });

    var dark = (document.body.classList.contains('dark'));
    var ink = dark ? '#e8e8e3' : '#0a0a0a';
    var inkDim = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
    var grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    var lineColor = '#1f7a4a';
    var fillTop = 'rgba(31,122,74,0.20)';
    var fillBot = 'rgba(31,122,74,0.02)';

    if (_chartInstance) {
      try { _chartInstance.destroy(); } catch (_) {}
      _chartInstance = null;
    }
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
    gradient.addColorStop(0, fillTop);
    gradient.addColorStop(1, fillBot);

    _chartInstance = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Total balance',
          data: data,
          borderColor: lineColor,
          backgroundColor: gradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.18, // slight smoothing but preserves kinks at milestones
          pointRadius: function (ctx) {
            // Highlight milestone points
            var idx = ctx.dataIndex;
            var pt = downsampled[idx];
            return pt && pt.clearedThisMonth.length > 0 ? 5 : 2;
          },
          pointBackgroundColor: function (ctx) {
            var idx = ctx.dataIndex;
            var pt = downsampled[idx];
            return pt && pt.clearedThisMonth.length > 0 ? '#a855f7' : lineColor;
          },
          pointBorderColor: '#fff',
          pointBorderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeInOutCubic' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var idx = ctx.dataIndex;
                var pt = downsampled[idx];
                var lines = ['Total balance: $' + Math.round(ctx.parsed.y).toLocaleString()];
                if (pt && pt.clearedThisMonth.length) {
                  lines.push('🎉 Cleared: ' + pt.clearedThisMonth.join(', '));
                }
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: inkDim, font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: inkDim,
              font: { size: 10 },
              callback: function (v) { return '$' + (v / 1000).toFixed(0) + 'k'; }
            },
            grid: { color: grid, drawBorder: false }
          }
        }
      }
    });

    // Update subtitle with strategy + months + milestone count
    var sub = document.getElementById('elim-chart-sub');
    if (sub) {
      var startBal = sim.schedule[0].totalBalance;
      var today = new Date();
      var endDate = new Date(today.getFullYear(), today.getMonth() + sim.months, 1);
      var endLabel = monthLabel(endDate);
      sub.innerHTML = '<strong style="color:' + ink + ';">' + fmtMoney(startBal) + '</strong> today → debt-free <strong style="color:' + ink + ';">' + endLabel + '</strong> · ' + sim.months + ' months · ' + strategyLabelFull(strategy) + ' strategy · ' + sim.milestones.length + ' debt' + (sim.milestones.length === 1 ? '' : 's') + ' cleared (rollover cascade)';
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + CHART_ID + '-wrap { position: relative; height: 240px; margin-top: 8px; }' +
      '#elim-chart-sub { font-size: 12px; color: var(--ink-dim, var(--text-2, #6b7280)); margin-top: 6px; line-height: 1.5; }';
    (document.head || document.documentElement).appendChild(s);
  }

  function tick() {
    if (!isOnDebts()) return;
    rebuildChart();
  }

  function boot() {
    injectStyle();
    // Initial render + rebuild on hash changes + every 5s
    setTimeout(tick, 1200);
    setInterval(tick, 5000);
    window.addEventListener('hashchange', tick);
    // Listen to debt updates
    window.addEventListener('wjp-debts-updated', tick);
    // Theme change (light/dark)
    var bodyObs = new MutationObserver(function () { tick(); });
    try { bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DebtsElimChart = {
    rebuild: rebuildChart,
    simulate: simulatePayoff,
    version: 2
  };
})();
