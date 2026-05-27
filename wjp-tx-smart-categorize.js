/* wjp-tx-smart-categorize.js v1 — Learn from user category changes + auto-apply.
 *
 * Scope (universal — works for ANY user):
 *   • Records merchant → categoryId mappings whenever a user changes a
 *     transaction's category (via inline select, edit modal, or bulk apply).
 *   • On new/uncategorized transactions, auto-applies the learned mapping.
 *   • Auto-detects internal transfers (TRANSFER patterns) and sets the
 *     'transfer' category — replaces the standalone "Internal transfer"
 *     badge behavior with a single source of truth (the category).
 *   • Shows a tiny toast on auto-categorize so the user knows it happened
 *     and can override.
 *
 * Storage:
 *   appState.prefs.learnedCategories = {
 *     'starbucks':   { categoryId: 'dining',  count: 5, lastUpdated: ts },
 *     'shell':       { categoryId: 'gas',     count: 3, lastUpdated: ts },
 *     ...
 *   }
 *   Keys are canonicalised merchant names (lowercase, trimmed, alphanumeric).
 *
 * Rules:
 *   1. Only AUTO-apply when count >= 1 (i.e., user has confirmed at least once).
 *      Future versions may require count >= 2 to be more conservative.
 *   2. Never overwrite a category the user already set (userCategoryId
 *      exists). userEdited flag respected.
 *   3. Transfer patterns always win — if a row matches, force transfer
 *      category regardless of merchant memory.
 *
 * Bare appState access. Idempotent install. Listens to wjp-tx-category-changed
 * to record + apply in real time.
 */
(function () {
  'use strict';
  if (window._wjpTxSmartCatInstalled) return;
  window._wjpTxSmartCatInstalled = true;

  function appS() {
    try { if (typeof appState !== 'undefined' && appState) return appState; } catch (_) {}
    try { if (window.appState) return window.appState; } catch (_) {}
    return null;
  }
  function saveState() {
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
  }

  // Universal canonicalisation — strips numbers, store numbers, location,
  // common suffixes/prefixes that vary between transactions from the same
  // merchant (e.g., "STARBUCKS #5234 NYC" vs "STARBUCKS STORE 7891 LA").
  function canonMerchant(name) {
    if (!name) return '';
    var s = String(name).toLowerCase();
    s = s.replace(/[0-9#@*]+/g, ' ');            // drop digits / store markers
    s = s.replace(/\b(inc|llc|ltd|co|corp|company|store|locat|pos|debit|credit|purchase|pmt|payment|online|web|app)\b/g, ' ');
    s = s.replace(/[^a-z\s]+/g, ' ');             // alphas + spaces only
    s = s.replace(/\s+/g, ' ').trim();
    // First 2-3 meaningful words is usually plenty
    var parts = s.split(' ').filter(function (w) { return w.length >= 2; });
    return parts.slice(0, 3).join(' ').trim();
  }

  // Same transfer patterns as wjp-transfer-filter so we keep the logic in
  // one mental model. We OWN this list now — wjp-transfer-filter just dims
  // the row (no badge).
  // v2 (2026-05-26, per Winston): if the merchant text contains the word
  // 'transfer' AT ALL, treat it as a transfer between the user's own banks
  // — NOT a real transaction. Plus payment-service apps that are
  // overwhelmingly used for inter-bank moves (Zelle, Venmo, Cash App).
  var TRANSFER_PATTERNS = [
    /\btransfer\b/i,         // catch-all — overrides any specific patterns below
    /\bxfer\b/i,             // common Plaid abbreviation
    /\bzelle\b/i,
    /\bvenmo\b/i,
    /\bcash\s*app\b/i,
    /\bach\s+(deposit|withdrawal|credit|debit)\b/i,
    /\bbank-to-bank\b/i,
    /\bmove\s+(from|to|between)\s+(checking|savings|account)/i
  ];
  function isTransfer(t) {
    if (!t || typeof t !== 'object') return false;
    var fields = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return TRANSFER_PATTERNS.some(function (re) { return re.test(fields); });
  }

  function getLearned() {
    var s = appS(); if (!s) return {};
    if (!s.prefs) s.prefs = {};
    if (!s.prefs.learnedCategories || typeof s.prefs.learnedCategories !== 'object') {
      s.prefs.learnedCategories = {};
    }
    return s.prefs.learnedCategories;
  }
  function rememberMapping(merchantKey, categoryId) {
    if (!merchantKey || !categoryId) return;
    var learned = getLearned();
    var existing = learned[merchantKey];
    if (existing && existing.categoryId === categoryId) {
      existing.count = (existing.count || 0) + 1;
      existing.lastUpdated = Date.now();
    } else {
      learned[merchantKey] = {
        categoryId: categoryId,
        count: 1,
        lastUpdated: Date.now()
      };
    }
    saveState();
    try { window.dispatchEvent(new CustomEvent('wjp-tx-learned', { detail: { merchantKey: merchantKey, categoryId: categoryId } })); } catch (_) {}
  }
  function suggestFor(merchantText) {
    var key = canonMerchant(merchantText);
    if (!key) return null;
    var hit = getLearned()[key];
    if (!hit) return null;
    return hit.categoryId;
  }

  // Apply learned mappings + transfer detection to all transactions that
  // lack a userCategoryId. Returns { learned: N, transfer: N, total: N }.
  function autoCategorizeAll(opts) {
    opts = opts || {};
    var s = appS();
    if (!s || !Array.isArray(s.transactions)) return { learned: 0, transfer: 0, total: 0 };
    var learnedCount = 0, transferCount = 0;
    s.transactions.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      // Skip user-edited or already-set ones unless force
      if (t.userCategoryId && !opts.force) return;
      if (t.userEdited && !opts.force) return;
      // 1. Transfer detection wins
      if (isTransfer(t)) {
        if (t.userCategoryId !== 'transfer') {
          t.userCategoryId = 'transfer';
          t.userCategorySource = 'auto-transfer';
          transferCount++;
        }
        return;
      }
      // 2. Learned merchant mapping
      var merchantText = t.merchant || t.name || t.description || t.merchant_name || '';
      var suggested = suggestFor(merchantText);
      if (suggested) {
        t.userCategoryId = suggested;
        t.userCategorySource = 'auto-learned';
        learnedCount++;
      }
    });
    if (learnedCount + transferCount > 0) {
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'auto-categorize' } })); } catch (_) {}
    }
    return { learned: learnedCount, transfer: transferCount, total: learnedCount + transferCount };
  }

  // Bulk-apply: when user changes ONE merchant's category, offer to apply
  // to all other transactions from the same merchant.
  function bulkApplyMerchant(merchantKey, categoryId) {
    if (!merchantKey || !categoryId) return 0;
    var s = appS();
    if (!s || !Array.isArray(s.transactions)) return 0;
    var n = 0;
    s.transactions.forEach(function (t) {
      if (!t) return;
      var merchantText = t.merchant || t.name || t.description || t.merchant_name || '';
      if (canonMerchant(merchantText) === merchantKey && t.userCategoryId !== categoryId) {
        t.userCategoryId = categoryId;
        t.userCategorySource = 'bulk-applied';
        n++;
      }
    });
    if (n > 0) {
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'bulk-applied', n: n } })); } catch (_) {}
    }
    return n;
  }

  // Toast helper — uses host toast if present, otherwise tiny floating one.
  function toast(msg) {
    try { if (typeof window.showToast === 'function') { window.showToast(msg); return; } } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;background:var(--ink,#1f1a14);color:var(--bg-2,#fff);padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;font-family:system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.25);opacity:0;transition:opacity .25s;';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { try { el.remove(); } catch (_) {} }, 300); }, 2500);
  }

  // When the user changes a category, LEARN it + offer bulk apply.
  window.addEventListener('wjp-tx-category-changed', function (ev) {
    try {
      var d = (ev && ev.detail) || {};
      var s = appS();
      if (!s || !Array.isArray(s.transactions)) return;
      var t = s.transactions.find(function (x) { return x && (x.id === d.txId); });
      if (!t) return;
      // Convert legacy 'category' string changes to userCategoryId if we can
      var catId = d.categoryId || d.category;
      if (!catId) return;
      // If the change was a legacy string category, see if we can map it to a real id
      if (window.WJP_Categories && !window.WJP_Categories.get(catId)) {
        var match = window.WJP_Categories.list().find(function (c) { return c.name.toLowerCase() === String(catId).toLowerCase(); });
        if (match) catId = match.id;
      }
      // Persist to t.userCategoryId too for future-proofing
      if (window.WJP_Categories && window.WJP_Categories.get(catId)) {
        t.userCategoryId = catId;
        t.userEdited = true;
        saveState();
      }
      var merchantText = t.merchant || t.name || t.description || t.merchant_name || '';
      var key = canonMerchant(merchantText);
      if (!key) return;
      rememberMapping(key, catId);
      // Count how many other transactions share this merchant and aren't already set
      var others = s.transactions.filter(function (x) {
        if (!x || x === t) return false;
        var m = x.merchant || x.name || x.description || x.merchant_name || '';
        return canonMerchant(m) === key && x.userCategoryId !== catId;
      });
      if (others.length > 0) {
        // Auto-apply silently (the user already taught us once); just toast the count
        var applied = bulkApplyMerchant(key, catId);
        if (applied > 0) {
          var catName = (window.WJP_Categories && (window.WJP_Categories.get(catId) || {}).name) || catId;
          toast('Categorized ' + applied + ' similar transaction' + (applied === 1 ? '' : 's') + ' as ' + catName);
        }
      }
    } catch (_) {}
  });

  // Run auto-categorize once on boot (after appState is hydrated)
  function bootAutoCategorize() {
    var s = appS();
    if (!s || !Array.isArray(s.transactions)) return false;
    if (s.transactions.length === 0) return true; // nothing to do, success
    var r = autoCategorizeAll();
    if (r.total > 0) {
      try { console.log('[wjp-tx-smart-categorize] auto-applied:', r); } catch (_) {}
    }
    return true;
  }
  // Retry until appState is ready
  var bootAttempts = 0;
  var bootIv = setInterval(function () {
    bootAttempts++;
    if (bootAutoCategorize() || bootAttempts > 30) clearInterval(bootIv);
  }, 2000);

  // Re-run after Plaid sync brings new transactions
  window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(autoCategorizeAll, 200); });
  window.addEventListener('wjp-transactions-changed', function () { setTimeout(autoCategorizeAll, 200); });

  // Public API
  window.WJP_TxSmartCategorize = {
    version: 1,
    canonMerchant: canonMerchant,
    isTransfer: isTransfer,
    suggestFor: suggestFor,
    autoCategorizeAll: autoCategorizeAll,
    bulkApplyMerchant: bulkApplyMerchant,
    rememberMapping: rememberMapping,
    getLearned: getLearned
  };
})();
