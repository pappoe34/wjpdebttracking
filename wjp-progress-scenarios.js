/* wjp-progress-scenarios.js — v7 (segmented toggle).
 * Single connected pill in the top-right corner of the Exec Summary card with
 * 3 segments: Minimums / Extra payment / Aggressive. iOS-style segmented
 * control. Active segment shows white inner pill with shadow. Click changes
 * the active scenario, dashboard re-renders.
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

  function simulate(extra) {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return null;
      var strategy = getStrategy();
      var r;
      try { r = window.calculateDebtPayoff(strategy, Number(extra) || 0); }
      catch (_) { r = null; }
      if (r && typeof r === 'object') {
        if (typeof r.months === 'number' && r.months > 0) {
          return { months: Math.ceil(r.months), totalInterest: r.totalInterest };
        }
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
    if (monthsAhead > 600) return '50y+';
    var d = new Date();
    d.setMonth(d.getMonth() + Math.ceil(monthsAhead));
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
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

  // Aggressive must NOT depend on current custom — that creates a feedback
  // loop where clicking Aggressive changes the value, which changes Aggressive
  // again on next tick, and the active-state derivation breaks.
  function computeAggressive() {
    var surplus = getAvailableCashflow();
    var minSum = 0;
    try {
      // Approximate 2x total minimums as a stable aggressive target
      if (typeof window.calculateDebtPayoff === 'function') {
        var r = window.calculateDebtPayoff(getStrategy(), 0);
        if (r && typeof r === 'object') {
          var keys = Object.keys(r);
          keys.forEach(function (k) {
            var d = r[k];
            if (d && typeof d.monthlyPayment === 'number') minSum += d.monthlyPayment;
            else if (d && typeof d.minPayment === 'number') minSum += d.minPayment;
          });
        }
      }
    } catch (_) {}
    var floor = 500;
    var fromMin = minSum > 0 ? Math.round(minSum * 1.5) : 0;
    return Math.max(surplus, fromMin, floor);
  }

  function findCard() {
    var paid = document.getElementById('freedom-paid-amt');
    if (!paid) return null;
    var node = paid.parentElement;
    var hops = 0;
    while (node && hops < 12) {
      if (node.querySelector && node.querySelector('#freedom-target-amt') && node.querySelector('#freedom-progress-fill')) {
        return node;
      }
      node = node.parentElement;
      hops++;
    }
    return null;
  }

  function buildSegment(scenario, isActive) {
    var seg = document.createElement('button');
    seg.type = 'button';
    seg.dataset.scenarioKey = scenario.key;
    seg.title = scenario.fullLabel + (scenario.dateStr ? ' - ' + scenario.dateStr : '');
    seg.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    seg.style.cssText = [
      'flex:1',
      'padding:8px 16px',
      'background:' + (isActive ? '#fff' : 'transparent'),
      'color:' + (isActive ? '#0a0a0a' : 'rgba(10,10,10,0.55)'),
      'border:0',
      'border-radius:999px',
      'cursor:pointer',
      'font-family:Inter,system-ui,sans-serif','font-size:11.5px','font-weight:700','letter-spacing:0.02em',
      'transition:background .15s, color .15s, box-shadow .15s, transform .12s',
      'box-shadow:' + (isActive ? '0 1px 4px rgba(0,0,0,0.10)' : 'none'),
      'white-space:nowrap',
      'line-height:1.15',
      'position:relative',
      'z-index:' + (isActive ? '2' : '1'),
      'min-width:0'
    ].join(';');
    seg.textContent = scenario.label;
    seg.addEventListener('mouseenter', function () { if (!isActive) seg.style.color = '#0a0a0a'; });
    seg.addEventListener('mouseleave', function () { if (!isActive) seg.style.color = 'rgba(10,10,10,0.55)'; });
    seg.addEventListener('click', function () { onSegmentClick(scenario); });
    return seg;
  }

  function onSegmentClick(s) {
    try {
      var key = 'wjp.extraToggle.v1';
      var cfg = { enabled: s.extra > 0, mode: 'manual', amount: Math.round(s.extra) };
      if (s.key === 'minimums') cfg = { enabled: false, mode: 'manual', amount: 0 };
      try { localStorage.setItem(key, JSON.stringify(cfg)); } catch (_) {}
      try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (_) {}
      setTimeout(tick, 200);
    } catch (_) {}
  }

  function tick() {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return;
      var card = findCard();
      if (!card) return;

      var custom = getCustomExtra();
      var aggressive = computeAggressive();
      var displayCustom = custom > 0 ? custom : Math.max(100, Math.round(aggressive / 2));

      var minSim = simulate(0);
      if (!minSim || !minSim.months) return;
      var customSim = simulate(displayCustom);
      var aggSim = simulate(aggressive);

      function makeS(key, label, fullLabel, extra, sim) {
        var months = sim ? sim.months : null;
        return {
          key: key, label: label, fullLabel: fullLabel, extra: extra,
          months: months, dateStr: months ? fmtDate(months) : null
        };
      }
      var scenarios = [
        makeS('minimums', 'Minimums', 'Minimum payments only', 0, minSim),
        makeS('custom', 'Extra', 'Extra payment', displayCustom, customSim),
        makeS('aggressive', 'Aggressive', 'Aggressive mode', aggressive, aggSim)
      ];

      try {
        var pos = window.getComputedStyle(card).position;
        if (pos === 'static') card.style.position = 'relative';
      } catch (_) {}

      var wrap = document.getElementById(WRAP_ID);
      if (!wrap || wrap.parentElement !== card) {
        if (wrap) try { wrap.remove(); } catch (_) {}
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        // Segmented control container — single rounded pill with light background
        wrap.style.cssText = [
          'position:absolute',
          'top:18px',
          'right:60px',
          'display:flex',
          'gap:2px',
          'padding:3px',
          'background:rgba(255,255,255,0.65)',
          'border:1px solid rgba(0,0,0,0.08)',
          'border-radius:999px',
          'z-index:5',
          'font-family:Inter,system-ui,sans-serif',
          'box-shadow:inset 0 1px 2px rgba(0,0,0,0.04)',
          'pointer-events:auto',
          'backdrop-filter:blur(6px)'
        ].join(';');
        card.appendChild(wrap);
      } else {
        // Reset inline styles in case width changed; the container style is fixed
      }

      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      scenarios.forEach(function (s) {
        var isActive = Math.abs(s.extra - custom) < 1;
        wrap.appendChild(buildSegment(s, isActive));
      });
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios v7] tick threw', e); } catch (_) {}
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

  window.WJP_ProgressScenarios = { refresh: tick, simulate: simulate, _findCard: findCard };
})();
