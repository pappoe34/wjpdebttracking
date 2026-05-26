/* wjp-categories.js v1 — User-defined transaction categories.
 *
 * Scope (universal — works for ANY user, not Winston-specific):
 *   • 14 default categories seeded on first use (Groceries, Dining, Transit,
 *     Gas, Bills, Subscriptions, Shopping, Entertainment, Travel, Healthcare,
 *     Personal Care, Income, Transfer, Other)
 *   • Per-user persistence via appState.categories (an array of {id, name,
 *     icon, color, builtin}) — saved + backed up by guard v3
 *   • Public CRUD: list, get, add, rename, setIcon, setColor, delete, reorder
 *   • Categories used by transaction picker (Step 2) + charts/billing history
 *
 * Storage shape:
 *   appState.categories = [
 *     { id: 'groceries', name: 'Groceries', icon: 'ph-shopping-cart',
 *       color: '#22c55e', builtin: true, order: 0 },
 *     ...
 *   ]
 *
 * Categories use stable IDs so renaming doesn't orphan transactions.
 * Deleting a category re-assigns its transactions to 'other'.
 *
 * Public API: window.WJP_Categories.{ list, get, add, rename, setIcon,
 * setColor, delete, reorder, seedIfEmpty, version }
 *
 * Bare appState access (per memory rule feedback_appstate_bare_identifier).
 * Idempotent install guard.
 */
(function () {
  'use strict';
  if (window._wjpCategoriesInstalled) return;
  window._wjpCategoriesInstalled = true;

  // CRITICAL: bare appState first, window.appState only as fallback orphan.
  function appS() {
    try { if (typeof appState !== 'undefined' && appState) return appState; } catch (_) {}
    try { if (window.appState) return window.appState; } catch (_) {}
    return null;
  }

  // Seed defaults — universal, no user-specific values.
  // Colors picked for clear distinction in dark + light mode, accessible contrast.
  var DEFAULTS = [
    { id: 'groceries',     name: 'Groceries',     icon: 'ph-shopping-cart',   color: '#22c55e' },
    { id: 'dining',        name: 'Dining',        icon: 'ph-fork-knife',      color: '#f97316' },
    { id: 'transit',       name: 'Transit',       icon: 'ph-train',           color: '#0891b2' },
    { id: 'gas',           name: 'Gas',           icon: 'ph-gas-pump',        color: '#dc2626' },
    { id: 'bills',         name: 'Bills',         icon: 'ph-receipt',         color: '#7c3aed' },
    { id: 'subscriptions', name: 'Subscriptions', icon: 'ph-arrows-clockwise',color: '#a855f7' },
    { id: 'shopping',      name: 'Shopping',      icon: 'ph-shopping-bag',    color: '#ec4899' },
    { id: 'entertainment', name: 'Entertainment', icon: 'ph-film-strip',      color: '#8b5cf6' },
    { id: 'travel',        name: 'Travel',        icon: 'ph-airplane',        color: '#06b6d4' },
    { id: 'healthcare',    name: 'Healthcare',    icon: 'ph-first-aid',       color: '#ef4444' },
    { id: 'personal',      name: 'Personal Care', icon: 'ph-user',            color: '#14b8a6' },
    { id: 'income',        name: 'Income',        icon: 'ph-trend-up',        color: '#10b981' },
    { id: 'transfer',      name: 'Transfer',      icon: 'ph-arrows-left-right', color: '#64748b' },
    { id: 'other',         name: 'Other',         icon: 'ph-dots-three-circle', color: '#94a3b8' }
  ];

  function _normalize(cats) {
    if (!Array.isArray(cats)) return [];
    var seen = {};
    var out = [];
    cats.forEach(function (c, i) {
      if (!c || typeof c !== 'object' || !c.id) return;
      var id = String(c.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({
        id: id,
        name: String(c.name || id).slice(0, 60),
        icon: String(c.icon || 'ph-dots-three-circle'),
        color: String(c.color || '#94a3b8'),
        builtin: !!c.builtin,
        order: typeof c.order === 'number' ? c.order : i
      });
    });
    out.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    return out;
  }

  function seedIfEmpty() {
    var s = appS(); if (!s) return [];
    if (!Array.isArray(s.categories) || s.categories.length === 0) {
      s.categories = DEFAULTS.map(function (c, i) {
        return Object.assign({}, c, { builtin: true, order: i });
      });
      try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'seeded' } })); } catch (_) {}
    } else {
      // Ensure 'other' always exists as the fallback for deleted categories.
      var hasOther = s.categories.some(function (c) { return c && c.id === 'other'; });
      if (!hasOther) {
        var existingOrders = s.categories.map(function (c) { return c.order || 0; });
        var maxOrder = existingOrders.length ? Math.max.apply(null, existingOrders) : 0;
        s.categories.push({ id: 'other', name: 'Other', icon: 'ph-dots-three-circle', color: '#94a3b8', builtin: true, order: maxOrder + 1 });
        try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
      }
    }
    return _normalize(s.categories);
  }

  function list() {
    var s = appS(); if (!s) return [];
    if (!Array.isArray(s.categories) || s.categories.length === 0) return seedIfEmpty();
    return _normalize(s.categories);
  }

  function get(id) {
    return list().find(function (c) { return c.id === id; }) || null;
  }

  // Add a new (user-defined) category. Returns the new id.
  function add(name, opts) {
    opts = opts || {};
    var s = appS(); if (!s) return null;
    if (!Array.isArray(s.categories)) seedIfEmpty();
    name = String(name || '').trim();
    if (!name) return null;
    // Generate a stable id from name + a short random suffix to avoid collisions
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'cat';
    var id = base;
    var i = 2;
    while (s.categories.some(function (c) { return c.id === id; })) {
      id = base + '-' + i++;
    }
    var existingOrders = s.categories.map(function (c) { return c.order || 0; });
    var maxOrder = existingOrders.length ? Math.max.apply(null, existingOrders) : 0;
    s.categories.push({
      id: id,
      name: name.slice(0, 60),
      icon: String(opts.icon || 'ph-tag'),
      color: String(opts.color || '#94a3b8'),
      builtin: false,
      order: maxOrder + 1
    });
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'added', id: id } })); } catch (_) {}
    return id;
  }

  function rename(id, newName) {
    var s = appS(); if (!s || !Array.isArray(s.categories)) return false;
    var cat = s.categories.find(function (c) { return c.id === id; });
    if (!cat) return false;
    newName = String(newName || '').trim();
    if (!newName) return false;
    cat.name = newName.slice(0, 60);
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'renamed', id: id } })); } catch (_) {}
    return true;
  }

  function setIcon(id, icon) {
    var s = appS(); if (!s || !Array.isArray(s.categories)) return false;
    var cat = s.categories.find(function (c) { return c.id === id; });
    if (!cat) return false;
    cat.icon = String(icon || 'ph-tag');
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'icon-changed', id: id } })); } catch (_) {}
    return true;
  }

  function setColor(id, color) {
    var s = appS(); if (!s || !Array.isArray(s.categories)) return false;
    var cat = s.categories.find(function (c) { return c.id === id; });
    if (!cat) return false;
    cat.color = String(color || '#94a3b8');
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'color-changed', id: id } })); } catch (_) {}
    return true;
  }

  // Delete a category. Re-assigns any transactions/recurringPayments using
  // it to 'other'. The 'other' category itself cannot be deleted.
  function del(id) {
    if (id === 'other') return false;
    var s = appS(); if (!s || !Array.isArray(s.categories)) return false;
    var idx = s.categories.findIndex(function (c) { return c.id === id; });
    if (idx < 0) return false;
    s.categories.splice(idx, 1);
    // Re-assign any transactions using this category
    if (Array.isArray(s.transactions)) {
      s.transactions.forEach(function (t) {
        if (t && t.userCategoryId === id) t.userCategoryId = 'other';
      });
    }
    if (Array.isArray(s.recurringPayments)) {
      s.recurringPayments.forEach(function (r) {
        if (r && r.userCategoryId === id) r.userCategoryId = 'other';
      });
    }
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'deleted', id: id } })); } catch (_) {}
    return true;
  }

  // Reorder. Pass an array of ids in the new order; any missing ids stay at the end.
  function reorder(idsInOrder) {
    if (!Array.isArray(idsInOrder)) return false;
    var s = appS(); if (!s || !Array.isArray(s.categories)) return false;
    var pos = {};
    idsInOrder.forEach(function (id, i) { pos[id] = i; });
    var nextOrder = idsInOrder.length;
    s.categories.forEach(function (c) {
      c.order = (c.id in pos) ? pos[c.id] : nextOrder++;
    });
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'reordered' } })); } catch (_) {}
    return true;
  }

  // Look up the user-assigned category for a transaction (returns the
  // category object). Falls back to 'other' for transactions without an
  // assignment, OR attempts to derive from the Plaid category string.
  function forTransaction(txn) {
    if (!txn || typeof txn !== 'object') return get('other');
    if (txn.userCategoryId) {
      var c = get(txn.userCategoryId);
      if (c) return c;
    }
    // Derive from Plaid category (lowercase keyword match)
    var plaidCat = String(txn.category || '').toLowerCase();
    if (!plaidCat) return get('other');
    // Common Plaid PFC keywords → our default ids
    var map = [
      [/grocer/, 'groceries'],
      [/food|restaur|fast.?food|dining/, 'dining'],
      [/transport|transit|taxi|rideshare|public.?trans|uber|lyft|subway|bus|train/, 'transit'],
      [/gas|fuel/, 'gas'],
      [/util|electric|water|internet|phone|telecom|cable/, 'bills'],
      [/subscript|netflix|spotify|streaming/, 'subscriptions'],
      [/shopping|retail/, 'shopping'],
      [/entertain|movie|concert/, 'entertainment'],
      [/travel|airfare|airline|hotel|lodg|vacation/, 'travel'],
      [/health|medical|dental|pharmacy/, 'healthcare'],
      [/personal.?care|spa|salon|beauty/, 'personal'],
      [/income|deposit|salary|payroll/, 'income'],
      [/transfer/, 'transfer']
    ];
    for (var i = 0; i < map.length; i++) {
      if (map[i][0].test(plaidCat)) return get(map[i][1]) || get('other');
    }
    return get('other');
  }

  // Assign a category to a transaction
  function assignToTransaction(txnId, categoryId) {
    var s = appS(); if (!s || !Array.isArray(s.transactions)) return false;
    var t = s.transactions.find(function (x) { return x && x.id === txnId; });
    if (!t) return false;
    if (!get(categoryId)) return false; // unknown category
    t.userCategoryId = categoryId;
    t.userCategoryUpdatedAt = Date.now();
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-transaction-categorized', { detail: { txnId: txnId, categoryId: categoryId } })); } catch (_) {}
    return true;
  }

  // Sum spending per category for a given date range. Returns
  // { byId: { catId: { amount, count } }, total }.
  function spendingByCategory(opts) {
    opts = opts || {};
    var s = appS(); if (!s || !Array.isArray(s.transactions)) return { byId: {}, total: 0 };
    var since = opts.since ? new Date(opts.since).getTime() : 0;
    var until = opts.until ? new Date(opts.until).getTime() : Infinity;
    var out = { byId: {}, total: 0 };
    list().forEach(function (c) { out.byId[c.id] = { amount: 0, count: 0 }; });
    s.transactions.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      var ts = t.date ? new Date(t.date).getTime() : 0;
      if (ts < since || ts > until) return;
      var amt = Number(t.amount) || 0;
      // Exclude transfers and income from spending
      var cat = forTransaction(t);
      if (!cat || cat.id === 'transfer' || cat.id === 'income') return;
      // Plaid amount sign convention: positive = outflow on most accounts.
      // Use absolute value; the renderer can decide.
      var abs = Math.abs(amt);
      var bucket = out.byId[cat.id] || (out.byId[cat.id] = { amount: 0, count: 0 });
      bucket.amount += abs;
      bucket.count += 1;
      out.total += abs;
    });
    return out;
  }

  // Initial seed on script load (if appState is ready) and on first
  // saveState fire (if appState was empty at load time).
  function initSeed() {
    try { seedIfEmpty(); } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(initSeed, 1500); });
  } else {
    setTimeout(initSeed, 1500);
  }
  // Retry every 2s for 20s in case appState isn't ready yet
  var attempts = 0;
  var iv = setInterval(function () {
    attempts++;
    var s = appS();
    if (s) {
      seedIfEmpty();
      clearInterval(iv);
    } else if (attempts > 10) clearInterval(iv);
  }, 2000);

  // Public API
  window.WJP_Categories = {
    version: 1,
    DEFAULTS: DEFAULTS.slice(),
    list: list,
    get: get,
    add: add,
    rename: rename,
    setIcon: setIcon,
    setColor: setColor,
    delete: del,
    reorder: reorder,
    seedIfEmpty: seedIfEmpty,
    forTransaction: forTransaction,
    assignToTransaction: assignToTransaction,
    spendingByCategory: spendingByCategory
  };
})();
