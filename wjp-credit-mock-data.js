/* wjp-credit-mock-data.js v1 — Sandbox-preview data layer.
 *
 * Provides fallback values for Credit Health UI when Array sandbox returns
 * no data yet. Every section that depends on cloud-pulled values reads from
 * here first, real data second. When real data is available, mock auto-
 * defers — UI is identical, source is swapped transparently.
 *
 * Marked with a subtle "Sandbox preview" badge per Winston's disclosure
 * preference so users always know what's real vs simulated.
 *
 * Public API:
 *   WJP_CreditMock.scoreHistory()    -> [{ts, score}]
 *   WJP_CreditMock.alerts()          -> [{ts, type, source, title, sub}]
 *   WJP_CreditMock.bureauScores(s)   -> { equifax, experian, transunion }
 *   WJP_CreditMock.lockState()       -> { transunion, equifax, experian }
 *   WJP_CreditMock.rentEnrollment()  -> { enrolled, since, monthsReported }
 *   WJP_CreditMock.inquiries()       -> [{date, lender, type}]
 *   WJP_CreditMock.isMockMode()      -> true while no real Array data present
 *   WJP_CreditMock.badge()           -> HTML string for the "Sandbox preview" pill
 */
(function () {
  'use strict';
  if (window._wjpCreditMockInstalled) return;
  window._wjpCreditMockInstalled = true;

  function loadCS() {
    try { return JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); }
    catch (_) { return {}; }
  }
  function getCurrentScore() {
    var ci = loadCS();
    var v = parseInt(ci.currentScore || 0, 10);
    return (v >= 300 && v <= 850) ? v : 616;
  }

  // Detect whether real data has landed. Used by all consumers to decide
  // whether to overlay the "Sandbox preview" badge.
  function isMockMode() {
    try {
      if (typeof appState === 'undefined') return true;
      var hist = appState && appState.creditScoreHistory;
      // Real data exists if Array has written a creditScores object with
      // sandbox:false. Otherwise we treat the page as in sandbox preview.
      if (appState && appState.creditScores && appState.creditScores.sandbox === false) return false;
      // Plain history rows from manual entry don't count as real Array data
      return true;
    } catch (_) { return true; }
  }

  // ── Score history ─────────────────────────────────────────────────────
  // Realistic 12-pull trend ending at the user's current score. Trends
  // slightly upward (positive momentum) but with light noise so it doesn't
  // feel synthetic.
  function scoreHistory() {
    // Prefer real history when it exists
    try {
      if (typeof appState !== 'undefined' && appState && Array.isArray(appState.creditScoreHistory) && appState.creditScoreHistory.length >= 2) {
        return appState.creditScoreHistory
          .map(function (e) { return { ts: e.ts, score: e.score || e.vantage || e.fico8 }; })
          .filter(function (e) { return e.score >= 300 && e.score <= 850; });
      }
    } catch (_) {}

    var current = getCurrentScore();
    var months = 12;
    // Slope: ~10 pts of growth over 12 months (realistic for active debt paydown)
    var start = Math.max(300, current - 10);
    var arr = [];
    var now = Date.now();
    for (var i = 0; i < months; i++) {
      var t = i / (months - 1);
      var noise = ((i * 37) % 7) - 3; // deterministic pseudo-noise -3..3
      var score = Math.round(start + (current - start) * t + noise);
      arr.push({
        ts: now - (months - 1 - i) * 30 * 86400000,
        score: Math.max(300, Math.min(850, score))
      });
    }
    return arr;
  }

  // ── Bureau scores by tier ─────────────────────────────────────────────
  // Pro: only Equifax has a value. Pro Plus+: all 3 (with small variance).
  // Variance reflects real-world bureau differences (10-30 pt spread).
  function bureauScores(primary) {
    primary = primary || getCurrentScore();
    return {
      equifax:    primary,
      experian:   primary + 8,      // small positive delta
      transunion: primary - 5       // small negative delta — even though
                                    // TU isn't transmittable via REST, the
                                    // dashboard chip displays this from
                                    // Array's embedded component once wired
    };
  }

  // ── Alerts feed ───────────────────────────────────────────────────────
  // Realistic events: inquiries, payments, balance updates, account opens.
  function alerts() {
    var now = Date.now();
    var dayMs = 86400000;
    return [
      { ts: now -  2 * dayMs, type: 'inquiry',  source: 'Equifax', title: 'New hard inquiry posted',
        sub: 'Discover Bank — expected to clear in 24 months', delta: -3 },
      { ts: now -  5 * dayMs, type: 'payment',  source: 'Equifax', title: 'Payment posted',
        sub: 'BoA Unlimited — $200 toward balance', delta: 0 },
      { ts: now -  8 * dayMs, type: 'balance',  source: 'Equifax', title: 'Balance updated',
        sub: 'Capital One VentureOne — $883 → $445 (-$438)', delta: +6 },
      { ts: now - 14 * dayMs, type: 'limit',    source: 'Equifax', title: 'Credit limit increased',
        sub: 'BoA Unlimited — $1,500 → $1,800', delta: +5 },
      { ts: now - 22 * dayMs, type: 'utilization', source: 'WJP', title: 'Utilization dropped',
        sub: 'Across-cards util went from 78% to 62%', delta: +4 }
    ];
  }

  // ── Inquiries (hard pulls) ────────────────────────────────────────────
  function inquiries() {
    var now = Date.now();
    var dayMs = 86400000;
    return [
      { date: now -  2 * dayMs, lender: 'Discover Bank',     type: 'credit card',  expectedClearMonths: 24 },
      { date: now - 65 * dayMs, lender: 'SoFi',              type: 'personal loan', expectedClearMonths: 24 },
      { date: now - 110 * dayMs, lender: 'Capital One',      type: 'credit card',  expectedClearMonths: 24 },
      { date: now - 200 * dayMs, lender: 'Bank of America',  type: 'credit card',  expectedClearMonths: 24 },
      { date: now - 290 * dayMs, lender: 'Apple Card',       type: 'credit card',  expectedClearMonths: 24 }
    ];
  }

  // ── Credit lock state ─────────────────────────────────────────────────
  // Per-bureau lock toggles. Pro Plus and Ultimate only have TU lock via
  // Array's product, but the data shape supports per-bureau for future.
  function lockState() {
    try {
      var raw = localStorage.getItem('wjp_credit_lock_state');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { transunion: false, equifax: false, experian: false, lastToggledAt: 0 };
  }
  function saveLockState(s) {
    try { localStorage.setItem('wjp_credit_lock_state', JSON.stringify(s)); } catch (_) {}
  }

  // ── BuildCredit Rent enrollment ───────────────────────────────────────
  function rentEnrollment() {
    try {
      var raw = localStorage.getItem('wjp_credit_rent_enrollment');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { enrolled: false, since: 0, monthsReported: 0, estimatedLift: '+35–45 pts in 6 months' };
  }
  function saveRentEnrollment(s) {
    try { localStorage.setItem('wjp_credit_rent_enrollment', JSON.stringify(s)); } catch (_) {}
  }

  // ── "Sandbox preview" disclosure badge ────────────────────────────────
  // Subtle pill placed near mocked content. Uses design tokens so light +
  // dark modes both stay readable.
  function badge() {
    return ''
      + '<span class="wjp-cs-mock-badge" style="'
      +   'display:inline-flex;align-items:center;gap:5px;'
      +   'padding:3px 8px;border-radius:999px;'
      +   'background:rgba(99,102,241,0.10);'
      +   'border:1px solid rgba(99,102,241,0.22);'
      +   'color:var(--accent-2, #6366f1);'
      +   'font-size:9.5px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;'
      +   'line-height:1;'
      + '">'
      +   '<i class="ph ph-test-tube" style="font-size:10px;"></i>'
      +   'Sandbox preview'
      + '</span>';
  }

  window.WJP_CreditMock = {
    isMockMode: isMockMode,
    scoreHistory: scoreHistory,
    bureauScores: bureauScores,
    alerts: alerts,
    inquiries: inquiries,
    lockState: lockState,
    saveLockState: saveLockState,
    rentEnrollment: rentEnrollment,
    saveRentEnrollment: saveRentEnrollment,
    badge: badge,
    getCurrentScore: getCurrentScore
  };
})();
