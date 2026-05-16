/* ============================================================================
   WJP Bank Manage v2 — Bank Health placement only, no Sync Bank/Plaid hooks
   Why v2: v1 intercepted Sync Bank clicks and monkey-patched Plaid.create.
   Both were risky — Sync Bank is load-bearing Plaid territory. v2 lives
   exclusively on the Bank Health tab and uses the existing
   /.netlify/functions/get-accounts endpoint for listing (more reliable than
   direct Firestore reads).

   Features:
     - "Linked Bank Accounts" card on Bank Health tab (top of page).
     - Manage modal: list, rename, remove.
     - Remove → /.netlify/functions/unlink-item (already deployed, calls
       Plaid /item/remove AND deletes Firestore doc — stops $0.30/acct/mo
       billing).
     - Rename → Firestore update on displayName field (best-effort; if the
       compat SDK isn't available, falls back to a friendly "rename not
       available right now" message so we never crash).
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpBankManageInstalled) return;
  window._wjpBankManageInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  async function getIdToken() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return await u.getIdToken();
      }
    } catch (_) {}
    return null;
  }

  async function getCurrentUid() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.uid;
      }
    } catch (_) {}
    return null;
  }

  function firestore() {
    try {
      if (window.firebase && window.firebase.firestore) return window.firebase.firestore();
    } catch (_) {}
    return null;
  }

  function toast(msg, color) {
    try {
      var bg = color === 'red' ? '#c0594a'
             : color === 'green' ? '#1f7a4a'
             : color === 'amber' ? '#a16207'
             : '#1f7a4a';
      var t = document.createElement('div');
      t.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;background:' + bg + ';color:#fff;padding:11px 18px;' +
        'border-radius:10px;font-weight:700;font-size:13px;font-family:inherit;' +
        'box-shadow:0 8px 24px rgba(0,0,0,0.18);max-width:90vw;text-align:center;';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (_) {} }, 4200);
    } catch (_) {}
  }

  function fmtAge(ts) {
    if (!ts) return 'never';
    var ms = (typeof ts === 'object' && ts && ts.toMillis) ? ts.toMillis() : ts;
    if (typeof ms === 'number' && ms < 1e12) ms = ms * 1000; // unix seconds
    if (typeof ms !== 'number') return 'unknown';
    var mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --------------------------------------------------------------------------
  // Data: list via /get-accounts (server-authoritative)
  // --------------------------------------------------------------------------
  var _cache = null;
  var _cacheAt = 0;
  var _listInflight = null;

  async function listItems(force) {
    var now = Date.now();
    if (!force && _cache && (now - _cacheAt) < 15000) return _cache;
    if (_listInflight) return _listInflight;

    _listInflight = (async function () {
      var token = await getIdToken();
      if (!token) return [];
      try {
        var resp = await fetch('/.netlify/functions/get-accounts', {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!resp.ok) {
          console.warn('[WJP_BankManage] get-accounts HTTP', resp.status);
          return [];
        }
        var data = await resp.json();
        var items = Array.isArray(data.items) ? data.items.map(function (it) {
          return {
            itemId: it.itemId,
            institutionName: it.institutionName || 'Unknown bank',
            displayName: it.displayName || null,
            accounts: Array.isArray(it.accounts) ? it.accounts : [],
            createdAt: it.createdAt || null,
            lastSyncAt: it.lastSyncAt || null,
            itemError: it.itemError || it.liveItemError || null
          };
        }) : [];
        _cache = items;
        _cacheAt = Date.now();
        return items;
      } catch (e) {
        console.warn('[WJP_BankManage] listItems error:', e && e.message);
        return [];
      } finally {
        _listInflight = null;
      }
    })();

    return _listInflight;
  }

  async function renameItem(itemId, newName) {
    var uid = await getCurrentUid();
    if (!uid) throw new Error('Sign in first');
    var fb = firestore();
    if (!fb) throw new Error('rename not available right now (try again in a few seconds)');
    await fb.collection('users').doc(uid)
      .collection('plaid_items').doc(itemId)
      .update({ displayName: newName || null });
    _cache = null;
  }

  async function removeItem(itemId) {
    var token = await getIdToken();
    if (!token) throw new Error('Sign in first');
    var resp = await fetch('/.netlify/functions/unlink-item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ itemId: itemId })
    });
    var data = {};
    try { data = await resp.json(); } catch (_) {}
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    _cache = null;
    return data;
  }

  // --------------------------------------------------------------------------
  // Manage modal
  // --------------------------------------------------------------------------
  var MODAL_ID = 'wjp-bank-manage-modal';

  function buildModalShell() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;' +
      'padding:18px;font-family:inherit;';
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeManageModal();
    });

    wrap.innerHTML =
      '<div style="background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
        'border-radius:14px;max-width:560px;width:100%;max-height:88vh;overflow:hidden;' +
        'display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.4);' +
        'border:1px solid var(--border,rgba(0,0,0,0.10));">' +
        '<div style="padding:18px 22px;border-bottom:1px solid var(--border,rgba(0,0,0,0.10));' +
          'display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:800;letter-spacing:-0.01em;color:var(--ink,var(--text-1,#0a0a0a));">Manage Bank Accounts</div>' +
            '<div style="font-size:12px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">Rename or remove a connected institution. Removing stops Plaid billing for that bank.</div>' +
          '</div>' +
          '<button type="button" id="wjp-bank-manage-close" aria-label="Close" style="background:transparent;border:none;color:var(--ink,var(--text-1,#0a0a0a));font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;">×</button>' +
        '</div>' +
        '<div id="wjp-bank-manage-list" style="padding:14px 22px;overflow-y:auto;flex:1;">' +
          '<div style="text-align:center;padding:32px 0;color:var(--ink-dim,var(--text-2,#6b7280));font-size:13px;">Loading…</div>' +
        '</div>' +
        '<div style="padding:12px 22px;border-top:1px solid var(--border,rgba(0,0,0,0.10));' +
          'display:flex;justify-content:space-between;gap:10px;align-items:center;">' +
          '<div id="wjp-bank-manage-foot" style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));"></div>' +
          '<button type="button" id="wjp-bank-manage-done" style="background:linear-gradient(135deg,#1f7a4a,#2b9b72);' +
            'color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Done</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    document.getElementById('wjp-bank-manage-close').onclick = closeManageModal;
    document.getElementById('wjp-bank-manage-done').onclick = closeManageModal;
    return wrap;
  }

  function rowHtml(it) {
    var displayed = it.displayName || it.institutionName;
    var subline = (it.accounts && it.accounts.length)
      ? it.accounts.length + ' account' + (it.accounts.length === 1 ? '' : 's')
      : 'no accounts';
    if (it.lastSyncAt) subline += ' · synced ' + fmtAge(it.lastSyncAt);
    else if (it.createdAt) subline += ' · linked ' + fmtAge(it.createdAt);
    if (it.itemError) {
      subline = '<span style="color:#c0594a;font-weight:700;">⚠ needs re-auth</span> · ' + subline;
    }

    return (
      '<div data-item-id="' + escapeHtml(it.itemId) + '" ' +
        'style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border,rgba(0,0,0,0.06));">' +
        '<div style="width:34px;height:34px;border-radius:8px;background:var(--bg-3,rgba(0,0,0,0.05));' +
          'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:var(--ink-dim,var(--text-2,#6b7280));flex-shrink:0;">' +
          escapeHtml((displayed || '?').charAt(0).toUpperCase()) +
        '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="wjp-bm-name" style="font-weight:700;font-size:13.5px;color:var(--ink,var(--text-1,#0a0a0a));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            escapeHtml(displayed) +
          '</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">' + subline + '</div>' +
        '</div>' +
        '<button type="button" class="wjp-bm-rename" title="Rename" ' +
          'style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink,var(--text-1,#0a0a0a));' +
          'border-radius:7px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Rename</button>' +
        '<button type="button" class="wjp-bm-remove" title="Remove" ' +
          'style="background:transparent;border:1px solid #c0594a;color:#c0594a;' +
          'border-radius:7px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Remove</button>' +
      '</div>'
    );
  }

  async function renderModalList() {
    var host = document.getElementById('wjp-bank-manage-list');
    if (!host) return;
    var items;
    try {
      items = await listItems(true);
    } catch (e) {
      host.innerHTML = '<div style="text-align:center;padding:24px 0;color:#c0594a;font-size:13px;">Couldn’t load linked banks: ' + escapeHtml(e.message || 'error') + '</div>';
      return;
    }

    var foot = document.getElementById('wjp-bank-manage-foot');
    if (foot) {
      var billable = items.reduce(function (n, it) { return n + (it.accounts ? it.accounts.length : 0); }, 0);
      foot.textContent = items.length + ' institution' + (items.length === 1 ? '' : 's') +
                         ' · ' + billable + ' billable account' + (billable === 1 ? '' : 's');
    }

    if (!items.length) {
      host.innerHTML =
        '<div style="text-align:center;padding:32px 0;color:var(--ink-dim,var(--text-2,#6b7280));font-size:13px;">' +
          'No banks connected yet.<br><span style="font-size:11px;">Use Sync Bank from the top nav to add your first one.</span>' +
        '</div>';
      return;
    }

    host.innerHTML = items.map(rowHtml).join('');

    Array.prototype.forEach.call(host.querySelectorAll('[data-item-id]'), function (row) {
      var itemId = row.getAttribute('data-item-id');
      var current = items.find(function (x) { return x.itemId === itemId; });
      var renameBtn = row.querySelector('.wjp-bm-rename');
      var removeBtn = row.querySelector('.wjp-bm-remove');

      if (renameBtn) renameBtn.onclick = async function () {
        var curName = current.displayName || current.institutionName;
        var v = prompt('Rename this connection (e.g. "Chase – Bills"):', curName);
        if (v == null) return;
        v = (v || '').trim();
        if (!v) v = null; // empty = clear nickname, revert to institutionName
        try {
          renameBtn.disabled = true;
          renameBtn.textContent = '…';
          await renameItem(itemId, v);
          toast('Renamed', 'green');
          renderModalList();
          mountBankHealthCard(true); // refresh card summary too
        } catch (e) {
          toast('Rename failed: ' + (e.message || 'error'), 'red');
        } finally {
          if (renameBtn) {
            renameBtn.disabled = false;
            renameBtn.textContent = 'Rename';
          }
        }
      };

      if (removeBtn) removeBtn.onclick = async function () {
        var name = current.displayName || current.institutionName;
        if (!confirm('Remove ' + name + '?\n\n' +
                     'This will:\n' +
                     ' • Disconnect Plaid (stops monthly billing for this bank)\n' +
                     ' • Delete this institution from your dashboard\n' +
                     ' • Keep existing debts/transactions (just not auto-synced anymore)\n\n' +
                     'You can re-connect anytime via Sync Bank.')) return;
        try {
          removeBtn.disabled = true;
          removeBtn.textContent = 'Removing…';
          await removeItem(itemId);
          toast('Removed', 'green');
          renderModalList();
          mountBankHealthCard(true);
          try { if (typeof window.updateUI === 'function') setTimeout(window.updateUI, 400); } catch (_) {}
        } catch (e) {
          toast('Remove failed: ' + (e.message || 'error'), 'red');
          if (removeBtn) {
            removeBtn.disabled = false;
            removeBtn.textContent = 'Remove';
          }
        }
      };
    });
  }

  function openManageModal() {
    buildModalShell();
    renderModalList();
  }

  function closeManageModal() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  // --------------------------------------------------------------------------
  // Bank Health placement
  // --------------------------------------------------------------------------
  // Detect when user is on the Bank Health page and inject our card at the top.
  var CARD_ID = 'wjp-bank-manage-bh-card';

  function isOnBankHealth() {
    try {
      var h = (location.hash || '').toLowerCase();
      if (h.indexOf('bank-health') !== -1 || h.indexOf('bankhealth') !== -1) return true;
    } catch (_) {}
    // Heuristic: find a visible Bank Health title or active nav item
    var titles = document.querySelectorAll('h1, h2, .page-title, [data-page-title]');
    for (var i = 0; i < titles.length; i++) {
      var t = titles[i];
      if (t.offsetParent === null) continue;
      var txt = (t.textContent || '').trim().toLowerCase();
      if (txt === 'bank health' || txt === 'bank health overview') return true;
    }
    // Top-nav active state (button labeled "Bank Health" with .active or aria-current="page")
    var nav = document.querySelectorAll('button, a');
    for (var j = 0; j < nav.length; j++) {
      var n = nav[j];
      var label = (n.textContent || '').trim().toLowerCase();
      if (label === 'bank health' || label === 'bank health overview') {
        if (n.classList.contains('active') || n.getAttribute('aria-current') === 'page' ||
            n.classList.contains('is-active') || n.classList.contains('selected')) {
          return true;
        }
      }
    }
    return false;
  }

  function findBankHealthHost() {
    // Candidates by selector
    var sel = [
      '[data-page="bank-health"]',
      '[data-page="bankhealth"]',
      '#bank-health-page',
      '#bankhealth-page',
      '#page-bank-health',
      '.bank-health-page',
      '#bank-health-content',
      '[data-page-id="bank-health"]'
    ];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el && el.offsetParent !== null) return el;
    }
    // Heuristic: find visible "Bank Health" heading and use its parent container
    var titles = document.querySelectorAll('h1, h2, .page-title');
    for (var j = 0; j < titles.length; j++) {
      var t = titles[j];
      if (t.offsetParent === null) continue;
      var txt = (t.textContent || '').trim().toLowerCase();
      if (txt === 'bank health' || txt === 'bank health overview') {
        return t.parentElement;
      }
    }
    return null;
  }

  async function mountBankHealthCard(forceRefresh) {
    if (!isOnBankHealth()) {
      // If we left the page, clean up the old card so it doesn't ghost into other tabs
      var old = document.getElementById(CARD_ID);
      if (old) try { old.remove(); } catch (_) {}
      return;
    }
    var host = findBankHealthHost();
    if (!host) return;

    var existing = document.getElementById(CARD_ID);
    if (existing && !forceRefresh) {
      // Refresh just the summary
      await refreshCardSummary(existing);
      return;
    }
    if (existing) existing.remove();

    var card = document.createElement('div');
    card.id = CARD_ID;
    card.style.cssText =
      'background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:12px;' +
      'padding:16px 20px;margin:14px 0;font-family:inherit;font-size:13px;';
    card.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:220px;">' +
          '<div style="font-size:14.5px;font-weight:800;letter-spacing:-0.01em;color:var(--ink,var(--text-1,#0a0a0a));">Linked Bank Accounts</div>' +
          '<div style="font-size:11.5px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">Rename or remove any institution. Removing stops Plaid billing.</div>' +
        '</div>' +
        '<button type="button" class="wjp-bm-open-from-bh" style="background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
          'Manage' +
        '</button>' +
      '</div>' +
      '<div class="wjp-bm-bh-summary" style="font-size:12px;color:var(--ink-dim,var(--text-2,#6b7280));">Loading…</div>';

    // Insert at the TOP of the host so it's the first thing the user sees
    if (host.firstChild) host.insertBefore(card, host.firstChild);
    else host.appendChild(card);

    var openBtn = card.querySelector('.wjp-bm-open-from-bh');
    if (openBtn) openBtn.onclick = openManageModal;

    await refreshCardSummary(card);
  }

  async function refreshCardSummary(card) {
    if (!card) return;
    var summary = card.querySelector('.wjp-bm-bh-summary');
    if (!summary) return;
    var items;
    try { items = await listItems(false); }
    catch (e) { summary.textContent = 'Couldn’t load: ' + (e.message || 'error'); return; }
    if (!items.length) {
      summary.innerHTML = 'No banks connected yet. Use <strong>Sync Bank</strong> in the top nav to add your first one.';
      return;
    }
    var names = items.slice(0, 4).map(function (it) {
      return '<strong>' + escapeHtml(it.displayName || it.institutionName) + '</strong>';
    }).join(' · ');
    if (items.length > 4) names += ' <span style="opacity:0.7;">+' + (items.length - 4) + ' more</span>';
    var billable = items.reduce(function (n, it) { return n + (it.accounts ? it.accounts.length : 0); }, 0);
    summary.innerHTML =
      items.length + ' institution' + (items.length === 1 ? '' : 's') + ' · ' +
      billable + ' billable account' + (billable === 1 ? '' : 's') + ' · ' +
      names;
  }

  // --------------------------------------------------------------------------
  // Boot — poll for Bank Health page; no Sync Bank or Plaid hooks
  // --------------------------------------------------------------------------
  function start() {
    setInterval(function () {
      try { mountBankHealthCard(false); } catch (_) {}
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Public API
  window.WJP_BankManage = {
    open: openManageModal,
    close: closeManageModal,
    listItems: listItems,
    renameItem: renameItem,
    removeItem: removeItem,
    version: 2
  };
})();
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       