/* wjp-progress-scenarios.js — v6 (small chips, top-right corner of Exec Summary card).
 * Tiny pill chips in the top-right corner of the dashboard's Executive Summary
 * card. Each shows: label + projected debt-free date. Click applies that
 * scenario. Active chip = filled green. Doesn't interfere with the bar.
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

  function computeAggressive(custom) {
    return Math.max((Number(custom) || 0) * 2, getAvailableCashflow(), 500);
  }

  // Find the Exec Summary card and ensure it's relatively positioned so we
  // can absolutely-position chips in its top-right corner.
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

  function buildChip(scenario, isActive) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.scenarioKey = scenario.key;
    btn.title = scenario.label + (scenario.dateStr ? ' - ' + scenario.dateStr : '');
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.style.cssText = [
      'padding:5px 10px',
      'background:' + (isActive ? '#1f7a4a' : 'rgba(255,255,255,0.92)'),
      'color:' + (isActive ? '#fff' : '#0a0a0a'),
      'border:1px solid ' + (isActive ? '#1f7a4a' : 'rgba(0,0,0,0.12)'),
      'border-radius:999px',
      'cursor:pointer',
      'font-family:Inter,system-ui,sans-serif',
      'font-size:10.5px',
      'font-weight:700',
      'letter-spacing:0.02em',
      'white-space:nowrap',
      'transition:background .15s, color .15s, border-color .15s, transform .12s',
      'box-shadow:' + (isActive ? '0 2px 6px rgba(31,122,74,0.25)' : '0 1px 2px rgba(0,0,0,0.05)'),
      'line-height:1.15'
    ].join(';');
    var labelText = scenario.shortLabel;
    var dateText = scenario.dateStr || '-';
    btn.innerHTML = '<span style="opacity:' + (isActive ? '0.85' : '0.55') + ';font-size:9px;letter-spacing:0.08em;text-transform:uppercase;display:block;margin-bottom:1px;">' + labelText + '</span><span style="font-family:Fraunces,Georgia,serif;font-weight:600;font-size:12px;letter-spacing:-0.01em;">' + dateText + '</span>';
    btn.addEventListener('mouseenter', function () { if (!isActive) { btn.style.borderColor = '#1f7a4a'; btn.style.transform = 'translateY(-1px)'; } });
    btn.addEventListener('mouseleave', function () { if (!isActive) { btn.style.borderColor = 'rgba(0,0,0,0.12)'; btn.style.transform = 'translateY(0)'; } });
    btn.addEventListener('click', function () { onChipClick(scenario); });
    return btn;
  }

  function onChipClick(s) {
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
      if (typeof window.calculateDebtPayoff !== 'function') return;
      var card = findCard();
      if (!card) return;

      var custom = getCustomExtra();
      var aggressive = computeAggressive(custom);
      var displayCustom = custom > 0 ? custom : Math.max(100, Math.round(aggressive / 2));

      var minSim = simulate(0);
      if (!minSim || !minSim.months) return;
      var customSim = simulate(displayCustom);
      var aggSim = simulate(aggressive);

      function makeS(key, label, shortLabel, extra, sim) {
        var months = sim ? sim.months : null;
        return {
          key: key, label: label, shortLabel: shortLabel, extra: extra,
          months: months, dateStr: months ? fmtDate(months) : null
        };
      }
      var scenarios = [
        makeS('minimums', 'Minimums only', 'MIN', 0, minSim),
        makeS('custom', 'Your plan', 'YOU', displayCustom, customSim),
        makeS('aggressive', 'Aggressive', 'MAX', aggressive, aggSim)
      ];

      // Ensure the card is positioned so we can absolutely-place chips.
      try {
        var pos = window.getComputedStyle(card).position;
        if (pos === 'static') card.style.position = 'relative';
      } catch (_) {}

      var wrap = document.getElementById(WRAP_ID);
      if (!wrap || wrap.parentElement !== card) {
        if (wrap) try { wrap.remove(); } catch (_) {}
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.style.cssText = [
          'position:absolute',
          'top:18px',
          'right:64px', // leave room for the existing gear icon at right:18px
          'display:flex',
          'gap:5px',
          'z-index:5',
          'font-family:Inter,system-ui,sans-serif',
          'pointer-events:auto'
        ].join(';');
        card.appendChild(wrap);
      }

      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      scenarios.forEach(function (s) {
        var isActive = Math.abs(s.extra - custom) < 1;
        wrap.appendChild(buildChip(s, isActive));
      });
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios v6] tick threw', e); } catch (_) {}
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
