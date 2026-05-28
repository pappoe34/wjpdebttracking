/* wjp-txn-detail-modal.js v6 — fix observer recursion freeze (2026-05-19). Original v1: — Center + bigger transaction detail + inline category editing.
 *
 * Winston request 2026-05-18: the right-side drawer is cramped; move it to
 * center, make it bigger, and let users change category right from the
 * detail view (not buried behind Edit). Category change must sync everywhere
 * (Calendar grid, Transactions list, charts, recurring matching).
 *
 * Strategy:
 *   1. CSS injection re-positions #txn-detail-panel to centered modal + sets
 *      width to 90% / max 720px. Adds a visible backdrop overlay.
 *   2. MutationObserver watches for #txn-detail-content updates. When detail
 *      renders, we replace the static category badge with a <select>. On
 *      change, we update bare appState.transactions[i].category, call
 *      saveState() (triggers cloudPushDebounced), and re-render the open
 *      detail + table.
 *   3. Uses bare appState (per memory rule — modules must NOT use window.appState).
 *
 * Safe: IIFE, idempotent, path-guarded.
 */
(function () {
  'use strict';
  if (window._wjpTxnDetailModalInstalled) return;
  window._wjpTxnDetailModalInstalled = true;

  function getAppState() {
    try { return appState; } catch (_) { return null; }
  }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-txn-detail-modal-style';

  var CATEGORIES = [
    'Income','Debt Payment','Housing','Rent','Utilities','Groceries',
    'Food & Dining','Transportation','Auto','Insurance','Healthcare',
    'Entertainment','Subscriptions','Membership','Shopping','Personal Care',
    'Education','Travel','Gifts','Charity','Fees','Transfer','Other'
  ];

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      // Move the panel from right-side drawer to centered modal
      '#txn-detail-panel {',
      '  position: fixed !important;',
      '  top: 50% !important;',
      '  left: 50% !important;',
      '  right: auto !important;',
      '  transform: translate(-50%, -50%) !important;',
      '  width: 90vw !important;',
      '  max-width: 720px !important;',
      '  height: auto !important;',
      '  max-height: 88vh !important;',
      '  min-height: 200px;',
      '  border-radius: 18px !important;',
      '  border-left: 1px solid var(--border-accent) !important;',
      '  border: 1px solid var(--border-accent) !important;',
      '  box-shadow: 0 30px 80px rgba(0,0,0,0.45) !important;',
      '  overflow-y: auto !important;',
      '  transition: opacity 0.18s ease, transform 0.18s ease !important;',
      '}',
      // Hide the slide-in animation since we now use opacity
      '#txn-detail-panel[style*="right: -"] { display: none !important; }',
      '#txn-detail-panel:not(.wjp-detail-has-content) { display: none !important; }',
      '#txn-detail-panel.wjp-detail-empty { display: none !important; }',
      // Backdrop ONLY visible when modal has content. Without this guard,
      // the backdrop covers the page even when no transaction is open.
      '#txn-detail-backdrop {',
      '  position: fixed !important;',
      '  inset: 0 !important;',
      '  background: rgba(0,0,0,0.55) !important;',
      '  z-index: 9998 !important;',
      '  cursor: pointer;',
      '  display: none !important;',
      '}',
      'body.wjp-txn-detail-open #txn-detail-backdrop {',
      '  display: block !important;',
      '}',
      // Inline category select styling
      '.wjp-detail-cat-select {',
      '  background: var(--card-2, var(--bg-3, rgba(0,0,0,0.05))) !important;',
      '  border: 1px solid var(--border, rgba(0,0,0,0.15)) !important;',
      '  border-radius: 8px !important;',
      '  padding: 4px 28px 4px 12px !important;',
      '  font-size: 11px !important;',
      '  font-weight: 700 !important;',
      '  color: var(--ink, var(--text-1, #0a0a0a)) !important;',
      '  cursor: pointer !important;',
      '  font-family: inherit !important;',
      '  appearance: none;',
      '  -webkit-appearance: none;',
      "  background-image: url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231f7a4a' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg>\") !important;",
      '  background-repeat: no-repeat !important;',
      '  background-position: right 8px center !important;',
      '  background-size: 14px !important;',
      '}',
      '.wjp-detail-cat-select:hover { border-color: var(--accent, #1f7a4a) !important; }',
      // Mobile
      '@media (max-width: 600px) {',
      '  #txn-detail-panel {',
      '    width: 96vw !important;',
      '    max-height: 92vh !important;',
      '  }',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  // Force the panel to use the new style. The drawer's right:0 inline style
  // would clash with our left/transform — clear it and set inline opacity:1
  // so the panel is visible.
  function repositionPanel(panel) {
    if (!panel) return;
    try {
      var content = document.getElementById('txn-detail-content');
      var hasContent = content && content.children.length > 0 && content.textContent.trim().length > 0;
      if (!hasContent) {
        // Empty modal — hide entirely, don't reposition.
        panel.classList.add('wjp-detail-empty');
        panel.classList.remove('wjp-detail-has-content');
        panel.style.display = 'none';
        document.body.classList.remove('wjp-txn-detail-open');
        var bd0 = document.getElementById('txn-detail-backdrop');
        if (bd0) bd0.style.display = 'none';
        return;
      }
      panel.classList.add('wjp-detail-has-content');
      panel.classList.remove('wjp-detail-empty');
      panel.style.right = '';
      panel.style.display = '';
      panel.style.opacity = '1';
      panel.style.transform = 'translate(-50%, -50%)';
      document.body.classList.add('wjp-txn-detail-open');
      var bd = document.getElementById('txn-detail-backdrop');
      if (bd) bd.style.display = '';
    } catch (_) {}
  }

  function findTxById(id) {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return null;
    return s.transactions.find(function (t) { return t.id === id; }) || null;
  }

  function updateCategory(txId, newCatIdOrName) {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return false;
    var idx = s.transactions.findIndex(function (t) { return t.id === txId; });
    if (idx === -1) return false;

    // FIX 53 v5 (Winston 2026-05-28): modal dropdown was setting the legacy
    // `category` string field, NOT `userCategoryId`. The renderer + Smart
    // Summary + Spend by Bill + learn-from-history ALL read from
    // userCategoryId. Wrong field = silent no-op. Resolve to a real
    // category ID and persist on userCategoryId so it sticks + propagates.
    var catId = String(newCatIdOrName || '').trim();
    if (window.WJP_Categories) {
      // If we got an ID that exists, keep it. Else try to find a category
      // whose NAME matches (the legacy dropdown sends display labels).
      if (!window.WJP_Categories.get(catId)) {
        var list = window.WJP_Categories.list();
        var lc = catId.toLowerCase();
        var byName = list.find(function (c) { return c && c.name && c.name.toLowerCase() === lc; });
        if (byName) catId = byName.id;
        else {
          // Try a forgiving label match: "Food & Dining" -> "dining",
          // "Transportation" -> "transit", "Personal Care" -> "personal" etc.
          var fuzz = {
            'food & dining': 'dining', 'food and dining': 'dining',
            'transportation': 'transit',
            'personal care': 'personal',
            'auto': 'gas', 'gas': 'gas',
            'utilities': 'bills',
            'membership': 'subscriptions',
            'gifts': 'shopping', 'charity': 'shopping',
            'fees': 'other', 'education': 'other'
          };
          if (fuzz[lc] && window.WJP_Categories.get(fuzz[lc])) catId = fuzz[lc];
        }
      }
    }
    var t = s.transactions[idx];
    t.userCategoryId = catId;
    t.userEdited = true;
    t.categoryEditedAt = Date.now();
    // Keep legacy `category` field updated too for any code still reading it
    try {
      var resolved = window.WJP_Categories && window.WJP_Categories.get(catId);
      t.category = resolved ? resolved.name : catId;
    } catch (_) {}
    try {
      if (typeof window.saveState === 'function') window.saveState();
    } catch (_) {}
    try {
      if (typeof window.WJP_CustomTxnRender === 'function') window.WJP_CustomTxnRender();
      if (window.WJP_TxTabEnhance && typeof window.WJP_TxTabEnhance.render === 'function') window.WJP_TxTabEnhance.render();
      if (typeof window.renderTransactions === 'function') window.renderTransactions();
      if (typeof window.txnRenderAll === 'function') window.txnRenderAll();
      if (typeof window.renderCalendar === 'function') window.renderCalendar();
      if (typeof window.drawCharts === 'function') window.drawCharts();
      // FIX 53 v5: dispatch with BOTH categoryId + category so smart-categorize
      // listener (which prefers categoryId) records the learned mapping AND
      // bulk-applies to other same-merchant txns.
      window.dispatchEvent(new CustomEvent('wjp-tx-category-changed', { detail: { txId: txId, categoryId: catId, category: t.category } }));
    } catch (_) {}
    return true;
  }

  function injectCategorySelect(content, txId) {
    if (!content || content.querySelector('.wjp-detail-cat-select')) return;
    var tx = findTxById(txId);
    if (!tx) return;

    // FIX 53 v5: use the REAL dynamic category list with IDs as values so
    // selection propagates to t.userCategoryId (the field the renderer
    // actually reads). Fallback to legacy CATEGORIES if WJP_Categories
    // isn't loaded yet.
    var currentId = tx.userCategoryId || '';
    var list = (window.WJP_Categories && window.WJP_Categories.list)
      ? window.WJP_Categories.list() : null;
    var html;
    if (list && list.length) {
      // Sort by order/name for a stable list
      list = list.slice().sort(function (a, b) {
        if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
        return (a.name || '').localeCompare(b.name || '');
      });
      html = '<select class="wjp-detail-cat-select" data-txn-id="' + txId + '">' +
        list.map(function (c) {
          var sel = (c.id === currentId) ? ' selected' : '';
          return '<option value="' + c.id.replace(/"/g, '&quot;') + '"' + sel + '>' + c.name.replace(/</g,'&lt;') + '</option>';
        }).join('') +
        '</select>';
    } else {
      var current = tx.category || 'Other';
      var opts = CATEGORIES.slice();
      if (opts.indexOf(current) === -1) opts.unshift(current);
      html = '<select class="wjp-detail-cat-select" data-txn-id="' + txId + '">' +
        opts.map(function (c) {
          return '<option value="' + c.replace(/"/g, '&quot;') + '"' + (c.toLowerCase() === current.toLowerCase() ? ' selected' : '') + '>' + c + '</option>';
        }).join('') +
        '</select>';
    }
    var current = (list && list.length) ? currentId : (tx.category || 'Other');

    // v5: tolerant match + fallback append
    var badges = content.querySelectorAll('.badge, [data-cat-badge]');
    var injected = false;
    Array.prototype.forEach.call(badges, function (b) {
      if (injected) return;
      var t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.indexOf(current.toLowerCase()) !== -1) { b.outerHTML = html; injected = true; }
    });
    if (!injected) {
      var anchor = content.querySelector('.badge-row, .badges, [class*="badge"], [class*="meta"]') || content;
      if (anchor) anchor.insertAdjacentHTML('beforeend', html);
    }
    // Wire change handler
    var sel = content.querySelector('.wjp-detail-cat-select');
    if (sel) {
      sel.onchange = function () {
        var newCat = sel.value;
        if (newCat && newCat !== current) {
          var ok = updateCategory(txId, newCat);
          if (ok) {
            try {
              if (typeof window.showToast === 'function') window.showToast('Category updated to ' + newCat);
            } catch (_) {}
          }
        }
      };
    }
  }

  // Get current tx id from the detail panel's data attribute
  function getOpenTxId() {
    var btn = document.getElementById('txn-detail-edit-btn');
    if (btn) return btn.getAttribute('data-txn-id');
    // Fallback: scan for inline transaction id
    var panel = document.getElementById('txn-detail-panel');
    if (!panel) return null;
    var m = panel.textContent.match(/(plaid_|manual_|rec-)[a-z0-9_\-]+/i);
    return m ? m[0] : null;
  }

  function enhanceContent() {
    var panel = document.getElementById('txn-detail-panel');
    if (!panel) return;
    repositionPanel(panel);
    var content = document.getElementById('txn-detail-content');
    if (!content) return;
    var txId = getOpenTxId();
    if (!txId) return;
    injectCategorySelect(content, txId);
  }

  // v4 fix 2026-05-19: Dropped the body-subtree MutationObserver — it was
  // firing on every DOM mutation in the entire app (chart redraws, tooltips,
  // toast inserts, modal opens) and saturating the main thread. We now use
  // ONLY a slow 5-second interval. The user perceives no delay because the
  // detail modal is event-driven by clicks on tx rows, and after the click
  // the interval picks up the panel within at most 5s. Also added a reentry
  // guard in enhanceContent to short-circuit overlapping calls.
  var _enhanceRunning = false;
  function _safeEnhance() {
    if (_enhanceRunning) return;
    _enhanceRunning = true;
    try { enhanceContent(); } catch (e) {}
    _enhanceRunning = false;
  }

  function startWatcher() {
    // No body observer — would saturate the main thread.
    // Hook into the actual click-to-open paths instead (light listeners, no DOM queries on idle).
    try {
      document.addEventListener('click', function (e) {
        // Tx rows live in many places; check whether the click traverses into
        // a panel-opening element. If so, run enhance after a microtask so
        // the panel content has rendered.
        var t = e.target;
        if (!t) return;
        var openTrigger = t.closest && t.closest('[data-txn-id], .txn-row, .tx-row, .transaction-row, [data-tx-open]');
        if (openTrigger) {
          setTimeout(_safeEnhance, 50);
          setTimeout(_safeEnhance, 250);
        }
      }, true);
    } catch (_) {}
    // Slow polling fallback in case the click handler missed something.
    setInterval(_safeEnhance, 5000);
  }

  function boot() {
    injectStyle();
    startWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TxnDetailModal = {
    enhance: enhanceContent,
    updateCategory: updateCategory,
    version: 4
  };
})();
