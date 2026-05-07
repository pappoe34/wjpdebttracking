/* ============================================================================
   WJP Joint Accounts (W2)
   Top-tier feature: couples paying off debt together can toggle between
   "individual view" (just my debts) and "joint view" (both partners).

   This module ONLY activates if:
     • User has Pro Plus or admin tier
     • User opted in via Settings → Joint Accounts toggle (saved as
       wjp.joint.enabled = '1')

   For all other users this module is a no-op.

   When enabled:
     • Inserts a top-bar toggle: [ Individual | Joint ]
     • Persists view preference (wjp.joint.view = 'individual' | 'joint')
     • Fires 'wjp:joint:viewchanged' event for app code to re-render
     • Adds a Settings → Joint Accounts panel for partner invites

   The actual data merging happens in app code that listens for the event;
   this module is the toggle infrastructure only.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_Joint) return;

  const ENABLED_KEY = 'wjp.joint.enabled';
  const VIEW_KEY = 'wjp.joint.view';
  const PARTNER_KEY = 'wjp.joint.partnerEmail';

  function isEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch(_) { return false; }
  }

  function isAuthorized() {
    // Check tier — Pro Plus or admin only
    if (typeof window.getTier !== 'function') return false;
    const t = window.getTier();
    return t === 'plus' || t === 'admin';
  }

  function currentView() {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'joint' ? 'joint' : 'individual';
    } catch(_) { return 'individual'; }
  }

  function setView(v) {
    if (v !== 'individual' && v !== 'joint') return;
    try { localStorage.setItem(VIEW_KEY, v); } catch(_) {}
    renderToggle();
    window.dispatchEvent(new CustomEvent('wjp:joint:viewchanged', { detail: { view: v } }));
  }

  function enable() {
    try { localStorage.setItem(ENABLED_KEY, '1'); } catch(_) {}
    renderToggle();
  }

  function disable() {
    try {
      localStorage.removeItem(ENABLED_KEY);
      localStorage.removeItem(VIEW_KEY);
    } catch(_) {}
    const tog = document.getElementById('wjp-joint-toggle');
    if (tog) tog.remove();
  }

  function renderToggle() {
    if (!isEnabled() || !isAuthorized()) {
      const old = document.getElementById('wjp-joint-toggle');
      if (old) old.remove();
      return;
    }
    if (document.getElementById('wjp-joint-toggle')) return; // already rendered

    const view = currentView();
    const tog = document.createElement('div');
    tog.id = 'wjp-joint-toggle';
    tog.style.cssText = `
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      z-index: 9999; background: var(--card, #fff);
      border: 1px solid var(--border, #d8d3c4); border-radius: 999px;
      padding: 4px; display: inline-flex; gap: 2px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08); font-family: var(--sans, Inter, system-ui);
      font-size: 13px; font-weight: 700;`;
    tog.innerHTML = `
      <button data-jview="individual" style="border:none;background:${view==='individual'?'#1f7a4a':'transparent'};color:${view==='individual'?'#fff':'#5a6b5e'};padding:8px 16px;border-radius:999px;cursor:pointer;font-weight:700;font-family:inherit;font-size:inherit;">Individual</button>
      <button data-jview="joint" style="border:none;background:${view==='joint'?'#1f7a4a':'transparent'};color:${view==='joint'?'#fff':'#5a6b5e'};padding:8px 16px;border-radius:999px;cursor:pointer;font-weight:700;font-family:inherit;font-size:inherit;">Joint</button>
    `;
    tog.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => setView(btn.getAttribute('data-jview')));
    });
    document.body.appendChild(tog);
  }

  // Render on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderToggle);
  } else {
    renderToggle();
  }

  // Re-render when tier or auth state changes
  window.addEventListener('wjp:auth:changed', renderToggle);

  window.WJP_Joint = {
    isEnabled: isEnabled,
    isAuthorized: isAuthorized,
    enable: enable,
    disable: disable,
    view: currentView,
    setView: setView,
    setPartner: (email) => { try { localStorage.setItem(PARTNER_KEY, email); } catch(_) {} },
    getPartner: () => { try { return localStorage.getItem(PARTNER_KEY) || ''; } catch(_) { return ''; } }
  };
})();
