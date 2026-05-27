/* wjp-pagesize-relocate.js v2 — move SHOW page-size selector to bottom + dedupe.
 *
 * Winston FIX 48: SHOW 10/20/30/50/100 selector should live BELOW the
 * table and clicking a size should re-render instantly.
 *
 * v2 fix (Winston 2026-05-26): v1 was creating DUPLICATES (4+ copies at
 * the bottom of the page) because the host re-inserts a fresh row each
 * render cycle, and my data-wjp-moved guard checked only the FIRST row
 * we moved — not the new row the host injected at the top. Result: each
 * tick moved another fresh copy, accumulating at the bottom.
 *
 * v2 strategy:
 *   1. Hide the host's original row via CSS (no fighting with host).
 *   2. Inject ONE copy at the bottom (after paginator). Re-render on
 *      every tick with idempotent updates instead of repeated moves.
 *   3. Click handler on injected copy: write 'wjp.tx.pageSize' to
 *      localStorage + force re-render of the transactions table.
 */
(function () {
  'use strict';
  if (window._wjpPagesizeRelocateInstalled) return;
  window._wjpPagesizeRelocateInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var INJECTED_ID = 'wjp-pagesize-bottom';
  var LS_KEY = 'wjp.tx.pageSize';
  var SIZES = [10, 20, 30, 50, 100];

  function injectStyle() {
    if (document.getElementById('wjp-pagesize-relocate-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-pagesize-relocate-style';
    st.textContent = [
      // Hide the host's TOP-of-table page-size row(s).
      '.txn-filters .wjp-pagesize-row{display:none !important;}',
      // Style the injected bottom version.
      '#' + INJECTED_ID + '{display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:12px 16px 18px 16px;font-size:11px;font-family:inherit;flex-wrap:wrap;}',
      '#' + INJECTED_ID + ' .lbl{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim, #6b7280);margin-right:4px;}',
      '#' + INJECTED_ID + ' button{padding:5px 12px;border-radius:6px;background:var(--bg-3, rgba(0,0,0,0.05));color:var(--ink, var(--text-1, #1f1a14));border:1px solid var(--border, rgba(0,0,0,0.10));font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;}',
      '#' + INJECTED_ID + ' button:hover{filter:brightness(0.97);}',
      '#' + INJECTED_ID + ' button.active{background:#1f7a4a;color:#fff;border-color:#1f7a4a;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function getCurrentSize() {
    try {
      var v = parseInt(localStorage.getItem(LS_KEY), 10);
      return SIZES.indexOf(v) !== -1 ? v : 30;
    } catch (_) { return 30; }
  }

  function setSize(n) {
    try { localStorage.setItem(LS_KEY, String(n)); } catch (_) {}
    // Force immediate re-render via every known path
    try { if (typeof window.txnRenderAll === 'function') window.txnRenderAll(); } catch (_) {}
    try { if (typeof window.WJP_CustomTxnRender === 'function') window.WJP_CustomTxnRender(); } catch (_) {}
    try { if (window.WJP_TxTabEnhance && typeof window.WJP_TxTabEnhance.render === 'function') window.WJP_TxTabEnhance.render(); } catch (_) {}
    try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-tx-rerendered', { detail: { reason: 'pagesize-changed', size: n } })); } catch (_) {}
  }

  function findAnchor() {
    // Anchor after the Previous/Next buttons (host pagination)
    var prev = document.getElementById('btn-txn-prev');
    if (prev && prev.parentElement) return prev.parentElement;
    // Else after the table
    var tbody = document.getElementById('txn-tbody');
    if (tbody) return tbody.closest('table');
    return null;
  }

  function ensureInjected() {
    var anchor = findAnchor();
    if (!anchor) return false;
    var existing = document.getElementById(INJECTED_ID);
    var cur = getCurrentSize();

    if (existing) {
      // Just refresh active state — no DOM moves needed
      Array.prototype.forEach.call(existing.querySelectorAll('button[data-size]'), function (btn) {
        var n = parseInt(btn.getAttribute('data-size'), 10);
        btn.classList.toggle('active', n === cur);
      });
      // If our element drifted away from the anchor, re-place it.
      if (existing.previousElementSibling !== anchor && existing.parentElement !== anchor.parentElement) {
        anchor.parentNode.insertBefore(existing, anchor.nextSibling);
      }
      return true;
    }

    var el = document.createElement('div');
    el.id = INJECTED_ID;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Items per page');
    el.innerHTML = '<span class="lbl">Show</span>' + SIZES.map(function (n) {
      return '<button type="button" data-size="' + n + '"' + (n === cur ? ' class="active"' : '') + '>' + n + '</button>';
    }).join('');
    el.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-size]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-size'), 10);
      if (!n || SIZES.indexOf(n) === -1) return;
      setSize(n);
      Array.prototype.forEach.call(el.querySelectorAll('button[data-size]'), function (b) {
        b.classList.toggle('active', parseInt(b.getAttribute('data-size'), 10) === n);
      });
    });
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
    return true;
  }

  function dedupeAccidentalCopies() {
    var rows = document.querySelectorAll('.wjp-pagesize-row');
    Array.prototype.forEach.call(rows, function (r) {
      if (r.closest('.txn-filters')) return;
      r.remove();
    });
  }

  function boot() {
    injectStyle();
    dedupeAccidentalCopies();
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (ensureInjected() && attempts > 1) return;
      if (attempts > 30) clearInterval(iv);
    }, 1000);
    window.addEventListener('wjp-tx-rerendered', function () { setTimeout(function () { dedupeAccidentalCopies(); ensureInjected(); }, 200); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(ensureInjected, 200); });
    setInterval(function () { dedupeAccidentalCopies(); ensureInjected(); }, 4000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PagesizeRelocate = {
    version: 2,
    ensureInjected: ensureInjected,
    dedupe: dedupeAccidentalCopies,
    setSize: setSize
  };
})();
