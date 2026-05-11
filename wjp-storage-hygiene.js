/* wjp-storage-hygiene.js v1 — privacy/security cleanup for localStorage.
 *
 * Three jobs:
 *   1. KILL the plaintext password key wjp_user_password (legacy onboarding
 *      flow stored passwords in clear text). Wipe on load and block any
 *      future setItem call for that key.
 *   2. MIGRATE legacy unscoped per-user keys (wjp_credit_inputs,
 *      wjp_credit_bureau, wjp_resilience_ov, wjp_sim_state, wjp_last_*)
 *      into WJP_UserScope namespace once Firebase auth resolves. Bare keys
 *      get wiped on signout so the next user doesn't inherit them.
 *   3. SCRUB on signout: remove any user-specific bare keys that other code
 *      may still write, so they don't survive past a logout.
 *
 * This is defensive — the right long-term fix is to migrate app.js to use
 * WJP_UserScope everywhere, but app.js is too large to refactor safely
 * pre-launch. This module catches the leak surfaces without modifying
 * app.js code paths.
 */
(function () {
  'use strict';
  if (window._wjpStorageHygieneInstalled) return;
  window._wjpStorageHygieneInstalled = true;

  // Per-user keys that should NEVER persist across users
  var PER_USER_KEYS = [
    'wjp_user_password',          // 🔴 plaintext — kill always
    'wjp_credit_inputs',          // credit score data
    'wjp_credit_bureau',          // bureau connection
    'wjp_credit_linked',
    'wjp_resilience_ov',          // resilience overrides
    'wjp_sim_state',              // simulator state
    'wjp_last_email',             // identity bleed
    'wjp_last_name',
    'wjp_last_user_email',
    'wjp_user_email',
    'wjp_user_name',
    'wjp_user_initials',
    'user_email',
    'wjp.aiLength',               // ai prefs are per-user
    'wjp.aicoach.history.v1',
    'wjp.streak.v1',
    'wjp.liabilities.lastSyncAt',
    'wjp_last_bank_sync',
    'wjp_stmt_edu_dismissed',
    'wjp.bureauNotifyInterest',
    'wjp.returningCancelAt'
  ];

  // Keys that should be ALWAYS removed regardless of auth state (security)
  var ALWAYS_KILL = [ 'wjp_user_password' ];

  // ── Kill plaintext password unconditionally ─────────────────────────────
  function killPasswordKey() {
    try {
      ALWAYS_KILL.forEach(function (k) {
        if (localStorage.getItem(k) !== null) {
          try { console.warn('[wjp-storage-hygiene] Removing security-risk key: ' + k); } catch (_) {}
          localStorage.removeItem(k);
        }
      });
    } catch (_) {}
  }

  // Intercept future setItem to block writes to ALWAYS_KILL keys
  function installSetItemBlock() {
    try {
      var origSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        if (ALWAYS_KILL.indexOf(key) !== -1) {
          try { console.warn('[wjp-storage-hygiene] Blocked write to security-risk key: ' + key); } catch (_) {}
          return; // silently no-op
        }
        return origSet(key, value);
      };
    } catch (_) {}
  }

  // ── Migrate legacy bare keys to user-scoped on signin ───────────────────
  function migrateBareKeysToScope(uid) {
    if (!uid || !window.WJP_UserScope) return;
    PER_USER_KEYS.forEach(function (key) {
      if (ALWAYS_KILL.indexOf(key) !== -1) return; // already handled
      try {
        var migrationFlag = 'wjp.storageMig.' + key + '.uid_' + uid;
        if (localStorage.getItem(migrationFlag)) return; // already migrated for this user
        var bare = localStorage.getItem(key);
        if (bare !== null) {
          // Copy bare value into scoped namespace if not already there
          var scopedExisting = window.WJP_UserScope.get(key);
          if (scopedExisting == null) {
            window.WJP_UserScope.set(key, bare);
          }
          // Remove bare key so the next user doesn't inherit
          localStorage.removeItem(key);
        }
        localStorage.setItem(migrationFlag, '1');
      } catch (_) {}
    });
  }

  // ── On signout, wipe bare per-user keys so next user doesn't see them ──
  var lastUid = null;
  function onAuthCheck() {
    var currentUid = null;
    try {
      if (window.WJP_UserScope && typeof window.WJP_UserScope.uid === 'function') {
        currentUid = window.WJP_UserScope.uid();
      }
    } catch (_) {}

    if (currentUid && currentUid !== lastUid) {
      // Signed in (or user changed) — run migration
      migrateBareKeysToScope(currentUid);
      lastUid = currentUid;
    } else if (!currentUid && lastUid) {
      // Signed out — wipe all per-user bare keys
      PER_USER_KEYS.forEach(function (key) {
        try { localStorage.removeItem(key); } catch (_) {}
      });
      // Also wipe the bare budget state since app.js has a user-scoped variant
      try { localStorage.removeItem('wjp_budget_state'); } catch (_) {}
      lastUid = null;
    }
  }

  // ── Wrap getStateKey so wjp_budget_state actually scopes per user ──────
  // The app's getStateKey() reads window.firebase.auth().currentUser which
  // doesn't exist (the app uses Firebase v9 modular SDK exposed at
  // window.__wjpUser). So getStateKey always returns the bare key —
  // meaning two users on the same browser share the SAME budget state.
  // This is the legal-risk leak. Fix: wrap getStateKey to use real auth.
  function wrapGetStateKey() {
    if (typeof window.getStateKey !== 'function') return false;
    if (window.getStateKey.__wjpStableWrapped) return true;
    var orig = window.getStateKey;
    var wrapped = function () {
      try {
        var uid = null;
        if (window.__wjpUser && window.__wjpUser.uid) uid = window.__wjpUser.uid;
        else if (window.__wjpAuth && window.__wjpAuth.currentUser && window.__wjpAuth.currentUser.uid) uid = window.__wjpAuth.currentUser.uid;
        if (uid) return 'wjp_budget_state_u_' + uid;
      } catch (_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__wjpStableWrapped = true;
    window.getStateKey = wrapped;
    return true;
  }

  // One-time migration: if bare wjp_budget_state has data and the user is
  // signed in but the user-scoped key is empty, copy bare → scoped, then
  // remove bare so the next user doesn't see it.
  function migrateBudgetStateToScope() {
    try {
      var uid = null;
      if (window.__wjpUser && window.__wjpUser.uid) uid = window.__wjpUser.uid;
      if (!uid) return;
      var bareKey = 'wjp_budget_state';
      var scopedKey = 'wjp_budget_state_u_' + uid;
      var bare = localStorage.getItem(bareKey);
      var scoped = localStorage.getItem(scopedKey);
      if (bare !== null && scoped === null) {
        localStorage.setItem(scopedKey, bare);
        try { console.log('[wjp-storage-hygiene] Migrated bare wjp_budget_state → ' + scopedKey); } catch (_) {}
      }
      // Always remove the bare key — the wrap ensures future writes go to scoped
      if (bare !== null) localStorage.removeItem(bareKey);
    } catch (_) {}
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  killPasswordKey();
  installSetItemBlock();
  setInterval(killPasswordKey, 5000);

  // Wrap getStateKey ASAP and keep re-wrapping in case app.js reassigns it.
  // First-time wrap also triggers a budget-state migration to scoped key.
  function bootScope() {
    var wrapped = wrapGetStateKey();
    if (wrapped) migrateBudgetStateToScope();
    return wrapped;
  }
  bootScope();
  setInterval(bootScope, 1000);

  // Watch auth state — when user signs in, migrate; when out, clear bare keys.
  if (window.WJP_UserScope && typeof window.WJP_UserScope.onAuthChange === 'function') {
    window.WJP_UserScope.onAuthChange(function (uid) {
      onAuthCheck();
      if (uid) migrateBudgetStateToScope();
    });
  }
  setInterval(onAuthCheck, 1500);

  window.WJP_StorageHygiene = {
    perUserKeys: PER_USER_KEYS,
    alwaysKill: ALWAYS_KILL,
    killPasswordKey: killPasswordKey,
    migrateNow: function () { onAuthCheck(); migrateBudgetStateToScope(); },
    wrapGetStateKey: wrapGetStateKey
  };
})();
