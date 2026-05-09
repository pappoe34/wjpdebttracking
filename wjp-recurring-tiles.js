/* wjp-recurring-tiles.js v4.1 — all 12 debts + Unicode literal escape fix.
 *
 * v2 problems:
 *   1. Only showed 6 tiles — used DOM scraping that only finds visible cards.
 *      Now uses calculateDebtPayoff() for the canonical 12-debt list and
 *      pulls balance from card text via dual regex.
 *   2. Rendered "▼" as literal text in HTML — strings used \\u escapes
 *      which encode as text, not the Unicode char. Fixed throughout.
 *
 * Tiles are accordion (compact name+amount+chevron, click to expand).
 * Expanded shows balance/APR/util chips, AI breakdown, and action buttons.
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
  var expandedKeys = (typeof Set !== 'undefined') ? new Set()
    : { _s: {}, has: function(k){return !!this._s[k];}, add: function(k){this._s[k]=1;}, delete: function(k){delete this._s[k];} };

  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return '-';
    return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function fmtPct(n) { if (!isFinite(n)) return '-'; return Math.round(n * 100) / 100 + '%'; }

  function extractBalance(text) {
    text = text.replace(/\s+/g, ' ');
    var m = text.match(/\$([\d,]+(?:\.\d+)?)\s*left/i);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    m = text.match(/Balance\s*\$([\d,]+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    return null;
  }
  function extractName(node, text) {
    var nameEl = node.querySelector('.obligation-name, .debt-name, h3, h4');
    if (nameEl && nameEl.textContent.trim()) return nameEl.textContent.trim();
    var stripped = text.replace(/^(Priority|Autopay|\d+)\s+/i, '');
    var m = stripped.match(/^(.+?)\s+(Managed Liability|\d+(?:\.\d+)?%\s+APR)/i);
    return m ? m[1].trim() : null;
  }
  function extractUtilization(text) {
    text = text.replace(/\s+/g, ' ');
    var m = text.match(/Utilization\s*([\d.]+)%/i);
    return m ? parseFloat(m[1]) : null;
  }

  // Harvest ALL 12 debts via calculateDebtPayoff + DOM merge
  function harvestDebts() {
    if (typeof window.calculateDebtPayoff !== 'function') return;
    var calc;
    try { calc = window.calculateDebtPayoff('avalanche'); } catch (_) { return; }
    if (!calc || typeof calc !== 'object') return;
    var domMap = {};
    document.querySelectorAll('[data-debt-id]').forEach(function (n) {
      var id = n.dataset.debtId; if (!id) return;
      if (!domMap[id]) domMap[id] = { name: null, balance: null, utilization: null };
      var slot = domMap[id];
      var text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!slot.name) slot.name = extractName(n, text);
      if (slot.balance == null) slot.balance = extractBalance(text);
      if (slot.utilization == null) slot.utilization = extractUtilization(text);
    });
    Object.keys(calc).forEach(function (id) {
      var e = calc[id] || {};
      var dom = domMap[id] || {};
      debtDataCache[id] = {
        debtId: id,
        name: dom.name || ('Debt ' + id.slice(-6)),
        type: 'debt',
        balance: dom.balance != null ? dom.balance : (e.balance || null),
        apr: e.apr || null,
        minPayment: e.min || null,
        utilization: dom.utilization,
        months: e.months,
        totalInterest: e.totalInterest
      };
    });
  }

  // Strip recurring-table cruft from a name. Rows often look like
  // "Avant Credit Card (min payment) Debt" — both suffixes need to go.
  function normalizeRecurringName(s) {
    if (!s) return '';
    return s
      .replace(/\s*\(min payment\)\s*/gi, ' ')
      .replace(/\s+Debt\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function looksLikeDateRow(s) {
    return /^[A-Z]{3,9}\s+\d{1,2},?\s+\d{4}/i.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s);
  }

  // Harvest non-debt recurring items from the recurring table
  function harvestFromTable() {
    var contents = document.querySelectorAll('.debts-subtab-content');
    contents.forEach(function (c) {
      var rows = c.querySelectorAll('tbody tr');
      rows.forEach(function (row) {
        if (row.classList && row.classList.contains('wjp-ri-detail')) return;
        var cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        var firstCell = (cells[0] && cells[0].textContent || '').trim();
        var rawName = normalizeRecurringName(firstCell);
        if (!rawName || looksLikeDateRow(rawName) || looksLikeDateRow(firstCell)) return;
        // Filter out names that are obviously debt rows already covered
        // (covers "(min payment) Debt" → normalized to debt name match)
        var typeRaw = (cells[1] && cells[1].textContent || '').trim().toLowerCase();
        var amountText = (cells[2] && cells[2].textContent || '');
        var amount = parseFloat(amountText.replace(/[^0-9.\-]/g, ''));
        var existsAsDebt = Object.values(debtDataCache).some(function (d) {
          if (d.type !== 'debt' || !d.name) return false;
          return d.name.toLowerCase() === rawName.toLowerCase()
              || rawName.toLowerCase().indexOf(d.name.toLowerCase()) !== -1
              || d.name.toLowerCase().indexOf(rawName.toLowerCase()) !== -1;
        });
        if (existsAsDebt) return;
        // Drop debt-typed rows we couldn't match — better to under-show than dupe
        if (typeRaw === 'debt') return;
        var key = 'rec:' + rawName;
        debtDataCache[key] = Object.assign(debtDataCache[key] || {}, {
          debtId: key,
          name: rawName,
          type: typeRaw || 'recurring',
          minPayment: !isNaN(amount) ? Math.abs(amount) : (debtDataCache[key] || {}).minPayment || null,
          balance: (debtDataCache[key] || {}).balance || null,
          apr: (debtDataCache[key] || {}).apr || null
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
    if (d.type === 'debt' && apr > 0 && bal > 0) {
      var monthlyInterest = (bal * apr / 100) / 12;
      var pctOfMin = min > 0 ? (monthlyInterest / min) * 100 : 0;
      blocks.push({ h: 'What this is', p: name + ' is one of your debt accounts. The minimum payment is what your creditor needs each month — most of it goes to interest, not the balance.' });
      var meaningful = monthlyInterest > min * 0.7
        ? 'About ' + Math.round(pctOfMin) + '% of your minimum payment is just covering interest. Almost none of it is actually paying down what you owe.'
        : monthlyInterest > min * 0.4
          ? 'Roughly ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest is going at the principal — but slowly.'
          : 'About ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest chips away at the principal.';
      blocks.push({ h: 'Why it matters', p: 'At ' + apr + '% APR on ' + fmtUSD(bal) + ', this account costs you ' + fmtUSD(monthlyInterest) + ' every month in interest alone. ' + meaningful + ' That’s ' + fmtUSD(monthlyInterest * 12) + '/year just to keep this account where it is.' });
      var extra = Math.max(20, Math.round(min * 0.5));
      blocks.push({ h: 'What you can do', p: 'Add ' + fmtUSD(extra) + '/mo extra to this payment. Every dollar past the minimum goes 100% to the principal, which lowers next month’s interest fee, which means even more of your payment chips away the next month. That’s the snowball flipping in your favor.' });
    } else if (d.type === 'subscription' || /subscription/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is a recurring subscription — charged automatically every month or year whether you use it or not.' });
      blocks.push({ h: 'Why it matters', p: 'You’re paying ' + fmtUSD(min) + '/mo for this. Over a year that’s ' + fmtUSD(min * 12) + '. Over five years, ' + fmtUSD(min * 60) + '. Money that could go straight to debt instead.' });
      blocks.push({ h: 'What you can do', p: 'Open the app once. If you haven’t used it in 60 days, cancel it. If you use it but rarely, look for a cheaper tier. 2 minutes through the service’s website beats hiring a cancellation service.' });
    } else if (d.type === 'utility' || /utility|gas|electric|water|internet/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is a utility bill — essentials like electricity, gas, water, internet that you can’t cancel but you can sometimes lower.' });
      blocks.push({ h: 'Why it matters', p: 'You’re spending ' + fmtUSD(min) + '/mo on this, ' + fmtUSD(min * 12) + ' a year. Utilities are typically 5-10% of monthly income for most households — worth knowing your share.' });
      blocks.push({ h: 'What you can do', p: 'Three things move the needle: shop your provider every 12-18 months (a 10-min call often saves $10-20/mo), check your usage trend, bundle services if it gets you a real discount.' });
    } else if (d.type === 'insurance' || /insurance/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is an insurance premium — the price of protecting yourself from a bigger expense.' });
      blocks.push({ h: 'Why it matters', p: 'You’re paying ' + fmtUSD(min) + '/mo — ' + fmtUSD(min * 12) + '/yr. Insurance gets more expensive every year if you don’t shop. Loyalty pricing is real.' });
      blocks.push({ h: 'What you can do', p: 'Get one comparison quote every 12 months. 5-10 min online. If lower, ask your current provider to match. Most do. People save $200-600/year doing this annually.' });
    } else if (d.type === 'income' || /income|paycheck/i.test(name)) {
      blocks.push({ h: 'What this is', p: name + ' is income hitting your account on a recurring schedule.' });
      blocks.push({ h: 'Why it matters', p: 'You’re bringing in roughly ' + fmtUSD(min) + ' from this source. Every dollar of income not committed to bills can fund your debt-free date or get spent.' });
      blocks.push({ h: 'What you can do', p: 'Set up an auto-transfer so part of every paycheck goes straight to your highest-APR debt the day you get paid. Pay debt FIRST, not LAST.' });
    } else {
      blocks.push({ h: 'What this is', p: name + ' is a recurring expense — ' + fmtUSD(min) + '/mo, ' + fmtUSD(min * 12) + '/yr.' });
      blocks.push({ h: 'Why it matters', p: 'Recurring expenses are the leakiest part of most budgets. Predictable, easy to forget, easy to overpay for.' });
      blocks.push({ h: 'What you can do', p: 'Once a quarter, look at every recurring charge. Do I still need it, get good value, is there a cheaper option? You’ll usually find $30-100/mo to cut.' });
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
      if (typeof window.openAttachStatementPicker === 'function' && d.debtId && d.type === 'debt') {
        window.openAttachStatementPicker(d.debtId); return;
      }
      var obligationCards = document.querySelectorAll('[data-debt-id="' + d.debtId + '"]');
      for (var i = 0; i < obligationCards.length; i++) {
        var btns = obligationCards[i].querySelectorAll('button');
        for (var j = 0; j < btns.length; j++) {
          if (/attach|statement|scan/i.test(btns[j].textContent || '')) { btns[j].click(); return; }
        }
      }
      alert('Visit the Debts → Overview tab to attach a statement to this bill.');
    } catch (e) {}
  }

  function openEdit(d, tileEl) {
    var existing = tileEl.querySelector('.wjp-rt-edit-form');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('div');
    form.className = 'wjp-rt-edit-form';
    form.style.cssText = 'background:rgba(31,122,74,0.05);border:1px solid rgba(31,122,74,0.20);border-radius:10px;padding:12px;margin:0 14px 12px;font-family:var(--sans,Inter,system-ui,sans-serif);';
    form.innerHTML = ''
      + '<div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:8px;">Edit data</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
      +   '<label style="font-size:11px;color:var(--ink-dim, #6b7280);">Balance<input type="number" step="0.01" value="' + (d.balance || '') + '" data-field="balance" style="width:100%;padding:6px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;color:var(--ink, #0a0a0a);background:var(--card, transparent);"></label>'
      +   '<label style="font-size:11px;color:var(--ink-dim, #6b7280);">APR (%)<input type="number" step="0.01" value="' + (d.apr || '') + '" data-field="apr" style="width:100%;padding:6px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;color:var(--ink, #0a0a0a);background:var(--card, transparent);"></label>'
      +   '<label style="font-size:11px;color:var(--ink-dim, #6b7280);">Min/mo<input type="number" step="0.01" value="' + (d.minPayment || '') + '" data-field="minPayment" style="width:100%;padding:6px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;color:var(--ink, #0a0a0a);background:var(--card, transparent);"></label>'
      +   '<label style="font-size:11px;color:var(--ink-dim, #6b7280);">Utilization (%)<input type="number" step="0.01" value="' + (d.utilization || '') + '" data-field="utilization" style="width:100%;padding:6px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;color:var(--ink, #0a0a0a);background:var(--card, transparent);"></label>'
      + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      +   '<button type="button" class="wjp-rt-cancel" style="background:transparent;color:var(--ink-dim, #6b7280);border:1px solid var(--border, rgba(0,0,0,0.15));padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
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
    form.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function badgeForType(type) {
    var t = (type || '').toLowerCase();
    var color = '#9ca3af', bg = 'rgba(0,0,0,0.05)', label = (type || 'BILL').toUpperCase();
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
      'font-family:var(--sans,Inter,system-ui,sans-serif)',
      'color:var(--ink,#0a0a0a)',
      'transition:border-color .15s, box-shadow .15s',
      'box-shadow:' + (isExpanded ? '0 4px 14px rgba(31,122,74,0.10)' : '0 1px 3px rgba(0,0,0,0.04)'),
      'cursor:pointer',
      'overflow:hidden'
    ].join(';');

    var b = badgeForType(d.type);
    var amount = d.minPayment != null ? fmtUSD(d.minPayment) : (d.balance != null ? fmtUSD(d.balance) : '-');

    // Compact header
    var header = ''
      + '<div class="wjp-rt-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;">'
      +   '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;">'
      +     '<span style="font-size:9.5px;letter-spacing:0.10em;background:' + b.bg + ';color:' + b.color + ';padding:3px 7px;border-radius:999px;font-weight:800;flex-shrink:0;">' + b.label + '</span>'
      +     '<span style="font-weight:600;font-size:13.5px;color:var(--ink,#0a0a0a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</span>'
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
      +     '<span style="font-weight:700;font-size:13px;color:var(--ink,#0a0a0a);">' + amount + (d.minPayment ? '/mo' : '') + '</span>'
      +     '<span class="wjp-rt-chev" style="color:#9ca3af;font-size:11px;font-weight:700;transition:transform .2s;display:inline-block;transform:rotate(' + (isExpanded ? '180deg' : '0deg') + ');">▼</span>'
      +   '</div>'
      + '</div>';

    var body = '';
    if (isExpanded) {
      var stats = '';
      if (d.balance != null || d.apr != null || d.utilization != null) {
        stats = '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 10px;">';
        if (d.balance != null) stats += '<span style="font-size:11px;color:var(--ink-dim, #6b7280);background:var(--card-2, #fbf9f4);padding:4px 10px;border-radius:6px;"><b style="color:var(--ink, #0a0a0a);">' + fmtUSD(d.balance) + '</b> balance</span>';
        if (d.apr != null) stats += '<span style="font-size:11px;color:var(--ink-dim, #6b7280);background:var(--card-2, #fbf9f4);padding:4px 10px;border-radius:6px;"><b style="color:' + (d.apr >= 20 ? '#dc2626' : '#0a0a0a') + ';">' + fmtPct(d.apr) + '</b> APR</span>';
        if (d.utilization != null) stats += '<span style="font-size:11px;color:var(--ink-dim, #6b7280);background:var(--card-2, #fbf9f4);padding:4px 10px;border-radius:6px;"><b style="color:' + (d.utilization >= 80 ? '#dc2626' : d.utilization >= 30 ? '#c99a2a' : '#1f7a4a') + ';">' + fmtPct(d.utilization) + '</b> util</span>';
        stats += '</div>';
      }
      var blocks = buildBreakdown(d);
      var bd = '<div style="border-left:3px solid #1f7a4a;padding:10px 14px;background:rgba(31,122,74,0.04);margin:0 14px;border-radius:0 8px 8px 0;">';
      bd += '<div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:6px;">AI breakdown</div>';
      blocks.forEach(function (bl) {
        bd += '<div style="margin-bottom:7px;">'
          + '<div style="font-size:11px;font-weight:800;color:#1f7a4a;margin-bottom:2px;letter-spacing:0.02em;">' + bl.h + '</div>'
          + '<div style="font-size:12.5px;color:var(--ink, #1a1a1a);line-height:1.5;">' + bl.p + '</div>'
          + '</div>';
      });
      bd += '</div>';
      var actions = '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px 14px;">';
      actions += '<button type="button" class="wjp-rt-upload" style="background:#1f7a4a;color:#fff;border:0;padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">Upload statement</button>';
      actions += '<button type="button" class="wjp-rt-edit" style="background:var(--card, rgba(255,255,255,0.92));color:var(--ink, #0a0a0a);border:1px solid var(--border, rgba(0,0,0,0.15));padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">Edit</button>';
      actions += '<button type="button" class="wjp-rt-ask" style="background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(201,154,42,0.06));color:#1f7a4a;border:1px solid rgba(31,122,74,0.25);padding:6px 12px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">Ask AI Coach</button>';
      actions += '</div>';
      body = stats + bd + actions;
    }

    tile.innerHTML = header + body;

    tile.addEventListener('click', function (e) {
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

  // Find the recurring sub-tab content panel (not necessarily .active — its
  // parent visibility is already controlled by the tab system).
  function findRecurringTabContent() {
    var byAttr = document.querySelector('.debts-subtab-content[data-subtab="recurring"]');
    if (byAttr) return byAttr;
    var contents = document.querySelectorAll('.debts-subtab-content');
    for (var i = 0; i < contents.length; i++) {
      var t = contents[i].textContent || '';
      if (/recurring\s+payments/i.test(t) || /total\s+monthly/i.test(t)) return contents[i];
    }
    return null;
  }

  function tick() {
    try {
      harvestDebts();
      harvestFromTable();

      var content = findRecurringTabContent();
      if (!content) {
        var existing = document.getElementById(WRAP_ID);
        if (existing) existing.remove();
        var heading = document.getElementById('wjp-rt-heading');
        if (heading) heading.remove();
        return;
      }

      var items = Object.values(debtDataCache).filter(function (d) {
        return d.name && (d.minPayment != null || d.balance != null);
      });
      if (!items.length) return;

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
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:8px;margin:6px 0 22px;font-family:var(--sans,Inter,system-ui,sans-serif);align-items:start;';
        var statsBar = content.querySelector('#rec-stats-bar') || content.firstElementChild;
        if (statsBar && statsBar.nextSibling) content.insertBefore(grid, statsBar.nextSibling);
        else content.insertBefore(grid, content.firstChild);
        var existingHeading = document.getElementById('wjp-rt-heading');
        if (existingHeading) existingHeading.remove();
        var heading = document.createElement('div');
        heading.id = 'wjp-rt-heading';
        heading.style.cssText = 'margin:18px 0 10px;font-family:var(--sans,Inter,system-ui,sans-serif);font-size:20px;font-weight:600;letter-spacing:-0.01em;color:var(--ink,#0a0a0a);';
        heading.innerHTML = 'Your bills explained <span style="font-family:var(--sans,Inter,system-ui,sans-serif);font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;background:rgba(0,0,0,0.04);padding:3px 9px;border-radius:999px;margin-left:8px;">Click any bill to expand</span>';
        grid.parentNode.insertBefore(heading, grid);
      }

      while (grid.firstChild) grid.removeChild(grid.firstChild);
      items.forEach(function (d) { grid.appendChild(buildTile(d)); });
    } catch (e) {
      try { console.warn('[wjp-recurring-tiles v4] tick threw', e); } catch (_) {}
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
