/* wjp-smart-categorize-boost.js v1 — Proactively fill "Other" transactions
 * by learning from already-categorized txns + a keyword fallback table.
 *
 * Winston FIX 40: 80 transactions sat in "Other" even after the basic
 * smart-categorize ran. The existing module only acts when the user
 * explicitly changes a category (wjp-tx-category-changed). This module
 * does the proactive sweep:
 *
 *   1. Build a canonical-merchant → categoryId index from EVERY txn
 *      that's already been categorized (user-edited OR auto-assigned
 *      with high confidence).
 *   2. For each "Other"/uncategorized txn, look up by canonical key. If
 *      a confident match exists in the index → assign.
 *   3. Fallback to a built-in KEYWORD_HINTS table for common merchants
 *      (Walmart, BP, Shell, Starbucks, Netflix, etc.) → assign with
 *      auto-keyword source.
 *
 * Skips: transfers, synthetic, user-edited (respect explicit user choice).
 * Re-runs on boot + after each user category change + after Plaid sync.
 *
 * Universal: works for any user. The KEYWORD_HINTS only fire when a
 * matching txn exists — they're not hardcoded data for one user.
 */
(function () {
  'use strict';
  if (window._wjpSmartCategorizeBoostInstalled) return;
  window._wjpSmartCategorizeBoostInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function canonMerchant(name) {
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.canonMerchant) {
        return window.WJP_TxSmartCategorize.canonMerchant(name);
      }
    } catch (_) {}
    if (!name) return '';
    return String(name).toLowerCase()
      .replace(/[0-9#@*]+/g, ' ')
      .replace(/\b(inc|llc|ltd|co|corp|company|store|locat|pos|debit|credit|purchase|pmt|payment|online|web|app)\b/g, ' ')
      .replace(/[^a-z\s]+/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (w) { return w.length >= 2; }).slice(0, 3).join(' ');
  }
  function isTransfer(t) {
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
        return !!window.WJP_TxSmartCategorize.isTransfer(t);
      }
    } catch (_) {}
    var fields = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(fields);
  }
  function categoryExists(id) {
    return !!(window.WJP_Categories && window.WJP_Categories.get && window.WJP_Categories.get(id));
  }
  function pickCategoryByName(name) {
    if (!window.WJP_Categories || !window.WJP_Categories.list) return null;
    var hit = window.WJP_Categories.list().find(function (c) {
      return c.name.toLowerCase() === name.toLowerCase();
    });
    return hit ? hit.id : null;
  }

  // KEYWORD_HINTS: ordered patterns → category. Used only as a fallback
  // when the learned merchant index has no match. The category id must
  // exist in WJP_Categories — we resolve common names to ids at apply time.
  var KEYWORD_HINTS = [
    // Groceries
    { re: /\b(walmart|target|kroger|trader\s*joe|whole\s*foods|aldi|publix|wegmans|safeway|sams\s*club|costco|food\s*lion|h-e-b|stop\s*and\s*shop|stop\s*&\s*shop|giant|fresh\s*market|sprouts|albertsons|ralphs|meijer|winco|shoprite)\b/i, cat: 'Groceries' },
    // Gas
    { re: /\b(shell|chevron|exxon|mobil|bp\b|valero|sunoco|texaco|arco|sinclair|wawa|sheetz|circle\s*k|speedway|costco\s*gas|sams\s*club\s*gas|7-eleven|7\s*eleven|fuel|gas\s*station)\b/i, cat: 'Gas' },
    // Dining / restaurants
    { re: /\b(starbucks|dunkin|mcdonald|burger\s*king|wendy|chick-fil-a|chick\s*fil\s*a|chipotle|panera|subway|taco\s*bell|kfc|pizza\s*hut|papa\s*john|domino|five\s*guys|in-n-out|in\s*n\s*out|popeyes|sweet\s*green|shake\s*shack|olive\s*garden|cheesecake\s*factory|outback|denny|ihop|cracker\s*barrel|applebee|chili|red\s*lobster|texas\s*roadhouse|bj's|buffalo\s*wild|doordash|grubhub|ubereats|uber\s*eats|postmates|seamless|caviar)\b/i, cat: 'Dining' },
    // Transit / rideshare
    { re: /\b(uber|lyft|mta|amtrak|metro\s*north|nj\s*transit|new\s*jersey\s*transit|septa|bart|wmata|cta|caltrain|long\s*island\s*rail|lirr|e-?z-?pass|ezpass|toll|parking)\b/i, cat: 'Transit' },
    // Bills / utilities
    { re: /\b(pseg|pse&g|coned|con\s*edison|national\s*grid|verizon|t-mobile|tmobile|at&t|att\s*mobility|comcast|xfinity|spectrum|optimum|cablevision|directv|dish\s*network|frontier|cox|centurylink|water\s*bill|sewer|electric\s*bill|gas\s*bill)\b/i, cat: 'Bills' },
    // Subscriptions / entertainment
    { re: /\b(netflix|hulu|disney\s*plus|disney\+|hbo\s*max|max\.com|peacock|paramount|apple\s*tv|apple\.com\/bill|spotify|amazon\s*prime|amazon\s*music|youtube\s*premium|chatgpt|openai|claude|anthropic|google\s*one|icloud|adobe|microsoft\s*365|office\s*365|dropbox)\b/i, cat: 'Subscriptions' },
    // Shopping
    { re: /\b(amazon\.com|amzn|ebay|etsy|aliexpress|wayfair|nordstrom|macys|kohls|jcpenney|tj\s*maxx|tjmaxx|marshalls|ross\s*dress|home\s*depot|lowes|best\s*buy|apple\s*store|ikea|crate\s*and\s*barrel|williams\s*sonoma|pottery\s*barn|west\s*elm|sephora|ulta|nike|adidas|lululemon|gap|old\s*navy|banana\s*republic|h&m|zara|uniqlo)\b/i, cat: 'Shopping' },
    // Healthcare
    { re: /\b(cvs|walgreens|rite\s*aid|pharmacy|kaiser|aetna|cigna|blue\s*cross|united\s*health|copay|hospital|clinic|dental|optical|lenscrafters|warby\s*parker|teladoc)\b/i, cat: 'Healthcare' },
    // Personal care
    { re: /\b(barber|salon|spa|haircut|hairdresser|nails|nail\s*salon|massage|gym|fitness|peloton|equinox|planet\s*fitness|orange\s*theory|crunch\s*fitness|lifetime\s*fitness|24\s*hour\s*fitness)\b/i, cat: 'Personal Care' },
    // Travel
    { re: /\b(airbnb|booking\.com|expedia|hotels\.com|marriott|hilton|hyatt|holiday\s*inn|delta\s*airlines|delta\s*air|united\s*airlines|american\s*airlines|aa\.com|southwest|jetblue|spirit\s*airlines|frontier\s*airlines|alaska\s*airlines)\b/i, cat: 'Travel' }
  ];

  function resolveCategoryId(catName) {
    // First try direct id (lowercase match)
    var lower = catName.toLowerCase().replace(/\s+/g, '_');
    if (categoryExists(lower)) return lower;
    // Then try resolving by name
    return pickCategoryByName(catName);
  }

  // Build a canonical-merchant → categoryId index from already-categorized txns
  function buildIndex(txns) {
    var idx = {};
    txns.forEach(function (t) {
      if (!t) return;
      // Skip transfer/income — they shouldn't propagate as category hints
      if (isTransfer(t)) return;
      if (!t.userCategoryId) return;
      if (t.userCategoryId === 'other' || t.userCategoryId === 'transfer' || t.userCategoryId === 'income') return;
      var name = t.merchant || t.name || '';
      var key = canonMerchant(name);
      if (!key || key.length < 3) return;
      if (!idx[key]) idx[key] = {};
      idx[key][t.userCategoryId] = (idx[key][t.userCategoryId] || 0) + 1;
    });
    // Resolve each key to its most-confident category
    var resolved = {};
    Object.keys(idx).forEach(function (k) {
      var counts = idx[k];
      var bestId = null, bestN = 0;
      Object.keys(counts).forEach(function (cid) {
        if (counts[cid] > bestN) { bestN = counts[cid]; bestId = cid; }
      });
      if (bestId && bestN >= 1) resolved[k] = { id: bestId, n: bestN };
    });
    return resolved;
  }

  function sweep() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return { learned: 0, hinted: 0, total: 0 };
    var index = buildIndex(s.transactions);

    var learned = 0, hinted = 0, transfersTagged = 0;
    s.transactions.forEach(function (t) {
      if (!t) return;
      if (t.synthetic) return;
      if (t._supersededBy) return;
      if (t.userEdited) return; // respect explicit user choice
      var cur = t.userCategoryId;
      // FIX 49 (Winston 2026-05-27): if it's a transfer-like txn AND
      // currently untagged, tag it as 'transfer' so it doesn't fall
      // back to Other. Don't override an existing non-other category.
      if (isTransfer(t)) {
        if (!cur || cur === 'other') {
          t.userCategoryId = 'transfer';
          t.userCategorySource = 'auto-transfer-boost';
          transfersTagged++;
        }
        return;
      }
      // Only act on txns currently uncategorized OR explicitly 'other'
      if (cur && cur !== 'other') return;
      var name = t.merchant || t.name || '';
      var key = canonMerchant(name);
      // (1) Learned match
      if (key && index[key]) {
        var newId = index[key].id;
        if (newId && newId !== cur) {
          t.userCategoryId = newId;
          t.userCategorySource = 'auto-learned-boost';
          learned++;
          return;
        }
      }
      // (2) Keyword fallback
      var fullText = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
      for (var i = 0; i < KEYWORD_HINTS.length; i++) {
        if (KEYWORD_HINTS[i].re.test(fullText)) {
          var resolvedId = resolveCategoryId(KEYWORD_HINTS[i].cat);
          if (resolvedId && resolvedId !== cur) {
            t.userCategoryId = resolvedId;
            t.userCategorySource = 'auto-keyword-hint';
            hinted++;
            break;
          }
        }
      }
    });

    var total = learned + hinted + transfersTagged;
    if (total > 0) {
      saveState();
      try {
        window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'boost-sweep', learned: learned, hinted: hinted, transfersTagged: transfersTagged } }));
      } catch (_) {}
      try { console.log('[wjp-smart-categorize-boost] learned', learned, 'keyword-hinted', hinted, 'transfers-tagged', transfersTagged); } catch (_) {}
    }
    return { learned: learned, hinted: hinted, transfersTagged: transfersTagged, total: total };
  }

  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.transactions) && s.transactions.length > 0) {
        sweep();
        return;
      }
      if (attempts < 20) setTimeout(tick, 1500);
    }
    // Wait long enough for WJP_Categories + WJP_TxSmartCategorize + appState
    setTimeout(tick, 5000);
    window.addEventListener('wjp-tx-category-changed', function () { setTimeout(sweep, 500); });
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(sweep, 500); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(sweep, 500); });
    window.addEventListener('wjp-categories-changed', function (e) {
      try { if (e && e.detail && /boost-sweep/.test(e.detail.reason)) return; } catch (_) {}
      setTimeout(sweep, 500);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_SmartCategorizeBoost = {
    version: 2,
    sweep: sweep,
    buildIndex: buildIndex,
    KEYWORD_HINTS: KEYWORD_HINTS
  };
})();
