/* wjp-trial-state.js v1 — 14-day Pro Plus trial state manager.
 *
 * Grants a no-card-required 14-day Pro Plus trial to first-time users so
 * they experience full Plaid sync + Liabilities + Investments before
 * deciding whether to pay. After the trial expires, the user reverts to
 * Free tier and enters a 7-day grace period before Plaid items are
 * removed by the cleanup-free-tier-items.js scheduled function.
 *
 * State lives in Firestore at users/{uid}/billing/subscription:
 *   { tier, trialActive, trialStartedAt, trialEndsAt, trialUsed,
 *     lastDowngradeAt, ... existing Stripe fields }
 *
 * Eligibility for trial grant:
 *   - Subscription doc does NOT exist, OR
 *   - tier === 'free' AND trialUsed !== true AND status !== 'canceled'
 *
 * Once granted: trialUsed = true forever, so re-running grant on same
 * user is a no-op (prevents re-trial gaming on downgrade).
 *
 * Frontend tier resolution: this module patches window.appState.subscription
 * (which window.getTier() reads from) so the existing tier system
 * automatically reflects trial state. No monkey-patching of getTier() itself.
 *
 * Safe: IIFE, idempotent, path-guarded.
 */
(function () {
  'use strict';
  if (window._wjpTrialStateInstalled) return;
  function getAppState(){ try { return appState; } catch(_){ return null; } }
  window._wjpTrialStateInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var DAY_MS = 24 * 60 * 60 * 1000;
  var TRIAL_LENGTH_DAYS = 14;
  var LS_TRIAL_CACHE = 'wjp.trial.cache';
  var LS_WELCOME_SHOWN = 'wjp.trial.welcomeShown';

  function nowMs() { return Date.now(); }

  function getCurrentUid() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.uid;
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) {
        return window.__wjpAuth.currentUser.uid;
      }
    } catch (_) {}
    return null;
  }

  async function getDb() {
    try {
      if (window.firebase && window.firebase.firestore) return window.firebase.firestore();
      if (window.db) return window.db;
      // Modular SDK v9+ — try import path used elsewhere in the app
      var mod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
      var appMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
      var apps = (appMod && appMod.getApps) ? appMod.getApps() : [];
      var app = apps[0];
      if (!app) return null;
      window.__wjpFsMod = { mod: mod, db: mod.getFirestore(app) };
      return window.__wjpFsMod.db;
    } catch (_) { return null; }
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(LS_TRIAL_CACHE) || 'null'); }
    catch (_) { return null; }
  }
  function writeCache(obj) {
    try { localStorage.setItem(LS_TRIAL_CACHE, JSON.stringify(obj || {})); } catch (_) {}
  }

  // Read sub from Firestore (modular SDK first, compat fallback).
  async function readSub(db, uid) {
    if (!db || !uid) return null;
    try {
      if (window.__wjpFsMod && window.__wjpFsMod.mod) {
        var m = window.__wjpFsMod.mod;
        var ref = m.doc(db, 'users', uid, 'billing', 'subscription');
        var snap = await m.getDoc(ref);
        return snap.exists() ? snap.data() : null;
      }
      if (typeof db.collection === 'function') {
        var docRef = db.collection('users').doc(uid).collection('billing').doc('subscription');
        var snap2 = await docRef.get();
        return snap2.exists ? snap2.data() : null;
      }
    } catch (_) {}
    return null;
  }

  async function writeSub(db, uid, patch) {
    if (!db || !uid) return false;
    try {
      if (window.__wjpFsMod && window.__wjpFsMod.mod) {
        var m = window.__wjpFsMod.mod;
        var ref = m.doc(db, 'users', uid, 'billing', 'subscription');
        await m.setDoc(ref, patch, { merge: true });
        return true;
      }
      if (typeof db.collection === 'function') {
        var docRef = db.collection('users').doc(uid).collection('billing').doc('subscription');
        await docRef.set(patch, { merge: true });
        return true;
      }
    } catch (e) { console.warn('[wjp-trial-state] writeSub failed', e); }
    return false;
  }

  function trialIsActive(sub) {
    if (!sub) return false;
    if (sub.trialActive !== true && !sub.trialEndsAt) return false;
    return sub.trialEndsAt && nowMs() < sub.trialEndsAt;
  }

  function trialJustExpired(sub) {
    if (!sub) return false;
    if (!sub.trialEndsAt) return false;
    return nowMs() >= sub.trialEndsAt && sub.trialActive === true;
  }

  function eligibleForTrial(sub) {
    // No sub doc yet → fresh user, eligible
    if (!sub || Object.keys(sub).length === 0) return true;
    // Already used trial → not eligible
    if (sub.trialUsed === true) return false;
    // Has active paid subscription → not eligible
    if (sub.status === 'active' || sub.status === 'trialing') {
      // Stripe-managed trial — defer to Stripe, do not double-trial
      return false;
    }
    var tier = String(sub.tier || 'free').toLowerCase();
    // Already paid tier → not eligible
    if (tier === 'pro' || tier === 'plus' || tier === 'admin') return false;
    return true;
  }

  function patchAppStateForTrial(sub) {
    try {
      var s = getAppState();
      if (!s) { if (!window.appState) window.appState = {}; s = window.appState; }
      if (!s.subscription) s.subscription = {};
      // Mirror trial state into appState so existing getTier()/isPlus() see it.
      s.subscription.tier = 'plus';
      s.subscription.trialActive = true;
      s.subscription.trialStartedAt = sub.trialStartedAt;
      s.subscription.trialEndsAt = sub.trialEndsAt;
      s.subscription.status = 'trialing';
      try { window.dispatchEvent(new CustomEvent('wjp-trial-state', { detail: sub })); } catch (_) {}
    } catch (_) {}
  }

  function patchAppStateForExpired() {
    try {
      var s = getAppState();
      if (!s) { if (!window.appState) window.appState = {}; s = window.appState; }
      if (!s.subscription) s.subscription = {};
      window.appState.subscription.tier = 'free';
      window.appState.subscription.trialActive = false;
      window.appState.subscription.status = 'canceled';
      try { window.dispatchEvent(new CustomEvent('wjp-trial-state', { detail: {} })); } catch (_) {}
    } catch (_) {}
  }

  async function expireTrial(db, uid, sub) {
    // Trial just hit zero — mark expired and start grace period.
    var patch = {
      trialActive: false,
      tier: 'free',
      status: 'canceled',
      trialEndedAt: nowMs(),
      lastDowngradeAt: nowMs(),
      gracePeriodEndsAt: nowMs() + 7 * DAY_MS
    };
    await writeSub(db, uid, patch);
    var merged = Object.assign({}, sub, patch);
    writeCache(merged);
    patchAppStateForExpired();
    return merged;
  }

  async function grantTrial(db, uid) {
    var patch = {
      tier: 'plus',
      trialActive: true,
      trialUsed: true,
      trialStartedAt: nowMs(),
      trialEndsAt: nowMs() + TRIAL_LENGTH_DAYS * DAY_MS,
      status: 'trialing',
      trialType: 'no_card_inapp',
      trialGrantedSource: 'wjp-trial-state.v1'
    };
    await writeSub(db, uid, patch);
    writeCache(patch);
    patchAppStateForTrial(patch);
    return patch;
  }

  async function boot() {
    // Wait for auth + db
    var attempts = 0;
    var uid = null;
    while (attempts < 30) {
      uid = getCurrentUid();
      if (uid) break;
      await new Promise(function (r) { setTimeout(r, 1000); });
      attempts++;
    }
    if (!uid) return; // not logged in

    var db = await getDb();
    if (!db) {
      // Best-effort: use localStorage cache if available
      var cached = readCache();
      if (cached && trialIsActive(cached)) patchAppStateForTrial(cached);
      return;
    }

    var sub = await readSub(db, uid);
    sub = sub || {};

    // If trial active in Firestore → mirror to appState
    if (trialIsActive(sub)) {
      patchAppStateForTrial(sub);
      writeCache(sub);
      window.WJP_Trial = exposedApi(sub);
      return;
    }

    // If trial just expired → flip state + start grace
    if (trialJustExpired(sub)) {
      sub = await expireTrial(db, uid, sub);
      writeCache(sub);
      window.WJP_Trial = exposedApi(sub);
      return;
    }

    // Eligible to grant trial → grant it
    if (eligibleForTrial(sub)) {
      try {
        sub = await grantTrial(db, uid);
        window.WJP_Trial = exposedApi(sub);
        return;
      } catch (e) { console.warn('[wjp-trial-state] grant failed', e); }
    }

    // Not eligible & no active trial — nothing to do
    writeCache(sub);
    window.WJP_Trial = exposedApi(sub);
  }

  function exposedApi(sub) {
    return {
      isActive: function () { return trialIsActive(sub); },
      daysLeft: function () {
        if (!trialIsActive(sub)) return 0;
        return Math.max(0, Math.ceil((sub.trialEndsAt - nowMs()) / DAY_MS));
      },
      endsAt: function () { return sub.trialEndsAt || null; },
      startedAt: function () { return sub.trialStartedAt || null; },
      isInGrace: function () {
        return sub.gracePeriodEndsAt && nowMs() < sub.gracePeriodEndsAt && (sub.tier === 'free' || !sub.tier);
      },
      graceDaysLeft: function () {
        if (!sub.gracePeriodEndsAt) return 0;
        return Math.max(0, Math.ceil((sub.gracePeriodEndsAt - nowMs()) / DAY_MS));
      },
      state: function () { return Object.assign({}, sub); },
      version: 1
    };
  }

  // Set a stub immediately for synchronous consumers
  window.WJP_Trial = exposedApi(readCache() || {});

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1200); });
  } else {
    setTimeout(boot, 1200);
  }
})();
