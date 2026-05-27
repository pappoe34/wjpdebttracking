/* wjp-categories-recovery.js v1 — Auto-restore missing custom categories
 * from transaction data.
 *
 * Winston 2026-05-26: "what happened to my categories that i defined?"
 *
 * Root cause: appState.categories wasn't in the cloud-sync STATE_KEYS
 * whitelist (now fixed in FIX 44). When the cloud pulled an older state,
 * custom categories were lost from WJP_Categories.list() — but the
 * transactions still carried their userCategoryId values (e.g.
 * 'business-expenses'). Result: those txns fell back to 'Other' in the
 * Billing History card.
 *
 * This module is the safety net. On boot:
 *   1. Walk appState.transactions, collect all unique non-empty
 *      userCategoryId values.
 *   2. For each one that doesn't exist in WJP_Categories.list(), auto-
 *      create the category. Display name = kebab-cased id with capital
 *      words (e.g. 'business-expenses' → 'Business Expenses').
 *   3. Persist (saveState → cloud push).
 *
 * Also runs after wjp-data-restored / wjp-tx-category-changed events.
 * Idempotent: if all referenced categories exist, no-op.
 */
(function () {
  'use strict';
  if (window._wjpCategoriesRecoveryInstalled) return;
  window._wjpCategoriesRecoveryInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function titleCase(id) {
    return String(id || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  function findMissing() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return [];
    if (!window.WJP_Categories || !window.WJP_Categories.get) return [];
    var seen = {};
    s.transactions.forEach(function (t) {
      if (!t || !t.userCategoryId) return;
      var id = String(t.userCategoryId).trim();
      if (!id || seen[id]) return;
      // Skip empty + 'other' (always exists) + built-ins
      if (window.WJP_Categories.get(id)) return;
      seen[id] = true;
    });
    return Object.keys(seen);
  }

  function recover() {
    if (!window.WJP_Categories || !window.WJP_Categories.add) return { restored: 0 };
    var missing = findMissing();
    if (!missing.length) return { restored: 0 };
    var restored = [];
    missing.forEach(function (id) {
      // WJP_Categories.add generates a fresh id from the name, which may
      // collide with the original. We need to inject directly into the
      // categories array so the id matches the txn's stored userCategoryId.
      var s = getState();
      if (!s) return;
      if (!Array.isArray(s.categories)) s.categories = [];
      // Double-check id isn't somehow present
      if (s.categories.some(function (c) { return c && c.id === id; })) return;
      var name = titleCase(id);
      var orders = s.categories.map(function (c) { return c.order || 0; });
      var maxOrder = orders.length ? Math.max.apply(null, orders) : 0;
      s.categories.push({
        id: id,
        name: name,
        icon: 'ph-dots-three-circle',
        color: '#94a3b8',
        builtin: false,
        order: maxOrder + 1,
        restored: true,
        restoredAt: Date.now()
      });
      restored.push({ id: id, name: name });
    });
    if (restored.length > 0) {
      saveState();
      try {
        window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'recovery', restored: restored.map(function (r) { return r.id; }) } }));
      } catch (_) {}
      try { console.log('[wjp-categories-recovery] restored', restored.length, 'categories:', restored.map(function (r) { return r.name; }).join(', ')); } catch (_) {}
    }
    return { restored: restored.length, items: restored };
  }

  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.transactions) && window.WJP_Categories) {
        recover();
        return;
      }
      if (attempts < 30) setTimeout(tick, 1500);
    }
    // Run after categories module + appState have settled
    setTimeout(tick, 4000);
    // Re-run after cloud pull (which is when categories may have been wiped)
    window.addEventListener('wjp-data-restored', function () { setTimeout(recover, 500); });
    window.addEventListener('wjp-tx-category-changed', function () { setTimeout(recover, 300); });
    window.addEventListener('wjp-categories-changed', function (e) {
      // Avoid recursion when we fire the event ourselves
      try { if (e && e.detail && e.detail.reason === 'recovery') return; } catch (_) {}
      setTimeout(recover, 300);
    });
    // Safety: re-check every 5 min in case cloud sync wipes mid-session
    setInterval(recover, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_CategoriesRecovery = { version: 1, recover: recover, findMissing: findMissing };
})();
