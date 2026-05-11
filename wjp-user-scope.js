/* wjp-user-scope.js v2 — per-user storage isolation (Firebase v9 modular SDK) for new features.
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
      // Real auth pattern (index.html uses Firebase v9 modular SDK and
      // exposes the User object at window.__wjpUser, Auth at window.__wjpAuth).
      if (window.__wjpUser && window.__wjpUser.uid) return String(window.__wjpUser.uid);
      if (window.__wjpAuth && window.__wjpAuth.currentUser && window.__wjpAuth.currentUser.uid) return String(window.__wjpAuth.currentUser.uid);
      // Legacy compat SDK fallback (just in case)
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
    var attached = false;
    // 1. Listen for the custom event dispatched by index.html when auth resolves
    try {
      window.addEventListener('wjp-auth-ready', function () { fireAuthChange(); });
      attached = true;
    } catch (_) {}
    // 2. If Firebase v9 modular Auth object is already exposed, attach
    //    onAuthStateChanged (instance method works on v9 Auth objects).
    try {
      if (window.__wjpAuth && typeof window.__wjpAuth.onAuthStateChanged === 'function') {
        window.__wjpAuth.onAuthStateChanged(function () { fireAuthChange(); });
        attached = true;
      }
    } catch (_) {}
    // 3. Legacy compat SDK
    try {
      if (window.firebase && firebase.auth && typeof firebase.auth().onAuthStateChanged === 'function') {
        firebase.auth().onAuthStateChanged(function () { fireAuthChange(); });
        attached = true;
      }
    } catch (_) {}
    // 4. Fire immediately if we already have a UID (caller subscribed late)
    if (uid()) setTimeout(fireAuthChange, 50);
    return attached;
  }

  function init() {
    attachAuthListener();
    // v2: continuously watch for UID changes (signin/signout). Cheap — just
    // a polling check against window.__wjpUser. The listener-based path is
    // still preferred but this is a belt-and-suspenders safety net.
    setInterval(function () {
      var current = uid();
      if (current !== lastUid) fireAuthChange();
    }, 1000);
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
