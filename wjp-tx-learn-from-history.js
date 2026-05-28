/* wjp-tx-learn-from-history.js v1 — rebuild prefs.learnedCategories from
 * existing per-transaction userCategoryId values, then auto-apply to any
 * untagged transactions sharing the same canonical merchant.
 *
 * Winston 2026-05-28: "saved categories for transactions yesterday.
 * today everything says other. its not staying saved and populating the
 * future bills."
 *
 * Two-part bug:
 *   B. prefs.learnedCategories was effectively empty on cold-load — either
 *      the picker → smart-categorize learning path never recorded
 *      mappings, or they got wiped. Result: new transactions arriving
 *      today have no merchant memory to consult, so they stay 'other'.
 *   C. Some merchants Winston had set yesterday (Walmart→groceries,
 *      BP→gas, etc.) ARE still tagged on existing transactions — that
 *      data survived cloud sync. But the learned mapping that should
 *      auto-tag NEW transactions from the same merchants is gone.
 *
 * This module is a self-healing bootstrap:
 *   1. Walk appState.transactions. For each one with a real
 *      userCategoryId (not 'other'/'transfer'/'income' — those are
 *      heuristic, not user-confirmed), build a counter per
 *      (merchantKey, categoryId) pair.
 *   2. For each merchantKey, pick the dominant categoryId
 *      (most-frequent winner) and seed prefs.learnedCategories[key]
 *      with that mapping (count = number of confirming txns).
 *   3. Run autoCategorizeAll() so all untagged txns sharing those
 *      merchants get tagged immediately.
 *   4. saveState() → cloud-syncs prefs so future devices/sessions
 *      have the mapping.
 *
 * Re-runs whenever:
 *   - appState gets a category change (a new merchant might emerge)
 *   - Plaid sync brings new transactions
 *   - cloud pull replaces state
 *
 * Idempotent: only INSERTS into learnedCategories. Never overwrites a
 * higher-confidence mapping with a lower one.
 *
 * Bare appState access. Safe. Universal — no hardcoded merchants.
 */
(function () {
  'use strict';
  if (window._wjpTxLearnFromHistoryInstalled) return;
  window._wjpTxLearnFromHistoryInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // Categories that are HEURISTIC results, not user-confirmed learnings.
  // We don't want to seed learnedCategories with merchants whose only
  // category is 'transfer' or 'income' (those come from pattern matching,
  // not from Winston picking).
  var HEURISTIC_CATS = { 'other': 1, 'transfer': 1, 'income': 1 };

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  // v2: localStorage backup — survives cloud-clobber races where one tab
  // pushes a stale prefs.learnedCategories over a tab that had richer
  // mappings. The backup is per-user-scoped to avoid cross-account leak.
  function backupKey() {
    var uid = '';
    try { if (window.firebase && window.firebase.auth && window.firebase.auth().currentUser) uid = window.firebase.auth().currentUser.uid || ''; } catch (_) {}
    try { if (!uid && window.WJP_Auth && window.WJP_Auth.uid) uid = window.WJP_Auth.uid; } catch (_) {}
    try { if (!uid) uid = (localStorage.getItem('wjp_anon_id') || '').slice(0, 40); } catch (_) {}
    return 'wjp.tx.learnedCategories.backup.v1' + (uid ? '.uid_' + uid : '');
  }
  function readBackup() {
    try { var r = localStorage.getItem(backupKey()); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }
  function writeBackup(map) {
    try { localStorage.setItem(backupKey(), JSON.stringify(map || {})); } catch (_) {}
  }
  function mergeIntoLearned(src) {
    if (!src || typeof src !== 'object') return 0;
    var s = getState(); if (!s) return 0;
    if (!s.prefs) s.prefs = {};
    if (!s.prefs.learnedCategories || typeof s.prefs.learnedCategories !== 'object') s.prefs.learnedCategories = {};
    var learned = s.prefs.learnedCategories;
    var added = 0;
    Object.keys(src).forEach(function (k) {
      var sv = src[k];
      if (!sv || !sv.categoryId) return;
      var ex = learned[k];
      if (!ex) { learned[k] = sv; added++; }
      else if (ex.categoryId !== sv.categoryId && (sv.count || 0) > (ex.count || 0)) {
        learned[k] = sv; added++;
      }
    });
    return added;
  }

  function canonMerchant(name) {
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.canonMerchant) {
        return window.WJP_TxSmartCategorize.canonMerchant(name);
      }
    } catch (_) {}
    if (!name) return '';
    var s = String(name).toLowerCase();
    s = s.replace(/[0-9#@*]+/g, ' ');
    s = s.replace(/\b(inc|llc|ltd|co|corp|company|store|locat|pos|debit|credit|purchase|pmt|payment|online|web|app)\b/g, ' ');
    s = s.replace(/[^a-z\s]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s.split(' ').filter(function (w) { return w.length >= 2; }).slice(0, 3).join(' ').trim();
  }

  // Build a merchantKey → { catId: count } tally from existing txn data
  function tallyMerchantCategories() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return {};
    var tally = {};
    s.transactions.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      var cat = t.userCategoryId;
      if (!cat || HEURISTIC_CATS[cat]) return;
      var nm = t.merchant || t.name || t.description || t.merchant_name || '';
      var key = canonMerchant(nm);
      if (!key || key.length < 2) return;
      if (!tally[key]) tally[key] = {};
      tally[key][cat] = (tally[key][cat] || 0) + 1;
    });
    return tally;
  }

  // Seed prefs.learnedCategories from the tally. Returns { seeded, updated }.
  function seedLearnedFromTally(tally) {
    var s = getState();
    if (!s) return { seeded: 0, updated: 0 };
    if (!s.prefs || typeof s.prefs !== 'object') s.prefs = {};
    if (!s.prefs.learnedCategories || typeof s.prefs.learnedCategories !== 'object') {
      s.prefs.learnedCategories = {};
    }
    var learned = s.prefs.learnedCategories;
    var seeded = 0, updated = 0;
    Object.keys(tally).forEach(function (key) {
      var cats = tally[key];
      // Pick the dominant categoryId
      var winner = null, winnerCount = 0;
      Object.keys(cats).forEach(function (c) {
        if (cats[c] > winnerCount) { winnerCount = cats[c]; winner = c; }
      });
      if (!winner) return;
      // Need at least 2 confirming txns to call it "learned" (avoid noise).
      // Exception: if user has only ONE txn from this merchant + tagged it,
      // still seed (Winston's intent is clear).
      var existing = learned[key];
      if (!existing) {
        learned[key] = {
          categoryId: winner,
          count: winnerCount,
          lastUpdated: Date.now(),
          source: 'history-bootstrap'
        };
        seeded++;
      } else if (existing.categoryId === winner && winnerCount > (existing.count || 0)) {
        // Reinforce existing mapping with higher count
        existing.count = winnerCount;
        existing.lastUpdated = Date.now();
        updated++;
      } else if (existing.categoryId !== winner && winnerCount > (existing.count || 0)) {
        // User has clearly retrained this merchant — overwrite
        existing.categoryId = winner;
        existing.count = winnerCount;
        existing.lastUpdated = Date.now();
        existing.source = 'history-bootstrap-retrained';
        updated++;
      }
    });
    return { seeded: seeded, updated: updated };
  }

  // Apply newly-seeded mappings to untagged transactions
  function applyToUntagged() {
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.autoCategorizeAll) {
        return window.WJP_TxSmartCategorize.autoCategorizeAll();
      }
    } catch (_) {}
    return { learned: 0, transfer: 0, total: 0 };
  }

  function runOnce(reason) {
    var s = getState();
    if (!s || !Array.isArray(s.transactions) || s.transactions.length === 0) return null;
    // v2: restore from localStorage backup FIRST so cloud-clobbered mappings come back
    var bk = readBackup();
    var restored = mergeIntoLearned(bk);
    var tally = tallyMerchantCategories();
    var keys = Object.keys(tally);
    var seedRes = { seeded: 0, updated: 0 };
    if (keys.length > 0) seedRes = seedLearnedFromTally(tally);
    var applyRes = applyToUntagged();
    // v2: write backup AFTER seeding so next session has the freshest snapshot
    try {
      if (s.prefs && s.prefs.learnedCategories) writeBackup(s.prefs.learnedCategories);
    } catch (_) {}
    if (restored > 0 || seedRes.seeded > 0 || seedRes.updated > 0 || applyRes.total > 0) {
      saveState();
      try {
        window.dispatchEvent(new CustomEvent('wjp-categories-changed', {
          detail: { reason: 'learn-from-history-' + (reason || 'boot'), seeded: seedRes.seeded, updated: seedRes.updated, applied: applyRes.total }
        }));
      } catch (_) {}
      try { console.log('[wjp-tx-learn-from-history]', reason || 'boot', '— merchants:', keys.length, 'seeded:', seedRes.seeded, 'updated:', seedRes.updated, 'applied-to-untagged:', applyRes.total); } catch (_) {}
    }
    return { merchants: keys.length, seeded: seedRes.seeded, updated: seedRes.updated, applied: applyRes.total };
  }

  function boot() {
    // Wait for appState + categorize module + categories to be ready
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.transactions) && s.transactions.length > 0 && window.WJP_TxSmartCategorize) {
        runOnce('boot');
        return;
      }
      if (attempts < 30) setTimeout(tick, 2000);
    }
    setTimeout(tick, 5000);
    // Re-run when new data arrives
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(function(){ runOnce('plaid-sync'); }, 1000); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(function(){ runOnce('tx-changed'); }, 1000); });
    window.addEventListener('wjp-data-restored', function () { setTimeout(function(){ runOnce('data-restored'); }, 1500); });
    // Safety net every 10 min in case cloud pull drops mappings mid-session
    setInterval(function () { runOnce('safety-tick'); }, 10 * 60 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TxLearnFromHistory = {
    version: 2,
    runOnce: runOnce,
    tallyMerchantCategories: tallyMerchantCategories
  };
})();
