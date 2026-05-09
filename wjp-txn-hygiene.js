/* wjp-txn-hygiene.js v2 — robust Spending Tracker hygiene.
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
    // Self-Zelle (sender or receiver name = account holder)
    if (/zelle.*winston\s+pappoe/.test(s)) return true;
    if (/winston\s+pappoe.*zelle/.test(s)) return true;
    // Generic Zelle "Recurring Transfer" / "Transfer" without a payee name —
    // these are usually scheduled internal transfers.
    if (/zelle\s+recurring\s+transfer/.test(s) && !/from\s+[A-Z]/i.test(tx.merchant || '')) return true;
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
    if (amt > 0 && /zelle\s+(payment|transfer)\s+from/.test(s)) return 'Income';
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
    if (/\b(zelle|venmo|cashapp|cash\s+app)\b/.test(s) && amt < 0) return 'Money sent';
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

  // Wrap a function so it sees a cleaned appState.transactions for its
  // duration. The original reference is restored synchronously after the
  // call returns (or throws).
  function wrapWithClean(fn) {
    return function () {
      var raw = window.appState && window.appState.transactions;
      if (!raw) return fn.apply(this, arguments);
      var clean = buildClean(raw);
      window.appState.transactions = clean;
      try {
        return fn.apply(this, arguments);
      } finally {
        window.appState.transactions = raw;
      }
    };
  }

  function patchHostFunctions() {
    if (window.drawCharts && !window.drawCharts.__wjpHygieneWrapped) {
      var orig = window.drawCharts;
      var wrapped = wrapWithClean(orig);
      wrapped.__wjpHygieneWrapped = true;
      window.drawCharts = wrapped;
    }
    if (window.renderTransactions && !window.renderTransactions.__wjpHygieneWrapped) {
      var orig2 = window.renderTransactions;
      var wrapped2 = wrapWithClean(orig2);
      wrapped2.__wjpHygieneWrapped = true;
      window.renderTransactions = wrapped2;
    }
  }

  function whenReady(fn) {
    if (window.appState) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (window.appState) { clearInterval(iv); fn(); }
      else if (++tries > 60) clearInterval(iv);
    }, 400);
  }

  function boot() {
    whenReady(function () {
      patchHostFunctions();
      // Trigger a re-render now that we're wrapped
      try { if (typeof window.drawCharts === 'function') window.drawCharts(); } catch (_) {}
      try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
      // Keep re-patching periodically — the host may reassign these later
      setInterval(patchHostFunctions, 2000);
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
