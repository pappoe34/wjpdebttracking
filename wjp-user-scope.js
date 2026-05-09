/* wjp-user-scope.js — per-user storage isolation for new features.
 *
 * Why: localStorage is per-domain per-browser, NOT per-user. Two people
 * sharing a browser would see each other's data unless we namespace by
 * the authenticated user's UID. This module wraps storage helpers so all
 * keys become "wjp.foo.uid_<UID>" automatically once Firebase Auth is ready.
 *
 * Behavior when no user is authenticated yet (auth still loading or signed
 * out): falls back to bare keys so the app works during the brief auth
 * bootstrap window. Once auth is ready, future reads/writes use the scoped
 * key. Migration runs once per (user × suffix) pair to copy any existing
 * bare-key data into that user's namespace, so today's notes don't get
 * orphaned.
 *
 * Public API (window.WJP_UserScope):
 *   uid()                    -> current user's UID or null
 *   isReady()                -> true once auth has resolved (signed in or out)
 *   scopeKey(suffix)         -> namespaced key for a given suffix
 *   migrate(suffix)          -> copy bare-key data into the namespaced key
 *   get(suffix)              -> localStorage.getItem(scopeKey(suffix))
 *   set(suffix, value)       -> localStorage.setItem(scopeKey(suffix), value)
 *   remove(suffix)           -> localStorage.removeItem(scopeKey(suffix))
 *   onAuthChange(callback)   -> register a handler that fires on login/logout
 *
 * This module loads BEFORE feature modules (Notes/Edu/etc.) and they all
 * defer to it. If it fails to load, modules fall back to bare keys (existing
 * behavior) so nothing breaks — the privacy improvement is best-effort with
 * graceful degradation.
 */
(function () {
  "use strict";
  if (window._wjpUserScopeInstalled) return;
  window._wjpUserScopeInstalled = true;

  var listeners = [];
  var lastUid = null;
  var ready = false;

  function uid() {
    try {
      if (window.firebase && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u && u.uid) return String(u.uid);
      }
    } catch (_) {}
    return null;
  }

  function isReady() { return ready; }

  function scopeKey(suffix) {
    if (!suffix) return suffix;
    var u = uid();
    if (!u) return suffix; // not authenticated yet — use bare key
    return suffix + ".uid_" + u;
  }

  // Migrate bare-key data into current user's scope, ONCE per (user × suffix).
  function migrate(suffix) {
    var u = uid();
    if (!u) return;
    var migrationFlag = "wjp.scope.migrated." + suffix + ".uid_" + u;
    if (localStorage.getItem(migrationFlag)) return;
    var bare = localStorage.getItem(suffix);
    var scoped = scopeKey(suffix);
    if (bare != null && localStorage.getItem(scoped) == null) {
      try { localStorage.setItem(scoped, bare); } catch (_) {}
    }
    try { localStorage.setItem(migrationFlag, "1"); } catch (_) {}
  }

  function getItem(suffix) {
    migrate(suffix);
    return localStorage.getItem(scopeKey(suffix));
  }
  function setItem(suffix, value) {
    migrate(suffix);
    try { localStorage.setItem(scopeKey(suffix), value); } catch (_) {}
  }
  function removeItem(suffix) {
    try { localStorage.removeItem(scopeKey(suffix)); } catch (_) {}
  }

  function onAuthChange(cb) {
    if (typeof cb !== "function") return;
    listeners.push(cb);
    // Fire immediately if we already have a UID
    if (ready) {
      try { cb(uid()); } catch (_) {}
    }
  }

  function fireAuthChange() {
    var current = uid();
    if (current === lastUid && ready) return;
    lastUid = current;
    ready = true;
    listeners.forEach(function (cb) {
      try { cb(current); } catch (_) {}
    });
  }

  // Hook into Firebase Auth state changes
  function attachAuthListener() {
    try {
      if (window.firebase && firebase.auth) {
        firebase.auth().onAuthStateChanged(function () { fireAuthChange(); });
        // Also fire once with current state in case the listener
        // subscribed late (Firebase already resolved before we attached).
        setTimeout(fireAuthChange, 50);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function init() {
    if (attachAuthListener()) return;
    // Firebase not loaded yet — poll briefly
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (attachAuthListener()) { clearInterval(iv); return; }
      if (attempts > 60) { clearInterval(iv); fireAuthChange(); /* give up gracefully */ }
    }, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.WJP_UserScope = {
    uid: uid,
    isReady: isReady,
    scopeKey: scopeKey,
    migrate: migrate,
    get: getItem,
    set: setItem,
    remove: removeItem,
    onAuthChange: onAuthChange
  };
})();
