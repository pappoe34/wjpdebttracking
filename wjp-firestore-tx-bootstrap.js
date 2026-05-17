/* wjp-firestore-tx-bootstrap.js v2 — Firestore-backed transaction hydration.
 *
 * Closes 3 tightly-coupled bugs reported 2026-05-18:
 *   1. Recent transactions rendered as "Transaction" with no merchant —
 *      Plaid-shape fields (name, merchant_name, category as array) don't match
 *      the in-app shape (merchant, category as string, flipped amount sign).
 *      Fix: properly convert each Firestore tx into the legacy in-app shape.
 *   2. Data disappeared on tab switch — the app's cloudPull (which reads
 *      users/{uid}/state/main and overwrites appState.transactions) was racing
 *      with this bootstrap and winning. Fix: wait for cloudPull to settle
 *      before merging, and call saveState() afterward so cloudPush propagates
 *      the merged data into state/main.
 *   3. No cross-device sync of recent txs — Firestore has them in the per-tx
 *      subcollection but state/main was stale. Fix: writing back into
 *      state/main via saveState() means cloudPush sees the new txs and pushes
 *      them so other devices' cloudPull retrieves them.
 *
 * Source: users/{uid}/transactions/{transaction_id} (per-tx Plaid-shape docs,
 * populated by sync-transactions.js Netlify function).
 *
 * Conversion (Plaid shape → in-app shape) mirrors what app.js does at the
 * sync-transactions success path (around line 13560). Single source of truth
 * for the conversion lives here AND there — keep them aligned.
 *
 * Safe: IIFE, idempotent (dedupe by id), polite (waits for cloudPull),
 * additive (never deletes txs).
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
  var BOOT_DELAY_MS = 4500; // wait for cloudPull to settle first

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
      var fsMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
      var appMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
      var apps = appMod.getApps ? appMod.getApps() : [];
      if (!apps.length) return null;
      return { kind: 'modular', mod: fsMod, db: fsMod.getFirestore(apps[0]) };
    } catch (_) { return null; }
  }

  // === SHAPE CONVERTER === Plaid wire shape → app's in-memory shape.
  // Keep this aligned with the converter in app.js syncBankTransactions success path.
  function plaidToAppShape(t, institutionName) {
    if (!t || !t.transaction_id) return null;
    var plaidAmt = Number(t.amount) || 0;
    return {
      // Identity
      id: 'plaid_' + t.transaction_id,
      // Display fields the Calendar + Transactions UI read
      date: t.date || t.authorized_date || new Date().toISOString().slice(0, 10),
      merchant: t.merchant_name || t.name || 'Unknown',
      category: (t.personal_finance_category && t.personal_finance_category.primary)
        || (Array.isArray(t.category) ? t.category[0] : (t.category || 'Other')),
      amount: -plaidAmt, // App convention: negative = outflow
      method: 'Bank',
      status: t.pending ? 'pending' : 'completed',
      // Provenance
      source: 'plaid',
      plaidTransactionId: t.transaction_id,
      plaidAccountId: t.account_id,
      institutionName: institutionName || t.institutionName || 'Bank',
      itemId: t.itemId || null,
      syncedAt: Date.now(),
      locked: true,
      // Optional fields downstream code may use
      paymentChannel: t.payment_channel || null,
      isoCurrency: t.iso_currency_code || 'USD'
    };
  }

  function txId(t) {
    return t.id || ('plaid_' + (t.transaction_id || t.transactionId || ''));
  }

  function dedupedMerge(existing, fresh) {
    var byId = {};
    var orderedIds = [];
    (existing || []).forEach(function (t) {
      var id = txId(t);
      if (!id) return;
      if (!(id in byId)) orderedIds.push(id);
      byId[id] = t;
    });
    var added = 0, updated = 0;
    fresh.forEach(function (t) {
      var id = txId(t);
      if (!id) return;
      if (byId[id]) {
        // Don't overwrite manual user edits
        if (!byId[id].userEdited) {
          byId[id] = Object.assign({}, byId[id], t);
          updated++;
        }
      } else {
        byId[id] = t;
        orderedIds.unshift(id);
        added++;
      }
    });
    var out = orderedIds.map(function (id) { return byId[id]; }).filter(Boolean);
    out.sort(function (a, b) {
      var da = new Date(a.date || a.timestamp || 0).getTime();
      var db = new Date(b.date || b.timestamp || 0).getTime();
      return db - da;
    });
    return { merged: out, added: added, updated: updated };
  }

  async function queryFirestoreTx(dbCtx, uid) {
    var cutoff = new Date(Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    var raw = [];
    try {
      if (dbCtx.kind === 'modular') {
        var m = dbCtx.mod;
        var ref = m.collection(dbCtx.db, 'users', uid, 'transactions');
        var snap = await m.getDocs(ref);
        snap.forEach(function (d) { raw.push(Object.assign({ _fsId: d.id }, d.data())); });
      } else {
        var snap2 = await dbCtx.db.collection('users').doc(uid).collection('transactions').get();
        snap2.forEach(function (d) { raw.push(Object.assign({ _fsId: d.id }, d.data())); });
      }
    } catch (e) { try { console.warn('[wjp-fs-tx] query failed', e); } catch (_) {} return []; }
    // Filter to last MAX_DAYS days
    raw = raw.filter(function (t) {
      var d = t.date || t.authorized_date || t.timestamp;
      if (!d) return false;
      var iso = (typeof d === 'string') ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
      return iso >= cutoff;
    });
    return raw;
  }

  async function refresh() {
    var uid = getUid();
    if (!uid) return { ok: false, reason: 'no-uid' };
    var dbCtx = await getDb();
    if (!dbCtx) return { ok: false, reason: 'no-firestore' };

    var rawPlaid = await queryFirestoreTx(dbCtx, uid);
    if (!rawPlaid.length) {
      try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())); } catch (_) {}
      return { ok: true, added: 0, updated: 0, totalFromFs: 0 };
    }

    // Convert each Plaid-shape doc into in-app shape
    var converted = rawPlaid.map(function (t) {
      return plaidToAppShape(t, t.institutionName);
    }).filter(Boolean);

    // Merge into appState.transactions (the canonical in-memory store)
    if (!window.appState) {
      // App hasn't initialized — write to localStorage and bail; app boot will re-read.
      try {
        var lsState = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        var existingLs = Array.isArray(lsState.transactions) ? lsState.transactions : [];
        var mergedLs = dedupedMerge(existingLs, converted);
        lsState.transactions = mergedLs.merged;
        localStorage.setItem(LS_KEY, JSON.stringify(lsState));
      } catch (_) {}
      return { ok: true, deferred: true, reason: 'appState-not-ready', count: converted.length };
    }

    var existing = Array.isArray(window.appState.transactions) ? window.appState.transactions : [];
    var res = dedupedMerge(existing, converted);
    window.appState.transactions = res.merged;

    // Persist via the app's own saveState() — this triggers cloudPushDebounced
    // which writes back to users/{uid}/state/main so other devices pick it up.
    try {
      if (typeof window.saveState === 'function') {
        window.saveState();
      } else {
        // Fallback: direct localStorage write
        var lsState2 = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        lsState2.transactions = res.merged;
        localStorage.setItem(LS_KEY, JSON.stringify(lsState2));
      }
    } catch (e) { try { console.warn('[wjp-fs-tx] saveState failed', e); } catch (_) {} }

    // Tell the UI to re-render
    try {
      if (typeof window.renderTransactions === 'function') window.renderTransactions();
      if (typeof window.renderCalendar === 'function') window.renderCalendar();
      if (typeof window.updateUI === 'function') window.updateUI();
      window.dispatchEvent(new CustomEvent('wjp-transactions-rehydrated', {
        detail: { added: res.added, updated: res.updated, total: res.merged.length }
      }));
    } catch (_) {}

    try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())); } catch (_) {}
    try { console.log('[wjp-fs-tx v2] hydrated', { added: res.added, updated: res.updated, total: res.merged.length }); } catch (_) {}
    return { ok: true, added: res.added, updated: res.updated, total: res.merged.length };
  }

  async function boot() {
    // Wait for auth
    var attempts = 0;
    while (attempts < 30 && !getUid()) {
      await new Promise(function (r) { setTimeout(r, 800); });
      attempts++;
    }
    if (!getUid()) return;
    // Wait for cloudPull to settle before merging so we don't race + lose data.
    await new Promise(function (r) { setTimeout(r, BOOT_DELAY_MS); });
    await refresh();
    // Periodic refresh for long-lived tabs
    setInterval(function () { refresh().catch(function () {}); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  } else {
    setTimeout(boot, 1500);
  }

  window.WJP_TxBootstrap = {
    refresh: refresh,
    plaidToAppShape: plaidToAppShape,
    version: 2
  };
})();
