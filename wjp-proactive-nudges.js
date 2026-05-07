/* ============================================================================
   WJP Proactive Nudges (W3) — context-aware AI prompts.
   Watches user's data and surfaces a nudge banner when a high-leverage moment
   is detected. Nudges are ranked; only one shown per session. Dismissible.
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpNudgesInstalled) return;
  window._wjpNudgesInstalled = true;

  const DISMISSED_KEY = 'wjp.nudges.dismissed';
  const SHOWN_THIS_SESSION_KEY = 'wjp.nudges.shownSession';

  const NUDGES = [
    {
      id: 'high-apr-card',
      label: 'A card you have is bleeding you',
      detect: () => {
        const debts = (window.appState && window.appState.debts) || [];
        return debts.some(d => Number(d.apr) >= 22);
      },
      msg: () => {
        const debts = (window.appState && window.appState.debts) || [];
        const worst = debts.filter(d => Number(d.apr) >= 22).sort((a,b)=>b.apr-a.apr)[0];
        if (!worst) return null;
        return `Your ${worst.name || 'card'} is at ${worst.apr}% APR. That's the most expensive debt you have. Ask the AI Coach about a balance-transfer or extra-payment plan.`;
      },
      cta: 'Ask the coach'
    },
    {
      id: 'payment-due-soon',
      label: 'Payment due in <3 days',
      detect: () => {
        const bills = (window.appState && window.appState.recurringBills) || [];
        const today = new Date().getDate();
        return bills.some(b => {
          const day = Number(b.dueDay || b.day);
          if (!day) return false;
          const diff = day - today;
          return diff >= 0 && diff <= 3;
        });
      },
      msg: () => {
        return 'You have a payment due in the next 3 days. Make sure your buffer is ready — the AI Coach can check your projected balance.';
      },
      cta: 'Check buffer'
    },
    {
      id: 'high-utilization',
      label: 'Credit utilization above 30%',
      detect: () => {
        const debts = (window.appState && window.appState.debts) || [];
        const cards = debts.filter(d => d.type === 'credit_card' || d.creditLimit);
        if (!cards.length) return false;
        const totalLimit = cards.reduce((s, c) => s + (Number(c.creditLimit) || 0), 0);
        const totalBal = cards.reduce((s, c) => s + (Number(c.balance) || 0), 0);
        return totalLimit > 0 && (totalBal / totalLimit) > 0.30;
      },
      msg: () => {
        const debts = (window.appState && window.appState.debts) || [];
        const cards = debts.filter(d => d.type === 'credit_card' || d.creditLimit);
        const totalLimit = cards.reduce((s, c) => s + (Number(c.creditLimit) || 0), 0);
        const totalBal = cards.reduce((s, c) => s + (Number(c.balance) || 0), 0);
        const util = Math.round(totalBal / totalLimit * 100);
        return `Your credit utilization is ${util}%. Anything over 30% drags your credit score. Pay down before the statement closes — the AI Coach can tell you exactly which card to hit and when.`;
      },
      cta: 'Get the move'
    },
    {
      id: 'no-debt-progress',
      label: 'No payment recorded this week',
      detect: () => {
        const last = (window.WJP_Gamification && window.WJP_Gamification.getStats() || {}).totalPaid || 0;
        // Heuristic — you could implement "delta from last week" if you track it
        return false; // Stub — needs payment-tracking history
      },
      msg: () => 'You haven\'t logged a payment this week. Even a small one keeps your streak alive. Open the dashboard.',
      cta: 'Log a payment'
    }
  ];

  function dismissed() { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}'); } catch(_) { return {}; } }
  function dismiss(id) {
    const d = dismissed();
    d[id] = Date.now();
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(d)); } catch(_) {}
  }
  function isDismissed(id) {
    const d = dismissed();
    if (!d[id]) return false;
    // Re-show after 7 days
    return (Date.now() - d[id]) < 7 * 86400000;
  }
  function shownThisSession() { try { return sessionStorage.getItem(SHOWN_THIS_SESSION_KEY) === '1'; } catch(_) { return false; } }
  function markShown() { try { sessionStorage.setItem(SHOWN_THIS_SESSION_KEY, '1'); } catch(_) {} }

  function pickNudge() {
    for (const n of NUDGES) {
      if (isDismissed(n.id)) continue;
      try {
        if (n.detect()) {
          const m = n.msg();
          if (m) return { id: n.id, msg: m, cta: n.cta };
        }
      } catch(_) {}
    }
    return null;
  }

  function show(n) {
    if (document.getElementById('wjp-nudge-banner')) return;
    const b = document.createElement('div');
    b.id = 'wjp-nudge-banner';
    b.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:9997;background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border-radius:14px;padding:14px 18px;max-width:480px;width:calc(100vw - 40px);box-shadow:0 16px 40px rgba(0,0,0,0.25);font-family:Inter,system-ui,sans-serif;font-size:13.5px;line-height:1.5;display:flex;gap:12px;align-items:flex-start;';
    b.innerHTML = `
      <div style="flex:1;">${escapeHtml(n.msg)}</div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <a href="#advisor" style="background:#fff;color:#1f7a4a;text-decoration:none;padding:6px 12px;border-radius:8px;font-weight:700;font-size:12px;text-align:center;">${escapeHtml(n.cta || 'Open coach')}</a>
        <button data-dismiss="${n.id}" style="background:transparent;color:rgba(255,255,255,0.8);border:none;cursor:pointer;font-size:11px;text-decoration:underline;padding:0;">Dismiss</button>
      </div>
    `;
    document.body.appendChild(b);
    b.querySelector('[data-dismiss]').addEventListener('click', () => {
      dismiss(n.id);
      b.remove();
    });
    markShown();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function check() {
    if (shownThisSession()) return;
    if (!window.appState || !window.appState.debts) return;
    const n = pickNudge();
    if (n) setTimeout(() => show(n), 6000); // Wait 6s after page settle
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
  window.addEventListener('wjp:appstate:loaded', check);

  window.WJP_Nudges = { check, dismiss, NUDGES };
})();
