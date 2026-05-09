/* wjp-txn-hygiene.js v6 — robust Spending Tracker hygiene.
 *
 * v1 mutated appState.transactions then hoped the host re-rendered. The
 * host's drawCharts/renderTransactions read appState.transactions directly
 * on every tick, so mutations got overwritten on the next sync.
 *
 * v2 strategy: monkey-patch window.drawCharts AND window.renderTransactions
 * so that for the duration of each call, appState.transactions points at a
 * cleaned copy. Original reference is restored immediately after, so any
 * other code that reads the full list still works.
 *
 * Cleaning rules:
 *   - DROP rows that look like internal moves (Online Banking transfer,
 *     transfer from/to acct, self-Zelle, ACH credit/debit not tagged as
 *     payroll, BoA ATM deposits, brokerage transfers, CC payments to own
 *     card, recurring projections with rec- IDs).
 *   - STAMP a real category on every Plaid txn whose category is empty,
 *     "Other", "Uncategorized", or "Misc".
 *   - DO NOT persist — keep localStorage as the raw source of truth.
 */
(function () {
  'use strict';
  if (window._wjpTxnHygieneInstalled) return;
  window._wjpTxnHygieneInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function isInternalMove(tx) {
    var s = ((tx.merchant || '') + ' ' + (tx.method || '') + ' ' + (tx.category || '')).toLowerCase();
    if (/online\s+banking\s+transfer/.test(s)) return true;
    if (/transfer\s+(from|to)\s+acct/.test(s)) return true;
    if (/internal\s+xfer/.test(s) || /\bxfer\b/.test(s)) return true;
    if (/account\s+to\s+account/.test(s)) return true;
    if (/wire\s+(in|out)\s+from\s+(self|own)/.test(s)) return true;
    // v5: ANY Zelle transaction is a person-to-person transfer, not earned
    // income or true spending. Winston's call: drop them all from the math.
    if (/\bzelle\b/.test(s)) return true;
    // Bare ACH DEBIT/CREDIT: keep payroll, drop the rest
    if (/^ach\s+(debit|credit)\b/.test(s.trim())) {
      if (/payroll|salary|wages|paycheck|freshrealm|adp\s+totalsource|direct\s+deposit/.test(s)) return false;
      return true;
    }
    if (/\bbkofamerica\s+atm\b/.test(s) && /deposit/.test(s)) return true;
    if (/\batm\s+\d+.*deposit\b/.test(s)) return true;
    if (/^(stash|robinhood|coinbase|fidelity|vanguard|charles\s+schwab)\b/.test(s.trim())) return true;
    if (/\bbrokerage\s+transfer\b/.test(s) || /investment\s+deposit/.test(s)) return true;
    if (/payment\s+(to|received|posted)\s+(capital\s+one|chase|amex|discover|citi|wells\s+fargo|bank\s+of\s+america|bofa)/.test(s)) return true;
    if (/cc\s+payment\s+(to|from)/.test(s)) return true;
    var id = String(tx.id || '');
    if (/^rec-/i.test(id) || /^plaid_rec/i.test(id) || id.indexOf('-rec-') >= 0) return true;
    return false;
  }

  function autoCategory(tx) {
    var s = ((tx.merchant || '') + ' ' + (tx.category || '')).toLowerCase();
    var amt = Number(tx.amount) || 0;
    if (amt > 0 && /payroll|salary|wages|paycheck|payday|direct\s+dep|freshrealm|adp\s+totalsource/.test(s)) return 'Income';
    if (amt > 0 && /\bvenmo\b/.test(s) && /from/.test(s)) return 'Income';
    if (/\b(mortgage|landlord|rent\s+payment|woodhaven|leasing)\b/.test(s)) return 'Housing';
    if (/\b(electric|gas\s|power|water|sewer|internet|verizon|comcast|xfinity|t-mobile|at&t|phone\s+bill|spectrum|optimum)\b/.test(s)) return 'Utilities';
    if (/\b(insurance|policy|coverage|geico|progressive|state\s+farm|allstate|esurance|liberty\s+mutual|travelers|aaa)\b/.test(s)) return 'Insurance';
    if (/\b(netflix|spotify|hulu|disney|paramount|claude|chatgpt|anthropic|openai|adobe|microsoft\s*365|prime\s+video|youtube\s+premium|gym|peloton|apple\.com|icloud)\b/.test(s)) return 'Subscriptions';
    if (/\b(avant|affirm|klarna|sofi|capital\s+one|milestone|credit\s+one|brightway|westlake|aidadvantage|one\s+main|concora)\b/.test(s)) return 'Debt';
    if (/\b(restaurant|grubhub|doordash|ubereats|starbucks|mcdonalds|chipotle|shoprite|trader\s+joe|whole\s+foods|wegmans|walmart|target|kroger|aldi|costco|sams\s+club|food|pizza|deli|subway|wendys|burger\s+king|popeyes|chick-fil-a|panera|halal)\b/.test(s)) return 'Food & Groceries';
    if (/\b(uber|lyft|exxon|shell|bp\b|chevron|gulf|sunoco|7-eleven|wawa|gas\s+station|parking|toll|septa|nj\s+transit|metro|airline|delta\s+air|united\s+air|jetblue|amtrak)\b/.test(s)) return 'Transportation';
    if (/\b(pharmacy|cvs|walgreens|rite\s+aid|hospital|doctor|dental|optical|medical|urgent\s+care|kaiser|aetna)\b/.test(s)) return 'Health';
    if (/\b(amazon|ebay|etsy|nike|adidas|macys|nordstrom|best\s+buy)\b/.test(s)) return 'Shopping';
    if (/\b(atm|withdrawal|cash\s+advance)\b/.test(s)) return 'Cash';
    if (/\b(venmo|cashapp|cash\s+app)\b/.test(s) && amt < 0) return 'Money sent';
    if (/\busps\b|\bu\.?s\.?\s*post\s*office\b/.test(s)) return 'Shipping';
    if (tx.category && !/^(other|uncategorized|misc)$/i.test(tx.category) && tx.category.length > 0) return tx.category;
    return 'Other';
  }

  function buildClean(rawList) {
    if (!Array.isArray(rawList)) return rawList;
    var out = [];
    for (var i = 0; i < rawList.length; i++) {
      var t = rawList[i];
      if (!t) continue;
      if (isInternalMove(t)) continue;
      // Stamp category on a SHALLOW COPY so the original isn't mutated
      var existing = (t.category || '').toString();
      if (!existing || /^(other|uncategorized|misc)$/i.test(existing)) {
        var cp = {};
        for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) cp[k] = t[k];
        cp.category = autoCategory(t);
        out.push(cp);
      } else {
        out.push(t);
      }
    }
    return out;
  }

  // v4: app.js declares `let appState = null` at top level. That binding is
  // visible globally by name (other top-level scripts can read it) but it
  // is NOT on `window`. So we use the bare identifier here. The IIFE
  // wrapper sees the script-level lexical scope.
  function getAppState() {
    try { return appState; } catch (_) { return null; }
  }
  function wrapWithClean(fn) {
    return function () {
      var s = getAppState();
      var raw = s && s.transactions;
      if (!raw || !raw.length) return fn.apply(this, arguments);
      var clean = buildClean(raw);
      s.transactions = clean;
      // v6: app.js's materializeRecurringTransactions caches via
      // _lastMaterializeHash and short-circuits if unchanged. Our wrap
      // restores appState.transactions to `raw` at the end of each call —
      // which deletes the synthetic recurring entries materialize injected
      // into `clean`. The cache then returns early on the next call, so
      // subsequent timeframe clicks see clean WITHOUT recurring income,
      // making Income look stuck across Daily/Weekly/Monthly/etc.
      // Bust the cache so each wrapped call re-injects synthetic entries.
      try { _lastMaterializeHash = null; } catch (_) {}
      try {
        return fn.apply(this, arguments);
      } finally {
        s.transactions = raw;
      }
    };
  }

  // v3: returns true if a fresh wrap was applied this call (so the caller
  // can force a re-render and the user sees clean data immediately).
  function patchHostFunctions() {
    var wrappedSomething = false;
    if (window.drawCharts && !window.drawCharts.__wjpHygieneWrapped) {
      var orig = window.drawCharts;
      var wrapped = wrapWithClean(orig);
      wrapped.__wjpHygieneWrapped = true;
      window.drawCharts = wrapped;
      wrappedSomething = true;
    }
    if (window.renderTransactions && !window.renderTransactions.__wjpHygieneWrapped) {
      var orig2 = window.renderTransactions;
      var wrapped2 = wrapWithClean(orig2);
      wrapped2.__wjpHygieneWrapped = true;
      window.renderTransactions = wrapped2;
      wrappedSomething = true;
    }
    return wrappedSomething;
  }

  function forceRerender() {
    try { if (typeof window.drawCharts === 'function') window.drawCharts(); } catch (_) {}
    try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
  }

  function whenReady(fn) {
    function ready() {
      try { return typeof appState !== 'undefined' && appState && Array.isArray(appState.transactions); } catch (_) { return false; }
    }
    if (ready()) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (ready()) { clearInterval(iv); fn(); }
      else if (++tries > 60) clearInterval(iv);
    }, 400);
  }

  function boot() {
    whenReady(function () {
      var wrappedNow = patchHostFunctions();
      if (wrappedNow) forceRerender();
      // v3: every poll, both re-patch AND force a re-render whenever a fresh
      // wrap is installed (covers the race where drawCharts/renderTransactions
      // get defined after our boot ran). Also do an unconditional re-render
      // ~3s after boot to repaint the first-load stale state.
      setInterval(function () {
        var w = patchHostFunctions();
        if (w) forceRerender();
      }, 1500);
      setTimeout(forceRerender, 3000);
      setTimeout(forceRerender, 6000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

  window.WJP_TxnHygiene = {
    isInternalMove: isInternalMove,
    autoCategory: autoCategory,
    buildClean: buildClean,
    rerender: function () {
      try { if (typeof window.drawCharts === 'function') window.drawCharts(); } catch (_) {}
      try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
    }
  };
})();
