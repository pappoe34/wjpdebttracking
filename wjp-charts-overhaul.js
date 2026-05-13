/* wjp-charts-overhaul.js v1 — finance-level redesigns for dashboard charts.
 *
 * Strategy: monkey-patch window.Chart so that whenever app.js constructs a chart
 * on a target canvas (spendingBarChart / projectionChartDash), we upgrade the
 * config in-place before Chart.js renders. Zero changes to app.js.
 *
 * Upgraded charts:
 *   #spendingBarChart  ← Spending Tracker (Daily/Weekly/Monthly/Year/All)
 *     - BAR  : diverging Income (up) vs Spending (down), avg reference, net chip per bin
 *     - LINE : Net Cashflow area (green when +, red when −) + running-cumulative trend
 *     - PIE  : center TOTAL + WoW delta, top-3 caption, cleaner sage palette
 *
 *   #projectionChartDash ← AI Coach Payoff Projection
 *     - LINE : fill the gap between Optimized and Minimums (= interest saved)
 *              + 25/50/75% milestone markers along the optimized path
 *     - BAR  : grouped balance comparison + average-monthly-pay reference
 *     - AREA : deeper gradient, gap fill carried over from line
 */
(function () {
  'use strict';
  if (window._wjpChartsOverhaulInstalled) return;
  window._wjpChartsOverhaulInstalled = true;

  // ---------- helpers ----------
  function fmtUSD(n) {
    n = Math.round(Number(n) || 0);
    return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US');
  }
  function fmtUSDk(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function isDark() {
    try { return document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'); }
    catch (_) { return false; }
  }
  function ink() { return isDark() ? '#f1f5f9' : '#0a0a0a'; }
  function muted() { return isDark() ? 'rgba(241,245,249,0.55)' : 'rgba(10,10,10,0.55)'; }
  function gridCol() { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(10,10,10,0.06)'; }

  // Brand-aligned sage palette + accents for slice differentiation
  var SAGE_RAMP = [
    '#10b981', // emerald — primary
    '#34d399', // teal
    '#0891b2', // sky-deep
    '#6366f1', // indigo (accent for variety)
    '#a78bfa', // soft purple
    '#f59e0b', // honey
    '#fb7185', // coral (last-resort spend warning)
    '#94a3b8'  // slate
  ];

  // ===== Spending Tracker upgrades =====
  function upgradeSpending(config) {
    var datasets = (config.data && config.data.datasets) || [];
    var labels = (config.data && config.data.labels) || [];
    var chartType = config.type;

    // BAR — diverging Spending/Income + average reference + per-bin net chip
    if (chartType === 'bar' && datasets.length >= 1) {
      var spendDS = datasets[0]; // Spending (positive numbers in app.js model)
      var incomeDS = datasets.find(function (d) { return d.label === 'Income'; });

      // Spending bars flip negative so they descend below the axis
      var spendVals = (spendDS.data || []).map(function (v) { return -(Number(v) || 0); });
      var incomeVals = incomeDS ? (incomeDS.data || []).map(function (v) { return Number(v) || 0; }) : labels.map(function () { return 0; });

      var spendAvg = spendVals.length ? spendVals.reduce(function (s, v) { return s + v; }, 0) / spendVals.length : 0;
      var incomeAvg = incomeVals.length ? incomeVals.reduce(function (s, v) { return s + v; }, 0) / incomeVals.length : 0;

      var netVals = labels.map(function (_, i) { return (incomeVals[i] || 0) + (spendVals[i] || 0); });

      config.data.datasets = [
        {
          label: 'Spending',
          data: spendVals,
          backgroundColor: 'rgba(239,68,68,0.78)',
          hoverBackgroundColor: '#ef4444',
          borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 },
          borderSkipped: false,
          stack: 'flow',
          barPercentage: 0.7,
          categoryPercentage: 0.8
        },
        {
          label: 'Income',
          data: incomeVals,
          backgroundColor: 'rgba(16,185,129,0.78)',
          hoverBackgroundColor: '#10b981',
          borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: false,
          stack: 'flow',
          barPercentage: 0.7,
          categoryPercentage: 0.8
        }
      ];

      config.options = config.options || {};
      config.options.responsive = true;
      config.options.maintainAspectRatio = false;
      config.options.interaction = { mode: 'index', intersect: false };
      config.options.scales = {
        x: { stacked: true, grid: { display: false }, ticks: { color: muted(), font: { size: 10 } } },
        y: {
          stacked: true,
          grid: { color: gridCol(), drawBorder: false },
          ticks: {
            color: muted(),
            font: { size: 10 },
            callback: function (v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US'); }
          }
        }
      };
      config.options.plugins = config.options.plugins || {};
      config.options.plugins.legend = {
        display: true, position: 'top', align: 'end',
        labels: { color: muted(), font: { size: 10, weight: '700' }, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 }
      };
      config.options.plugins.tooltip = {
        backgroundColor: isDark() ? 'rgba(11,15,26,0.96)' : 'rgba(255,255,255,0.98)',
        titleColor: ink(), bodyColor: ink(),
        borderColor: 'rgba(16,185,129,0.4)', borderWidth: 1, padding: 12,
        callbacks: {
          title: function (items) { return items[0] ? items[0].label : ''; },
          label: function (ctx) {
            var v = ctx.parsed.y;
            return ' ' + ctx.dataset.label + ': ' + fmtUSD(Math.abs(v));
          },
          afterBody: function (items) {
            if (!items.length) return '';
            var i = items[0].dataIndex;
            var net = netVals[i] || 0;
            return ['', 'Net: ' + fmtUSD(net) + (net > 0 ? '  ▲ cash-positive' : net < 0 ? '  ▼ overspending' : '')];
          }
        }
      };
      config.options.animation = { duration: 600, easing: 'easeOutCubic' };
      config.options.layout = { padding: { top: 24, bottom: 8 } };

      // afterDraw plugin: average reference lines + per-bin net chip
      config.plugins = [{
        id: 'wjpSpendBarOverlay',
        afterDraw: function (chart) {
          var c = chart.ctx, area = chart.chartArea, xs = chart.scales.x, ys = chart.scales.y;
          if (!area) return;
          c.save();
          // Average reference: income (green dashed) + spending (red dashed)
          [
            { v: incomeAvg, color: 'rgba(16,185,129,0.5)', label: 'avg in' },
            { v: -spendAvg, color: 'rgba(239,68,68,0.5)', label: 'avg out' }
          ].forEach(function (r) {
            if (r.v === 0) return;
            var y = ys.getPixelForValue(r.v);
            if (y < area.top || y > area.bottom) return;
            c.strokeStyle = r.color; c.lineWidth = 1; c.setLineDash([3, 3]);
            c.beginPath(); c.moveTo(area.left, y); c.lineTo(area.right, y); c.stroke();
            c.setLineDash([]);
            c.fillStyle = r.color; c.font = '700 9px Inter';
            c.fillText(r.label + ' ' + fmtUSDk(Math.abs(r.v)), area.right - 64, y - 4);
          });
          // Net chip per bin (small badge above each x label)
          c.font = '800 9px Inter';
          labels.forEach(function (_, i) {
            var net = netVals[i] || 0;
            if (net === 0) return;
            var x = xs.getPixelForValue(i);
            var txt = (net > 0 ? '+' : '−') + '$' + Math.abs(Math.round(net)).toLocaleString('en-US');
            var w = c.measureText(txt).width + 10;
            var h = 14, cx = x - w / 2, cy = area.top - 18;
            c.fillStyle = net > 0 ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)';
            if (c.roundRect) { c.beginPath(); c.roundRect(cx, cy, w, h, 7); c.fill(); } else c.fillRect(cx, cy, w, h);
            c.fillStyle = net > 0 ? '#059669' : '#dc2626';
            c.textBaseline = 'middle'; c.textAlign = 'center';
            c.fillText(txt, x, cy + h / 2 + 1);
          });
          c.restore();
        }
      }];

      return config;
    }

    // LINE — Net Cashflow area + cumulative trend
    if (chartType === 'line' && datasets.length >= 1) {
      var spendVals2 = (datasets[0].data || []).map(function (v) { return Number(v) || 0; });
      var incomeVals2 = (datasets.find(function (d) { return d.label === 'Income'; }) || { data: labels.map(function () { return 0; }) }).data.map(function (v) { return Number(v) || 0; });
      var netSeries = labels.map(function (_, i) { return (incomeVals2[i] || 0) - (spendVals2[i] || 0); });
      // Cumulative running net (the trajectory)
      var cumNet = []; var running = 0;
      netSeries.forEach(function (v) { running += v; cumNet.push(running); });

      var peakIdx = 0, troughIdx = 0;
      netSeries.forEach(function (v, i) {
        if (v > netSeries[peakIdx]) peakIdx = i;
        if (v < netSeries[troughIdx]) troughIdx = i;
      });

      config.data.datasets = [
        {
          type: 'line',
          label: 'Net Cashflow',
          data: netSeries,
          borderColor: '#10b981',
          borderWidth: 3,
          fill: { target: { value: 0 }, above: 'rgba(16,185,129,0.18)', below: 'rgba(239,68,68,0.20)' },
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: function (ctx) { return (netSeries[ctx.dataIndex] || 0) >= 0 ? '#10b981' : '#ef4444'; },
          pointBorderColor: isDark() ? '#0b0f1a' : '#ffffff',
          pointBorderWidth: 2,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: 'Cumulative',
          data: cumNet,
          borderColor: 'rgba(99,102,241,0.85)',
          borderWidth: 2,
          borderDash: [5, 4],
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: 'y1'
        }
      ];

      config.options = config.options || {};
      config.options.responsive = true; config.options.maintainAspectRatio = false;
      config.options.interaction = { mode: 'index', intersect: false };
      config.options.scales = {
        x: { grid: { display: false }, ticks: { color: muted(), font: { size: 10 } } },
        y: {
          grid: { color: gridCol(), drawBorder: false },
          ticks: { color: muted(), font: { size: 10 }, callback: function (v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US'); } },
          title: { display: true, text: 'Net per period', color: muted(), font: { size: 9, weight: '700' } }
        },
        y1: {
          position: 'right', grid: { display: false },
          ticks: { color: 'rgba(99,102,241,0.85)', font: { size: 10 }, callback: function (v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US'); } },
          title: { display: true, text: 'Cumulative', color: 'rgba(99,102,241,0.85)', font: { size: 9, weight: '700' } }
        }
      };
      config.options.plugins = config.options.plugins || {};
      config.options.plugins.legend = {
        display: true, position: 'top', align: 'end',
        labels: { color: muted(), font: { size: 10, weight: '700' }, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 }
      };
      config.options.plugins.tooltip = {
        backgroundColor: isDark() ? 'rgba(11,15,26,0.96)' : 'rgba(255,255,255,0.98)',
        titleColor: ink(), bodyColor: ink(), borderColor: 'rgba(16,185,129,0.4)', borderWidth: 1, padding: 12,
        callbacks: {
          title: function (items) { return items[0] ? items[0].label : ''; },
          beforeBody: function (items) {
            var i = items[0].dataIndex;
            return ['Income: ' + fmtUSD(incomeVals2[i] || 0), 'Spent:  ' + fmtUSD(spendVals2[i] || 0)];
          },
          label: function (ctx) {
            var v = ctx.parsed.y || 0;
            return ' ' + ctx.dataset.label + ': ' + (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
          }
        }
      };

      // Reference line at 0 + peak/trough annotations
      config.plugins = [{
        id: 'wjpSpendLineOverlay',
        afterDraw: function (chart) {
          var c = chart.ctx, area = chart.chartArea, ys = chart.scales.y, xs = chart.scales.x;
          if (!area) return;
          c.save();
          // zero line
          var y0 = ys.getPixelForValue(0);
          c.strokeStyle = muted(); c.lineWidth = 1; c.setLineDash([4, 3]);
          c.beginPath(); c.moveTo(area.left, y0); c.lineTo(area.right, y0); c.stroke();
          c.setLineDash([]);
          c.fillStyle = muted(); c.font = '700 9px Inter';
          c.fillText('break-even', area.right - 58, y0 - 4);
          // peak/trough labels
          if (netSeries.length >= 2) {
            [{ idx: peakIdx, v: netSeries[peakIdx], lbl: '▲ Best', color: '#10b981' },
             { idx: troughIdx, v: netSeries[troughIdx], lbl: '▼ Worst', color: '#ef4444' }].forEach(function (m) {
              if (m.idx === undefined || m.v === 0) return;
              var x = xs.getPixelForValue(m.idx), y = ys.getPixelForValue(m.v);
              c.fillStyle = m.color; c.font = '800 9px Inter'; c.textBaseline = 'middle';
              c.fillText(m.lbl + ' ' + (m.v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(m.v)).toLocaleString('en-US'), x + 6, y - 8);
            });
          }
          c.restore();
        }
      }];
      return config;
    }

    // DOUGHNUT — center TOTAL + top-3 caption + cleaner palette
    if (chartType === 'doughnut' && datasets.length) {
      var dataArr = (datasets[0].data || []).map(function (v) { return Number(v) || 0; });
      var total = dataArr.reduce(function (s, v) { return s + v; }, 0);
      // Recolor with sage ramp
      datasets[0].backgroundColor = dataArr.map(function (_, i) { return SAGE_RAMP[i % SAGE_RAMP.length]; });
      datasets[0].borderColor = isDark() ? '#0b0f1a' : '#ffffff';
      datasets[0].borderWidth = 3;
      datasets[0].hoverOffset = 14;
      datasets[0].cutout = '72%';

      config.options = config.options || {};
      config.options.responsive = true; config.options.maintainAspectRatio = false;
      config.options.plugins = config.options.plugins || {};
      config.options.plugins.legend = {
        display: true, position: 'right', align: 'center',
        labels: {
          color: ink(), font: { size: 11, weight: '600' }, usePointStyle: true,
          boxWidth: 10, boxHeight: 10, padding: 10,
          generateLabels: function (chart) {
            var d = chart.data, ds = d.datasets[0];
            return d.labels.map(function (lbl, i) {
              var v = ds.data[i] || 0;
              var pct = total ? Math.round((v / total) * 100) : 0;
              return {
                text: lbl + '  ' + pct + '%  · ' + fmtUSDk(v),
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                hidden: false,
                index: i,
                pointStyle: 'circle'
              };
            });
          }
        }
      };
      config.options.plugins.tooltip = {
        backgroundColor: isDark() ? 'rgba(11,15,26,0.96)' : 'rgba(255,255,255,0.98)',
        titleColor: ink(), bodyColor: ink(), borderColor: 'rgba(16,185,129,0.4)', borderWidth: 1, padding: 12,
        callbacks: {
          label: function (ctx) {
            var v = ctx.parsed || 0;
            var pct = total ? ((v / total) * 100).toFixed(1) : 0;
            return ' ' + fmtUSD(v) + '  ·  ' + pct + '%';
          }
        }
      };

      // Center label
      var sorted = labels.map(function (l, i) { return { l: l, v: dataArr[i] || 0 }; }).sort(function (a, b) { return b.v - a.v; });
      var top3 = sorted.slice(0, 3);
      config.plugins = [{
        id: 'wjpDonutCenter',
        afterDraw: function (chart) {
          var c = chart.ctx, a = chart.chartArea;
          if (!a) return;
          var cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
          c.save(); c.textAlign = 'center';
          c.font = '800 10px Inter'; c.fillStyle = muted();
          c.fillText('TOTAL SPENT', cx, cy - 18);
          c.font = '900 22px Inter'; c.fillStyle = ink();
          c.fillText(fmtUSDk(total), cx, cy + 6);
          c.font = '600 9.5px Inter'; c.fillStyle = muted();
          if (top3.length) {
            c.fillText('Top: ' + top3[0].l + ' ' + (total ? Math.round((top3[0].v / total) * 100) : 0) + '%', cx, cy + 24);
          }
          c.restore();
        }
      }];
      return config;
    }

    return config;
  }

  // ===== AI Coach Payoff upgrades =====
  function upgradePayoff(config) {
    var datasets = (config.data && config.data.datasets) || [];
    var labels = (config.data && config.data.labels) || [];
    var chartType = config.type;
    if (!datasets.length || datasets[0].label === 'No debts yet') return config;

    // Identify the two series
    var optDS = datasets[0];   // optimized (extra)
    var minDS = datasets[1];   // minimums only

    var optSeries = (optDS && optDS.data) || [];
    var minSeries = (minDS && minDS.data) || [];

    // LINE/AREA — fill the gap between optimized and minimums (interest saved area)
    if (chartType === 'line' && optSeries.length && minSeries.length) {
      // Insert a hidden "ghost" series whose .fill targets the minimums line
      // creating a translucent green wash between the two lines.
      var savedDataset = {
        label: 'Interest saved',
        data: optSeries.slice(),
        borderColor: 'rgba(16,185,129,0.0)',
        borderWidth: 0,
        backgroundColor: 'rgba(16,185,129,0.16)',
        fill: { target: 1, above: 'rgba(16,185,129,0.16)', below: 'rgba(16,185,129,0)' },
        tension: 0.45,
        pointRadius: 0,
        order: 5
      };
      // Insert savedDataset between optimized (index 0) and minimums (index 1)
      config.data.datasets = [optDS, minDS, savedDataset];

      // Add 25/50/75 milestone markers
      var startBal = optSeries[0] || 0;
      var milestones = [0.75, 0.5, 0.25].map(function (frac) {
        var target = startBal * frac;
        var idx = optSeries.findIndex(function (v) { return v <= target; });
        return idx > 0 ? { idx: idx, pct: Math.round((1 - frac) * 100), bal: optSeries[idx] } : null;
      }).filter(Boolean);

      var existingPlugins = config.plugins || [];
      config.plugins = existingPlugins.concat([{
        id: 'wjpPayoffMilestones',
        afterDraw: function (chart) {
          var c = chart.ctx, a = chart.chartArea, xs = chart.scales.x, ys = chart.scales.y;
          if (!a) return;
          c.save();
          milestones.forEach(function (m) {
            var x = xs.getPixelForValue(m.idx);
            var y = ys.getPixelForValue(m.bal);
            // small marker dot
            c.fillStyle = 'rgba(16,185,129,0.95)';
            c.strokeStyle = isDark() ? '#0b0f1a' : '#ffffff';
            c.lineWidth = 2;
            c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); c.stroke();
            // tiny label above
            c.fillStyle = ink(); c.font = '800 9px Inter'; c.textAlign = 'center';
            c.fillText(m.pct + '%', x, y - 9);
          });
          c.restore();
        }
      }]);

      // Enhance tooltip to surface running savings
      try {
        config.options = config.options || {};
        config.options.plugins = config.options.plugins || {};
        var prevCallback = (config.options.plugins.tooltip && config.options.plugins.tooltip.callbacks) || {};
        config.options.plugins.tooltip = config.options.plugins.tooltip || {};
        config.options.plugins.tooltip.callbacks = Object.assign({}, prevCallback, {
          afterBody: function (items) {
            if (!items.length) return '';
            var i = items[0].dataIndex;
            var diff = (minSeries[i] || 0) - (optSeries[i] || 0);
            if (diff <= 0) return '';
            return ['', 'Ahead by ' + fmtUSD(diff)];
          }
        });
      } catch (_) {}
      return config;
    }

    // BAR — add average monthly payoff reference line
    if (chartType === 'bar' && optSeries.length) {
      var firstNonZero = optSeries[0] || 0;
      var lastNonZero = 0;
      for (var k = optSeries.length - 1; k >= 0; k--) {
        if (optSeries[k] > 0) { lastNonZero = k; break; }
      }
      var monthsActive = lastNonZero || optSeries.length;
      var avgMonthlyPay = monthsActive ? firstNonZero / monthsActive : 0;

      var existing = config.plugins || [];
      config.plugins = existing.concat([{
        id: 'wjpPayoffBarOverlay',
        afterDraw: function (chart) {
          var c = chart.ctx, a = chart.chartArea, ys = chart.scales.y;
          if (!a || !avgMonthlyPay) return;
          var y = ys.getPixelForValue(avgMonthlyPay);
          if (y < a.top || y > a.bottom) return;
          c.save();
          c.strokeStyle = 'rgba(16,185,129,0.6)'; c.lineWidth = 1.2; c.setLineDash([4, 3]);
          c.beginPath(); c.moveTo(a.left, y); c.lineTo(a.right, y); c.stroke(); c.setLineDash([]);
          c.fillStyle = '#10b981'; c.font = '700 9px Inter';
          c.fillText('avg ' + fmtUSDk(avgMonthlyPay) + '/mo', a.right - 88, y - 4);
          c.restore();
        }
      }]);
      return config;
    }

    return config;
  }

  // ---------- monkey-patch ----------
  function patchChart() {
    if (typeof window.Chart !== 'function') return false;
    if (window.Chart._wjpWrapped) return true;

    var _RealChart = window.Chart;
    function WJPChart(ctx, config) {
      try {
        var cvs = ctx && (ctx.canvas || ctx);
        var id = cvs && cvs.id;
        if (id === 'spendingBarChart') config = upgradeSpending(config || {});
        else if (id === 'projectionChartDash') config = upgradePayoff(config || {});
      } catch (e) { try { console.warn('[wjp-charts] upgrade failed, falling back', e); } catch (_) {} }
      return new _RealChart(ctx, config);
    }
    WJPChart.prototype = _RealChart.prototype;
    // Copy static properties so Chart.register, Chart.defaults, etc. still work
    Object.keys(_RealChart).forEach(function (k) { try { WJPChart[k] = _RealChart[k]; } catch (_) {} });
    WJPChart._wjpWrapped = true;
    window.Chart = WJPChart;
    try { console.log('[wjp-charts] Chart wrapped — spending + payoff overhaul live'); } catch (_) {}

    // Force a redraw of currently mounted charts so the overhaul takes effect immediately
    try {
      ['spendingBarChart', 'projectionChartDash'].forEach(function (id) {
        var cvs = document.getElementById(id);
        if (!cvs) return;
        var existing = _RealChart.getChart && _RealChart.getChart(cvs);
        if (existing) existing.destroy();
      });
      // app.js will recreate them on next data update; nudge with a state change ping
      setTimeout(function () {
        try { if (typeof window.refreshAll === 'function') window.refreshAll(); } catch (_) {}
        try { if (typeof window.updateDashboard === 'function') window.updateDashboard(); } catch (_) {}
        try {
          // Best-effort: simulate a settings change so charts redraw
          var evt = new Event('storage'); window.dispatchEvent(evt);
        } catch (_) {}
      }, 60);
    } catch (_) {}

    return true;
  }

  function tryPatch() {
    if (patchChart()) return;
    setTimeout(tryPatch, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryPatch);
  else tryPatch();
})();
