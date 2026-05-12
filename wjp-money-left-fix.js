/* wjp-money-left-fix.js v1 — corrects Money Left math
 * Wraps computeRealMonthlyIncome + computeMoneyLeft so income includes
 * recurring income (monthly-equivalent) and spent excludes Zelle/transfers.
 */
(function () {
  'use strict';
  if (window._wjpMoneyLeftFixInstalled) return;
  window._wjpMoneyLeftFixInstalled = true;

  var TRANSFER_RE = /\bzelle\b|cash\s*app|venmo|paypal\s+(transfer|send)|transfer\s+(from|to)|ach\s+(debit|credit|transfer|payment)|\binternal\s+xfer\b|online\s+(banking\s+)?transfer|external\s+transfer|wire\s+(in|out)|\bcc\s+payment\b|credit\s+card\s+payment|investment\s+(transfer|deposit)|brokerage|bkofamerica\s+atm|coinbase|robinhood|\bstash\b|\bvanguard\b|\bfidelity\b|charles\s+schwab|\bira\b\s+(deposit|contribution)/i;

  function isTransferTxn(t) {
    if (!t) return false;
    var blob = ((t.name || '') + ' ' + (t.merchant || '') + ' ' + (t.category || '') + ' ' + (t.method || '')).toLowerCase();
    return TRANSFER_RE.test(blob);
  }

  function monthlyEquivalent(amount, frequency) {
    var a = Math.abs(Number(amount) || 0);
    if (!a) return 0;
    switch ((frequency || 'monthly').toLowerCase()) {
      case 'weekly':    return a * 4.3333;
      case 'biweekly':
      case 'bi-weekly': return a * 2.1667;
      case 'semimonthly':
      case 'semi-monthly': return a * 2;
      case 'quarterly': return a / 3;
      case 'yearly':
      case 'annual':
      case 'annually':  return a / 12;
      default:          return a;
    }
  }

  function fixedComputeRealMonthlyIncome() {
    try {
      var s = window.appState || {};
      var now = new Date();
      var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      var plaidIncome = (s.transactions || [])
        .filter(function (t) {
          if (!t || t.source !== 'plaid') return false;
          var amt = Number(t.amount) || 0;
          if (amt <= 0) return false;
          if (new Date(t.date) < monthStart) return false;
          if (isTransferTxn(t)) return false;
          return true;
        })
        .reduce(function (sum, t) { return sum + Number(t.amount); }, 0);
      var recurIncome = (s.recurringPayments || [])
        .filter(function (r) { return r && (r.category === 'income' || r.linkedIncome); })
        .reduce(function (sum, r) { return sum + monthlyEquivalent(r.amount, r.frequency); }, 0);
      return Math.round(Math.max(plaidIncome, recurIncome));
    } catch (e) {
      try { console.warn('[wjp-money-left-fix] income calc threw', e); } catch (_) {}
      return 0;
    }
  }

  function fixedComputeMoneyLeft() {
    try {
      var s = window.appState || {};
      var now = new Date();
      var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      var totalDays = monthEnd.getDate();
      var dayOfMonth = now.getDate();
      var daysRemaining = Math.max(1, totalDays - dayOfMonth);
      var incomeMo = fixedComputeRealMonthlyIncome();
      var spentMo = (s.transactions || [])
        .filter(function (t) {
          if (!t || t.synthetic) return false;
          var amt = Number(t.amount) || 0;
          if (amt >= 0) return false;
          if (new Date(t.date) < monthStart) return false;
          if (isTransferTxn(t)) return false;
          return true;
        })
        .reduce(function (sum, t) { return sum + Math.abs(Number(t.amount) || 0); }, 0);
      var leftMo = incomeMo - spentMo;
      var dailyBurn = dayOfMonth > 0 ? spentMo / dayOfMonth : 0;
      var forecastEnd = leftMo - (dailyBurn * daysRemaining);
      return {
        incomeMo: incomeMo,
        spentMo: Math.round(spentMo * 100) / 100,
        leftMo: Math.round(leftMo * 100) / 100,
        dailyBurn: dailyBurn,
        forecastEnd: forecastEnd,
        daysRemaining: daysRemaining,
        dayOfMonth: dayOfMonth,
        totalDays: totalDays
      };
    } catch (e) {
      try { console.warn('[wjp-money-left-fix] moneyleft calc threw', e); } catch (_) {}
      return { incomeMo: 0, spentMo: 0, leftMo: 0, dailyBurn: 0, forecastEnd: 0, daysRemaining: 0, dayOfMonth: 0, totalDays: 30 };
    }
  }

  function install() {
    window.computeRealMonthlyIncome = fixedComputeRealMonthlyIncome;
    window.computeMoneyLeft = fixedComputeMoneyLeft;
    try { if (typeof window.renderMoneyLeftWidget === 'function') window.renderMoneyLeftWidget(); } catch (_) {}
  }

  function waitForHost() {
    if (typeof window.computeMoneyLeft === 'function' && typeof window.computeRealMonthlyIncome === 'function') {
      install();
    } else {
      setTimeout(waitForHost, 300);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(waitForHost, 800); });
  else setTimeout(waitForHost, 800);

  setInterval(function () {
    try { if (typeof window.renderMoneyLeftWidget === 'function') window.renderMoneyLeftWidget(); } catch (_) {}
  }, 5000);

  window.WJP_MoneyLeftFix = { income: fixedComputeRealMonthlyIncome, moneyLeft: fixedComputeMoneyLeft, isTransfer: isTransferTxn };
})();
