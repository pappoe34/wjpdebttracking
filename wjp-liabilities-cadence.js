/* wjp-liabilities-cadence.js v3 — Auto-schedule Plaid Liabilities sync.
 *
 * COST MODEL: Plaid bills /liabilities/get on-demand at $0.10/call.
 * To keep average user spend low, we sync at most ONCE per calendar month
 * per user, anchored to the first 3 days of the month. After day 3 of
 * the month, we won't auto-fire even if "30 days have passed" — we wait
 * for the next month's anchor window.
 *
 * Tier matrix:
 *   - Pro Plus / Admin: monthly anchored sync (~$0.10/card/mo on-demand)
 *   - Pro:              monthly anchored sync (same)
 *   - Free:             never auto (manual upload only)
 *
 * Anchor window: day-of-month 1–3 inclusive. If user opens the app any time
 * during that window AND last sync was in a prior calendar month, we sync.
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
  var ANCHOR_DAYS = 3; // sync if today's date is day 1-3 of the month

  // Tiers that get auto-sync at all. Free is excluded by tier gate elsewhere.
  var AUTO_SYNC_TIERS = { plus: true, admin: true, pro: true };

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
      if (window.__wjpAuth && window.__wjpAuth.currentUser) return true;
    } catch (_) {}
    try { if (window.WJP_IS_ADMIN === true) return true; } catch (_) {}
    return false;
  }

  // Returns YYYY-MM string for a timestamp (or now if omitted).
  function yyyymm(ts) {
    var d = ts ? new Date(ts) : new Date();
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m);
  }

  function isAnchorWindow() {
    var d = new Date();
    return d.getDate() >= 1 && d.getDate() <= ANCHOR_DAYS;
  }

  function syncedThisMonth() {
    var last = getLastSync();
    if (!last) return false;
    return yyyymm(last) === yyyymm();
  }

  function shouldAutoSync() {
    var tier = getTier();
    if (!tier || !AUTO_SYNC_TIERS[tier]) return false;
    if (syncedThisMonth()) return false; // already synced this calendar month
    // Allow first-ever sync any time. After that, only fire during anchor window.
    if (getLastSync() === 0) {
      // Don't pile on at signup — wait until anchor window to spread cost.
      if (!isAnchorWindow()) return false;
    } else {
      if (!isAnchorWindow()) return false;
    }
    var lastAttempt = getLastAutoAttempt();
    // Cooldown: 6 hr between attempts to avoid hammering on silent failures.
    if (Date.now() - lastAttempt < 6 * 60 * 60 * 1000) return false;
    return true;
  }

  function tryAutoSync() {
    try {
      if (!isAuthReady()) return;
      if (!shouldAutoSync()) return;
      var sync = window.WJP_LiabilitiesSync;
      if (!sync || typeof sync.syncNow !== 'function') return;
      setLastAutoAttempt();
      try { console.log('[wjp-liabilities-cadence v3] monthly anchor sync for tier=' + getTier()); } catch (_) {}
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

  function nextSyncLabel() {
    if (syncedThisMonth()) {
      var d = new Date();
      var nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      var opts = { month: 'short', day: 'numeric' };
      return 'Next: ' + nextMonth.toLocaleDateString('en-US', opts);
    }
    if (!isAnchorWindow()) {
      var dd = new Date();
      var firstNext = new Date(dd.getFullYear(), dd.getMonth() + 1, 1);
      return 'Next: ' + firstNext.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return 'Next: in this anchor window';
  }

  function tierCadenceLabel() {
    var t = getTier();
    if (t === 'plus' || t === 'admin') return 'Auto-sync: monthly (1st)';
    if (t === 'pro') return 'Auto-sync: monthly (1st)';
    if (t === 'free') return 'Manual upload only — upgrade to auto-sync';
    return null;
  }

  function injectStatusPills() {
    try {
      var label = freshnessLabel();
      var nxt = nextSyncLabel();
      var cadence = tierCadenceLabel();
      var anchor = document.getElementById('wjp-liabilities-sync-card')
        || document.querySelector('[data-settings-panel="linked"], #linked-accounts-panel, #settings-linked-panel');
      if (!anchor) return;
      var existing = anchor.querySelector('.wjp-lc-pill');
      var html = ''
        + '<div class="wjp-lc-pill" style="display:inline-flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-family:Inter,system-ui,sans-serif;">'
        +   '<span style="font-size:11px;letter-spacing:0.05em;background:rgba(31,122,74,0.08);color:var(--accent,#1f7a4a);padding:4px 10px;border-radius:999px;font-weight:600;">' + label + '</span>'
        +   '<span style="font-size:11px;letter-spacing:0.05em;background:rgba(0,0,0,0.05);color:var(--ink-dim,#6b7280);padding:4px 10px;border-radius:999px;font-weight:600;">' + nxt + '</span>'
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
    var attempts = 0;
    function tryBoot() {
      attempts++;
      if (isAuthReady() && getTier()) {
        tryAutoSync();
        injectStatusPills();
        setInterval(function () { try { tryAutoSync(); injectStatusPills(); } catch (_) {} }, 30 * 60 * 1000);
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
    freshnessLabel: freshnessLabel,
    syncedThisMonth: syncedThisMonth,
    isAnchorWindow: isAnchorWindow,
    version: 3
  };
})();
