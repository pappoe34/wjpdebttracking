/* wjp-hybrid-picker.js — User-selectable Hybrid strategy algorithm.
 *
 * Replaces wjp-hybrid-fix.js. Lets users pick HOW Hybrid sorts debts:
 *   1. interest_bleed   (default)  balance × APR DESC          — saves most $/mo
 *   2. cfi                          balance ÷ minPayment ASC    — frees cash flow fastest
 *   3. debt_blaster                balance ASC                 — snowball framing, momentum
 *   4. utilization                  balance ÷ creditLimit DESC  — fastest credit-score lift
 *   5. highest_apr                  APR DESC                    — pure avalanche
 *   6. smallest_balance             balance ASC                 — pure snowball
 *
 * Two surfaces:
 *   - ⚙ icon popover on Strategy tab Hybrid indicator card (in-context)
 *   - Settings panel card (canonical)
 *
 * Hardened pattern:
 *   - IIFE, idempotent, path-guarded to /index.html
 *   - NO MutationObservers — DOMContentLoaded boot + 2s polling for SPA mounts
 *   - try/catch wrapped at every entry; module never throws
 *   - Patches window.sortDebtsByStrategy via wrapper (works alongside or instead of wjp-hybrid-fix.js)
 *
 * Public API:
 *   window.WJP_HybridPicker.getAlgorithm()   // current key
 *   window.WJP_HybridPicker.setAlgorithm(k)  // change + re-render
 *   window.WJP_HybridPicker.openPopover()    // open in-context picker
 */
(function () {
  'use strict';
  if (window._wjpHybridPickerInstalled) return;
  window._wjpHybridPickerInstalled = true;

  // Path guard — dashboard only
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var LS_KEY = 'wjp.hybrid.algorithm';
  var DEFAULT_ALGO = 'interest_bleed';

  // === Algorithm registry ===
  var ALGORITHMS = {
    interest_bleed: {
      label: 'Highest interest bleed',
      tag: 'Default',
      bestFor: 'Saves the most dollars per month — pays off the card costing you the most each cycle first.',
      formula: 'balance × APR (descending)',
      sort: function (list) {
        return list.slice().sort(function (a, b) {
          var aS = (Number(a.balance) || 0) * (Number(a.apr) || 0);
          var bS = (Number(b.balance) || 0) * (Number(b.apr) || 0);
          var d = bS - aS;
          if (Math.abs(d) > 0.01) return d;
          return (Number(b.apr) || 0) - (Number(a.apr) || 0);
        });
      }
    },
    cfi: {
      label: 'Cash Flow Index (CFI)',
      tag: 'Frees cash fastest',
      bestFor: 'Ends the smallest payment-per-balance ratio first — frees up monthly cash flow soonest.',
      formula: 'balance ÷ minimum payment (ascending)',
      sort: function (list) {
        return list.slice().sort(function (a, b) {
          var aMin = Number(a.minPayment || a.min_payment || a.minimumPayment) || 0;
          var bMin = Number(b.minPayment || b.min_payment || b.minimumPayment) || 0;
          // Avoid div-by-zero — push min=0 debts to the end
          var aCfi = aMin > 0 ? (Number(a.balance) || 0) / aMin : Infinity;
          var bCfi = bMin > 0 ? (Number(b.balance) || 0) / bMin : Infinity;
          var d = aCfi - bCfi;
          if (Math.abs(d) > 0.01) return d;
          return (Number(b.apr) || 0) - (Number(a.apr) || 0);
        });
      }
    },
    debt_blaster: {
      label: 'Debt Blaster (auto-escalation)',
      tag: 'Quick wins, momentum',
      bestFor: 'Smallest balance first. As each debt finishes, the freed minimum payment automatically stacks onto the next target.',
      formula: 'balance (ascending) + payment cascade',
      sort: function (list) {
        return list.slice().sort(function (a, b) {
          var aB = Number(a.balance) || 0;
          var bB = Number(b.balance) || 0;
          var d = aB - bB;
          if (Math.abs(d) > 0.01) return d;
          return (Number(b.apr) || 0) - (Number(a.apr) || 0);
        });
      }
    },
    utilization: {
      label: 'Highest credit utilization',
      tag: 'Best for credit score',
      bestFor: 'Pays down cards closest to their credit limit first — biggest credit-score lift the fastest. Cards without a credit limit drop to the bottom.',
      formula: 'balance ÷ credit limit (descending)',
      sort: function (list) {
        return list.slice().sort(function (a, b) {
          var aLim = Number(a.creditLimit || a.credit_limit || a.limit) || 0;
          var bLim = Number(b.creditLimit || b.credit_limit || b.limit) || 0;
          var aU = aLim > 0 ? (Number(a.balance) || 0) / aLim : -1; // -1 sinks no-limit to bottom
          var bU = bLim > 0 ? (Number(b.balance) || 0) / bLim : -1;
          var d = bU - aU; // descending
          if (Math.abs(d) > 0.0001) return d;
          return (Number(b.apr) || 0) - (Number(a.apr) || 0);
        });
      }
    },
    highest_apr: {
      label: 'Highest APR (avalanche)',
      tag: 'Math-optimal',
      bestFor: 'Pure avalanche — pays off the highest interest-rate debt first regardless of balance. Mathematically optimal for total interest paid.',
      formula: 'APR (descending)',
      sort: function (list) {
        return list.slice().sort(function (a, b) {
          var d = (Number(b.apr) || 0) - (Number(a.apr) || 0);
          if (Math.abs(d) > 0.001) return d;
          return (Number(b.balance) || 0) - (Number(a.balance) || 0);
        });
      }
    },
    smallest_balance: {
      label: 'Smallest balance (snowball)',
      tag: 'Emotional wins',
      bestFor: 'Pure snowball — smallest balance first regardless of APR. Best for users who need momentum more than math.',
      formula: 'balance (ascending)',
      sort: function (list) {
        return list.slice().sort(function (a, b) {
          var d = (Number(a.balance) || 0) - (Number(b.balance) || 0);
          if (Math.abs(d) > 0.01) return d;
          return (Number(b.apr) || 0) - (Number(a.apr) || 0);
        });
      }
    }
  };

  // Indicator-card copy per algorithm (overrides app.js stratMeta.hybrid.why/.benefit)
  var COPY = {
    interest_bleed: {
      subhead: 'Highest interest dollars first',
      why: 'Attacks the biggest monthly interest dollars first \u2014 combines balance and APR into one number (balance \u00d7 APR) and pays them off top-to-bottom in that order. A $10K loan at 18% ($150/mo bleed) ranks ahead of a $500 card at 30% ($13/mo bleed) because it\u2019s costing you more every month.',
      bestFor: 'Best for: A balanced approach when you want both speed and savings.'
    },
    cfi: {
      subhead: 'Cash Flow Index (CFI)',
      why: 'Sorts by balance \u00f7 minimum payment ascending. The lower the ratio, the faster that debt clears at its current minimum \u2014 so paying it off frees up monthly cash flow soonest. Each finished debt rolls its freed-up minimum onto the next.',
      bestFor: 'Best for: Tight cash flow. Frees breathing room each month, fastest.'
    },
    debt_blaster: {
      subhead: 'Debt Blaster (auto-escalation)',
      why: 'Smallest balance first \u2014 like Snowball. As each debt finishes, the freed minimum payment is automatically stacked onto the next target, accelerating payoff like a blaster gaining charge. Pure momentum mechanics.',
      bestFor: 'Best for: Quick wins and visible progress. Best when motivation matters more than math.'
    },
    utilization: {
      subhead: 'Highest credit utilization',
      why: 'Pays down the cards closest to (or over) their credit limit first. Credit utilization above 30% drags your credit score the most; above 80% it tanks. Knocking those down first is the fastest credit-score lift you can buy. Cards with no credit limit drop to the bottom.',
      bestFor: 'Best for: Recovering credit score fast \u2014 mortgage, auto loan, or new card application coming up.'
    },
    highest_apr: {
      subhead: 'Highest APR (avalanche)',
      why: 'Pure Avalanche \u2014 highest interest-rate debt first regardless of balance. Mathematically optimal for total interest paid: every $1 against a 30% card saves $0.30/year forever, the same $1 against an 18% loan only saves $0.18/year.',
      bestFor: 'Best for: Lowest total interest paid. Provably optimal \u2014 no other strategy beats it on math.'
    },
    smallest_balance: {
      subhead: 'Smallest balance (snowball)',
      why: 'Pure Snowball \u2014 smallest balance first regardless of APR. You eliminate accounts fastest, which builds momentum. Mathematically not optimal, but emotionally undefeated: the dopamine hit of zeroing an account beats a slightly lower interest bill.',
      bestFor: 'Best for: Staying motivated. Fastest to eliminate individual accounts.'
    }
  };

  function getAlgorithm() {
    try {
      var v = localStorage.getItem(LS_KEY);
      if (v && ALGORITHMS[v]) return v;
    } catch (_) {}
    return DEFAULT_ALGO;
  }

  function setAlgorithm(key) {
    if (!ALGORITHMS[key]) return false;
    try { localStorage.setItem(LS_KEY, key); } catch (_) {}
    // Trigger re-render
    try {
      if (typeof window.updateUI === 'function') setTimeout(window.updateUI, 50);
    } catch (_) {}
    // Refresh any open UIs
    setTimeout(refreshAllSurfaces, 100);
    return true;
  }

  // === Patch window.sortDebtsByStrategy ===
  var origSort = null;
  function installSortPatch() {
    if (typeof window.sortDebtsByStrategy !== 'function') {
      setTimeout(installSortPatch, 200);
      return;
    }
    if (origSort && window.sortDebtsByStrategy._wjpHybridPicker) return; // already patched

    // If hybrid-fix already patched, layer on top of it. We re-grab origSort
    // each call so the chain works.
    if (!origSort) origSort = window.sortDebtsByStrategy;

    var wrapper = function (debts, strategy) {
      try {
        if (strategy === 'hybrid') {
          var algo = ALGORITHMS[getAlgorithm()] || ALGORITHMS[DEFAULT_ALGO];
          return algo.sort(debts || []);
        }
        return origSort.call(this, debts, strategy);
      } catch (e) {
        try { console.warn('[wjp-hybrid-picker] sort threw', e); } catch (_) {}
        return origSort.call(this, debts, strategy);
      }
    };
    wrapper._wjpHybridPicker = true;
    window.sortDebtsByStrategy = wrapper;
    try { console.log('[wjp-hybrid-picker] patched sortDebtsByStrategy with 6 hybrid algorithms'); } catch (_) {}
    try { if (typeof window.updateUI === 'function') setTimeout(window.updateUI, 100); } catch (_) {}
  }

  // === Popover modal ===
  function buildPopover() {
    var current = getAlgorithm();
    var overlay = document.createElement('div');
    overlay.id = 'wjp-hybrid-picker-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99996;background:rgba(10,10,10,0.55);display:flex;align-items:center;justify-content:center;padding:20px;animation:wjpHpFade .2s ease-out';

    var card = document.createElement('div');
    card.style.cssText = 'background:var(--card,#fff);color:var(--ink,#0a0a0a);border-radius:18px;max-width:560px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 24px 80px rgba(0,0,0,0.30);border:1px solid var(--border,rgba(0,0,0,0.08));font-family:Inter,system-ui,sans-serif';

    var html = ''
      + '<div style="padding:24px 28px 14px;border-bottom:1px solid var(--border,rgba(0,0,0,0.06));">'
      +   '<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c99a2a;font-weight:800;margin-bottom:8px;">Hybrid algorithm</div>'
      +   '<h2 style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;line-height:1.2;">How should Hybrid order your debts?</h2>'
      +   '<p style="font-size:14px;color:var(--ink-dim,#6b7280);line-height:1.55;margin:0;">Each option uses a different rule for the order. Pick what matters most for your situation.</p>'
      + '</div>'
      + '<div id="wjp-hp-options" style="padding:14px 18px 8px;">';

    Object.keys(ALGORITHMS).forEach(function (key) {
      var a = ALGORITHMS[key];
      var sel = key === current;
      html += ''
        + '<label data-key="' + key + '" style="display:block;padding:14px 14px;margin:6px 0;border-radius:12px;cursor:pointer;border:1.5px solid ' + (sel ? 'var(--accent,#1f7a4a)' : 'var(--border,rgba(0,0,0,0.10))') + ';background:' + (sel ? '#f6fbf8' : '#fff') + ';transition:border-color .15s, background .15s;">'
        +   '<div style="display:flex;align-items:flex-start;gap:12px;">'
        +     '<input type="radio" name="wjp-hp-algo" value="' + key + '"' + (sel ? ' checked' : '') + ' style="margin-top:3px;accent-color:#1f7a4a;flex-shrink:0;">'
        +     '<div style="flex:1;min-width:0;">'
        +       '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">'
        +         '<span style="font-weight:700;font-size:14.5px;color:var(--ink,#0a0a0a);">' + a.label + '</span>'
        +         (a.tag ? '<span style="font-size:10.5px;letter-spacing:0.05em;background:rgba(31,122,74,0.10);color:var(--accent,#1f7a4a);padding:2px 8px;border-radius:999px;font-weight:700;">' + a.tag + '</span>' : '')
        +       '</div>'
        +       '<div style="font-size:13px;color:var(--ink-dim,#6b7280);line-height:1.5;margin-bottom:6px;">' + a.bestFor + '</div>'
        +       '<div style="font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;color:var(--ink-faint,#9ca3af);">' + a.formula + '</div>'
        +     '</div>'
        +   '</div>'
        + '</label>';
    });

    html += '</div>'
      + '<div style="padding:14px 28px 22px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--border,rgba(0,0,0,0.06));margin-top:6px;">'
      +   '<button id="wjp-hp-cancel" type="button" style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.18));color:var(--ink-dim,#6b7280);padding:10px 18px;border-radius:999px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
      +   '<button id="wjp-hp-save" type="button" style="background:#1f7a4a;color:#fff;border:none;padding:11px 24px;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(31,122,74,0.30);">Save & apply →</button>'
      + '</div>';

    card.innerHTML = html;
    overlay.appendChild(card);

    // Inject keyframes once
    if (!document.getElementById('wjp-hp-kf')) {
      var kf = document.createElement('style');
      kf.id = 'wjp-hp-kf';
      kf.textContent = '@keyframes wjpHpFade{from{opacity:0}to{opacity:1}}';
      document.head.appendChild(kf);
    }

    // Make whole label clickable to select radio
    card.querySelectorAll('label[data-key]').forEach(function (lbl) {
      lbl.addEventListener('click', function (e) {
        var key = lbl.dataset.key;
        var radio = card.querySelector('input[value="' + key + '"]');
        if (radio) radio.checked = true;
        // Visually mark
        card.querySelectorAll('label[data-key]').forEach(function (l) {
          var sel = l.dataset.key === key;
          l.style.borderColor = sel ? 'var(--accent,#1f7a4a)' : 'var(--border,rgba(0,0,0,0.10))';
          l.style.background = sel ? '#f6fbf8' : '#fff';
        });
        e.preventDefault();
      });
    });

    function close() {
      try { overlay.remove(); } catch (_) {}
    }
    card.querySelector('#wjp-hp-cancel').addEventListener('click', close);
    card.querySelector('#wjp-hp-save').addEventListener('click', function () {
      var picked = card.querySelector('input[name="wjp-hp-algo"]:checked');
      if (picked) setAlgorithm(picked.value);
      close();
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escH(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        close();
        document.removeEventListener('keydown', escH);
      }
    });

    return overlay;
  }

  function openPopover() {
    try {
      // Avoid duplicate
      var existing = document.getElementById('wjp-hybrid-picker-overlay');
      if (existing) existing.remove();
      document.body.appendChild(buildPopover());
    } catch (e) {
      try { console.warn('[wjp-hybrid-picker] open failed', e); } catch (_) {}
    }
  }

  // === ⚙ icon on Strategy tab Hybrid indicator card ===
  function findHybridCard() {
    // Common selector patterns from existing modules
    var sel = ['#hybrid-list', '#strategy-hybrid', '[data-strategy="hybrid"]', '.indicator-card.hybrid'];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el) return el.closest('.indicator-card, .strategy-card, .card, section') || el;
    }
    // Fallback: find a card whose heading contains "Hybrid"
    var headings = document.querySelectorAll('h2,h3,h4,.card-title,.indicator-title');
    for (var j = 0; j < headings.length; j++) {
      var t = (headings[j].textContent || '').trim().toLowerCase();
      if (t === 'hybrid' || t.indexOf('hybrid') !== -1) {
        return headings[j].closest('.indicator-card, .strategy-card, .card, section') || headings[j].parentElement;
      }
    }
    return null;
  }

  function injectGearIcon() {
    try {
      var card = findHybridCard();
      if (!card) return;
      if (card.querySelector('.wjp-hp-gear')) return; // already injected

      // Make sure card is positioned for absolute child
      var pos = window.getComputedStyle(card).position;
      if (pos === 'static') card.style.position = 'relative';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wjp-hp-gear';
      btn.setAttribute('aria-label', 'Change hybrid algorithm');
      btn.title = 'Change how Hybrid orders your debts';
      btn.style.cssText = 'position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.92);border:1px solid var(--border,rgba(0,0,0,0.12));cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--ink-dim,#6b7280);font-family:inherit;padding:0;line-height:1;transition:background .15s, border-color .15s, transform .12s;z-index:5;';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
      btn.addEventListener('mouseenter', function () { btn.style.background = '#fff'; btn.style.borderColor = 'rgba(31,122,74,0.35)'; btn.style.color = 'var(--accent,#1f7a4a)'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = 'rgba(255,255,255,0.92)'; btn.style.borderColor = 'var(--border,rgba(0,0,0,0.12))'; btn.style.color = 'var(--ink-dim,#6b7280)'; });
      btn.addEventListener('click', function (e) { e.stopPropagation(); openPopover(); });
      card.appendChild(btn);

      // Append a small "Algorithm: X" label inside the card so users know what's active
      injectAlgoLabel(card);
    } catch (e) {
      try { console.warn('[wjp-hybrid-picker] inject gear failed', e); } catch (_) {}
    }
  }

  function injectAlgoLabel(card) {
    try {
      var existing = card.querySelector('.wjp-hp-label');
      var algo = ALGORITHMS[getAlgorithm()];
      var text = 'Sort: ' + algo.label;
      if (existing) {
        existing.textContent = text;
        return;
      }
      var lbl = document.createElement('div');
      lbl.className = 'wjp-hp-label';
      lbl.style.cssText = 'font-size:10.5px;letter-spacing:0.05em;color:var(--ink-faint,#9ca3af);font-weight:600;margin-top:8px;padding:4px 10px;background:rgba(31,122,74,0.06);border-radius:999px;display:inline-block;font-family:Inter,system-ui,sans-serif;';
      lbl.textContent = text;
      card.appendChild(lbl);
    } catch (_) {}
  }

  // === Settings panel injection ===
  function findSettingsPanel() {
    // Try named panels
    var sel = [
      '#settings-strategy-panel',
      '[data-settings-panel="strategy"]',
      '#settings-aicoach-panel',  // fall back to AI Coach panel as anchor
      '[data-settings-panel="aicoach"]'
    ];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el && el.offsetParent !== null) return el;
    }
    // Find by heading text
    var hs = document.querySelectorAll('#settings-page h2, #settings-page h3');
    for (var j = 0; j < hs.length; j++) {
      var t = (hs[j].textContent || '').trim().toLowerCase();
      if (t === 'strategy' || t === 'ai coach' || t === 'preferences') {
        return hs[j].parentElement;
      }
    }
    return null;
  }

  function buildSettingsCard() {
    var current = getAlgorithm();
    var algo = ALGORITHMS[current];
    var card = document.createElement('div');
    card.id = 'wjp-hp-settings-card';
    card.style.cssText = 'background:var(--card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));border-radius:14px;padding:20px 22px;margin:18px 0;font-family:Inter,system-ui,sans-serif;color:var(--ink,#0a0a0a)';

    var html = ''
      + '<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-faint,#9ca3af);font-weight:800;margin-bottom:10px;">Hybrid algorithm</div>'
      + '<h3 style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;margin:0 0 6px;letter-spacing:-0.01em;">How Hybrid orders your debts</h3>'
      + '<p style="font-size:13.5px;color:var(--ink-dim,#6b7280);line-height:1.55;margin:0 0 14px;">Snowball sorts by smallest balance, Avalanche sorts by highest APR. Hybrid is whatever you want — pick the rule that fits your psychology and finances.</p>'
      + '<div style="background:#fbf9f4;border-left:3px solid var(--accent,#1f7a4a);border-radius:8px;padding:12px 14px;margin-bottom:14px;">'
      +   '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">'
      +     '<span style="font-weight:700;font-size:14px;color:var(--ink,#0a0a0a);">Currently: ' + algo.label + '</span>'
      +     (algo.tag ? '<span style="font-size:10.5px;letter-spacing:0.05em;background:rgba(31,122,74,0.12);color:var(--accent,#1f7a4a);padding:2px 8px;border-radius:999px;font-weight:700;">' + algo.tag + '</span>' : '')
      +   '</div>'
      +   '<div style="font-size:12.5px;color:var(--ink-dim,#6b7280);line-height:1.5;">' + algo.bestFor + '</div>'
      + '</div>'
      + '<button id="wjp-hp-settings-open" type="button" style="background:#1f7a4a;color:#fff;border:none;padding:10px 18px;border-radius:999px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:-0.01em;">Change algorithm →</button>';

    card.innerHTML = html;
    card.querySelector('#wjp-hp-settings-open').addEventListener('click', openPopover);
    return card;
  }

  function injectSettingsCard() {
    try {
      var panel = findSettingsPanel();
      if (!panel) return;
      var existing = document.getElementById('wjp-hp-settings-card');
      if (existing) {
        // Refresh content
        var fresh = buildSettingsCard();
        existing.replaceWith(fresh);
        return;
      }
      panel.appendChild(buildSettingsCard());
    } catch (_) {}
  }

  // === Refresh all surfaces (called after setAlgorithm) ===
  // Walk #hybrid-list, find the body <p> and italic <div>, rewrite them
  // with the active algorithm\u2019s copy. Also rewrites the "Hybrid Method"
  // sub-heading next to the icon so the entire card matches.
  function updateHybridCardCopy() {
    try {
      var key = getAlgorithm();
      var copy = COPY[key];
      if (!copy) return;
      var list = document.getElementById('hybrid-list');
      if (!list) return;
      // The card structure (per renderStrategyIndicators in app.js):
      //   <div ...>
      //     <div ...><i .../><span>... Method</span></div>
      //     <p>...why...</p>
      //     <div>...best-for...</div>
      //     <div>... 3-stat grid ...</div>
      //   </div>
      var card = list.querySelector('div');
      if (!card) return;
      // Sub-heading span
      var subSpan = card.querySelector('span');
      if (subSpan && /method/i.test(subSpan.textContent || '')) {
        subSpan.textContent = copy.subhead;
      }
      // Body paragraph
      var body = card.querySelector('p');
      if (body) {
        body.textContent = copy.why;
      }
      // Best-for line \u2014 the italic-styled <div> sibling of <p>
      // Find a div whose inline style contains "italic" or whose text starts with "Best for"
      var divs = card.querySelectorAll(':scope > div');
      for (var i = 0; i < divs.length; i++) {
        var d = divs[i];
        var st = d.getAttribute('style') || '';
        var txt = (d.textContent || '').trim();
        if (st.indexOf('italic') !== -1 || txt.indexOf('Best for') === 0) {
          d.textContent = copy.bestFor;
          break;
        }
      }
    } catch (e) {
      try { console.warn('[wjp-hybrid-picker] updateHybridCardCopy threw', e); } catch (_) {}
    }
  }

  function refreshAllSurfaces() {
    try { updateHybridCardCopy(); } catch (_) {}
    try {
      var card = findHybridCard();
      if (card) injectAlgoLabel(card);
    } catch (_) {}
    try {
      var settingsCard = document.getElementById('wjp-hp-settings-card');
      if (settingsCard) {
        var fresh = buildSettingsCard();
        settingsCard.replaceWith(fresh);
      }
    } catch (_) {}
  }

  // === Boot ===
  function boot() {
    installSortPatch();
    injectGearIcon();
    injectSettingsCard();
    // Light polling for SPA mounts (Settings panel may render after click)
    setInterval(function () {
      try { injectGearIcon(); injectSettingsCard(); updateHybridCardCopy(); } catch (_) {}
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  } else {
    setTimeout(boot, 800);
  }

  window.WJP_HybridPicker = {
    getAlgorithm: getAlgorithm,
    setAlgorithm: setAlgorithm,
    openPopover: openPopover,
    algorithms: function () { return Object.keys(ALGORITHMS).map(function (k) { return Object.assign({ key: k }, ALGORITHMS[k], { sort: undefined }); }); }
  };
})();
