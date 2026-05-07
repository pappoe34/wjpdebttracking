/* ============================================================================
   WJP Simulator Enhance (surgical overlay)
   Three independent pieces, all defensive and reversible:

   PIECE A — "Open Simulator" CTA on Debts/Strategy tab top
     • Detects when #page-debts is visible AND .debts-subtabs exists
     • Adds a green pill button "🧪 Open Simulator" next to the sub-tab nav
     • Click jumps to the Simulations sub-tab (clicks the existing sub-tab)
     • Idempotent — won't re-inject if already present

   PIECE B — Smart Sync card at top of Simulator
     • When #simulations-tab-content is visible AND has the simulator content
     • Prepends a Smart Sync card with: statement freshness · payment timing · "Ask AI Coach"
     • Re-injects after sub-tab re-renders
     • Reuses the Smart Sync prompt builder from wjp-smart-sync.js if available

   PIECE C — Apply confirmation + matches-live badge
     • Wraps #sim-apply-btn click handler in capture phase
     • First click → shows confirmation modal listing strategy + extra payment about to commit
     • Confirm → re-fires click, lets original handler run (which sets appState + calls setStrategy)
     • Cancel → no-op
     • Plus: when sim values already equal live values, shows a green "✓ Matches your live plan" badge
       next to Apply button so user knows nothing would change.

   HARDENING (lessons from earlier modules):
     • Path-guarded to /index.html only
     • NO MutationObservers — uses 2s polling
     • All three pieces idempotent (ID guards before injection)
     • Try/catch on every entry point
     • Capture-phase handler doesn't break original behavior on confirm
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSimEnhanceInstalled) return;
  window._wjpSimEnhanceInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch(_) {}

  // ===== Helper: format dollars =====
  function fmt$(n) {
    if (n == null || isNaN(n)) return '$0';
    return '$' + Math.round(Number(n)).toLocaleString();
  }

  // ============================================================
  // PIECE A — "Open Simulator" CTA on Strategy tab
  // ============================================================
  var STRATEGY_CTA_ID = 'wjp-sim-cta';

  function isDebtsPageVisible() {
    var pg = document.getElementById('page-debts');
    if (!pg) return false;
    return getComputedStyle(pg).display !== 'none';
  }

  function injectStrategyCTA() {
    if (!isDebtsPageVisible()) return;
    if (document.getElementById(STRATEGY_CTA_ID)) return; // already injected
    // Find sub-tabs container
    var subtabs = document.querySelector('.debts-subtabs');
    if (!subtabs) return;

    var btn = document.createElement('button');
    btn.id = STRATEGY_CTA_ID;
    btn.type = 'button';
    btn.title = 'Run scenarios with extra payments, lump sums, and rate changes — see impact before committing';
    btn.style.cssText = 'background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border:none;' +
      'border-radius:8px;padding:8px 16px;font-weight:700;font-size:12px;cursor:pointer;' +
      'font-family:inherit;display:inline-flex;align-items:center;gap:6px;margin-left:14px;' +
      'box-shadow:0 4px 12px rgba(31,122,74,0.25);transition:transform 0.15s, box-shadow 0.15s;' +
      'vertical-align:middle;';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Open Simulator';
    btn.onmouseenter = function(){ btn.style.transform='translateY(-1px)'; btn.style.boxShadow='0 8px 20px rgba(31,122,74,0.35)'; };
    btn.onmouseleave = function(){ btn.style.transform='translateY(0)'; btn.style.boxShadow='0 4px 12px rgba(31,122,74,0.25)'; };
    btn.onclick = function(e) {
      e.preventDefault();
      // Click the simulations sub-tab (the existing app code routes to it)
      var simTab = Array.from(document.querySelectorAll('.debts-subtabs .subtab')).find(function(t) {
        return /simulat/i.test(t.textContent || '');
      });
      if (simTab) simTab.click();
      else if (typeof window.renderSimulationsTab === 'function') window.renderSimulationsTab();
    };

    // Append after existing sub-tab buttons (preserve original container display)
    subtabs.appendChild(btn);
  }

  // ============================================================
  // PIECE B — Smart Sync card injection into Simulator
  // ============================================================
  var SMART_CARD_ID = 'wjp-sim-smart-card';
  var FRESH_KEY_PREFIX = 'wjp.statementUpdated.';
  var STALE_DAYS = 90;

  function getDebtsForSync() {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return [];
      var results = window.calculateDebtPayoff();
      var debts = [];
      for (var id in results) {
        var r = results[id];
        var nameEl = document.querySelector('[data-debt-id="' + id + '"] .top3-debt-name, [data-debt-id="' + id + '"] .debt-name');
        debts.push({
          id: id,
          balance: r.balance,
          apr: r.apr,
          min: r.min,
          type: r.type,
          statementDay: r.statementDay,
          name: nameEl ? (nameEl.textContent || '').trim() : id
        });
      }
      return debts;
    } catch(_) { return []; }
  }

  function statementAge(debtId) {
    try {
      var ts = parseInt(localStorage.getItem(FRESH_KEY_PREFIX + debtId) || '0', 10);
      if (!ts) return null;
      return Math.floor((Date.now() - ts) / 86400000);
    } catch(_) { return null; }
  }

  function paymentTimingTip(d) {
    var typ = (d.type || '').toLowerCase();
    var isCard = typ.indexOf('credit') !== -1 || typ.indexOf('card') !== -1;
    if (!isCard || !d.statementDay) return null;
    var today = new Date().getDate();
    var sd = Number(d.statementDay);
    var daysToClose = (sd - today + 30) % 30;
    if (daysToClose === 0) daysToClose = 30;
    if (daysToClose > 14) return null;
    var bal = Number(d.balance) || 0;
    if (bal < 50) return null;
    var halfPay = Math.min(bal, Math.max(50, Math.round(bal * 0.30)));
    return {
      msg: 'Pay <strong>' + fmt$(halfPay) + '</strong> on <strong>' + escapeHtml(d.name) +
           '</strong> before day ' + sd + ' (in ' + daysToClose + ' day' + (daysToClose === 1 ? '' : 's') +
           ') to drop utilization before the statement closes.',
      daysToClose: daysToClose
    };
  }

  function isSimContentVisible() {
    var c = document.getElementById('simulations-tab-content');
    if (!c) return false;
    if (getComputedStyle(c).display === 'none') return false;
    // Make sure it has rendered content, not the empty state
    return (c.innerHTML || '').length > 200;
  }

  function injectSmartCard() {
    if (!isSimContentVisible()) return;
    if (document.getElementById(SMART_CARD_ID)) return; // idempotent
    var c = document.getElementById('simulations-tab-content');
    if (!c) return;

    var debts = getDebtsForSync();
    if (!debts.length) return;

    var stale = debts.filter(function(d) {
      var a = statementAge(d.id);
      return a == null || a > STALE_DAYS;
    });
    var tips = debts.map(paymentTimingTip).filter(Boolean).sort(function(a, b) {
      return a.daysToClose - b.daysToClose;
    });

    var card = document.createElement('div');
    card.id = SMART_CARD_ID;
    card.className = 'card';
    card.style.cssText = 'padding:18px 22px;margin-bottom:18px;' +
      'background:linear-gradient(135deg,rgba(31,122,74,0.06),rgba(43,155,114,0.03));' +
      'border:1px solid rgba(31,122,74,0.20);border-radius:14px;';

    var header = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<div>' +
        '<div style="font-size:11px;color:#1f7a4a;text-transform:uppercase;letter-spacing:0.06em;font-weight:800;margin-bottom:2px;">Smart Sync</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--text);">Bill freshness · payment timing · AI recommendations</div>' +
      '</div>' +
      '<button type="button" id="wjp-sim-smart-collapse" style="background:transparent;border:1px solid var(--border);color:var(--text-3);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;">Hide</button>' +
    '</div>';

    var staleBlock = stale.length ? (
      '<div style="background:rgba(192,89,74,0.10);border-left:3px solid #c0594a;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:800;color:#c0594a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">⚠ ' + stale.length + ' debt' + (stale.length === 1 ? '' : 's') + ' need fresh statement' + (stale.length === 1 ? '' : 's') + '</div>' +
        '<div style="font-size:12px;line-height:1.5;color:var(--text);">' +
        stale.slice(0, 4).map(function(d) {
          var age = statementAge(d.id);
          return '<div style="margin:3px 0;">• <strong>' + escapeHtml(d.name) + '</strong> — ' + (age != null ? age + ' days old' : 'never refreshed') + '</div>';
        }).join('') +
        (stale.length > 4 ? '<div style="font-size:11px;color:var(--text-3);margin-top:4px;">+ ' + (stale.length - 4) + ' more</div>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-3);margin-top:6px;line-height:1.4;">Use +Add → Scan Statement to upload current PDFs/screenshots. Auto-extracts balance + APR + minimum.</div>' +
      '</div>'
    ) : (
      '<div style="background:rgba(31,122,74,0.10);border-left:3px solid #1f7a4a;border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:10px;font-size:12px;color:#1f7a4a;font-weight:700;">✓ All statements fresh (under ' + STALE_DAYS + ' days old)</div>'
    );

    var tipsBlock = tips.length ? (
      '<div style="margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">⏰ Payment timing — next 14 days</div>' +
        tips.slice(0, 3).map(function(t) {
          return '<div style="background:rgba(0,0,0,0.04);padding:9px 11px;border-radius:7px;font-size:12px;line-height:1.5;color:var(--text);margin-bottom:6px;">' + t.msg + '</div>';
        }).join('') +
      '</div>'
    ) : '';

    var aiBtn = '<button type="button" id="wjp-sim-smart-ai" style="width:100%;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Ask AI Coach for full sync recommendations' +
    '</button>';

    card.innerHTML = header + staleBlock + tipsBlock + aiBtn;
    c.insertBefore(card, c.firstChild);

    // Wire up
    var collapseBtn = document.getElementById('wjp-sim-smart-collapse');
    if (collapseBtn) collapseBtn.onclick = function() { card.remove(); try { sessionStorage.setItem('wjp.simSmart.dismissed', '1'); } catch(_) {} };

    var aiButton = document.getElementById('wjp-sim-smart-ai');
    if (aiButton) aiButton.onclick = function() {
      // Reuse smart-sync's prompt builder if loaded; else build locally
      var prompt;
      if (window.WJP_SmartSync && typeof window.WJP_SmartSync.buildPrompt === 'function') {
        prompt = window.WJP_SmartSync.buildPrompt();
      } else {
        prompt = buildLocalPrompt(debts);
      }
      askCoach(prompt);
    };
  }

  function buildLocalPrompt(debts) {
    var debtList = debts.map(function(d) {
      var age = statementAge(d.id);
      return '- ' + d.name + ': $' + Math.round(d.balance || 0).toLocaleString() +
             ' at ' + (d.apr || 0) + '% APR · min $' + Math.round(d.min || 0) +
             (d.statementDay ? ' · stmt day ' + d.statementDay : '') +
             (age != null ? ' · ' + age + 'd since refresh' : ' · never refreshed');
    }).join('\n');
    return [
      "Smart Sync analysis for the next 30 days.",
      "",
      "MY DEBTS:",
      debtList,
      "",
      "Give me ONLY:",
      "1. STATEMENTS TO REFRESH (stale or never refreshed)",
      "2. PAYMENT TIMING (exact $ + day) for each card with a statement day in the next 30 days",
      "3. OPTIMAL MONTHLY AMOUNTS per debt to maximize payoff speed",
      "4. SAVINGS PROJECTIONS for the top 2 changes",
      "Concrete only. Real names, dollar amounts, days. Prioritize biggest impact first."
    ].join('\n');
  }

  function askCoach(prompt) {
    try {
      var fab = document.getElementById('ai-coach-fab') || document.querySelector('[id*="advisor"], [id*="coach"]');
      if (fab) fab.click();
      setTimeout(function() {
        var input = document.getElementById('chat-input-v2') ||
                    document.querySelector('#ai-chat-panel textarea, #advisor-chat-input, [data-chat-input]');
        if (!input) {
          try { navigator.clipboard.writeText(prompt); flashToast('AI prompt copied. Open AI Coach and paste.'); } catch(_) {}
          return;
        }
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                     Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (setter) setter.set.call(input, prompt); else input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var sendBtn = input.closest('form') ? input.closest('form').querySelector('button[type="submit"], button') : null;
        if (sendBtn) sendBtn.click();
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }, 600);
    } catch(_) {
      flashToast('Open AI Coach and ask "Smart Sync recommendations"');
    }
  }

  function flashToast(msg) {
    try {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;background:#1f7a4a;color:#fff;padding:11px 18px;border-radius:10px;' +
        'font-weight:700;font-size:13px;font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.remove(); }, 4000);
    } catch(_) {}
  }

  // ============================================================
  // PIECE C — Apply button confirmation + matches-live badge
  // ============================================================
  var APPLY_WRAPPED_KEY = 'data-wjp-apply-wrapped';
  var MATCHES_BADGE_ID = 'wjp-sim-matches-badge';

  function getSimState() {
    try { return JSON.parse(localStorage.getItem('wjp_sim_state') || '{}'); }
    catch(_) { return {}; }
  }

  function getLiveValues() {
    // We can't directly read appState, but the UI shows the live strategy and extra.
    // Read DOM signals: top-3 active chip, dfd-meta text.
    var liveStrat = null;
    try {
      var activeChip = document.querySelector('#top3-strategy-tabs .chip.active') ||
                       Array.from(document.querySelectorAll('#top3-strategy-tabs .chip'))
                            .find(function(c){ return /active|selected/i.test(c.className); });
      if (activeChip) liveStrat = (activeChip.getAttribute('data-strategy') || '').toLowerCase();
    } catch(_) {}
    if (!liveStrat) {
      // Fallback — read from extra-toggle's loaded config or DFD meta
      try {
        var meta = document.getElementById('dfd-meta');
        if (meta) {
          var t = (meta.textContent || '').toLowerCase();
          liveStrat = t.indexOf('avalanche') !== -1 ? 'avalanche' :
                      t.indexOf('snowball') !== -1 ? 'snowball' :
                      t.indexOf('hybrid') !== -1 ? 'hybrid' : null;
        }
      } catch(_) {}
    }
    var liveExtra = 0;
    try {
      if (typeof window.getEffectiveExtraContribution === 'function') {
        liveExtra = (window.getEffectiveExtraContribution() || {}).extra || 0;
      }
    } catch(_) {}
    return { strategy: liveStrat || 'avalanche', extra: liveExtra };
  }

  function showApplyConfirm(simState, onConfirm) {
    // Remove any existing confirm
    var existing = document.getElementById('wjp-apply-confirm');
    if (existing) existing.remove();

    var live = getLiveValues();
    var changedStrat = simState.strategy && simState.strategy !== live.strategy;
    var changedExtra = simState.extra != null && Number(simState.extra) !== Number(live.extra);

    var modal = document.createElement('div');
    modal.id = 'wjp-apply-confirm';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;';
    modal.innerHTML =
      '<div style="background:var(--card,#fff);border-radius:14px;padding:24px;max-width:440px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.4);border:1px solid var(--border,#e5e7eb);">' +
        '<div style="font-size:11px;font-weight:800;color:#c99a2a;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Apply changes to live plan</div>' +
        '<h3 style="font-size:18px;font-weight:800;margin:0 0 14px;color:var(--ink,#0a0a0a);">Commit these changes?</h3>' +

        (changedStrat || changedExtra ?
          '<div style="display:grid;gap:10px;margin-bottom:18px;">' +
            (changedStrat ? '<div style="background:var(--bg,#fafaf7);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--ink-dim,#6b7280);">Strategy</span><strong>' + capitalize(live.strategy) + ' → ' + capitalize(simState.strategy) + '</strong></div>' : '') +
            (changedExtra ? '<div style="background:var(--bg,#fafaf7);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--ink-dim,#6b7280);">Extra payment</span><strong>' + fmt$(live.extra) + ' → ' + fmt$(simState.extra) + '/mo</strong></div>' : '') +
          '</div>' +
          '<p style="font-size:12px;color:var(--ink-dim,#6b7280);line-height:1.5;margin:0 0 18px;">This updates your live plan. Your dashboard, AI Coach, and projections will all use the new values immediately.</p>'
        :
          '<p style="font-size:13px;color:var(--ink-dim,#6b7280);line-height:1.5;margin:0 0 18px;">Sim values match your live plan. Nothing to commit.</p>'
        ) +

        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button id="wjp-apply-cancel" style="background:transparent;border:1px solid var(--border,#d8d3c4);color:var(--ink,#0a0a0a);border-radius:8px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Cancel</button>' +
          (changedStrat || changedExtra ?
            '<button id="wjp-apply-yes" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Yes, apply</button>'
            : '') +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.getElementById('wjp-apply-cancel').onclick = function() { modal.remove(); };
    var yes = document.getElementById('wjp-apply-yes');
    if (yes) yes.onclick = function() { modal.remove(); onConfirm(); };
    // Click outside to cancel
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  }

  function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }

  function wrapApplyButton() {
    var btn = document.getElementById('sim-apply-btn');
    if (!btn) return;
    if (btn.getAttribute(APPLY_WRAPPED_KEY) === '1') {
      // Already wrapped. Just refresh the matches-live badge.
      refreshMatchesBadge();
      return;
    }

    // Capture-phase listener intercepts BEFORE the original bubble handler.
    btn.addEventListener('click', function(e) {
      try {
        if (btn._wjpConfirmed) {
          // Re-fired after confirm — let the original handler run
          btn._wjpConfirmed = false;
          return;
        }
        // First-fire — show confirm
        e.stopPropagation();
        e.preventDefault();
        var sv = getSimState();
        showApplyConfirm(sv, function() {
          btn._wjpConfirmed = true;
          btn.click();
        });
      } catch(err) {
        try { console.warn('[wjp-sim-enhance] apply wrap threw', err); } catch(_) {}
      }
    }, true); // CAPTURE PHASE

    btn.setAttribute(APPLY_WRAPPED_KEY, '1');
    refreshMatchesBadge();
  }

  function refreshMatchesBadge() {
    var btn = document.getElementById('sim-apply-btn');
    if (!btn) return;
    var sv = getSimState();
    var live = getLiveValues();
    var changed = (sv.strategy && sv.strategy !== live.strategy) ||
                  (sv.extra != null && Number(sv.extra) !== Number(live.extra));

    var existing = document.getElementById(MATCHES_BADGE_ID);
    if (changed) {
      if (existing) existing.remove();
      btn.textContent = 'Apply Strategy →';
      return;
    }
    // Already matches — show badge if missing
    if (!existing) {
      var badge = document.createElement('span');
      badge.id = MATCHES_BADGE_ID;
      badge.style.cssText = 'display:inline-block;margin-right:10px;background:rgba(31,122,74,0.10);' +
        'color:#1f7a4a;padding:6px 11px;border-radius:8px;font-size:11px;font-weight:700;font-family:inherit;';
      badge.textContent = '✓ Already matches your live plan';
      btn.parentNode.insertBefore(badge, btn);
    }
    btn.textContent = 'Re-apply';
  }

  // ============================================================
  // POLL LOOP — runs every 2s, all three pieces idempotent
  // ============================================================
  function tick() {
    try { injectStrategyCTA(); } catch(_) {}
    try {
      if (sessionStorage.getItem('wjp.simSmart.dismissed') !== '1') injectSmartCard();
    } catch(_) {}
    try { wrapApplyButton(); } catch(_) {}
  }

  function start() {
    setInterval(tick, 2000);
    setTimeout(tick, 600); // initial nudge
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_SimEnhance = {
    pieces: ['Strategy CTA', 'Smart Sync card', 'Apply confirmation'],
    tick: tick
  };
})();
