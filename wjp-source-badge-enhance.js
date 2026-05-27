/* wjp-source-badge-enhance.js v2 — expose window.WJP_AcctLookup — Rich source pills on the Transactions tab.
 *
 * Today's source badge shows only one letter ("S", "R", "C") which collides:
 *   "S" could be SoFi (Plaid) OR System-synthetic
 *   "C" could be Chase OR Citi (different banks, same initial)
 *
 * This module:
 *   1. Pre-fetches the user's linked accounts via /plaid-health on boot,
 *      builds a lookup { accountId → { institutionName, mask, name } }.
 *   2. Overrides window.getTxnSourceMeta + window.renderTxnSourceBadge to
 *      return the FULL institution name (truncated to 10 chars) + last-4
 *      account mask for Plaid txs.
 *   3. Recurring rows show "Recurring · <name>" instead of bare "R".
 *   4. System rows show "Auto" instead of "S".
 *   5. Manual rows show "Manual" instead of "M".
 *
 * Re-renders the transactions table after lookup loads so users see real
 * names without refreshing.
 *
 * Safe: IIFE, idempotent, path-guarded.
 */
(function () {
  'use strict';
  if (window._wjpSourceBadgeEnhanceInstalled) return;
  window._wjpSourceBadgeEnhanceInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // accountId → { institutionName, mask, name, subtype }
  var accountLookup = {};
  var lookupLoaded = false;

  async function getIdToken() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return await u.getIdToken();
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) return await window.__wjpAuth.currentUser.getIdToken();
    } catch (_) {}
    return null;
  }

  async function loadAccountLookup() {
    try {
      var token = await getIdToken();
      if (!token) return;
      var r = await fetch('/.netlify/functions/plaid-health', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!r.ok) return;
      var data = await r.json();
      (data.items || []).forEach(function (item) {
        var inst = item.institutionName || 'Bank';
        (item.accounts || []).forEach(function (acct) {
          if (!acct || !acct.account_id) return;
          accountLookup[acct.account_id] = {
            institutionName: inst,
            mask: acct.mask || '',
            name: acct.name || acct.official_name || '',
            subtype: acct.subtype || acct.type || ''
          };
        });
      });
      lookupLoaded = true;
      try { console.log('[wjp-src-badge] loaded', Object.keys(accountLookup).length, 'accounts'); } catch (_) {}
      // v2: expose for other modules (e.g. Smart Summary bank pills)
      try {
        window.WJP_AcctLookup = accountLookup;
        window.dispatchEvent(new CustomEvent('wjp-acct-lookup-ready', { detail: { count: Object.keys(accountLookup).length } }));
      } catch (_) {}
      // Re-render so the new lookup is reflected
      try {
        if (typeof window.renderTransactions === 'function') window.renderTransactions();
        if (typeof window.txnRenderAll === 'function') window.txnRenderAll();
      } catch (_) {}
    } catch (e) {
      try { console.warn('[wjp-src-badge] lookup failed', e); } catch (_) {}
    }
  }

  // Shorten an institution name for badge display. "Bank of America" → "BoA",
  // "Principal Financial Group - Participant Logon" → "Principal", "SoFi" → "SoFi".
  function shortInstName(name) {
    if (!name) return 'Bank';
    var n = String(name);
    var lower = n.toLowerCase();
    if (lower.indexOf('bank of america') !== -1) return 'BoA';
    if (lower.indexOf('principal') !== -1) return 'Principal';
    if (lower.indexOf('jpmorgan') !== -1) return 'Chase';
    if (lower.indexOf('citibank') !== -1) return 'Citi';
    if (lower.indexOf('citi') !== -1) return 'Citi';
    if (lower.indexOf('wells fargo') !== -1) return 'Wells';
    if (lower.indexOf('capital one') !== -1) return 'Cap One';
    if (lower.indexOf('american express') !== -1) return 'Amex';
    if (lower.indexOf('discover') !== -1) return 'Discover';
    if (lower.indexOf('vanguard') !== -1) return 'Vanguard';
    if (lower.indexOf('sofi') !== -1) return 'SoFi';
    if (lower.indexOf('mercury') !== -1) return 'Mercury';
    if (lower.indexOf('credit one') !== -1) return 'CreditOne';
    if (lower.indexOf('synchrony') !== -1) return 'Synchrony';
    if (lower.indexOf('barclays') !== -1) return 'Barclays';
    if (lower.indexOf('u.s. bank') !== -1) return 'US Bank';
    if (lower.indexOf('us bank') !== -1) return 'US Bank';
    if (lower.indexOf('huntington') !== -1) return 'Huntington';
    if (lower.indexOf('pnc') !== -1) return 'PNC';
    // Generic — take first word, max 10 chars
    var firstWord = n.split(/[\s\-_]/)[0];
    return firstWord.length > 10 ? firstWord.slice(0, 10) : firstWord;
  }

  // Save the originals so we can fall back
  var origGetMeta = window.getTxnSourceMeta;
  var origRenderBadge = window.renderTxnSourceBadge;

  function richSourceMeta(t) {
    if (!t) return origGetMeta ? origGetMeta(t) : null;
    // Plaid txs — show full institution + mask
    if (t.source === 'plaid' || t.plaidTransactionId) {
      // v3 (2026-05-26): prefer WJP_AcctLookup (which wjp-acct-name-sync
      // augments with userDisplayName/userRenamed) over local accountLookup
      // so user renames flow through to row SOURCE pills, not just filter chips.
      var sharedLookup = window.WJP_AcctLookup && window.WJP_AcctLookup[t.plaidAccountId];
      var lookup = sharedLookup || accountLookup[t.plaidAccountId];
      var instRaw = (lookup && lookup.institutionName) || t.institutionName || 'Bank';
      var mask = (lookup && lookup.mask) || '';
      // If the user renamed this account, use their name verbatim (capped at
      // 24) instead of running through shortInstName which aggressively
      // abbreviates ("Bank of America" → "BoA").
      var instShort;
      if (lookup && lookup.userRenamed && lookup.userDisplayName) {
        var nm = String(lookup.userDisplayName);
        instShort = nm.length > 24 ? nm.slice(0, 24) + '…' : nm;
      } else {
        instShort = shortInstName(instRaw);
      }
      var displayLabel = mask ? (instShort + ' ··' + mask) : instShort;
      var tooltipName = (lookup && lookup.userRenamed && lookup.userDisplayName) ? lookup.userDisplayName : instRaw;
      var tooltip = 'From ' + tooltipName + (lookup && lookup.name ? ' (' + lookup.name + (mask ? ' ····' + mask : '') + ')' : '');
      return {
        kind: 'plaid',
        label: tooltipName,
        shortLabel: displayLabel,
        icon: 'ph-bank',
        color: '#1f7a4a',
        bg: 'rgba(31,122,74,0.10)',
        border: 'rgba(31,122,74,0.30)',
        tooltip: tooltip,
        locked: true
      };
    }
    // Recurring synthetic
    if (t.synthetic && t.parentRecurringId) {
      return {
        kind: 'recurring',
        label: 'Recurring',
        shortLabel: 'Recurring',
        icon: 'ph-arrows-clockwise',
        color: '#a855f7',
        bg: 'rgba(168,85,247,0.10)',
        border: 'rgba(168,85,247,0.30)',
        tooltip: 'Auto-generated from a recurring schedule.',
        locked: true
      };
    }
    // System synthetic
    if (t.synthetic) {
      return {
        kind: 'system',
        label: 'Auto',
        shortLabel: 'Auto',
        icon: 'ph-cpu',
        color: '#94a3b8',
        bg: 'rgba(148,163,184,0.10)',
        border: 'rgba(148,163,184,0.30)',
        tooltip: 'Auto-generated by WJP.',
        locked: true
      };
    }
    // Manual
    return {
      kind: 'manual',
      label: 'Manual',
      shortLabel: 'Manual',
      icon: 'ph-pencil-simple',
      color: '#fbbf24',
      bg: 'rgba(251,191,36,0.10)',
      border: 'rgba(251,191,36,0.30)',
      tooltip: t.enteredAt ? 'Manually entered ' + new Date(t.enteredAt).toLocaleString('en-US', { month: 'short', day: 'numeric' }) : 'Manually entered',
      locked: false
    };
  }

  function richRenderBadge(t) {
    var m = richSourceMeta(t);
    if (!m) return '';
    return '<div class="txn-src-badge" data-src-kind="' + m.kind + '" title="' + m.tooltip + '" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:' + m.bg + ';border:1px solid ' + m.border + ';border-radius:6px;font-size:10px;font-weight:700;color:' + m.color + ';white-space:nowrap;cursor:help;max-width:140px;overflow:hidden;text-overflow:ellipsis;">' +
      '<i class="ph-fill ' + m.icon + '" style="font-size:11px;flex-shrink:0;"></i>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;">' + m.shortLabel + '</span>' +
    '</div>';
  }

  function installOverrides() {
    window.getTxnSourceMeta = richSourceMeta;
    window.renderTxnSourceBadge = richRenderBadge;
  }

  function boot() {
    installOverrides();
    // Try to load account lookup; retry every 4s until we have data
    var attempts = 0;
    function tryLoad() {
      attempts++;
      if (lookupLoaded) return;
      loadAccountLookup().then(function () {
        if (!lookupLoaded && attempts < 8) setTimeout(tryLoad, 4000);
      });
    }
    setTimeout(tryLoad, 2500);
    // Re-install overrides every 5s in case app.js re-defines them
    setInterval(installOverrides, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_SourceBadge = {
    refresh: loadAccountLookup,
    shortInstName: shortInstName,
    accountLookup: function () { return accountLookup; },
    version: 1
  };
})();
