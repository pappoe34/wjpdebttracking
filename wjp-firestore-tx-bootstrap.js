/* wjp-firestore-tx-bootstrap.js v1 — Read Plaid transactions from Firestore on boot.
 *
 * Closes a gap: sync-transactions.js (Netlify) persists every Plaid tx to
 *   users/{uid}/transactions/{transaction_id}
 * but the frontend was only reading from localStorage's wjp_budget_state.
 * After yesterday's full-resync this Firestore collection has 844+ docs for
 * Winston — they should flow into appState.transactions automatically.
 *
 * Strategy:
 *   1. After auth ready, query the user's transactions sub-collection
 *      ordered by date desc, limited to the last 365 days.
 *   2. Merge into wjp_budget_state.transactions with dedupe by
 *      transaction_id || id (idempotent — repeated boots don't grow).
 *   3. Write merged set back to localStorage + appState.
 *   4. Dispatch 'wjp-transactions-rehydrated' for other modules.
 *   5. Re-fetch every 30 minutes for long-lived tabs.
 *
 * Safe: only reads the user's own transactions sub-collection (enforced by
 * Firestore security rules elsewhere). No writes. No Plaid calls.
 * Path-guarded to /index. IIFE, idempotent.
 */
(function () {
  'use strict';
  if (window._wjpFsTxBootstrapInstalled) return;
  window._wjpFsTxBootstrapInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var LS_KEY = 'wjp_budget_state';
  var LS_LAST_FETCH = 'wjp.fs.tx.lastFetchedAt';
  var MAX_DAYS = 365;
  var REFRESH_MS = 30 * 60 * 1000;

  function getUid() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.uid;
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) return window.__wjpAuth.currentUser.uid;
    } catch (_) {}
    return null;
  }

  async function getDb() {
    try {
      if (window.firebase && window.firebase.firestore) return { kind: 'compat', db: window.firebase.firestore() };
      // Modular SDK
      var fsMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
      var appMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
      var apps = appMod.getApps ? appMod.getApps() : [];
      if (!apps.length) return null;
      return { kind: 'modular', mod: fsMod, db: fsMod.getFirestore(apps[0]) };
    } catch (_) { return null; }
  }

  function readState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); return true; } catch (_) { return false; }
  }

  function txId(t) {
    return t.transaction_id || t.transactionId || t.id || null;
  }

  function mergeTransactions(existing, fresh) {
    // Index existing by id for O(1) dedupe lookup
    var byId = {};
    existing.forEach(function (t) {
      var id = txId(t);
      if (id) byId[id] = t;
    });
    var added = 0;
    var updated = 0;
    fresh.forEach(function (t) {
      var id = txId(t);
      if (!id) return;
      if (byId[id]) {
        // Merge — Firestore is source of truth; let Firestore fields override
        // local edits unless local has explicit `userEdited: true` flag.
        if (!byId[id].userEdited) {
          Object.assign(byId[id], t);
          updated++;
        }
      } else {
        byId[id] = t;
        added++;
      }
    });
    var out = Object.keys(byId).map(function (k) { return byId[k]; });
    // Sort by date desc
    out.sort(function (a, b) {
      var da = new Date(a.date || a.timestamp || 0).getTime();
      var db = new Date(b.date || b.timestamp || 0).getTime();
      return db - da;
    });
    return { merged: out, added: added, updated: updated };
  }

  async function queryTransactions(dbCtx, uid) {
    var cutoff = new Date(Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    var fresh = [];
    try {
      if (dbCtx.kind === 'modular') {
        var m = dbCtx.mod;
        var ref = m.collection(dbCtx.db, 'users', uid, 'transactions');
        // Order + limit not strictly needed; pulling all and sorting client-side is fine for <2000 docs.
        var snap = await m.getDocs(ref);
        snap.forEach(function (d) { fresh.push(Object.assign({ _fsId: d.id }, d.data())); });
      } else {
        var snap2 = await dbCtx.db.collection('users').doc(uid).collection('transactions').get();
        snap2.forEach(function (d) { fresh.push(Object.assign({ _fsId: d.id }, d.data())); });
      }
    } catch (e) { try { console.warn('[wjp-fs-tx] query failed', e); } catch (_) {} return []; }
    // Filter to last 365 days
    fresh = fresh.filter(function (t) {
      var d = t.date || t.authorized_date || t.timestamp;
      if (!d) return false;
      var iso = (typeof d === 'string') ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
      return iso >= cutoff;
    });
    return fresh;
  }

  async function refresh() {
    var uid = getUid();
    if (!uid) return { ok: false, reason: 'no-uid' };
    var dbCtx = await getDb();
    if (!dbCtx) return { ok: false, reason: 'no-firestore' };
    var fresh = await queryTransactions(dbCtx, uid);
    if (!fresh.length) {
      try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())); } catch (_) {}
      return { ok: true, added: 0, updated: 0, totalFromFs: 0 };
    }
    var state = readState();
    var existing = Array.isArray(state.transactions) ? state.transactions : [];
    var res = mergeTransactions(existing, fresh);
    state.transactions = res.merged;
    writeState(state);
    try {
      if (window.appState) window.appState.transactions = res.merged;
      window.dispatchEvent(new CustomEvent('wjp-transactions-rehydrated', {
        detail: { added: res.added, updated: res.updated, total: res.merged.length }
      }));
    } catch (_) {}
    try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())); } catch (_) {}
    try { console.log('[wjp-fs-tx] hydrated', { added: res.added, updated: res.updated, total: res.merged.length }); } catch (_) {}
    return { ok: true, added: res.added, updated: res.updated, total: res.merged.length };
  }

  async function boot() {
    var attempts = 0;
    while (attempts < 20 && !getUid()) {
      await new Promise(function (r) { setTimeout(r, 800); });
      attempts++;
    }
    if (!getUid()) return;
    await refresh();
    setInterval(function () { refresh().catch(function () {}); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  } else {
    setTimeout(boot, 1500);
  }

  window.WJP_TxBootstrap = {
    refresh: refresh,
    version: 1
  };
})();
