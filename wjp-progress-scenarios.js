/* wjp-progress-scenarios.js — v4 (tabs ABOVE the bar).
 *
 * 3 clickable tabs above the Exec Summary progress bar showing debt-free
 * dates for: Minimums only / Your plan / Aggressive. Click a tab → applies
 * that extra-payment scenario via extra-toggle config localStorage,
 * dashboard re-renders.
 *
 * v4 placement: tabs sit IMMEDIATELY above the progress bar (between the
 * date hero and the bar element). Anchor strategy: find #freedom-progress-fill,
 * walk up to its closest containing element that's a sibling of recognizable
 * exec-summary children, insert chips BEFORE that container.
 *
 * Hardened: IIFE, idempotent, path-guarded, no MutationObservers, try/catch.
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

  // === Math: simulate debt-free date for a given extra ===
  function simulate(extra) {
    try {
      if (!window.appState || !window.appState.debts || !window.appState.debts.length) return null;
      var debts = window.appState.debts.map(function (d) { return Object.assign({}, d); });
      var strategy = (window.appState.settings && window.appState.settings.strategy) || 'avalanche';
      if (typeof window.calculateDebtPayoff === 'function') {
        var r = window.calculateDebtPayoff(debts, Number(extra) || 0, strategy);
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
      }
      if (typeof window.simulateAllStrategies === 'function') {
        var all = window.simulateAllStrategies(debts, Number(extra) || 0);
        var pick = all && all[strategy];
        if (pick && pick.months > 0) {
          return { months: Math.ceil(pick.months), totalInterest: pick.totalInterest };
        }
      }
    } catch (_) {}
    return null;
  }

  function fmtDate(monthsAhead) {
    if (!monthsAhead || monthsAhead <= 0) return '—';
    if (monthsAhead > 600) return '50+ yrs';
    var d = new Date();
    d.setMonth(d.getMonth() + Math.ceil(monthsAhead));
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  function fmtDollars(n) {
    if (!isFinite(n)) return '—';
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
    try {
      if (window.appState && window.appState.budget) {
        return Number(window.appState.budget.extraContribution || window.appState.budget.extra) || 0;
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
    var doubled = (Number(custom) || 0) * 2;
    var surplus = getAvailableCashflow();
    return Math.max(doubled, surplus, 500);
  }

  // === Anchor finder: locate the bar wrapper so we can insert BEFORE it ===
  // Returns { parent, beforeNode } where chips go: parent.insertBefore(chips, beforeNode).
  function findBarInsertionPoint() {
    var fill = document.getElementById('freedom-progress-fill');
    if (!fill) return null;
    // The fill is inside a track which is inside the bar wrapper.
    // Walk up to find a node whose PARENT contains both the fill and the
    // freedom-paid-amt/freedom-target-amt labels — that's the layout container.
    // Then chips go as a sibling BEFORE that node.
    var node = fill.parentElement;
    var hops = 0;
    while (node && hops < 8) {
      var par = node.parentElement;
      if (!par) break;
      // Does the parent contain the labels too?
      var hasPaid = par.querySelector && par.querySelector('#freedom-paid-amt');
      var hasTarget = par.querySelector && par.querySelector('#freedom-target-amt');
      if (hasPaid && hasTarget) {
        // `node` is a sibling-level child (e.g., the bar wrapper). Insert before it.
        return { parent: par, beforeNode: node };
      }
      node = par;
      hops++;
    }
    // Fallback: insert before fill's direct parent
    if (fill.parentElement && fill.parentElement.parentElement) {
      return { parent: fill.parentElement.parentElement, beforeNode: fill.parentElement };
    }
    return null;
  }

  // === Build a single tab ===
  function buildTab(scenario, isActive) {
    var tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.scenarioKey = scenario.key;
    tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    // Tab style: connected to the bar visually. Active = filled, others = ghost.
    tab.style.cssText = [
      'flex:1', 'min-width:0',
      'padding:9px 12px 11px',
      'background:' + (isActive ? '#1f7a4a' : 'rgba(255,255,255,0.85)'),
      'color:' + (isActive ? '#fff' : '#0a0a0a'),
      'border:1px solid ' + (isActive ? '#1f7a4a' : 'rgba(0,0,0,0.10)'),
      // Bottom border removed for active so it visually merges with bar below
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
    tab.innerHTML = ''
      + '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;color:' + labelColor + ';font-weight:800;line-height:1.1;margin-bottom:2px;">' + scenario.label + '</div>'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:' + dateColor + ';line-height:1.15;">' + (scenario.dateStr || '—') + '</div>'
      + (scenario.months ? '<div style="font-size:10px;color:' + labelColor + ';font-weight:500;margin-top:1px;">' + scenario.months + ' mo' + (scenario.totalInterest != null ? ' · ' + fmtDollars(scenario.totalInterest) + ' int' : '') + '</div>' : '');
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

  // === Main tick ===
  function tick() {
    try {
      if (!window.appState || !window.appState.debts || !window.appState.debts.length) return;

      var insertion = findBarInsertionPoint();
      if (!insertion) return;

      var custom = getCustomExtra();
      var aggressive = computeAggressive(custom);
      var displayCustom = custom > 0 ? custom : Math.max(100, Math.round(aggressive / 2));

      var minSim = simulate(0);
      var customSim = simulate(displayCustom);
      var aggSim = simulate(aggressive);

      var minInt = minSim ? minSim.totalInterest : null;
      function makeS(key, label, extra, sim) {
        var months = sim ? sim.months : null;
        var ti = sim ? sim.totalInterest : null;
        var delta = (ti != null && minInt != null) ? (ti - minInt) : null;
        return { key: key, label: label, extra: extra, months: months, dateStr: months ? fmtDate(months) : null, totalInterest: ti, deltaInterestVsMinimums: delta };
      }
      var scenarios = [
        makeS('minimums', 'Minimums only', 0, minSim),
        makeS('custom', 'Your plan', displayCustom, customSim),
        makeS('aggressive', 'Aggressive', aggressive, aggSim)
      ];

      // Reconcile wrap. If parent or position doesn't match, recreate.
      var wrap = document.getElementById(WRAP_ID);
      var wantsParent = insertion.parent;
      var wantsBefore = insertion.beforeNode;
      var positionMismatch = !wrap
        || wrap.parentElement !== wantsParent
        || wrap.nextSibling !== wantsBefore;
      if (positionMismatch) {
        if (wrap) try { wrap.remove(); } catch (_) {}
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.style.cssText = 'display:flex;gap:6px;width:100%;margin:8px 0 0;font-family:Inter,system-ui,sans-serif;align-items:stretch;';
        wantsParent.insertBefore(wrap, wantsBefore);
      }

      // Render tabs
      var newChildren = [];
      scenarios.forEach(function (s) {
        var isActive = Math.abs(s.extra - custom) < 1;
        newChildren.push(buildTab(s, isActive));
      });
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      newChildren.forEach(function (c) { wrap.appendChild(c); });
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios v4] tick threw', e); } catch (_) {}
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       