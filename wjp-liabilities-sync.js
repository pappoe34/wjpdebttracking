/* ============================================================================
   WJP Plaid Liabilities Sync (Pro Plus feature)
   Adds a "Sync from Plaid" button that pulls fresh APR/balance/statement/due
   date data from Plaid Liabilities and updates linked debt records.

   GATING: only renders for Pro Plus or admin tier.
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpLiabSyncInstalled) return;
  window._wjpLiabSyncInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch(_) {}

  function isProPlusOrAdmin() {
    try {
      if (window.WJP_IS_ADMIN) return true;
      if (typeof window.getTier === 'function') {
        var t = window.getTier();
        return t === 'plus' || t === 'admin';
      }
    } catch(_) {}
    return false;
  }

  async function getIdToken() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return await u.getIdToken();
      }
    } catch(_) {}
    return null;
  }

  async function syncNow(opts) {
    opts = opts || {};
    var token = await getIdToken();
    if (!token) {
      flashToast('Sign in required');
      return null;
    }
    var btnEl = opts.button;
    var origText = btnEl ? btnEl.textContent : null;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Syncing…'; }

    try {
      var resp = await fetch('/.netlify/functions/sync-liabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ itemId: opts.itemId || null })
      });
      var data = await resp.json();
      if (!resp.ok) {
        if (resp.status === 403) {
          flashToast('Pro Plus required for Liabilities sync', 'red');
        } else {
          flashToast('Sync failed: ' + (data.error || 'unknown'), 'red');
        }
        return data;
      }
      var msg = data.debtsUpdated + ' debt' + (data.debtsUpdated === 1 ? '' : 's') + ' updated';
      if (data.unmatchedAccounts > 0) msg += ' · ' + data.unmatchedAccounts + ' account' + (data.unmatchedAccounts === 1 ? '' : 's') + ' need linking';
      flashToast('✓ ' + msg, 'green');
      // Persist last-sync timestamp client-side too (for UI display)
      try { localStorage.setItem('wjp.liabilities.lastSyncAt', String(Date.now())); } catch(_) {}
      // Trigger re-render
      try { if (typeof window.updateUI === 'function') setTimeout(window.updateUI, 300); } catch(_) {}
      return data;
    } catch(e) {
      flashToast('Network error during sync', 'red');
      return null;
    } finally {
      if (btnEl && origText != null) {
        setTimeout(function() {
          btnEl.disabled = false;
          btnEl.textContent = origText;
        }, 1200);
      }
    }
  }

  function flashToast(msg, color) {
    try {
      var bg = color === 'red' ? '#c0594a' : color === 'green' ? '#1f7a4a' : '#1f7a4a';
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;background:' + bg + ';color:#fff;padding:11px 18px;border-radius:10px;' +
        'font-weight:700;font-size:13px;font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.remove(); }, 4000);
    } catch(_) {}
  }

  function fmtAge(ts) {
    if (!ts) return 'never';
    var mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    return Math.floor(hrs / 24) + ' day' + (hrs >= 48 ? 's' : '') + ' ago';
  }

  function lastSyncTs() {
    try { return parseInt(localStorage.getItem('wjp.liabilities.lastSyncAt') || '0', 10); }
    catch(_) { return 0; }
  }

  // ---- Settings panel injection ----
  var SETTINGS_CARD_ID = 'wjp-liab-settings-card';

  function onSettings() {
    try {
      var h = (location.hash || '').toLowerCase();
      return h.indexOf('settings') !== -1 ||
             !!document.querySelector('[data-settings-content], .settings-panel');
    } catch(_) { return false; }
  }

  function injectSettingsCard() {
    if (!onSettings()) return;
    if (!isProPlusOrAdmin()) return;
    if (document.getElementById(SETTINGS_CARD_ID)) return;

    // Find a settings host
    var host = document.querySelector('[data-settings-content], #settings-content, .settings-panel');
    if (!host) return;

    var card = document.createElement('div');
    card.id = SETTINGS_CARD_ID;
    card.style.cssText = 'background:linear-gradient(135deg,rgba(31,122,74,0.06),rgba(43,155,114,0.03));' +
      'border:1px solid rgba(31,122,74,0.20);border-radius:12px;padding:18px 22px;' +
      'margin:14px 0;font-family:inherit;font-size:13px;';

    var lastTs = lastSyncTs();
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div style="flex:1;min-width:200px;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">Auto-sync statement data</div>' +
            '<span style="font-size:10px;background:#1f7a4a;color:#fff;padding:2px 8px;border-radius:999px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;">Pro Plus</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--ink-dim,#6b7280);line-height:1.5;">Pull fresh APR, balance, statement date, due date, and minimum payment from Plaid Liabilities. Runs on demand. Your debts stay current without uploading statements manually.</div>' +
        '</div>' +
        '<button type="button" id="wjp-liab-sync-btn" style="background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9"/></svg>' +
          'Sync now' +
        '</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--ink-dim,#6b7280);padding-top:10px;border-top:1px solid var(--border,#e5e7eb);">' +
        'Last sync: <strong style="color:var(--ink,#0a0a0a);">' + fmtAge(lastTs) + '</strong>' +
        ' · Only debts that were imported from Plaid (not manually added) get auto-updated.' +
      '</div>';

    host.appendChild(card);

    var btn = document.getElementById('wjp-liab-sync-btn');
    if (btn) btn.onclick = function() { syncNow({ button: btn }); };
  }

  function start() {
    setInterval(function() {
      try { injectSettingsCard(); } catch(_) {}
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_LiabilitiesSync = {
    syncNow: function() { return syncNow({}); },
    isAuthorized: isProPlusOrAdmin,
    lastSyncTs: lastSyncTs
  };
})();
