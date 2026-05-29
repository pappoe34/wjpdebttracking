/* wjp-recurring-tiles.js v7 — Edit Data Save persists to appState.debts + triggers full app re-render v6 — buildBreakdown adds due date v4.1 — all 12 debts + Unicode literal escape fix.
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

      // Look up the recurring payment to find nextDate (due date)
      var nextDueStr = '—', daysToDue = null;
      try {
        var rp = (appState.recurringPayments || []).find(function (x) {
          return x.linkedDebtId === d.debtId
            || (x.name && d.name && x.name.toLowerCase().indexOf(d.name.toLowerCase()) !== -1);
        });
        if (rp && rp.nextDate) {
          var nd = new Date(rp.nextDate.length >= 10 ? rp.nextDate + 'T00:00:00' : rp.nextDate);
          if (!isNaN(nd.getTime())) {
            nextDueStr = nd.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
            daysToDue = Math.ceil((nd - new Date()) / 86400000);
          }
        }
      } catch (_) {}

      // Statement window — most credit cards close ~21 days before due date
      var statementCloseStr = '—';
      try {
        if (nextDueStr !== '—') {
          var nd2 = new Date();
          var rp2 = (appState.recurringPayments || []).find(function (x) {
            return x.linkedDebtId === d.debtId;
          });
          if (rp2 && rp2.nextDate) {
            var ndd = new Date(rp2.nextDate.length >= 10 ? rp2.nextDate + 'T00:00:00' : rp2.nextDate);
            if (!isNaN(ndd.getTime())) {
              ndd.setDate(ndd.getDate() - 21);
              statementCloseStr = ndd.toLocaleDateString('en-US', { month:'short', day:'numeric' });
            }
          }
        }
      } catch (_) {}

      // Amortization months until payoff at current min
      var r = (apr / 100) / 12;
      var monthsLeft = '—';
      var totalInterestLife = 0;
      if (min > 0) {
        if (r === 0) {
          monthsLeft = Math.ceil(bal / min);
          totalInterestLife = 0;
        } else if (min > bal * r) {
          var n = -Math.log(1 - (bal * r) / min) / Math.log(1 + r);
          monthsLeft = Math.max(1, Math.ceil(n));
          totalInterestLife = monthsLeft * min - bal;
        } else {
          monthsLeft = '∞ (min only covers interest)';
        }
      }
      var monthsLeftStr = (typeof monthsLeft === 'number') ? (monthsLeft + ' months (~' + Math.round(monthsLeft / 12 * 10) / 10 + ' yrs)') : monthsLeft;

      // Block 1: Identity + key dates
      var dueChunk = nextDueStr !== '—'
        ? 'Next due: <b>' + nextDueStr + '</b>' + (daysToDue != null ? ' (in ' + daysToDue + ' days)' : '')
        : 'Due date: <b>not set</b>';
      var stmtChunk = statementCloseStr !== '—'
        ? '. Statement closes around <b>' + statementCloseStr + '</b> — the balance on that date is what posts as utilization to your credit report.'
        : '.';
      blocks.push({ h: 'What this is', p: name + ' is one of your debt accounts. ' + dueChunk + stmtChunk });

      // Block 2: Cost of carrying
      var meaningful = monthlyInterest > min * 0.7
        ? 'About ' + Math.round(pctOfMin) + '% of your minimum payment is just covering interest. Almost none of it is actually paying down what you owe.'
        : monthlyInterest > min * 0.4
          ? 'Roughly ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest is going at the principal — but slowly.'
          : 'About ' + Math.round(pctOfMin) + '% of your minimum is interest. The rest chips away at the principal.';
      blocks.push({ h: 'Why it matters', p: 'At ' + apr + '% APR on ' + fmtUSD(bal) + ', this account costs you ' + fmtUSD(monthlyInterest) + ' every month in interest alone. ' + meaningful + ' That’s ' + fmtUSD(monthlyInterest * 12) + '/year just to keep this account where it is.' });

      // Block 3: Payoff timeline at current min
      var lifeInterestStr = totalInterestLife > 0 ? fmtUSD(totalInterestLife) : '$0';
      blocks.push({ h: 'Payoff timeline at minimum', p: 'Paying just the minimum (' + fmtUSD(min) + '/mo), this debt clears in <b>' + monthsLeftStr + '</b> and you\'ll pay <b>' + lifeInterestStr + '</b> in lifetime interest. Bigger payments shorten this dramatically.' });

      // Block 4: Action with concrete savings
      var extra = Math.max(20, Math.round(min * 0.5));
      var savedNow = 0;
      if (typeof monthsLeft === 'number' && r > 0) {
        var newPay = min + extra;
        if (newPay > bal * r) {
          var n2 = -Math.log(1 - (bal * r) / newPay) / Math.log(1 + r);
          n2 = Math.max(1, Math.ceil(n2));
          var newInterest = n2 * newPay - bal;
          savedNow = Math.max(0, totalInterestLife - newInterest);
        }
      }
      var savedNowStr = savedNow > 0 ? ' That move alone saves you about <b>' + fmtUSD(savedNow) + '</b> in lifetime interest.' : '';
      blocks.push({ h: 'What you can do', p: 'Add ' + fmtUSD(extra) + '/mo extra to this payment.' + savedNowStr + ' Time the extra payment AFTER your statement closes (' + statementCloseStr + ') and BEFORE the due date (' + nextDueStr + ') — that way the lower balance gets reported, lifting your credit score a few points.' });
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

  // Open the AI Coach panel and submit the bill-specific prompt.
  // The site's AI Coach uses a FAB (#ai-chat-fab) that toggles a panel
  // (#ai-chat-panel) and shares a WJP_ChatCore.send() pipeline. We open the
  // panel if needed, populate the input for visibility, then send.
  function openAiCoach(prompt) {
    try {
      var fab = document.getElementById('ai-chat-fab');
      var panel = document.getElementById('ai-chat-panel');
      var input = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
      var sendBtn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');

      // Open panel if not active
      if (panel && !panel.classList.contains('active') && fab) {
        fab.click();
      }
      // Stuff the prompt into the input so the user sees it queue up
      function stuffAndSend() {
        var i = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
        if (i) {
          i.value = prompt;
          i.dispatchEvent(new Event('input', { bubbles: true }));
          // Prefer ChatCore (handles render + history) over clicking the button
          if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
            try { window.WJP_ChatCore.send(prompt); return; } catch (_) {}
          }
          var s = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
          if (s) s.click();
        } else if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
          try { window.WJP_ChatCore.send(prompt); } catch (_) {}
        }
      }
      // Wait for panel mount animation then send
      setTimeout(stuffAndSend, 350);
    } catch (e) { try { console.warn('[wjp-recurring-tiles] openAiCoach threw', e); } catch (_) {} }
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
      // FIX 62 (Winston 2026-05-29): full-width Name input so user can
      // rename Plaid-imported debts ("credit Account 2407" -> "CapOne Visa").
      + '<label style="font-size:11px;color:var(--ink-dim, #6b7280);display:block;margin-bottom:10px;">Name<input type="text" value="' + String(d.name || '').replace(/"/g, '&quot;') + '" data-field="name" placeholder="Account name" style="width:100%;padding:6px 10px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:6px;font-size:13px;font-family:inherit;margin-top:4px;color:var(--ink, #0a0a0a);background:var(--card, transparent);"></label>'
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
      // Collect new values
      var updates = {};
      form.querySelectorAll('input').forEach(function (inp) {
        var f = inp.dataset.field;
        if (!f) return;
        var raw = inp.value;
        // FIX 62: name is a string field, every other field stays numeric
        if (f === 'name') {
          var t = (raw == null ? '' : String(raw)).trim();
          if (t) updates.name = t.slice(0, 80);
          return;
        }
        if (raw === '' || raw == null) return;
        var v = parseFloat(raw);
        if (isFinite(v)) updates[f] = v;
      });
      // Update the cache so the tile re-renders with new values
      Object.keys(updates).forEach(function (k) { d[k] = updates[k]; });
      debtDataCache[d.debtId] = d;
      // FIX 62: also flip the tile's visible header text immediately
      try {
        if ('name' in updates) {
          var hdr = tileEl.querySelector('.wjp-rt-name, [data-field-display="name"], h3, h4');
          if (hdr) hdr.textContent = updates.name;
        }
      } catch (_) {}
      // v7: ALSO persist to appState.debts (source of truth for the whole app)
      try {
        var as = (typeof appState !== 'undefined') ? appState : null;
        if (as && Array.isArray(as.debts)) {
          var debt = as.debts.find(function (x) {
            return x.id === d.debtId
              || (x.name && d.name && x.name.toLowerCase() === d.name.toLowerCase());
          });
          if (debt) {
            if ('name' in updates) debt.name = updates.name; // FIX 62: rename
            if ('balance' in updates) debt.balance = updates.balance;
            if ('apr' in updates) debt.apr = updates.apr;
            if ('minPayment' in updates) debt.minPayment = updates.minPayment;
            if ('utilization' in updates) debt.utilization = updates.utilization;
            debt.userEdited = true;
            debt.lastEditedAt = Date.now();
          }
        }
        // Also update the matching recurringPayment minPayment if user changed Min/mo
        if (as && Array.isArray(as.recurringPayments) && 'minPayment' in updates) {
          var rp = as.recurringPayments.find(function (p) {
            return (p.linkedDebtId && p.linkedDebtId === d.debtId)
              || (p.name && d.name && p.name.toLowerCase().indexOf(d.name.toLowerCase()) !== -1);
          });
          if (rp) rp.amount = updates.minPayment;
        }
        // Persist state + cloud-push
        if (typeof window.saveState === 'function') window.saveState();
        // Re-render every tab/view that uses this data
        ['renderRecurringTab', 'renderDebts', 'updateUI', 'drawCharts', 'txnRenderAll'].forEach(function (fn) {
          try { if (typeof window[fn] === 'function') window[fn](); } catch (_) {}
        });
        // Fire a custom event so other modules (wealth signals, etc.) can react
        try {
          window.dispatchEvent(new CustomEvent('wjp-debt-updated', {
            detail: { debtId: d.debtId, updates: updates }
          }));
        } catch (_) {}
        // Toast confirm
        try {
          if (typeof window.showToast === 'function') {
            window.showToast('Saved — AI breakdown + countdown updated.');
          }
        } catch (_) {}
      } catch (err) {
        try { console.warn('[wjp-rt-edit] save failed', err); } catch (_) {}
      }
      form.remove();
      tick();
    });
    form.addEventListener('click', function (e) { e.stopPropagation(); });

    // v2: Click outside the edit form (and outside the tile that hosts it)
    // closes the form. Bound on next tick so the originating click that
    // opened the form doesn't immediately close it.
    setTimeout(function () {
      function onDocClick(ev) {
        if (!form.parentNode) { document.removeEventListener('click', onDocClick, true); return; }
        if (form.contains(ev.target)) return; // click inside form
        // Click outside form → close
        try { form.remove(); } catch (_) {}
        document.removeEventListener('click', onDocClick, true);
      }
      document.addEventListener('click', onDocClick, true);
    }, 50);
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
      // v5: no longer harvest non-debt recurring rows — debts only

      var content = findRecurringTabContent();
      if (!content) {
        var existing = document.getElementById(WRAP_ID);
        if (existing) existing.remove();
        var heading = document.getElementById('wjp-rt-heading');
        if (heading) heading.remove();
        return;
      }

      var items = Object.values(debtDataCache).filter(function (d) {
        // v5: Recurring tab should only show DEBT bills (credit cards, loans).
        // Bank transactions / generic recurring entries (e.g. autopay debits
        // that aren't tied to a debt account) are excluded.
        if (!d.name) return false;
        var typeStr = String(d.type || '').toLowerCase();
        if (typeStr.indexOf('debt') === -1) return false;
        return (d.minPayment != null || d.balance != null);
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

      // If the user has an Edit form open, skip the rebuild — we'd otherwise
      // wipe the form mid-typing. The form is in #wjp-rt-grid; a refresh
      // resumes once the user saves or cancels (both call tick() explicitly).
      if (grid.querySelector('.wjp-rt-edit-form')) return;

      // Fingerprint the items so we only rebuild when content actually changes.
      // Eliminates the visible flash of tiles wiping + rebuilding every tick
      // when nothing changed.
      var fp = items.map(function (d) {
        // v5: include expanded state so click-to-expand actually re-renders
        return [d.name, d.minPayment, d.balance, d.apr, d.type, d.nextDue, d.frequency, expandedKeys.has(d.debtId) ? 'X' : 'C'].join('|');
      }).join('||');
      if (grid._wjpFp === fp && grid.firstChild) return;
      grid._wjpFp = fp;

      while (grid.firstChild) grid.removeChild(grid.firstChild);
      items.forEach(function (d) { grid.appendChild(buildTile(d)); });
    } catch (e) {
      try { console.warn('[wjp-recurring-tiles v4] tick threw', e); } catch (_) {}
    }
  }

  // Debounced reinjection — coalesces rapid host re-renders.
  var _rtTimer = null;
  function scheduleTick() {
    if (_rtTimer) return;
    _rtTimer = setTimeout(function () { _rtTimer = null; try { tick(); } catch (_) {} }, 80);
  }
  var _rtMo = null;
  function attachObserver() {
    if (_rtMo) return;
    try {
      var dbg = document.getElementById('page-debts');
      if (!dbg) return;
      _rtMo = new MutationObserver(scheduleTick);
      _rtMo.observe(dbg, { childList: true, subtree: true });
    } catch (_) {}
  }

  function boot() {
    setTimeout(tick, 800);
    setTimeout(tick, 2500);
    attachObserver();
    window.addEventListener('hashchange', scheduleTick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WJP_RecurringTiles = { refresh: tick, _cache: debtDataCache };
})();
