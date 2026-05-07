/* ============================================================================
   WJP Gamification (W3) — streaks + milestones + celebration toasts.
   Tracks: weekly on-time payments, $X paid milestones, debt-killed events.
   No leaderboards yet (deferred until user count justifies — see backlog).
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpGamificationInstalled) return;
  window._wjpGamificationInstalled = true;

  const KEY_STREAK = 'wjp.streak.weeks';
  const KEY_LAST_PAY = 'wjp.streak.lastPaymentWeek';
  const KEY_MILESTONES = 'wjp.milestones.hit';
  const KEY_TOTAL_PAID = 'wjp.totalPaid';

  const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

  function weekKey(d) {
    d = d || new Date();
    const o = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - o) / 86400000);
    return d.getFullYear() + '-W' + Math.ceil((days + o.getDay() + 1) / 7);
  }
  function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch(_) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }

  function recordPayment(amount) {
    const wk = weekKey();
    const last = lsGet(KEY_LAST_PAY, '');
    if (last !== wk) {
      const cur = lsGet(KEY_STREAK, 0);
      lsSet(KEY_STREAK, cur + 1);
      lsSet(KEY_LAST_PAY, wk);
      const newStreak = cur + 1;
      if (newStreak === 4) toast('🔥 4-week streak. Keep it going.');
      if (newStreak === 12) toast('🔥🔥 12-week streak. You\'re building a habit.');
      if (newStreak === 26) toast('🔥🔥🔥 Half-year streak. Quietly extraordinary.');
      if (newStreak === 52) toast('🏆 ONE YEAR STREAK. Legendary.');
    }
    const total = lsGet(KEY_TOTAL_PAID, 0) + (Number(amount) || 0);
    lsSet(KEY_TOTAL_PAID, total);
    const hit = lsGet(KEY_MILESTONES, []);
    MILESTONES.forEach(m => {
      if (total >= m && hit.indexOf(m) === -1) {
        hit.push(m);
        lsSet(KEY_MILESTONES, hit);
        toast(`🎉 You\'ve paid $${m.toLocaleString()} toward debt-free. Real money, real progress.`);
      }
    });
  }

  function recordDebtKilled(name) {
    toast(`💥 ${name || 'A debt'} CLOSED. One down.`);
  }

  function toast(msg) {
    let t = document.getElementById('wjp-gam-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'wjp-gam-toast';
      t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(120%);background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;padding:14px 22px;border-radius:14px;font-weight:700;font-size:14px;font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,0.25);z-index:99999;transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1);max-width:90vw;text-align:center;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(120%)'; }, 4000);
  }

  function getStats() {
    return {
      streakWeeks: lsGet(KEY_STREAK, 0),
      totalPaid: lsGet(KEY_TOTAL_PAID, 0),
      milestonesHit: lsGet(KEY_MILESTONES, [])
    };
  }

  // Listen for app payment events
  window.addEventListener('wjp:payment:recorded', (e) => recordPayment(e.detail && e.detail.amount));
  window.addEventListener('wjp:debt:closed', (e) => recordDebtKilled(e.detail && e.detail.name));

  window.WJP_Gamification = { recordPayment, recordDebtKilled, toast, getStats };
})();
