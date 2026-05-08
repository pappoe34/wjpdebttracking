/* wjp-recurring-tiles.js — Expanded debt tiles for the Recurring Payments tab.
 *
 * The Overview sub-tab gives a quick read of Current Obligations. Recurring
 * Payments is the deeper view: each debt becomes a full tile with statement
 * upload, edit access, AI breakdown always visible, and a contextual
 * "Ask AI Coach" entry point.
 *
 * Hardened: IIFE, idempotent, path-guarded, no MutationObservers, polled.
 */
(function () {
  'use strict';
  if (window._wjpRecurringTilesInstalled) return;
  window._wjpRecurringTilesInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var WRAP_ID = 'wjp-rt-grid';
  var debtDataCache = {};

  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return '-';
    return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function fmtPct(n) { if (!isFinite(n)) return '-'; return Math.round(n * 100) / 100 + '%'; }

  // Harvest debt data from Current Obligations cards anywhere in the DOM.
  function harvestDebtsFromObligations() {
    // Look for the obligation tiles (Debts page → Overview sub-tab).
    // Each tile has the structure: name + balance + apr + min payment + utilization.
    var cards = document.querySelectorAll('[data-debt-id], .debt-card, .obligation-card');
    cards.forEach(function (card) {
      try {
        var id = card.dataset.debtId || (card.querySelector('[data-debt-id]') ? card.querySelector('[data-debt-id]').dataset.debtId : null);
        var nameEl = card.querySelector('.debt-name, .obligation-name, h3, h4, [class*="title"]');
        var name = nameEl ? nameEl.textContent.trim() : null;
        if (!name) return;
        // Try to parse the visible numbers
        var text = card.textContent.replace(/\s+/g, ' ');
        var balanceMatch = text.match(/Balance[\s:]*\$?([\d,]+\.?\d*)/i);
        var aprMatch = text.match(/APR[\s:]*([\d.]+)%/i) || text.match(/([\d.]+)%[\s]*APR/i);
        var minMatch = text.match(/Min[\.]?\s*Payment[\s:]*\$?([\d,]+\.?\d*)/i);
        var utilMatch = text.match(/Utilization[\s:]*([\d.]+)%/i);
        var statementsMatch = text.match(/(\d+)\s*statement/i);
        var data = {
          name: name,
          balance: balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : null,
          apr: aprMatch ? parseFloat(aprMatch[1]) : null,
          minPayment: minMatch ? parseFloat(minMatch[1].replace(/,/g, '')) : null,
          utilization: utilMatch ? parseFloat(utilMatch[1]) : null,
          statementCount: statementsMatch ? parseInt(statementsMatch[1], 10) : 0,
          debtId: id || ('name:' + name)
        };
        debtDataCache[data.debtId] = Object.assign(debtDataCache[data.debtId] || {}, data);
      } catch (_) {}
    });
  }

  // Also harvest from the Recurring Payments table rows
  function harvestFromTable() {
    var contents = document.querySelectorAll('.debts-subtab-content.active');
    contents.forEach(function (c) {
      var rows = c.querySelectorAll('tbody tr');
      rows.forEach(function (row) {
        if (row.classList && row.classList.contains('wjp-ri-detail')) return;
        var cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        var name = (cells[0] && cells[0].textContent || '').trim().replace(/\s*\(min payment\)\s*$/i, '').trim();
        var type = (cells[1] && cells[1].textContent || '').trim();
        var amountText = (cells[2] && cells[2].textContent || '');
        var amount = parseFloat(amountText.replace(/[^0-9.\-]/g, ''));
        if (!name) return;
        var key = 'name:' + name;
        debtDataCache[key] = Object.assign(debtDataCache[key] || {}, {
          name: name,
          type: type.toLowerCase(),
          minPayment: !isNaN(amount) ? Math.abs(amount) : null,
          debtId: key
        });
      });
    });
  }

  // Build AI breakdown for a debt-style tile
  function buildBreakdown(d) {
    var name = d.name;
    var min = d.minPayment || 0;
    var bal = d.balance || 0;
    var apr = d.apr || 0;
    var blocks = [];
    if (apr > 0 && bal > 0) {
      var monthlyInterest = (bal * apr / 100) / 12;
      var pctOfMin = min > 0 ? (monthlyInterest / min) * 100 : 0;
      blocks.push({
        h: 'What this is',
        p: name + ' is one of your debt accounts. The minimum payment is what your creditor needs each month — most of it goes to interest, not the balance.'
      });
      var meaningful;
      if (monthlyInterest > min * 0.7) {
        meaningful = 'About ' + Math.round(pctOfMin) + '% of your minimum payment is just covering interest. Almost none of it is actually paying down what you owe.';
      } else if (monthlyInterest > min * 0.4) {
        meaningful = 'Roughly ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest is going at the principal — but slowly.';
      } else {
        meaningful = 'About ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest chips away at the principal.';
      }
      blocks.push({
        h: 'Why it matters',
        p: 'At ' + apr + '% APR on ' + fmtUSD(bal) + ', this account costs you ' + fmtUSD(monthlyInterest) + ' every month in interest alone. ' + meaningful + ' That\'s ' + fmtUSD(monthlyInterest * 12) + '/year just to keep this account where it is.'
      });
      var extra = Math.max(20, Math.round(min * 0.5));
      blocks.push({
        h: 'What you can do',
        p: 'Add ' + fmtUSD(extra) + '/mo extra to this payment. Every dollar past the minimum goes 100% to the principal, which lowers next month\'s interest fee, which means even more of your payment chips away the next month. That\'s the snowball flipping in your favor.'
      });
    } else if (min > 0) {
      blocks.push({
        h: 'What this is',
        p: name + ' is a recurring expense at ' + fmtUSD(min) + '/mo (' + fmtUSD(min * 12) + '/year).'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'Recurring expenses are quiet. They keep flowing whether or not they earn their keep. ' + fmtUSD(min * 60) + ' over 5 years adds up.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Decide once a quarter: still using it, still cheapest option, still worth the price. If any answer is no, switch or cancel that day.'
      });
    } else {
      blocks.push({
        h: 'No data yet',
        p: 'Upload a recent statement to unlock the AI breakdown for this bill.'
      });
    }
    return blocks;
  }

  function openAiCoach(prompt) {
    try {
      if (window.WJP_ChatCore && typeof window.WJP_ChatCore.openWith === 'function') {
        window.WJP_ChatCore.openWith(prompt);
        return;
      }
      var fab = document.querySelector('.ai-coach-fab, [class*="ai-coach-fab"], #ai-coach-fab');
      if (fab) fab.click();
      setTimeout(function () {
        var input = document.querySelector('#ai-coach-input, [class*="ai-coach-input"] textarea, textarea[placeholder*="Ask"]');
        if (input) {
          input.value = prompt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          var sendBtn = document.querySelector('.ai-coach-send-btn, [class*="ai-coach-send"]');
          if (sendBtn) sendBtn.click();
        }
      }, 400);
    } catch (e) {}
  }

  function buildAiPrompt(d) {
    var bits = [d.name];
    if (d.balance) bits.push('balance ' + fmtUSD(d.balance));
    if (d.apr) bits.push(d.apr + '% APR');
    if (d.minPayment) bits.push('min payment ' + fmtUSD(d.minPayment));
    return 'Look at this account: ' + bits.join(', ') + '. In plain English using my real numbers, explain the cost over 1, 3, and 5 years if I keep paying just the minimum. Then give me 3 specific actions ranked by impact.';
  }

  // Statement upload: trigger the existing scan flow if available; otherwise
  // open a file input that uploads to the existing OCR pipeline.
  function openStatementUpload(d) {
    try {
      // Find an existing "Attach statement" button on the matching obligation card
      var obligationCards = document.querySelectorAll('[data-debt-id]');
      for (var i = 0; i < obligationCards.length; i++) {
        var card = obligationCards[i];
        var name = (card.querySelector('h3, h4, .debt-name, [class*="title"]') || {}).textContent;
        if (name && name.trim() === d.name) {
          var btn = card.querySelector('button, [role="button"]');
          // Look for the attach-statement specific button
          var btns = card.querySelectorAll('button');
          for (var j = 0; j < btns.length; j++) {
            if (/attach|statement|scan/i.test(btns[j].textContent || '')) {
              btns[j].click();
              return;
            }
          }
        }
      }
      // Fallback: invoke the global scan helper if available
      if (typeof window.openAttachStatementPicker === 'function' && d.debtId) {
        window.openAttachStatementPicker(d.debtId);
        return;
      }
      alert('Open the Debts \\u2192 Overview tab to attach a statement to this bill. Auto-scan from this view is coming soon.');
    } catch (e) {
      try { console.warn('[wjp-recurring-tiles] upload threw', e); } catch (_) {}
    }
  }

  function openEdit(d, tileEl) {
    var existing = tileEl.querySelector('.wjp-rt-edit-form');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('div');
    form.className = 'wjp-rt-edit-form';
    form.style.cssText = 'background:rgba(31,122,74,0.05);border:1px solid rgba(31,122,74,0.20);border-radius:10px;padding:12px;margin-top:10px;font-family:Inter,system-ui,sans-serif;';
    form.innerHTML = ''
      + '<div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:8px;">Edit scanned data</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
      +   '<label style="font-size:11px;color:#6b7280;">Balance<input type="number" step="0.01" value="' + (d.balance || '') + '" data-field="balance" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      +   '<label style="font-size:11px;color:#6b7280;">APR (%)<input type="number" step="0.01" value="' + (d.apr || '') + '" data-field="apr" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      +   '<label style="font-size:11px;color:#6b7280;">Min payment<input type="number" step="0.01" value="' + (d.minPayment || '') + '" data-field="minPayment" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      +   '<label style="font-size:11px;color:#6b7280;">Utilization (%)<input type="number" step="0.01" value="' + (d.utilization || '') + '" data-field="utilization" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      +   '<button type="button" class="wjp-rt-cancel" style="background:transparent;color:#6b7280;border:1px solid rgba(0,0,0,0.15);padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
      +   '<button type="button" class="wjp-rt-save" style="background:#1f7a4a;color:#fff;border:0;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>'
      + '</div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:8px;line-height:1.4;">Your edits update the AI breakdown above. To persist these changes to your master debt record, edit on the Debts \\u2192 Overview tile.</div>';
    tileEl.appendChild(form);
    form.querySelector('.wjp-rt-cancel').addEventListener('click', function () { form.remove(); });
    form.querySelector('.wjp-rt-save').addEventListener('click', function () {
      form.querySelectorAll('input').forEach(function (inp) {
        var f = inp.dataset.field;
        var v = parseFloat(inp.value);
        if (isFinite(v)) d[f] = v;
      });
      debtDataCache[d.debtId] = d;
      form.remove();
      tick(); // re-render
    });
  }

  function buildTile(d) {
    var tile = document.createElement('div');
    tile.dataset.wjpRtKey = d.debtId;
    tile.style.cssText = [
      'background:var(--card,#fff)',
      'border:1px solid var(--border,rgba(0,0,0,0.08))',
      'border-radius:14px',
      'padding:18px 20px',
      'font-family:Inter,system-ui,sans-serif',
      'color:var(--ink,#0a0a0a)',
      'box-shadow:0 1px 3px rgba(0,0,0,0.04)'
    ].join(';');

    // Header row: name + statements badge
    var header = ''
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;">'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="font-weight:700;font-size:15px;color:var(--ink,#0a0a0a);margin-bottom:3px;">' + d.name + '</div>'
      +     '<div style="font-size:11px;color:var(--ink-faint,#9ca3af);font-weight:600;letter-spacing:0.04em;">' + (d.type ? d.type.toUpperCase() : 'BILL') + '</div>'
      +   '</div>'
      +   (d.statementCount > 0 ? '<span style="font-size:10.5px;background:rgba(31,122,74,0.10);color:#1f7a4a;padding:3px 9px;border-radius:999px;font-weight:700;letter-spacing:0.02em;">' + d.statementCount + ' statement' + (d.statementCount > 1 ? 's' : '') + '</span>' : '<span style="font-size:10.5px;background:rgba(0,0,0,0.05);color:#9ca3af;padding:3px 9px;border-radius:999px;font-weight:700;letter-spacing:0.02em;">No statements</span>')
      + '</div>';

    // Numbers grid
    var stats = '';
    if (d.balance != null || d.apr != null || d.minPayment != null || d.utilization != null) {
      stats = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:14px;background:#fbf9f4;border-radius:10px;padding:10px 12px;">';
      if (d.balance != null) stats += '<div><div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;">Balance</div><div style="font-size:14px;font-weight:700;color:#0a0a0a;margin-top:2px;">' + fmtUSD(d.balance) + '</div></div>';
      if (d.apr != null) stats += '<div><div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;">APR</div><div style="font-size:14px;font-weight:700;color:' + (d.apr >= 20 ? '#dc2626' : '#0a0a0a') + ';margin-top:2px;">' + fmtPct(d.apr) + '</div></div>';
      if (d.minPayment != null) stats += '<div><div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;">Min/mo</div><div style="font-size:14px;font-weight:700;color:#0a0a0a;margin-top:2px;">' + fmtUSD(d.minPayment) + '</div></div>';
      if (d.utilization != null) stats += '<div><div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;">Util.</div><div style="font-size:14px;font-weight:700;color:' + (d.utilization >= 80 ? '#dc2626' : d.utilization >= 30 ? '#c99a2a' : '#1f7a4a') + ';margin-top:2px;">' + fmtPct(d.utilization) + '</div></div>';
      stats += '</div>';
    }

    // AI breakdown blocks (always visible)
    var blocks = buildBreakdown(d);
    var bd = '<div style="border-left:3px solid #1f7a4a;padding:6px 14px;background:rgba(31,122,74,0.04);border-radius:0 8px 8px 0;margin-bottom:12px;">';
    bd += '<div style="font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:6px;">AI breakdown</div>';
    blocks.forEach(function (b) {
      bd += '<div style="margin-bottom:8px;">'
        + '<div style="font-size:11.5px;font-weight:800;color:#1f7a4a;margin-bottom:2px;letter-spacing:0.02em;">' + b.h + '</div>'
        + '<div style="font-size:13px;color:#1a1a1a;line-height:1.55;">' + b.p + '</div>'
        + '</div>';
    });
    bd += '</div>';

    // Action row
    var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    actions += '<button type="button" class="wjp-rt-upload" style="background:#1f7a4a;color:#fff;border:0;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📎 Upload statement</button>';
    actions += '<button type="button" class="wjp-rt-edit" style="background:rgba(255,255,255,0.92);color:#0a0a0a;border:1px solid rgba(0,0,0,0.15);padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">✏️ Edit</button>';
    actions += '<button type="button" class="wjp-rt-ask" style="background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(201,154,42,0.06));color:#1f7a4a;border:1px solid rgba(31,122,74,0.25);padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">💬 Ask AI Coach</button>';
    actions += '</div>';

    tile.innerHTML = header + stats + bd + actions;
    tile.querySelector('.wjp-rt-upload').addEventListener('click', function () { openStatementUpload(d); });
    tile.querySelector('.wjp-rt-edit').addEventListener('click', function () { openEdit(d, tile); });
    tile.querySelector('.wjp-rt-ask').addEventListener('click', function () { openAiCoach(buildAiPrompt(d)); });
    return tile;
  }

  function findRecurringTabContent() {
    var contents = document.querySelectorAll('.debts-subtab-content.active');
    if (!contents.length) return null;
    // Confirm we're in the Recurring Payments sub-tab — its content should
    // include the "Recurring Payments" heading or the recurring filter pills.
    for (var i = 0; i < contents.length; i++) {
      var t = contents[i].textContent || '';
      if (/recurring\s+payments/i.test(t) || /total\s+monthly/i.test(t)) {
        return contents[i];
      }
    }
    return null;
  }

  function tick() {
    try {
      harvestDebtsFromObligations();
      harvestFromTable();

      var content = findRecurringTabContent();
      if (!content) {
        var existing = document.getElementById(WRAP_ID);
        if (existing) existing.remove();
        return;
      }

      var debts = Object.values(debtDataCache).filter(function (d) {
        // Show as a tile if we have at least balance OR (apr + min); otherwise it's a sub/util/etc.
        return d.balance != null || (d.apr != null) || (d.type && d.type.indexOf('debt') !== -1);
      });
      if (!debts.length) return;

      var grid = document.getElementById(WRAP_ID);
      if (!grid || grid.parentElement !== content) {
        if (grid) try { grid.remove(); } catch (_) {}
        grid = document.createElement('div');
        grid.id = WRAP_ID;
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin:6px 0 22px;font-family:Inter,system-ui,sans-serif;';
        // Insert near the top, after the stats bar
        var statsBar = content.querySelector('#rec-stats-bar') || content.firstElementChild;
        if (statsBar && statsBar.nextSibling) {
          content.insertBefore(grid, statsBar.nextSibling);
        } else {
          content.insertBefore(grid, content.firstChild);
        }
        // Heading above
        var heading = document.createElement('div');
        heading.id = 'wjp-rt-heading';
        heading.style.cssText = 'margin:18px 0 12px;font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:var(--ink,#0a0a0a);';
        heading.innerHTML = 'Your bills explained <span style="font-family:Inter,system-ui,sans-serif;font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;background:rgba(0,0,0,0.04);padding:3px 9px;border-radius:999px;margin-left:8px;">Detail view</span>';
        var existingHeading = document.getElementById('wjp-rt-heading');
        if (existingHeading) existingHeading.remove();
        grid.parentNode.insertBefore(heading, grid);
      }

      // Re-render tiles
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      debts.forEach(function (d) { grid.appendChild(buildTile(d)); });
    } catch (e) {
      try { console.warn('[wjp-recurring-tiles] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_RecurringTiles = { refresh: tick, _cache: debtDataCache };
})();
