/* wjp-admin-resolver.js v1 — 2026-05-19
 *
 * SINGLE SOURCE OF TRUTH for admin detection. Replaces window.WJP_IS_ADMIN
 * with a getter that resolves from THREE sources, in order:
 *   1. Runtime flag — set by app.js's fetchAdminStatus() after a successful
 *      /.netlify/functions/admin-status response.
 *   2. Persisted Firestore state — appState.subscription.isAdmin.
 *   3. Hardcoded admin email allowlist — last-resort fallback when the
 *      backend endpoint is failing (e.g., Firebase quota exhausted).
 *
 * Why this is needed: when admin-status returns 500 (Firebase quota), the
 * runtime flag stays false. Every gate module that checks ONLY that flag
 * (free-tier-gate, ai-free-gate, trial-banner, plus 4+ inline checks in
 * app.js) treats admin users as free tier — showing upgrade nags and trial
 * banners they shouldn't see. With this resolver, every read of
 * window.WJP_IS_ADMIN is routed through the multi-source check, so all
 * gates immediately become admin-aware without touching each module.
 *
 * Also exposes window.WJP_isAdmin() as a function form for new code.
 *
 * Loads as early as possible (script tag near top of index.html) so the
 * getter is in place before any gate module first reads WJP_IS_ADMIN.
 */
(function () {
  "use strict";
  if (window._wjpAdminResolverInstalled) return;
  window._wjpAdminResolverInstalled = true;

  // Hardcoded admin allowlist. Keep small. Used only as a fallback when
  // backend admin-status is unavailable (quota exceeded, network failure).
  var ADMIN_EMAILS = [
    "pappoe34@gmail.com",
    "winstonpappoe01@gmail.com"
  ].map(function (e) { return e.toLowerCase(); });

  // The current user email — pulled from Firebase Auth user object.
  function currentEmail() {
    try {
      if (window.__wjpUser && window.__wjpUser.email) return String(window.__wjpUser.email).toLowerCase();
      if (window.__wjpAuth && window.__wjpAuth.currentUser && window.__wjpAuth.currentUser.email) {
        return String(window.__wjpAuth.currentUser.email).toLowerCase();
      }
    } catch (_) {}
    return null;
  }

  // The three sources, OR'd together.
  function resolve() {
    try {
      // 1. Runtime flag set by app.js fetchAdminStatus
      if (window._wjpAdminRuntimeFlag === true) return true;
      // 2. Persisted in Firestore appState
      if (window.appState && window.appState.subscription && window.appState.subscription.isAdmin) return true;
      // 3. Hardcoded admin email fallback
      var em = currentEmail();
      if (em && ADMIN_EMAILS.indexOf(em) >= 0) return true;
    } catch (_) {}
    return false;
  }

  // Function-form API for new code
  window.WJP_isAdmin = resolve;

  // Intercept window.WJP_IS_ADMIN with a getter/setter. Any existing code
  // that reads WJP_IS_ADMIN now goes through resolve(). Any code that writes
  // to WJP_IS_ADMIN (e.g., fetchAdminStatus setting it true) flips the
  // runtime flag instead of clobbering the property.
  var hadValue = (window.WJP_IS_ADMIN === true);
  try {
    Object.defineProperty(window, "WJP_IS_ADMIN", {
      configurable: true,
      enumerable: true,
      get: function () { return resolve(); },
      set: function (v) {
        window._wjpAdminRuntimeFlag = (v === true);
      }
    });
    // Preserve any pre-existing value (e.g. if a script ran before us)
    if (hadValue) window._wjpAdminRuntimeFlag = true;
  } catch (e) {
    // Defensive — if defineProperty fails on some browser, fall back to a
    // direct boolean. Better to do nothing than to break the page.
    try { console.warn("[wjp-admin-resolver] defineProperty failed", e); } catch (_) {}
  }

  // Also intercept getTier — if the user is admin, getTier should report 'admin'
  // even when the backend tier check is failing. Most gate modules call getTier().
  if (typeof window.getTier === "function" && !window.getTier._wjpAdminAware) {
    var origGetTier = window.getTier;
    var wrappedGetTier = function () {
      try {
        var t = origGetTier.apply(this, arguments);
        if (resolve()) return "admin";
        return t;
      } catch (_) {
        return resolve() ? "admin" : "free";
      }
    };
    wrappedGetTier._wjpAdminAware = true;
    window.getTier = wrappedGetTier;
  } else if (typeof window.getTier !== "function") {
    // getTier not defined yet — wait + wrap when it appears
    var attempts = 0;
    var iv = setInterval(function () {
      if (typeof window.getTier === "function" && !window.getTier._wjpAdminAware) {
        var orig = window.getTier;
        var wrapped = function () {
          try {
            var t = orig.apply(this, arguments);
            if (resolve()) return "admin";
            return t;
          } catch (_) {
            return resolve() ? "admin" : "free";
          }
        };
        wrapped._wjpAdminAware = true;
        window.getTier = wrapped;
        clearInterval(iv);
      }
      if (++attempts > 30) clearInterval(iv);
    }, 500);
  }

  window.WJP_AdminResolver = { version: 1, resolve: resolve };
})();
