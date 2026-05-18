/* wjp-recurring-compound-interest.js v1 — Compound interest per bill on Recurring tab.
 *
 * For each recurring bill linked to a debt (credit card, loan, mortgage),
 * compute and display:
 *   - Monthly interest accrued: balance × (APR/100) / 12
 *   - Yearly projected interest: balance × (APR/100)
 *
 * Renders inline below the bill amount in the Recurring tab table.
 * Tooltip on hover: "This is the cost of carrying this balance."
 *
 * Why this matters: surfaces the silent dollar cost of debt so users see
 * exactly what each card/loan is bleeding monthly. Hard math, visible.
 *
 * Uses bare appState per the permanent memory rule.
 *
 * Safe: IIFE, idempotent, polled re-render for SPA mounts.
 */
(function () {
  'use strict';
  if (window._wjpRecCompoundInstalled) return;
  window._wjpRecCompoundInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-rec-compound-style';
  var BADGE_CLASS = 'wjp-rec-compound';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.' + BADGE_CLASS + ' {',
      '  display: inline-flex; align-items: center; gap: 6px;',
      '  margin-top: 4px;',
      '  font-size: 10px;',
      '  font-family: Inter, system-ui, sans-serif;',
      '  color: var(--ink-dim, var(--text-2, #6b7280));',
      '  cursor: help;',
      '  line-height: 1.4;',
      '}',
      '.' + BADGE_CLASS + ' .label {',
      '  font-weight: 600;',
      '  letter-spacing: 0.02em;',
      '  text-transform: uppercase;',
      '  font-size: 9px;',
      '  color: var(--ink-dim, var(--text-2, #6b7280));',
      '}',
      '.' + BADGE_CLASS + ' .mo {',
      '  color: #c0594a;',
      '  font-weight: 700;',
      '}',
      '.' + BADGE_CLASS + ' .yr {',
      '  color: var(--ink-dim, var(--text-2, #6b7280));',
      '  font-weight: 500;',
      '  margin-left: 2px;',
      '}',
      '.' + BADGE_CLASS + '.lift .mo { color: #1f7a4a; }',
      '.' + BADGE_CLASS + ' .info-icon {',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  width: 11px; height: 11px; border-radius: 50%;',
      '  background: rgba(0,0,0,0.10); color: var(--ink-dim, #6b7280);',
      '  font-size: 8px; font-weight: 800; cursor: help;',
      '}',
      'body.dark .' + BADGE_CLASS + ' .info-icon { background: rgba(255,255,255,0.15); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '$0';
    if (Math.abs(n) >= 100) return '$' + Math.round(n).toLocaleString();
    return '$' + n.toFixed(2);
  }

  // Resolve linked debt for a recurring entry. Returns {balance, apr} or null.
  function getLinkedDebt(rec) {
    var s = getAppState();
    if (!s || !Array.isArray(s.debts)) return null;
    // 1. By explicit linkedDebtId
    if (rec.linkedDebtId) {
      var d = s.debts.find(function (d) { return d.id === rec.linkedDebtId; });
      if (d) return d;
    }
    // 2. By name match (case-insensitive contains)
    var recName = String(rec.name || rec.description || '').toLowerCase();
    if (recName.length >= 4) {
      var match = s.debts.find(function (d) {
        var dName = String(d.name || '').toLowerCase();
        return dName.length >= 4 && (recName.indexOf(dName) !== -1 || dName.indexOf(recName) !== -1);
      });
      if (match) return match;
    }
    return null;
  }

  function computeInterest(debt) {
    if (!debt) return null;
    var bal = Number(debt.balance) || 0;
    var apr = Number(debt.apr) || 0;
    if (bal <= 0 || apr <= 0) return null;
    var monthly = (bal * apr / 100) / 12;
    var yearly = bal * apr / 100;
    return { monthly: monthly, yearly: yearly, balance: bal, apr: apr };
  }

  function renderBadge(rec, interest) {
    if (!interest) return '';
    var tooltip = 'This is the cost of carrying this balance. At ' + interest.apr.toFixed(2) + '% APR on $' + Math.round(interest.balance).toLocaleString() + ', you accrue ' + fmtUsd(interest.monthly) + '/mo (' + fmtUsd(interest.yearly) + '/yr) in interest. Paying above the minimum is the only way to shrink it.';
    return '<div class="' + BADGE_CLASS + '" title="' + tooltip.replace(/"/g, '&quot;') + '">' +
      '<span class="label">Interest:</span>' +
      '<span class="mo">' + fmtUsd(interest.monthly) + '/mo</span>' +
      '<span class="yr">· ' + fmtUsd(interest.yearly) + '/yr</span>' +
      '<span class="info-icon">i</span>' +
    '</div>';
  }

  function enhance() {
    try {
      var s = getAppState();
      if (!s || !Array.isArray(s.recurringPayments)) return;
      var rows = document.querySelectorAll('tr.rec-row');
      if (!rows.length) return;
      Array.prototype.forEach.call(rows, function (row) {
        if (row.getAttribute('data-wjp-rec-compound') === '1') return; // already enhanced
        var recId = row.getAttribute('data-rec-id');
        if (!recId) return;
        var rec = s.recurringPayments.find(function (r) { return r.id === recId; });
        if (!rec) return;
        var debt = getLinkedDebt(rec);
        var interest = computeInterest(debt);
        if (!interest) {
          row.setAttribute('data-wjp-rec-compound', '1');
          return;
        }
        // Find the amount cell — third cell (Amount column)
        var cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        var amtCell = cells[2];
        // Inject badge AFTER the amount value
        var existing = amtCell.querySelector('.' + BADGE_CLASS);
        if (existing) existing.remove();
        amtCell.insertAdjacentHTML('beforeend', renderBadge(rec, interest));
        row.setAttribute('data-wjp-rec-compound', '1');
      });
    } catch (e) {
      try { console.warn('[wjp-rec-compound] enhance failed', e); } catch (_) {}
    }
  }

  function boot() {
    injectStyle();
    // Re-run every 2s for SPA mounts / pagination changes
    setInterval(function () {
      try { enhance(); } catch (_) {}
    }, 2000);
    // Listen for hash changes (tab switches)
    window.addEventListener('hashchange', function () { setTimeout(enhance, 300); });
    // Re-enhance after debt updates so changing balance/APR reflects
    window.addEventListener('wjp-debts-updated', function () {
      // Force re-render by clearing the data-attr markers
      var rows = document.querySelectorAll('tr.rec-row[data-wjp-rec-compound]');
      Array.prototype.forEach.call(rows, function (r) { r.removeAttribute('data-wjp-rec-compound'); });
      enhance();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_RecCompound = {
    enhance: enhance,
    computeInterest: computeInterest,
    getLinkedDebt: getLinkedDebt,
    version: 1
  };
})();
