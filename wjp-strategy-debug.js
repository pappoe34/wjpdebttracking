/* ============================================================================
   WJP Strategy Debug + Display Fix v2 (surgical, idempotent)
   PROBLEM: When all 3 strategies finish within sub-month rounding (e.g., 37.6
   vs 37.9 vs 38.1), they all integer-round to the same month and look
   identical. But interest differs — sometimes by $800+.

   FIX: Annotate the strategy chips and DFD hero with INTEREST savings vs
   the worst strategy, plus surface a banner when months tie.

   HARDENING:
     - NO MutationObserver
     - Path-guarded to /index.html only
     - Idempotent ID guards on every DOM injection
     - 2.5s settle delay before first run
     - Re-runs ONLY on chip click (passive listener)
     - All wrapped in try/catch
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpStrategyDebugInstalled) return;
  window._wjpStrategyDebugInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch(_) {}

  var BANNER_ID = 'wjp-strategy-info-banner';

  function fmt$(n) {
    if (n == null || isNaN(n)) return '$—';
    n = Math.round(Number(n));
    return '$' + n.toLocaleString();
  }

  function diagnose() {
    try {
      if (typeof window.simulateAllStrategies !== 'function') return null;
      var sim = window.simulateAllStrategies();
      if (!sim || !sim.simulations) return null;

      var sn = sim.simulations.snowball || {};
      var av = sim.simulations.avalanche || {};
      var hy = sim.simulations.hybrid || {};

      var months = { snowball: sn.months || 0, avalanche: av.months || 0, hybrid: hy.months || 0 };
      var interest = { snowball: sn.interest || 0, avalanche: av.interest || 0, hybrid: hy.interest || 0 };

      var allMonths = [months.snowball, months.avalanche, months.hybrid];
      var allInt = [interest.snowball, interest.avalanche, interest.hybrid];
      var spread = Math.max.apply(null, allMonths) - Math.min.apply(null, allMonths);
      var intSpread = Math.max.apply(null, allInt) - Math.min.apply(null, allInt);
      var allCapped = allMonths.every(function(m) { return m >= 360; });

      var result = {
        months: months,
        interest: interest,
        monthsConverged: spread <= 1,
        interestSpread: intSpread,
        worstInterest: Math.max.apply(null, allInt),
        bestInterest: Math.min.apply(null, allInt),
        best: sim.best,
        allCapped: allCapped,
        unpayableIds: sim.unpayableDebtIds
      };
      try { console.log('[wjp-strategy-debug]', result); } catch(_) {}
      return result;
    } catch(e) {
      try { console.warn('[wjp-strategy-debug] diagnose threw', e); } catch(_) {}
      return null;
    }
  }

  function annotateChips(d) {
    try {
      if (!d) return;
      var chips = document.querySelectorAll('#top3-strategy-tabs .chip');
      if (!chips || !chips.length) return;
      // Worst-case strategy = highest interest. Others save money vs that.
      var worst = d.worstInterest;
      chips.forEach(function(chip) {
        try {
          var s = (chip.getAttribute('data-strategy') || '').toLowerCase();
          if (!d.interest[s]) return;
          var savings = worst - d.interest[s];
          // Build/replace badge inside chip
          var badge = chip.querySelector('.wjp-chip-savings');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'wjp-chip-savings';
            badge.style.cssText = 'display:block;font-size:9px;font-weight:600;letter-spacing:0;text-transform:none;margin-top:2px;opacity:0.85;';
            chip.appendChild(badge);
          }
          // Compare against best vs worst to label correctly:
          // - lowest interest → 'lowest cost' (green)
          // - highest interest → 'highest cost' (red)
          // - middle → 'saves $X vs worst' (green)
          var thisInt = d.interest[s];
          if (Math.abs(thisInt - d.bestInterest) < 1) {
            badge.textContent = 'lowest cost';
            badge.style.color = '#1f7a4a';
          } else if (Math.abs(thisInt - d.worstInterest) < 1) {
            badge.textContent = 'highest cost: ' + fmt$(thisInt);
            badge.style.color = '#c0594a';
          } else {
            badge.textContent = 'saves ' + fmt$(d.worstInterest - thisInt) + ' vs worst';
            badge.style.color = '#1f7a4a';
          }
        } catch(_) {}
      });
    } catch(e) {
      try { console.warn('[wjp-strategy-debug] annotate threw', e); } catch(_) {}
    }
  }

  function injectBanner(d) {
    try {
      if (!d) return;
      if (sessionStorage.getItem('wjp.strategyBanner.dismissed') === '1') return;
      if (document.getElementById(BANNER_ID)) return;

      var msg = '', accent = '#1f7a4a';
      if (d.allCapped) {
        accent = '#c0594a';
        msg = '⚠ At your current rate, your debts won\'t fully clear within 30 years. Increase income, cut bills, refinance to lower APR, or add more extra contribution.';
      } else if (d.monthsConverged && d.interestSpread > 50) {
        msg = 'All 3 strategies finish around the same month, but <strong>Avalanche saves you ' + fmt$(d.worstInterest - d.bestInterest) + '</strong> in interest vs Snowball. The chips below show each strategy\'s real cost.';
      } else if (d.monthsConverged) {
        msg = 'All 3 strategies converge on roughly the same outcome — your debts have similar weights so cascade order barely matters. Pick whichever style you prefer.';
      } else {
        return; // strategies diverge naturally; no banner needed
      }

      var host = document.getElementById('top3-strategy-tabs') ||
                 document.getElementById('top3-strategy') ||
                 document.querySelector('[data-strategy-tabs]');
      if (!host) return;

      var b = document.createElement('div');
      b.id = BANNER_ID;
      b.style.cssText = 'background:rgba(31,122,74,0.06);border-left:3px solid ' + accent + ';' +
        'border-radius:0 8px 8px 0;padding:10px 14px;margin:8px 0 12px;font-size:12.5px;' +
        'line-height:1.5;color:var(--text-2,#94a3b8);font-family:inherit;';
      b.innerHTML = msg + ' <button type="button" id="' + BANNER_ID + '-x" ' +
        'style="float:right;background:transparent;border:none;color:inherit;cursor:pointer;' +
        'font-size:14px;line-height:1;padding:0 0 0 12px;opacity:0.6;" aria-label="Dismiss">×</button>';
      try {
        host.parentNode.insertBefore(b, host);
      } catch(_) {
        try { host.appendChild(b); } catch(__) {}
      }
      var x = document.getElementById(BANNER_ID + '-x');
      if (x) x.onclick = function() {
        b.remove();
        try { sessionStorage.setItem('wjp.strategyBanner.dismissed', '1'); } catch(_) {}
      };
    } catch(e) {
      try { console.warn('[wjp-strategy-debug] banner threw', e); } catch(_) {}
    }
  }


  function annotateIndicatorCards(d) {
    try {
      if (!d) return;
      var lists = ['snowball', 'hybrid', 'avalanche'];
      var worst = d.worstInterest;
      lists.forEach(function(strat) {
        try {
          var listEl = document.getElementById(strat + '-list');
          if (!listEl) return;
          // Find the parent indicator card (the inner styled div with grid of 3 stat tiles)
          var card = listEl.querySelector('div[style*="display:grid"]');
          if (!card) return;
          // Already annotated?
          var existing = listEl.querySelector('.wjp-indicator-savings');
          if (existing) existing.remove();

          var thisInt = d.interest[strat];
          if (thisInt == null) return;

          var badge = document.createElement('div');
          badge.className = 'wjp-indicator-savings';
          var savings = worst - thisInt;
          var label, color;
          if (Math.abs(thisInt - d.bestInterest) < 1) {
            label = '✓ LOWEST INTEREST · Best math';
            color = '#1f7a4a';
          } else if (Math.abs(thisInt - d.worstInterest) < 1) {
            label = '⚠ HIGHEST INTEREST · Costs $' + Math.round(thisInt - d.bestInterest).toLocaleString() + ' more than Avalanche';
            color = '#c0594a';
          } else {
            label = '✓ Saves $' + Math.round(savings).toLocaleString() + ' vs Snowball · ' +
                    'Costs $' + Math.round(thisInt - d.bestInterest).toLocaleString() + ' more than Avalanche';
            color = '#c99a2a';
          }
          badge.style.cssText = 'margin-top:8px;padding:7px 10px;background:rgba(' +
            (color === '#1f7a4a' ? '31,122,74' : color === '#c0594a' ? '192,89,74' : '201,154,42') + ',0.10);' +
            'border-left:3px solid ' + color + ';border-radius:0 6px 6px 0;' +
            'font-size:10.5px;font-weight:700;color:' + color + ';line-height:1.4;';
          badge.textContent = label;
          // Insert AFTER the grid row but BEFORE Priority Order header
          card.parentNode.insertBefore(badge, card.nextSibling);
        } catch(_) {}
      });
    } catch(e) {
      try { console.warn('[wjp-strategy-debug] annotateIndicatorCards threw', e); } catch(_) {}
    }
  }


  function annotateDfdHero(d) {
    try {
      if (!d) return;
      var meta = document.getElementById('dfd-meta');
      if (!meta) return;
      // Determine which strategy is currently active by reading the hero's text
      var t = (meta.textContent || '').toLowerCase();
      var activeStrat = null;
      if (t.indexOf('avalanche') !== -1) activeStrat = 'avalanche';
      else if (t.indexOf('snowball') !== -1) activeStrat = 'snowball';
      else if (t.indexOf('hybrid') !== -1) activeStrat = 'hybrid';
      if (!activeStrat) return;

      var thisInt = d.interest[activeStrat];
      if (thisInt == null) return;

      // Find existing annotation and remove it (idempotent)
      var existing = meta.parentNode.querySelector('.wjp-dfd-savings');
      if (existing) existing.remove();

      // Build savings note
      var note = document.createElement('div');
      note.className = 'wjp-dfd-savings';

      var savingsVsSnowball = (d.interest.snowball || 0) - thisInt;
      var costMore = thisInt - d.bestInterest;

      var label, color;
      if (Math.abs(thisInt - d.bestInterest) < 1) {
        label = '✓ Optimal strategy — saves $' + Math.round(d.interest.snowball - thisInt).toLocaleString() + ' vs Snowball';
        color = '#1f7a4a';
      } else if (Math.abs(thisInt - d.worstInterest) < 1) {
        label = '⚠ Costs $' + Math.round(costMore).toLocaleString() + ' more in interest than Avalanche — switch to save';
        color = '#c0594a';
      } else {
        label = '✓ Saves $' + Math.round(savingsVsSnowball).toLocaleString() + ' vs Snowball — but Avalanche saves $' + Math.round(costMore).toLocaleString() + ' more';
        color = '#c99a2a';
      }
      var rgb = color === '#1f7a4a' ? '31,122,74' : color === '#c0594a' ? '192,89,74' : '201,154,42';
      note.style.cssText = 'margin-top:10px;padding:8px 12px;background:rgba(' + rgb + ',0.08);' +
        'border-left:3px solid ' + color + ';border-radius:0 6px 6px 0;' +
        'font-size:12px;font-weight:700;color:' + color + ';display:inline-block;';
      note.textContent = label;
      meta.parentNode.insertBefore(note, meta.nextSibling);
    } catch(e) {
      try { console.warn('[wjp-strategy-debug] annotateDfdHero threw', e); } catch(_) {}
    }
  }

  function run() {
    var d = diagnose();
    if (d) {
      annotateChips(d);
      annotateIndicatorCards(d);
      annotateDfdHero(d);
      injectBanner(d);
    }
  }

  function fixHashRoute() {
    try {
      var h = (location.hash || '').toLowerCase();
      var came = sessionStorage.getItem('wjp.lastNavSource') || '';
      if ((h === '#settings' || h.indexOf('#settings/') === 0) && came !== 'click') {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch(_) {}
  }

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

  function start() {
    fixHashRoute();
    setTimeout(run, 2500);
    // Re-annotate when user clicks a chip
    document.addEventListener('click', function(e) {
      try {
        var t = e.target;
        while (t && t !== document.body) {
          if (t.classList && t.classList.contains('chip') && t.getAttribute('data-strategy')) {
            setTimeout(run, 700);
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

  window.WJP_StrategyDebug = { run: run, diagnose: diagnose, annotateChips: annotateChips };
})();
