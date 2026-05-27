/* wjp-pagesize-relocate.js v1 — Move the SHOW 10/20/30/50/100 selector
 * to BELOW the transactions table + apply instantly on click.
 *
 * Winston FIX 48: "put that at the end of the table rather than the top
 * and also it only changes when you click next, can you click a save
 * button so it instantly changes."
 *
 * Behaviour:
 *   1. Find .wjp-pagesize-row (host's page-size buttons container).
 *   2. Move it to sit immediately after the #txn-table element (so it
 *      appears at the bottom of the transactions list).
 *   3. Listen for clicks on .ps-btn buttons. After each click, force an
 *      immediate re-render of the transactions table by calling the
 *      host's txnRenderAll() + WJP_CustomTxnRender() — no need to wait
 *      for the next Next/Previous click.
 *
 * Universal — works for any user. No state writes. Idempotent install.
 */
(function () {
  'use strict';
  if (window._wjpPagesizeRelocateInstalled) return;
  window._wjpPagesizeRelocateInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function findPageSizeRow() {
    return document.querySelector('.wjp-pagesize-row');
  }
  function findTable() {
    return document.getElementById('txn-table')
      || document.querySelector('#txn-tbody') && document.querySelector('#txn-tbody').closest('table');
  }
  function findPaginator() {
    // The host usually renders pagination controls (Previous / Next) after
    // the table. We want to land between the table and those.
    var prev = document.getElementById('btn-txn-prev');
    return prev ? prev.parentElement : null;
  }

  function relocate() {
    var row = findPageSizeRow();
    var table = findTable();
    if (!row || !table) return false;
    if (row.getAttribute('data-wjp-moved') === '1') return false;
    var paginator = findPaginator();
    // Insert AFTER the paginator if present (so order is: table → paginator → page-size),
    // else just after the table.
    var anchor = paginator || table;
    if (anchor.parentNode) {
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
      row.setAttribute('data-wjp-moved', '1');
      // Style tweak for bottom placement: a little top margin
      row.style.marginTop = '12px';
      row.style.justifyContent = 'flex-end';
      return true;
    }
    return false;
  }

  function rerenderTable() {
    // Try every known re-render path so the new size takes effect immediately.
    try { if (typeof window.txnRenderAll === 'function') window.txnRenderAll(); } catch (_) {}
    try { if (typeof window.WJP_CustomTxnRender === 'function') window.WJP_CustomTxnRender(); } catch (_) {}
    try { if (window.WJP_TxTabEnhance && typeof window.WJP_TxTabEnhance.render === 'function') window.WJP_TxTabEnhance.render(); } catch (_) {}
    try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('wjp-tx-rerendered', { detail: { reason: 'pagesize-changed' } }));
    } catch (_) {}
  }

  function wireInstantApply() {
    // Use event delegation so we catch clicks even if the host re-creates the buttons.
    if (document._wjpPagesizeClickWired) return;
    document._wjpPagesizeClickWired = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.ps-btn') : null;
      if (!btn) return;
      // Host writes localStorage 'wjp.tx.pageSize' synchronously on click,
      // so by the time we fire rerender it's the new value. Defer one tick
      // so any host onclick has a chance to run first.
      setTimeout(rerenderTable, 30);
    }, true);
  }

  function boot() {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (relocate() || attempts > 30) clearInterval(iv);
    }, 1000);
    wireInstantApply();
    // Re-attempt relocation after re-renders that may have re-injected the row in original spot
    window.addEventListener('wjp-tx-rerendered', function () { setTimeout(relocate, 200); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(relocate, 200); });
    // Periodic safety check (cheap because data-wjp-moved short-circuits)
    setInterval(relocate, 4000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PagesizeRelocate = { version: 1, relocate: relocate, rerender: rerenderTable };
})();
