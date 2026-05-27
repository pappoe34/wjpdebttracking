/* wjp-tx-category-picker.js v1 — Per-row category picker on Transactions
 * table + Manage categories modal.
 *
 * Winston: FIX 29 — categorization UI built on top of the already-shipped
 * data layer in wjp-categories.js (window.WJP_Categories).
 *
 * Behaviour:
 *   1. After every transactions render, replace each row's CATEGORY badge
 *      with a clickable pill. Click → small floating dropdown with all
 *      categories. Pick one → t.userCategoryId set, saveState(), dispatch
 *      wjp-tx-category-changed so smart-categorize learns + bulk applies.
 *   2. Inject a "⚙ Manage categories" link inside the existing ⚙
 *      bank-vis modal under a divider (so the Settings surface stays
 *      consolidated). Click → opens a Manage Categories modal with
 *      add / rename / delete actions.
 *
 * Universal: works for any user. No hardcoded categories — entirely
 * driven by WJP_Categories.list(). Polling-based refresh (no
 * MutationObserver) to avoid feedback loops.
 */
(function () {
  'use strict';
  if (window._wjpTxCategoryPickerInstalled) return;
  window._wjpTxCategoryPickerInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }
  function cats() { return (window.WJP_Categories && window.WJP_Categories.list) ? window.WJP_Categories.list() : []; }
  function getCat(id) { return (window.WJP_Categories && window.WJP_Categories.get) ? window.WJP_Categories.get(id) : null; }

  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  // ───────── styles ─────────
  function injectStyle() {
    if (document.getElementById('wjp-tx-cat-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-tx-cat-style';
    st.textContent = [
      '.wjp-cat-pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid var(--border, rgba(0,0,0,0.10));cursor:pointer;background:var(--bg-3, rgba(0,0,0,0.04));color:var(--text-3, #6b7280);white-space:nowrap;font-family:inherit;}',
      '.wjp-cat-pill:hover{filter:brightness(0.96);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05);}',
      '.wjp-cat-pill .ph{font-size:10px;}',
      '#wjp-cat-popover{position:absolute;z-index:99996;background:var(--bg-1,#fff);color:var(--ink,#0a0a0a);border:1px solid var(--border,rgba(0,0,0,0.12));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.18);padding:6px;min-width:200px;max-height:380px;overflow:auto;font-size:12px;font-family:inherit;}',
      '#wjp-cat-popover .opt{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:6px;cursor:pointer;font-weight:600;}',
      '#wjp-cat-popover .opt:hover{background:var(--bg-3, rgba(0,0,0,0.05));}',
      '#wjp-cat-popover .opt .icon-box{width:18px;text-align:center;}',
      '#wjp-cat-popover .opt.is-current{background:rgba(31,122,74,0.10);color:#1f7a4a;}',
      '#wjp-cat-popover .footer{border-top:1px solid var(--border, rgba(0,0,0,0.08));margin-top:4px;padding-top:4px;}',
      '#wjp-cat-popover .footer button{display:block;width:100%;text-align:left;background:transparent;border:none;padding:7px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;color:var(--ink-dim, #6b7280);font-family:inherit;}',
      '#wjp-cat-popover .footer button:hover{background:var(--bg-3, rgba(0,0,0,0.05));color:var(--ink, #1f1a14);}',
      '#wjp-cat-manage-modal{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99995;display:flex;align-items:center;justify-content:center;padding:20px;}',
      '#wjp-cat-manage-modal .panel{background:var(--bg-1,#fff);color:var(--ink,#0a0a0a);border-radius:14px;padding:18px;max-width:520px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.30);}',
      '#wjp-cat-manage-modal h3{margin:0 0 6px;font-size:16px;}',
      '#wjp-cat-manage-modal .sub{color:var(--ink-dim,#6b7280);font-size:12px;margin-bottom:12px;}',
      '#wjp-cat-manage-modal .list{flex:1;overflow:auto;border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:8px;}',
      '#wjp-cat-manage-modal .row{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border,rgba(0,0,0,0.06));font-size:12px;}',
      '#wjp-cat-manage-modal .row:last-child{border-bottom:none;}',
      '#wjp-cat-manage-modal .row .nm{flex:1;font-weight:600;}',
      '#wjp-cat-manage-modal .row button{background:transparent;border:none;color:var(--ink-dim, #6b7280);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;font-family:inherit;}',
      '#wjp-cat-manage-modal .row button:hover{background:var(--bg-3, rgba(0,0,0,0.05));color:var(--ink, #1f1a14);}',
      '#wjp-cat-manage-modal .row button.danger:hover{color:#c0594a;}',
      '#wjp-cat-manage-modal .add{display:flex;gap:6px;margin-top:10px;}',
      '#wjp-cat-manage-modal .add input{flex:1;padding:7px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:8px;font-size:12px;font-family:inherit;background:var(--bg-1, #fff);color:var(--ink, #1f1a14);}',
      '#wjp-cat-manage-modal .btn{padding:8px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;border:1px solid;font-family:inherit;background:#1f7a4a;color:#fff;border-color:#1f7a4a;}',
      '#wjp-cat-manage-modal .actions{margin-top:12px;display:flex;justify-content:flex-end;gap:8px;}',
      '#wjp-cat-manage-modal .btn-sec{background:var(--bg-3, rgba(0,0,0,0.05));color:var(--ink,#0a0a0a);border-color:var(--border,rgba(0,0,0,0.10));}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───────── row picker injection (debounced) ─────────
  var _injectScheduled = false;
  function injectPickers() {
    if (_injectScheduled) return;
    _injectScheduled = true;
    setTimeout(function () {
      _injectScheduled = false;
      try { doInjectPickers(); } catch (_) {}
    }, 150);
  }
  function doInjectPickers() {
    injectStyle();
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return;
    var rows = document.querySelectorAll('.txn-row[data-txn-id]');
    if (!rows.length) return;
    rows.forEach(function (row) {
      var id = row.getAttribute('data-txn-id');
      var t = s.transactions.find(function (x) { return x && x.id === id; });
      if (!t) return;
      // CATEGORY cell — index 3 in the existing render (SOURCE, DATE, MERCHANT, CATEGORY, AMOUNT, METHOD, STATUS, ACTIONS)
      var catCell = row.children[3];
      if (!catCell) return;
      // Compute the desired current category
      var cat = (window.WJP_Categories && window.WJP_Categories.forTransaction)
        ? window.WJP_Categories.forTransaction(t) : null;
      if (!cat) cat = { id: 'other', name: t.category || 'Other', color: null, icon: null };
      var sig = 'cat:' + cat.id + ':' + cat.name;
      var existing = catCell.querySelector('.wjp-cat-pill');
      if (existing && existing.getAttribute('data-sig') === sig) return;
      if (existing) existing.remove();
      // Remove the host's static badge so we replace it
      var staticBadge = catCell.querySelector('.badge');
      if (staticBadge) staticBadge.style.display = 'none';
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'wjp-cat-pill';
      pill.setAttribute('data-sig', sig);
      pill.setAttribute('data-txn-id', id);
      pill.title = 'Change category';
      var swatch = cat.color
        ? '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + cat.color + ';"></span>'
        : '';
      pill.innerHTML = swatch + '<span>' + htmlEscape(cat.name) + '</span><i class="ph ph-caret-down"></i>';
      pill.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openCatPopover(pill, id);
      });
      catCell.appendChild(pill);
    });
  }

  // ───────── popover ─────────
  function closePopover() {
    var p = document.getElementById('wjp-cat-popover');
    if (p) p.remove();
    document.removeEventListener('click', popoverClickAway, true);
  }
  function popoverClickAway(e) {
    var pop = document.getElementById('wjp-cat-popover');
    if (!pop) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.wjp-cat-pill')) return;
    closePopover();
  }
  function openCatPopover(anchor, txnId) {
    closePopover();
    var s = getState();
    var t = s && s.transactions ? s.transactions.find(function (x) { return x && x.id === txnId; }) : null;
    if (!t) return;
    var current = (window.WJP_Categories && window.WJP_Categories.forTransaction)
      ? window.WJP_Categories.forTransaction(t) : null;
    var currentId = current ? current.id : null;
    var list = cats();
    var pop = document.createElement('div');
    pop.id = 'wjp-cat-popover';
    var opts = list.map(function (c) {
      var sw = c.color ? '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c.color + ';"></span>' : '<span class="icon-box">·</span>';
      return '<div class="opt' + (c.id === currentId ? ' is-current' : '') + '" data-cat-id="' + htmlEscape(c.id) + '">' +
        sw + '<span>' + htmlEscape(c.name) + '</span>' +
      '</div>';
    }).join('');
    pop.innerHTML = opts +
      '<div class="footer">' +
        '<button type="button" data-act="manage"><i class="ph ph-gear"></i> Manage categories…</button>' +
      '</div>';
    document.body.appendChild(pop);
    var rect = anchor.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 4;
    var left = rect.left + window.scrollX;
    // Keep popover on screen
    var maxLeft = window.innerWidth + window.scrollX - 220;
    if (left > maxLeft) left = maxLeft;
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    setTimeout(function () { document.addEventListener('click', popoverClickAway, true); }, 0);
    // Wire option clicks
    pop.querySelectorAll('.opt[data-cat-id]').forEach(function (o) {
      o.addEventListener('click', function () {
        var newId = o.getAttribute('data-cat-id');
        if (!newId) return;
        var prev = t.userCategoryId || null;
        t.userCategoryId = newId;
        t.userEdited = true;
        saveState();
        try {
          window.dispatchEvent(new CustomEvent('wjp-tx-category-changed', {
            detail: { txId: txnId, categoryId: newId, prevCategoryId: prev }
          }));
        } catch (_) {}
        try {
          window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail: { reason: 'user-pick' } }));
        } catch (_) {}
        closePopover();
        // Force re-inject so pill reflects the new category immediately
        setTimeout(injectPickers, 50);
      });
    });
    pop.querySelector('[data-act="manage"]').onclick = function () {
      closePopover();
      openManageModal();
    };
  }

  // ───────── manage categories modal ─────────
  function closeManageModal() {
    var m = document.getElementById('wjp-cat-manage-modal');
    if (m) m.remove();
  }
  function openManageModal() {
    closeManageModal();
    var list = cats();
    var modal = document.createElement('div');
    modal.id = 'wjp-cat-manage-modal';
    var rowsHtml = list.length
      ? list.map(function (c) {
          var sw = c.color ? '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + c.color + ';flex-shrink:0;"></span>' : '';
          var isProtected = (c.id === 'other' || c.id === 'transfer' || c.id === 'income');
          return '<div class="row" data-cat-id="' + htmlEscape(c.id) + '">' +
            sw +
            '<span class="nm">' + htmlEscape(c.name) + '</span>' +
            (isProtected ? '<span style="font-size:10px;color:var(--ink-dim,#6b7280);">built-in</span>' : '') +
            '<button type="button" data-act="rename" title="Rename"><i class="ph ph-pencil-simple"></i></button>' +
            (isProtected ? '' : '<button type="button" class="danger" data-act="delete" title="Delete"><i class="ph ph-trash"></i></button>') +
          '</div>';
        }).join('')
      : '<div class="row" style="cursor:default;color:var(--ink-dim,#6b7280);">No categories yet.</div>';
    modal.innerHTML =
      '<div class="panel">' +
        '<h3>Manage categories</h3>' +
        '<div class="sub">Add, rename, or delete categories. Built-in categories (Other, Transfer, Income) can be renamed but not deleted.</div>' +
        '<div class="list">' + rowsHtml + '</div>' +
        '<div class="add">' +
          '<input type="text" id="wjp-cat-new-name" placeholder="New category name…" maxlength="40" />' +
          '<button type="button" class="btn" id="wjp-cat-add-btn">Add</button>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-sec" type="button" id="wjp-cat-close">Close</button>' +
        '</div>' +
      '</div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) closeManageModal(); });
    document.body.appendChild(modal);

    document.getElementById('wjp-cat-close').onclick = closeManageModal;
    document.getElementById('wjp-cat-add-btn').onclick = function () {
      var inp = document.getElementById('wjp-cat-new-name');
      var name = (inp.value || '').trim();
      if (!name) return;
      if (!window.WJP_Categories || !window.WJP_Categories.add) { alert('Category system not ready.'); return; }
      var newCat = window.WJP_Categories.add(name);
      if (!newCat) { alert('Could not add category. Maybe a duplicate name?'); return; }
      try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail:{reason:'add'} })); } catch (_) {}
      // Re-render modal to show the new category
      openManageModal();
    };
    document.getElementById('wjp-cat-new-name').onkeydown = function (e) {
      if (e.key === 'Enter') document.getElementById('wjp-cat-add-btn').click();
    };

    modal.querySelectorAll('.row[data-cat-id]').forEach(function (r) {
      var catId = r.getAttribute('data-cat-id');
      var renameBtn = r.querySelector('[data-act="rename"]');
      var delBtn = r.querySelector('[data-act="delete"]');
      if (renameBtn) renameBtn.onclick = function () {
        var current = getCat(catId);
        var newName = window.prompt('New name for "' + (current ? current.name : catId) + '":', current ? current.name : '');
        if (newName === null) return;
        newName = newName.trim();
        if (!newName) return;
        if (window.WJP_Categories && window.WJP_Categories.rename) {
          var ok = window.WJP_Categories.rename(catId, newName);
          if (!ok) { alert('Rename failed. Maybe a duplicate name?'); return; }
          try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail:{reason:'rename'} })); } catch (_) {}
          openManageModal();
          // Also re-inject row pills since one of them might point to this id
          setTimeout(injectPickers, 50);
        }
      };
      if (delBtn) delBtn.onclick = function () {
        var current = getCat(catId);
        if (!current) return;
        if (!confirm('Delete "' + current.name + '"? Transactions in this category will fall back to "Other".')) return;
        if (window.WJP_Categories && window.WJP_Categories.remove) {
          var ok = window.WJP_Categories.remove(catId);
          if (!ok) { alert('Could not delete this category.'); return; }
          try { window.dispatchEvent(new CustomEvent('wjp-categories-changed', { detail:{reason:'delete'} })); } catch (_) {}
          openManageModal();
          setTimeout(injectPickers, 50);
        }
      };
    });
  }

  // ───────── boot ─────────
  function boot() {
    injectStyle();
    injectPickers();
    window.addEventListener('wjp-tx-rerendered', injectPickers);
    window.addEventListener('wjp-transactions-changed', injectPickers);
    window.addEventListener('wjp-categories-changed', injectPickers);
    // Slow polling tick (no MutationObserver to avoid feedback loops).
    setInterval(injectPickers, 2500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_TxCategoryPicker = {
    version: 1,
    refresh: injectPickers,
    openManage: openManageModal
  };
})();
