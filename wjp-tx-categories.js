/* wjp-tx-categories.js v1 — Custom categories + bulk-apply on category change.
 *
 * Two features:
 *
 *   1) ADD CUSTOM CATEGORY — every category <select> gets a sentinel option
 *      "➕ Add new category…" at the bottom. Picking it opens a small modal
 *      with a text input. The new category is persisted to
 *      appState.prefs.customCategories and merged into every dropdown.
 *
 *   2) BULK APPLY ON CATEGORY CHANGE — when a transaction's category is
 *      changed (either via inline dropdown in the detail panel OR via the
 *      Edit modal's Save), and there are other transactions with the same
 *      canonicalised merchant, prompt: "Apply 'X' to all N transactions
 *      from <merchant>?" Yes → bulk update + save + re-render.
 *
 * Safe: IIFE + install guard. Idempotent — repeated injection of options is
 * no-op. Custom categories persist via saveState() and survive reload.
 */
(function () {
  'use strict';
  if (window._wjpTxCategoriesInstalled) return;
  window._wjpTxCategoriesInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }
  function toast(msg) { try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (_) {} }
  function rerender() {
    try { if (typeof window.renderTransactions === 'function') window.renderTransactions(); } catch (_) {}
    try { if (typeof window.txnRenderAll === 'function') window.txnRenderAll(); } catch (_) {}
    try { if (typeof window.renderCalendar === 'function') window.renderCalendar(); } catch (_) {}
    try { if (typeof window.drawCharts === 'function') window.drawCharts(); } catch (_) {}
  }

  function getCustomCats() {
    var s = getAppState();
    if (!s) return [];
    if (!s.prefs) s.prefs = {};
    if (!Array.isArray(s.prefs.customCategories)) s.prefs.customCategories = [];
    return s.prefs.customCategories;
  }
  function addCustomCat(name) {
    name = String(name || '').trim();
    if (!name) return false;
    var s = getAppState();
    if (!s) return false;
    var arr = getCustomCats();
    // Case-insensitive duplicate check
    var lower = name.toLowerCase();
    if (arr.some(function (c) { return c.toLowerCase() === lower; })) return true;
    arr.push(name);
    saveState();
    // Tell any other modules to refresh dropdowns
    try { window.dispatchEvent(new CustomEvent('wjp-custom-cat-added', { detail: { name: name } })); } catch (_) {}
    return true;
  }

  // ----- Inject the "Add new category" option + custom cats into every <select> -----
  var SENTINEL = '__wjp_add_new__';
  function enhanceSelect(sel) {
    if (!sel) return;
    if (sel._wjpCatEnhanced && sel._wjpCustomLen === getCustomCats().length) return;
    sel._wjpCustomLen = getCustomCats().length;

    var current = sel.value;
    // Already has sentinel? remove and re-add at end after custom cats
    Array.prototype.forEach.call(sel.querySelectorAll('option'), function (o) {
      if (o.value === SENTINEL || o.dataset.wjpCustom === '1') o.remove();
    });
    // Append custom categories at the end (before sentinel)
    var existingValues = {};
    Array.prototype.forEach.call(sel.options, function (o) {
      existingValues[(o.value || '').toLowerCase()] = true;
    });
    getCustomCats().forEach(function (c) {
      if (existingValues[c.toLowerCase()]) return;
      var o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      o.dataset.wjpCustom = '1';
      sel.appendChild(o);
    });
    // Append sentinel "Add new" option
    var sentinel = document.createElement('option');
    sentinel.value = SENTINEL;
    sentinel.textContent = '➕  Add new category…';
    sentinel.dataset.wjpSentinel = '1';
    sentinel.style.fontStyle = 'italic';
    sel.appendChild(sentinel);

    // Restore selected value (current may have been a custom cat)
    if (current && current !== SENTINEL) {
      sel.value = current;
    }
    sel._wjpCatEnhanced = true;

    // Hook change handler — fire-once wrapper around any existing onchange
    if (!sel._wjpChangeWrapped) {
      sel._wjpChangeWrapped = true;
      sel.addEventListener('change', function (e) {
        if (sel.value !== SENTINEL) return;
        e.stopPropagation();
        e.preventDefault();
        openAddCatModal(function (newCat) {
          if (newCat) {
            sel.value = newCat;
            // Manually fire change to the original handler
            try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
          } else {
            // Restore previous value
            sel.value = current;
          }
        });
      }, true);
    }
  }

  function enhanceAllSelects() {
    var sels = document.querySelectorAll('.wjp-detail-cat-select, #txn-edit-category, [data-wjp-cat-select]');
    sels.forEach(enhanceSelect);
  }

  // ----- Add Category modal -----
  function openAddCatModal(cb) {
    var existing = document.getElementById('wjp-add-cat-modal');
    if (existing) existing.remove();
    var m = document.createElement('div');
    m.id = 'wjp-add-cat-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif;';
    m.innerHTML =
      '<div style="background:var(--card,#fff);color:var(--ink,#0a0a0a);max-width:380px;width:100%;border-radius:14px;border:1px solid var(--border,rgba(0,0,0,0.10));box-shadow:0 30px 80px rgba(0,0,0,0.40);padding:22px;">' +
        '<div style="font-size:15px;font-weight:800;margin-bottom:6px;">Add a custom category</div>' +
        '<div style="font-size:11.5px;color:var(--ink-dim,#6b7280);margin-bottom:14px;">This category will be available everywhere — Calendar, Budgets, Spending, etc.</div>' +
        '<input id="wjp-newcat-input" type="text" autocomplete="off" placeholder="e.g. Coffee, Kids, Side hustle" maxlength="40" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border,rgba(0,0,0,0.15));background:var(--bg-2,#fff);color:var(--ink,#0a0a0a);font-size:13px;box-sizing:border-box;font-family:inherit;" />' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
          '<button id="wjp-newcat-cancel" type="button" style="padding:8px 16px;border-radius:8px;background:var(--bg-3,rgba(0,0,0,0.05));border:1px solid var(--border,rgba(0,0,0,0.10));color:var(--ink,#0a0a0a);font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;">Cancel</button>' +
          '<button id="wjp-newcat-save" type="button" style="padding:8px 18px;border-radius:8px;background:#1f7a4a;border:1px solid #1f7a4a;color:#fff;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;">Add</button>' +
        '</div>' +
      '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) { m.remove(); cb && cb(null); } });
    document.body.appendChild(m);
    var input = document.getElementById('wjp-newcat-input');
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 30);
    function doSave() {
      var v = (input.value || '').trim();
      if (!v) { input.focus(); return; }
      if (addCustomCat(v)) {
        toast('Added category "' + v + '"');
        enhanceAllSelects();
        m.remove();
        cb && cb(v);
      }
    }
    document.getElementById('wjp-newcat-save').onclick = doSave;
    document.getElementById('wjp-newcat-cancel').onclick = function () { m.remove(); cb && cb(null); };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSave();
      if (e.key === 'Escape') { m.remove(); cb && cb(null); }
    });
  }

  // ----- Bulk apply category to all matching merchant -----
  function canonicalize(m) {
    return String(m || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function countMatching(merchant, exceptId) {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return 0;
    var key = canonicalize(merchant);
    return s.transactions.filter(function (x) {
      return x.id !== exceptId && canonicalize(x.merchant) === key;
    }).length;
  }
  function applyToAll(merchant, exceptId, newCat) {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return 0;
    var key = canonicalize(merchant);
    var n = 0;
    s.transactions.forEach(function (x) {
      if (x.id === exceptId) return;
      if (canonicalize(x.merchant) !== key) return;
      if (x.category === newCat) return;
      x.category = newCat;
      x.userEdited = true;
      x.categoryEditedAt = Date.now();
      n++;
    });
    if (n > 0) {
      saveState();
      rerender();
    }
    return n;
  }
  function showBulkApplyPrompt(txn, newCat) {
    if (!txn || !txn.merchant) return;
    var n = countMatching(txn.merchant, txn.id);
    if (n === 0) return; // nothing to ask
    var existing = document.getElementById('wjp-bulkcat-modal');
    if (existing) existing.remove();
    var m = document.createElement('div');
    m.id = 'wjp-bulkcat-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif;';
    m.innerHTML =
      '<div style="background:var(--card,#fff);color:var(--ink,#0a0a0a);max-width:420px;width:100%;border-radius:14px;border:1px solid var(--border,rgba(0,0,0,0.10));box-shadow:0 30px 80px rgba(0,0,0,0.40);padding:22px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
          '<div style="width:36px;height:36px;border-radius:50%;background:rgba(31,122,74,0.13);display:flex;align-items:center;justify-content:center;font-size:18px;">🏷️</div>' +
          '<div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;">Apply to all matching transactions?</div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--ink-dim,#6b7280);margin-bottom:14px;line-height:1.5;">There ' + (n === 1 ? 'is 1 other transaction' : 'are ' + n + ' other transactions') + ' from <b>' + escapeHtml(txn.merchant) + '</b>. Set them all to <b>' + escapeHtml(newCat) + '</b>?</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button id="wjp-bc-just-this" type="button" style="padding:8px 14px;border-radius:8px;background:var(--bg-3,rgba(0,0,0,0.05));border:1px solid var(--border,rgba(0,0,0,0.10));color:var(--ink,#0a0a0a);font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;">Just this one</button>' +
          '<button id="wjp-bc-apply-all" type="button" style="padding:8px 18px;border-radius:8px;background:#1f7a4a;border:1px solid #1f7a4a;color:#fff;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;">Apply to all ' + n + '</button>' +
        '</div>' +
      '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    document.getElementById('wjp-bc-just-this').onclick = function () { m.remove(); };
    document.getElementById('wjp-bc-apply-all').onclick = function () {
      var k = applyToAll(txn.merchant, txn.id, newCat);
      toast('Updated ' + k + ' other transaction' + (k === 1 ? '' : 's') + '.');
      m.remove();
    };
    var k = function (e) {
      if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', k); }
    };
    document.addEventListener('keydown', k);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ----- Listen for category changes -----
  // (a) The detail panel inline select fires window.dispatchEvent('wjp-tx-category-changed')
  window.addEventListener('wjp-tx-category-changed', function (e) {
    try {
      var d = e.detail || {};
      var s = getAppState();
      var t = s && s.transactions && s.transactions.find(function (x) { return x.id === d.txId; });
      if (t && d.category) showBulkApplyPrompt(t, d.category);
    } catch (_) {}
  });

  // (b) The Edit modal's Save button — wrap it after the modal mounts.
  function watchEditModalSave() {
    var modal = document.getElementById('txn-edit-modal');
    if (!modal || modal._wjpSaveWrapped) return;
    modal._wjpSaveWrapped = true;
    var saveBtn = modal.querySelector('#txn-edit-save');
    if (!saveBtn) { modal._wjpSaveWrapped = false; return; }
    var origOnclick = saveBtn.onclick;
    saveBtn.addEventListener('click', function () {
      // After the original save fires, snapshot which txn was edited + category
      var catSel = modal.querySelector('#txn-edit-category');
      var newCat = catSel && catSel.value;
      var merchantInput = modal.querySelector('#txn-edit-merchant');
      var merchant = merchantInput && merchantInput.value;
      // Find the txn id from the modal — saved at open time on the Delete button
      var delBtn = modal.querySelector('#txn-edit-delete');
      var txnId = delBtn && (delBtn.getAttribute('data-txn-id') || delBtn.dataset.txnId);
      // If not on Delete, try the modal-level data attr
      if (!txnId) txnId = modal.getAttribute('data-txn-id');
      // Wait one frame so the original save has updated appState
      setTimeout(function () {
        var s = getAppState();
        var t = s && s.transactions && s.transactions.find(function (x) {
          return (txnId && x.id === txnId) || (x.merchant === merchant && x.category === newCat);
        });
        if (t && newCat) showBulkApplyPrompt(t, newCat);
      }, 250);
    }, false);
  }

  // ----- Periodically enhance dropdowns when present -----
  function tick() {
    enhanceAllSelects();
    watchEditModalSave();
  }
  setInterval(tick, 1500);
  setTimeout(tick, 500);
  // React to host-driven re-renders
  window.addEventListener('wjp-tx-category-changed', function () { setTimeout(tick, 100); });
  window.addEventListener('wjp-custom-cat-added', function () { setTimeout(tick, 100); });

  // Public API
  window.WJP_TxCategories = {
    addCustomCat: addCustomCat,
    getCustomCats: getCustomCats,
    openAddModal: openAddCatModal,
    bulkApply: applyToAll,
    version: 1
  };
})();
