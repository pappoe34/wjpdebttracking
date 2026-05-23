/* wjp-credit-history-chart.js v1 — Professional score history chart.
 *
 * Replaces the tiny sparkline in the hero with a full-size chart inside
 * the hero card. Adds:
 *   - Bureau selector (Vantage / Equifax / Experian / TransUnion)
 *   - Time range selector (3M / 6M / 12M / All)
 *   - Y-axis labels showing score range
 *   - Hover tooltip with exact date + score
 *   - Smooth area chart with gradient fill
 *
 * Mounts inside the hero's "Score history" slot. The hero hides its own
 * sparkline when this module is loaded.
 *
 * Public API:
 *   WJP_CreditHistoryChart.render()        -> mount/refresh the chart
 *   WJP_CreditHistoryChart.setBureau(b)    -> 'vantage' | 'equifax' | 'experian' | 'transunion'
 *   WJP_CreditHistoryChart.setRange(months) -> 3 | 6 | 12 | 'all'
 */
(function () {
  'use strict';
  if (window._wjpCreditHistoryChartInstalled) return;
  window._wjpCreditHistoryChartInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var HOST_ID = 'wjp-cs-history-chart';
  var state = {
    bureau: 'vantage',   // which series to display
    range: 12            // months
  };

  function mock() { return window.WJP_CreditMock || {}; }

  function getHistory() {
    try {
      // Real history from Firestore-backed appState
      if (typeof appState !== 'undefined' && appState && Array.isArray(appState.creditScoreHistory) && appState.creditScoreHistory.length >= 2) {
        return appState.creditScoreHistory.map(function (h) {
          return {
            ts: h.ts,
            vantage:    h.vantage    || h.score || h.fico8 || h.equifax,
            equifax:    h.equifax    || h.vantage || h.score,
            experian:   h.experian   || null,
            transunion: h.transunion || null
          };
        });
      }
    } catch (_) {}
    // Mock history — derive per-bureau variants from base
    var base = mock().scoreHistory ? mock().scoreHistory() : [];
    return base.map(function (h) {
      return {
        ts: h.ts,
        vantage:    h.score,
        equifax:    h.score,
        experian:   h.score + 8,
        transunion: h.score - 5
      };
    });
  }

  function filteredSeries() {
    var hist = getHistory();
    if (!hist.length) return [];
    var rangeMs = state.range === 'all' ? Infinity : state.range * 30 * 86400000;
    var cutoff = Date.now() - rangeMs;
    var filtered = hist.filter(function (h) { return h.ts >= cutoff; });
    return filtered.map(function (h) { return { ts: h.ts, score: h[state.bureau] || null }; }).filter(function (p) { return p.score != null && p.score >= 300 && p.score <= 850; });
  }

  function bureauColor(b) {
    return b === 'equifax'    ? '#a855f7'
         : b === 'experian'   ? '#0ea5e9'
         : b === 'transunion' ? '#f59e0b'
         : '#10b981';          // vantage = green
  }

  function bureauLabel(b) {
    return b === 'equifax'    ? 'Equifax'
         : b === 'experian'   ? 'Experian'
         : b === 'transunion' ? 'TransUnion'
         : 'VantageScore';
  }

  // ── Chart SVG ───────────────────────────────────────────────────────────
  function multiSeriesData() {
    // Returns array of series objects: { bureau, color, points }
    var hist = getHistory();
    if (!hist.length) return [];
    var rangeMs = state.range === 'all' ? Infinity : state.range * 30 * 86400000;
    var cutoff = Date.now() - rangeMs;
    var filtered = hist.filter(function (h) { return h.ts >= cutoff; });
    var bureaus = ['vantage', 'equifax', 'experian', 'transunion'];
    return bureaus.map(function (b) {
      return {
        bureau: b,
        color: bureauColor(b),
        label: bureauLabel(b),
        points: filtered.map(function (h) { return { ts: h.ts, score: h[b] }; }).filter(function (p) { return p.score != null && p.score >= 300 && p.score <= 850; })
      };
    }).filter(function (s) { return s.points.length >= 2; });
  }

  function chartSVG(points) {
    if (points.length < 2) {
      return '<div style="padding:24px;text-align:center;color:var(--text-3,#94a3b8);font-size:12px;font-weight:600;">Not enough history to chart yet.</div>';
    }
    var W = 720, H = 180;
    var padL = 38, padR = 16, padT = 12, padB = 24;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    var values = points.map(function (p) { return p.score; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    // Pad the range generously so the user sees band context, not a zoom-in.
    // Snap min down to nearest 50 below, max up to nearest 50 above, with at
    // least a 100-point window so even flat history shows context.
    var dataRange = Math.max(40, maxV - minV);
    var pad = Math.max(40, Math.round(dataRange * 0.4));
    var yMin = Math.max(300, Math.floor((minV - pad) / 50) * 50);
    var yMax = Math.min(850, Math.ceil((maxV + pad) / 50) * 50);
    if (yMax - yMin < 100) { yMin = Math.max(300, yMin - 50); yMax = Math.min(850, yMax + 50); }
    var yRange = yMax - yMin;

    var color = bureauColor(state.bureau);
    var sparkId = 'wjp-history-grad-' + state.bureau;

    // Build the smooth path (catmull-rom-ish — use simple line for now)
    var pts = points.map(function (p, i) {
      var x = padL + (i / (points.length - 1)) * innerW;
      var y = padT + (1 - (p.score - yMin) / yRange) * innerH;
      return { x: x, y: y, ts: p.ts, score: p.score };
    });

    var line = 'M ' + pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' L ');
    var fill = line + ' L ' + pts[pts.length - 1].x.toFixed(1) + ',' + (padT + innerH) + ' L ' + pts[0].x.toFixed(1) + ',' + (padT + innerH) + ' Z';

    // Y-axis labels — 5 ticks for fuller scale visibility
    var step = (yMax - yMin) / 4;
    var yTicks = [yMin, yMin + step, yMin + step * 2, yMin + step * 3, yMax].map(Math.round);
    var yLabelsHTML = yTicks.map(function (v) {
      var y = padT + (1 - (v - yMin) / yRange) * innerH;
      return '<text x="' + (padL - 6) + '" y="' + y.toFixed(1) + '" text-anchor="end" dominant-baseline="middle" font-size="10" font-weight="700" fill="var(--text-3, #94a3b8)" font-family="inherit">' + v + '</text>'
           + '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--border, rgba(0,0,0,0.06))" stroke-width="1" stroke-dasharray="2 3"/>';
    }).join('');

    // X-axis date labels — first, middle, last
    var xLabels = '';
    [0, Math.floor(pts.length / 2), pts.length - 1].forEach(function (i, idx) {
      if (i < 0 || i >= pts.length) return;
      var d = new Date(pts[i].ts);
      var label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      var anchor = idx === 0 ? 'start' : idx === 1 ? 'middle' : 'end';
      xLabels += '<text x="' + pts[i].x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '" font-size="10" font-weight="700" fill="var(--text-3, #94a3b8)" font-family="inherit">' + label + '</text>';
    });

    // Data point dots + tooltips
    var dotsHTML = pts.map(function (p, i) {
      var d = new Date(p.ts);
      var dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      var title = bureauLabel(state.bureau) + ': ' + p.score + ' · ' + dateStr;
      return '<circle data-cs-pt="' + i + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="' + color + '" stroke="var(--card, #fff)" stroke-width="2" style="cursor:pointer;"><title>' + title + '</title></circle>';
    }).join('');

    // Latest score callout
    var latest = pts[pts.length - 1];
    var firstP = pts[0];
    var delta = latest.score - firstP.score;
    var deltaSign = delta >= 0 ? '+' : '';
    var deltaColor = delta >= 0 ? '#22c55e' : '#ef4444';

    return ''
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;max-width:100%;display:block;" aria-hidden="true">'
      +   '<defs>'
      +     '<linearGradient id="' + sparkId + '" x1="0" y1="0" x2="0" y2="1">'
      +       '<stop offset="0%"   stop-color="' + color + '" stop-opacity="0.32"/>'
      +       '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.00"/>'
      +     '</linearGradient>'
      +   '</defs>'
      +   yLabelsHTML
      +   '<path d="' + fill + '" fill="url(#' + sparkId + ')" stroke="none"/>'
      +   '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
      +   dotsHTML
      +   '<circle cx="' + latest.x.toFixed(1) + '" cy="' + latest.y.toFixed(1) + '" r="5" fill="' + color + '" stroke="var(--card, #fff)" stroke-width="3"/>'
      +   xLabels
      + '</svg>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px;font-weight:600;color:var(--text-3,#94a3b8);">'
      +   '<span>Hover any point for date + score</span>'
      +   '<span><strong style="color:' + deltaColor + ';">' + deltaSign + delta + ' pts</strong> over the period</span>'
      + '</div>';
  }

  // ── Bureau / time range selectors ───────────────────────────────────────
  function controlsHTML() {
    var bureaus = [
      { id: 'vantage',    label: 'VantageScore' },
      { id: 'equifax',    label: 'Equifax' },
      { id: 'experian',   label: 'Experian' },
      { id: 'transunion', label: 'TransUnion' }
    ];
    var ranges = [
      { id: 3,     label: '3M' },
      { id: 6,     label: '6M' },
      { id: 12,    label: '12M' },
      { id: 'all', label: 'All' }
    ];

    var bureauBtns = bureaus.map(function (b) {
      var active = state.bureau === b.id;
      var color = bureauColor(b.id);
      return '<button type="button" data-cs-bureau="' + b.id + '" style="'
        + 'background:' + (active ? color : 'transparent') + ';'
        + 'color:' + (active ? '#fff' : 'var(--text-3,#94a3b8)') + ';'
        + 'border:1px solid ' + (active ? color : 'var(--border, rgba(0,0,0,0.08))') + ';'
        + 'padding:5px 11px;border-radius:7px;font-size:10.5px;font-weight:800;'
        + 'cursor:pointer;font-family:inherit;letter-spacing:0.02em;transition:all 0.15s ease;'
        + '">' + b.label + '</button>';
    }).join('');

    var rangeBtns = ranges.map(function (r) {
      var active = state.range === r.id;
      return '<button type="button" data-cs-range="' + r.id + '" style="'
        + 'background:' + (active ? 'var(--text-1, #0a0a0a)' : 'transparent') + ';'
        + 'color:' + (active ? 'var(--card, #fff)' : 'var(--text-3, #94a3b8)') + ';'
        + 'border:1px solid ' + (active ? 'var(--text-1, #0a0a0a)' : 'var(--border, rgba(0,0,0,0.08))') + ';'
        + 'padding:5px 11px;border-radius:7px;font-size:10.5px;font-weight:800;'
        + 'cursor:pointer;font-family:inherit;letter-spacing:0.02em;transition:all 0.15s ease;'
        + '">' + r.label + '</button>';
    }).join('');

    return ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">'
      +   '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + bureauBtns + '</div>'
      +   '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + rangeBtns + '</div>'
      + '</div>';
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    var pts = filteredSeries();
    var multiHTML = '';
    if (state.bureau === 'vantage') {
      // Overlay all 3 bureau lines underneath the vantage line
      multiHTML = renderMultiSeriesOverlay();
    }
    host.innerHTML = ''
      + '<div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;margin-bottom:8px;">Score history</div>'
      + controlsHTML()
      + (multiHTML || chartSVG(pts));
    wireEvents();
  }

  // Multi-series overlay: VantageScore primary + Equifax/Experian/TransUnion overlays
  function renderMultiSeriesOverlay() {
    var series = multiSeriesData();
    if (series.length < 2) return chartSVG(filteredSeries());

    var W = 720, H = 180, padL = 38, padR = 16, padT = 12, padB = 24;
    var innerW = W - padL - padR, innerH = H - padT - padB;

    // Compute combined min/max across all series for shared y-scale
    var allVals = [];
    series.forEach(function (s) { s.points.forEach(function (p) { allVals.push(p.score); }); });
    var minV = Math.min.apply(null, allVals);
    var maxV = Math.max.apply(null, allVals);
    var dataRange = Math.max(40, maxV - minV);
    var pad = Math.max(40, Math.round(dataRange * 0.4));
    var yMin = Math.max(300, Math.floor((minV - pad) / 50) * 50);
    var yMax = Math.min(850, Math.ceil((maxV + pad) / 50) * 50);
    if (yMax - yMin < 100) { yMin = Math.max(300, yMin - 50); yMax = Math.min(850, yMax + 50); }
    var yRange = yMax - yMin;

    var step = (yMax - yMin) / 4;
    var yTicks = [yMin, yMin + step, yMin + step * 2, yMin + step * 3, yMax].map(Math.round);
    var yLabelsHTML = yTicks.map(function (v) {
      var y = padT + (1 - (v - yMin) / yRange) * innerH;
      return '<text x="' + (padL - 6) + '" y="' + y.toFixed(1) + '" text-anchor="end" dominant-baseline="middle" font-size="10" font-weight="700" fill="var(--text-3, #94a3b8)" font-family="inherit">' + v + '</text>'
           + '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--border, rgba(0,0,0,0.06))" stroke-width="1" stroke-dasharray="2 3"/>';
    }).join('');

    var linesHTML = '';
    series.forEach(function (s) {
      var pts = s.points.map(function (p, i) {
        var x = padL + (i / (s.points.length - 1)) * innerW;
        var y = padT + (1 - (p.score - yMin) / yRange) * innerH;
        return x.toFixed(1) + ',' + y.toFixed(1);
      });
      var isPrimary = s.bureau === 'vantage';
      var strokeWidth = isPrimary ? 2.8 : 1.8;
      var opacity = isPrimary ? '1' : '0.55';
      linesHTML += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + s.color + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + opacity + '"/>';
    });

    // X-axis labels from the primary (vantage) series
    var vSeries = series.find(function (s) { return s.bureau === 'vantage'; }) || series[0];
    var vPts = vSeries.points.map(function (p, i) {
      var x = padL + (i / (vSeries.points.length - 1)) * innerW;
      return { x: x, ts: p.ts };
    });
    var xLabels = '';
    [0, Math.floor(vPts.length / 2), vPts.length - 1].forEach(function (i, idx) {
      if (i < 0 || i >= vPts.length) return;
      var d = new Date(vPts[i].ts);
      var label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      var anchor = idx === 0 ? 'start' : idx === 1 ? 'middle' : 'end';
      xLabels += '<text x="' + vPts[i].x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '" font-size="10" font-weight="700" fill="var(--text-3, #94a3b8)" font-family="inherit">' + label + '</text>';
    });

    // Legend
    var legendHTML = '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:10.5px;font-weight:700;color:var(--text-2,#475569);margin-top:8px;">'
      + series.map(function (s) {
          var weight = s.bureau === 'vantage' ? '900' : '600';
          return '<span style="display:inline-flex;align-items:center;gap:5px;font-weight:' + weight + ';opacity:' + (s.bureau === 'vantage' ? '1' : '0.7') + ';"><span style="width:11px;height:3px;border-radius:2px;background:' + s.color + ';"></span>' + s.label + '</span>';
        }).join('')
      + '</div>';

    return ''
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;max-width:100%;display:block;" aria-hidden="true">'
      +   yLabelsHTML
      +   linesHTML
      +   xLabels
      + '</svg>'
      + legendHTML;
  }

  function wireEvents() {
    document.querySelectorAll('[data-cs-bureau]').forEach(function (btn) {
      if (btn.__wjpWired) return;
      btn.__wjpWired = true;
      btn.addEventListener('click', function () {
        state.bureau = btn.getAttribute('data-cs-bureau');
        render();
      });
    });
    document.querySelectorAll('[data-cs-range]').forEach(function (btn) {
      if (btn.__wjpWired) return;
      btn.__wjpWired = true;
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-cs-range');
        state.range = v === 'all' ? 'all' : parseInt(v, 10);
        render();
      });
    });
  }

  // Hook into hero render: replace its tiny sparkline with our host element
  function ensureHost() {
    var hero = document.getElementById('wjp-cs-hero-premium');
    if (!hero) return false;
    var host = document.getElementById(HOST_ID);
    if (host) return true;

    // The hero renders its own sparkline + "Score history · last 12 pulls"
    // label. Find that area by looking for the SVG inside the meta column and
    // swap it with our host. If we can't find it, append below the hero.
    try {
      var svgs = hero.querySelectorAll('svg');
      // The hero gauge is the first SVG; the sparkline is the second.
      if (svgs.length >= 2) {
        var spark = svgs[1];
        // Locate the wrapping div that contains both the "Score history" label and the spark
        var wrapper = spark.parentNode;
        if (wrapper) {
          var newHost = document.createElement('div');
          newHost.id = HOST_ID;
          newHost.style.cssText = 'width:100%;';
          wrapper.parentNode.replaceChild(newHost, wrapper);
          return true;
        }
      }
    } catch (_) {}

    // Fallback: append after the hero
    var fallback = document.createElement('div');
    fallback.id = HOST_ID;
    fallback.style.cssText = 'background:var(--card, #fff);border:1px solid var(--border, rgba(0,0,0,0.06));border-radius:14px;padding:18px 22px;margin-bottom:24px;';
    hero.parentNode.insertBefore(fallback, hero.nextSibling);
    return true;
  }

  function init() {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (ensureHost()) {
        render();
        clearInterval(iv);
      } else if (attempts > 50) {
        clearInterval(iv);
      }
    }, 200);

    if (window.addEventListener) {
      window.addEventListener('hashchange', function () { setTimeout(function () { ensureHost(); render(); }, 100); });
      window.addEventListener('wjp:page-change', function () { setTimeout(function () { ensureHost(); render(); }, 100); });
      window.addEventListener('wjp:credit-hero-rendered', function () { setTimeout(function () { ensureHost(); render(); }, 50); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WJP_CreditHistoryChart = {
    render: render,
    setBureau: function (b) { state.bureau = b; render(); },
    setRange: function (r) { state.range = r; render(); }
  };
})();
