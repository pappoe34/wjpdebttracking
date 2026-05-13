/* wjp-credit-actions.js v4 — consolidate: embed host renderCreditScoreTab inside our page, hide duplicate Debts subtab
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
        if (val) b.push('<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-3,#94a3b8);font-weight:700;"><span style="width:8px;height:8px;border-radius:50%;background:#a855f7;"></span>' + k.charAt(0).toUpperCase() + k.slice(1) + ' <strong style="color:var(--text-1,#0a0a0a);">' + val + '</strong></span>');
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
      +   '<div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Credit Fix</div>'
      +   '<div style="display:flex;align-items:baseline;gap:14px;margin:6px 0 4px;flex-wrap:wrap;">'
      +     '<h1 style="font-size:30px;font-weight:900;letter-spacing:-0.02em;margin:0;color:var(--text-1,#0a0a0a);">Score ' + (p.currentScore || '—') + scoreTrendStr + '</h1>'
      +   '</div>'
      +   (bureauStr ? '<div style="margin:6px 0;">' + bureauStr + '</div>' : '')
      +   '<p style="font-size:13px;color:var(--text-3,#94a3b8);font-weight:500;max-width:660px;margin:8px 0 0;line-height:1.5;">' + openCount + ' action' + (openCount !== 1 ? 's' : '') + ' open · est. <strong style="color:#10b981;">+' + projected + ' points</strong> if you finish them all.</p>'
      + '</div>';

    // Utilization grid (always show — utilization is the #1 lever)
    var utilGridHTML = '';
    if (p.perCard.length) {
      utilGridHTML = ''
        + '<div style="margin-bottom:24px;">'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
        +     '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Card Utilization</div><div style="font-size:15px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:2px;">Overall ' + (p.overallUtil != null ? Math.round(p.overallUtil) + '%' : '—') + ' · target under 30%</div></div>'
        +   '</div>'
        +   '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">'
        +     p.perCard.map(function (c) {
                var u = c.util;
                var color = u == null ? '#94a3b8' : u <= 30 ? '#10b981' : u <= 60 ? '#f59e0b' : '#ef4444';
                var bar = u == null ? 0 : Math.min(100, u);
                return ''
                  + '<div style="padding:11px 14px;background:var(--card,#fff);border:1px solid ' + color + '33;border-radius:10px;border-left:3px solid ' + color + ';">'
                  +   '<div style="font-size:11.5px;font-weight:800;color:var(--text-1,#0a0a0a);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(c.name) + '</div>'
                  +   '<div style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:600;margin-bottom:6px;">' + fmtUSD(c.balance) + ' of ' + (c.limit > 0 ? fmtUSD(c.limit) : '—') + '</div>'
                  +   '<div style="height:6px;background:var(--card-2,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;"><div style="height:100%;width:' + bar + '%;background:' + color + ';"></div></div>'
                  +   '<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;color:' + color + ';margin-top:4px;"><span>' + (u != null ? Math.round(u) + '%' : 'no limit') + '</span>' + (u != null && u > 30 ? '<span style="font-weight:600;color:var(--text-3,#94a3b8);">pay ' + fmtUSD(c.balance - c.limit * 0.30) + ' to hit 30%</span>' : '') + '</div>'
                  + '</div>';
              }).join('')
        +   '</div>'
        + '</div>';
    }

    // Action cards
    var actionCardsHTML = ''
      + '<div style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">'
      +   '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Action Plan</div><div style="font-size:15px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:2px;">Your highest-impact moves</div></div>'
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
      +     '<div style="flex:1;"><div style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:#10b981;">If you finish everything open</div><div style="font-size:18px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;">Your score could move from ' + (p.currentScore || '—') + ' to ~' + ((p.currentScore || 0) + projected) + ' (+' + projected + ' pts)</div><div style="font-size:11px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:4px;">Rough estimate · actual gain depends on reporting cycles, bureau timing, and which factors move first.</div></div>'
      +   '</div>'
      + '</div>' : '';

    // v4: Embed the host's rich Credit Score view (FICO gauge, factor breakdown,
    // what-if simulator) so the user has ONE Credit page instead of two.
    var hostScoreEmbedHTML = ''
      + '<div style="margin-bottom:24px;">'
      +   '<div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;margin-bottom:10px;">Score detail · factor breakdown · what-if</div>'
      +   '<div id="credit-score-tab-content" style="min-height:200px;"></div>'
      + '</div>';

    page.innerHTML = heroHTML + utilGridHTML + hostScoreEmbedHTML + actionCardsHTML + projectionHTML;

    // Trigger the host renderer to populate our embedded container
    try { if (typeof window.renderCreditScoreTab === 'function') window.renderCreditScoreTab(); } catch (_) {}

    // Wire action buttons
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
      + '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:12px;padding:14px 18px;display:flex;gap:14px;align-items:flex-start;' + fade + '">'
      +   '<div style="width:38px;height:38px;border-radius:10px;background:' + a.accent + '22;display:grid;place-items:center;color:' + a.accent + ';flex-shrink:0;"><i class="' + a.icon + '" style="font-size:18px;"></i></div>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:4px;flex-wrap:wrap;">'
      +       '<div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);line-height:1.3;flex:1;min-width:200px;">' + escapeHTML(a.title) + '</div>'
      +       '<div style="display:flex;gap:6px;align-items:center;">'
      +         (a.estGain > 0 ? '<span style="font-size:9.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:#10b98122;color:#10b981;letter-spacing:0.05em;">+' + a.estGain + ' pts</span>' : '')
      +         '<span style="font-size:9.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:' + diffColor + '22;color:' + diffColor + ';letter-spacing:0.06em;text-transform:uppercase;">' + a.difficulty + '</span>'
      +         statusBadge
      +       '</div>'
      +     '</div>'
      +     '<div style="font-size:12px;color:var(--text-3,#94a3b8);font-weight:500;line-height:1.5;margin-bottom:10px;">' + escapeHTML(a.summary) + '</div>'
      +     '<div style="display:flex;gap:8px;">' + ctaButtons + '</div>'
      +   '</div>'
      + '</div>';
  }

  // ---------- Tick ----------
  function tick() {
    try {
      ensureNavItem();
      hideDuplicateSubtab();
      var creditActive = document.getElementById(NAV_ID) && document.getElementById(NAV_ID).classList.contains('active');
      var anyHostActive = Array.from(document.querySelectorAll('.nav-item.active')).some(function (n) { return n.id !== NAV_ID; });
      if (anyHostActive && creditActive) {
        var page = document.getElementById(PAGE_ID);
        if (page) { page.style.display = 'none'; page.classList.remove('active'); }
        var nav = document.getElementById(NAV_ID); if (nav) nav.classList.remove('active');
      } else if (creditActive) {
        // Auto-refresh while visible — picks up Plaid balance changes
        var page = document.getElementById(PAGE_ID);
        if (page && page.offsetHeight > 0) {
          // Only re-render if numbers actually changed (cheap check)
          var sig = (function () { var p = computeCreditProfile(); return p.totalBalance + '|' + p.totalLimit + '|' + (p.currentScore||0); })();
          if (window._wjpCreditLastSig !== sig) {
            window._wjpCreditLastSig = sig;
            renderPage(page);
          }
        }
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 2000); });
  else setTimeout(tick, 2000);
  setInterval(tick, 1500);

  window.WJP_CreditActions = {
    profile: computeCreditProfile,
    actions: function () { return buildActions(computeCreditProfile()); },
    show: showCreditPage
  };
})();
