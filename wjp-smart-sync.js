/* ============================================================================
   WJP Smart Sync (surgical)
   Top-of-dashboard widget that surfaces:
     1. Stale-statement alerts (any debt last updated >90 days ago)
     2. Per-card payment timing tips (utilization-drop windows from statementDay)
     3. AI Coach trigger for full sync recommendations

   Pulls data through window.calculateDebtPayoff (which exposes per-debt
   balance, apr, min, type, statementDay).

   HARDENING:
     - Path-guarded to /index.html
     - No MutationObservers
     - Idempotent button injection
     - 1.5s re-injection poll (survives app re-renders)
     - All wrapped in try/catch
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSmartSyncInstalled) return;
  window._wjpSmartSyncInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch(_) {}

  var BUTTON_ID = 'wjp-smart-sync-btn';
  var PANEL_ID = 'wjp-smart-sync-panel';
  var STALE_DAYS = 90;
  var FRESH_KEY_PREFIX = 'wjp.statementUpdated.';

  function fmt$(n) { return '$' + Math.round(Number(n) || 0).toLocaleString(); }

  function getDebts() {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return [];
      var results = window.calculateDebtPayoff();
      var debts = [];
      for (var id in results) {
        var r = results[id];
        debts.push({
          id: id,
          balance: r.balance,
          apr: r.apr,
          min: r.min,
          type: r.type,
          statementDay: r.statementDay,
          months: r.months,
          totalInterest: r.totalInterest,
          // Fetch name from rendered DOM (calculateDebtPayoff doesn't include it)
          name: getNameFromDom(id) || id
        });
      }
      return debts;
    } catch(_) { return []; }
  }

  function getNameFromDom(debtId) {
    try {
      var el = document.querySelector('[data-debt-id="' + debtId + '"]');
      if (!el) return null;
      var nameEl = el.querySelector('.top3-debt-name, .debt-name, [class*="debt-name"]');
      if (nameEl) return (nameEl.textContent || '').trim();
      return null;
    } catch(_) { return null; }
  }

  function statementAge(debtId) {
    try {
      var ts = parseInt(localStorage.getItem(FRESH_KEY_PREFIX + debtId) || '0', 10);
      if (!ts) return null;
      return Math.floor((Date.now() - ts) / 86400000);
    } catch(_) { return null; }
  }

  function paymentTimingTip(d) {
    // Only meaningful for credit cards with a statement day
    var typ = (d.type || '').toLowerCase();
    var isCard = typ.indexOf('credit') !== -1 || typ.indexOf('card') !== -1;
    if (!isCard || !d.statementDay) return null;
    var today = new Date().getDate();
    var sd = Number(d.statementDay);
    var daysToClose = (sd - today + 30) % 30;
    if (daysToClose === 0) daysToClose = 30;
    if (daysToClose > 14) return null; // Don't show if too far out
    // Estimate utilization drop
    var bal = Number(d.balance) || 0;
    if (bal < 50) return null;
    var halfPay = Math.min(bal, Math.max(50, Math.round(bal * 0.30)));
    return {
      msg: 'Pay <strong>' + fmt$(halfPay) + '</strong> on <strong>' +
           d.name + '</strong> before day ' + sd + ' (in ' + daysToClose +
           ' day' + (daysToClose === 1 ? '' : 's') + ') to drop utilization before the statement closes.',
      daysToClose: daysToClose
    };
  }

  function buildAiPrompt(debts) {
    var debtList = debts.map(function(d) {
      var age = statementAge(d.id);
      return '- ' + d.name + ': $' + Math.round(d.balance || 0).toLocaleString() +
             ' at ' + (d.apr || 0) + '% APR · min $' + Math.round(d.min || 0) +
             (d.statementDay ? ' · statement day ' + d.statementDay : '') +
             (age != null ? ' · last refreshed ' + age + ' days ago' : ' · no refresh date on file');
    }).join('\n');
    return [
      "You are my Smart Sync assistant. Analyze my current portfolio and give me a concrete, prioritized action list for the next 30 days.",
      "",
      "MY DEBTS:",
      debtList,
      "",
      "Respond with ONLY these sections, in this order, in plain text (no markdown headers):",
      "",
      "1. STATEMENTS TO REFRESH — list debts with stale data (>90 days) or no refresh date. For each, say 'Upload a recent statement of [debt name]'. Skip this section if all are fresh.",
      "",
      "2. PAYMENT TIMING (next 30 days) — for each credit card with a statement day, tell me:",
      "   • The exact dollar amount to pay",
      "   • The exact day to pay it (e.g., 'before day 23')",
      "   • The credit-utilization or interest reason",
      "",
      "3. AMOUNT TO PAY FOR EFFICIENCY — given my current cash flow, recommend specific monthly payment amounts per debt that maximize debt-free speed without squeezing my buffer.",
      "",
      "4. SAVINGS PROJECTIONS — for the top 2 changes in the list above, tell me how much I'd save in interest + months if I act on them.",
      "",
      "Be concrete. No filler. Use real names + dollar amounts. Prioritize by impact (biggest savings first)."
    ].join('\n');
  }

  function renderPanel() {
    var existing = document.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }

    var btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    var rect = btn.getBoundingClientRect();

    var debts = getDebts();
    var stale = debts.filter(function(d) { var a = statementAge(d.id); return a == null || a > STALE_DAYS; });
    var tips = debts.map(paymentTimingTip).filter(Boolean).sort(function(a,b){ return a.daysToClose - b.daysToClose; });

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = 'position:fixed;top:' + (rect.bottom + 8) + 'px;right:' +
      Math.max(12, window.innerWidth - rect.right) + 'px;z-index:9998;' +
      'background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);' +
      'border-radius:14px;padding:18px;box-shadow:0 16px 48px rgba(0,0,0,0.18);' +
      'width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 100px);' +
      'overflow-y:auto;font-family:inherit;font-size:13px;color:var(--ink,#0a0a0a);';

    var staleBlock = stale.length ? (
      '<div style="background:rgba(192,89,74,0.08);border-left:3px solid #c0594a;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:12px;">' +
      '<div style="font-size:11px;font-weight:800;color:#c0594a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">⚠ Statements need refresh</div>' +
      '<div style="font-size:12px;line-height:1.5;color:var(--ink,#0a0a0a);">' +
        stale.slice(0, 5).map(function(d) {
          var age = statementAge(d.id);
          return '<div style="margin:4px 0;">• <strong>' + escapeHtml(d.name) + '</strong> — ' +
                 (age != null ? age + ' days old' : 'never refreshed') + '</div>';
        }).join('') +
        (stale.length > 5 ? '<div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:4px;">+ ' + (stale.length - 5) + ' more</div>' : '') +
      '</div>' +
      '<div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:6px;line-height:1.4;">Use the +Add → Scan Statement option to upload current PDFs/screenshots. Auto-extracts balance + APR + minimum.</div>' +
      '</div>'
    ) : (
      '<div style="background:rgba(31,122,74,0.08);border-left:3px solid #1f7a4a;border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:12px;font-size:12px;color:#1f7a4a;font-weight:700;">✓ All statements fresh (under ' + STALE_DAYS + ' days old)</div>'
    );

    var tipsBlock = tips.length ? (
      '<div style="margin-bottom:12px;">' +
      '<div style="font-size:11px;font-weight:800;color:var(--ink-dim,#6b7280);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">⏰ Payment timing — next 14 days</div>' +
      tips.slice(0, 4).map(function(t) {
        return '<div style="background:var(--bg,#fafaf7);padding:9px 11px;border-radius:7px;font-size:12px;line-height:1.5;color:var(--ink,#0a0a0a);margin-bottom:6px;">' + t.msg + '</div>';
      }).join('') +
      '</div>'
    ) : (
      '<div style="font-size:12px;color:var(--ink-dim,#6b7280);margin-bottom:12px;font-style:italic;">No urgent payment-timing windows in the next 14 days.</div>'
    );

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
        '<div>' +
          '<div style="font-weight:800;font-size:14px;">Smart Sync</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:1px;">Statement health · payment timing · AI recommendations</div>' +
        '</div>' +
        '<button type="button" id="wjp-smart-close" aria-label="Close" style="background:transparent;border:none;cursor:pointer;font-size:20px;line-height:1;color:var(--ink-dim,#6b7280);padding:0 4px;">×</button>' +
      '</div>' +
      staleBlock +
      tipsBlock +
      '<button type="button" id="wjp-smart-ai" style="width:100%;padding:11px;border-radius:9px;border:none;background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' +
        'Ask AI Coach for full recommendations' +
      '</button>' +
      '<div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:10px;line-height:1.4;text-align:center;">AI analyzes statements + payment timing + cash flow and returns concrete moves with savings projections.</div>';

    document.body.appendChild(panel);

    var closeBtn = document.getElementById('wjp-smart-close');
    if (closeBtn) closeBtn.onclick = function() { panel.remove(); };

    var aiBtn = document.getElementById('wjp-smart-ai');
    if (aiBtn) aiBtn.onclick = function() {
      askCoach(buildAiPrompt(debts));
      panel.remove();
    };
  }

  function askCoach(prompt) {
    // Try to send the prompt directly to the AI Coach via the existing UI.
    // Fallback: copy prompt to clipboard and instruct user.
    try {
      // Open the AI Coach side-panel via the FAB
      var fab = document.getElementById('ai-coach-fab') ||
                document.querySelector('[id*="advisor"], [id*="coach"]');
      // Set the input field and submit
      var sent = false;

      function trySend() {
        var input = document.getElementById('chat-input-v2') ||
                    document.querySelector('#ai-chat-panel textarea, #advisor-chat-input, [data-chat-input]');
        if (!input) return false;
        // Use the property setter to ensure React/state-managed inputs see the change
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                           Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (nativeSetter) nativeSetter.set.call(input, prompt);
        else input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Try to submit by finding nearby send button
        var sendBtn = input.closest('form') ? input.closest('form').querySelector('button[type="submit"], button') :
                      document.querySelector('#ai-chat-panel button[type="submit"], [aria-label*="send" i]');
        if (sendBtn) {
          sendBtn.click();
          sent = true;
        } else {
          // Try Enter key
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          sent = true;
        }
        return sent;
      }

      if (fab) fab.click();
      // Give the panel time to open
      setTimeout(function() {
        if (!trySend()) {
          // Fallback: clipboard + toast
          try {
            navigator.clipboard.writeText(prompt);
            flashToast('AI prompt copied. Open the AI Coach and paste — Ctrl+V.');
          } catch(_) {
            flashToast('Open the AI Coach and ask: "Give me Smart Sync recommendations"');
          }
        }
      }, 600);
    } catch(_) {
      flashToast('Open the AI Coach and ask: "Give me Smart Sync recommendations"');
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }

  function injectButton() {
    return; // user removed top-bar button

    if (document.getElementById(BUTTON_ID)) return true;
    // Mount in the dashboard top action area (next to Bank Health, Sync Bank, etc.)
    var host = document.querySelector('.dashboard-actions, .top-actions, [class*="action-row"]') ||
               document.querySelector('.top-bar') ||
               document.querySelector('header');
    if (!host) {
      // Float bottom-left as fallback
      var btn = makeButton(true);
      document.body.appendChild(btn);
      return true;
    }
    var btn = makeButton(false);
    host.appendChild(btn);
    return true;
  }

  function makeButton(floating) {
    var btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Smart Sync — statement health, payment timing, AI recs';
    if (floating) {
      btn.style.cssText = 'position:fixed;bottom:88px;right:20px;z-index:9997;' +
        'background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border:none;' +
        'border-radius:999px;padding:10px 16px;font-weight:700;font-size:12px;' +
        'cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:7px;' +
        'box-shadow:0 8px 24px rgba(31,122,74,0.35);';
    } else {
      btn.style.cssText = 'background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(43,155,114,0.10));' +
        'color:#1f7a4a;border:1px solid rgba(31,122,74,0.30);border-radius:8px;padding:7px 12px;' +
        'font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;display:inline-flex;' +
        'align-items:center;gap:6px;margin-left:6px;height:34px;';
    }
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9"/><path d="M16 8l-4 4-4-4"/></svg> <span>Smart Sync</span>';
    btn.onclick = function(e) { e.preventDefault(); renderPanel(); };
    return btn;
  }

  // Click-outside-to-close
  document.addEventListener('click', function(e) {
    var pop = document.getElementById(PANEL_ID);
    if (!pop) return;
    if (pop.contains(e.target)) return;
    var btn = document.getElementById(BUTTON_ID);
    if (btn && btn.contains(e.target)) return;
    pop.remove();
  }, true);

  function start() {
    setInterval(function() {
      try { if (!document.getElementById(BUTTON_ID)) injectButton(); } catch(_) {}
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Public hook: app code can call this when a statement is refreshed,
  // to update freshness timestamp.
  window.WJP_SmartSync = {
    open: renderPanel,
    markRefreshed: function(debtId) {
      try { localStorage.setItem(FRESH_KEY_PREFIX + debtId, String(Date.now())); } catch(_) {}
    },
    statementAge: statementAge,
    buildPrompt: function() { return buildAiPrompt(getDebts()); }
  };
})();
