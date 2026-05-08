/* wjp-transfer-filter.js — hide internal bank transfers from spending tracker.
 *
 * BUG: rows like "TRANSFER FROM ACCT #0060 ON 05/07 VIA WEB" appear as
 * income/spend in the Recent Transactions list and inflate the Spending
 * Tracker. These are user moving money between their own accounts — they
 * should not show as income or spending.
 *
 * FIX: detect transfer rows by merchant text, mark them with a subtle
 * "Internal transfer" badge and grey them out. They stay visible but stop
 * dominating the list.
 */
(function () {
  'use strict';
  if (window._wjpTransferFilterInstalled) return;
  window._wjpTransferFilterInstalled = true;
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // Patterns that strongly indicate an internal transfer
  var TRANSFER_PATTERNS = [
    /\bTRANSFER\s+FROM\s+ACCT/i,
    /\bTRANSFER\s+TO\s+ACCT/i,
    /\bONLINE\s+TRANSFER/i,
    /\bACH\s+TRANSFER/i,
    /\bINTERNAL\s+TRANSFER/i,
    /\bMOBILE\s+TRANSFER/i,
    /\bWIRE\s+TRANSFER\b/i
  ];
  function isTransfer(text) {
    if (!text) return false;
    for (var i = 0; i < TRANSFER_PATTERNS.length; i++) {
      if (TRANSFER_PATTERNS[i].test(text)) return true;
    }
    return false;
  }

  function tag(node) {
    if (!node || node.dataset.wjpTransferTagged === '1') return;
    var text = (node.textContent || '').replace(/\s+/g, ' ');
    if (!isTransfer(text)) return;
    node.dataset.wjpTransferTagged = '1';
    node.style.opacity = '0.55';
    // Add a small badge if there's room
    var label = node.querySelector('[class*="title"], [class*="name"], [class*="desc"]') || node;
    if (label && !label.querySelector('.wjp-tx-internal-badge')) {
      var badge = document.createElement('span');
      badge.className = 'wjp-tx-internal-badge';
      badge.textContent = 'Internal transfer';
      badge.style.cssText = 'display:inline-block;font-size:9.5px;letter-spacing:0.06em;text-transform:uppercase;background:rgba(107,114,128,0.12);color:#6b7280;padding:2px 8px;border-radius:999px;font-weight:700;margin-left:8px;vertical-align:middle;';
      label.appendChild(badge);
    }
  }

  function tick() {
    try {
      // Recent Transactions rows on dashboard
      document.querySelectorAll('[class*="txn-row"], [class*="transaction-row"], .recent-tx-item, [data-tx-id]').forEach(tag);
      // Generic table rows
      document.querySelectorAll('tbody tr').forEach(tag);
    } catch (e) {
      try { console.warn('[wjp-transfer-filter] threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 700);
    setInterval(tick, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_TransferFilter = { refresh: tick, isTransfer: isTransfer };
})();
