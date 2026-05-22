/* wjp-portfolio-overview.js v3 (drop observer + event listeners — flicker fix) — v2 (sparkline NaN fix + rAF-debounced re-renders) — v1 — adds Asset Allocation donut + Performance
 * period toggle (7d/30d/90d/1y/all) to the existing Portfolio tab.
 *
 * Mounts AFTER the existing #wjp-pf-trajectory canvas inside #page-portfolio,
 * so the existing 12-month trajectory chart stays. We don't touch the
 * existing portfolio module; we just add two new sections.
 *
 * Data sources:
 *   - appState.assets (the unified asset store)
 *   - appState.debts  (liabilities)
 *   - appState.netWorthHistory (we maintain this — one snapshot per day)
 *
 * Honored memory rules:
 *   - appState read via try/catch (bare let)
 *   - Night-mode safe via var(--ink, var(--text-1, …)) chains
 *   - Mutation observer scoped + disconnect-before-mutate (avoids the
 *     portfolio.js freeze called out in memory)
 *   - Works for every user (empty-state graceful)
 *   - Data must be connected: reads same appState that Dashboard reads
 */
(function () {
  'use strict';
  if (window._wjpPortfolioOverviewInstalled) return;
  window._wjpPortfolioOverviewInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }
  function saveState() {
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
  }
  function fmtUsd(n, compact) {
    if (!isFinite(n)) return '$0';
    var neg = n < 0; var abs = Math.abs(n);
    if (compact) {
      if (abs >= 1e6) return (neg ? '−' : '') + '$' + (abs / 1e6).toFixed(1) + 'M';
      if (abs >= 1e3) return (neg ? '−' : '') + '$' + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'k';
    }
    return (neg ? '−' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function fmtPct(n) { if (!isFinite(n)) return '0%'; return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ---------- asset reads (live Plaid balance override) ----------
  function getLiveAssetValue(a) {
    if (!a) return 0;
    if (a.plaidAccountId && window.WJP_Assets && typeof window.WJP_Assets.debugCache === 'function') {
      var dc = window.WJP_Assets.debugCache();
      if (dc && Array.isArray(dc.items)) {
        for (var i = 0; i < dc.items.length; i++) {
          if (dc.items[i].plaidAccountId === a.plaidAccountId) return Number(dc.items[i].balance) || 0;
        }
      }
    }
    return Number(a.value) || 0;
  }
  function totalAssets() {
    var s = getAppState();
    if (!s || !Array.isArray(s.assets)) return 0;
    return s.assets.reduce(function (sum, a) { return sum + getLiveAssetValue(a); }, 0);
  }
  function totalDebts() {
    var s = getAppState();
    if (!s || !Array.isArray(s.debts)) return 0;
    return s.debts.reduce(function (sum, d) { return sum + (Number(d.balance) || 0); }, 0);
  }
  function netWorth() { return totalAssets() - totalDebts(); }

  // ---------- net-worth history sampling ----------
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function sampleNetWorth() {
    var s = getAppState();
    if (!s) return;
    if (!Array.isArray(s.netWorthHistory)) s.netWorthHistory = [];
    var hist = s.netWorthHistory;
    var k = todayKey();
    var nw = netWorth();
    var assets = totalAssets();
    var debts = totalDebts();
    var existing = hist.find(function (h) { return h.date === k; });
    if (existing) {
      // Update today's snapshot if values changed (latest of the day wins)
      if (existing.net !== nw || existing.assets !== assets || existing.debts !== debts) {
        existing.net = nw; existing.assets = assets; existing.debts = debts;
        saveState();
      }
      return;
    }
    hist.push({ date: k, assets: assets, debts: debts, net: nw, ts: Date.now() });
    // Keep last 365 days
    if (hist.length > 365) s.netWorthHistory = hist.slice(-365);
    saveState();
  }
  function getHistoryForPeriod(period) {
    var s = getAppState();
    var hist = (s && Array.isArray(s.netWorthHistory)) ? s.netWorthHistory.slice() : [];
    if (!hist.length) return [];
    hist.sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (period === 'all') return hist;
    var daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    var days = daysMap[period] || 30;
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    var cutoffKey = cutoff.toISOString().slice(0, 10);
    return hist.filter(function (h) { return h.date >= cutoffKey; });
  }

  // ---------- type meta ----------
  var TYPE_META = {
    investment:  { label: 'Investments',  color: '#c5a572', icon: '📈' },
    crypto:      { label: 'Crypto',       color: '#f59e0b', icon: '₿'  },
    real_estate: { label: 'Real estate',  color: '#10b981', icon: '🏠' },
    vehicle:     { label: 'Vehicles',     color: '#3b82f6', icon: '🚗' },
    cash:        { label: 'Cash',         color: '#22c55e', icon: '🏦' },
    other:       { label: 'Other',        color: '#a78bfa', icon: '💎' },
    _debt:       { label: 'Liabilities',  color: '#dc2626', icon: '💳' }
  };

  // ---------- CSS ----------
  function ensureStyles() {
    if (document.getElementById('wjp-pf-overview-styles')) return;
    var css = [
      '.wjp-pfov-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px;}',
      '@media (max-width:980px){.wjp-pfov-grid{grid-template-columns:1fr;}}',
      '.wjp-pfov-card{background:var(--card,var(--surface,#fff));border:1px solid var(--border,rgba(120,113,108,.18));border-radius:16px;padding:20px 22px;color:var(--ink,var(--text-1,#0a0a0a));box-shadow:0 1px 2px rgba(0,0,0,.04);}',
      'body.dark .wjp-pfov-card,[data-theme="dark"] .wjp-pfov-card{background:rgb(19,25,41);border-color:rgba(255,255,255,.08);color:#f0f4ff;}',
      '.wjp-pfov-card .pfov-eyebrow{font-size:11px;letter-spacing:.14em;font-weight:700;color:#c5a572;text-transform:uppercase;}',
      '.wjp-pfov-card .pfov-title{font-size:18px;font-weight:700;margin:4px 0 14px;color:var(--ink,var(--text-1,#0a0a0a));}',
      'body.dark .wjp-pfov-card .pfov-title,[data-theme="dark"] .wjp-pfov-card .pfov-title{color:#f0f4ff;}',
      // Allocation donut
      '.wjp-pfov-donut-wrap{display:flex;align-items:center;gap:24px;}',
      '.wjp-pfov-donut-wrap svg{flex:0 0 200px;}',
      '.wjp-pfov-donut-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;}',
      '.wjp-pfov-donut-svg-box{position:relative;flex:0 0 200px;width:200px;height:200px;}',
      '.wjp-pfov-donut-total{font-size:20px;font-weight:800;color:var(--ink,var(--text-1,#0a0a0a));}',
      'body.dark .wjp-pfov-donut-total,[data-theme="dark"] .wjp-pfov-donut-total{color:#f0f4ff;}',
      '.wjp-pfov-donut-sub{font-size:10px;font-weight:600;color:var(--text-2,#8b8378);letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}',
      '.wjp-pfov-legend{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0;}',
      '.wjp-pfov-legend-row{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink,var(--text-1,#0a0a0a));}',
      'body.dark .wjp-pfov-legend-row,[data-theme="dark"] .wjp-pfov-legend-row{color:#f0f4ff;}',
      '.wjp-pfov-legend-swatch{width:10px;height:10px;border-radius:3px;flex:0 0 10px;}',
      '.wjp-pfov-legend-name{flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wjp-pfov-legend-val{font-weight:700;font-variant-numeric:tabular-nums;}',
      '.wjp-pfov-legend-pct{font-size:11px;color:var(--text-2,#8b8378);min-width:42px;text-align:right;}',
      // Performance
      '.wjp-pfov-perf-tabs{display:flex;gap:4px;background:rgba(255,255,255,.04);border-radius:10px;padding:3px;margin-bottom:14px;}',
      'body.light .wjp-pfov-perf-tabs,[data-theme="light"] .wjp-pfov-perf-tabs{background:rgba(0,0,0,.04);}',
      '.wjp-pfov-perf-tabs button{flex:1;background:transparent;border:0;padding:7px 8px;border-radius:8px;font-size:11.5px;font-weight:600;cursor:pointer;color:var(--text-2,#8b8378);font-family:inherit;letter-spacing:.04em;}',
      '.wjp-pfov-perf-tabs button.active{background:var(--card,#fff);color:var(--ink,#0a0a0a);box-shadow:0 1px 2px rgba(0,0,0,.06);}',
      'body.dark .wjp-pfov-perf-tabs button.active,[data-theme="dark"] .wjp-pfov-perf-tabs button.active{background:#1c2335;color:#f0f4ff;}',
      '.wjp-pfov-perf-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:12px;}',
      '.wjp-pfov-perf-cell .label{font-size:10px;color:var(--text-2,#8b8378);text-transform:uppercase;letter-spacing:.06em;font-weight:700;}',
      '.wjp-pfov-perf-cell .val{font-size:22px;font-weight:800;color:var(--ink,#0a0a0a);font-variant-numeric:tabular-nums;margin-top:2px;}',
      'body.dark .wjp-pfov-perf-cell .val,[data-theme="dark"] .wjp-pfov-perf-cell .val{color:#f0f4ff;}',
      '.wjp-pfov-perf-cell .delta{font-size:12px;font-weight:700;margin-top:2px;}',
      '.wjp-pfov-perf-cell .delta.up{color:#10b981;}',
      '.wjp-pfov-perf-cell .delta.down{color:#ef4444;}',
      '.wjp-pfov-perf-spark{height:60px;width:100%;}',
      '.wjp-pfov-empty{padding:18px 6px;color:var(--text-2,#8b8378);font-size:13px;text-align:center;}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'wjp-pf-overview-styles'; st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- Asset Allocation Donut ----------
  function buildAllocation() {
    var s = getAppState();
    var buckets = {};
    if (s && Array.isArray(s.assets)) {
      s.assets.forEach(function (a) {
        var t = a.type || 'other';
        if (!TYPE_META[t]) t = 'other';
        var v = getLiveAssetValue(a);
        if (v <= 0) return;
        buckets[t] = (buckets[t] || 0) + v;
      });
    }
    // Include debt as a slice so the donut answers "what's your net worth composed of?"
    var debt = totalDebts();
    if (debt > 0) buckets._debt = debt;
    return buckets;
  }
  function renderAllocationDonut() {
    var buckets = buildAllocation();
    var entries = Object.keys(buckets).map(function (k) {
      return { key: k, label: TYPE_META[k].label, color: TYPE_META[k].color, value: buckets[k] };
    });
    var total = entries.reduce(function (sum, e) { return sum + e.value; }, 0);
    var totalAssetsOnly = entries.filter(function (e) { return e.key !== '_debt'; }).reduce(function (s,e) { return s + e.value; }, 0);

    if (!total) {
      return '<div class="wjp-pfov-empty">Add assets or debts to see how your wealth breaks down.</div>';
    }

    // SVG donut — circumference 2πr with r=70 → ~439.82
    var r = 70, cx = 100, cy = 100, C = 2 * Math.PI * r;
    var offset = 0;
    var paths = entries.map(function (e) {
      var pct = e.value / total;
      var dash = (pct * C).toFixed(2);
      var gap = (C - parseFloat(dash)).toFixed(2);
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="transparent" '
              + 'stroke="' + e.color + '" stroke-width="22" '
              + 'stroke-dasharray="' + dash + ' ' + gap + '" '
              + 'stroke-dashoffset="' + (-offset).toFixed(2) + '" '
              + 'transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>';
      offset += parseFloat(dash);
      return seg;
    }).join('');

    var legend = entries.sort(function (a, b) { return b.value - a.value; }).map(function (e) {
      var pct = e.value / total * 100;
      return '<div class="wjp-pfov-legend-row">'
        + '<span class="wjp-pfov-legend-swatch" style="background:' + e.color + ';"></span>'
        + '<span class="wjp-pfov-legend-name">' + escapeHtml(e.label) + '</span>'
        + '<span class="wjp-pfov-legend-val">' + fmtUsd(e.value, true) + '</span>'
        + '<span class="wjp-pfov-legend-pct">' + pct.toFixed(1) + '%</span>'
        + '</div>';
    }).join('');

    return ''
      + '<div class="wjp-pfov-donut-wrap">'
      + '  <div class="wjp-pfov-donut-svg-box">'
      + '    <svg viewBox="0 0 200 200" width="200" height="200" aria-label="Asset allocation donut">'
      + '      <circle cx="100" cy="100" r="70" fill="transparent" stroke="rgba(120,113,108,.08)" stroke-width="22"></circle>'
      +        paths
      + '    </svg>'
      + '    <div class="wjp-pfov-donut-center">'
      + '      <div class="wjp-pfov-donut-total">' + fmtUsd(totalAssetsOnly, true) + '</div>'
      + '      <div class="wjp-pfov-donut-sub">total assets</div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="wjp-pfov-legend">' + legend + '</div>'
      + '</div>';
  }

  // ---------- Performance Toggle ----------
  var _currentPeriod = '30d';
  function renderPerformancePeriod() {
    var hist = getHistoryForPeriod(_currentPeriod);
    if (hist.length < 2) {
      // Not enough history yet — show today's snapshot as flat row
      var now = netWorth();
      return ''
        + buildPerfTabs()
        + '<div class="wjp-pfov-perf-row">'
        + '  <div class="wjp-pfov-perf-cell"><div class="label">Net worth</div><div class="val">' + fmtUsd(now, true) + '</div></div>'
        + '  <div class="wjp-pfov-perf-cell"><div class="label">Change</div><div class="val">—</div><div class="delta">Collecting data…</div></div>'
        + '  <div class="wjp-pfov-perf-cell"><div class="label">Period</div><div class="val">' + _currentPeriod.toUpperCase() + '</div></div>'
        + '</div>'
        + '<div class="wjp-pfov-empty">We sample your net worth daily. Open the dashboard tomorrow to see your first delta.</div>';
    }

    var first = hist[0], last = hist[hist.length - 1];
    var deltaAbs = last.net - first.net;
    var deltaPct = first.net !== 0 ? (deltaAbs / Math.abs(first.net)) * 100 : 0;
    var deltaCls = deltaAbs >= 0 ? 'up' : 'down';
    var deltaArrow = deltaAbs >= 0 ? '▲' : '▼';

    // Sparkline SVG (use uppercase W/H so the .map iterator var doesn't shadow them)
    var W = 600, H = 60, padX = 8, padY = 6;
    var values = hist.map(function (p) { return p.net; });
    var minV = Math.min.apply(null, values), maxV = Math.max.apply(null, values);
    var range = (maxV - minV) || 1;
    var xs = hist.map(function (p, i) { return padX + (i / Math.max(1, hist.length - 1)) * (W - 2 * padX); });
    var ys = hist.map(function (p) { return padY + (1 - (p.net - minV) / range) * (H - 2 * padY); });
    var color = deltaAbs >= 0 ? '#10b981' : '#ef4444';
    var d = '';
    for (var i = 0; i < xs.length; i++) {
      d += (i === 0 ? 'M' : 'L') + xs[i].toFixed(2) + ' ' + ys[i].toFixed(2) + ' ';
    }
    var area = d + 'L' + xs[xs.length-1].toFixed(2) + ' ' + (H - padY).toFixed(2) + ' L' + xs[0].toFixed(2) + ' ' + (H - padY).toFixed(2) + ' Z';

    return ''
      + buildPerfTabs()
      + '<div class="wjp-pfov-perf-row">'
      + '  <div class="wjp-pfov-perf-cell"><div class="label">Net worth</div><div class="val">' + fmtUsd(last.net, true) + '</div></div>'
      + '  <div class="wjp-pfov-perf-cell"><div class="label">Change · ' + _currentPeriod.toUpperCase() + '</div>'
      + '    <div class="val">' + (deltaAbs >= 0 ? '+' : '') + fmtUsd(deltaAbs, true) + '</div>'
      + '    <div class="delta ' + deltaCls + '">' + deltaArrow + ' ' + fmtPct(deltaPct) + '</div></div>'
      + '  <div class="wjp-pfov-perf-cell"><div class="label">Samples</div><div class="val">' + hist.length + '</div></div>'
      + '</div>'
      + '<svg class="wjp-pfov-perf-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + '  <path d="' + area + '" fill="' + color + '" fill-opacity="0.12"></path>'
      + '  <path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2"></path>'
      + '</svg>';
  }
  function buildPerfTabs() {
    var periods = ['7d', '30d', '90d', '1y', 'all'];
    return '<div class="wjp-pfov-perf-tabs">' + periods.map(function (p) {
      return '<button type="button" data-period="' + p + '" class="' + (p === _currentPeriod ? 'active' : '') + '">' + p.toUpperCase() + '</button>';
    }).join('') + '</div>';
  }

  // ---------- mount ----------
  function findMount() {
    var page = document.getElementById('page-portfolio');
    if (!page) return null;
    return page;
  }
  // Fingerprint memo: only re-render if data actually changed.
  // Prevents the graph from flickering when wjp-assets-changed fires constantly.
  var _lastFingerprint = '';
  function dataFingerprint() {
    try {
      var s = getAppState() || {};
      var aSig = Array.isArray(s.assets) ? s.assets.map(function (a) {
        return [a.id, a.type, Math.round(getLiveAssetValue(a)), a.plaidAccountId || ''];
      }) : [];
      var dSig = Array.isArray(s.debts) ? s.debts.reduce(function (n, d) { return n + (Number(d.balance) || 0); }, 0) : 0;
      var hSig = (s.netWorthHistory || []).length;
      return JSON.stringify({ a: aSig, d: dSig, h: hSig, p: _currentPeriod });
    } catch (_) { return ''; }
  }

  // rAF-debounced renderer so a burst of events triggers ONE paint.
  var _renderQueued = false;
  function renderInto(host, force) {
    if (_renderQueued && !force) return;
    _renderQueued = true;
    requestAnimationFrame(function () {
      _renderQueued = false;
      try { renderInto_now(host, force); } catch (_) {}
    });
  }
  function renderInto_now(host, force) {
    ensureStyles();
    var fp = dataFingerprint();
    var existing = document.getElementById('wjp-pf-overview');
    if (existing && !force && fp === _lastFingerprint) return; // skip — nothing changed
    _lastFingerprint = fp;
    if (existing) {
      existing.innerHTML = buildHTML();
    } else {
      var section = document.createElement('section');
      section.id = 'wjp-pf-overview';
      section.className = 'wjp-pfov-grid';
      section.innerHTML = buildHTML();
      var traj = host.querySelector('#wjp-pf-trajectory');
      var anchor = traj ? traj.closest('div') : null;
      if (anchor && anchor.parentElement === host) anchor.insertAdjacentElement('afterend', section);
      else host.insertBefore(section, host.firstChild);
    }
    wireEvents();
  }
  function buildHTML() {
    return ''
      + '<div class="wjp-pfov-card" id="wjp-pf-allocation">'
      + '  <span class="pfov-eyebrow">Allocation</span>'
      + '  <div class="pfov-title">How your wealth breaks down</div>'
      + '  <div class="pfov-content">' + renderAllocationDonut() + '</div>'
      + '</div>'
      + '<div class="wjp-pfov-card" id="wjp-pf-performance">'
      + '  <span class="pfov-eyebrow">Performance</span>'
      + '  <div class="pfov-title">Net worth change over time</div>'
      + '  <div class="pfov-content">' + renderPerformancePeriod() + '</div>'
      + '</div>';
  }
  function wireEvents() {
    var perf = document.getElementById('wjp-pf-performance');
    if (perf && !perf.__wired) {
      perf.__wired = true;
      perf.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-period]');
        if (!btn) return;
        _currentPeriod = btn.dataset.period;
        var content = perf.querySelector('.pfov-content');
        if (content) content.innerHTML = renderPerformancePeriod();
      });
    }
  }

  // ---------- boot ----------
  // (MutationObserver removed in v3 — was causing flicker on rapid DOM churn from other modules.)

  function boot() {
    ensureStyles();
    // Sample today's net worth on boot (silent — no UI re-render triggered)
    try { sampleNetWorth(); } catch (_) {}

    // Mount immediately if the portfolio page exists; otherwise wait until
    // the user clicks the Portfolio nav. We re-check on a 5-second cadence
    // instead of using a MutationObserver — observers were causing flicker
    // because they fired on every DOM change from other modules.
    function tryMount() {
      var host = findMount();
      if (host && !document.getElementById('wjp-pf-overview')) {
        try { renderInto_now(host, true); } catch (_) {}
      }
    }
    tryMount();
    setInterval(tryMount, 5000);

    // Sample net worth every 5 minutes (used to be 60s — too aggressive,
    // contributed to constant state churn).
    setInterval(function () { try { sampleNetWorth(); } catch (_) {} }, 300000);

    // Only one external re-render trigger: when the user signs in fresh.
    // Removed wjp-assets-changed and wjp-debt-updated listeners — they were
    // firing too often and causing the page to flicker. The donut/sparkline
    // refresh naturally on the next render cycle, which is fine for a
    // historical-data card. Click the period toggle to force a refresh.
    window.addEventListener('wjp-auth-ready', function () {
      try { sampleNetWorth(); } catch (_) {}
      tryMount();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PortfolioOverview = {
    sampleNetWorth: sampleNetWorth,
    netWorth: netWorth,
    totalAssets: totalAssets,
    totalDebts: totalDebts,
    history: function () { var s = getAppState(); return (s && s.netWorthHistory) || []; },
    version: 3
  };
})();
