/* wjp-recurring-tiles.js v2 — all recurring items as collapsible accordion tiles.
 *
 * Compact-by-default: name + type + amount + chevron. Click → expands with
 * AI breakdown + actions. Click again → collapses. Dense grid fits everything.
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
  var expandedKeys = new Set ? new Set() : { _s: {}, has: function(k){return !!this._s[k];}, add: function(k){this._s[k]=1;}, delete: function(k){delete this._s[k];} };
  // Polyfill Set for older safari
  if (typeof Set === 'undefined') expandedKeys = { _s: {}, has: function(k){return !!this._s[k];}, add: function(k){this._s[k]=1;}, delete: function(k){delete this._s[k];} };

  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return '-';
    return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function fmtPct(n) { if (!isFinite(n)) return '-'; return Math.round(n * 100) / 100 + '%'; }

  // Harvest debt data from Current Obligations cards (Debts Overview)
  function harvestDebtsFromObligations() {
    var cards = document.querySelectorAll('[data-debt-id], .debt-card, .obligation-card');
    cards.forEach(function (card) {
      try {
        var id = card.dataset.debtId || (card.querySelector('[data-debt-id]') ? card.querySelector('[data-debt-id]').dataset.debtId : null);
        var nameEl = card.querySelector('.debt-name, .obligation-name, h3, h4, [class*="title"]');
        var name = nameEl ? nameEl.textContent.trim() : null;
        if (!name) return;
        var text = card.textContent.replace(/\s+/g, ' ');
        var balanceMatch = text.match(/Balance[\s:]*\$?([\d,]+\.?\d*)/i);
        var aprMatch = text.match(/APR[\s:]*([\d.]+)%/i) || text.match(/([\d.]+)%[\s]*APR/i);
        var minMatch = text.match(/Min[\.]?\s*Payment[\s:]*\$?([\d,]+\.?\d*)/i);
        var utilMatch = text.match(/Utilization[\s:]*([\d.]+)%/i);
        var statementsMatch = text.match(/(\d+)\s*statement/i);
        var key = id || ('name:' + name);
        debtDataCache[key] = Object.assign(debtDataCache[key] || {}, {
          name: name,
          type: 'debt',
          balance: balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : (debtDataCache[key]||{}).balance || null,
          apr: aprMatch ? parseFloat(aprMatch[1]) : (debtDataCache[key]||{}).apr || null,
          minPayment: minMatch ? parseFloat(minMatch[1].replace(/,/g, '')) : (debtDataCache[key]||{}).minPayment || null,
          utilization: utilMatch ? parseFloat(utilMatch[1]) : (debtDataCache[key]||{}).utilization || null,
          statementCount: statementsMatch ? parseInt(statementsMatch[1], 10) : 0,
          debtId: key
        });
      } catch (_) {}
    });
  }

  // Harvest from Recurring Payments table — every row, all categories
  function harvestFromTable() {
    var contents = document.querySelectorAll('.debts-subtab-content.active');
    contents.forEach(function (c) {
      var rows = c.querySelectorAll('tbody tr');
      rows.forEach(function (row) {
        if (row.classList && row.classList.contains('wjp-ri-detail')) return;
        var cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        var name = (cells[0] && cells[0].textContent || '').trim().replace(/\s*\(min payment\)\s*$/i, '').trim();
        var typeRaw = (cells[1] && cells[1].textContent || '').trim();
        var amountText = (cells[2] && cells[2].textContent || '');
        var amount = parseFloat(amountText.replace(/[^0-9.\-]/g, ''));
        if (!name) return;
        var key = 'name:' + name;
        debtDataCache[key] = Object.assign(debtDataCache[key] || {}, {
          name: name,
          type: typeRaw.toLowerCase() || (debtDataCache[key]||{}).type || 'recurring',
          minPayment: !isNaN(amount) ? Math.abs(amount) : (debtDataCache[key]||{}).minPayment || null,
          debtId: key
        });
      });
    });
  }

  function buildBreakdown(d) {
    var name = d.name;
    var min = d.minPayment || 0;
    var bal = d.balance || 0;
    var apr = d.apr || 0;
    var blocks = [];
    if ((d.type === 'debt') && apr > 0 && bal > 0) {
      var monthlyInterest = (bal * apr / 100) / 12;
      var pctOfMin = min > 0 ? (monthlyInterest / min) * 100 : 0;
      blocks.push({ h: 'What this is', p: name + ' is one of your debt accounts. The minimum payment is what your creditor needs each month \\u2014 most of it goes to interest, not the balance.' });
      var meaningful = monthlyInterest > min * 0.7
        ? 'About ' + Math.round(pctOfMin) + '% of your minimum payment is just covering interest. Almost none of it is actually paying down what you owe.'
        : monthlyInterest > min * 0.4
          ? 'Roughly ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest is going at the principal \\u2014 but slowly.'
          : 'About ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest chips away at the principal.';
      blocks.push({ h: 'Why it matters', p: 'At ' + apr + '% APR on ' + fmtUSD(bal) + ', this account costs you ' + fmtUSD(monthlyInterest) + ' every month in interest alone. ' + meaningful + ' That\\u2019s ' + fmtUSD(monthlyInterest * 12) + '/year just to keep this account where it is.' });
      var extra = Math.max(20, Math.round(min * 0.5));
      blocks.push({ h: 'What you can do', p: 'Add ' + fmtUSD(extra) + '/mo extra to this payment. Every dollar past the minimum goes 100% to the principal, which lowers next month\\u2019s interest fee, which means even more of your payment chips away the next month. That\\u2019s the snowball flipping in your favor.' });
    } else if (d.type === 'subscription' || /subscription/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is a recurring subscription \\u2014 charged automatically every month or year whether you use it or not.' });
      blocks.push({ h: 'Why it matters', p: 'You\\u2019re paying ' + fmtUSD(min) + '/mo for this. Over a year that\\u2019s ' + fmtUSD(min * 12) + '. Over five years, ' + fmtUSD(min * 60) + '. Money that could go straight to debt instead.' });
      blocks.push({ h: 'What you can do', p: 'Open the app once. If you haven\\u2019t used it in 60 days, cancel it. If you use it but rarely, look for a cheaper tier. 2 minutes through the service\\u2019s website beats hiring a cancellation service.' });
    } else if (d.type === 'utility' || /utility|gas|electric|water|internet/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is a utility bill \\u2014 essentials like electricity, gas, water, internet that you can\\u2019t cancel but you can sometimes lower.' });
      blocks.push({ h: 'Why it matters', p: 'You\\u2019re spending ' + fmtUSD(min) + '/mo on this, ' + fmtUSD(min * 12) + ' a year. Utilities are typically 5-10% of monthly income for most households \\u2014 worth knowing your share.' });
      blocks.push({ h: 'What you can do', p: 'Three things move the needle: shop your provider every 12-18 months (a 10-min call often saves $10-20/mo), check your usage trend, bundle services if it gets you a real discount.' });
    } else if (d.type === 'insurance' || /insurance/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is an insurance premium \\u2014 the price of protecting yourself from a bigger expense.' });
      blocks.push({ h: 'Why it matters', p: 'You\\u2019re paying ' + fmtUSD(min) + '/mo \\u2014 ' + fmtUSD(min * 12) + '/yr. Insurance gets more expensive every year if you don\\u2019t shop. Loyalty pricing is real.' });
      blocks.push({ h: 'What you can do', p: 'Get one comparison quote every 12 months. 5-10 min online. If lower, ask your current provider to match. Most do. People save $200-600/year doing this annually.' });
    } else if (d.type === 'income' || /income|paycheck/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is income hitting your account on a recurring schedule.' });
      blocks.push({ h: 'Why it matters', p: 'You\\u2019re bringing in roughly ' + fmtUSD(min) + ' from this source. Every dollar of income not committed to bills can fund your debt-free date or get spent.' });
      blocks.push({ h: 'What you can do', p: 'Set up an auto-transfer so part of every paycheck goes straight to your highest-APR debt the day you get paid. Pay debt FIRST, not LAST.' });
    } else {
      blocks.push({ h: 'What this is', p: name + ' is a recurring expense \\u2014 ' + fmtUSD(min) + '/mo, ' + fmtUSD(min * 12) + '/yr.' });
      blocks.push({ h: 'Why it matters', p: 'Recurring expenses are the leakiest part of most budgets. Predictable, easy to forget, easy to overpay for.' });
      blocks.push({ h: 'What you can do', p: 'Once a quarter, look at every recurring charge. Do I still need it, get good value, is there a cheaper option? You\\u2019ll usually find $30-100/mo to cut.' });
    }
    return blocks;
  }

  function openAiCoach(prompt) {
    try {
      if (window.WJP_ChatCore && typeof window.WJP_ChatCore.openWith === 'function') {
        window.WJP_ChatCore.openWith(prompt); return;
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
    if (d.minPayment) bits.push(fmtUSD(d.minPayment) + '/mo');
    if (d.type) bits.push('type: ' + d.type);
    return 'Look at this account: ' + bits.join(', ') + '. In plain English using my real numbers, explain the cost over 1, 3, and 5 years if I keep paying just the current amount. Then give me 3 specific actions ranked by impact.';
  }

  function openStatementUpload(d) {
    try {
      var obligationCards = document.querySelectorAll('[data-debt-id]');
      for (var i = 0; i < obligationCards.length; i++) {
        var card = obligationCards[i];
        var nm = (card.querySelector('h3, h4, .debt-name, [class*="title"]') || {}).textContent;
        if (nm && nm.trim() === d.name) {
          var btns = card.querySelectorAll('button');
          for (var j = 0; j < btns.length; j++) {
            if (/attach|statement|scan/i.test(btns[j].textContent || '')) { btns[j].click(); return; }
          }
        }
      }
      if (typeof window.openAttachStatementPicker === 'function' && d.debtId) {
        window.openAttachStatementPicker(d.debtId); return;
      }
      alert('Visit the Debts \\u2192 Overview tab to attach a statement to this bill.');
    } catch (e) {}
  }

  function openEdit(d, tileEl) {
    var existing = tileEl.querySelector('.wjp-rt-edit-form');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('div');
    form.className = 'wjp-rt-edit-form';
    form.style.cssText = 'background:rgba(31,122,74,0.05);border:1px solid rgba(31,122,74,0.20);border-radius:10px;padding:12px;margin-top:10px;font-family:Inter,system-ui,sans-serif;';
    form.innerHTML = ''
      + '<div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:8px;">Edit data</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
      +   '<label style="font-size:11px;color:#6b7280;">Balance<input type="number" step="0.01" value="' + (d.balance || '') + '" data-field="balance" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      +   '<label style="font-size:11px;color:#6b7280;">APR (%)<input type="number" step="0.01" value="' + (d.apr || '') + '" data-field="apr" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      +   '<label style="font-size:11px;color:#6b7280;">Min/mo<input type="number" step="0.01" value="' + (d.minPayment || '') + '" data-field="minPayment" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      +   '<label style="font-size:11px;color:#6b7280;">Utilization (%)<input type="number" step="0.01" value="' + (d.utilization || '') + '" data-field="utilization" style="width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;"></label>'
      + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      +   '<button type="button" class="wjp-rt-cancel" style="background:transparent;color:#6b7280;border:1px solid rgba(0,0,0,0.15);padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
      +   '<button type="button" class="wjp-rt-save" style="background:#1f7a4a;color:#fff;border:0;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>'
      + '</div>';
    tileEl.appendChild(form);
    form.querySelector('.wjp-rt-cancel').addEventListener('click', function (e) { e.stopPropagation(); form.remove(); });
    form.querySelector('.wjp-rt-save').addEventListener('click', function (e) {
      e.stopPropagation();
      form.querySelectorAll('input').forEach(function (inp) {
        var f = inp.dataset.field;
        var v = parseFloat(inp.value);
        if (isFinite(v)) d[f] = v;
      });
      debtDataCache[d.debtId] = d;
      form.remove();
      tick();
    });
    form.addEventListener('click', function(e){ e.stopPropagation(); }); // don't toggle when clicking inside form
  }

  function badgeForType(type) {
    var t = (type || '').toLowerCase();
    var color = '#9ca3af', bg = 'rgba(0,0,0,0.05)', label = (type||'BILL').toUpperCase();
    if (t.indexOf('debt') !== -1) { color = '#dc2626'; bg = 'rgba(220,38,38,0.10)'; label = 'DEBT'; }
    else if (t.indexOf('subscription') !== -1) { color = '#7c3aed'; bg = 'rgba(124,58,237,0.10)'; label = 'SUB'; }
    else if (t.indexOf('utility') !== -1) { color = '#0284c7'; bg = 'rgba(2,132,199,0.10)'; label = 'UTILITY'; }
    else if (t.indexOf('insurance') !== -1) { color = '#c99a2a'; bg = 'rgba(201,154,42,0.10)'; label = 'INSURE'; }
    else if (t.indexOf('income') !== -1) { color = '#1f7a4a'; bg = 'rgba(31,122,74,0.10)'; label = 'INCOME'; }
    return { color: color, bg: bg, label: label };
  }

  function buildTile(d) {
    var isExpanded = expandedKeys.has(d.debtId);
    var tile = document.createElement('div');
    tile.dataset.wjpRtKey = d.debtId;
    tile.style.cssText = [
      'background:var(--card,#fff)',
      'border:1px solid ' + (isExpanded ? 'rgba(31,122,74,0.45)' : 'var(--border,rgba(0,0,0,0.08))'),
      'border-radius:12px',
      'padding:0',
      'font-family:Inter,system-ui,sans-serif',
      'color:var(--ink,#0a0a0a)',
      'transition:border-color .15s, box-shadow .15s',
      'box-shadow:' + (isExpanded ? '0 4px 14px rgba(31,122,74,0.10)' : '0 1px 3px rgba(0,0,0,0.04)'),
      'cursor:pointer',
      'overflow:hidden'
    ].join(';');

    var b = badgeForType(d.type);
    var amount = d.minPayment != null ? fmtUSD(d.minPayment) : (d.balance != null ? fmtUSD(d.balance) : '-');

    // Compact header — always visible
    var header = ''
      + '<div class="wjp-rt-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;">'
      +   '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;">'
      +     '<span style="font-size:9.5px;letter-spacing:0.10em;background:' + b.bg + ';color:' + b.color + ';padding:3px 7px;border-radius:999px;font-weight:800;flex-shrink:0;">' + b.label + '</span>'
      +     '<span style="font-weight:600;font-size:13.5px;color:var(--ink,#0a0a0a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</span>'
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
      +     '<span style="font-weight:700;font-size:13px;color:var(--ink,#0a0a0a);">' + amount + (d.minPayment ? '/mo' : '') + '</span>'
      +     '<span class="wjp-rt-chev" style="color:#9ca3af;font-size:11px;font-weight:700;transition:transform .2s;transform:rotate(' + (isExpanded ? '180deg' : '0deg') + ');">\\u25BC</span>'
      +   '</div>'
      + '</div>';

    var body = '';
    if (isExpanded) {
      // Stats row (only if numbers exist)
      var stats = '';
      if (d.balance != null || d.apr != null || d.utilization != null) {
        stats = '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 10px;">';
        if (d.balance != null) stats += '<span style="font-size:11px;color:#6b7280;background:#fbf9f4;padding:4px 10px;border-radius:6px;"><b style="color:#0a0a0a;">' + fmtUSD(d.balance) + '</b> balance</span>';
        if (d.apr != null) stats += '<span style="font-size:11px;color:#6b7280;background:#fbf9f4;padding:4px 10px;border-radius:6px;"><b style="color:' + (d.apr >= 20 ? '#dc2626' : '#0a0a0a') + ';">' + fmtPct(d.apr) + '</b> APR</span>';
        if (d.utilization != null) stats += '<span style="font-size:11px;color:#6b7280;background:#fbf9f4;padding:4px 10px;border-radius:6px;"><b style="color:' + (d.utilization >= 80 ? '#dc2626' : d.utilization >= 30 ? '#c99a2a' : '#1f7a4a') + ';">' + fmtPct(d.utilization) + '</b> util</span>';
        stats += '</div>';
      }
      // AI breakdown
      var blocks = buildBreakdown(d);
      var bd = '<div style="border-left:3px solid #1f7a4a;padding:10px 14px;background:rgba(31,122,74,0.04);margin:0 14px;border-radius:0 8px 8px 0;">';
      bd += '<div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:6px;">AI breakdown</div>';
      blocks.forEach(function (bl) {
        bd += '<div style="margin-bottom:7px;">'
          + '<div style="font-size:11px;font-weight:800;color:#1f7a4a;margin-bottom:2px;letter-spacing:0.02em;">' + bl.h + '</div>'
          + '<div style="font-size:12.5px;color:#1a1a1a;line-height:1.5;">' + bl.p + '</div>'
          + '</div>';
      });
      bd += '</div>';
      // Action row
      var actions = '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px 14px;">';
      actions += '<button type="button" class="wjp-rt-upload" style="background:#1f7a4a;color:#fff;border:0;padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">📎 Upload statement</button>';
      actions += '<button type="button" class="wjp-rt-edit" style="background:rgba(255,255,255,0.92);color:#0a0a0a;border:1px solid rgba(0,0,0,0.15);padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">✏️ Edit</button>';
      actions += '<button type="button" class="wjp-rt-ask" style="background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(201,154,42,0.06));color:#1f7a4a;border:1px solid rgba(31,122,74,0.25);padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">💬 Ask AI Coach</button>';
      actions += '</div>';
      body = stats + bd + actions;
    }

    tile.innerHTML = header + body;

    // Toggle on click anywhere on the tile (except inside action buttons / edit form)
    tile.addEventListener('click', function (e) {
      // Ignore clicks on actions / edit form elements (they bubble; we stop propagation in their handlers)
      if (e.target.closest('.wjp-rt-upload, .wjp-rt-edit, .wjp-rt-ask, .wjp-rt-edit-form, .wjp-rt-cancel, .wjp-rt-save')) return;
      if (expandedKeys.has(d.debtId)) expandedKeys.delete(d.debtId);
      else expandedKeys.add(d.debtId);
      tick();
    });

    if (isExpanded) {
      var up = tile.querySelector('.wjp-rt-upload');
      var ed = tile.querySelector('.wjp-rt-edit');
      var ask = tile.querySelector('.wjp-rt-ask');
      if (up) up.addEventListener('click', function (e) { e.stopPropagation(); openStatementUpload(d); });
      if (ed) ed.addEventListener('click', function (e) { e.stopPropagation(); openEdit(d, tile); });
      if (ask) ask.addEventListener('click', function (e) { e.stopPropagation(); openAiCoach(buildAiPrompt(d)); });
    }
    return tile;
  }

  function findRecurringTabContent() {
    var contents = document.querySelectorAll('.debts-subtab-content.active');
    for (var i = 0; i < contents.length; i++) {
      var t = contents[i].textContent || '';
      if (/recurring\s+payments/i.test(t) || /total\s+monthly/i.test(t)) return contents[i];
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
        var heading = document.getElementById('wjp-rt-heading');
        if (heading) heading.remove();
        return;
      }

      // Show ALL items (not just debts)
      var items = Object.values(debtDataCache).filter(function (d) {
        return d.name && (d.minPayment != null || d.balance != null);
      });
      if (!items.length) return;

      // Sort: debts first (highest APR), then everything else by amount desc
      items.sort(function (a, b) {
        var aIsDebt = (a.type || '').indexOf('debt') !== -1 ? 1 : 0;
        var bIsDebt = (b.type || '').indexOf('debt') !== -1 ? 1 : 0;
        if (aIsDebt !== bIsDebt) return bIsDebt - aIsDebt;
        if (aIsDebt) return (b.apr || 0) - (a.apr || 0);
        return (b.minPayment || 0) - (a.minPayment || 0);
      });

      var grid = document.getElementById(WRAP_ID);
      if (!grid || grid.parentElement !== content) {
        if (grid) try { grid.remove(); } catch (_) {}
        grid = document.createElement('div');
        grid.id = WRAP_ID;
        // Dense 2-column grid; tile heights vary based on expanded state
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:8px;margin:6px 0 22px;font-family:Inter,system-ui,sans-serif;align-items:start;';
        var statsBar = content.querySelector('#rec-stats-bar') || content.firstElementChild;
        if (statsBar && statsBar.nextSibling) content.insertBefore(grid, statsBar.nextSibling);
        else content.insertBefore(grid, content.firstChild);
        var heading = document.createElement('div');
        heading.id = 'wjp-rt-heading';
        heading.style.cssText = 'margin:18px 0 10px;font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:var(--ink,#0a0a0a);';
        heading.innerHTML = 'Your bills explained <span style="font-family:Inter,system-ui,sans-serif;font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;background:rgba(0,0,0,0.04);padding:3px 9px;border-radius:999px;margin-left:8px;">Click any bill to expand</span>';
        var existingHeading = document.getElementById('wjp-rt-heading');
        if (existingHeading) existingHeading.remove();
        grid.parentNode.insertBefore(heading, grid);
      }

      while (grid.firstChild) grid.removeChild(grid.firstChild);
      items.forEach(function (d) { grid.appendChild(buildTile(d)); });
    } catch (e) {
      try { console.warn('[wjp-recurring-tiles v2] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WJP_RecurringTiles = { refresh: tick, _cache: debtDataCache };
})();
