/* wjp-storage-hygiene.js v3 — privacy/security cleanup for localStorage.
 *
 * Four jobs:
 *   1. KILL the plaintext password key wjp_user_password. Wipe on load and
 *      block any future setItem call for that key.
 *   2. REDIRECT all reads/writes of the bare 'wjp_budget_state' key to the
 *      per-user scoped key (wjp_budget_state_u_<UID>) once auth is ready.
 *      This transparently fixes ~13 shim modules that hardcode the bare
 *      key without patching each one. Closes the cross-user leak surface.
 *   3. MIGRATE legacy unscoped per-user keys (wjp_credit_inputs,
 *      wjp_credit_bureau, wjp_resilience_ov, wjp_sim_state, wjp_last_*)
 *      into WJP_UserScope namespace once Firebase auth resolves.
 *   4. SCRUB on signout: remove any user-specific bare keys so they don't
 *      survive past logout.
 *
 * v3 (2026-05-21): replaces v1's "mirror scoped → bare" with "redirect bare
 * → scoped". v1's mirror was a defensive workaround that kept the leak
 * surface alive. v3 eliminates the surface entirely: bare key gets routed
 * to scoped for both reads and writes when a user is signed in.
 */
(function () {
  'use strict';
  if (window._wjpStorageHygieneInstalled) return;
  window._wjpStorageHygieneInstalled = true;

  var PER_USER_KEYS = [
    'wjp_user_password',
    'wjp_credit_inputs',
    'wjp_credit_bureau',
    'wjp_credit_linked',
    'wjp_resilience_ov',
    'wjp_sim_state',
    'wjp_last_email',
    'wjp_last_name',
    'wjp_last_user_email',
    'wjp_user_email',
    'wjp_user_name',
    'wjp_user_initials',
    'user_email',
    'wjp.aiLength',
    'wjp.aicoach.history.v1',
    'wjp.streak.v1',
    'wjp.liabilities.lastSyncAt',
    'wjp_last_bank_sync',
    'wjp_stmt_edu_dismissed',
    'wjp.bureauNotifyInterest',
    'wjp.returningCancelAt'
  ];
  var ALWAYS_KILL = [ 'wjp_user_password' ];
  var BARE_BUDGET = 'wjp_budget_state';
  var BARE_BUDGET_RE = /^wjp_budget_state(?!_u_|_legacy_orphan)/;

  // ── UID resolver shared across all proxies ─────────────────────────────
  function currentUid() {
    try {
      if (window.__wjpUser && window.__wjpUser.uid) return window.__wjpUser.uid;
      if (window.__wjpAuth && window.__wjpAuth.currentUser && window.__wjpAuth.currentUser.uid) {
        return window.__wjpAuth.currentUser.uid;
      }
      if (window.firebase && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u && u.uid) return u.uid;
      }
    } catch (_) {}
    return null;
  }
  function scopedKey(uid) { return 'wjp_budget_state_u_' + uid; }

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

  // ── Install setItem + getItem proxies that redirect bare → scoped ──────
  function installStorageProxies() {
    try {
      if (localStorage.setItem.__wjpV3Proxy) return;
      var origSet = localStorage.setItem.bind(localStorage);
      var origGet = localStorage.getItem.bind(localStorage);
      var origRemove = localStorage.removeItem.bind(localStorage);

      var newSet = function (key, value) {
        if (ALWAYS_KILL.indexOf(key) !== -1) {
          try { console.warn('[wjp-storage-hygiene] Blocked write to security-risk key: ' + key); } catch (_) {}
          return;
        }
        // Redirect bare wjp_budget_state writes → scoped per-user key.
        // Without an authenticated user we fall back to the bare key so the
        // pre-auth bootstrap window still works; once auth-ready fires, the
        // bare key gets retired by app.js's migrateAnonStateToUser().
        if (key === BARE_BUDGET) {
          var uid = currentUid();
          if (uid) {
            return origSet(scopedKey(uid), value);
          }
        }
        return origSet(key, value);
      };
      var newGet = function (key) {
        if (key === BARE_BUDGET) {
          var uid = currentUid();
          if (uid) {
            return origGet(scopedKey(uid));
          }
        }
        return origGet(key);
      };
      var newRemove = function (key) {
        // Redirect removes of bare key while authenticated → no-op on bare,
        // but explicitly remove the scoped key (rare; mostly defensive).
        if (key === BARE_BUDGET) {
          var uid = currentUid();
          if (uid) return origRemove(scopedKey(uid));
        }
        return origRemove(key);
      };
      newSet.__wjpV3Proxy = true;
      newGet.__wjpV3Proxy = true;
      newRemove.__wjpV3Proxy = true;
      localStorage.setItem = newSet;
      localStorage.getItem = newGet;
      localStorage.removeItem = newRemove;
      try { console.log('[wjp-storage-hygiene v3] storage proxies installed'); } catch (_) {}
    } catch (_) {}
  }

  // ── One-time: retire the bare 'wjp_budget_state' key once a user is auth'd ─
  // app.js's migrateAnonStateToUser() also does this, but we belt-and-suspender
  // it here to cover modules loading before app.js finishes booting.
  function retireBareBudget() {
    try {
      var uid = currentUid();
      if (!uid) return;
      // Bypass the proxy by reading raw localStorage via the prototype.
      var raw = Object.getPrototypeOf(localStorage).getItem.call(localStorage, BARE_BUDGET);
      if (!raw) return;
      // Mirror to orphan + scoped (whichever is missing), then nuke bare.
      var scoped = Object.getPrototypeOf(localStorage).getItem.call(localStorage, scopedKey(uid));
      Object.getPrototypeOf(localStorage).setItem.call(localStorage, 'wjp_budget_state_legacy_orphan', raw);
      if (!scoped) {
        // No scoped data for this user yet — only seed scoped if the bare
        // blob looks like it belongs to this user (email match) OR has no
        // email at all. Don't taint a new user with another user's state.
        var shouldSeed = true;
        try {
          var parsed = JSON.parse(raw);
          var bareEmail = String((parsed && parsed.profile && parsed.profile.email) || '').toLowerCase();
          var currEmail = String((window.__wjpUser && window.__wjpUser.email) || '').toLowerCase();
          if (bareEmail && currEmail && bareEmail !== currEmail) shouldSeed = false;
        } catch (_) {}
        if (shouldSeed) {
          Object.getPrototypeOf(localStorage).setItem.call(localStorage, scopedKey(uid), raw);
        }
      }
      Object.getPrototypeOf(localStorage).removeItem.call(localStorage, BARE_BUDGET);
      try { console.log('[wjp-storage-hygiene v3] retired bare wjp_budget_state → orphan'); } catch (_) {}
    } catch (_) {}
  }

  // ── Migrate legacy bare per-user keys to user-scoped on signin ─────────
  function migrateBareKeysToScope(uid) {
    if (!uid || !window.WJP_UserScope) return;
    PER_USER_KEYS.forEach(function (key) {
      if (ALWAYS_KILL.indexOf(key) !== -1) return;
      if (key === BARE_BUDGET) return; // handled by retireBareBudget
      try {
        var migrationFlag = 'wjp.storageMig.' + key + '.uid_' + uid;
        if (localStorage.getItem(migrationFlag)) return;
        var bare = Object.getPrototypeOf(localStorage).getItem.call(localStorage, key);
        if (bare !== null) {
          var scopedExisting = window.WJP_UserScope.get(key);
          if (scopedExisting == null) window.WJP_UserScope.set(key, bare);
          Object.getPrototypeOf(localStorage).removeItem.call(localStorage, key);
        }
        Object.getPrototypeOf(localStorage).setItem.call(localStorage, migrationFlag, '1');
      } catch (_) {}
    });
  }

  // ── On signout, wipe per-user bare keys so next user can't see them ───
  var lastUid = null;
  function onAuthCheck() {
    var currentUidNow = currentUid();
    if (currentUidNow && currentUidNow !== lastUid) {
      retireBareBudget();
      migrateBareKeysToScope(currentUidNow);
      lastUid = currentUidNow;
    } else if (!currentUidNow && lastUid) {
      PER_USER_KEYS.forEach(function (key) {
        try { Object.getPrototypeOf(localStorage).removeItem.call(localStorage, key); } catch (_) {}
      });
      try { Object.getPrototypeOf(localStorage).removeItem.call(localStorage, BARE_BUDGET); } catch (_) {}
      lastUid = null;
    }
  }

  // ── Wrap getStateKey for defense-in-depth (app.js v131-uidfix already does this) ─
  function wrapGetStateKey() {
    if (typeof window.getStateKey !== 'function') return false;
    if (window.getStateKey.__wjpStableWrapped) return true;
    var orig = window.getStateKey;
    var wrapped = function () {
      var uid = currentUid();
      if (uid) return scopedKey(uid);
      return orig.apply(this, arguments);
    };
    wrapped.__wjpStableWrapped = true;
    window.getStateKey = wrapped;
    return true;
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  killPasswordKey();
  installStorageProxies();
  setInterval(killPasswordKey, 5000);

  function boot() {
    wrapGetStateKey();
    onAuthCheck();
  }
  boot();
  setInterval(boot, 1000);

  if (window.WJP_UserScope && typeof window.WJP_UserScope.onAuthChange === 'function') {
    window.WJP_UserScope.onAuthChange(function (uid) {
      onAuthCheck();
    });
  }
  window.addEventListener('wjp-auth-ready', function () { onAuthCheck(); });

  window.WJP_StorageHygiene = {
    perUserKeys: PER_USER_KEYS,
    alwaysKill: ALWAYS_KILL,
    currentUid: currentUid,
    retireBareBudget: retireBareBudget,
    version: 3
  };
})();
