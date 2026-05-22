/* wjp-data-loss-guard.js v2 — 2026-05-22 emergency patch
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
 *      Firestore (independent path), and calls window.saveState() OR writes
 *      localStorage.setItem('wjp_budget_state', JSON.stringify(lsState))
 *      DIRECTLY. The storage-hygiene proxy redirects bare→scoped, so a
 *      direct write to the bare key wipes the scoped key.
 *   5. saveState() / direct setItem writes empty-debts state to scoped key,
 *      and cloudPushDebounced sends empty to Firestore — total wipe.
 *
 * What this patch does (additive only, no edits to app.js):
 *
 *   A) WRAP getStateKey(): if no authed user yet, scan localStorage for any
 *      'wjp_budget_state_u_*' key. If exactly one exists, return that.
 *      Prevents loadState from returning null in the pre-auth window.
 *
 *   B) WRAP saveState(): refuse to write an empty appState (zero debts AND
 *      zero assets) over a stored state that has debts or assets. Logs a
 *      warning so we can spot the race. Auto-recovers by calling loadState()
 *      then re-saving with the recovered data.
 *
 *   C) WRAP cloudPushNow / cloudPushDebounced: same guard — never push
 *      empty arrays over non-empty cloud state.
 *
 *   D) WRAP localStorage.setItem (NEW IN v2): catches DIRECT writes to the
 *      bare key 'wjp_budget_state' or any scoped 'wjp_budget_state_u_*' key
 *      that would clobber existing debts/assets data. Sits OUTSIDE the
 *      hygiene proxy, so even modules that bypass saveState (like
 *      wjp-firestore-tx-bootstrap's fallback path) are caught.
 *
 * Safe to ship: additive only. Removing this file restores prior (broken)
 * behavior.
 */
(function () {
  'use strict';
  if (window._wjpDataLossGuardInstalled) return;
  window._wjpDataLossGuardInstalled = true;
  window._wjpDataLossGuardVersion = 2;

  var BARE_KEY = 'wjp_budget_state';
  var SCOPED_PREFIX = 'wjp_budget_state_u_';

  // Raw localStorage access (bypasses any proxy that's already installed)
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
    var wrapped = function () {
      var k = orig.apply(this, arguments);
      if (k === BARE_KEY) {
        var scoped = findUniqueScopedKey();
        if (scoped) {
          try { console.log('[wjp-data-loss-guard] pre-auth: redirected ' + BARE_KEY + ' → ' + scoped); } catch(_){}
          return scoped;
        }
      }
      return k;
    };
    wrapped.__wjpGuardWrapped = true;
    window.getStateKey = wrapped;
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
      if (existingDebts > 0 && newDebts === 0) return { axis: 'debts', existingDebts: existingDebts, existingAssets: existingAssets, newDebts: newDebts, newAssets: newAssets };
      if (existingAssets > 0 && newAssets === 0) return { axis: 'assets', existingDebts: existingDebts, existingAssets: existingAssets, newDebts: newDebts, newAssets: newAssets };
    } catch(_) {}
    return false;
  }

  function wrapSaveState() {
    if (typeof window.saveState !== 'function') return false;
    if (window.saveState.__wjpGuardWrapped) return true;
    var orig = window.saveState;
    var wrapped = function () {
      try {
        var key = (typeof window.getStateKey === 'function') ? window.getStateKey() : BARE_KEY;
        var clobber = wouldClobber(key);
        if (clobber) {
          try { console.warn('[wjp-data-loss-guard] saveState BLOCKED clobber to ' + clobber.axis + ' (stored=' + clobber['existing' + (clobber.axis === 'debts' ? 'Debts' : 'Assets')] + ', in-memory=0)'); } catch(_){}
          window.__wjpClobbersBlocked = (window.__wjpClobbersBlocked || 0) + 1;
          // Auto-recover via loadState
          try {
            if (typeof window.loadState === 'function') {
              window.loadState();
              var newDebts = (window.appState && Array.isArray(window.appState.debts)) ? window.appState.debts.length : 0;
              if (newDebts > 0) {
                try { console.log('[wjp-data-loss-guard] auto-recovered ' + newDebts + ' debts'); } catch(_){}
                return orig.apply(this, arguments);
              }
            }
          } catch(_) {}
          return; // refuse the write
        }
      } catch(_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__wjpGuardWrapped = true;
    window.saveState = wrapped;
    return true;
  }

  // ── PATCH C: same guard for cloud push ──────────────────────────────────
  function wrapCloudPush(fnName) {
    if (typeof window[fnName] !== 'function') return false;
    if (window[fnName].__wjpGuardWrapped) return true;
    var orig = window[fnName];
    var wrapped = function () {
      try {
        var newDebts = (window.appState && Array.isArray(window.appState.debts)) ? window.appState.debts.length : 0;
        var newAssets = (window.appState && Array.isArray(window.appState.assets)) ? window.appState.assets.length : 0;
        if (newDebts === 0 && newAssets === 0) {
          try {
            var key = (typeof window.getStateKey === 'function') ? window.getStateKey() : BARE_KEY;
            var raw = rawGet(key);
            if (raw) {
              var parsed = JSON.parse(raw);
              var storedDebts = (parsed && Array.isArray(parsed.debts)) ? parsed.debts.length : 0;
              var storedAssets = (parsed && Array.isArray(parsed.assets)) ? parsed.assets.length : 0;
              if (storedDebts > 0 || storedAssets > 0) {
                try { console.warn('[wjp-data-loss-guard] ' + fnName + ' BLOCKED empty push (stored=' + storedDebts + ' debts + ' + storedAssets + ' assets)'); } catch(_){}
                window.__wjpCloudClobbersBlocked = (window.__wjpCloudClobbersBlocked || 0) + 1;
                return;
              }
            }
          } catch(_){}
        }
      } catch(_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__wjpGuardWrapped = true;
    window[fnName] = wrapped;
    return true;
  }

  // ── PATCH D (NEW v2): wrap localStorage.setItem for direct-write writes ─
  // Sits OUTSIDE the hygiene proxy. Any write to bare key, OR to any scoped
  // wjp_budget_state_u_* key, gets pre-validated: if new payload has empty
  // debts/assets and stored has non-empty, refuse.
  function wrapLocalStorageSetItem() {
    try {
      if (localStorage.setItem.__wjpGuardWrapped) return true;
      var prev = localStorage.setItem.bind(localStorage);
      var wrapped = function (key, value) {
        try {
          // Only intercept budget_state-related writes. Anything else passes through.
          if (typeof key === 'string' &&
              (key === BARE_KEY || (key.indexOf(SCOPED_PREFIX) === 0 && key.indexOf('_legacy_orphan') === -1))) {
            // Determine the EFFECTIVE target key (where data will land after hygiene proxy redirect)
            var targetKey = key;
            if (key === BARE_KEY) {
              var scopedTarget = findUniqueScopedKey();
              if (scopedTarget) targetKey = scopedTarget;
            }
            // Parse new value to get debts/assets counts
            var newDebts = 0, newAssets = 0;
            try {
              var newParsed = JSON.parse(value);
              newDebts = (newParsed && Array.isArray(newParsed.debts)) ? newParsed.debts.length : 0;
              newAssets = (newParsed && Array.isArray(newParsed.assets)) ? newParsed.assets.length : 0;
            } catch(_) {
              // Unparseable value — let it through (might be a different shape)
              return prev(key, value);
            }
            // Read current state from the EFFECTIVE target key
            var existing = rawGet(targetKey);
            if (existing) {
              try {
                var existingParsed = JSON.parse(existing);
                var existingDebts = (existingParsed && Array.isArray(existingParsed.debts)) ? existingParsed.debts.length : 0;
                var existingAssets = (existingParsed && Array.isArray(existingParsed.assets)) ? existingParsed.assets.length : 0;
                if ((existingDebts > 0 && newDebts === 0) || (existingAssets > 0 && newAssets === 0)) {
                  try { console.warn('[wjp-data-loss-guard] RAW lo