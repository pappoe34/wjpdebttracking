/* wjp-progress-scenarios.js — v5 (no window.appState dependency).
 * Tabs above the progress bar. Reads debt info via window.calculateDebtPayoff
 * which uses app.js's internal closure-scoped appState. No reliance on
 * window.appState (which doesn't exist).
 */
(function () {
  'use strict';
  if (window._wjpProgressScenariosInstalled) return;
  window._wjpProgressScenariosInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var WRAP_ID = 'wjp-ps-tabs';

  function getStrategy() {
    try {
      // Try to read from a few well-known accessors
      var dfdEyebrow = document.getElementById('dfd-eyebrow');
      // The strategy lives in appState.settings.strategy — but we can pluck it
      // from the visible DOM: the badge near the bar shows strategy text.
      var badge = document.getElementById('freedom-badge-text');
      if (badge && badge.textContent) {
        var t = badge.textContent.toLowerCase();
        if (t.indexOf('avalanche') !== -1) return 'avalanche';
        if (t.indexOf('snowball') !== -1) return 'snowball';
        if (t.indexOf('hybrid') !== -1) return 'hybrid';
      }
    } catch (_) {}
    return 'avalanche';
  }

  // Use window.calculateDebtPayoff which uses app.js internal appState
  function simulate(extra) {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return null;
      var strategy = getStrategy();
      // Most app.js call sites use calculateDebtPayoff(strategy, extraOverride).
      // The fn ignores the extra-arg if not provided and uses internal extra.
      // We try calling with strategy first; if extra differs we attempt 2nd-arg.
      var r;
      try { r = window.calculateDebtPayoff(strategy, Number(extra) || 0); }
      catch (_) { r = null; }
      // Fallback shapes
      if (r && typeof r === 'object') {
        // Aggregate shape: {months, totalInterest, ...}
        if (typeof r.months === 'number' && r.months > 0) {
          return { months: Math.ceil(r.months), totalInterest: r.totalInterest };
        }
        // Per-debt map: {debtId: {months, totalInterest, ...}}
        var keys = Object.keys(r);
        if (keys.length && typeof r[keys[0]] === 'object' && 'months' in (r[keys[0]] || {})) {
          var maxM = 0, totalI = 0;
          keys.forEach(function (k) {
            var d = r[k];
            if (d && typeof d.months === 'number') maxM = Math.max(maxM, d.months);
            if (d && typeof d.totalInterest === 'number') totalI += d.totalInterest;
          });
          if (maxM > 0) return { months: Math.ceil(maxM), totalInterest: totalI };
        }
      }
    } catch (_) {}
    return null;
  }

  function fmtDate(monthsAhead) {
    if (!monthsAhead || monthsAhead <= 0) return '-';
    if (monthsAhead > 600) return '50+ yrs';
    var d = new Date();
    d.setMonth(d.getMonth() + Math.ceil(monthsAhead));
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  function fmtDollars(n) {
    if (!isFinite(n)) return '-';
    var abs = Math.abs(n);
    if (abs >= 1000) return '$' + (abs / 1000).toFixed(1) + 'k';
    return '$' + Math.round(abs);
  }

  function getCustomExtra() {
    try {
      if (typeof window.getEffectiveExtraContribution === 'function') {
        var r = window.getEffectiveExtraContribution();
        if (r && typeof r.extra === 'number') return r.extra;
      }
    } catch (_) {}
    return 0;
  }

  function getAvailableCashflow() {
    try {
      if (typeof window.getAvailableCashflow === 'function') {
        var r = window.getAvailableCashflow();
        if (r && typeof r.available === 'number') return Math.max(0, r.available);
      }
    } catch (_) {}
    return 0;
  }

  function computeAggressive(custom) {
    return Math.max((Number(custom) || 0) * 2, getAvailableCashflow(), 500);
  }

  function findBarInsertionPoint() {
    var fill = document.getElementById('freedom-progress-fill');
    if (!fill) return null;
    var node = fill.parentElement;
    var hops = 0;
    while (node && hops < 8) {
      var par = node.parentElement;
      if (!par) break;
      var hasPaid = par.querySelector && par.querySelector('#freedom-paid-amt');
      var hasTarget = par.querySelector && par.querySelector('#freedom-target-amt');
      if (hasPaid && hasTarget) {
        return { parent: par, beforeNode: node };
      }
      node = par;
      hops++;
    }
    if (fill.parentElement && fill.parentElement.parentElement) {
      return { parent: fill.parentElement.parentElement, beforeNode: fill.parentElement };
    }
    return null;
  }

  function buildTab(scenario, isActive) {
    var tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.scenarioKey = scenario.key;
    tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    tab.style.cssText = [
      'flex:1', 'min-width:0',
      'padding:9px 12px 11px',
      'background:' + (isActive ? '#1f7a4a' : 'rgba(255,255,255,0.85)'),
      'color:' + (isActive ? '#fff' : '#0a0a0a'),
      'border:1px solid ' + (isActive ? '#1f7a4a' : 'rgba(0,0,0,0.10)'),
      'border-bottom:' + (isActive ? '0' : '1px solid rgba(0,0,0,0.10)'),
      'border-radius:10px 10px 0 0',
      'cursor:pointer',
      'text-align:center',
      'transition:transform .12s, background .15s, color .15s, border-color .15s',
      'font-family:Inter,system-ui,sans-serif',
      'box-shadow:' + (isActive ? '0 -3px 12px rgba(31,122,74,0.18)' : 'none'),
      'position:relative',
      'z-index:' + (isActive ? '2' : '1')
    ].join(';');
    var labelColor = isActive ? 'rgba(255,255,255,0.85)' : '#9ca3af';
    var dateColor = isActive ? '#fff' : '#0a0a0a';
    var subParts = [];
    if (scenario.months) subParts.push(scenario.months + ' mo');
    if (scenario.totalInterest != null && isFinite(scenario.totalInterest)) subParts.push(fmtDollars(scenario.totalInterest) + ' int');
    var subHtml = subParts.length ? '<div style="font-size:10px;color:' + labelColor + ';font-weight:500;margin-top:1px;">' + subParts.join(' . ') + '</div>' : '';
    tab.innerHTML = ''
      + '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;color:' + labelColor + ';font-weight:800;line-height:1.1;margin-bottom:2px;">' + scenario.label + '</div>'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:' + dateColor + ';line-height:1.15;">' + (scenario.dateStr || '-') + '</div>'
      + subHtml;
    tab.addEventListener('mouseenter', function () { if (!isActive) { tab.style.borderColor = 'rgba(31,122,74,0.32)'; tab.style.background = '#fff'; } });
    tab.addEventListener('mouseleave', function () { if (!isActive) { tab.style.borderColor = 'rgba(0,0,0,0.10)'; tab.style.background = 'rgba(255,255,255,0.85)'; } });
    tab.addEventListener('click', function () { onTabClick(scenario); });
    return tab;
  }

  function onTabClick(s) {
    try {
      var key = 'wjp.extraToggle.config';
      var cfg = { enabled: s.extra > 0, mode: 'manual', amount: Math.round(s.extra) };
      if (s.key === 'minimums') cfg = { enabled: false, mode: 'manual', amount: 0 };
      try { localStorage.setItem(key, JSON.stringify(cfg)); } catch (_) {}
      try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (_) {}
      setTimeout(tick, 200);
    } catch (_) {}
  }

  function tick() {
    try {
      // No appState dependency. Just check that calculateDebtPayoff exists
      // and returns valid data for at least the minimums-only scenario.
      if (typeof window.calculateDebtPayoff !== 'function') return;
      var insertion = findBarInsertionPoint();
      if (!insertion) return;

      var custom = getCustomExtra();
      var aggressive = computeAggressive(custom);
      var displayCustom = custom > 0 ? custom : Math.max(100, Math.round(aggressive / 2));

      var minSim = simulate(0);
      // If minimums-only sim fails or returns 0 months, the user has no
      // debts — don't render tabs.
      if (!minSim || !minSim.months) return;

      var customSim = simulate(displayCustom);
      var aggSim = simulate(aggressive);

      function makeS(key, label, extra, sim) {
        var months = sim ? sim.months : null;
        var ti = sim ? sim.totalInterest : null;
        return { key: key, label: label, extra: extra, months: months, dateStr: months ? fmtDate(months) : null, totalInterest: ti };
      }
      var scenarios = [
        makeS('minimums', 'Minimums only', 0, minSim),
        makeS('custom', 'Your plan', displayCustom, customSim),
        makeS('aggressive', 'Aggressive', aggressive, aggSim)
      ];

      var wrap = document.getElementById(WRAP_ID);
      var positionMismatch = !wrap
        || wrap.parentElement !== insertion.parent
        || wrap.nextSibling !== insertion.beforeNode;
      if (positionMismatch) {
        if (wrap) try { wrap.remove(); } catch (_) {}
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.style.cssText = 'display:flex;gap:6px;width:100%;margin:8px 0 0;font-family:Inter,system-ui,sans-serif;align-items:stretch;';
        insertion.parent.insertBefore(wrap, insertion.beforeNode);
      }

      var newChildren = [];
      scenarios.forEach(function (s) {
        var isActive = Math.abs(s.extra - custom) < 1;
        newChildren.push(buildTab(s, isActive));
      });
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      newChildren.forEach(function (c) { wrap.appendChild(c); });
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios v5] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 600);
    setTimeout(tick, 1500);
    setInterval(tick, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_ProgressScenarios = { refresh: tick, simulate: simulate, _findInsertion: findBarInsertionPoint };
})();
