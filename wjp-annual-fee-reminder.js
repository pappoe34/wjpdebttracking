/* wjp-annual-fee-reminder.js v1 — Track + surface annual fee reminders.
 *
 * Winston 2026-05-26: "make sure the user knows to update the yearly
 * charge so we can remind them when its coming up through notifications."
 *
 * Plaid doesn't return annual fees for credit cards, so we need user
 * input. This module:
 *   1. Detects credit cards (debt.limit > 0 OR type=credit) that don't
 *      have annualFee + annualFeeMonth set, and injects a small
 *      "⚠ Set annual fee" nudge pill INSIDE the expanded debt card
 *      (left of the existing utilization bar from FIX 37).
 *   2. Click the pill → simple prompt asks for amount + charge month.
 *      Saves to debt.annualFee, debt.annualFeeMonth.
 *   3. Background ticker checks every hour: when today is within
 *      reminderDays (default 14) of the next annual fee charge,
 *      surfaces an Inbox notification + console log so any host
 *      notification system picks it up.
 *
 * Storage on each debt:
 *   • debt.annualFee         (USD amount, > 0)
 *   • debt.annualFeeMonth    (1-12, month the fee posts)
 *   • debt.annualFeeReminded (ms timestamp of last reminder so we don't
 *                              spam the user once per page-load)
 *
 * Universal — works for any user. No hardcoded names. Idempotent install.
 */
(function () {
  'use strict';
  if (window._wjpAnnualFeeReminderInstalled) return;
  window._wjpAnnualFeeReminderInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // ───────── helpers ─────────
  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  var DAY_MS = 24 * 60 * 60 * 1000;
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function isCard(debt) {
    if (!debt) return false;
    if (debt.type === 'credit' || debt.type === 'card' || debt.type === 'creditCard') return true;
    var limit = Number(debt.limit) || Number(debt.creditLimit) || 0;
    var bal = Number(debt.balance) || 0;
    return limit > 0 && limit >= bal;
  }

  function nextFeeChargeMs(month1to12) {
    if (!month1to12 || month1to12 < 1 || month1to12 > 12) return 0;
    var now = new Date();
    var thisYear = new Date(now.getFullYear(), month1to12 - 1, 1);
    // Use day 1 of that month; if we're already past it this year, push to next year.
    if (thisYear.getTime() < now.getTime()) {
      thisYear = new Date(now.getFullYear() + 1, month1to12 - 1, 1);
    }
    return thisYear.getTime();
  }

  function daysUntil(ms) {
    return Math.ceil((ms - Date.now()) / DAY_MS);
  }

  // ───────── style (once) ─────────
  function injectStyle() {
    if (document.getElementById('wjp-anfee-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-anfee-style';
    st.textContent = [
      '.wjp-anfee-nudge{display:inline-flex;align-items:center;gap:5px;margin:10px 16px 0 16px;padding:6px 12px;border-radius:999px;border:1px dashed rgba(180,83,9,0.45);background:rgba(251,191,36,0.10);color:#b45309;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;}',
      '.wjp-anfee-nudge:hover{background:rgba(251,191,36,0.18);}',
      '.wjp-anfee-nudge .ph{font-size:13px;}',
      '.wjp-anfee-set{display:inline-flex;align-items:center;gap:5px;margin:10px 16px 0 16px;padding:6px 12px;border-radius:999px;border:1px solid rgba(31,122,74,0.30);background:rgba(31,122,74,0.08);color:#1f7a4a;font-size:11px;font-weight:700;font-family:inherit;}',
      '.wjp-anfee-set .ph{font-size:13px;}',
      '.wjp-anfee-edit{margin-left:4px;text-decoration:underline;cursor:pointer;color:inherit;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───────── prompt for setting annual fee ─────────
  function promptForFee(debt) {
    var name = debt.name || 'this card';
    var existing = Number(debt.annualFee) || 0;
    var existingMonth = Number(debt.annualFeeMonth) || 0;
    var amtStr = window.prompt(
      'Annual fee for ' + name + ' (enter $ amount, or 0 if there is no annual fee):',
      existing ? String(existing) : ''
    );
    if (amtStr === null) return false; // cancel
    var amt = parseFloat(amtStr);
    if (!isFinite(amt) || amt < 0) {
      alert('Please enter a valid amount (e.g., 95 or 0).');
      return false;
    }
    if (amt === 0) {
      // Mark as confirmed-no-fee so we stop nudging
      debt.annualFee = 0;
      debt.annualFeeMonth = 0;
      debt.annualFeeConfirmedNone = true;
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-debts-changed', { detail:{source:'annual-fee-set'} })); } catch (_) {}
      return true;
    }
    var monthStr = window.prompt(
      'Which month does the annual fee post on ' + name + '? Enter 1-12 (Jan=1, Dec=12):',
      existingMonth ? String(existingMonth) : ''
    );
    if (monthStr === null) return false;
    var month = parseInt(monthStr, 10);
    if (!isFinite(month) || month < 1 || month > 12) {
      alert('Please enter a month number from 1 (January) to 12 (December).');
      return false;
    }
    debt.annualFee = amt;
    debt.annualFeeMonth = month;
    debt.annualFeeConfirmedNone = false;
    saveState();
    try { window.dispatchEvent(new CustomEvent('wjp-debts-changed', { detail:{source:'annual-fee-set'} })); } catch (_) {}
    refreshNudges();
    return true;
  }

  // ───────── nudge injection ─────────
  function refreshNudges() {
    injectStyle();
    var grid = document.getElementById('wjp-rt-grid');
    if (!grid) return;
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return;
    Array.prototype.forEach.call(grid.querySelectorAll('[data-wjp-rt-key]'), function (card) {
      var key = card.getAttribute('data-wjp-rt-key');
      var debt = s.debts.find(function (d) {
        return d && (d.id === key || ('plaid:' + d.id) === key || d.id === ('plaid:' + key));
      });
      if (!debt) return;
      // Remove any stale nudge first so we always reflect current state
      var stale = card.querySelector('.wjp-anfee-nudge, .wjp-anfee-set');
      if (stale) stale.remove();
      if (!isCard(debt)) return; // only cards have annual fees
      var bodyText = (card.textContent || '');
      var isExpanded = bodyText.length > 200 && /AI breakdown|EDIT DATA|What this is/i.test(bodyText);
      if (!isExpanded) return;
      var enh = card.querySelector('.wjp-debt-enh'); // FIX 37 utilization bar block
      var hasFee = Number(debt.annualFee) > 0 && Number(debt.annualFeeMonth) >= 1;
      var confirmedNone = debt.annualFeeConfirmedNone === true;

      var el = document.createElement('span');
      if (hasFee) {
        var feeMonth = MONTHS[Number(debt.annualFeeMonth) - 1];
        el.className = 'wjp-anfee-set';
        el.innerHTML = '<i class="ph ph-bell"></i> Annual fee: $' + Number(debt.annualFee).toFixed(2) + ' in ' + feeMonth +
          ' <span class="wjp-anfee-edit" data-action="edit-fee">edit</span>';
      } else if (confirmedNone) {
        el.className = 'wjp-anfee-set';
        el.style.borderColor = 'rgba(0,0,0,0.10)';
        el.style.background = 'rgba(0,0,0,0.04)';
        el.style.color = 'var(--ink-dim, #6b7280)';
        el.innerHTML = '<i class="ph ph-info"></i> No annual fee <span class="wjp-anfee-edit" data-action="edit-fee">change</span>';
      } else {
        el.className = 'wjp-anfee-nudge';
        el.setAttribute('title', "Plaid doesn't provide annual fees — set yours so we can remind you before it posts.");
        el.innerHTML = '<i class="ph ph-warning-circle"></i> Set annual fee';
      }
      // Wire click → prompt
      el.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        promptForFee(debt);
      };
      // Insert just above the .wjp-debt-enh block (so it sits above the bar)
      if (enh) {
        enh.parentNode.insertBefore(el, enh);
      } else {
        card.appendChild(el);
      }
    });
  }

  // ───────── reminder runner ─────────
  function runReminderCheck() {
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return;
    var fired = 0;
    s.debts.forEach(function (debt) {
      if (!debt) return;
      var amt = Number(debt.annualFee) || 0;
      var month = Number(debt.annualFeeMonth) || 0;
      if (!amt || !month) return;
      var nextMs = nextFeeChargeMs(month);
      if (!nextMs) return;
      var days = daysUntil(nextMs);
      var window = Number(debt.reminderDays) || 14;
      if (days < 0) return; // already past
      if (days > window) return; // too far out
      // Don't spam: only re-fire if not reminded in the last 24h
      var lastReminded = Number(debt.annualFeeReminded) || 0;
      if (Date.now() - lastReminded < DAY_MS) return;
      debt.annualFeeReminded = Date.now();
      fired++;
      // Surface notification — try host's notification system if available
      var msg = 'Annual fee of $' + amt.toFixed(2) + ' for ' + (debt.name || 'card') + ' is coming up in ' + days + ' day' + (days === 1 ? '' : 's') + '.';
      try {
        if (window.WJP_Inbox && typeof window.WJP_Inbox.add === 'function') {
          window.WJP_Inbox.add({
            id: 'annual-fee-' + debt.id + '-' + new Date(nextMs).getFullYear(),
            kind: 'reminder',
            title: 'Annual fee due ' + MONTHS[month-1],
            body: msg,
            ts: Date.now()
          });
        } else if (typeof window.showToast === 'function') {
          window.showToast(msg);
        } else {
          console.log('[wjp-annual-fee-reminder]', msg);
        }
      } catch (e) {
        try { console.warn('[wjp-annual-fee-reminder] notify failed', e); } catch (_) {}
      }
    });
    if (fired > 0) {
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-annual-fee-reminded', { detail: { count: fired } })); } catch (_) {}
    }
  }

  // ───────── boot ─────────
  function boot() {
    injectStyle();
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.debts)) {
        refreshNudges();
        runReminderCheck();
        return;
      }
      if (attempts < 20) setTimeout(tick, 1500);
    }
    setTimeout(tick, 2500);
    window.addEventListener('wjp-debts-changed', refreshNudges);
    window.addEventListener('wjp-recurring-changed', refreshNudges);
    // MutationObserver-light: re-inject when cards expand/collapse
    try {
      var grid = document.getElementById('wjp-rt-grid');
      if (grid && window.MutationObserver) {
        var mo = new MutationObserver(function () { refreshNudges(); });
        mo.observe(grid, { childList: true, subtree: true });
      } else {
        setInterval(refreshNudges, 2500);
      }
    } catch (_) { setInterval(refreshNudges, 2500); }
    // Late grid detection
    var late = 0;
    var iv = setInterval(function () {
      late++;
      if (late > 30) return clearInterval(iv);
      var g = document.getElementById('wjp-rt-grid');
      if (g && !g._wjpFeeObserved) {
        g._wjpFeeObserved = true;
        try {
          var mo2 = new MutationObserver(function () { refreshNudges(); });
          mo2.observe(g, { childList: true, subtree: true });
        } catch (_) {}
        refreshNudges();
      }
    }, 1500);
    // Reminder check runs every hour
    setInterval(runReminderCheck, 60 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_AnnualFeeReminder = {
    version: 1,
    refresh: refreshNudges,
    runReminderCheck: runReminderCheck,
    promptForFee: promptForFee,
    nextFeeChargeMs: nextFeeChargeMs
  };
})();
