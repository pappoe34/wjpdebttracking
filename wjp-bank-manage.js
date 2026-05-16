/* ============================================================================
   WJP Bank Manage v1 — connected-bank dedupe + rename + remove
   Wires:
     - Dedupe guard: prevents re-launching Plaid Link for an already-connected
       institution (intercepts any "Sync Bank" / "Connect Bank" / similar click).
     - Manage Accounts modal: lists Plaid items from Firestore for the current
       user, allows rename (Firestore-only) and remove (calls
       /.netlify/functions/unlink-item which also calls Plaid /item/remove and
       stops monthly $0.30/account billing).
     - Two mount points:
         1) Top of the Sync Bank modal/area (shows a compact summary + Manage
            link before Plaid Link is launched).
         2) Debts tab → Documents subtab (full "Linked Bank Accounts" card).
   Dark mode: every color uses var(--ink, var(--text-1, fallback)) etc.
   No new endpoints required (unlink-item already exists in netlify/functions).
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpBankManageInstalled) return;
  window._wjpBankManageInstalled = true;

  // Only run on the app page (not marketing / signin / etc.)
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  var uid = null;

  async function getCurrentUid() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) {
          uid = u.uid;
          return u.uid;
        }
      }
    } catch (_) {}
    return null;
  }

  async function getIdToken() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return await u.getIdToken();
      }
    } catch (_) {}
    return null;
  }

  function db() {
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
  // Firestore reads
  // --------------------------------------------------------------------------
  // In-memory cache so we don't refetch on every click; refreshed on open.
  var _itemsCache = null;
  var _itemsCacheAt = 0;

  async function listItems(force) {
    var now = Date.now();
    if (!force && _itemsCache && (now - _itemsCacheAt) < 15000) return _itemsCache;
    await getCurrentUid();
    if (!uid) return [];
    var fb = db();
    if (!fb) return [];
    try {
      var snap = await fb.collection('users').doc(uid)
        .collection('plaid_items').get();
      var items = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        items.push({
          itemId: doc.id,
          institutionName: d.institutionName || 'Unknown bank',
          institutionId: d.institutionId || null,    // set on connect (we'll patch link flow)
          displayName: d.displayName || null,         // user-set nickname
          accounts: Array.isArray(d.accounts) ? d.accounts : [],
          createdAt: d.createdAt || null,
          lastSyncAt: d.lastSyncAt || null,
          itemError: d.itemError || null
        });
      });
      _itemsCache = items;
      _itemsCacheAt = now;
      return items;
    } catch (e) {
      console.warn('[WJP_BankManage] listItems failed:', e && e.message);
      return [];
    }
  }

  async function renameItem(itemId, newName) {
    await getCurrentUid();
    if (!uid) throw new Error('not signed in');
    var fb = db();
    if (!fb) throw new Error('firestore unavailable');
    await fb.collection('users').doc(uid)
      .collection('plaid_items').doc(itemId)
      .update({ displayName: newName || null });
    _itemsCache = null; // bust cache
  }

  async function removeItem(itemId) {
    var token = await getIdToken();
    if (!token) throw new Error('not signed in');
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
    _itemsCache = null;
    return data;
  }

  // --------------------------------------------------------------------------
  // Dedupe guard
  // --------------------------------------------------------------------------
  // Returns true if institutionId is already connected.
  async function isAlreadyConnected(institutionId) {
    if (!institutionId) return false;
    var items = await listItems(false);
    return items.some(function (it) { return it.institutionId === institutionId; });
  }

  // Hook intercepts the Plaid Link onSuccess handler. We monkey-patch Plaid's
  // create() so that callbacks naturally flow through us.
  function installPlaidCreateHook() {
    try {
      if (!window.Plaid || typeof window.Plaid.create !== 'function') return false;
      if (window.Plaid._wjpHooked) return true;
      var orig = window.Plaid.create.bind(window.Plaid);
      window.Plaid.create = function (config) {
        try {
          var origOnSuccess = config.onSuccess;
          config.onSuccess = async function (publicToken, metadata) {
            try {
              var instId = (metadata && metadata.institution && metadata.institution.institution_id) || null;
              if (instId) {
                var dup = await isAlreadyConnected(instId);
                if (dup) {
                  var instName = (metadata.institution && metadata.institution.name) || 'this bank';
                  var goManage = confirm(
                    instName + ' is already connected.\n\n' +
                    'Click OK to open Manage Accounts (remove or rename existing connection).\n' +
                    'Click Cancel to add a new ' + instName + ' connection anyway.'
                  );
                  if (goManage) {
                    openManageModal();
                    return; // skip the original onSuccess — user wanted to manage
                  }
                }
              }
            } catch (e) {
              console.warn('[WJP_BankManage] dedupe guard error:', e && e.message);
            }
            // Pass through to the real onSuccess (so existing exchange-public-token flow runs)
            try { if (typeof origOnSuccess === 'function') return origOnSuccess(publicToken, metadata); }
            catch (e) { console.error('[WJP_BankManage] downstream onSuccess threw:', e); }
          };
        } catch (_) {}
        return orig(config);
      };
      window.Plaid._wjpHooked = true;
      return true;
    } catch (e) {
      console.warn('[WJP_BankManage] hook install failed:', e && e.message);
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Manage Accounts modal
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
          'No banks connected yet.<br><span style="font-size:11px;">Use Sync Bank to add your first one.</span>' +
        '</div>';
      return;
    }

    var html = items.map(rowHtml).join('');
    host.innerHTML = html;

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
        if (!v) {
          // Empty = clear the displayName, revert to institutionName
          v = null;
        }
        try {
          renameBtn.disabled = true;
          renameBtn.textContent = '…';
          await renameItem(itemId, v);
          toast('Renamed', 'green');
          renderModalList();
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
                     ' • Disconnect Plaid (stops the monthly billing)\n' +
                     ' • Delete this institution from your dashboard\n' +
                     ' • Keep your existing debts/transactions (just not auto-synced anymore)\n\n' +
                     'You can re-connect anytime via Sync Bank.')) return;
        try {
          removeBtn.disabled = true;
          removeBtn.textContent = 'Removing…';
          await removeItem(itemId);
          toast('Removed', 'green');
          renderModalList();
          // Notify the rest of the app that something changed
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
  // Mount points
  // --------------------------------------------------------------------------
  // 1) Top of Sync Bank flow — best-effort: when a Plaid Link modal/area or the
  //    in-app "Sync Bank" button is clicked, inject a "Manage existing
  //    connections" link. We use event delegation on document so it works
  //    regardless of how/when the button gets injected.
  document.addEventListener('click', function (ev) {
    try {
      var el = ev.target;
      while (el && el !== document.body) {
        var label = (el.textContent || '').trim().toLowerCase();
        var isSyncBtn = (
          /^sync\s*bank/.test(label) ||
          /connect\s*bank/.test(label) ||
          /^link\s*bank/.test(label) ||
          /^add\s*bank/.test(label)
        );
        if (isSyncBtn && el.tagName && /^(BUTTON|A)$/.test(el.tagName)) {
          // Show a tiny inline summary above the button (once) so the user
          // sees what's already connected before launching Link.
          showInlineSummaryNear(el);
          break;
        }
        el = el.parentElement;
      }
    } catch (_) {}
  }, true);

  function showInlineSummaryNear(btnEl) {
    // Don't double-inject
    if (btnEl._wjpSummaryShown) return;
    btnEl._wjpSummaryShown = true;
    setTimeout(async function () {
      var items = await listItems(false);
      if (!items.length) return;
      // Inject a small floating tag near the button area
      var parent = btnEl.parentElement || document.body;
      // Avoid duplicate: search by id within the parent
      if (parent.querySelector('.wjp-bm-near-sync')) return;
      var box = document.createElement('div');
      box.className = 'wjp-bm-near-sync';
      box.style.cssText =
        'margin:8px 0;padding:9px 12px;border-radius:8px;' +
        'background:var(--bg-3,rgba(31,122,74,0.06));' +
        'border:1px solid var(--border,rgba(31,122,74,0.20));' +
        'font-size:12px;color:var(--ink,var(--text-1,#0a0a0a));font-family:inherit;' +
        'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;';
      var names = items.slice(0, 3).map(function (it) { return it.displayName || it.institutionName; }).join(', ');
      if (items.length > 3) names += ' +' + (items.length - 3) + ' more';
      box.innerHTML =
        '<div><strong>Already connected:</strong> ' + escapeHtml(names) + '</div>' +
        '<button type="button" class="wjp-bm-open" style="background:#1f7a4a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Manage</button>';
      // Insert before the button
      try { parent.insertBefore(box, btnEl); } catch (_) { parent.appendChild(box); }
      var openBtn = box.querySelector('.wjp-bm-open');
      if (openBtn) openBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        openManageModal();
      };
    }, 200);
  }

  // 2) Debts → Documents subtab: inject a "Linked Bank Accounts" card.
  //    We find a host that's only present on the Documents subtab and mount
  //    the card there. Hosts we look for:
  //      - any element with [data-debts-subtab="documents"] active
  //      - element with id="debts-documents" or class containing "documents"
  //      - fallback: an element with text "Documents" sibling
  var DEBTS_CARD_ID = 'wjp-bank-manage-debts-card';

  function findDocsHost() {
    // Most specific selectors first
    var sel = [
      '[data-debts-subtab="documents"].active',
      '[data-subtab="documents"].active',
      '#debts-documents',
      '#debts-documents-content',
      '.debts-documents',
      '[data-tab-content="documents"]'
    ];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el && el.offsetParent !== null) return el;
    }
    // Heuristic: find a heading "Documents" that's visible AND inside a debts page
    var headings = document.querySelectorAll('h2, h3, .subtab-title');
    for (var j = 0; j < headings.length; j++) {
      var h = headings[j];
      if (h.offsetParent === null) continue;
      var txt = (h.textContent || '').trim().toLowerCase();
      if (txt === 'documents' || txt === 'document') {
        // Mount as a sibling of the heading
        return h.parentElement;
      }
    }
    return null;
  }

  async function maybeMountDebtsCard() {
    var host = findDocsHost();
    if (!host) {
      // If we previously mounted but the tab changed, remove the stale card
      var old = document.getElementById(DEBTS_CARD_ID);
      if (old && old.parentElement && !host) {
        // keep it if user is still on a debts-ish page; otherwise drop
        var stillThere = document.body.contains(old);
        if (!stillThere) {/* nothing to do */}
      }
      return;
    }
    if (document.getElementById(DEBTS_CARD_ID)) return;

    var card = document.createElement('div');
    card.id = DEBTS_CARD_ID;
    card.style.cssText =
      'background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:12px;' +
      'padding:16px 20px;margin:14px 0;font-family:inherit;font-size:13px;';
    card.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">' +
        '<div>' +
          '<div style="font-size:14px;font-weight:800;letter-spacing:-0.01em;color:var(--ink,var(--text-1,#0a0a0a));">Linked Bank Accounts</div>' +
          '<div style="font-size:11.5px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">Rename or remove any institution connected to your dashboard.</div>' +
        '</div>' +
        '<button type="button" class="wjp-bm-open-from-debts" style="background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Manage</button>' +
      '</div>' +
      '<div class="wjp-bm-debts-summary" style="font-size:12px;color:var(--ink-dim,var(--text-2,#6b7280));"></div>';

    host.appendChild(card);

    var openBtn = card.querySelector('.wjp-bm-open-from-debts');
    if (openBtn) openBtn.onclick = openManageModal;

    // Populate inline summary
    var items = await listItems(false);
    var summary = card.querySelector('.wjp-bm-debts-summary');
    if (summary) {
      if (!items.length) {
        summary.textContent = 'No banks connected yet.';
      } else {
        var names = items.map(function (it) { return it.displayName || it.institutionName; }).join(' · ');
        summary.innerHTML = '<strong>' + items.length + ' connected:</strong> ' + escapeHtml(names);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Boot
  // --------------------------------------------------------------------------
  function start() {
    // Try the Plaid hook periodically until Plaid SDK is loaded
    var tries = 0;
    var hookIv = setInterval(function () {
      tries++;
      if (installPlaidCreateHook() || tries > 60) clearInterval(hookIv);
    }, 500);

    // Continuously look for Documents-subtab mount point
    setInterval(function () {
      try { maybeMountDebtsCard(); } catch (_) {}
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
    isAlreadyConnected: isAlreadyConnected,
    version: 1
  };
})();
