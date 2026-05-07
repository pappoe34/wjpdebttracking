/* ============================================================================
   WJP Extra Payment Toggle (surgical, idempotent)
   Lets the user flip extra-payment ON/OFF and pick manual amount vs auto from
   their cash-flow surplus. Adds a ⚙ icon to the DFD hero meta line.

   Implementation: overrides window.getEffectiveExtraContribution so EVERY
   consumer (DFD hero, simulations, indicator cards, AI Coach) sees the same
   value. No app.js touch.

   Persistence: localStorage key wjp.extraToggle = { enabled, mode, amount }
     enabled: bool — false means treat extra as $0
     mode:    'manual' | 'auto'
     amount:  number — used when mode='manual'

   HARDENING:
     - Path-guarded to /index.html
     - Idempotent ID guard on icon + popover
     - Works even if app.js hasn't loaded yet (override applied on
       function availability)
     - All wrapped in try/catch
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpExtraToggleInstalled) return;
  window._wjpExtraToggleInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch(_) {}

  var KEY = 'wjp.extraToggle.v1';
  var ICON_ID = 'wjp-extra-toggle-icon';
  var POPOVER_ID = 'wjp-extra-toggle-popover';

  // ---- State ----
  function loadCfg() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return { enabled: true, mode: 'auto', amount: null }; // default: system decides via cashflow surplus
      return JSON.parse(raw);
    } catch(_) { return { enabled: true, mode: 'auto', amount: null }; }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch(_) {}
  }

  // ---- Override getEffectiveExtraContribution ----
  var origGetEff = null;
  function installOverride() {
    if (origGetEff) return; // already installed
    if (typeof window.getEffectiveExtraContribution !== 'function') {
      // Not loaded yet — wait
      setTimeout(installOverride, 200);
      return;
    }
    origGetEff = window.getEffectiveExtraContribution;
    window.getEffectiveExtraContribution = function() {
      try {
        var cfg = loadCfg();
        // OFF — force extra=0
        if (cfg.enabled === false) {
          return { extra: 0, source: 'user-disabled' };
        }
        // Manual mode with user-supplied amount → use it
        if (cfg.mode === 'manual' && typeof cfg.amount === 'number' && cfg.amount > 0) {
          return { extra: cfg.amount, source: 'manual-override' };
        }
        // Auto mode → defer to original (which uses cashflow surplus when no manual budget)
        if (cfg.mode === 'auto') {
          // Force the auto path: bypass appState.budget.contribution by calling getAvailableCashflow directly
          if (typeof window.getAvailableCashflow === 'function') {
            try {
              var cf = window.getAvailableCashflow();
              if (cf.available > 0) return { extra: cf.available, source: 'auto-surplus' };
            } catch(_) {}
          }
          return { extra: 0, source: 'none' };
        }
        // Default: original behavior
        return origGetEff();
      } catch(_) {
        return origGetEff();
      }
    };
  }

  // ---- Popover UI ----
  function fmt$(n) {
    if (n == null || isNaN(n)) return '$0';
    return '$' + Math.round(Number(n)).toLocaleString();
  }

  function renderPopover() {
    var existing = document.getElementById(POPOVER_ID);
    if (existing) { existing.remove(); return; } // toggle close

    var cfg = loadCfg();
    var icon = document.getElementById(ICON_ID);
    if (!icon) return;
    var rect = icon.getBoundingClientRect();

    var pop = document.createElement('div');
    pop.id = POPOVER_ID;
    pop.style.cssText =
      'position:fixed;top:' + (rect.bottom + 8) + 'px;left:' +
      Math.max(12, rect.left - 220) + 'px;' +
      'z-index:99998;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);' +
      'border-radius:12px;padding:16px;box-shadow:0 12px 36px rgba(0,0,0,0.15);' +
      'width:280px;max-width:calc(100vw - 24px);font-family:inherit;font-size:13px;' +
      'color:var(--ink,#0a0a0a);';

    // Get current original value for comparison label
    var originalEff = origGetEff ? origGetEff() : { extra: 0, source: 'none' };

    pop.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-weight:800;font-size:13px;">Extra payment</div>
        <button type="button" id="wjp-ext-close" style="background:transparent;border:none;cursor:pointer;font-size:18px;line-height:1;color:var(--ink-dim,#6b7280);padding:0 4px;">×</button>
      </div>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;cursor:pointer;">
        <span style="font-size:12.5px;color:var(--ink,#0a0a0a);font-weight:600;">Include in projection</span>
        <input type="checkbox" id="wjp-ext-enabled" ${cfg.enabled !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:#1f7a4a;cursor:pointer;" />
      </label>

      <div id="wjp-ext-mode-row" style="${cfg.enabled === false ? 'opacity:0.4;pointer-events:none;' : ''}margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--ink-dim,#6b7280);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Source</div>
        <div style="display:flex;gap:6px;">
          <button type="button" data-mode="manual"  style="flex:1;padding:8px;border-radius:6px;border:1px solid ${cfg.mode==='manual'?'#1f7a4a':'var(--border,#d8d3c4)'};background:${cfg.mode==='manual'?'#1f7a4a':'transparent'};color:${cfg.mode==='manual'?'#fff':'var(--ink,#0a0a0a)'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">I'll set it</button>
          <button type="button" data-mode="auto"    style="flex:1;padding:8px;border-radius:6px;border:1px solid ${cfg.mode==='auto'?'#1f7a4a':'var(--border,#d8d3c4)'};background:${cfg.mode==='auto'?'#1f7a4a':'transparent'};color:${cfg.mode==='auto'?'#fff':'var(--ink,#0a0a0a)'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Auto from surplus</button>
        </div>
      </div>

      <div id="wjp-ext-amount-row" style="${cfg.enabled === false || cfg.mode !== 'manual' ? 'display:none;' : ''}margin-bottom:14px;">
        <label style="display:block;font-size:11px;font-weight:700;color:var(--ink-dim,#6b7280);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Monthly amount</label>
        <div style="position:relative;">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-weight:700;color:var(--ink-dim,#6b7280);">$</span>
          <input type="number" id="wjp-ext-amount" min="0" step="50" placeholder="${originalEff.extra || 0}" value="${cfg.amount != null ? cfg.amount : (originalEff.extra || '')}"
            style="width:100%;padding:9px 10px 9px 22px;border-radius:6px;border:1px solid var(--border,#d8d3c4);background:var(--card,#fff);color:var(--ink,#0a0a0a);font-size:13px;font-family:inherit;" />
        </div>
        <div id="wjp-ext-suggest" style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:6px;line-height:1.4;"></div>
      </div>

      <div id="wjp-ext-auto-row" style="${cfg.enabled === false || cfg.mode !== 'auto' ? 'display:none;' : ''}margin-bottom:14px;padding:9px 10px;background:var(--bg,#fafaf7);border-radius:8px;font-size:11.5px;color:var(--ink-dim,#6b7280);line-height:1.5;">
        Auto-pulls your monthly cash surplus (income − expenses − bills − minimums) and routes it as extra payment. Updates as your spending changes.
      </div>

      <button type="button" id="wjp-ext-save" style="width:100%;padding:10px;border-radius:8px;border:none;background:#1f7a4a;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Save & apply</button>
    `;
    document.body.appendChild(pop);

    // Wire up
    var closeBtn = document.getElementById('wjp-ext-close');
    if (closeBtn) closeBtn.onclick = function() { pop.remove(); };

    var enabledCb = document.getElementById('wjp-ext-enabled');
    if (enabledCb) enabledCb.onchange = function() {
      var modeRow = document.getElementById('wjp-ext-mode-row');
      if (modeRow) {
        if (this.checked) {
          modeRow.style.opacity = '1';
          modeRow.style.pointerEvents = 'auto';
        } else {
          modeRow.style.opacity = '0.4';
          modeRow.style.pointerEvents = 'none';
          var amtRow = document.getElementById('wjp-ext-amount-row');
          if (amtRow) amtRow.style.display = 'none';
          var autoRow = document.getElementById('wjp-ext-auto-row');
          if (autoRow) autoRow.style.display = 'none';
        }
      }
    };

    pop.querySelectorAll('[data-mode]').forEach(function(b) {
      // Mark currently-selected button so saveCfg can read mode reliably
      if (b.getAttribute('data-mode') === cfg.mode) b.setAttribute('data-active', '1');
      b.onclick = function() {
        var m = b.getAttribute('data-mode');
        // Update visual + data-active
        pop.querySelectorAll('[data-mode]').forEach(function(x) {
          var sel = x.getAttribute('data-mode') === m;
          x.style.border = '1px solid ' + (sel ? '#1f7a4a' : 'var(--border,#d8d3c4)');
          x.style.background = sel ? '#1f7a4a' : 'transparent';
          x.style.color = sel ? '#fff' : 'var(--ink,#0a0a0a)';
          if (sel) x.setAttribute('data-active', '1');
          else x.removeAttribute('data-active');
        });
        document.getElementById('wjp-ext-amount-row').style.display = (m === 'manual') ? '' : 'none';
        document.getElementById('wjp-ext-auto-row').style.display = (m === 'auto') ? '' : 'none';
        // Suggestion text in manual mode
        if (m === 'manual') {
          updateSuggest();
        }
      };
    });

    // Suggestion based on cashflow
    function updateSuggest() {
      var sug = document.getElementById('wjp-ext-suggest');
      if (!sug) return;
      try {
        if (typeof window.getAvailableCashflow === 'function') {
          var cf = window.getAvailableCashflow();
          if (cf && cf.available > 0) {
            sug.textContent = '💡 Your monthly surplus is ' + fmt$(cf.available) + '. That\'s the max we\'d recommend before squeezing your buffer.';
          } else {
            sug.textContent = 'Tip: keep this no higher than your monthly surplus or you\'ll run short on bills.';
          }
        }
      } catch(_) {}
    }
    updateSuggest();

    // Save handler
    var saveBtn = document.getElementById('wjp-ext-save');
    if (saveBtn) saveBtn.onclick = function() {
      var enabled = document.getElementById('wjp-ext-enabled').checked;
      // Read active mode from the data-active attribute we maintain on click
      var activeBtn = pop.querySelector('[data-mode][data-active="1"]');
      if (!activeBtn) {
        // Fall back: read style background to detect active green button
        activeBtn = pop.querySelector('[data-mode][style*="rgb(31, 122, 74)"]') ||
                    pop.querySelector('[data-mode][style*="#1f7a4a"]');
      }
      var mode = activeBtn ? activeBtn.getAttribute('data-mode') : 'auto';
      var amtEl = document.getElementById('wjp-ext-amount');
      var amount = amtEl && amtEl.value ? parseFloat(amtEl.value) : null;
      saveCfg({ enabled: enabled, mode: mode, amount: amount });
      pop.remove();
      // Trigger re-render
      try { if (typeof window.updateUI === 'function') window.updateUI(); } catch(_) {}
      // Also flash a toast
      flashToast(enabled ? 'Extra payment saved · ' + (mode === 'auto' ? 'Auto from surplus' : fmt$(amount || 0) + '/mo') : 'Extra payment turned off');
    };
  }

  function flashToast(msg) {
    try {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'background:#1f7a4a;color:#fff;padding:10px 18px;border-radius:10px;font-weight:700;' +
        'font-size:13px;font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,0.18);' +
        'opacity:0;transition:opacity 0.2s;';
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(function() { t.style.opacity = '1'; });
      setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 250); }, 2400);
    } catch(_) {}
  }

  // ---- Inject icon into DFD meta ----
  function injectIcon() {
    var meta = document.getElementById('dfd-meta');
    if (!meta) return false;
    if (document.getElementById(ICON_ID)) return true;

    var btn = document.createElement('button');
    btn.id = ICON_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Adjust extra payment');
    btn.title = 'Adjust extra payment';
    btn.style.cssText = 'background:transparent;border:1px solid var(--border,#d8d3c4);' +
      'border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;' +
      'justify-content:center;cursor:pointer;margin-left:8px;color:var(--ink-dim,#6b7280);' +
      'vertical-align:middle;padding:0;transition:all 0.15s;font-family:inherit;';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    btn.onmouseenter = function() {
      btn.style.color = '#1f7a4a';
      btn.style.borderColor = '#1f7a4a';
    };
    btn.onmouseleave = function() {
      btn.style.color = 'var(--ink-dim,#6b7280)';
      btn.style.borderColor = 'var(--border,#d8d3c4)';
    };
    btn.onclick = function(e) { e.preventDefault(); renderPopover(); };
    // Insert AFTER meta (not inside) so app re-renders that overwrite
    // meta.innerHTML don't wipe our icon.
    var parent = meta.parentNode;
    if (parent) parent.appendChild(btn);
    else meta.appendChild(btn);
    return true;
  }

  // Click-outside-to-close popover
  document.addEventListener('click', function(e) {
    var pop = document.getElementById(POPOVER_ID);
    if (!pop) return;
    if (pop.contains(e.target)) return;
    var icon = document.getElementById(ICON_ID);
    if (icon && icon.contains(e.target)) return;
    pop.remove();
  }, true);

  function start() {
    installOverride();
    // Try to inject the icon once meta exists
    // Continuous re-injection — every 1.5s, re-add icon if app removed it.
    // Cheap (one DOM query) and resilient to app re-renders.
    setInterval(function() {
      try { if (!document.getElementById(ICON_ID)) injectIcon(); } catch(_) {}
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_ExtraToggle = {
    config: loadCfg,
    save: saveCfg,
    open: renderPopover
  };
})();
