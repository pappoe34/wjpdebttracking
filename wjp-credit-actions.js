/* wjp-credit-actions.js v9 — adds Array partner sections: Pre-qualified Offers + BuildCredit (Account + Rent) Pro-gated
 *
 * New "Credit" sidebar tab. Reads card limits + debts to compute per-card
 * utilization. Generates prioritized action cards based on FICO factors:
 *   - 30% utilization (single biggest fast-acting lever)
 *   - 35% payment history
 *   - 15% credit age
 *   - 10% mix · 10% new credit
 *
 * Action card states: open → in-progress → done. Each has:
 *   estimated point gain · difficulty · specific dollar/action target.
 *
 * Storage: user-scoped wjp.credit.actions.v1 = { [actionId]: {status, ts} }
 */
(function () {
  'use strict';
  if (window._wjpCreditActionsInstalled) return;
  window._wjpCreditActionsInstalled = true;

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }
  function userKey(b) {
    if (window.WJP_UserScope && typeof window.WJP_UserScope.scopeKey === 'function') return window.WJP_UserScope.scopeKey(b);
    return b;
  }
  function loadJSON(k, def) { try { var v = localStorage.getItem(userKey(k)); return v ? JSON.parse(v) : def; } catch (_) { return def; } }
  function saveJSON(k, v) { try { localStorage.setItem(userKey(k), JSON.stringify(v)); } catch (_) {} }

  var ACTIONS_KEY = 'wjp.credit.actions.v1';
  var PAGE_ID = 'page-credit-wjp';
  var NAV_ID = 'nav-credit-wjp';

  function fmtUSD(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function escapeHTML(s) { return String(s||'').replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  // ---------- Credit data ingestion ----------
  function loadCreditInputs() {
    // Try user-scoped first
    try {
      if (window.WJP_UserScope && typeof window.WJP_UserScope.scopeKey === 'function') {
        var v = localStorage.getItem(window.WJP_UserScope.scopeKey('wjp_credit_inputs'));
        if (v) return JSON.parse(v);
      }
    } catch (_) {}
    try { return JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch (_) { return {}; }
  }

  function computeCreditProfile() {
    var ci = loadCreditInputs();
    var s = getState() || {};
    var limits = ci.cardLimits || {};
    var debts = s.debts || [];
    var cards = debts.filter(function (d) {
      var t = (d.type || '').toLowerCase();
      return /credit|card/.test(t);
    });
    var perCard = cards.map(function (d) {
      var lim = limits[d.id] || limits['plaid:' + d.id] || 0;
      var bal = Number(d.balance) || 0;
      lim = Number(lim) || 0;
      var util = lim > 0 ? (bal / lim) * 100 : null;
      return { id: d.id, name: d.name, balance: bal, limit: lim, util: util, apr: d.apr };
    });
    var totalLimit = perCard.reduce(function (a, c) { return a + (c.limit || 0); }, 0);
    var totalBalance = perCard.reduce(function (a, c) { return a + c.balance; }, 0);
    var overallUtil = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : null;
    var currentScore = parseInt(ci.currentScore, 10) || null;
    var bureauScores = ci.bureauScores || {};
    var lates = parseInt(ci.latePayments12mo, 10) || 0;
    var inquiries = parseInt(ci.hardInquiries12mo, 10) || 0;
    var newAccts = parseInt(ci.newAccounts12mo, 10) || 0;
    var oldestYears = parseFloat(ci.oldestAccountYears) || 0;
    var avgYears = parseFloat(ci.avgAccountYears) || null;
    return {
      perCard: perCard, totalLimit: totalLimit, totalBalance: totalBalance,
      overallUtil: overallUtil, currentScore: currentScore, bureauScores: bureauScores,
      lates: lates, inquiries: inquiries, newAccts: newAccts,
      oldestYears: oldestYears, avgYears: avgYears
    };
  }

  // ---------- Generate prioritized actions ----------
  function buildActions(p) {
    var actions = [];
    var actState = loadJSON(ACTIONS_KEY, {});

    // 1. Per-card utilization (high impact)
    p.perCard
      .filter(function (c) { return c.limit > 0 && c.util != null && c.util > 30; })
      .sort(function (a, b) { return b.util - a.util; })
      .forEach(function (c) {
        var target30 = c.limit * 0.30;
        var payTo30 = Math.max(0, c.balance - target30);
        var target10 = c.limit * 0.10;
        var payTo10 = Math.max(0, c.balance - target10);
        var estGain = c.util > 90 ? 18 : c.util > 60 ? 12 : 7; // rough heuristic
        var id = 'util:' + c.id;
        actions.push({
          id: id,
          group: 'utilization',
          weight: 30, // FICO factor weight (used for sort priority)
          title: 'Drop ' + c.name + ' below 30% utilization',
          summary: 'Currently ' + Math.round(c.util) + '% used. Pay ' + fmtUSD(payTo30) + ' to hit 30% · ' + fmtUSD(payTo10) + ' to hit 10%.',
          estGain: estGain,
          difficulty: payTo30 < 100 ? 'easy' : payTo30 < 500 ? 'medium' : 'hard',
          ctaLabel: 'Mark paid down',
          status: (actState[id] && actState[id].status) || 'open',
          icon: 'ph-fill ph-credit-card',
          accent: '#10b981',
          target: payTo30
        });
      });

    // 2. Overall utilization
    if (p.overallUtil != null && p.overallUtil > 30) {
      var overallPay = (p.totalBalance - p.totalLimit * 0.30);
      actions.push({
        id: 'util:overall',
        group: 'utilization',
        weight: 30,
        title: 'Get overall utilization under 30%',
        summary: 'Total ' + Math.round(p.overallUtil) + '% across ' + p.perCard.length + ' cards ($' + Math.round(p.totalBalance).toLocaleString() + ' of $' + Math.round(p.totalLimit).toLocaleString() + ' limit). Need ' + fmtUSD(overallPay) + ' paid down.',
        estGain: 35,
        difficulty: 'hard',
        ctaLabel: 'Working on it',
        status: (actState['util:overall'] && actState['util:overall'].status) || 'open',
        icon: 'ph-fill ph-chart-bar',
        accent: '#10b981',
        target: overallPay
      });
    }

    // 3. Pay before statement closing date (always-on tip)
    actions.push({
      id: 'tip:statement',
      group: 'utilization',
      weight: 30,
      title: 'Pay BEFORE statement closing date',
      summary: 'Whatever balance posts on closing day is what gets reported to bureaus. Make a mid-cycle payment so reported util drops — without paying anything extra.',
      estGain: 0,
      difficulty: 'easy',
      ctaLabel: 'I know my dates',
      status: (actState['tip:statement'] && actState['tip:statement'].status) || 'open',
      icon: 'ph-fill ph-calendar-check',
      accent: '#3b82f6'
    });

    // 4. Payment history
    if (p.lates > 0) {
      actions.push({
        id: 'pay:onTime',
        group: 'payment',
        weight: 35,
        title: 'Set autopay on every card',
        summary: 'You\'ve had ' + p.lates + ' late payment' + (p.lates !== 1 ? 's' : '') + ' in the last 12 months. Lates stay 7 years — but you can stop new ones today by enabling autopay-minimum on every card.',
        estGain: 25,
        difficulty: 'easy',
        ctaLabel: 'Autopay enabled',
        status: (actState['pay:onTime'] && actState['pay:onTime'].status) || 'open',
        icon: 'ph-fill ph-clock-counter-clockwise',
        accent: '#a855f7'
      });

      actions.push({
        id: 'pay:goodwill',
        group: 'payment',
        weight: 35,
        title: 'Send a goodwill letter for your late payments',
        summary: 'For each late payment from a creditor you\'ve been good with otherwise, write a goodwill removal request. Success rate varies but it\'s free and the upside is big.',
        estGain: 15,
        difficulty: 'medium',
        ctaLabel: 'Letter sent',
        status: (actState['pay:goodwill'] && actState['pay:goodwill'].status) || 'open',
        icon: 'ph-fill ph-envelope-open',
        accent: '#a855f7'
      });
    }

    // 5. Inquiries
    if (p.inquiries > 2) {
      actions.push({
        id: 'inq:pause',
        group: 'new-credit',
        weight: 10,
        title: 'Pause new credit applications for 6 months',
        summary: 'You have ' + p.inquiries + ' hard inquiries in the last 12 months. Each one knocks 2-5 points. Each falls off at 24 months. No new applications until then.',
        estGain: 8,
        difficulty: 'easy',
        ctaLabel: 'Got it',
        status: (actState['inq:pause'] && actState['inq:pause'].status) || 'open',
        icon: 'ph-fill ph-hand',
        accent: '#f59e0b'
      });
    }

    // 6. Credit age
    if (p.oldestYears > 0) {
      actions.push({
        id: 'age:keepOldest',
        group: 'age',
        weight: 15,
        title: 'Do NOT close your oldest card',
        summary: 'Your oldest account is ' + p.oldestYears + ' years old. Closing it would shorten your average credit age and could drop your score 5-15 points. Even with $0 balance, leave it open.',
        estGain: 10,
        difficulty: 'easy',
        ctaLabel: 'Will keep it open',
        status: (actState['age:keepOldest'] && actState['age:keepOldest'].status) || 'open',
        icon: 'ph-fill ph-tree',
        accent: '#06b6d4'
      });
    }

    // 7. Authorized user (age boost via someone else)
    actions.push({
      id: 'age:authorizedUser',
      group: 'age',
      weight: 15,
      title: 'Get added as Authorized User on a trusted older card',
      summary: 'If a family member has a card older than yours with low utilization and no lates, ask to be added as Authorized User. Their account history gets reported on your file — fast age boost, no risk to them.',
      estGain: 20,
      difficulty: 'medium',
      ctaLabel: 'Asked someone',
      status: (actState['age:authorizedUser'] && actState['age:authorizedUser'].status) || 'open',
      icon: 'ph-fill ph-users-three',
      accent: '#06b6d4'
    });

    // 8. Limit increase
    actions.push({
      id: 'util:limitIncrease',
      group: 'utilization',
      weight: 30,
      title: 'Request credit limit increases on existing cards',
      summary: 'Higher limit + same balance = lower utilization, instantly. Most issuers allow a soft-pull request once every 6 months. Try the cards where you\'ve had the account 12+ months and paid on time.',
      estGain: 12,
      difficulty: 'easy',
      ctaLabel: 'Increase requested',
      status: (actState['util:limitIncrease'] && actState['util:limitIncrease'].status) || 'open',
      icon: 'ph-fill ph-trend-up',
      accent: '#10b981'
    });

    // 9. Bureau disputes
    actions.push({
      id: 'bureau:dispute',
      group: 'payment',
      weight: 35,
      title: 'Pull all 3 bureau reports + dispute anything inaccurate',
      summary: 'Free annual reports at annualcreditreport.com. Anything wrong (wrong balance, account not yours, paid debt showing unpaid) → file a dispute online with the bureau. Bureau has 30 days to investigate.',
      estGain: 15,
      difficulty: 'medium',
      ctaLabel: 'Pulled all 3',
      status: (actState['bureau:dispute'] && actState['bureau:dispute'].status) || 'open',
      icon: 'ph-fill ph-files',
      accent: '#a855f7'
    });

    // Sort by status (open first), then estGain desc
    var statusOrder = { 'in-progress': 0, 'open': 1, 'done': 2 };
    actions.sort(function (a, b) {
      var so = (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3);
      if (so !== 0) return so;
      return b.estGain - a.estGain;
    });

    return actions;
  }

  function projectedGain(actions) {
    return actions.filter(function (a) { return a.status === 'open' || a.status === 'in-progress'; })
      .reduce(function (s, a) { return s + (a.estGain || 0); }, 0);
  }

  // ---------- Sidebar nav injection ----------
  // v4: Hide the duplicate Debts > Credit Score subtab so the user has ONE Credit home.
  function hideDuplicateSubtab() {
    try {
      // The host subtab is a clickable element with data-subtab-target or similar.
      // Search both common patterns.
      var candidates = Array.from(document.querySelectorAll('[data-debts-sub], [data-subtab], .debts-subtab-link, .subtab-link, .debts-sub-nav a, [data-tab]')).filter(function (el) {
        var v = (el.getAttribute('data-debts-sub') || el.getAttribute('data-subtab') || el.getAttribute('data-tab') || '').toLowerCase();
        if (v === 'credit-score') return true;
        var t = (el.textContent || '').trim().toLowerCase();
        return t === 'credit score';
      });
      candidates.forEach(function (el) {
        if (el.dataset.wjpHidden) return;
        el.dataset.wjpHidden = '1';
        el.style.display = 'none';
      });
    } catch (_) {}
  }

  function ensureNavItem() {
    if (document.getElementById(NAV_ID)) return;
    var anchor = document.getElementById('nav-goals-wjp');
    if (!anchor) anchor = document.querySelector('.nav-item[data-page="recurring"]');
    if (!anchor || !anchor.parentNode) return;
    var nav = document.createElement('div');
    nav.id = NAV_ID;
    nav.className = anchor.className.replace(/active/g, '').trim();
    nav.setAttribute('data-page', 'credit-wjp');
    nav.innerHTML = '<i class="ph ph-shield-star" style="margin-right:8px;"></i>Credit';
    if (anchor.nextSibling) anchor.parentNode.insertBefore(nav, anchor.nextSibling);
    else anchor.parentNode.appendChild(nav);
    nav.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); showCreditPage(); });
  }

  function showCreditPage() {
    Array.from(document.querySelectorAll('[id^="page-"]')).forEach(function (p) {
      if (p.id !== PAGE_ID) { p.classList.remove('active'); p.style.display = 'none'; }
    });
    Array.from(document.querySelectorAll('.nav-item')).forEach(function (n) { n.classList.remove('active'); });
    var nav = document.getElementById(NAV_ID); if (nav) nav.classList.add('active');
    var page = document.getElementById(PAGE_ID);
    if (!page) {
      page = document.createElement('div');
      page.id = PAGE_ID;
      page.className = 'page active';
      page.style.cssText = 'padding:24px 24px 80px;max-width:1400px;margin:0 auto;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;';
      var ca = document.querySelector('.content-area, main, .main-area');
      if (ca) ca.appendChild(page);
      else document.body.appendChild(page);
    }
    page.style.display = 'block';
    page.classList.add('active');
    renderPage(page);
  }

  // ---------- v9: Array Partner Sections (Offers Engine + BuildCredit) ----------
  // Pre-qualified offers (Array Offers Engine) — placeholder until partnership is live.
  // Renders a polished section that signals the feature to users + lets us start
  // capturing demand. When Array integration ships, this populates from
  // window.WJP_CreditPull.fetchOffersFromBackend(uid) which returns
  // { cards: [...], loans: [...] }.
  function buildOffersHTML(p) {
    var live = window._wjpArrayOffersLive === true;
    if (!live) {
      return ''
        + '<div style="margin-bottom:24px;">'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
        +     '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Pre-qualified Offers</div><div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">Credit cards + loans you\'re likely approved for</div></div>'
        +     '<span style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;padding:4px 10px;border-radius:999px;background:rgba(168,85,247,0.15);color:#a855f7;text-transform:uppercase;">Coming Soon</span>'
        +   '</div>'
        +   '<div style="background:linear-gradient(135deg,rgba(168,85,247,0.08),rgba(236,72,153,0.08));border:1px solid rgba(168,85,247,0.25);border-radius:14px;padding:18px 22px;">'
        +     '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">'
        +       '<div style="width:48px;height:48px;border-radius:12px;background:rgba(168,85,247,0.20);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-sparkle" style="font-size:24px;color:#a855f7;"></i></div>'
        +       '<div style="flex:1;min-width:240px;">'
        +         '<div style="font-size:14px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">Personalized offers, soft-pull matched to your real credit profile</div>'
        +         '<div style="font-size:11.5px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;line-height:1.5;margin-top:4px;">No more wasted hard inquiries. We show only cards and loans you\'re statistically likely to be approved for. <strong>Soft-pull only</strong> — your score isn\'t affected.</div>'
        +       '</div>'
        +     '</div>'
        +     '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px;">'
        +       partnerTeaser('Cash-back cards', 'ph-credit-card', '#a855f7', 'Earn on everyday spend')
        +       partnerTeaser('0% APR balance transfer', 'ph-arrows-counter-clockwise', '#ec4899', 'Move high-APR debt to 0% intro')
        +       partnerTeaser('Personal loans', 'ph-hand-coins', '#8b5cf6', 'Consolidate, lower your monthly')
        +       partnerTeaser('Secured cards', 'ph-shield-check', '#f43f5e', 'Rebuild fast with $0 deposit risk')
        +     '</div>'
        +   '</div>'
        + '</div>';
    }
    return '';
  }

  function partnerTeaser(title, icon, color, sub) {
    return '<div style="padding:10px 12px;background:var(--card, var(--bg-2, #fff));border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:10px;display:flex;align-items:center;gap:9px;">'
      + '<div style="width:28px;height:28px;border-radius:7px;background:' + color + '22;display:grid;place-items:center;color:' + color + ';flex-shrink:0;"><i class="ph-fill ' + icon + '" style="font-size:14px;"></i></div>'
      + '<div style="min-width:0;"><div style="font-size:11px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</div><div style="font-size:9.5px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + sub + '</div></div>'
      + '</div>';
  }

  // BuildCredit (Account + Rent Reporting) — Array partner products that help users
  // with low or thin credit profiles rebuild. We show these when overall utilization
  // is high OR credit age is thin OR score < 670, which signals the user would benefit.
  function shouldShowBuildCredit(p) {
    if (!p) return false;
    if (p.currentScore && p.currentScore < 670) return true;
    if (p.overallUtil && p.overallUtil > 50) return true;
    if (p.oldestYears != null && p.oldestYears < 3) return true;
    if (!p.perCard || p.perCard.length === 0) return true; // no cards yet
    return false;
  }

  function buildBuildCreditHTML(p) {
    if (!shouldShowBuildCredit(p)) return '';
    return ''
      + '<div style="margin-bottom:24px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      +     '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Credit Builder Tools</div><div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">Move the needle on the factors holding you back</div></div>'
      +     '<span style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;padding:4px 10px;border-radius:999px;background:rgba(6,182,212,0.15);color:#0891b2;text-transform:uppercase;">Coming Soon</span>'
      +   '</div>'
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">'
      +     buildCreditCard(
            'BuildCredit Account',
            'ph-fill ph-piggy-bank',
            '#06b6d4',
            'Secured credit-builder account with $0 hard pull. You deposit, the account reports to all 3 bureaus monthly. Most users see a 30-70 point lift within 6 months.',
            ['Reports to Equifax / Experian / TransUnion', 'No credit check', '6-month average score lift: +40 points', 'Money is yours — get it back when you close']
          )
      +     buildCreditCard(
            'BuildCredit Rent Reporting',
            'ph-fill ph-house-line',
            '#0e7490',
            'Your rent payments get reported to the bureaus as positive payment history. Past 24 months can be reported retroactively (Experian / TransUnion).',
            ['On-time rent reported monthly', 'Retro-report up to 24 months', 'Boosts the 35% "payment history" factor', 'No impact on your landlord']
          )
      +   '</div>'
      + '</div>';
  }

  function buildCreditCard(title, icon, color, summary, bullets) {
    return ''
      + '<div style="background:var(--card, var(--bg-2, #fff));border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;padding:16px 18px;border-left:4px solid ' + color + ';">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +   '<div style="width:36px;height:36px;border-radius:10px;background:' + color + '22;display:grid;place-items:center;color:' + color + ';flex-shrink:0;"><i class="' + icon + '" style="font-size:18px;"></i></div>'
      +   '<div style="font-size:14px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">' + title + '</div>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;line-height:1.5;margin-bottom:10px;">' + summary + '</div>'
      + '<ul style="margin:0;padding-left:18px;font-size:11.5px;color:var(--ink, var(--text-1, #0a0a0a));line-height:1.6;list-style-type:disc;">'
      + bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('')
      + '</ul>'
      + '<button type="button" data-bc-interest="' + title + '" style="margin-top:12px;width:100%;background:transparent;color:' + color + ';border:1px solid ' + color + ';padding:8px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;">Notify me when live</button>'
      + '</div>';
  }

  // ---------- v8: Score Detail (big number + bureau breakdown + range scale) ----------
  function scoreBand(s) {
    if (!s) return { band: 'Not set', color: '#94a3b8', pct: 0 };
    if (s >= 800) return { band: 'Exceptional', color: '#10b981', pct: ((s - 300) / 550) * 100 };
    if (s >= 740) return { band: 'Very Good',   color: '#22c55e', pct: ((s - 300) / 550) * 100 };
    if (s >= 670) return { band: 'Good',        color: '#84cc16', pct: ((s - 300) / 550) * 100 };
    if (s >= 580) return { band: 'Fair',        color: '#f59e0b', pct: ((s - 300) / 550) * 100 };
    return { band: 'Poor', color: '#ef4444', pct: ((s - 300) / 550) * 100 };
  }

  function buildScoreDetailHTML(p) {
    var score = p.currentScore || 0;
    var band = scoreBand(score);
    var bureaus = p.bureauScores || {};
    var bureauOrder = ['equifax', 'experian', 'transunion'];
    var bureauColors = { equifax: '#a855f7', experian: '#0891b2', transunion: '#f97316' };

    var bureausHTML = bureauOrder.map(function (k) {
      var v = bureaus[k]; var val = v && v.value ? v.value : (typeof v === 'number' ? v : null);
      if (!val) return '<div style="flex:1;min-width:140px;padding:12px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px dashed var(--border,rgba(255,255,255,0.10));border-radius:10px;text-align:center;"><div style="font-size:9.5px;letter-spacing:0.10em;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:800;text-transform:uppercase;">' + k + '</div><div style="font-size:18px;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));margin-top:2px;">—</div><div style="font-size:9.5px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;margin-top:2px;">not pulled yet</div></div>';
      var b = scoreBand(val);
      return '<div style="flex:1;min-width:140px;padding:12px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:10px;border-left:3px solid ' + bureauColors[k] + ';">'
        + '<div style="font-size:9.5px;letter-spacing:0.10em;color:' + bureauColors[k] + ';font-weight:800;text-transform:uppercase;">' + k + '</div>'
        + '<div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;"><span style="font-size:22px;font-weight:900;color:var(--ink, var(--text-1, #0a0a0a));letter-spacing:-0.01em;">' + val + '</span><span style="font-size:10px;font-weight:700;color:' + b.color + ';">' + b.band + '</span></div>'
        + '</div>';
    }).join('');

    var fillPct = score ? Math.min(100, Math.max(0, ((score - 300) / 550) * 100)) : 0;

    return ''
      + '<div style="margin-bottom:24px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      +     '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Score Detail</div><div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">FICO 8 · range 300 to 850</div></div>'
      +   '</div>'
      // Big score band card
      +   '<div style="background:var(--card, var(--bg-2, #fff));border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;padding:18px 22px;">'
      +     '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;">'
      +       '<div><div style="font-size:9.5px;letter-spacing:0.10em;color:' + band.color + ';font-weight:800;text-transform:uppercase;">' + band.band + '</div>'
      +         '<div style="font-size:42px;font-weight:900;color:var(--ink, var(--text-1, #0a0a0a));letter-spacing:-0.02em;line-height:1.05;">' + (score || '—') + '<span style="font-size:18px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:700;"> / 850</span></div></div>'
      +       '<div style="text-align:right;"><div style="font-size:9.5px;letter-spacing:0.10em;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:800;text-transform:uppercase;">Last updated</div><div style="font-size:13px;font-weight:700;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">' + (p.bureauScores && p.bureauScores.equifax && p.bureauScores.equifax.capturedAt ? new Date(p.bureauScores.equifax.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not pulled yet') + '</div></div>'
      +     '</div>'
      // Range gradient bar
      +     '<div style="position:relative;height:12px;border-radius:999px;background:linear-gradient(90deg,#ef4444 0%,#f59e0b 33%,#84cc16 53%,#22c55e 73%,#10b981 92%);overflow:visible;margin:18px 0 6px;">'
      +       '<div style="position:absolute;left:' + fillPct + '%;top:-6px;width:24px;height:24px;border-radius:50%;background:#fff;border:3px solid ' + band.color + ';transform:translateX(-50%);box-shadow:0 2px 6px rgba(0,0,0,0.20);"></div>'
      +     '</div>'
      +     '<div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;margin-bottom:14px;">'
      +       '<span>300</span><span>Poor 580</span><span>Fair 670</span><span>Good 740</span><span>Very Good 800</span><span>850</span>'
      +     '</div>'
      // Bureau breakdown
      +     '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">' + bureausHTML + '</div>'
      +   '</div>'
      + '</div>';
  }

  // ---------- v8: Factor Breakdown (5 FICO factors with grades from real data) ----------
  function gradeFor(metric, value, p) {
    // Returns { grade: 'A+'..'F', color, label, reason }
    if (metric === 'utilization') {
      if (value == null) return { grade: '—', color: '#94a3b8', label: 'No data', reason: 'Add card limits to grade' };
      if (value <= 10) return { grade: 'A+', color: '#10b981', label: 'Excellent', reason: 'Under 10% — ideal' };
      if (value <= 30) return { grade: 'A',  color: '#22c55e', label: 'Good',      reason: 'Under 30% threshold' };
      if (value <= 50) return { grade: 'C',  color: '#f59e0b', label: 'Moderate',  reason: 'Push under 30% for a quick lift' };
      if (value <= 80) return { grade: 'D',  color: '#ef4444', label: 'High',      reason: 'Costs ~30-60 points' };
      return { grade: 'F', color: '#dc2626', label: 'Critical', reason: 'Above 80% costs ~60-100 points' };
    }
    if (metric === 'payment') {
      if (value === 0) return { grade: 'A+', color: '#10b981', label: 'Spotless',  reason: 'Zero lates — strongest signal' };
      if (value === 1) return { grade: 'C',  color: '#f59e0b', label: 'One slip',  reason: '1 late in last 12 mo' };
      if (value <= 3) return { grade: 'D',   color: '#ef4444', label: 'Bumpy',     reason: value + ' lates in last 12 mo' };
      return { grade: 'F', color: '#dc2626', label: 'Critical', reason: value + ' lates damages most' };
    }
    if (metric === 'age') {
      if (!value || value < 1) return { grade: 'F', color: '#dc2626', label: 'New',  reason: 'Less than 1 year of history' };
      if (value < 3) return { grade: 'D', color: '#ef4444', label: 'Thin', reason: 'Under 3 years average' };
      if (value < 7) return { grade: 'C', color: '#f59e0b', label: 'Building', reason: value + ' years — keep oldest open' };
      if (value < 15) return { grade: 'B', color: '#84cc16', label: 'Established', reason: value + ' years — solid base' };
      return { grade: 'A', color: '#10b981', label: 'Mature', reason: value + ' years — strong asset' };
    }
    if (metric === 'mix') {
      // value = { hasRevolving, hasInstallment, hasMortgage }
      var count = 0;
      if (value && value.hasRevolving) count++;
      if (value && value.hasInstallment) count++;
      if (value && value.hasMortgage) count++;
      if (count >= 3) return { grade: 'A',  color: '#10b981', label: 'Diverse',     reason: 'Revolving + installment + mortgage' };
      if (count === 2) return { grade: 'B', color: '#84cc16', label: 'Mixed',       reason: 'Two types — ideal balance' };
      if (count === 1) return { grade: 'C', color: '#f59e0b', label: 'Single-type', reason: 'One type — add another over time' };
      return { grade: 'D', color: '#ef4444', label: 'Empty', reason: 'Add a credit account' };
    }
    if (metric === 'newcredit') {
      var inq = value && value.inquiries != null ? value.inquiries : 0;
      var newAcct = value && value.newAccounts != null ? value.newAccounts : 0;
      var total = inq + newAcct;
      if (total === 0) return { grade: 'A+', color: '#10b981', label: 'Quiet',   reason: 'No recent applications' };
      if (total <= 2) return { grade: 'A',   color: '#22c55e', label: 'Light',   reason: total + ' recent — minor impact' };
      if (total <= 5) return { grade: 'C',   color: '#f59e0b', label: 'Moderate', reason: total + ' in last 12 mo' };
      return { grade: 'D', color: '#ef4444', label: 'Active',  reason: total + ' new credit events — pause apps' };
    }
    return { grade: '—', color: '#94a3b8', label: 'No data', reason: '' };
  }

  function buildFactorBreakdownHTML(p) {
    var s = getState() || {};
    var debts = s.debts || [];
    var hasRevolving = debts.some(function (d) { var t = (d.type || '').toLowerCase(); return /credit|card|cc|revolving/.test(t); });
    var hasInstallment = debts.some(function (d) { var t = (d.type || '').toLowerCase(); return /loan|installment|student|personal|auto|car/.test(t); });
    var hasMortgage = debts.some(function (d) { var t = (d.type || '').toLowerCase(); return /mortgage|home/.test(t); });

    var factors = [
      { name: 'Payment History',   weight: 35, metric: 'payment',     value: p.lates,        why: 'On-time payments are the single biggest factor.' },
      { name: 'Credit Utilization',weight: 30, metric: 'utilization', value: p.overallUtil,  why: 'How much of your card limits you\'re using.' },
      { name: 'Credit Age',        weight: 15, metric: 'age',         value: p.oldestYears,  why: 'Years of established credit history.' },
      { name: 'Credit Mix',        weight: 10, metric: 'mix',         value: { hasRevolving: hasRevolving, hasInstallment: hasInstallment, hasMortgage: hasMortgage }, why: 'Variety of credit types — revolving + installment + mortgage.' },
      { name: 'New Credit',        weight: 10, metric: 'newcredit',   value: { inquiries: p.inquiries, newAccounts: p.newAccts }, why: 'Recent hard inquiries and new accounts.' }
    ];

    var cardsHTML = factors.map(function (f) {
      var g = gradeFor(f.metric, f.value, p);
      return ''
        + '<div style="flex:1;min-width:170px;background:var(--card, var(--bg-2, #fff));border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:12px;padding:14px 16px;border-top:3px solid ' + g.color + ';">'
        +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:8px;">'
        +     '<div><div style="font-size:11.5px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">' + f.name + '</div><div style="font-size:9.5px;letter-spacing:0.08em;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:700;text-transform:uppercase;margin-top:2px;">' + f.weight + '% of score</div></div>'
        +     '<div style="text-align:right;"><div style="font-size:20px;font-weight:900;color:' + g.color + ';line-height:1;letter-spacing:-0.02em;">' + g.grade + '</div><div style="font-size:9.5px;font-weight:800;color:' + g.color + ';margin-top:2px;text-transform:uppercase;letter-spacing:0.04em;">' + g.label + '</div></div>'
        +   '</div>'
        +   '<div style="font-size:11px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;line-height:1.45;margin-top:6px;">' + g.reason + '</div>'
        + '</div>';
    }).join('');

    return ''
      + '<div style="margin-bottom:24px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      +     '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Factor Breakdown</div><div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">What\'s shaping your score, graded from your real data</div></div>'
      +   '</div>'
      +   '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + cardsHTML + '</div>'
      + '</div>';
  }

  // ---------- Page render ----------
  function renderPage(page) {
    var p = computeCreditProfile();
    var actions = buildActions(p);
    var projected = projectedGain(actions);
    var openCount = actions.filter(function (a) { return a.status === 'open'; }).length;
    var doneCount = actions.filter(function (a) { return a.status === 'done'; }).length;

    var bureauStr = '';
    if (p.bureauScores) {
      var b = [];
      Object.keys(p.bureauScores).forEach(function (k) {
        var v = p.bureauScores[k]; var val = v && v.value ? v.value : v;
        if (val) b.push('<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:700;"><span style="width:8px;height:8px;border-radius:50%;background:#a855f7;"></span>' + k.charAt(0).toUpperCase() + k.slice(1) + ' <strong style="color:var(--ink, var(--text-1, #0a0a0a));">' + val + '</strong></span>');
      });
      bureauStr = b.join('<span style="color:var(--text-3);opacity:0.5;margin:0 6px;">·</span>');
    }

    var scoreTrendStr = '';
    if (window.WJP_Snapshots) {
      var d = window.WJP_Snapshots.delta(7);
      if (d && d.score !== 0) {
        var up = d.score > 0;
        scoreTrendStr = '<span style="font-size:11px;color:' + (up ? '#10b981' : '#ef4444') + ';font-weight:800;margin-left:8px;">' + (up ? '↑' : '↓') + ' ' + Math.abs(d.score) + ' this week</span>';
      }
    }

    var heroHTML = ''
      + '<div style="margin-bottom:20px;">'
      +   '<div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Credit Fix</div>'
      +   '<div style="display:flex;align-items:baseline;gap:14px;margin:6px 0 4px;flex-wrap:wrap;">'
      +     '<h1 style="font-size:30px;font-weight:900;letter-spacing:-0.02em;margin:0;color:var(--ink, var(--text-1, #0a0a0a));">Score ' + (p.currentScore || '—') + scoreTrendStr + '</h1>'
      +   '</div>'
      +   (bureauStr ? '<div style="margin:6px 0;">' + bureauStr + '</div>' : '')
      +   '<p style="font-size:13px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:500;max-width:660px;margin:8px 0 0;line-height:1.5;">' + openCount + ' action' + (openCount !== 1 ? 's' : '') + ' open · est. <strong style="color:#10b981;">+' + projected + ' points</strong> if you finish them all.</p>'
      + '</div>';

    // Utilization grid (always show — utilization is the #1 lever)
    var utilGridHTML = '';
    if (p.perCard.length) {
      utilGridHTML = ''
        + '<div style="margin-bottom:24px;">'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
        +     '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Card Utilization</div><div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">Overall ' + (p.overallUtil != null ? Math.round(p.overallUtil) + '%' : '—') + ' · target under 30%</div></div>'
        +   '</div>'
        +   '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;">'
        +     p.perCard.map(function (c) {
                var u = c.util;
                var color = u == null ? '#94a3b8' : u <= 30 ? '#10b981' : u <= 60 ? '#f59e0b' : '#ef4444';
                var bar = u == null ? 0 : Math.min(100, u);
                return ''
                  + '<div style="padding:11px 14px;background:var(--card, var(--bg-2, #fff));border:1px solid ' + color + '33;border-radius:10px;border-left:3px solid ' + color + ';">'
                  +   '<div style="font-size:11.5px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(c.name) + '</div>'
                  +   '<div style="font-size:10px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;margin-bottom:6px;">' + fmtUSD(c.balance) + ' of ' + (c.limit > 0 ? fmtUSD(c.limit) : '—') + '</div>'
                  +   '<div style="height:6px;background:var(--card-2,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;"><div style="height:100%;width:' + bar + '%;background:' + color + ';"></div></div>'
                  +   '<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;color:' + color + ';margin-top:4px;"><span>' + (u != null ? Math.round(u) + '%' : 'no limit') + '</span>' + (u != null && u > 30 ? '<span style="font-weight:600;color:var(--ink-dim, var(--text-3, #94a3b8));">pay ' + fmtUSD(c.balance - c.limit * 0.30) + ' to hit 30%</span>' : '') + '</div>'
                  + '</div>';
              }).join('')
        +   '</div>'
        + '</div>';
    }

    // Action cards
    var actionCardsHTML = ''
      + '<div style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">'
      +   '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--ink-dim, var(--text-3, #94a3b8));text-transform:uppercase;">Action Plan</div><div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">Your highest-impact moves</div></div>'
      +   '<div style="display:flex;gap:8px;font-size:10px;font-weight:700;"><span style="padding:4px 10px;border-radius:999px;background:#10b98122;color:#10b981;">' + doneCount + ' done</span><span style="padding:4px 10px;border-radius:999px;background:rgba(148,163,184,0.15);color:#94a3b8;">' + openCount + ' open</span></div>'
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;">'
      + actions.map(actionCardHTML).join('')
      + '</div>';

    // Projection footer
    var projectionHTML = projected > 0 ? ''
      + '<div style="margin-top:24px;padding:18px 22px;background:linear-gradient(135deg,rgba(16,185,129,0.10),rgba(99,102,241,0.10));border:1px solid rgba(16,185,129,0.30);border-radius:14px;">'
      +   '<div style="display:flex;align-items:center;gap:12px;">'
      +     '<div style="width:42px;height:42px;border-radius:11px;background:rgba(16,185,129,0.20);display:grid;place-items:center;"><i class="ph-fill ph-rocket-launch" style="font-size:20px;color:#10b981;"></i></div>'
      +     '<div style="flex:1;"><div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:#10b981;">If you finish everything open</div><div style="font-size:18px;font-weight:900;color:var(--ink, var(--text-1, #0a0a0a));margin-top:2px;">Your score could move from ' + (p.currentScore || '—') + ' to ~' + ((p.currentScore || 0) + projected) + ' (+' + projected + ' pts)</div><div style="font-size:11px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:600;margin-top:4px;">Rough estimate · actual gain depends on reporting cycles, bureau timing, and which factors move first.</div></div>'
      +   '</div>'
      + '</div>' : '';

    // v8: Replace the failing host embed with our own polished Score Detail
    // + Factor Breakdown sections. Cleaner, fully visible, Array-ready.
    var scoreDetailHTML = buildScoreDetailHTML(p);
    var factorBreakdownHTML = buildFactorBreakdownHTML(p);

    var offersHTML = buildOffersHTML(p);
    var buildCreditHTML = buildBuildCreditHTML(p);
    page.innerHTML = heroHTML + scoreDetailHTML + factorBreakdownHTML + utilGridHTML + actionCardsHTML + offersHTML + buildCreditHTML + projectionHTML;

    // Wire action buttons
    Array.from(page.querySelectorAll('[data-bc-interest]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-bc-interest');
        try {
          var key = 'wjp.array.partner.interest';
          var rec = loadJSON(key, {});
          rec[p] = { ts: Date.now() };
          saveJSON(key, rec);
        } catch (_) {}
        if (window.WJP_Momentum && typeof window.WJP_Momentum.showToast === 'function') {
          window.WJP_Momentum.showToast({
            eyebrow: 'INTEREST REGISTERED',
            title: 'We\'ll email you when ' + p + ' goes live',
            sub: 'Targeting launch within 4-6 weeks via our partnership with Array.',
            color: '#06b6d4',
            icon: 'ph-fill ph-bell'
          });
        }
      });
    });

    Array.from(page.querySelectorAll('[data-action-cta]')).forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = b.getAttribute('data-action-cta');
        var newStatus = b.getAttribute('data-new-status') || 'done';
        var st = loadJSON(ACTIONS_KEY, {});
        st[id] = { status: newStatus, ts: Date.now() };
        saveJSON(ACTIONS_KEY, st);
        // celebrate
        if (newStatus === 'done' && window.WJP_Momentum) {
          try {
            window.WJP_Momentum.showToast({
              eyebrow: 'CREDIT WIN',
              title: 'Action complete — keep stacking',
              sub: 'Score gains take 30-60 days to show up on the bureau. Your work today shows up next month.',
              color: '#10b981',
              icon: 'ph-fill ph-check-circle'
            });
          } catch (_) {}
        }
        renderPage(page);
      });
    });
  }

  function actionCardHTML(a) {
    var diffColor = a.difficulty === 'easy' ? '#10b981' : a.difficulty === 'medium' ? '#f59e0b' : '#ef4444';
    var statusBadge = a.status === 'done'
      ? '<span style="background:#10b98122;color:#10b981;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">✓ Done</span>'
      : a.status === 'in-progress'
        ? '<span style="background:#f59e0b22;color:#f59e0b;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">⋯ In progress</span>'
        : '<span style="background:rgba(148,163,184,0.15);color:#94a3b8;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">Open</span>';
    var fade = a.status === 'done' ? 'opacity:0.55;' : '';

    var ctaButtons = '';
    if (a.status === 'open') {
      ctaButtons = '<button type="button" data-action-cta="' + a.id + '" data-new-status="in-progress" style="background:transparent;color:' + a.accent + ';border:1px solid ' + a.accent + ';padding:7px 14px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">Start</button>'
        + '<button type="button" data-action-cta="' + a.id + '" data-new-status="done" style="background:' + a.accent + ';color:#fff;border:0;padding:7px 14px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">' + a.ctaLabel + '</button>';
    } else if (a.status === 'in-progress') {
      ctaButtons = '<button type="button" data-action-cta="' + a.id + '" data-new-status="open" style="background:transparent;color:#94a3b8;border:1px solid #94a3b855;padding:7px 14px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">Reopen</button>'
        + '<button type="button" data-action-cta="' + a.id + '" data-new-status="done" style="background:' + a.accent + ';color:#fff;border:0;padding:7px 14px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">' + a.ctaLabel + '</button>';
    } else {
      ctaButtons = '<button type="button" data-action-cta="' + a.id + '" data-new-status="open" style="background:transparent;color:#94a3b8;border:1px solid #94a3b855;padding:7px 14px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">Undo</button>';
    }

    return ''
      + '<div style="background:var(--card, var(--bg-2, #fff));border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:12px;padding:14px 18px;display:flex;gap:14px;align-items:flex-start;' + fade + '">'
      +   '<div style="width:38px;height:38px;border-radius:10px;background:' + a.accent + '22;display:grid;place-items:center;color:' + a.accent + ';flex-shrink:0;"><i class="' + a.icon + '" style="font-size:18px;"></i></div>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:4px;flex-wrap:wrap;">'
      +       '<div style="font-size:14px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));line-height:1.3;flex:1;min-width:200px;">' + escapeHTML(a.title) + '</div>'
      +       '<div style="display:flex;gap:6px;align-items:center;">'
      +         (a.estGain > 0 ? '<span style="font-size:9.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:#10b98122;color:#10b981;letter-spacing:0.05em;">+' + a.estGain + ' pts</span>' : '')
      +         '<span style="font-size:9.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:' + diffColor + '22;color:' + diffColor + ';letter-spacing:0.06em;text-transform:uppercase;">' + a.difficulty + '</span>'
      +         statusBadge
      +       '</div>'
      +     '</div>'
      +     '<div style="font-size:12px;color:var(--ink-dim, var(--text-3, #94a3b8));font-weight:500;line-height:1.5;margin-bottom:10px;">' + escapeHTML(a.summary) + '</div>'
      +     '<div style="display:flex;gap:8px;">' + ctaButtons + '</div>'
      +   '</div>'
      + '</div>';
  }

  // ---------- Tick ----------
  function tick() {
    try {
      ensureNavItem();
      hideDuplicateSubtab();
      var ourNav = document.getElementById(NAV_ID);
      var ourPage = document.getElementById(PAGE_ID);
      var ourNavActive = ourNav && ourNav.classList.contains('active');
      // Detect if a host nav is active (any nav-item with .active that isn't ours)
      var hostActiveNav = Array.from(document.querySelectorAll('.nav-item.active')).find(function (n) { return n.id !== NAV_ID; });
      // Detect a host page that has .active class (host's render put it there)
      var hostActivePage = Array.from(document.querySelectorAll('.page.active, [id^="page-"].active')).find(function (p) { return p.id !== PAGE_ID; });

      // RULE 1: If host nav or page is now active, retire ours.
      if (hostActiveNav || hostActivePage) {
        if (ourPage) { ourPage.style.display = 'none'; ourPage.classList.remove('active'); }
        if (ourNav) ourNav.classList.remove('active');
        // Clear inline display we set on other pages so host CSS owns them again.
        Array.from(document.querySelectorAll('[id^="page-"]')).forEach(function (p) {
          if (p.id !== PAGE_ID && p.dataset.wjpDeactivated) {
            p.style.display = '';
            delete p.dataset.wjpDeactivated;
          }
        });
      } else if (ourNavActive) {
        // We're the active page — auto-refresh data
        if (ourPage && ourPage.offsetHeight > 0) {
          var sig = (function () { var p = computeCreditProfile(); return p.totalBalance + '|' + p.totalLimit + '|' + (p.currentScore || 0); })();
          if (window._wjpCreditLastSig !== sig) {
            window._wjpCreditLastSig = sig;
            renderPage(ourPage);
          }
        }
      }
    } catch (_) {}
  }
    document.addEventListener('click', function (e) {
    var hostNav = e.target.closest && e.target.closest('.nav-item[data-page]');
    if (!hostNav) return;
    if (hostNav.id === NAV_ID) return;
    var ourPage = document.getElementById(PAGE_ID);
    var ourNav = document.getElementById(NAV_ID);
    if (ourPage) { ourPage.style.display = 'none'; ourPage.classList.remove('active'); }
    if (ourNav) ourNav.classList.remove('active');
    Array.from(document.querySelectorAll('[id^="page-"]')).forEach(function (p) {
      if (p.id !== PAGE_ID && p.style.display === 'none') {
        p.style.display = '';
        delete p.dataset.wjpDeactivated;
      }
    });
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 2000); });
  else setTimeout(tick, 2000);
  setInterval(tick, 1500);

  window.WJP_CreditActions = {
    profile: computeCreditProfile,
    actions: function () { return buildActions(computeCreditProfile()); },
    show: showCreditPage
  };
})();
