/* wjp-paycheck-due-date-ai.js v1 — Paycheck-aware due-date optimization.
 *
 * Detects paycheck cadence from appState.transactions (income txs) and
 * recommends shifting card / loan due dates to land mid-paycheck for
 * better cashflow distribution.
 *
 * HARD RULE: rent / mortgage / housing payments are NEVER suggested for
 * date changes. They're treated as fixed obligations on the original date.
 *
 * Surfaces:
 *   - Insight card on Dashboard ("AI Insight: Move 2 due dates")
 *   - Push notification via window.pushNotification if available
 *
 * Detection logic:
 *   1. Pay cadence: scan income txs (positive amounts, payroll/salary/wages/
 *      Fresh Realm/KPMG/ADP merchants), find median day-spacing. <8d=weekly,
 *      8-18d=bi-weekly, 18-35d=monthly.
 *   2. Pay anchors: the day-of-month each paycheck lands (typically 2 anchors
 *      for bi-weekly: e.g., 1st + 15th).
 *   3. Bill schedule: read appState.recurringPayments (excluding rent/housing)
 *      and appState.debts (excluding mortgages) — get their due day.
 *   4. For each bill: compute IDEAL day = mid-paycheck (paycheck day + 7 days
 *      for bi-weekly) so user has full paycheck buffer before bill hits.
 *   5. Recommend: "Shift T-Mobile from 5th to 17th to land mid-paycheck."
 *
 * Excludes from recommendations (HARD): name matches /rent|mortgage|landlord|
 * housing|leasing|woodhaven|apartment/, OR category === 'Housing'/'Rent'/'Mortgage'.
 *
 * Bare appState per memory rule.
 */
(function () {
  'use strict';
  if (window._wjpPaycheckDueDateAiInstalled) return;
  window._wjpPaycheckDueDateAiInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-paycheck-ai-style';
  var CARD_ID = 'wjp-paycheck-ai-card';

  var RENT_RE = /\brent\b|\bmortgage\b|landlord|housing|leasing|woodhaven|apartment|hoa|condo\s+fee/i;
  var HOUSING_CATS = ['housing', 'rent', 'mortgage'];

  function isRentLike(item) {
    if (!item) return false;
    var name = String(item.name || item.merchant || item.description || '').toLowerCase();
    var cat = String(item.category || item.cat || '').toLowerCase();
    if (RENT_RE.test(name)) return true;
    if (HOUSING_CATS.indexOf(cat) !== -1) return true;
    if (item.linkedRent === true) return true;
    return false;
  }

  function isPaycheck(tx) {
    if (!tx) return false;
    if (Number(tx.amount) <= 0) return false;
    var m = String(tx.merchant || '').toLowerCase();
    var c = String(tx.category || '').toLowerCase();
    if (c === 'income' || /payroll|salary|wage|paycheck/.test(c)) return true;
    if (/payroll|salary|wages|paycheck|direct\s+dep|adp\s+totalsource|fresh\s*realm|kpmg|data\s+center/.test(m)) return true;
    return false;
  }

  // Detect cadence + anchor days from income txs in the last 90 days.
  function detectPaycheckPattern() {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return null;
    var now = Date.now();
    var ninetyAgo = now - 90 * 24 * 60 * 60 * 1000;
    var paychecks = s.transactions.filter(function (t) {
      if (!isPaycheck(t)) return false;
      var d = new Date(t.date || t.timestamp || 0).getTime();
      return isFinite(d) && d >= ninetyAgo;
    }).sort(function (a, b) {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    if (paychecks.length < 2) return null;
    // Day-spacing
    var gaps = [];
    for (var i = 1; i < paychecks.length; i++) {
      var prev = new Date(paychecks[i - 1].date).getTime();
      var curr = new Date(paychecks[i].date).getTime();
      var days = Math.round((curr - prev) / (24 * 3600 * 1000));
      if (days > 0 && days < 40) gaps.push(days);
    }
    if (!gaps.length) return null;
    gaps.sort(function (a, b) { return a - b; });
    var medianGap = gaps[Math.floor(gaps.length / 2)];
    var cadence;
    if (medianGap <= 8) cadence = 'weekly';
    else if (medianGap <= 18) cadence = 'biweekly';
    else cadence = 'monthly';
    // Anchor days (day-of-month)
    var anchorDays = {};
    paychecks.forEach(function (t) {
      var d = new Date(t.date);
      var dom = d.getDate();
      anchorDays[dom] = (anchorDays[dom] || 0) + 1;
    });
    var topAnchors = Object.keys(anchorDays)
      .map(function (k) { return { day: parseInt(k, 10), count: anchorDays[k] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 3);
    return {
      cadence: cadence,
      medianGap: medianGap,
      anchorDays: topAnchors.map(function (a) { return a.day; }),
      paycheckCount: paychecks.length,
      avgAmount: paychecks.reduce(function (s, t) { return s + t.amount; }, 0) / paychecks.length
    };
  }

  // Compute the ideal day-of-month for a bill given paycheck pattern:
  // try to land it about half a cycle AFTER a paycheck so cash is buffered.
  function idealDueDay(pattern, currentDueDay) {
    if (!pattern || !pattern.anchorDays.length) return currentDueDay;
    if (pattern.cadence === 'monthly') {
      // Monthly paycheck: ideal is ~10 days after paycheck day
      var pd = pattern.anchorDays[0];
      var ideal = pd + 10;
      if (ideal > 28) ideal = 28;
      return ideal;
    }
    if (pattern.cadence === 'biweekly') {
      // Bi-weekly: typically 2 anchor days (e.g., 1st + 15th).
      // Ideal is ~7 days after one of those anchors.
      var anchors = pattern.anchorDays.slice().sort(function (a, b) { return a - b; });
      var candidates = anchors.map(function (a) { return a + 7; }).filter(function (c) { return c <= 28; });
      if (!candidates.length) return currentDueDay;
      // Pick the candidate furthest from currentDueDay (max benefit from shift)
      candidates.sort(function (a, b) {
        return Math.abs(b - currentDueDay) - Math.abs(a - currentDueDay);
      });
      return candidates[0];
    }
    // Weekly: ideal is the 15th (most paychecks land by then)
    return 15;
  }

  function buildRecommendations() {
    var pattern = detectPaycheckPattern();
    if (!pattern) return { pattern: null, recommendations: [] };
    var s = getAppState();
    if (!s) return { pattern: pattern, recommendations: [] };
    var recs = [];
    var bills = [];

    // Pull bills from recurringPayments
    (s.recurringPayments || []).forEach(function (rp) {
      if (isRentLike(rp)) return; // PROTECTED
      var day = null;
      if (rp.nextDate) {
        var nd = new Date(rp.nextDate);
        if (!isNaN(nd.getTime())) day = nd.getDate();
      }
      if (day == null && rp.anchorDay) day = parseInt(rp.anchorDay, 10);
      if (day == null) return;
      bills.push({
        kind: 'recurring',
        id: rp.id,
        name: rp.name || rp.description || 'Bill',
        amount: Math.abs(rp.amount || 0),
        currentDueDay: day,
        type: rp.category || rp.cat || 'Bill'
      });
    });

    // Pull due days from debts (credit cards, loans), skip mortgages
    (s.debts || []).forEach(function (d) {
      if (isRentLike(d)) return;
      var dueDay = parseInt(d.dueDate || d.dueDay, 10);
      if (!isFinite(dueDay)) return;
      bills.push({
        kind: 'debt',
        id: d.id,
        name: d.name || 'Debt',
        amount: Number(d.minPayment) || 0,
        currentDueDay: dueDay,
        type: d.type || 'Debt'
      });
    });

    // Build recommendations: bills where shifting would help
    bills.forEach(function (b) {
      var ideal = idealDueDay(pattern, b.currentDueDay);
      var diff = Math.abs(ideal - b.currentDueDay);
      if (diff < 4) return; // not worth shifting
      // Check if current day is BEFORE a paycheck (the bad case — bill hits when you're cash-light)
      var isBeforePaycheck = pattern.anchorDays.some(function (a) {
        return b.currentDueDay >= (a - 3) && b.currentDueDay < a; // bill within 3 days before paycheck
      });
      if (!isBeforePaycheck && diff < 8) return;
      recs.push({
        bill: b,
        currentDay: b.currentDueDay,
        suggestedDay: ideal,
        reason: isBeforePaycheck
          ? 'Currently due ' + (pattern.anchorDays.find(function (a) { return a >= b.currentDueDay; }) - b.currentDueDay) + ' days BEFORE a paycheck — risky if cash runs low.'
          : 'Shifting to the ' + suffix(ideal) + ' lands it mid-paycheck cycle, giving you a full buffer.',
        amount: b.amount
      });
    });

    return { pattern: pattern, recommendations: recs };
  }

  function suffix(d) {
    if (d >= 11 && d <= 13) return d + 'th';
    var last = d % 10;
    if (last === 1) return d + 'st';
    if (last === 2) return d + 'nd';
    if (last === 3) return d + 'rd';
    return d + 'th';
  }

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + CARD_ID + ' {',
      '  background: linear-gradient(135deg, rgba(155,135,245,0.06) 0%, rgba(155,135,245,0.02) 100%);',
      '  border: 1px solid rgba(155,135,245,0.25);',
      '  border-radius: 14px; padding: 16px 20px; margin: 14px 0;',
      '  font-family: Inter, system-ui, sans-serif;',
      '}',
      'body.dark #' + CARD_ID + ' {',
      '  background: linear-gradient(135deg, rgba(155,135,245,0.14) 0%, rgba(155,135,245,0.04) 100%);',
      '  border-color: rgba(155,135,245,0.35);',
      '}',
      '#' + CARD_ID + ' .eyebrow {',
      '  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;',
      '  color: #7a5fc8; font-weight: 800; margin-bottom: 4px;',
      '}',
      '#' + CARD_ID + ' h3 {',
      '  margin: 0 0 6px; font-size: 15px; font-weight: 800;',
      '  color: var(--ink, var(--text-1, #0a0a0a));',
      '}',
      '#' + CARD_ID + ' .sub {',
      '  font-size: 11.5px; color: var(--ink-dim, var(--text-2, #6b7280));',
      '  margin-bottom: 12px; line-height: 1.5;',
      '}',
      '#' + CARD_ID + ' .rec-row {',
      '  display: flex; justify-content: space-between; align-items: center;',
      '  padding: 9px 11px; border-radius: 8px;',
      '  background: var(--bg-3, rgba(0,0,0,0.03));',
      '  margin-bottom: 5px;',
      '}',
      '#' + CARD_ID + ' .rec-name {',
      '  font-size: 12px; font-weight: 700;',
      '  color: var(--ink, var(--text-1, #0a0a0a));',
      '}',
      '#' + CARD_ID + ' .rec-shift {',
      '  font-size: 10.5px; color: var(--ink-dim, var(--text-2, #6b7280));',
      '  margin-top: 2px; line-height: 1.5;',
      '}',
      '#' + CARD_ID + ' .rec-shift strong { color: #7a5fc8; font-weight: 800; }',
      '#' + CARD_ID + ' .rec-amt {',
      '  font-size: 11px; font-weight: 700;',
      '  color: var(--ink-dim, var(--text-2, #6b7280));',
      '  flex-shrink: 0; margin-left: 10px;',
      '}',
      '#' + CARD_ID + ' .protected-note {',
      '  margin-top: 10px; font-size: 10.5px;',
      '  color: var(--ink-dim, var(--text-2, #6b7280));',
      '  font-style: italic;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function isOnDashboard() {
    var p = document.getElementById('page-dashboard');
    return !!(p && p.classList.contains('active'));
  }

  function render() {
    if (!isOnDashboard()) {
      var ex = document.getElementById(CARD_ID);
      if (ex) try { ex.remove(); } catch (_) {}
      return;
    }
    var data = buildRecommendations();
    if (!data.pattern || !data.recommendations.length) {
      var oldCard = document.getElementById(CARD_ID);
      if (oldCard) oldCard.remove();
      return;
    }
    // v2 fix 2026-05-19: build innerHTML, then UPDATE existing card in place
    // instead of remove+recreate. Prevents flicker + page auto-scroll caused
    // by a ~400px element disappearing/reappearing every 8s.
    var recsHtml = data.recommendations.slice(0, 5).map(function (r) {
      return '<div class="rec-row">' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="rec-name">' + r.bill.name + '</div>' +
          '<div class="rec-shift">Move from <strong>' + suffix(r.currentDay) + '</strong> to <strong>' + suffix(r.suggestedDay) + '</strong> — ' + r.reason + '</div>' +
        '</div>' +
        '<span class="rec-amt">' + fmtUsd(r.amount) + '/mo</span>' +
      '</div>';
    }).join('');

    var cadenceLabel = data.pattern.cadence === 'biweekly' ? 'Bi-weekly' : data.pattern.cadence === 'weekly' ? 'Weekly' : 'Monthly';
    var anchorLabel = data.pattern.anchorDays.map(suffix).join(' & ');

    var html =
      '<div class="eyebrow">AI Insight · Paycheck-aware due dates</div>' +
      '<h3>' + data.recommendations.length + ' bill' + (data.recommendations.length === 1 ? '' : 's') + ' to consider shifting</h3>' +
      '<div class="sub">You\'re paid <strong>' + cadenceLabel + '</strong> around the ' + anchorLabel + '. These bills land at awkward times — shifting due dates puts your full paycheck buffer behind each payment.</div>' +
      recsHtml +
      '<div class="protected-note">🏠 Rent / mortgage / housing payments are excluded — they stay on their original schedule.</div>';

    var page = document.getElementById('page-dashboard');
    if (!page) return;

    var existing = document.getElementById(CARD_ID);
    if (existing) {
      // UPDATE IN PLACE — only touch DOM if content actually changed
      if (existing.innerHTML !== html) existing.innerHTML = html;
      return;
    }

    var card = document.createElement('div');
    card.id = CARD_ID;
    card.className = (card.className||'') + ' reorderable';
    card.setAttribute('data-card-id', 'wjp-paycheck-ai');
    card.innerHTML = html;
    var hero = document.getElementById('wjp-dashboard-hero');
    if (hero && hero.parentElement === page) {
      page.insertBefore(card, hero.nextSibling);
    } else if (page.firstChild) {
      page.insertBefore(card, page.firstChild);
    } else {
      page.appendChild(card);
    }
  }

  function boot() {
    injectStyle();
    setInterval(render, 8000);
    window.addEventListener('hashchange', function () { setTimeout(render, 300); });
    window.addEventListener('wjp-transactions-rehydrated', render);
    setTimeout(render, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PaycheckDueDateAi = {
    render: render,
    detectPaycheckPattern: detectPaycheckPattern,
    buildRecommendations: buildRecommendations,
    isRentLike: isRentLike,
    version: 1
  };
})();
