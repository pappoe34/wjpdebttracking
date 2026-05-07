/* ============================================================================
   WJP Notifications (W5) — Browser Notification API scaffold.
   No FCM yet (deferred). Uses native Notification API for desktop browsers
   + Android. iOS Safari only supports notifications when installed as PWA.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_Notifications) return;

  const PERM_KEY = 'wjp.notifications.permission';

  function isSupported() {
    return 'Notification' in window;
  }

  function permission() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  async function request() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const result = await Notification.requestPermission();
      try { localStorage.setItem(PERM_KEY, result); } catch(_) {}
      return result;
    } catch(_) { return 'error'; }
  }

  function notify(title, options) {
    if (!isSupported() || Notification.permission !== 'granted') return null;
    const opts = Object.assign({
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'wjp-default'
    }, options || {});
    try { return new Notification(title, opts); } catch(_) { return null; }
  }

  // Convenience helpers for common nudges
  function notifyPaymentReminder(billName, days, amount) {
    notify(`Payment due in ${days} days`, {
      body: `${billName} — $${amount}. Make sure your buffer's ready.`,
      tag: 'payment-reminder',
      requireInteraction: true,
      data: { type: 'payment-reminder' }
    });
  }
  function notifyMilestone(msg) {
    notify('Milestone hit 🎉', { body: msg, tag: 'milestone' });
  }
  function notifyHighAprAlert(cardName, apr) {
    notify(`${cardName} is bleeding you`, {
      body: `${apr}% APR. Open the AI Coach for a balance-transfer plan.`,
      tag: 'high-apr',
      data: { type: 'high-apr' }
    });
  }

  // Render a settings toggle for notifications
  function renderToggle(el) {
    if (!el) return;
    const p = permission();
    const isOn = p === 'granted';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:4px;">Browser notifications</div>
          <div style="font-size:12px;color:var(--ink-dim,#6b7280);line-height:1.5;">Payment reminders, milestone alerts, high-APR warnings. ${p === 'unsupported' ? 'Not supported in this browser.' : p === 'denied' ? 'You blocked notifications. Re-enable in browser settings.' : ''}</div>
        </div>
        <button id="wjp-notif-btn" ${p === 'unsupported' || p === 'denied' ? 'disabled' : ''} style="background:${isOn?'#1f7a4a':'#fff'};color:${isOn?'#fff':'#1f7a4a'};border:1px solid #1f7a4a;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">${isOn ? 'Enabled ✓' : p === 'denied' ? 'Blocked' : 'Enable'}</button>
      </div>
    `;
    const btn = document.getElementById('wjp-notif-btn');
    if (btn && !btn.disabled) {
      btn.addEventListener('click', async () => {
        const r = await request();
        if (r === 'granted') {
          notify('Notifications on', { body: 'You\'ll get alerts for payments, milestones, and big moves.' });
        }
        renderToggle(el);
      });
    }
  }

  function tryRender() {
    const el = document.querySelector('[data-wjp-notifications]');
    if (el) renderToggle(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryRender);
  else tryRender();

  window.WJP_Notifications = {
    isSupported, permission, request, notify,
    notifyPaymentReminder, notifyMilestone, notifyHighAprAlert,
    renderToggle
  };
})();
