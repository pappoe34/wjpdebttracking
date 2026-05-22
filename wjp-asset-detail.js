/* wjp-asset-detail.js v1 — click any asset row → modal with details + manual holdings.
 *
 * Listens for clicks on:
 *   - .ac-asset rows (Dashboard Assets card)
 *   - .pf-asset-row rows (Portfolio asset list)
 *
 * Storage: holdings nested under each asset → appState.assets[i].holdings = [{
 *   id, ticker, name, shares, value, addedAt
 * }]. Rides cloud sync via the assets STATE_KEYS entry.
 *
 * When Plaid Investments product is approved, this module can swap to
 * pulling live holdings via /investments/holdings/get — for now, manual.
 *
 * Memory rules: appState via try/catch, night-mode safe (CSS var chains +
 * explicit body.dark / [data-theme=dark] overrides), generic empty state,
 * data-connected (reads same appState as Dashboard).
 */
(function () {
  'use strict';
  if (window._wjpAssetDetailInstalled) return;
  window._wjpAssetDetailInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtUsd(n) {
    if (!isFinite(n)) return '$0.00';
    var neg = n < 0; var abs = Math.abs(n);
    return (neg ? '−' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function uuid() { return 'hold-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function liveBalanceFor(plaidAccountId) {
    try {
      if (window.WJP_Assets && typeof window.WJP_Assets.debugCache === 'function') {
        var dc = window.WJP_Assets.debugCache();
        if (dc && Array.isArray(dc.items)) {
          for (var i = 0; i < dc.items.length; i++) {
            if (dc.items[i].plaidAccountId === plaidAccountId) return dc.items[i].balance;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function findAsset(id) {
    var s = getAppState();
    if (!s || !Array.isArray(s.assets)) return null;
    return s.assets.find(function (a) { return a.id === id; }) || null;
  }

  // ---- styles ----
  function ensureStyles() {
    if (document.getElementById('wjp-asset-detail-styles')) return;
    var css = [
      '#wjp-ad-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9990;display:none;align-items:center;justify-content:center;}',
      '#wjp-ad-bg.open{display:flex;}',
      '#wjp-ad-modal{background:var(--card,var(--surface,#fff));color:var(--ink,var(--text-1,#0a0a0a));border-radius:18px;width:min(620px,94vw);max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);border:1px solid var(--border,rgba(120,113,108,.18));padding:24px 26px;font-family:inherit;}',
      'body.dark #wjp-ad-modal,[data-theme="dark"] #wjp-ad-modal{background:#131929;color:#f0f4ff;border-color:rgba(255,255,255,.08);}',
      '#wjp-ad-modal .ad-header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:6px;}',
      '#wjp-ad-modal .ad-eyebrow{font-size:11px;letter-spacing:.14em;font-weight:700;color:#c5a572;text-transform:uppercase;}',
      '#wjp-ad-modal .ad-title{font-size:21px;font-weight:800;margin-top:2px;color:var(--ink,#0a0a0a);}',
      'body.dark #wjp-ad-modal .ad-title,[data-theme="dark"] #wjp-ad-modal .ad-title{color:#f0f4ff;}',
      '#wjp-ad-modal .ad-sub{font-size:12.5px;color:var(--text-2,#8b8378);margin-top:2px;}',
      '#wjp-ad-modal .ad-close{background:transparent;border:0;font-size:22px;color:var(--text-2,#8b8378);cursor:pointer;line-height:1;padding:0 4px;}',
      '#wjp-ad-modal .ad-balance{margin:14px 0 4px;font-size:34px;font-weight:800;letter-spacing:-.5px;font-variant-numeric:tabular-nums;}',
      '#wjp-ad-modal .ad-source{font-size:11.5px;color:var(--text-2,#8b8378);}',
      '#wjp-ad-modal .ad-band{height:2px;background:linear-gradient(90deg,#c5a572 0%,#d4af37 60%,#c5a572 100%);margin:18px 0;border-radius:2px;}',
      '#wjp-ad-modal .ad-section{margin-top:20px;}',
      '#wjp-ad-modal .ad-section-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}',
      '#wjp-ad-modal .ad-section-h h4{margin:0;font-size:14px;font-weight:700;color:var(--ink,#0a0a0a);}',
      'body.dark #wjp-ad-modal .ad-section-h h4,[data-theme="dark"] #wjp-ad-modal .ad-section-h h4{color:#f0f4ff;}',
      '#wjp-ad-modal .ad-add-btn{background:linear-gradient(135deg,#c5a572 0%,#d4af37 100%);color:#1f1a14;border:0;border-radius:9px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;}',
      '#wjp-ad-modal .ad-holdings-table{width:100%;border-collapse:collapse;font-size:13px;}',
      '#wjp-ad-modal .ad-holdings-table th{text-align:left;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--text-2,#8b8378);font-weight:700;padding:6px 8px;border-bottom:1px solid var(--border,rgba(120,113,108,.12));}',
      '#wjp-ad-modal .ad-holdings-table td{padding:10px 8px;border-bottom:1px solid var(--border,rgba(120,113,108,.10));color:var(--ink,#0a0a0a);}',
      'body.dark #wjp-ad-modal .ad-holdings-table td,[data-theme="dark"] #wjp-ad-modal .ad-holdings-table td{color:#f0f4ff;border-bottom-color:rgba(255,255,255,.08);}',
      'body.dark #wjp-ad-modal .ad-holdings-table th,[data-theme="dark"] #wjp-ad-modal .ad-holdings-table th{border-bottom-color:rgba(255,255,255,.08);}',
      '#wjp-ad-modal .ad-holdings-table td.num{text-align:right;font-variant-numeric:tabular-nums;}',
      '#wjp-ad-modal .ad-holdings-table .del{color:#dc2626;background:transparent;border:0;cursor:pointer;font-size:14px;}',
      '#wjp-ad-modal .ad-empty{font-size:13px;color:var(--text-2,#8b8378);padding:12px 6px;text-align:center;line-height:1.55;}',
      '#wjp-ad-modal .ad-plaid-pending{font-size:12px;background:rgba(197,165,114,.10);border:1px solid rgba(197,165,114,.30);border-radius:9px;padding:10px 12px;color:var(--ink,#0a0a0a);margin-top:8px;line-height:1.5;}',
      'body.dark #wjp-ad-modal .ad-plaid-pending,[data-theme="dark"] #wjp-ad-modal .ad-plaid-pending{color:#f0f4ff;background:rgba(197,165,114,.14);}',
      '#wjp-ad-modal .ad-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px;}',
      '#wjp-ad-modal input[type=text],#wjp-ad-modal input[type=number]{width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border,rgba(120,113,108,.22));background:var(--surface,#fff);color:var(--ink,#0a0a0a);font-size:13px;box-sizing:border-box;font-family:inherit;}',
      'body.dark #wjp-ad-modal input,[data-theme="dark"] #wjp-ad-modal input{background:#1c2335;color:#f0f4ff;border-color:rgba(255,255,255,.12);}',
      '#wjp-ad-modal .ad-row .save{grid-column:1/-1;background:linear-gradient(135deg,#c5a572 0%,#d4af37 100%);color:#1f1a14;border:0;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;}',
      '#wjp-ad-modal .ad-row label{font-size:10.5px;color:var(--text-2,#8b8378);text-transform:uppercase;font-weight:700;letter-spacing:.05em;display:block;margin-bottom:3px;}',
      '#wjp-ad-modal .ad-notes{width:100%;min-height:60px;padding:10px;border-radius:9px;border:1px solid var(--border,rgba(120,113,108,.22));background:var(--surface,#fff);color:var(--ink,#0a0a0a);font-size:13px;box-sizing:border-box;font-family:inherit;resize:vertical;}',
      'body.dark #wjp-ad-modal .ad-notes,[data-theme="dark"] #wjp-ad-modal .ad-notes{background:#1c2335;color:#f0f4ff;border-color:rgba(255,255,255,.12);}',
      '#wjp-ad-modal .ad-stat-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px;}',
      '#wjp-ad-modal .ad-stat{background:rgba(120,113,108,.06);border-radius:10px;padding:10px 12px;}',
      'body.dark #wjp-ad-modal .ad-stat,[data-theme="dark"] #wjp-ad-modal .ad-stat{background:rgba(255,255,255,.04);}',
      '#wjp-ad-modal .ad-stat .l{font-size:9.5px;color:var(--text-2,#8b8378);text-transform:uppercase;letter-spacing:.05em;font-weight:700;}',
      '#wjp-ad-modal .ad-stat .v{font-size:14.5px;font-weight:800;margin-top:2px;color:var(--ink,#0a0a0a);}',
      'body.dark #wjp-ad-modal .ad-stat .v,[data-theme="dark"] #wjp-ad-modal .ad-stat .v{color:#f0f4ff;}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'wjp-asset-detail-styles'; st.textContent = css;
    document.head.appendChild(st);
  }

  // ---- modal ----
  function ensureModal() {
    if (document.getElementById('wjp-ad-bg')) return;
    var bg = document.createElement('div'); bg.id = 'wjp-ad-bg';
    bg.innerHTML = '<div id="wjp-ad-modal" role="dialog" aria-modal="true"><div id="wjp-ad-body"></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) { if (e.target === bg) closeModal(); });
  }
  function closeModal() {
    var bg = document.getElementById('wjp-ad-bg');
    if (bg) bg.classList.remove('open');
  }

  var _editingAssetId = null;

  var TYPE_LABEL = {
    investment:'Investment', crypto:'Crypto', real_estate:'Real estate',
    vehicle:'Vehicle', cash:'Cash', other:'Other'
  };

  function openAssetDetail(assetId) {
    ensureStyles(); ensureModal();
    var a = findAsset(assetId); if (!a) return;
    _editingAssetId = assetId;
    var body = document.getElementById('wjp-ad-body');
    var live = a.plaidAccountId ? liveBalanceFor(a.plaidAccountId) : null;
    var displayValue = (live != null) ? live : (Number(a.value) || 0);
    var sourceLabel = a.plaidAccountId
      ? (live != null ? 'Live · Plaid · ' + (a.institutionName || 'Bank') : 'Plaid-linked · cached')
      : 'Manual entry';
    var holdings = Array.isArray(a.holdings) ? a.holdings : [];
    var holdingsTotal = holdings.reduce(function (s, h) { return s + (Number(h.value) || 0); }, 0);
    var unallocated = displayValue - holdingsTotal;

    body.innerHTML = ''
      + '<div class="ad-header">'
      + '  <div>'
      + '    <div class="ad-eyebrow">' + escapeHtml(TYPE_LABEL[a.type] || 'Asset') + '</div>'
      + '    <div class="ad-title">' + escapeHtml(a.name || 'Asset') + '</div>'
      + '    <div class="ad-sub">' + escapeHtml(a.institutionName || sourceLabel) + '</div>'
      + '  </div>'
      + '  <button type="button" class="ad-close" id="ad-close-x" aria-label="Close">&times;</button>'
      + '</div>'
      + '<div class="ad-balance">' + fmtUsd(displayValue) + '</div>'
      + '<div class="ad-source">' + escapeHtml(sourceLabel) + (a.updatedAt ? ' · updated ' + new Date(a.updatedAt).toLocaleDateString() : '') + '</div>'
      + '<div class="ad-band"></div>'

      // Stat row
      + '<div class="ad-stat-row">'
      + '  <div class="ad-stat"><div class="l">Holdings tracked</div><div class="v">' + holdings.length + '</div></div>'
      + '  <div class="ad-stat"><div class="l">Holdings value</div><div class="v">' + fmtUsd(holdingsTotal) + '</div></div>'
      + '  <div class="ad-stat"><div class="l">Unallocated</div><div class="v">' + fmtUsd(unallocated) + '</div></div>'
      + '</div>'

      // Holdings
      + '<div class="ad-section">'
      + '  <div class="ad-section-h"><h4>Holdings</h4>'
      + '    <button type="button" class="ad-add-btn" id="ad-add-holding">+ Add holding</button>'
      + '  </div>'
      + (holdings.length
          ? '<table class="ad-holdings-table">'
            + '<thead><tr><th>Ticker</th><th>Name</th><th class="num">Shares</th><th class="num">Value</th><th></th></tr></thead>'
            + '<tbody>'
            + holdings.map(function (h) {
                return '<tr>'
                  + '<td><strong>' + escapeHtml(h.ticker || '—') + '</strong></td>'
                  + '<td>' + escapeHtml(h.name || '') + '</td>'
                  + '<td class="num">' + (h.shares != null ? Number(h.shares).toLocaleString() : '—') + '</td>'
                  + '<td class="num">' + fmtUsd(Number(h.value) || 0) + '</td>'
                  + '<td><button class="del" data-hid="' + escapeHtml(h.id) + '" title="Remove holding">×</button></td>'
                  + '</tr>';
              }).join('')
            + '</tbody></table>'
          : '<div class="ad-empty">No holdings tracked yet. Add positions manually to see what\'s inside this asset.</div>')
      + (a.plaidAccountId
          ? '<div class="ad-plaid-pending">Plaid Investments product is pending approval. Once active, holdings (tickers, shares, cost basis) will auto-sync from your linked account.</div>'
          : '')
      + '  <div id="ad-add-form" style="display:none;">'
      + '    <div class="ad-row">'
      + '      <div><label>Ticker</label><input type="text" id="ad-h-ticker" placeholder="e.g. VTSAX"></div>'
      + '      <div><label>Name</label><input type="text" id="ad-h-name" placeholder="Vanguard Total Stock Market"></div>'
      + '      <div><label>Shares</label><input type="number" step="0.0001" id="ad-h-shares" placeholder="0"></div>'
      + '      <div style="grid-column:1/-1"><label>Value ($)</label><input type="number" step="0.01" id="ad-h-value" placeholder="0.00"></div>'
      + '      <button type="button" class="save" id="ad-h-save">Add holding</button>'
      + '    </div>'
      + '  </div>'
      + '</div>'

      // Notes
      + '<div class="ad-section">'
      + '  <div class="ad-section-h"><h4>Notes</h4></div>'
      + '  <textarea class="ad-notes" id="ad-notes" placeholder="Account number, custodian, contribution rate, anything else…">' + escapeHtml(a.notes || '') + '</textarea>'
      + '  <button type="button" class="ad-add-btn" id="ad-save-notes" style="margin-top:8px;">Save notes</button>'
      + '</div>';

    document.getElementById('wjp-ad-bg').classList.add('open');
    wire(body);
  }

  function wire(body) {
    body.querySelector('#ad-close-x').addEventListener('click', closeModal);
    var addBtn = body.querySelector('#ad-add-holding');
    var form = body.querySelector('#ad-add-form');
    if (addBtn) addBtn.addEventListener('click', function () { form.style.display = form.style.display === 'none' ? 'block' : 'none'; });

    var saveH = body.querySelector('#ad-h-save');
    if (saveH) saveH.addEventListener('click', function () {
      var a = findAsset(_editingAssetId); if (!a) return;
      var ticker = body.querySelector('#ad-h-ticker').value.trim().toUpperCase();
      var name   = body.querySelector('#ad-h-name').value.trim();
      var shares = parseFloat(body.querySelector('#ad-h-shares').value) || 0;
      var value  = parseFloat(body.querySelector('#ad-h-value').value) || 0;
      if (!ticker && !name) { body.querySelector('#ad-h-ticker').focus(); return; }
      if (!Array.isArray(a.holdings)) a.holdings = [];
      a.holdings.push({ id: uuid(), ticker: ticker, name: name, shares: shares, value: value, addedAt: new Date().toISOString() });
      a.updatedAt = new Date().toISOString();
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-assets-changed')); } catch (_) {}
      openAssetDetail(_editingAssetId); // re-render
    });

    // Delete holding
    body.querySelectorAll('.del[data-hid]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hid = btn.dataset.hid;
        var a = findAsset(_editingAssetId); if (!a || !Array.isArray(a.holdings)) return;
        a.holdings = a.holdings.filter(function (h) { return h.id !== hid; });
        a.updatedAt = new Date().toISOString();
        saveState();
        try { window.dispatchEvent(new CustomEvent('wjp-assets-changed')); } catch (_) {}
        openAssetDetail(_editingAssetId);
      });
    });

    var notesBtn = body.querySelector('#ad-save-notes');
    if (notesBtn) notesBtn.addEventListener('click', function () {
      var a = findAsset(_editingAssetId); if (!a) return;
      a.notes = body.querySelector('#ad-notes').value;
      a.updatedAt = new Date().toISOString();
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-assets-changed')); } catch (_) {}
      notesBtn.textContent = 'Saved ✓';
      setTimeout(function () { notesBtn.textContent = 'Save notes'; }, 1200);
    });
  }

  // ---- delegated row clicks ----
  function bindRowClicks() {
    document.addEventListener('click', function (e) {
      // Asset row in Dashboard Assets card (.ac-asset[data-asset-id])
      var row = e.target.closest && e.target.closest('.ac-asset[data-asset-id]');
      if (row && !e.target.closest('.ac-actions')) {
        e.preventDefault();
        openAssetDetail(row.getAttribute('data-asset-id'));
        return;
      }
      // Portfolio's asset rows — selector varies; look for any element with data-wjp-asset-id
      var pfRow = e.target.closest && e.target.closest('[data-wjp-asset-id]');
      if (pfRow) {
        e.preventDefault();
        openAssetDetail(pfRow.getAttribute('data-wjp-asset-id'));
        return;
      }
    });
  }

  bindRowClicks();
  ensureStyles();

  window.WJP_AssetDetail = {
    open: openAssetDetail,
    close: closeModal,
    version: 1
  };
})();
