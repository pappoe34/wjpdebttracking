/* wjp-liabilities-cadence.js — Auto-schedule Plaid Liabilities sync.
 *
 * The /sync-liabilities endpoint + manual "Sync now" button shipped in
 * commit 103bacdd, but there was no automatic cadence. This module wires
 * the cadence per tier:
 *   - Pro Plus / Admin: re-sync if last sync > 30 days ago
 *   - Pro:              re-sync if last sync > 90 days ago (~quarterly)
 *   - Free:             never auto (manual upload only — already enforced
 *                       by tier gate in /sync-liabilities backend)
 *
 * On dashboard load, checks `wjp.liabilities.lastSyncAt` localStorage
 * (already written by wjp-liabilities-sync.js when manual sync runs) and
 * fires syncNow() if past the cadence threshold for the user's tier.
 *
 * Surfaces a small inline status: "Last synced N days ago" near the
 * Settings → Linked Accounts panel and the dashboard +Add menu.
 *
 * Hardened: IIFE, idempotent, path-guarded, no MutationObservers, polled
 * once on boot + once every 30 minutes (handles long-lived tabs).
 */
(function () {
  'use strict';
  if (window._wjpLiabilitiesCadenceInstalled) return;
  window._wjpLiabilitiesCadenceInstalled = true;

  // Path guard
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var DAY_MS = 24 * 60 * 60 * 1000;
  var THRESHOLDS = {
    plus:  30 * DAY_MS,  // Pro Plus: monthly
    admin: 30 * DAY_MS,  // Admin treated as Plus for sync purposes
    pro:   90 * DAY_MS,  // Pro: quarterly
    free:  Infinity      // Free: never auto
  };

  var LS_LAST_SYNC = 'wjp.liabilities.lastSyncAt';
  var LS_LAST_AUTO_ATTEMPT = 'wjp.liabilities.lastAutoAttemptAt';

  function getTier() {
    try {
      if (typeof window.getTier === 'function') {
        var t = window.getTier();
        if (t) return String(t).toLowerCase();
      }
    } catch (_) {}
    return null;
  }

  function getLastSync() {
    try {
      var v = parseInt(localStorage.getItem(LS_LAST_SYNC) || '0', 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (_) { return 0; }
  }

  function getLastAutoAttempt() {
    try {
      var v = parseInt(localStorage.getItem(LS_LAST_AUTO_ATTEMPT) || '0', 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (_) { return 0; }
  }

  function setLastAutoAttempt() {
    try { localStorage.setItem(LS_LAST_AUTO_ATTEMPT, String(Date.now())); } catch (_) {}
  }

  function isAuthReady() {
    try {
      if (window.firebase && window.firebase.auth) {
        var auth = window.firebase.auth();
        if (auth && auth.currentUser) return true;
      }
    } catch (_) {}
    try { if (window.WJP_IS_ADMIN === true) return true; } catch (_) {}
    return false;
  }

  function shouldAutoSync() {
    var tier = getTier();
    if (!tier) return false;
    var threshold = THRESHOLDS[tier];
    if (threshold == null || threshold === Infinity) return false;
    var lastSync = getLastSync();
    var lastAttempt = getLastAutoAttempt();
    var now = Date.now();
    // Don't re-attempt within 6 hours of the last attempt — avoids
    // hammering the backend if the sync is silently failing.
    if (now - lastAttempt < 6 * 60 * 60 * 1000) return false;
    return (now - lastSync) > threshold;
  }

  function tryAutoSync() {
    try {
      if (!isAuthReady()) return;
      if (!shouldAutoSync()) return;
      // The manual sync module exposes window.WJP_LiabilitiesSync.syncNow()
      // (per commit 103bacdd) — defer to that.
      var sync = window.WJP_LiabilitiesSync;
      if (!sync || typeof sync.syncNow !== 'function') return;
      setLastAutoAttempt();
      try { console.log('[wjp-liabilities-cadence] auto-syncing for tier=' + getTier()); } catch (_) {}
      // Fire and forget — the existing module handles its own UI/refresh
      Promise.resolve(sync.syncNow()).catch(function (e) {
        try { console.warn('[wjp-liabilities-cadence] auto sync failed', e); } catch (_) {}
      });
    } catch (e) {
      try { console.warn('[wjp-liabilities-cadence] threw', e); } catch (_) {}
    }
  }

  // === Inline freshness label ===
  function freshnessLabel() {
    var lastSync = getLastSync();
    if (!lastSync) return 'Never synced';
    var days = Math.floor((Date.now() - lastSync) / DAY_MS);
    if (days === 0) return 'Synced today';
    if (days === 1) return 'Synced yesterday';
    if (days < 30) return 'Synced ' + days + ' days ago';
    var months = Math.floor(days / 30);
    return months === 1 ? 'Synced ~1 month ago' : 'Synced ~' + months + ' months ago';
  }

  function tierCadenceLabel() {
    var t = getTier();
    if (t === 'plus' || t === 'admin') return 'Auto-sync: monthly';
    if (t === 'pro') return 'Auto-sync: quarterly';
    if (t === 'free') return 'Manual upload only — upgrade to auto-sync';
    return null;
  }

  function injectStatusPills() {
    try {
      var label = freshnessLabel();
      var cadence = tierCadenceLabel();
      // Find the Linked Accounts settings card (existing wjp-liabilities-sync.js
      // injects a "Sync now" button there) and add the freshness label next to it.
      var anchor = document.getElementById('wjp-liabilities-sync-card')
        || document.querySelector('[data-settings-panel="linked"], #linked-accounts-panel, #settings-linked-panel');
      if (!anchor) return;
      var existing = anchor.querySelector('.wjp-lc-pill');
      var html = ''
        + '<div class="wjp-lc-pill" style="display:inline-flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-family:Inter,system-ui,sans-serif;">'
        +   '<span style="font-size:11px;letter-spacing:0.05em;background:rgba(31,122,74,0.08);color:var(--accent,#1f7a4a);padding:4px 10px;border-radius:999px;font-weight:600;">' + label + '</span>'
        +   (cadence ? '<span style="font-size:11px;letter-spacing:0.05em;background:rgba(0,0,0,0.05);color:var(--ink-dim,#6b7280);padding:4px 10px;border-radius:999px;font-weight:600;">' + cadence + '</span>' : '')
        + '</div>';
      if (existing) {
        existing.outerHTML = html;
      } else {
        anchor.insertAdjacentHTML('beforeend', html);
      }
    } catch (_) {}
  }

  function boot() {
    // Wait for auth + tier resolver
    var attempts = 0;
    function tryBoot() {
      attempts++;
      if (isAuthReady() && getTier()) {
        tryAutoSync();
        injectStatusPills();
        // Periodic re-check (every 30 min) for long-lived tabs
        setInterval(function () { try { tryAutoSync(); injectStatusPills(); } catch (_) {} }, 30 * 60 * 1000);
        // Also re-inject pills periodically since Settings panel may mount lazily
        setInterval(injectStatusPills, 3000);
        return;
      }
      if (attempts < 30) setTimeout(tryBoot, 1000);
    }
    tryBoot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  } else {
    setTimeout(boot, 1500);
  }

  window.WJP_LiabilitiesCadence = {
    shouldAutoSync: shouldAutoSync,
    forceSync: tryAutoSync,
    freshnessLabel: freshnessLabel
  };
})();
