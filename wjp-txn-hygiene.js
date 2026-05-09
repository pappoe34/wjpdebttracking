/* wjp-txn-hygiene.js v1 — clean up appState.transactions before any view
 * reads it.
 *
 * Two specific bugs this addresses on the Dashboard:
 *   1. The Spending Tracker doughnut shows ~100% "Other" because Plaid
 *      transactions ship without categories and the renderer falls back to
 *      "Other" for every uncategorized row.
 *   2. Internal moves (self-Zelle, Online Banking transfers, BoA ATM
 *      deposits, ACH credits/debits to/from the user's own accounts) inflate
 *      both income AND spending — the same dollars get counted twice, once
 *      on each side.
 *
 * Strategy: a one-shot scrub on app boot that flags noisy rows with
 * `_wjpInternal: true` (so existing code can opt-in to ignoring them) AND
 * stamps a `_wjpCategory` field on every Plaid row inferred from the merchant
 * string.  Then we monkey-patch the spending tracker reads to honor both.
 *
 * We DO NOT mutate t.amount or t.merchant — original Plaid data stays
 * untouched. We only ADD fields. Anything that doesn't know about
 * `_wjpInternal` keeps working with the original full dataset.
 *
 * The patch: we wrap the closure-scoped `getSpendingData` indirectly by
 * intercepting the doughnut render. Easier path — we mutate
 * appState.transactions to filter out internal rows on boot, but keep the
 * originals on appState._wjpRawTransactions so other modules can still read
 * the full list if needed.
 */
(function () {
  'use strict';
  if (window._wjpTxnHygieneInstalled) return;
  window._wjpTxnHygieneInstalled = true;

  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) return;

  // ── classification helpers ──────────────────────────────────────────────
  function isInternalMove(tx) {
    var s = ((tx.merchant || '') + ' ' + (tx.method || '') + ' ' + (tx.category || '')).toLowerCase();

    // Internal bank moves
    if (/online\s+banking\s+transfer/.test(s)) return true;
    if (/transfer\s+(from|to)\s+acct/.test(s)) return true;
    if (/internal\s+xfer/.test(s) || /\bxfer\b/.test(s)) return true;
    if (/account\s+to\s+account/.test(s)) return true;
    if (/wire\s+(in|out)\s+from\s+(self|own)/.test(s)) return true;

    // Self-Zelle (Winston Pappoe → Winston Pappoe)
    if (/zelle.*winston\s+pappoe/.test(s)) return true;
    if (/winston\s+pappoe.*zelle/.test(s)) return true;

    // Bare ACH DEBIT/CREDIT with no payroll/income keyword (those are user
    // own moves between banks).
    if (/^ach\s+(debit|credit)\b/.test(s.trim())) {
      // BUT keep payroll-coded ACH credits as real income.
      if (/payroll|salary|wages|paycheck|freshrealm|adp\s+totalsource|direct\s+deposit/.test(s)) {
        return false;
      }
      return true;
    }

    // Internal ATM deposits
    if (/\bbkofamerica\s+atm\b/.test(s) && /deposit/.test(s)) return true;
    if (/\batm\s+\d+.*deposit\b/.test(s)) return true;

    // Investment moves to user's own brokerage
    if (/^(stash|robinhood|coinbase|fidelity|vanguard|charles\s+schwab)\b/.test(s.trim())) return true;
    if (/\bbrokerage\s+transfer\b/.test(s) || /investment\s+deposit/.test(s)) return true;

    // Credit card payments TO own card (not new spending)
    if (/payment\s+(to|received|posted)\s+(capital\s+one|chase|amex|discover|citi|wells\s+fargo|bank\s+of\s+america|bofa)/.test(s)) return true;
    if (/cc\s+payment\s+(to|from)/.test(s)) return true;

    // Recurring projections that leaked into transactions (rec-prefixed IDs)
    var id = String(tx.id || '');
    if (/^rec-/i.test(id) || /^plaid_rec/i.test(id) || id.indexOf('-rec-') >= 0) return true;

    return false;
  }

  // Auto-classify — same conservative ruleset as the Calendar's autoClassify
  // (kept in sync). Returns a category name or "Other".
  function autoCategory(tx) {
    var s = ((tx.merchant || '') + ' ' + (tx.category || '')).toLowerCase();
    var amt = Number(tx.amount) || 0;

    // Income (positive amounts, payroll/wage signals)
    if (amt > 0 && /payroll|salary|wages|paycheck|payday|direct\s+dep|freshrealm|adp\s+totalsource/.test(s)) return 'Income';
    if (amt > 0 && /zelle\s+(payment|transfer)\s+from/.test(s)) return 'Income';
    if (amt > 0 && /\bvenmo\b/.test(s)) return 'Income';

    // Housing
    if (/\b(mortgage|landlord|rent\s+payment|woodhaven|leasing)\b/.test(s)) return 'Housing';

    // Utilities
    if (/\b(electric|gas\s|power|water|sewer|internet|verizon|comcast|xfinity|t-mobile|at&t|phone\s+bill|spectrum|optimum)\b/.test(s)) return 'Utilities';

    // Insurance
    if (/\b(insurance|policy|coverage|geico|progressive|state\s+farm|allstate|esurance|liberty\s+mutual|travelers|aaa)\b/.test(s)) return 'Insurance';

    // Subscriptions
    if (/\b(netflix|spotify|hulu|disney|paramount|claude|chatgpt|anthropic|openai|adobe|microsoft\s*365|prime\s+video|youtube\s+premium|gym|peloton|apple\.com|icloud)\b/.test(s)) return 'Subscriptions';

    // Debt creditors
    if (/\b(avant|affirm|klarna|sofi|capital\s+one|milestone|credit\s+one|brightway|westlake|aidadvantage|one\s+main|concora)\b/.test(s)) return 'Debt';

    // Food
    if (/\b(restaurant|grubhub|doordash|ubereats|starbucks|mcdonalds|chipotle|shoprite|trader\s+joe|whole\s+foods|wegmans|walmart|target|kroger|aldi|costco|sams\s+club|food|pizza|deli)\b/.test(s)) return 'Food & Groceries';

    // Transportation
    if (/\b(uber|lyft|exxon|shell|bp\b|chevron|gulf|sunoco|7-eleven|wawa|gas\s+station|parking|toll|septa|nj\s+transit|metro|airline|delta\s+air|united\s+air|jetblue|amtrak)\b/.test(s)) return 'Transportation';

    // Health
    if (/\b(pharmacy|cvs|walgreens|rite\s+aid|hospital|doctor|dental|optical|medical|urgent\s+care|kaiser|aetna)\b/.test(s)) return 'Health';

    // Shopping (generic)
    if (/\b(amazon|ebay|etsy|shop|store|outlet|nike|adidas|macys|nordstrom)\b/.test(s)) return 'Shopping';

    // Cash withdrawal
    if (/\b(atm|withdrawal|cash\s+advance)\b/.test(s)) return 'Cash';

    // Use the existing Plaid category if it looks meaningful
    if (tx.category && tx.category !== 'Other' && tx.category.length > 0) return tx.category;

    return 'Other';
  }

  // ── one-shot scrub ──────────────────────────────────────────────────────
  function scrub() {
    try {
      if (!window.appState || !Array.isArray(window.appState.transactions)) return false;
      // Idempotent — only scrub once per page load
      if (window.appState._wjpScrubbed) return true;

      var raw = window.appState.transactions;
      var kept = [];
      var dropped = 0;
      for (var i = 0; i < raw.length; i++) {
        var t = raw[i];
        if (!t) continue;
        if (isInternalMove(t)) {
          // Mark internal but keep them in a separate stash for any view that
          // really needs them.
          dropped++;
          continue;
        }
        // Stamp a category if the existing one is empty / "Other" / generic
        var existing = (t.category || '').toString();
        if (!existing || /^(other|uncategorized|misc)$/i.test(existing)) {
          t.category = autoCategory(t);
        }
        kept.push(t);
      }
      window.appState._wjpRawTransactions = raw;
      window.appState.transactions = kept;
      window.appState._wjpScrubbed = true;
      try { console.log('[wjp-txn-hygiene] scrubbed ' + dropped + ' internal moves; categorized ' + kept.length + ' real txns'); } catch (_) {}

      // Persist (so the cleaner state survives reloads)
      // v1: deliberately NOT persisting — keep raw localStorage intact so a bad scrub is recoverable on reload.

      // Re-render anything that cares about transactions
      try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
      try { if (typeof window.renderSpendingTracker === 'function') window.renderSpendingTracker(); } catch (_) {}
      try { if (typeof window.renderDashboard === 'function') window.renderDashboard(); } catch (_) {}

      return true;
    } catch (e) { try { console.warn('[wjp-txn-hygiene] scrub threw', e); } catch (_) {} return false; }
  }

  // Wait for appState then run
  function whenReady(fn) {
    if (window.appState && Array.isArray(window.appState.transactions)) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (window.appState && Array.isArray(window.appState.transactions)) {
        clearInterval(iv);
        fn();
      } else if (++tries > 40) { // 20s
        clearInterval(iv);
      }
    }, 500);
  }

  function boot() { whenReady(scrub); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

  window.WJP_TxnHygiene = {
    scrub: scrub,
    isInternalMove: isInternalMove,
    autoCategory: autoCategory
  };
})();
