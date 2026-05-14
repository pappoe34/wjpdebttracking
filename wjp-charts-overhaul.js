/* wjp-charts-overhaul.js v7 — switch donut legend to crisp HTML (canvas antialiasing fix).
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
  // Theme detection — host uses data-theme="dark" on <html>, NOT a class.
  // Some sub-pages also set body.classList.add('dark') so we check both for safety.
  function isDark() {
    try {
      var html = document.documentElement;
      var attr = html.getAttribute('data-theme');
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      if (html.classList.contains('dark') || document.body.classList.contains('dark')) return true;
      // Fall back to OS preference
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) { return false; }
  }
  // Pull live CSS vars whenever possible so charts inherit the host's exact theme.
  // Fallback colors used only if the var is empty.
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) { return fallback; }
  }
  function ink()    { return cssVar('--ink', cssVar('--text-1', isDark() ? '#f1f5f9' : '#0a0a0a')); }
  function muted()  { return cssVar('--text-3', isDark() ? 'rgba(241,245,249,0.55)' : 'rgba(10,10,10,0.55)'); }
  function gridCol(){ return cssVar('--border', isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(10,10,10,0.08)'); }
  function surface(){ return cssVar('--card-2', isDark() ? '#0b0f1a' : '#ffffff'); }

  // Alternating-hue ramp so adjacent slices visually contrast even when one slice
  // dominates. Primary is brand emerald, then it rotates indigo → amber → teal →
  // purple → coral → sky → slate. No two greens neighbor each other.
  var SAGE_RAMP = [
    '#10b981', // emerald — primary brand
    '#6366f1', // indigo
    '#f59e0b', // amber
    '#0891b2', // deep teal
    '#a78bfa', // soft purple
    '#fb7185', // coral
    '#34d399', // light teal
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
            c.fillStyle = r.color; c.font = '600 9.5px Inter';
            c.fillText(r.label + ' ' + fmtUSDk(Math.abs(r.v)), area.right - 64, y - 4);
          });
          // Net chip per bin (small badge above each x label)
          c.font = '700 9.5px Inter';
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
          c.fillStyle = muted(); c.font = '600 9.5px Inter';
          c.fillText('break-even', area.right - 58, y0 - 4);
          // peak/trough labels
          if (netSeries.length >= 2) {
            [{ idx: peakIdx, v: netSeries[peakIdx], lbl: '▲ Best', color: '#10b981' },
             { idx: troughIdx, v: netSeries[troughIdx], lbl: '▼ Worst', color: '#ef4444' }].forEach(function (m) {
              if (m.idx === undefined || m.v === 0) return;
              var x = xs.getPixelForValue(m.idx), y = ys.getPixelForValue(m.v);
              c.fillStyle = m.color; c.font = '700 9.5px Inter'; c.textBaseline = 'middle';
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
      datasets[0].borderColor = surface();
      datasets[0].borderWidth = 2;
      datasets[0].hoverOffset = 12;
      datasets[0].cutout = '70%';

      config.options = config.options || {};
      config.options.responsive = true; config.options.maintainAspectRatio = false;
      config.options.plugins = config.options.plugins || {};
      // v7: native canvas legend antialiasing rendered digits ("74%", "10%") thin/dim
      // in dark mode. Switch to a true HTML legend rendered alongside the canvas — full
      // CSS control means crisp text at any weight/size with no antialiasing artifacts.
      config.options.plugins.legend = { display: false };
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
          c.font = '700 10px Inter';
          c.fillStyle = muted();
          c.fillText('TOTAL SPENT', cx, cy - 16);
          c.font = '700 22px Inter';
          c.fillStyle = ink();
          c.fillText(fmtUSDk(total), cx, cy + 6);
          c.font = '600 10px Inter';
          c.fillStyle = muted();
          if (top3.length) {
            c.fillText('Top: ' + top3[0].l + ' ' + (total ? Math.round((top3[0].v / total) * 100) : 0) + '%', cx, cy + 24);
          }
          c.restore();
        }
      }, {
        id: 'wjpDonutHtmlLegend',
        afterRender: function (chart) {
          // Render an HTML legend in a sibling div next to the canvas — crisp text.
          try {
            var canvas = chart.canvas;
            if (!canvas) return;
            var wrap = canvas.closest('.chart-wrap, .spending-chart-wrap') || canvas.parentElement;
            if (!wrap) return;
            var legendId = 'wjp-donut-html-legend';
            var legend = wrap.querySelector('#' + legendId);
            if (!legend) {
              legend = document.createElement('div');
              legend.id = legendId;
              legend.style.cssText = [
                'position:absolute',
                'top:50%','right:14px','transform:translateY(-50%)',
                'display:flex','flex-direction:column','gap:8px',
                'pointer-events:none',
                'max-width:42%',
                'font-family:Inter, system-ui, sans-serif'
              ].join(';');
              // Make wrap relative so the absolute legend anchors correctly
              if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
              wrap.appendChild(legend);
            }
            // Build legend rows from chart data
            var data = chart.data, ds = data.datasets[0];
            var rows = data.labels.map(function (lbl, i) {
              var v = ds.data[i] || 0;
              var pct = total ? Math.round((v / total) * 100) : 0;
              var bg = ds.backgroundColor[i];
              return ''
                + '<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--ink, var(--text-1, #0a0a0a));line-height:1.25;">'
                +   '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:' + bg + ';flex-shrink:0;"></span>'
                +   '<span style="display:inline-flex;align-items:baseline;gap:8px;">'
                +     '<span style="color:var(--ink, var(--text-1, #0a0a0a));">' + lbl + '</span>'
                +     '<span style="color:var(--text-3, #94a3b8);font-weight:600;font-size:12px;">' + pct + '%</span>'
                +     '<span style="color:var(--ink, var(--text-1, #0a0a0a));font-weight:700;font-size:12.5px;">$' + Math.round(v).toLocaleString('en-US') + '</span>'
                +   '</span>'
                + '</div>';
            }).join('');
            legend.innerHTML = rows;
          } catch (e) { try { console.warn('[wjp-charts] html legend failed', e); } catch (_) {} }
        }
      }];
      return config;
    }

    return config;
  }

  // ===== AI Coach Payoff upgrades =====
  // Three distinct visual stories per toggle:
  //   LINE  → dual trajectory (Optimized solid + Minimums dashed, no fills) + milestones
  //   AREA  → savings visualization: fill the gap between optimized & minimums (interest saved)
  //   BAR   → monthly balance step-down with minimums-only ghost line overlay + avg ref
  function upgradePayoff(config) {
    var datasets = (config.data && config.data.datasets) || [];
    var labels = (config.data && config.data.labels) || [];
    var chartType = config.type;
    if (!datasets.length || datasets[0].label === 'No debts yet') return config;

    // Read the active style (line/area/bar) from appState — host's chartType folds
    // line+area into the same Chart.js 'line' type, so we must disambiguate here.
    // v5: host keeps appState local to its IIFE, so read the active button instead.
    // The button DOM is the source of truth for which view the user has selected.
    var activeStyle = 'line';
    try {
      var activeBtn = document.querySelector('#ai-chart-switcher .style-btn.active');
      if (activeBtn && activeBtn.dataset && activeBtn.dataset.style) activeStyle = activeBtn.dataset.style;
    } catch (_) {}

    // Identify the two series
    var optDS = datasets[0];   // optimized (extra)
    var minDS = datasets[1];   // minimums only

    var optSeries = (optDS && optDS.data) || [];
    var minSeries = (minDS && minDS.data) || [];

    // Shared: milestones along the optimized trajectory
    var startBal = optSeries[0] || 0;
    var milestones = startBal ? [0.75, 0.5, 0.25].map(function (frac) {
      var target = startBal * frac;
      var idx = optSeries.findIndex(function (v) { return v <= target; });
      return idx > 0 ? { idx: idx, pct: Math.round((1 - frac) * 100), bal: optSeries[idx] } : null;
    }).filter(Boolean) : [];

    // Shared tooltip enhancement — "Ahead by $X" callout
    function applyAheadTooltip() {
      try {
        config.options = config.options || {};
        config.options.plugins = config.options.plugins || {};
        var prev = (config.options.plugins.tooltip && config.options.plugins.tooltip.callbacks) || {};
        config.options.plugins.tooltip = config.options.plugins.tooltip || {};
        config.options.plugins.tooltip.callbacks = Object.assign({}, prev, {
          afterBody: function (items) {
            if (!items.length) return '';
            var i = items[0].dataIndex;
            var diff = (minSeries[i] || 0) - (optSeries[i] || 0);
            if (diff <= 0) return '';
            return ['', 'Ahead by ' + fmtUSD(diff)];
          }
        });
      } catch (_) {}
    }

    // -------- LINE — dual trajectory, NO fills, clean geometric comparison --------
    if (chartType === 'line' && activeStyle === 'line' && optSeries.length) {
      // Strip fills from both — line view is about the path, not the area.
      if (optDS) {
        optDS.fill = false;
        optDS.backgroundColor = 'transparent';
        optDS.tension = 0.4;
        // Bring back subtle points along the optimized line every ~20% of the journey
        var totalLen = optSeries.length;
        optDS.pointRadius = optSeries.map(function (_, i) {
          if (i === 0) return 6; // today marker stays bold
          if (totalLen <= 6) return 3;
          return (i % Math.max(1, Math.floor(totalLen / 6)) === 0) ? 2.5 : 0;
        });
      }
      if (minDS) {
        minDS.fill = false;
        minDS.backgroundColor = 'transparent';
        minDS.borderDash = [6, 5];
        minDS.borderColor = muted();
        minDS.tension = 0.4;
      }

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
            c.fillStyle = 'rgba(16,185,129,0.95)';
            c.strokeStyle = surface();
            c.lineWidth = 2;
            c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
            c.fillStyle = ink(); c.font = '700 9.5px Inter'; c.textAlign = 'center';
            c.fillText(m.pct + '%', x, y - 10);
          });
          c.restore();
        }
      }]);
      applyAheadTooltip();
      return config;
    }

    // -------- AREA — savings visualization: fill the gap (interest saved wash) --------
    if (chartType === 'line' && activeStyle === 'area' && optSeries.length) {
      // Optimized: solid line with subtle gradient fill from line down to zero
      if (optDS) {
        optDS.fill = 'origin';
        optDS.backgroundColor = function (ctx) {
          try {
            var ch = ctx.chart, a = ch.chartArea;
            if (!a) return 'rgba(16,185,129,0.10)';
            var g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
            g.addColorStop(0, 'rgba(16,185,129,0.32)');
            g.addColorStop(1, 'rgba(16,185,129,0.02)');
            return g;
          } catch (_) { return 'rgba(16,185,129,0.10)'; }
        };
        optDS.tension = 0.45;
      }
      if (minDS) {
        minDS.borderDash = [4, 4];
        minDS.borderColor = 'rgba(239,68,68,0.55)';
        minDS.fill = false;
        minDS.backgroundColor = 'transparent';
      }
      // The "interest saved" wash — a ghost dataset filling from optimized UP to minimums
      var savedDataset = {
        label: 'Interest saved',
        data: minSeries.slice(),
        borderColor: 'rgba(0,0,0,0)',
        borderWidth: 0,
        backgroundColor: 'rgba(239,68,68,0.15)',
        fill: '-1', // fill toward previous dataset
        tension: 0.45,
        pointRadius: 0,
        order: 10
      };
      // Order: optimized(0) → minimums(1) → savedWash(2 fills -1 to minimums)
      // Actually we want fill BETWEEN optimized and minimums. Easier: replace minDS slot
      // with a saved-wash dataset and keep minimums as a separate borderless reference.
      config.data.datasets = [optDS, {
        label: 'Minimums (reference)',
        data: minSeries,
        borderColor: 'rgba(239,68,68,0.55)',
        borderDash: [4, 4],
        borderWidth: 2,
        backgroundColor: 'rgba(239,68,68,0.12)',
        fill: { target: '-1', above: 'rgba(239,68,68,0.14)', below: 'rgba(0,0,0,0)' },
        tension: 0.45,
        pointRadius: 0
      }];

      var existingPlugins2 = config.plugins || [];
      config.plugins = existingPlugins2.concat([{
        id: 'wjpPayoffAreaLabel',
        afterDraw: function (chart) {
          var c = chart.ctx, a = chart.chartArea;
          if (!a) return;
          c.save();
          // "Interest saved" badge in the middle of the gap
          var midIdx = Math.floor(optSeries.length * 0.45);
          var xs = chart.scales.x, ys = chart.scales.y;
          if (xs && ys && optSeries[midIdx] != null && minSeries[midIdx] != null) {
            var mx = xs.getPixelForValue(midIdx);
            var my = ys.getPixelForValue((optSeries[midIdx] + minSeries[midIdx]) / 2);
            var totalSaved = (minSeries[minSeries.length-1] || 0) ? 0 : 0;
            // Use cumulative gap at end-of-window as proxy
            var endGap = (minSeries[minSeries.length-1] || 0) - (optSeries[optSeries.length-1] || 0);
            // Friendlier: max gap reached
            var maxGap = 0;
            optSeries.forEach(function (_, i) {
              var d = (minSeries[i] || 0) - (optSeries[i] || 0);
              if (d > maxGap) maxGap = d;
            });
            var txt = 'Saving up to ' + fmtUSDk(maxGap);
            c.font = '700 10px Inter';
            var w = c.measureText(txt).width + 14, h = 18;
            var cx = mx - w / 2, cy = my - h / 2;
            c.fillStyle = 'rgba(239,68,68,0.92)';
            if (c.roundRect) { c.beginPath(); c.roundRect(cx, cy, w, h, 9); c.fill(); } else c.fillRect(cx, cy, w, h);
            c.fillStyle = '#ffffff'; c.textBaseline = 'middle'; c.textAlign = 'center';
            c.fillText(txt, mx, my + 0.5);
          }
          c.restore();
        }
      }]);
      applyAheadTooltip();
      return config;
    }

    // -------- BAR — monthly balance step-down with minimums ghost LINE overlay --------
    if (chartType === 'bar' && optSeries.length) {
      // Restyle the optimized bars: emerald with gradient
      if (optDS) {
        optDS.backgroundColor = function (ctx) {
          try {
            var ch = ctx.chart, a = ch.chartArea;
            if (!a) return 'rgba(16,185,129,0.85)';
            var g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
            g.addColorStop(0, 'rgba(16,185,129,0.95)');
            g.addColorStop(1, 'rgba(16,185,129,0.55)');
            return g;
          } catch (_) { return 'rgba(16,185,129,0.85)'; }
        };
        optDS.borderRadius = 4;
        optDS.borderSkipped = false;
        optDS.barPercentage = 0.7;
        optDS.categoryPercentage = 0.85;
      }
      // Drop the minimums BAR — convert it to a LINE overlay on the bar chart
      if (minDS) {
        minDS.type = 'line';
        minDS.borderColor = 'rgba(239,68,68,0.85)';
        minDS.backgroundColor = 'rgba(239,68,68,0.10)';
        minDS.borderDash = [4, 4];
        minDS.borderWidth = 2.5;
        minDS.fill = false;
        minDS.pointRadius = 0;
        minDS.tension = 0.4;
        minDS.order = 0; // draw on top
      }

      var firstNonZero = optSeries[0] || 0;
      var lastNonZero = 0;
      for (var k = optSeries.length - 1; k >= 0; k--) {
        if (optSeries[k] > 0) { lastNonZero = k; break; }
      }
      var monthsActive = lastNonZero || optSeries.length;
      var avgMonthlyPay = monthsActive ? firstNonZero / monthsActive : 0;

      var existingBar = config.plugins || [];
      config.plugins = existingBar.concat([{
        id: 'wjpPayoffBarOverlay',
        afterDraw: function (chart) {
          var c = chart.ctx, a = chart.chartArea, ys = chart.scales.y;
          if (!a) return;
          c.save();
          // Average monthly payoff reference line
          if (avgMonthlyPay) {
            var y = ys.getPixelForValue(avgMonthlyPay);
            if (y >= a.top && y <= a.bottom) {
              c.strokeStyle = muted(); c.lineWidth = 1; c.setLineDash([3, 3]);
              c.beginPath(); c.moveTo(a.left, y); c.lineTo(a.right, y); c.stroke();
              c.setLineDash([]);
              c.fillStyle = muted(); c.font = '600 9.5px Inter';
              c.fillText('avg balance ' + fmtUSDk(avgMonthlyPay), a.right - 110, y - 4);
            }
          }
          c.restore();
        }
      }]);
      applyAheadTooltip();
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

    // Force a redraw of currently mounted charts so the overhaul takes effect immediately.
    // The right global hook is window.drawCharts() — app.js exposes it and it routes through
    // drawSpendingChart + drawDashProjection, both of which go through our wrapped Chart now.
    function nudgeRedraw() {
      try {
        ['spendingBarChart', 'projectionChartDash'].forEach(function (id) {
          var cvs = document.getElementById(id);
          if (!cvs) return;
          var existing = _RealChart.getChart && _RealChart.getChart(cvs);
          if (existing) try { existing.destroy(); } catch (_) {}
        });
      } catch (_) {}
      try { if (typeof window.drawCharts === 'function') window.drawCharts(); } catch (_) {}
    }
    // First nudge soon after patch (give app.js a beat to settle)
    setTimeout(nudgeRedraw, 80);
    // Belt + suspenders: second nudge after 500ms in case the first ran while
    // drawCharts wasn't yet hoisted to window.
    setTimeout(nudgeRedraw, 500);
    window._wjpChartsNudge = nudgeRedraw;

    return true;
  }

  function tryPatch() {
    if (patchChart()) {
      observeTheme();
      return;
    }
    setTimeout(tryPatch, 300);
  }

  // When the user toggles theme, destroy both upgraded charts so app.js recreates them
  // with the new theme colors. This keeps tooltips/axes/labels in sync with the palette.
  function observeTheme() {
    try {
      var mo = new MutationObserver(function () {
        if (typeof window._wjpChartsNudge === 'function') window._wjpChartsNudge();
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryPatch);
  else tryPatch();
})();
