/* wjp-data-loss-guard.js v1 — 2026-05-22 emergency patch
 *
 * Closes a critical data-loss race in the boot path. Symptoms: dashboard
 * shows "0 debts", payoff date wrong, total debt $0, both localStorage AND
 * Firestore wiped over time.
 *
 * Root cause (confirmed via live diagnostic):
 *   1. app.js's DOMContentLoaded handler calls loadState() BEFORE Firebase
 *      auth resolves (__wjpUser/__wjpAuth.currentUser not set yet).
 *   2. getStateKey() in that pre-auth window returns the bare key
 *      'wjp_budget_state'. The privacy fix shipped 2026-05-21 retires that
 *      bare key to '_legacy_orphan' once a user signs in. On the next page
 *      load, the bare key is null.
 *   3. loadState() reads null, JSON.parse throws, falls back to defaultState
 *      → appState.debts = [], appState.assets = [].
 *   4. wjp-firestore-tx-bootstrap then hydrates appState.transactions from
 *      Firestore (independent path, separate fetch), and calls saveState().
 *   5. saveState() writes the appState (with empty debts/assets) back to
 *      the scoped key, WIPING the user's stored data.
 *   6. cloudPushDebounced fires off saveState() → empty data pushed to
 *      Firestore → cloud wiped too.
 *
 * What this patch does:
 *   A) WRAP getStateKey(): if no authed user yet, scan localStorage for any
 *      'wjp_budget_state_u_*' key. If exactly one exists, return that.
 *      Prevents loadState from returning null in the pre-auth window.
 *   B) WRAP saveState(): refuse to write an empty appState (zero debts AND
 *      zero assets) over a stored state that has debts or assets. Logs a
 *      warning so we can spot the race instead of silently losing data.
 *   C) WRAP cloudPushNow / cloudPushDebounced: same guard — never push
 *      empty arrays over non-empty cloud state.
 *
 * Safe to ship: additive only, no changes to app.js. Removing this file
 * restores prior behavior (which is the broken behavior).
 */
(function () {
  'use strict';
  if (window._wjpDataLossGuardInstalled) return;
  window._wjpDataLossGuardInstalled = true;

  var BARE_KEY = 'wjp_budget_state';
  var SCOPED_PREFIX = 'wjp_budget_state_u_';

  function rawGet(key) {
    try { return Object.getPrototypeOf(localStorage).getItem.call(localStorage, key); } catch(_) { return null; }
  }

  // ── PATCH A: pre-auth fallback for getStateKey ──────────────────────────
  function findUniqueScopedKey() {
    try {
      var hits = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(SCOPED_PREFIX) === 0 && k.indexOf('_legacy_orphan') === -1) {
          hits.push(k);
        }
      }
      if (hits.length === 1) return hits[0];
      // Multiple scoped keys present (rare — would mean multiple users on
      // this device). Pick the largest blob as the most-likely-current.
      if (hits.length > 1) {
        var best = null, bestLen = -1;
        hits.forEach(function (k) {
          var v = rawGet(k);
          var len = v ? v.length : 0;
          if (len > bestLen) { best = k; bestLen = len; }
        });
        return best;
      }
    } catch(_) {}
    return null;
  }

  function wrapGetStateKey() {
    if (typeof window.getStateKey !== 'function') return false;
    if (window.getStateKey.__wjpGuardWrapped) return true;
    var orig = window.getStateKey;
    window.getStateKey = function () {
      var k = orig.apply(this, arguments);
      // If orig returned the bare key, attempt a scoped fallback.
      if (k === BARE_KEY) {
        var scoped = findUniqueScopedKey();
        if (scoped) {
          try { console.log('[wjp-data-loss-guard] pre-auth: redirected ' + BARE_KEY + ' → ' + scoped); } catch(_){}
          return scoped;
        }
      }
      return k;
    };
    window.getStateKey.__wjpGuardWrapped = true;
    return true;
  }

  // ── PATCH B: refuse empty-clobber saveState ─────────────────────────────
  function wouldClobber(targetKey) {
    try {
      var existing = rawGet(targetKey);
      if (!existing) return false;
      var parsed = JSON.parse(existing);
      var existingDebts = (parsed && Array.isArray(parsed.debts)) ? parsed.debts.length : 0;
      var existingAssets = (parsed && Array.isArray(parsed.assets)) ? parsed.assets.length : 0;
      var newDebts = (window.appState && Array.isArray(window.appState.debts)) ? window.appState.debts.length : 0;
      var newAssets = (window.appState && Array.isArray(window.appState.assets)) ? window.appState.assets.length : 0;
      // Stored has data; in-memory is empty. That's the bug we're guarding.
      if (existingDebts > 0 && newDebts === 0) return { existingDebts: existingDebts, existingAssets: existingAssets, newDebts: newDebts, newAssets: newAssets, axis: 'debts' };
      if (existingAssets > 0 && newAssets === 0) return { existingDebts: existingDebts, existingAssets: existingAssets, newDebts: newDebts, newAssets: newAssets, axis: 'assets' };
    } catch(_) {}
    return false;
  }

  function wrapSaveState() {
    if (typeof window.saveState !== 'function') return false;
    if (window.saveState.__wjpGuardWrapped) return true;
    var orig = window.saveState;
    window.saveState = function () {
      try {
        var key = (typeof window.getStateKey === 'function') ? window.getStateKey() : BARE_KEY;
        var clobber = wouldClobber(key);
        if (clobber) {
          try {
            console.warn('[wjp-data-loss-guard] saveState BLOCKED — refusing to clobber stored ' + clobber.axis + ' (stored=' + clobber['existing' + (clobber.axis === 'debts' ? 'Debts' : 'Assets')] + ', in-memory=0). Likely cause: in-memory appState failed to load from storage before this save fired. Call loadState() to recover.');
            // Increment a counter so we can detect this in diagnostics.
            window.__wjpClobbersBlocked = (window.__wjpClobbersBlocked || 0) + 1;
          } catch(_){}
          // Auto-recover: re-run loadState() to populate appState from storage,
          // then call the original saveState() with the recovered data.
          try {
            if (typeof window.loadState === 'function') {
              window.loadState();
              // After loadState, if appState now has debts, persist that.
              // If it doesn't (loadState also failed), we leave storage alone.
              var newDebts = (window.appState && Array.isArray(window.appState.debts)) ? window.appState.debts.length : 0;
              if (newDebts > 0) {
                try { console.log('[wjp-data-loss-guard] auto-recovered ' + newDebts + ' debts from storage; persisting'); } catch(_){}
                return orig.apply(this, arguments);
              }
            }
          } catch(_) {}
          return; // refuse the write
        }
      } catch(_) {}
      return orig.apply(this, arguments);
    };
    window.saveState.__wjpGuardWrapped = true;
    return true;
  }

  // ── PATCH C: same guard for cloud push ──────────────────────────────────
  function wrapCloudPush(fnName) {
    if (typeof window[fnName] !== 'function') return false;
    if (window[fnName].__wjpGuardWrapped) return true;
    var orig = window[fnName];
    window[fnName] = function () {
      try {
        // Only refuse if appState appears empty AND we're in a state where
        // local storage HAS data (i.e., this is a boot-race situation).
        var newDebts = (window.appState && Array.isArray(window.appState.debts)) ? window.appState.debts.length : 0;
        var newAssets = (window.appState && Array.isArray(window.appState.assets)) ? window.appState.assets.length : 0;
        if (newDebts === 0 && newAssets === 0) {
          // Probe storage: if it has data, refuse cloud push.
          try {
            var key = (typeof window.getStateKey === 'function') ? window.getStateKey() : BARE_KEY;
            var raw = rawGet(key);
            if (raw) {
              var parsed = JSON.parse(raw);
              var storedDebts = (parsed && Array.isArray(parsed.debts)) ? parsed.debts.length : 0;
              var storedAssets = (parsed && Array.isArray(parsed.assets)) ? parsed.assets.length : 0;
              if (storedDebts > 0 || storedAssets > 0) {
                try { console.warn('[wjp-data-loss-guard] ' + fnName + ' BLOCKED — appState is empty but storage has ' + storedDebts + ' debts + ' + storedAssets + ' assets. Refusing to push empty to cloud.'); } catch(_){}
                window.__wjpCloudClobbersBlocked = (window.__wjpCloudClobbersBlocked || 0) + 1;
                return;
              }
            }
          } catch(_){}
        }
      } catch(_) {}
      return orig.apply(this, arguments);
    };
    window[fnName].__wjpGuardWrapped = true;
    return true;
  }

  // ── Boot: install all three patches as soon as the wrapped fns exist ───
  function bootInstall() {
    var a = wrapGetStateKey();
    var b = wrapSaveState();
    var c1 = wrapCloudPush('cloudPushNow');
    var c2 = wrapCloudPush('cloudPushDebounced');
    return a && b && c1 && c2;
  }

  // Try immediately, then keep retrying until all patches are installed.
  if (bootInstall()) {
    try { console.log('[wjp-data-loss-guard v1] all patches installed at boot'); } catch(_){}
  } else {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (bootInstall() || attempts > 50) {
        clearInterval(iv);
        try { console.log('[wjp-data-loss-guard v1] patches installed after ' + attempts + ' attempts'); } catch(_){}
      }
    }, 100);
  }

  // ── Expose a manual recovery helper ─────────────────────────────────────
  window.WJP_DataLossGuard = {
    version: 1,
    forceReload: function () {
      // Manual lever: re-run loadState() + updateUI() to hydrate from storage.
      try {
        if (typeof window.loadState === 'function') window.loadState();
        if (typeof window.updateUI === 'function') window.updateUI();
        return {
          debts: (window.appState && window.appState.debts || []).length,
          assets: (window.appState && window.appState.assets || []).length,
          tx: (window.appState && window.appState.transactions || []).length
        };
      } catch(e) { return { err: e.message }; }
    },
    blockedCount: function () {
      return {
        saveState_blocked: window.__wjpClobbersBlocked || 0,
        cloudPush_blocked: window.__wjpCloudClobbersBlocked || 0
      };
    },
    findScopedKey: findUniqueScopedKey,
    wouldClobber: wouldClobber
  };
})();
