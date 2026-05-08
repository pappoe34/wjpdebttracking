/* wjp-progress-scenarios.js — 3 clickable scenario chips on the progress bar.
 *
 * Shows debt-free dates side-by-side for:
 *   1. MINIMUMS — extra = 0 (worst case, baseline)
 *   2. CUSTOM   — user's currently-configured extra contribution
 *   3. AGGRESSIVE — max(custom * 2, available cashflow surplus, $500)
 *
 * Click a chip to apply that scenario as the active extra-payment setting
 * (defers to wjp-extra-toggle which already wraps getEffectiveExtraContribution
 * and triggers updateUI). Selected state is derived from the current extra
 * value — no separate "scenario" state.
 *
 * Hardened: IIFE, idempotent, path-guarded to /index.html, no MutationObservers,
 * polled every 2s for re-injection (handles SPA re-renders), try/catch wrapped.
 */
(function () {
  'use strict';
  if (window._wjpProgressScenariosInstalled) return;
  window._wjpProgressScenariosInstalled = true;

  // Path guard
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var DAY_MS = 24 * 60 * 60 * 1000;

  // === Math: simulate debt-free date for a given extra ===
  function simulate(extra) {
    try {
      if (!window.appState || !window.appState.debts || !window.appState.debts.length) return null;
      // Deep-clone debts so calculateDebtPayoff mutations don't touch live state
      var debts = window.appState.debts.map(function (d) { return Object.assign({}, d); });
      var strategy = (window.appState.settings && window.appState.settings.strategy) || 'avalanche';
      // Prefer the canonical exposed simulator
      if (typeof window.calculateDebtPayoff === 'function') {
        var r = window.calculateDebtPayoff(debts, Number(extra) || 0, strategy);
        // calculateDebtPayoff signature varies — handle both shapes
        if (r && typeof r === 'object') {
          var months = r.months || r.totalMonths || r.monthsFractional || null;
          var totalInterest = r.totalInterest || r.interestPaid || null;
          if (months && months > 0 && months < 1200) {
            return { months: Math.ceil(months), monthsFractional: r.monthsFractional || months, totalInterest: totalInterest };
          }
        }
      }
      // Fallback: simulateAllStrategies returns per-strategy stats
      if (typeof window.simulateAllStrategies === 'function') {
        var all = window.simulateAllStrategies(debts, Number(extra) || 0);
        var pick = all && all[strategy];
        if (pick && pick.months > 0) {
          return { months: Math.ceil(pick.months), monthsFractional: pick.months, totalInterest: pick.totalInterest };
        }
      }
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios] simulate threw', e); } catch (_) {}
    }
    return null;
  }

  function fmtDate(monthsAhead) {
    if (!monthsAhead || monthsAhead <= 0) return '—';
    if (monthsAhead > 600) return '50+ years';
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

  // === Read user's currently configured extra ===
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
    // Max of: 2x custom, surplus cash flow, $500
    var doubled = (Number(custom) || 0) * 2;
    var surplus = getAvailableCashflow();
    var floor = 500;
    return Math.max(doubled, surplus, floor);
  }

  // === Build chip row ===
  function buildChips(scenarios, currentExtra) {
    var wrap = document.createElement('div');
    wrap.id = 'wjp-ps-chips';
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:14px auto 6px;font-family:Inter,system-ui,sans-serif;max-width:760px;';

    scenarios.forEach(function (s) {
      var isActive = Math.abs(s.extra - currentExtra) < 1; // within $1
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.scenarioKey = s.key;
      chip.dataset.scenarioExtra = String(s.extra);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      chip.style.cssText = [
        'flex:1', 'min-width:120px', 'max-width:240px',
        'padding:10px 14px',
        'background:' + (isActive ? '#f6fbf8' : 'rgba(255,255,255,0.92)'),
        'border:1.5px solid ' + (isActive ? 'var(--accent,#1f7a4a)' : 'var(--border,rgba(0,0,0,0.10))'),
        'border-radius:14px',
        'cursor:pointer',
        'text-align:left',
        'transition:transform .12s, border-color .15s, background .15s, box-shadow .15s',
        'font-family:inherit',
        'box-shadow:' + (isActive ? '0 0 0 3px rgba(31,122,74,0.10)' : '0 1px 3px rgba(0,0,0,0.04)')
      ].join(';');

      // Header row: name + selected check
      var headerHtml = ''
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">'
        +   '<span style="font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;color:' + (isActive ? 'var(--accent,#1f7a4a)' : 'var(--ink-faint,#9ca3af)') + ';font-weight:800;">' + s.label + '</span>'
        +   (isActive ? '<span style="color:var(--accent,#1f7a4a);font-size:13px;font-weight:800;">✓</span>' : '<span style="color:var(--ink-faint,#9ca3af);font-size:11px;">$' + Math.round(s.extra) + '/mo</span>')
        + '</div>';

      // Big date
      var dateHtml = ''
        + '<div style="font-family:Fraunces,Georgia,serif;font-size:18px;font-weight:600;letter-spacing:-0.01em;color:var(--ink,#0a0a0a);line-height:1.1;margin-bottom:3px;">'
        +   (s.dateStr || 'No data')
        + '</div>';

      // Sub: months + interest delta
      var subParts = [];
      if (s.months) subParts.push(s.months + ' mo');
      if (s.totalInterest && isFinite(s.totalInterest)) subParts.push(fmtDollars(s.totalInterest) + ' interest');
      var subHtml = ''
        + '<div style="font-size:11px;color:var(--ink-dim,#6b7280);font-weight:500;line-height:1.3;">'
        +   subParts.join(' &middot; ')
        + '</div>';

      // Optional savings vs minimums delta
      var deltaHtml = '';
      if (s.deltaInterestVsMinimums != null && Math.abs(s.deltaInterestVsMinimums) > 50) {
        var saves = s.deltaInterestVsMinimums < 0;
        deltaHtml = ''
          + '<div style="font-size:10.5px;font-weight:700;letter-spacing:0.02em;color:' + (saves ? 'var(--accent,#1f7a4a)' : 'var(--ink-faint,#9ca3af)') + ';margin-top:4px;">'
          +   (saves ? '−' : '+') + fmtDollars(s.deltaInterestVsMinimums) + ' vs minimums'
          + '</div>';
      }

      chip.innerHTML = headerHtml + dateHtml + subHtml + deltaHtml;

      chip.addEventListener('mouseenter', function () {
        if (!isActive) {
          chip.style.borderColor = 'rgba(31,122,74,0.32)';
          chip.style.transform = 'translateY(-1px)';
        }
      });
      chip.addEventListener('mouseleave', function () {
        if (!isActive) {
          chip.style.borderColor = 'var(--border,rgba(0,0,0,0.10))';
          chip.style.transform = 'translateY(0)';
        }
      });
      chip.addEventListener('click', function () { onChipClick(s); });
      wrap.appendChild(chip);
    });

    return wrap;
  }

  // === Click handler: apply scenario's extra ===
  function onChipClick(s) {
    try {
      // Persist to extra-toggle config so the rest of the app picks it up
      var key = 'wjp.extraToggle.config';
      var cfg = { enabled: s.extra > 0, mode: 'manual', amount: Math.round(s.extra) };
      // Minimums-only = enabled false (force 0)
      if (s.key === 'minimums') {
        cfg = { enabled: false, mode: 'manual', amount: 0 };
      }
      try { localStorage.setItem(key, JSON.stringify(cfg)); } catch (_) {}

      // Re-render via existing app hooks
      try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (_) {}
      // Refresh chips after re-render so the active state updates
      setTimeout(injectChips, 200);
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios] click failed', e); } catch (_) {}
    }
  }

  // === Find injection point ===
  function findInjectionAnchor() {
    // Prefer the freedom-fill bar's parent so chips appear with the bar
    var bar = document.getElementById('freedom-progress-fill') || document.getElementById('freedom-fill') || document.querySelector('[id*="freedom-progress"], .summary-progress');
    if (bar) {
      // Walk up to the section that also contains freedom-paid-amt and freedom-target-amt
      // (this is the Executive Summary block). Fallback to bar's grand-parent.
      var anchor = bar.parentElement;
      var maxDepth = 6;
      while (anchor && maxDepth-- > 0) {
        if (anchor.querySelector('#freedom-paid-amt') && anchor.querySelector('#freedom-target-amt')) {
          return anchor;
        }
        anchor = anchor.parentElement;
      }
      return bar.parentElement && bar.parentElement.parentElement;
    }
    // Fallback: the executive summary section
    return document.getElementById('exec-summary') || document.querySelector('[class*="exec-summary"], .executive-summary');
  }

  // === Build & inject chips ===
  function injectChips() {
    try {
      if (!window.appState || !window.appState.debts || !window.appState.debts.length) return;

      var custom = getCustomExtra();
      var aggressive = computeAggressive(custom);
      var current = custom; // currently active extra is whatever the toggle returns

      // Avoid degenerate 'custom' === 'minimums' case (custom=0). In that case
      // we still want a visible "custom" chip; just make it equal to aggressive/2
      // so the user sees a meaningful middle option.
      if (custom <= 0) {
        custom = Math.max(100, Math.round(aggressive / 2));
      }

      var minSim = simulate(0);
      var customSim = simulate(custom);
      var aggSim = simulate(aggressive);

      var minInterest = minSim ? minSim.totalInterest : null;
      function makeScenario(key, label, extra, sim) {
        var months = sim ? sim.months : null;
        var totalInterest = sim ? sim.totalInterest : null;
        var delta = (totalInterest != null && minInterest != null) ? (totalInterest - minInterest) : null;
        return {
          key: key,
          label: label,
          extra: extra,
          months: months,
          dateStr: months ? fmtDate(months) : null,
          totalInterest: totalInterest,
          deltaInterestVsMinimums: delta
        };
      }

      var scenarios = [
        makeScenario('minimums',   'Minimums only',  0,          minSim),
        makeScenario('custom',     'Your plan',      custom,     customSim),
        makeScenario('aggressive', 'Aggressive',     aggressive, aggSim)
      ];

      var existing = document.getElementById('wjp-ps-chips');
      var fresh = buildChips(scenarios, current);

      if (existing) {
        existing.replaceWith(fresh);
        return;
      }
      var anchor = findInjectionAnchor();
      if (!anchor) return;
      // Inject AFTER the bar so chips sit just below it
      anchor.appendChild(fresh);
    } catch (e) {
      try { console.warn('[wjp-progress-scenarios] inject threw', e); } catch (_) {}
    }
  }

  // === Boot ===
  function boot() {
    var attempts = 0;
    function tryBoot() {
      attempts++;
      if (window.appState && (window.appState.debts || []).length > 0) {
        injectChips();
        // Polled re-render — debounced so it doesn't fight other modules
        setInterval(injectChips, 2500);
        return;
      }
      if (attempts < 30) setTimeout(tryBoot, 1000);
    }
    tryBoot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  } else {
    setTimeout(boot, 1500);
  }

  window.WJP_ProgressScenarios = {
    refresh: injectChips,
    simulate: simulate
  };
})();
