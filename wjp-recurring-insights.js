/* wjp-recurring-insights.js — AI-powered plain-English insights on the
 * Recurring Payments sub-tab of the Debts page. Each row gets a small
 * "Plain English" expander that explains the bill in non-jargon language
 * + an "Ask AI Coach" button for deeper analysis.
 *
 * Hardened: IIFE, idempotent, path-guarded, no MutationObservers, polled.
 */
(function () {
  'use strict';
  if (window._wjpRecurringInsightsInstalled) return;
  window._wjpRecurringInsightsInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var INJECTED_FLAG = '_wjpRiInjected';

  function fmtUSD(n) {
    if (!isFinite(n)) return '-';
    return '$' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function fmtAnnual(monthly) {
    return fmtUSD(monthly * 12);
  }

  // Generate a plain-English insight for a row based on category + amount.
  function buildInsight(rowData) {
    var name = rowData.name || 'this bill';
    var amount = Math.abs(rowData.amount || 0);
    var type = (rowData.type || '').toLowerCase();
    var blocks = [];

    if (type === 'debt') {
      var annual = amount * 12;
      blocks.push({
        h: 'What this is',
        p: name + ' is a debt account, and this is the minimum payment your creditor needs each month. Paying just the minimum mostly covers the interest fee — the actual balance barely drops.'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'You\'re paying ' + fmtUSD(amount) + ' every month — ' + fmtAnnual(amount) + ' a year — just to stay in place. If that minimum isn\'t enough to cover the monthly interest charge, the balance can actually grow even though you\'re paying.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Add even ' + fmtUSD(Math.max(20, Math.round(amount * 0.25))) + '/mo extra to the payment. Every extra dollar past the minimum goes straight at the principal, so the balance starts dropping faster and the total interest you pay shrinks. Use the "Aggressive" tab on your dashboard to see what that does to your debt-free date.'
      });
    } else if (type === 'subscription' || /subscription/i.test(name)) {
      blocks.push({
        h: 'What this is',
        p: name + ' is a recurring subscription — charged automatically every month or year whether you use it or not.'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'You\'re paying ' + fmtUSD(amount) + '/mo for this. Over a year that\'s ' + fmtAnnual(amount) + '. Over five years, that\'s ' + fmtUSD(amount * 60) + '. If you don\'t use this enough to justify the price, that money could go straight to your debt instead.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Open the app once. If you haven\'t used it in 60 days, cancel it. If you use it but rarely, look for a cheaper tier. Apps like Rocket Money will cancel forgotten subscriptions for you, but you can do it free in 2 minutes through the service\'s website.'
      });
    } else if (type === 'utility' || /utility|gas|electric|water|internet/i.test(name)) {
      blocks.push({
        h: 'What this is',
        p: name + ' is a utility bill — essentials like electricity, gas, water, or internet that you can\'t really cancel, but you can sometimes lower.'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'You\'re spending ' + fmtUSD(amount) + '/mo on this, ' + fmtAnnual(amount) + ' a year. Utilities are usually 5-10% of monthly income for most households — worth knowing what your share is.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Three things move the needle: (1) shop your provider every 12-18 months — a 10-min call often saves $10-20/mo, (2) check your usage trend — if it\'s creeping up, find out why (a leaky pipe or extra subscriber on your account?), (3) bundle services if it gets you a meaningful discount.'
      });
    } else if (type === 'insurance' || /insurance/i.test(name)) {
      blocks.push({
        h: 'What this is',
        p: name + ' is an insurance premium — the price of protecting yourself from a bigger expense (medical, accident, property loss).'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'You\'re paying ' + fmtUSD(amount) + '/mo — ' + fmtAnnual(amount) + '/yr. Insurance gets more expensive every year if you don\'t shop. Loyalty pricing is real, and most providers won\'t lower your rate unless you ask or threaten to leave.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Get one comparison quote every 12 months. 5-10 minutes online with Geico/Progressive/etc. If it\'s lower, call your current provider and ask them to match — they often will. People save $200-600/year doing this once a year.'
      });
    } else if (type === 'income' || /income|paycheck|paid/i.test(name)) {
      blocks.push({
        h: 'What this is',
        p: name + ' is income hitting your account on a recurring schedule — paycheck, side gig, or other.'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'You\'re bringing in roughly ' + fmtUSD(amount) + ' from this source. Every dollar of income that\'s not committed to bills can either fund your debt-free date or get spent. The Aggressive tab on your dashboard shows what happens if all your surplus goes to debt.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Set up an auto-transfer so a portion of every paycheck goes straight to your highest-APR debt the day you get paid. People who pay debt FIRST out of payday clear it 30-50% faster than people who pay debt LAST out of whatever\'s left.'
      });
    } else {
      blocks.push({
        h: 'What this is',
        p: name + ' is a recurring expense — ' + fmtUSD(amount) + '/mo, ' + fmtAnnual(amount) + '/yr.'
      });
      blocks.push({
        h: 'Why it matters',
        p: 'Recurring expenses are the leakiest part of most budgets. They\'re predictable, which makes them easy to forget about, which makes them easy to overpay for.'
      });
      blocks.push({
        h: 'What you can do',
        p: 'Once a quarter, look at every recurring charge. For each one, ask: do I still need this, am I getting good value, and is there a cheaper alternative? You\'ll usually find $30-100/mo to cut.'
      });
    }
    return blocks;
  }

  function buildAiPrompt(rowData) {
    var name = rowData.name || 'this bill';
    var amount = fmtUSD(Math.abs(rowData.amount || 0));
    var type = rowData.type || 'recurring';
    return 'Look at my recurring bill: ' + name + ' (' + type + '), ' + amount + '/mo. In plain English, explain: what is this, what is it costing me long-term, and what should I do specifically to reduce it or use it better? Use my real numbers from my account.';
  }

  function openAiCoach(prompt) {
    try {
      // Try the chat-core API exposed by wjp-chat-core
      if (window.WJP_ChatCore && typeof window.WJP_ChatCore.openWith === 'function') {
        window.WJP_ChatCore.openWith(prompt);
        return;
      }
      // Fallback: open AI Coach FAB then fill input
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
    } catch (e) {
      try { console.warn('[wjp-recurring-insights] openAiCoach failed', e); } catch (_) {}
    }
  }

  function findRecurringRows() {
    // The Recurring Payments sub-tab content lives in a debts-subtab-content
    // div. Find rows in any visible table inside it.
    var contents = document.querySelectorAll('.debts-subtab-content.active');
    var rows = [];
    contents.forEach(function (c) {
      var tableRows = c.querySelectorAll('tbody tr, .recurring-row, [data-recurring-id]');
      tableRows.forEach(function (r) { rows.push(r); });
    });
    return rows;
  }

  function parseRowData(row) {
    // Parse each cell — column order from the table:
    // [0] Payment (name), [1] Type (badge), [2] Amount/Mo, [3] Frequency,
    // [4] Next Due, [5] Payments Left, [6] Status
    var cells = row.querySelectorAll('td');
    if (!cells.length) return null;
    var name = (cells[0] && cells[0].textContent || '').trim();
    var type = (cells[1] && cells[1].textContent || '').trim();
    var amountRaw = (cells[2] && cells[2].textContent || '').replace(/[^0-9.\-]/g, '');
    var amount = parseFloat(amountRaw);
    if (!isFinite(amount)) amount = 0;
    return {
      name: name.replace(/\s*\(min payment\)\s*$/i, '').trim(),
      type: type.toLowerCase(),
      amount: amount
    };
  }

  function injectInsightControl(row) {
    if (row[INJECTED_FLAG]) return;
    var data = parseRowData(row);
    if (!data || !data.name) return;
    var lastCell = row.querySelector('td:last-child');
    if (!lastCell) return;

    // Append a small insight button at the end of the last cell
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wjp-ri-btn';
    btn.title = 'Open the AI Coach breakdown of this bill';
    btn.style.cssText = [
      'margin-left:8px',
      'padding:4px 9px',
      'background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(201,154,42,0.06))',
      'color:#1f7a4a',
      'border:1px solid rgba(31,122,74,0.25)',
      'border-radius:999px',
      'font-size:10.5px',
      'font-weight:700',
      'letter-spacing:0.02em',
      'cursor:pointer',
      'font-family:Inter,system-ui,sans-serif',
      'white-space:nowrap',
      'transition:background .15s, transform .12s'
    ].join(';');
    btn.textContent = '\u{1F4AC} Ask AI Coach';
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'translateY(-1px)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'translateY(0)'; });
    btn.addEventListener('click', function (e) { e.stopPropagation(); toggleDetails(row, data); });
    lastCell.appendChild(btn);
    row[INJECTED_FLAG] = true;
  }

  function toggleDetails(row, data) {
    var existing = row.nextElementSibling;
    if (existing && existing.classList && existing.classList.contains('wjp-ri-detail')) {
      existing.remove();
      return;
    }
    var detail = document.createElement('tr');
    detail.className = 'wjp-ri-detail';
    var td = document.createElement('td');
    td.colSpan = row.cells.length;
    td.style.cssText = 'padding:0;background:#fbf9f4;';

    var blocks = buildInsight(data);
    var html = '<div style="padding:14px 22px;font-family:Inter,system-ui,sans-serif;border-left:3px solid #1f7a4a;">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">';
    html += '<span style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c99a2a;font-weight:800;">Ask AI Coach</span>';
    html += '<span style="font-size:13px;color:#0a0a0a;font-weight:600;">' + data.name + '</span>';
    html += '</div>';
    blocks.forEach(function (b) {
      html += '<div style="margin-bottom:10px;">'
        + '<div style="font-size:11px;font-weight:800;color:#1f7a4a;margin-bottom:3px;letter-spacing:0.04em;">' + b.h + '</div>'
        + '<div style="font-size:13px;color:#1a1a1a;line-height:1.55;">' + b.p + '</div>'
        + '</div>';
    });
    html += '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button type="button" class="wjp-ri-ask-ai" style="background:#1f7a4a;color:#fff;border:0;padding:8px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Ask AI Coach for deeper analysis &rarr;</button>';
    html += '<button type="button" class="wjp-ri-close" style="background:transparent;color:#6b7280;border:1px solid rgba(0,0,0,0.15);padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Close</button>';
    html += '</div>';
    html += '</div>';

    td.innerHTML = html;
    detail.appendChild(td);
    row.parentNode.insertBefore(detail, row.nextSibling);

    detail.querySelector('.wjp-ri-ask-ai').addEventListener('click', function () {
      openAiCoach(buildAiPrompt(data));
    });
    detail.querySelector('.wjp-ri-close').addEventListener('click', function () {
      detail.remove();
    });
  }

  function tick() {
    try {
      var rows = findRecurringRows();
      rows.forEach(injectInsightControl);
    } catch (e) {
      try { console.warn('[wjp-recurring-insights] tick threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_RecurringInsights = { refresh: tick, buildInsight: buildInsight };
})();
