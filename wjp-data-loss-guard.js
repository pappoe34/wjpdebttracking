/* wjp-data-loss-guard.js v2 — 2026-05-22 emergency patch
 *
 * Closes a critical data-loss race in the boot path.
 *
 * Root cause: app.js loadState() runs in DOMContentLoaded BEFORE Firebase
 * auth resolves. getStateKey returns bare 'wjp_budget_state' which the
 * 2026-05-21 privacy fix retires to _legacy_orphan once a user signs in.
 * So on every page refresh, bare is null, loadState falls back to
 * defaultState (empty arrays), then wjp-firestore-tx-bootstrap merges in
 * txs and calls saveState() OR writes localStorage.setItem('wjp_budget_state',
 * ...) directly. The hygiene proxy redirects bare->scoped, wiping the
 * good data. cloudPushDebounced then pushes empty to Firestore. Total wipe.
 *
 * Patches (additive only, no edits to app.js):
 *   A) Wrap getStateKey(): pre-auth fallback to find scoped key
 *   B) Wrap saveState(): refuse empty-clobber, auto-recover via loadState
 *   C) Wrap cloudPushNow / cloudPushDebounced: refuse empty cloud push
 *   D) Wrap localStorage.setItem: catch direct raw writes that wipe data
 */
(function () {
  'use strict';
  if (window._wjpDataLossGuardInstalled) return;
  window._wjpDataLossGuardInstalled = true;
  window._wjpDataLossGuardVersion = 2;

  var BARE_KEY = 'wjp_budget_state';
  var SCOPED_PREFIX = 'wjp_budget_state_u_';

  function rawGet(key) {
    try { return Object.getPrototypeOf(localStorage).getItem.call(localStorage, key); } catch(_) { return null; }
  }

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

  // PATCH A
  function wrapGetStateKey() {
    if (typeof window.getStateKey !== 'function') return false;
    if (window.getStateKey.__wjpGuardWrapped) return true;
    var orig = window.getStateKey;
    var wrapped = function () {
      var k = orig.apply(this, arguments);
      if (k === BARE_KEY) {
        var scoped = findUniqueScopedKey();
        if (scoped) {
          try { console.log('[wjp-data-loss-guard] pre-auth redirected ' + BARE_KEY + ' to ' + scoped); } catch(_){}
          return scoped;
        }
      }
      return k;
    };
    wrapped.__wjpGuardWrapped = true;
    window.getStateKey = wrapped;
    return true;
  }

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

  // PATCH B
  function wrapSaveState() {
    if (typeof window.saveState !== 'function') return false;
    if (window.saveState.__wjpGuardWrapped) return true;
    var orig = window.saveState;
    var wrapped = function () {
      try {
        var key = (typeof window.getStateKey === 'function') ? window.getStateKey() : BARE_KEY;
        var clobber = wouldClobber(key);
        if (clobber) {
          try { console.warn('[wjp-data-loss-guard] saveState BLOCKED clobber to ' + clobber.axis + ' (stored=' + clobber.existingDebts + 'd/' + clobber.existingAssets + 'a, mem=0d/0a)'); } catch(_){}
          window.__wjpClobbersBlocked = (window.__wjpClobbersBlocked || 0) + 1;
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
          return;
        }
      } catch(_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__wjpGuardWrapped = true;
    window.saveState = wrapped;
    return true;
  }

  // PATCH C
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
                try { console.warn('[wjp-data-loss-guard] ' + fnName + ' BLOCKED empty push (stored=' + storedDebts + 'd/' + storedAssets + 'a)'); } catch(_){}
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

  // PATCH D
  function wrapLocalStorageSetItem() {
    try {
      if (localStorage.setItem.__wjpGuardWrapped) return true;
      var prev = localStorage.setItem.bind(localStorage);
      var wrapped = function (key, value) {
        try {
          if (typeof key === 'string' &&
              (key === BARE_KEY || (key.indexOf(SCOPED_PREFIX) === 0 && key.indexOf('_legacy_orphan') === -1))) {
            var targetKey = key;
            if (key === BARE_KEY) {
              var scopedTarget = findUniqueScopedKey();
              if (scopedTarget) targetKey = scopedTarget;
            }
            var newDebts = 0, newAssets = 0;
            try {
              var newParsed = JSON.parse(value);
              newDebts = (newParsed && Array.isArray(newParsed.debts)) ? newParsed.debts.length : 0;
              newAssets = (newParsed && Array.isArray(newParsed.assets)) ? newParsed.assets.length : 0;
            } catch(_) {
              return prev(key, value);
            }
            var existing = rawGet(targetKey);
            if (existing) {
              try {
                var existingParsed = JSON.parse(existing);
                var existingDebts = (existingParsed && Array.isArray(existingParsed.debts)) ? existingParsed.debts.length : 0;
                var existingAssets = (existingParsed && Array.isArray(existingParsed.assets)) ? existingParsed.assets.length : 0;
                if ((existingDebts > 0 && newDebts === 0) || (existingAssets > 0 && newAssets === 0)) {
                  try { console.warn('[wjp-data-loss-guard] raw setItem BLOCKED key=' + key + ' target=' + targetKey + ' stored=' + existingDebts + 'd/' + existingAssets + 'a new=' + newDebts + 'd/' + newAssets + 'a'); } catch(_){}
                  window.__wjpRawClobbersBlocked = (window.__wjpRawClobbersBlocked || 0) + 1;
                  return;
                }
              } catch(_){}
            }
          }
        } catch(_) {}
        return prev(key, value);
      };
      wrapped.__wjpGuardWrapped = true;
      localStorage.setItem = wrapped;
      return true;
    } catch(_) { return false; }
  }

  function bootInstall() {
    var a = wrapGetStateKey();
    var b = wrapSaveState();
    var c1 = wrapCloudPush('cloudPushNow');
    var c2 = wrapCloudPush('cloudPushDebounced');
    var d = wrapLocalStorageSetItem();
    return a && b && c1 && c2 && d;
  }

  wrapLocalStorageSetItem();

  if (bootInstall()) {
    try { console.log('[wjp-data-loss-guard v2] all patches installed at boot'); } catch(_){}
  } else {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (!(localStorage.setItem && localStorage.setItem.__wjpGuardWrapped)) wrapLocalStorageSetItem();
      if (bootInstall() || attempts > 50) {
        clearInterval(iv);
        try { console.log('[wjp-data-loss-guard v2] patches installed after ' + attempts + ' attempts'); } catch(_){}
      }
    }, 100);
  }

  window.WJP_DataLossGuard = {
    version: 2,
    forceReload: function () {
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
        cloudPush_blocked: window.__wjpCloudClobbersBlocked || 0,
        rawSetItem_blocked: window.__wjpRawClobbersBlocked || 0
      };
    },
    findScopedKey: findUniqueScopedKey,
    wouldClobber: wouldClobber,
    rawGet: rawGet
  };
})();
