/* ============================================================================
   WJP Strategy Debug + Display Fix (single-purpose, surgical)
   - Logs full strategy diagnostic to console on app load (so I can see WHY
     all 3 strategies converge for the user's actual data).
   - When all 3 strategies have the SAME months value (within 1 month), inject
     a small banner above the strategy chips explaining the convergence so the
     user understands they're not seeing a bug.
   - When all 3 strategies hit the 600/360 cap (debt won't pay off at current
     rate), surface a clearer warning.
   - On a fresh load with no meaningful state, normalize hash off "#settings"
     so the user lands on the dashboard.

   HARDENING (lessons from prior modules):
     - NO MutationObserver
     - NO auto-DOM mutation except a single banner injection (idempotent guard)
     - Runs once, 2 seconds after DOMContentLoaded so app has fully rendered
     - All operations wrapped in try/catch — never throws
     - No event dispatching (won't trigger app code we don't own)
     - NEVER touches /signup, /intro, /admin — only /index.html
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpStrategyDebugInstalled) return;
  window._wjpStrategyDebugInstalled = true;

  // Path guard — only run on the app shell, not marketing pages or admin
  try {
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('/index') === -1 && path !== '/' && path !== '') return;
    // Marketing pages live at root paths like /intro.html, /signup.html — those
    // never load app.js so they shouldn't reach this module either.
  } catch(_) {}

  var BANNER_ID = 'wjp-strategy-convergence-banner';
  var WARNING_ID = 'wjp-strategy-cap-warning';

  function log(msg, payload) {
    try { console.log('[wjp-strategy-debug] ' + msg, payload != null ? payload : ''); } catch(_) {}
  }

  function getDebts() {
    try { return (window.appState && window.appState.debts) || []; } catch(_) { return []; }
  }

  function diagnose() {
    var debts = getDebts();
    if (!debts.length) { log('no debts — skipping'); return null; }
    if (typeof window.simulateAllStrategies !== 'function') {
      log('simulateAllStrategies not available yet');
      return null;
    }
    if (typeof window.sortDebtsByStrategy !== 'function') {
      log('sortDebtsByStrategy not available yet');
      return null;
    }

    var sim;
    try { sim = window.simulateAllStrategies(); } catch(e) { log('simulate threw:', e); return null; }
    if (!sim || !sim.simulations) { log('sim returned null'); return null; }

    var sn = sim.simulations.snowball || {};
    var av = sim.simulations.avalanche || {};
    var hy = sim.simulations.hybrid || {};

    var snOrder = window.sortDebtsByStrategy(debts, 'snowball').map(function(d){ return d.name; });
    var avOrder = window.sortDebtsByStrategy(debts, 'avalanche').map(function(d){ return d.name; });
    var hyOrder = window.sortDebtsByStrategy(debts, 'hybrid').map(function(d){ return d.name; });

    var sameOrder = JSON.stringify(snOrder) === JSON.stringify(avOrder) &&
                    JSON.stringify(avOrder) === JSON.stringify(hyOrder);

    var monthsArr = [sn.months || 0, av.months || 0, hy.months || 0];
    var spread = Math.max.apply(null, monthsArr) - Math.min.apply(null, monthsArr);
    var allCapped = monthsArr.every(function(m) { return m >= 360; });
    var converged = spread <= 1 && monthsArr[0] > 0;

    var extraInfo = {};
    try {
      if (typeof window.getEffectiveExtraContribution === 'function') {
        extraInfo = window.getEffectiveExtraContribution();
      }
    } catch(_) {}

    var diagnosis = {
      debtCount: debts.length,
      debts: debts.map(function(d) { return { name: d.name, balance: d.balance, apr: d.apr, min: d.minPayment }; }),
      extra: extraInfo,
      orders: { snowball: snOrder, avalanche: avOrder, hybrid: hyOrder },
      sameOrder: sameOrder,
      months: { snowball: sn.months, avalanche: av.months, hybrid: hy.months },
      interest: { snowball: sn.interest, avalanche: av.interest, hybrid: hy.interest },
      monthsSpread: spread,
      converged: converged,
      allCapped: allCapped,
      best: sim.best,
      unpayableDebtIds: sim.unpayableDebtIds
    };

    log('FULL DIAGNOSTIC:', diagnosis);

    if (allCapped) {
      log('ALL 3 strategies are at the 360+ month cap — debt minimums cannot outpace interest. This is why all dates look identical.');
    } else if (converged && sameOrder) {
      log('Strategies converge because all 3 picked the same priority order. This happens when one debt strongly dominates by every metric (smallest balance + highest APR + best APR/balance ratio).');
    } else if (converged && !sameOrder) {
      log('WARNING — orders differ but final months are identical. May indicate cascade-flow issue or extra=$0 (no strategy can actually accelerate).');
    } else {
      log('Strategies diverge correctly. Spread of ' + spread + ' months.');
    }

    return diagnosis;
  }

  function findStrategyTabsHost() {
    return document.getElementById('top3-strategy-tabs') ||
           document.querySelector('[data-strategy-tabs]') ||
           document.getElementById('top3-strategy');
  }

  function injectConvergenceBanner(diagnosis) {
    if (!diagnosis) return;
    if (document.getElementById(BANNER_ID)) return; // idempotent
    var host = findStrategyTabsHost();
    if (!host) return;

    var msg, accent;
    if (diagnosis.allCapped) {
      accent = '#c0594a';
      msg = '⚠ At your current minimums + extra contribution, your debts won\'t fully clear within 30 years. Increase income, cut bills, refinance to lower APR, or add an extra contribution to see strategies diverge.';
    } else if (diagnosis.converged) {
      var extraVal = (diagnosis.extra && diagnosis.extra.extra) || 0;
      if (extraVal === 0) {
        accent = '#c99a2a';
        msg = 'All 3 strategies show the same date because you have <strong>$0 extra contribution</strong>. With minimums-only, the math is identical regardless of strategy. Set an extra contribution in Budget to see Snowball / Avalanche / Hybrid produce different dates.';
      } else if (diagnosis.debtCount === 1) {
        accent = '#1f7a4a';
        msg = 'Only one debt active — strategy ordering doesn\'t matter when there\'s nothing to cascade to. Add another debt or finish this one to see strategies diverge.';
      } else if (diagnosis.sameOrder) {
        accent = '#1f7a4a';
        msg = 'Your debts converge: all 3 strategies pick the same priority order. This usually means one debt is the clear winner by every metric (smallest balance AND highest APR). The math agrees — pay it first regardless of strategy.';
      } else {
        accent = '#c99a2a';
        msg = 'Strategies show the same date but different priority orders. This is unusual — check the console (F12) for the [wjp-strategy-debug] log and share it with me to investigate.';
      }
    } else {
      return; // strategies diverge correctly — no banner needed
    }

    var banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = 'background:rgba(31,122,74,0.04);border-left:3px solid ' + accent + ';' +
      'border-radius:0 8px 8px 0;padding:11px 14px;margin:10px 0 14px;font-size:12.5px;' +
      'line-height:1.5;color:var(--text-2,#94a3b8);font-family:inherit;';
    banner.innerHTML = msg + ' <button type="button" id="' + BANNER_ID + '-x" ' +
      'style="float:right;background:transparent;border:none;color:inherit;cursor:pointer;' +
      'font-size:14px;line-height:1;padding:0 0 0 12px;opacity:0.6;" aria-label="Dismiss">×</button>';

    try {
      host.parentNode.insertBefore(banner, host);
    } catch(_) {
      try { host.appendChild(banner); } catch(__) {}
    }
    var x = document.getElementById(BANNER_ID + '-x');
    if (x) x.onclick = function() {
      banner.remove();
      try { sessionStorage.setItem('wjp.strategyBanner.dismissed', '1'); } catch(_) {}
    };
  }

  function fixHashRoute() {
    // If user lands on the app with a stale '#settings' or '#settings/...' hash
    // BUT they didn't explicitly click a settings link this session, normalize
    // back to dashboard.
    try {
      var h = (location.hash || '').toLowerCase();
      var came = sessionStorage.getItem('wjp.lastNavSource') || '';
      if ((h === '#settings' || h.indexOf('#settings/') === 0) && came !== 'click') {
        log('clearing stale #settings hash on initial load');
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch(_) {}
  }

  // Track explicit nav clicks so we DON'T strip the hash on actual navigation
  document.addEventListener('click', function(e) {
    try {
      var t = e.target;
      while (t && t !== document.body) {
        if (t.tagName === 'A' && t.getAttribute('href') && t.getAttribute('href').indexOf('#settings') === 0) {
          sessionStorage.setItem('wjp.lastNavSource', 'click');
          return;
        }
        t = t.parentNode;
      }
    } catch(_) {}
  }, true);

  function run() {
    if (sessionStorage.getItem('wjp.strategyBanner.dismissed') === '1') {
      // Still log for diagnostics, just skip banner injection
      diagnose();
      return;
    }
    var diagnosis = diagnose();
    if (diagnosis && (diagnosis.converged || diagnosis.allCapped)) {
      injectConvergenceBanner(diagnosis);
    }
  }

  // Wait for app to fully render before diagnosing
  function start() {
    fixHashRoute();
    setTimeout(run, 2500);
    // Also re-run when user clicks a strategy chip — diagnostic will log
    // freshly so we can see if their click changed anything
    document.addEventListener('click', function(e) {
      try {
        var t = e.target;
        while (t && t !== document.body) {
          if (t.classList && t.classList.contains('chip') &&
              t.getAttribute('data-strategy')) {
            setTimeout(run, 600);
            return;
          }
          t = t.parentNode;
        }
      } catch(_) {}
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_StrategyDebug = { run: run, diagnose: diagnose };
})();
