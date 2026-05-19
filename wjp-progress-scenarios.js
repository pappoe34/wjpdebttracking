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
  var LS_ACTIVE = 'wjp.ps.activeScenario';

  function readActiveScenario() {
    try {
      var v = localStorage.getItem(LS_ACTIVE);
      if (v === 'minimums' || v === 'custom' || v === 'aggressive') return v;
    } catch (_) {}
    return null;
  }
  function writeActiveScenario(key) {
    try { localStorage.setItem(LS_ACTIVE, key); } catch (_) {}
  }

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

  // Per-scenario simulation needs the engine to USE the scenario\u2019s extra,
  // not whatever is currently active. We set a thread-local override that
  // the wrapped getEffectiveExtraContribution honors temporarily.
  var _wjpSimOverride = null;
  function simulate(extra) {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return null;
      var strategy = getStrategy();
      var r;
      _wjpSimOverride = Number(extra) || 0;
      try { r = window.calculateDebtPayoff(strategy); }
      catch (_) { r = null; }
      _wjpSimOverride = null;
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
  // Stable, non-recursive Aggressive value. Calling calculateDebtPayoff here
  // would re-enter the wrapped getEffectiveExtraContribution and recurse.
  function computeAggressive() {
    var surplus = getAvailableCashflow();
    return Math.max(surplus, 500);
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
      'background:' + (isActive ? 'var(--card, linear-gradient(180deg,#ffffff,#f8faf6))' : 'transparent'),
      'color:' + (isActive ? 'var(--ink, #0a0a0a)' : 'var(--ink-dim, rgba(10,10,10,0.55))'),
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
    seg.addEventListener('mouseenter', function () { if (!isActive) seg.style.color = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#0a0a0a'; });
    seg.addEventListener('mouseleave', function () { if (!isActive) seg.style.color = 'rgba(10,10,10,0.55)'; });
    seg.addEventListener('click', function () { onSegmentClick(scenario); });
    return seg;
  }

  function onSegmentClick(s) {
    try {
      // Just record which scenario is active. The wrapped getEffectiveExtra-
      // Contribution above maps active -> extra without touching the user\u2019s
      // saved extra-toggle setting (so 'Extra' always = whatever they saved
      // via the gear icon).
      writeActiveScenario(s.key);
      try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (_) {}
      setTimeout(tick, 200);
    } catch (_) {}
  }


  // Wrap getEffectiveExtraContribution so the chip state determines what
  // extra is APPLIED, without overwriting the user\u2019s saved setting in
  // wjp.extraToggle.v1. This preserves the value they set in the gear icon.
  var _wjpScenariosWrapped = false;
  function wrapExtraContribution() {
    if (_wjpScenariosWrapped) return;
    if (typeof window.getEffectiveExtraContribution !== 'function') {
      setTimeout(wrapExtraContribution, 300);
      return;
    }
    var orig = window.getEffectiveExtraContribution;
    window.getEffectiveExtraContribution = function () {
      try {
        // Temporary override during chip simulations
        if (_wjpSimOverride !== null) {
          return { extra: _wjpSimOverride, source: 'scenario-sim' };
        }
        var active = readActiveScenario();
        if (active === 'minimums') return { extra: 0, source: 'scenario-minimums' };
        if (active === 'aggressive') {
          return { extra: computeAggressive(), source: 'scenario-aggressive' };
        }
      } catch (_) {}
      return orig.apply(this, arguments);
    };
    _wjpScenariosWrapped = true;
    try { console.log('[wjp-progress-scenarios] wrapped getEffectiveExtraContribution'); } catch (_) {}
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
          // Glass overlay: translucent base + heavy backdrop blur + subtle inner highlight
          'background:linear-gradient(135deg,rgba(255,255,255,0.55),rgba(255,255,255,0.25))',
          'border:1px solid rgba(255,255,255,0.45)',
          'border-radius:999px',
          'z-index:5',
          'font-family:Inter,system-ui,sans-serif',
          'box-shadow:0 4px 18px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.05)',
          'pointer-events:auto',
          'backdrop-filter:blur(14px) saturate(160%)',
          '-webkit-backdrop-filter:blur(14px) saturate(160%)'
        ].join(';');
        card.appendChild(wrap);
      } else {
        // Reset inline styles in case width changed; the container style is fixed
      }

      var stored = readActiveScenario();
      // If extra value === 0, infer minimums-only as active (covers fresh users)
      if (!stored) {
        if (Math.abs(custom) < 1) stored = 'minimums';
        else stored = 'custom';
      }
      // v8 fix 2026-05-19 — update segments IN PLACE instead of rip+rebuild
      // every 1.5s. Previous behavior caused visible 'refresh' flicker because
      // every tick removed all 3 children and re-appended them.
      var existing = wrap.querySelectorAll('[data-ps-key]');
      var fingerprint = scenarios.map(function (s) {
        return s.key + '|' + s.label + '|' + (s.dateStr || '') + '|' + (s.months || '') + '|' + (s.key === stored ? 'A' : '');
      }).join('::');
      if (wrap._wjpLastFingerprint === fingerprint) {
        // Nothing changed — skip entirely
        return;
      }
      wrap._wjpLastFingerprint = fingerprint;
      if (existing.length === scenarios.length) {
        // Update each segment in place — toggle active class, update text only if it changed
        scenarios.forEach(function (s, idx) {
          var seg = existing[idx];
          var fresh = buildSegment(s, s.key === stored);
          if (seg.outerHTML !== fresh.outerHTML) {
            seg.replaceWith(fresh);
          }
        });
      } else {
        // Different count — full rebuild (rare)
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        scenarios.forEach(function (s) {
          wrap.appendChild(buildSegment(s, s.key === stored));
        });
      }
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios v7] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    wrapExtraContribution();
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
