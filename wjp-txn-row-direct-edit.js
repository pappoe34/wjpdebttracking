/* wjp-txn-row-direct-edit.js v1 — Row click opens Edit modal directly.
 *
 * Per UX feedback: the read-only detail panel had an inline category dropdown
 * that didn't always refresh the list — only the Edit modal worked reliably.
 * Cleaner UX: clicking a row goes straight to Edit + Delete modal. Single
 * save path, single source of truth, no redundant detail panel.
 *
 * Behaviour:
 *   • Click on a transaction row (.txn-row [data-txn-id]) → opens the
 *     existing Edit modal (window.txnOpenEditModal) for that transaction.
 *   • Click on the edit pencil button → unchanged (also opens Edit modal).
 *   • Click on the delete button → unchanged.
 *   • Detail panel that used to open is suppressed.
 *
 * Universal: works for any user on any txn-row across the app. Doesn't
 * require WJP_Assets or any user-specific data. Idempotent install guard.
 */
(function () {
  'use strict';
  if (window._wjpTxnRowDirectEditInstalled) return;
  window._wjpTxnRowDirectEditInstalled = true;

  function findTxnId(target) {
    if (!target) return null;
    var row = target.closest && target.closest('[data-txn-id]');
    return row ? row.getAttribute('data-txn-id') : null;
  }

  function findTransaction(txnId) {
    try {
      if (typeof appState === 'undefined' || !appState || !Array.isArray(appState.transactions)) return null;
      return appState.transactions.find(function (t) { return t && t.id === txnId; }) || null;
    } catch (_) { return null; }
  }

  function openEditModalFor(txnId) {
    if (!txnId) return false;
    var t = findTransaction(txnId);
    if (!t) return false;
    if (typeof window.txnOpenEditModal === 'function') {
      try { window.txnOpenEditModal(t); return true; } catch (_) {}
    }
    // Fallback: click the in-row Edit pencil button programmatically.
    var btn = document.querySelector('.btn-txn-edit[data-txn-id="' + CSS.escape(txnId) + '"]');
    if (btn) { try { btn.click(); return true; } catch (_) {} }
    return false;
  }

  function suppressDetailPanel() {
    try {
      var panel = document.getElementById('txn-detail-panel');
      if (!panel) return;
      // Force-close any detail panel that may have been opened
      panel.classList.remove('wjp-detail-has-content');
      panel.classList.add('wjp-detail-empty');
      panel.style.display = 'none';
      var bd = document.getElementById('txn-detail-backdrop');
      if (bd) bd.style.display = 'none';
      document.body.classList.remove('wjp-txn-detail-open');
    } catch (_) {}
  }

  // Capture-phase click handler — runs BEFORE other listeners so we can
  // intercept and reroute the click before the detail-panel opener fires.
  document.addEventListener('click', function (e) {
    if (!e.target) return;
    // Ignore clicks on existing edit/delete buttons — they handle themselves.
    var t = e.target;
    if (t.closest && (t.closest('.btn-txn-edit') || t.closest('.btn-txn-del'))) return;
    // Also ignore clicks inside an already-open Edit modal so its own
    // buttons still work.
    if (t.closest && t.closest('#txn-edit-modal, .txn-edit-modal, [class*="edit-modal"]')) return;

    var txnId = findTxnId(t);
    if (!txnId) return;
    // Don't intercept clicks on inputs/selects/buttons that the row contains
    // (so dropdowns and inputs still receive focus normally if present).
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'A' || t.tagName === 'BUTTON') return;

    var opened = openEditModalFor(txnId);
    if (opened) {
      // Suppress the detail panel that the host may try to open on the same click.
      setTimeout(suppressDetailPanel, 50);
      setTimeout(suppressDetailPanel, 200);
      setTimeout(suppressDetailPanel, 500);
    }
  }, true); // capture phase

  // Also continuously suppress the detail panel if it's still rendering
  // from a previous build cache state.
  var idleSuppressCount = 0;
  var idleIv = setInterval(function () {
    idleSuppressCount++;
    var panel = document.getElementById('txn-detail-panel');
    if (panel && panel.classList.contains('wjp-detail-has-content')) {
      // Only suppress if the Edit modal is also open (we just routed to it)
      var editOpen = document.querySelector('#txn-edit-modal:not([style*="display: none"]), .txn-edit-modal[style*="display: block"], [class*="edit-modal"][style*="display: block"]');
      if (editOpen) suppressDetailPanel();
    }
    if (idleSuppressCount > 600) clearInterval(idleIv); // ~10min cap
  }, 1000);

  // Public API for debugging
  window.WJP_TxnRowDirectEdit = {
    version: 1,
    openEditModalFor: openEditModalFor,
    suppressDetailPanel: suppressDetailPanel
  };
})();
