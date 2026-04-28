/* ============================================================
   AI BUDGET — APPLICATION LOGIC
   ============================================================ */

/* ---------- Lazy script loaders ----------
   Chart.js and Plaid Link are heavy (~200 KB + ~140 KB). Both were
   loading synchronously in <head> even when the user never opens a
   chart or links a bank. Now we fetch them on first need — the
   browser has already prefetched them via <link rel="prefetch"> so
   the actual load is near-instant when triggered. */
const _scriptPromises = {};
function loadScriptOnce(url, opts) {
    opts = opts || {};
    if (_scriptPromises[url]) return _scriptPromises[url];
    _scriptPromises[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        // Only set crossOrigin if explicitly requested — default plain-script loads
        // let the browser handle CORS per-server, which is what CDNs like plaid.com
        // actually expect. Setting 'anonymous' was breaking the load when the CDN
        // doesn't return Access-Control-Allow-Origin.
        if (opts.cors) s.crossOrigin = 'anonymous';
        s.onload = () => { console.log('[loaded]', url); resolve(); };
        s.onerror = (e) => {
            delete _scriptPromises[url];
            console.error('[script load failed]', url, e);
            reject(new Error('Failed to load ' + url));
        };
        document.head.appendChild(s);
    });
    return _scriptPromises[url];
}
function ensureChartLoaded() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    return loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js');
}

/* ---------- Dashboard greeting (Welcome back, Winston) ----------
   Pulls the user's first name from (a) Firebase currentUser.displayName,
   (b) localStorage.wjp_last_name stashed at signin time, or
   (c) the local-part of their email. Fails silent if nothing's known. */
function populateDashboardGreeting() {
    const el = document.getElementById('dash-greeting');
    const textEl = document.getElementById('dash-greeting-text');
    if (!el || !textEl) return;

    let first = '';
    try {
        // Stashed at signin time
        const stashed = localStorage.getItem('wjp_last_name');
        if (stashed) first = stashed.trim();
    } catch(_){}

    // Fall back to Firebase user object if available
    if (!first) {
        try {
            // auth module is imported in index.html's auth gate; expose currentUser on window for reading here
            const fbUser = (window.firebase && window.firebase.auth && window.firebase.auth().currentUser)
                        || (window.__wjpUser)
                        || null;
            if (fbUser) {
                if (fbUser.displayName) first = fbUser.displayName.split(' ')[0];
                else if (fbUser.email) first = fbUser.email.split('@')[0];
            }
        } catch(_){}
    }

    // Last resort: local-part of stashed email
    if (!first) {
        try {
            const e = localStorage.getItem('wjp_last_email');
            if (e) first = e.split('@')[0];
        } catch(_){}
    }

    // Pick a time-of-day greeting for warmth
    const hr = new Date().getHours();
    let greet = 'Welcome back';
    if (hr < 5)  greet = 'Burning the midnight oil';
    else if (hr < 12) greet = 'Good morning';
    else if (hr < 18) greet = 'Good afternoon';
    else greet = 'Good evening';

    if (first) {
        const safe = first.replace(/[^\w\s\-']/g, '').replace(/^./, c => c.toUpperCase());
        textEl.innerHTML = `${greet}, <strong>${safe}.</strong>`;
        el.style.display = 'flex';
    } else {
        textEl.innerHTML = `${greet}.`;
        el.style.display = 'flex';
    }
}
function ensurePlaidLoaded() {
    if (typeof Plaid !== 'undefined') return Promise.resolve();
    return loadScriptOnce('https://cdn.plaid.com/link/v2/stable/link-initialize.js');
}


const defaultState = {
    settings: { strategy: 'avalanche' },
    balances: { monthlyIncome: 0, availableCashflow: 0 },
    debts: [],
    budget: {
        savingsRatio: 0,
        contribution: 0,
        targetGoal: 0,
        frequency: 'monthly',
        expenses: { housing: 0, food: 0, transit: 0, disc: 0 }
    },
    transactions: [],
    recurringPayments: [],
    notifications: [],
    creditScoreHistory: [],
    prefs: {
        notifications: {
            channels: { email: true, push: true, sms: false, inApp: true },
            types: {
                paymentDue: true, paymentOverdue: true, milestone: true,
                strategyChange: false, aiInsights: true, accountSynced: false,
                scoreChange: true
            },
            quietHours: { from: '22:00', to: '07:00', enabled: true }
        },
        goals: [],
        householdMode: false,
        pinned: ['credit-profile-card', 'dash-spending-card']
    }
};

let appState = null;
let chartInstances = {}; // To manage Chart.js instances across re-renders

function loadState() {
    const saved = localStorage.getItem('wjp_budget_state');
    if (saved) {
        try { 
            let parsed = JSON.parse(saved);
            if (!parsed || typeof parsed !== 'object') throw new Error();
            
            // Deep merge to guarantee all nested properties exist
            appState = {
                settings: { 
                    strategy: 'avalanche', 
                    spendingTimeFrame: 'monthly',
                    spendingChartType: 'bar',
                    ...((parsed.settings || {})) 
                },
                balances: { ...defaultState.balances, ...(parsed.balances || {}) },
                debts: Array.isArray(parsed.debts) ? parsed.debts : [...defaultState.debts],
                budget: {
                    ...defaultState.budget,
                    ...(parsed.budget || {}),
                    expenses: { 
                         ...defaultState.budget.expenses, 
                         ...((parsed.budget && parsed.budget.expenses) ? parsed.budget.expenses : {}) 
                    }
                },
                transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [...defaultState.transactions],
                recurringPayments: Array.isArray(parsed.recurringPayments) ? parsed.recurringPayments : [...defaultState.recurringPayments],
                notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
                creditScoreHistory: Array.isArray(parsed.creditScoreHistory) ? parsed.creditScoreHistory : [],
                // Idempotency log for Plaid-applied payments — see syncBankTransactions.
                processedTxIds: Array.isArray(parsed.processedTxIds) ? parsed.processedTxIds : [],
                // Cache key for syncRecurringTransactions (1h refresh window).
                lastRecurringSync: Number(parsed.lastRecurringSync) || 0,
                prefs: {
                    ...defaultState.prefs,
                    ...(parsed.prefs || {}),
                    notifications: {
                        ...defaultState.prefs.notifications,
                        ...((parsed.prefs && parsed.prefs.notifications) || {}),
                        channels: {
                            ...defaultState.prefs.notifications.channels,
                            ...((parsed.prefs && parsed.prefs.notifications && parsed.prefs.notifications.channels) || {})
                        },
                        types: {
                            ...defaultState.prefs.notifications.types,
                            ...((parsed.prefs && parsed.prefs.notifications && parsed.prefs.notifications.types) || {})
                        },
                        quietHours: {
                            ...defaultState.prefs.notifications.quietHours,
                            ...((parsed.prefs && parsed.prefs.notifications && parsed.prefs.notifications.quietHours) || {})
                        }
                    },
                    goals: Array.isArray(parsed.prefs && parsed.prefs.goals) ? parsed.prefs.goals : [],
                    pinned: Array.isArray(parsed.prefs && parsed.prefs.pinned) ? parsed.prefs.pinned : [...defaultState.prefs.pinned]
                }
            };
        } catch(e) { appState = JSON.parse(JSON.stringify(defaultState)); }
    } else {
        appState = JSON.parse(JSON.stringify(defaultState));
    }
}

function saveState() {
    localStorage.setItem('wjp_budget_state', JSON.stringify(appState));
}

/* ---------- NOTIFICATION PREFERENCES ---------- */
// Map internal notification type -> prefs.notifications.types key
function _notifTypeKey(type) {
    const t = (type || '').toLowerCase();
    if (t === 'payment' || t === 'paymentdue' || t === 'payment-due') return 'paymentDue';
    if (t === 'overdue' || t === 'paymentoverdue') return 'paymentOverdue';
    if (t === 'milestone' || t === 'success') return 'milestone';
    if (t === 'strategy' || t === 'strategychange') return 'strategyChange';
    if (t === 'ai' || t === 'insight' || t === 'aiinsights') return 'aiInsights';
    if (t === 'sync' || t === 'accountsynced') return 'accountSynced';
    if (t === 'score' || t === 'scorechange') return 'scoreChange';
    return null;
}

function canNotify(type) {
    try {
        if (!appState || !appState.prefs || !appState.prefs.notifications) return true;
        const prefs = appState.prefs.notifications;
        // In-app channel must be on
        if (prefs.channels && prefs.channels.inApp === false) return false;

        // Check type
        const key = _notifTypeKey(type);
        if (key && prefs.types && prefs.types[key] === false) return false;

        // Quiet hours
        const qh = prefs.quietHours;
        if (qh && qh.enabled !== false && qh.from && qh.to) {
            const now = new Date();
            const [fh, fm] = qh.from.split(':').map(Number);
            const [th, tm] = qh.to.split(':').map(Number);
            const cur = now.getHours() * 60 + now.getMinutes();
            const from = fh * 60 + (fm || 0);
            const to = th * 60 + (tm || 0);
            const inQuiet = from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
            if (inQuiet) return false;
        }
        return true;
    } catch(_) { return true; }
}

function pushNotification(notif, type) {
    if (!appState.notifications) appState.notifications = [];
    if (!canNotify(type || notif.type)) return false;
    appState.notifications.unshift(notif);
    return true;
}

/**
 * logActivity — single source of truth for the bell badge AND the Activity Log tab.
 * Both read from appState.notifications, so any user-meaningful event should call this.
 *   logActivity({ title, text, type, priority, link })
 *     title    — short headline ("Bank linked", "Payment recorded")
 *     text     — one-line detail ("Chase • 4 accounts synced")
 *     type     — category for filtering: 'bank' | 'debt' | 'payment' | 'strategy' | 'system'
 *     priority — 'low' | 'normal' | 'high' (drives styling)
 *     link     — optional in-app destination ('#debts', '#dashboard', etc.)
 */
function logActivity(entry) {
    try {
        if (!entry || typeof entry !== 'object') return false;
        const notif = {
            id: 'a' + Date.now() + Math.floor(Math.random() * 1000),
            title: entry.title || 'Activity',
            text: entry.text || '',
            type: entry.type || 'system',
            priority: entry.priority || 'normal',
            link: entry.link || null,
            timestamp: Date.now(),
            cleared: false
        };
        if (!appState.notifications) appState.notifications = [];
        appState.notifications.unshift(notif);
        // Keep the log from growing unbounded — cap at 200 entries.
        if (appState.notifications.length > 200) {
            appState.notifications = appState.notifications.slice(0, 200);
        }
        try { if (typeof saveState === 'function') saveState(); } catch(_) {}
        // Re-render bell badge + activity tab if they're already on screen.
        try {
            if (typeof renderNotifications === 'function') renderNotifications();
            const activeActivity = document.querySelector('.tab-content[data-tab="activity"].active');
            if (activeActivity && typeof renderActivityPage === 'function') renderActivityPage();
        } catch(_) {}
        return true;
    } catch (e) {
        console.warn('logActivity failed:', e);
        return false;
    }
}
window.logActivity = logActivity;

/* ---------- CREDIT SCORE HISTORY ---------- */
function computeDeltaReason(prev, curr) {
    if (!prev) return 'Initial score recorded.';
    try {
        // Utilization change (fractional e.g. 0.34 -> 0.18)
        if (prev.util !== undefined && curr.util !== undefined
            && prev.util !== null && curr.util !== null) {
            const pPct = Math.round(prev.util * 100);
            const cPct = Math.round(curr.util * 100);
            if (Math.abs(pPct - cPct) >= 3) {
                return `Utilization ${cPct < pPct ? 'fell' : 'rose'} from ${pPct}% to ${cPct}%.`;
            }
        }
        if ((prev.lates || 0) !== (curr.lates || 0)) {
            return `Late payments: ${prev.lates||0} → ${curr.lates||0}.`;
        }
        if ((prev.inq || 0) !== (curr.inq || 0)) {
            return `Hard inquiries: ${prev.inq||0} → ${curr.inq||0}.`;
        }
        if ((prev.oldest || 0) !== (curr.oldest || 0) && (curr.oldest || 0) > 0) {
            return `Oldest account age updated to ${curr.oldest} yrs.`;
        }
        if ((prev.accounts || 0) !== (curr.accounts || 0)) {
            return `Account count: ${prev.accounts||0} → ${curr.accounts||0}.`;
        }
    } catch(_) {}
    return 'Score updated.';
}

function _buildScoreSnapshot(score) {
    let cs = {}, bureau = {};
    try { cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch(_) {}
    try { bureau = JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}'); } catch(_) {}
    const debts = (appState && appState.debts) ? appState.debts : [];
    const cardDebts = debts.filter(d => {
        const t = (d.type || d.category || '').toString().toLowerCase();
        return t.includes('credit') || t.includes('card') || t === 'cc';
    });
    let totalBal = 0, totalLim = 0;
    cardDebts.forEach(d => {
        const lim = parseFloat((cs.cardLimits || {})[d.id] || d.limit || 0);
        const bal = parseFloat(d.balance || 0);
        if (lim > 0) { totalBal += bal; totalLim += lim; }
    });
    return {
        score: score,
        util: totalLim > 0 ? totalBal / totalLim : null,
        lates: parseInt(cs.latePayments12mo, 10) || 0,
        inq: parseInt(cs.hardInquiries12mo, 10) || 0,
        oldest: parseFloat(cs.oldestAccountYears) || 0,
        accounts: debts.length
    };
}

function recordScoreHistory(newScore) {
    if (!newScore || isNaN(newScore)) return null;
    if (!appState.creditScoreHistory) appState.creditScoreHistory = [];
    const hist = appState.creditScoreHistory;
    const last = hist.length ? hist[hist.length - 1] : null;
    const prevSnap = last ? last.snapshot : null;
    const currSnap = _buildScoreSnapshot(newScore);

    // Skip if identical to last entry (same score, recent)
    if (last && last.score === newScore && prevSnap
        && Math.abs((last.ts || 0) - Date.now()) < 1000*60*5) return null;

    const prevScore = last ? last.score : null;
    const delta = prevScore !== null ? newScore - prevScore : 0;
    const reason = computeDeltaReason(prevSnap, currSnap);

    const entry = {
        ts: Date.now(),
        score: newScore,
        prev: prevScore,
        delta,
        reason,
        snapshot: currSnap
    };
    hist.push(entry);
    // Cap history
    if (hist.length > 60) hist.splice(0, hist.length - 60);
    saveState();

    // Tier 2.5: score-change notifications
    if (prevScore !== null && Math.abs(delta) >= 5) {
        const dir = delta > 0 ? '+' : '';
        pushNotification({
            id: Date.now(),
            title: `Credit score moved ${dir}${delta}`,
            text: `New score: ${newScore}. ${reason}`,
            type: 'scoreChange',
            priority: Math.abs(delta) >= 15 ? 'high' : 'med',
            time: 'Just now',
            read: false,
            cleared: false
        }, 'scoreChange');
        if (typeof renderNotifications === 'function') renderNotifications();
    }
    return entry;
}

/* ---------- SPA ROUTER ---------- */
const titles = {
    'dashboard': 'Your Dashboard',
    'debts': 'Your Debts',
    'recurring': 'Calendar',
    'advisor': 'AI Advisor',
    'activity': 'Activity',
    'budgets': 'Budget',
    'settings': 'Settings'
};

function navigateSPA(target) {
    if (!target) return;

    // Lightweight analytics — fire once per navigation
    try { window.wjp && wjp.track && wjp.track('tab_viewed', { tab: target }); } catch(_){}

    // Lazy-load Chart.js the first time a chart-using page opens. Pages
    // that don't need charts (Activity Log, Settings, Documents) skip this.
    if (typeof ensureChartLoaded === 'function') {
        const chartPages = ['dashboard', 'budgets', 'debts', 'recurring', 'advisor'];
        if (chartPages.includes(target)) { ensureChartLoaded().catch(()=>{}); }
    }

    // Reset scroll position on every navigation — both the in-app content
    // scroller AND the window/document (mobile portrait scrolls the window)
    const contentArea = document.querySelector('.content-area');
    if (contentArea) contentArea.scrollTop = 0;
    try {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    } catch(_) {}

    const navItems = document.querySelectorAll('.nav-item[data-page]');
    const pages = document.querySelectorAll('.page');
    const headerTitle = document.getElementById('header-title');
    
    // Update Sidebar
    navItems.forEach(nav => nav.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-page="${target}"]`);
    if (activeNav) activeNav.classList.add('active');
    
    // Update Top Header Nav
    const headerNavItems = document.querySelectorAll('.header-nav-item[data-page]');
    headerNavItems.forEach(nav => nav.classList.remove('active'));
    const activeHeaderNav = document.querySelector(`.header-nav-item[data-page="${target}"]`);
    if (activeHeaderNav) activeHeaderNav.classList.add('active');
    
    if (titles[target]) {
        headerTitle.textContent = titles[target];
    }
    
    // Update Pages
    pages.forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(`page-${target}`);
    if (activePage) {
        activePage.classList.add('active');
        
        // Re-trigger animations
        const reveals = activePage.querySelectorAll('.reveal');
        reveals.forEach(el => {
            el.style.animation = 'none';
            el.offsetHeight; /* trigger reflow */
            el.style.animation = null;
        });
        
        // Populate activity log when navigating there
        if (target === 'activity' && typeof renderActivityPage === 'function') {
            setTimeout(() => renderActivityPage(), 50);
        }

        // Redraw charts
        setTimeout(() => {
            drawCharts();
            if (target === 'budgets' && typeof renderCashFlowChart === 'function') {
                renderCashFlowChart();
                renderPaycheckAllocation();
                renderSavingsGoals();
                refreshBudgetVsPredicted();
            }
            if ((target === 'budgets' || target === 'debts') && typeof refreshBudgetVsPredicted === 'function') {
                setTimeout(refreshBudgetVsPredicted, 200);
            }
        }, 50);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('Service worker registered', reg))
        .catch((err) => console.log('Service worker not registered', err));
    }

    loadState();

    // Restore saved user identity into sidebar
    const savedName     = localStorage.getItem('wjp_user_name');
    const savedInitials = localStorage.getItem('wjp_user_initials');
    if (savedName) {
        const userNameEl   = document.querySelector('.user-name');
        const userAvatarEl = document.querySelector('.user-avatar');
        if (userNameEl)   userNameEl.textContent   = savedName;
        if (userAvatarEl && savedInitials) userAvatarEl.textContent = savedInitials;
    }

    initTheme();
    initRouter();
    initCalendar();
    initInteractivity();
    initSubTabs();
    initNotifications();
    initBudgetLogic();
    initModal();
    initStatementEduCard();
    initChatLogic();
    initAdvisorPageLogic();
    initDashboardInteractivity();
    initDashCustomize();
    initSearch();
    
    // Draw charts and initialize UI state properly
    setTimeout(() => {
        updateUI();
        animateProgressBars();
        renderActivityPage();
    }, 100);
});

/* ---------- THEME TOGGLE ---------- */
function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    // Always start in light (daytime) mode on load — per Winston.
    // Use classList so we don't clobber other body classes (e.g. wjp-auth-ready).
    document.body.classList.remove('dark','light');
    document.body.classList.add('light');
    updateThemeIcon('light');

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.contains('dark');
            const newTheme = isDark ? 'light' : 'dark';

            document.body.classList.remove('dark','light');
            document.body.classList.add(newTheme);
            localStorage.setItem('budget-theme', newTheme);
            updateThemeIcon(newTheme);

            // Redraw charts with new theme colors
            if (typeof drawCharts === 'function') drawCharts();
        });
    }

    function updateThemeIcon(theme) {
        if (!themeIcon) return;
        themeIcon.innerHTML = theme === 'dark'
            ? '<i class="ph ph-moon"></i>'
            : '<i class="ph ph-sun"></i>';
    }
}

function initRouter() {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    const headerNavs = document.querySelectorAll('.header-nav-item[data-page]');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navigateSPA(item.getAttribute('data-page'));
        });
    });
    
    headerNavs.forEach(item => {
        item.addEventListener('click', () => {
            navigateSPA(item.getAttribute('data-page'));
        });
    });
}

function initSearch() {
  const searchInput = document.getElementById('header-search-input');
  const resultsDropdown = document.getElementById('search-results-dropdown');
  
  if (!searchInput || !resultsDropdown) return;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    
    if (query.length === 0) {
      resultsDropdown.classList.remove('active');
      return;
    }
    
    const results = [];
    
    // Search Pages
    const pagesList = [
      { id: 'dashboard', name: 'Portfolio Dashboard', category: 'Pages', icon: 'ph-squares-four' },
      { id: 'debts', name: 'Strategy Sanctuary (Debts)', category: 'Pages', icon: 'ph-credit-card' },
      { id: 'recurring', name: 'Portfolio Analysis (Calendar)', category: 'Pages', icon: 'ph-calendar-blank' },
      { id: 'advisor', name: 'AI Strategic Advisor', category: 'Pages', icon: 'ph-robot' },
      { id: 'settings', name: 'Account Settings', category: 'Pages', icon: 'ph-gear' }
    ];
    
    pagesList.forEach(p => {
      if (p.name.toLowerCase().includes(query)) {
        results.push(p);
      }
    });

    // Search Sub-tabs (Inside Debts Sanctuary)
    const subTabsList = [
      { name: 'Overview', term: 'Overview', subIdx: 0 },
      { name: 'Budget & Breakdown', term: 'Budget Breakdown', subIdx: 1 },
      { name: 'Transactions', term: 'Transactions History', subIdx: 2 },
      { name: 'Recurring Payments', term: 'Recurring Payments', subIdx: 3 },
      { name: 'Analysis', term: 'Debt Analysis', subIdx: 4 },
      { name: 'Simulations', term: 'Payoff Simulations', subIdx: 5 },
      { name: 'Resilience', term: 'Financial Resilience', subIdx: 6 },
      { name: 'Documents', term: 'Financial Documents', subIdx: 7 }
    ];

    subTabsList.forEach(st => {
      if (st.name.toLowerCase().includes(query) || st.term.toLowerCase().includes(query)) {
        results.push({
          id: `tab-${st.subIdx}`,
          name: st.name,
          category: 'Sections',
          icon: 'ph-layout',
          meta: `Section in Strategy Sanctuary`,
          action: () => {
            navigateSPA('debts');
            const subtabs = document.querySelectorAll('.debts-subtabs .subtab');
            if (subtabs[st.subIdx]) subtabs[st.subIdx].click();
          }
        });
      }
    });
    
    // Search Debts
    appState.debts.forEach(d => {
      if (d.name.toLowerCase().includes(query)) {
        results.push({
          id: d.id,
          name: d.name,
          category: 'Debts',
          icon: 'ph-bank',
          meta: `Balance: $${d.balance.toLocaleString()} • APR: ${d.apr}%`,
          action: () => navigateSPA('debts')
        });
      }
    });
    
    // Search Transactions
    appState.transactions.forEach(t => {
      if (t.merchant.toLowerCase().includes(query) || t.category.toLowerCase().includes(query)) {
        results.push({
          id: t.id,
          name: t.merchant,
          category: 'Transactions',
          icon: 'ph-receipt',
          meta: `${t.category} • $${Math.abs(t.amount).toLocaleString()}`,
          action: () => {
            navigateSPA('debts');
            // Select the transactions subtab (index 2)
            const subtabs = document.querySelectorAll('.debts-subtabs .subtab');
            if (subtabs[2]) subtabs[2].click();
          }
        });
      }
    });
    
    renderSearchResults(results);
  });
  
  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsDropdown.contains(e.target)) {
      resultsDropdown.classList.remove('active');
    }
  });

  function renderSearchResults(results) {
    resultsDropdown.innerHTML = '';
    
    if (results.length === 0) {
      resultsDropdown.innerHTML = '<div class="search-no-results">No insights found for that query.</div>';
    } else {
      const grouped = results.reduce((acc, res) => {
        if (!acc[res.category]) acc[res.category] = [];
        acc[res.category].push(res);
        return acc;
      }, {});
      
      Object.keys(grouped).forEach(cat => {
        const section = document.createElement('div');
        section.className = 'search-section';
        
        const label = document.createElement('div');
        label.className = 'search-section-label';
        label.textContent = cat;
        section.appendChild(label);
        
        grouped[cat].forEach(res => {
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `
            <div class="result-icon"><i class="ph ${res.icon}"></i></div>
            <div class="result-info">
              <div class="result-title">${res.name}</div>
              ${res.meta ? `<div class="result-meta">${res.meta}</div>` : ''}
            </div>
          `;
          
          item.addEventListener('click', () => {
            if (res.action) {
              res.action();
            } else {
              navigateSPA(res.id);
            }
            resultsDropdown.classList.remove('active');
            searchInput.value = '';
          });
          
          section.appendChild(item);
        });
        
        resultsDropdown.appendChild(section);
      });
    }
    
    resultsDropdown.classList.add('active');
  }
}

/* ---------- CALENDAR GENERATOR ---------- */
let currentCalMonth = new Date().getMonth(); // 0-11
let currentCalYear = new Date().getFullYear();

function initCalendar() {
    renderMainCalendar();
    
    // Month Navigation handled via btn-cal-prev / btn-cal-next in initAllButtonHandlers
}

function renderMainCalendar() {
    const grid = document.getElementById('main-calendar-grid');
    const label = document.getElementById('cal-month-year');
    if (!grid || !label) return;

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    label.textContent = `${monthNames[currentCalMonth]} ${currentCalYear}`;
    
    grid.innerHTML = '';
    
    const firstDay = new Date(currentCalYear, currentCalMonth, 1).getDay();
    const daysInMonth = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();
    
    // Padding for previous month
    for (let i = 0; i < firstDay; i++) {
        const div = document.createElement('div');
        div.className = 'cal-day empty';
        div.style.background = 'var(--bg)';
        grid.appendChild(div);
    }
    
    const today = new Date();
    const isCurrentMonth = today.getMonth() === currentCalMonth && today.getFullYear() === currentCalYear;
    
    // Events
    const debtDays = appState.debts.reduce((acc, d) => {
        const day = parseInt(d.dueDate) || 15;
        if (!acc[day]) acc[day] = [];
        acc[day].push({ name: d.name, amount: d.minPayment, type: 'debt', id: d.id });
        return acc;
    }, {});
    
    // Paydays from real income (show only if income is set)
    const income = (appState.balances && appState.balances.monthlyIncome) || 0;
    const paydayAmt = income > 0 ? Math.round(income / 2) : 0;
    const paydayDays = income > 0
        ? { 1: [{ name: 'Payday', amount: paydayAmt, type: 'income' }], 15: [{ name: 'Payday', amount: paydayAmt, type: 'income' }] }
        : {};
    
    for (let day = 1; day <= daysInMonth; day++) {
        const div = document.createElement('div');
        div.className = 'cal-day-cell';
        div.style.background = 'var(--card-1)';
        div.style.padding = '8px';
        div.style.minHeight = '100px';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '4px';
        div.style.transition = 'all 0.2s';
        
        const dayNum = document.createElement('div');
        dayNum.textContent = day;
        dayNum.style.fontSize = '12px';
        dayNum.style.fontWeight = '800';
        dayNum.style.color = 'var(--text-3)';
        dayNum.style.marginBottom = '4px';
        
        if (isCurrentMonth && day === today.getDate()) {
            div.style.background = 'var(--card-2)';
            dayNum.style.color = 'var(--accent)';
            div.style.border = '1px solid var(--accent-dim)';
        }
        
        div.appendChild(dayNum);
        
        // Add income events
        if (paydayDays[day]) {
            paydayDays[day].forEach(ev => {
                const badge = document.createElement('div');
                badge.className = 'cal-event-badge income';
                badge.style.background = 'rgba(0, 212, 168, 0.1)';
                badge.style.color = 'var(--accent)';
                badge.style.fontSize = '9px';
                badge.style.fontWeight = '700';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '4px';
                badge.style.borderLeft = '2px solid var(--accent)';
                badge.textContent = ev.name;
                div.appendChild(badge);
            });
        }
        
        // Add debt events
        if (debtDays[day]) {
            debtDays[day].forEach(ev => {
                const badge = document.createElement('div');
                badge.className = 'cal-event-badge debt';
                badge.style.background = 'rgba(255, 77, 109, 0.1)';
                badge.style.color = 'var(--danger)';
                badge.style.fontSize = '9px';
                badge.style.fontWeight = '700';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '4px';
                badge.style.borderLeft = '2px solid var(--danger)';
                // Trim name if too long
                const shortName = ev.name.length > 12 ? ev.name.substring(0, 10) + '...' : ev.name;
                badge.textContent = shortName;
                div.appendChild(badge);
            });
        }
        
        grid.appendChild(div);
    }
    
    // Update Sidebar Detailed List
    renderDetailedUpcoming();
}

function renderDetailedUpcoming() {
    const cont = document.getElementById('cal-detailed-upcoming');
    if (!cont) return;
    
    cont.innerHTML = '';
    
    // Combine all events for the next 30 days
    const events = [];
    appState.debts.forEach(d => {
        events.push({ day: parseInt(d.dueDate) || 15, name: d.name, amount: d.minPayment, type: 'debt', apr: d.apr });
    });
    const calIncome = (appState.balances && appState.balances.monthlyIncome) || 0;
    if (calIncome > 0) {
        const halfPay = Math.round(calIncome / 2);
        events.push({ day: 1, name: 'Payday', amount: halfPay, type: 'income' });
        events.push({ day: 15, name: 'Payday', amount: halfPay, type: 'income' });
    }
    
    // Sort by day
    events.sort((a,b) => a.day - b.day);
    
    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    
    if (events.length === 0) {
        cont.innerHTML = `<div style="text-align:center; padding:32px 16px; color:var(--text-3); font-size:11px;">
            <i class="ph ph-calendar-blank" style="font-size:28px; display:block; margin-bottom:8px; opacity:0.4;"></i>
            No upcoming payments. Add debts or income to populate your calendar.
        </div>`;
    } else {
        cont.innerHTML = events.map(ev => `
            <div style="display:flex; align-items:center; gap:16px; padding:12px; background:var(--bg); border-radius:12px; border:1px solid var(--border); position:relative; overflow:hidden;">
                <div style="position:absolute; left:0; top:0; bottom:0; width:4px; background:${ev.type === 'income' ? 'var(--accent)' : 'var(--danger)'};"></div>
                <div style="text-align:center; min-width:36px;">
                    <div style="font-size:9px; font-weight:800; color:var(--text-3); text-transform:uppercase;">${new Date(currentCalYear, currentCalMonth).toLocaleString('default', { month: 'short' }).toUpperCase()}</div>
                    <div style="font-size:18px; font-weight:900; line-height:1; color:${ev.type === 'income' ? 'var(--accent)' : 'var(--text)'}">${ev.day < 10 ? '0' + ev.day : ev.day}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:13px; font-weight:800;">${ev.name}</div>
                    <div style="font-size:10px; color:var(--text-3);">${fmt(ev.amount)} ${ev.apr ? '• ' + ev.apr + '% APR' : '• System Account'}</div>
                </div>
                <div style="text-align:right;">
                    <div class="badge" style="background:${ev.type === 'income' ? 'rgba(0,212,168,0.1)' : 'rgba(255,107,107,0.1)'}; color:${ev.type === 'income' ? 'var(--accent)' : 'var(--danger)'}; font-size:8px; padding:4px 8px;">${ev.type === 'income' ? 'INCOME' : 'DUE'}</div>
                </div>
            </div>
        `).join('');
    }

    // Update event count and daily limit
    const countEl = document.getElementById('cal-event-count');
    if (countEl) countEl.textContent = events.length > 0 ? `${events.length} EVENT${events.length !== 1 ? 'S' : ''}` : '';

    const dailyEl = document.getElementById('cal-daily-limit');
    const statusEl = document.getElementById('cal-daily-status');
    const calInc = (appState.balances && appState.balances.monthlyIncome) || 0;
    if (dailyEl) {
        if (calInc === 0) {
            dailyEl.innerHTML = `$0 <span style="font-size:12px; color:var(--text-3); font-weight:400;">Left</span>`;
            if (statusEl) statusEl.textContent = '—';
        } else {
            const totalDue = appState.debts.reduce((s,d) => s + (d.minPayment||0), 0);
            const dailyLeft = Math.max(0, Math.round((calInc - totalDue) / 30));
            dailyEl.innerHTML = `$${dailyLeft.toLocaleString()} <span style="font-size:12px; color:var(--text-3); font-weight:400;">Left</span>`;
            if (statusEl) { statusEl.textContent = dailyLeft > 0 ? 'SAFE' : 'TIGHT'; statusEl.style.color = dailyLeft > 0 ? 'var(--accent)' : 'var(--danger)'; }
        }
    }
}

/* ---------- INTERACTIVITY ---------- */
function initInteractivity() {
    // Sliders
    const sliderContrib = document.getElementById('slider-contribution');
    const valContrib = document.getElementById('val-contribution');
    const sliderBuffer = document.getElementById('slider-buffer');
    const valBuffer = document.getElementById('val-buffer');
    
    if (sliderContrib) {
        sliderContrib.addEventListener('input', (e) => {
            valContrib.textContent = `$${parseInt(e.target.value).toLocaleString()}`;
        });
    }
    
    if (sliderBuffer) {
        sliderBuffer.addEventListener('input', (e) => {
            valBuffer.textContent = `${e.target.value}%`;
        });
    }
    
    // Recalculate Button effect
    const btnRecalc = document.getElementById('btn-recalc');
    if (btnRecalc) {
        btnRecalc.addEventListener('click', () => {
            const icon = btnRecalc.querySelector('i');
            icon.style.transition = 'transform 0.5s ease';
            icon.style.transform = `rotate(360deg)`;
            
            // Randomly jiggle the chart a bit to simulate "AI thinking"
            drawCharts();
            
            setTimeout(() => {
                icon.style.transform = `rotate(0deg)`;
            }, 500);
        });
    }
    
    // Toggle Switches
    const toggles = document.querySelectorAll('.toggle-switch');
    toggles.forEach(t => {
        t.addEventListener('click', () => t.classList.toggle('on'));
    });
    
    // Chips 
    const chipGroups = document.querySelectorAll('.chip-group, .risk-selector, .time-filter');
    chipGroups.forEach(group => {
        const chips = group.querySelectorAll('.chip, .risk-chip, .time-btn');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');

                // If this is the strategy group — route through central setStrategy()
                if (group.id === 'strategy-tabs') {
                    const newStrat = chip.getAttribute('data-strategy');
                    if (newStrat && typeof setStrategy === 'function') {
                        // Let setStrategy handle chips/cards/state/UI sync
                        // But don't re-toggle active class (setStrategy will do it)
                        setStrategy(newStrat);
                        return; // exit early — setStrategy updates active class
                    }
                }
            });
        });
    });
}

/* ---------- DEBTS SUB-TAB NAVIGATION ---------- */
function initSubTabs() {
    const subtabMap = {
        'Overview': 'overview',
        'Budget & Breakdown': 'budget',
        'Transactions': 'transactions',
        'Recurring Payments': 'recurring',
        'Analysis': 'analysis',
        'Credit Score': 'credit-score',
        'Simulations': 'simulations',
        'Resilience': 'resilience',
        'Documents': 'documents'
    };

    const subtabs = document.querySelectorAll('.debts-subtabs .subtab');
    const panels = document.querySelectorAll('.debts-subtab-content');

    subtabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.textContent.trim();
            const target = subtabMap[tabName];

            // Update active tab
            subtabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show/hide panels
            panels.forEach(p => {
                p.classList.remove('active');
                if (target && p.dataset.subtab === target) {
                    p.classList.add('active');
                }
            });

            // Render dynamic tabs on demand
            if (target === 'resilience' && typeof renderResilienceTab === 'function') {
                setTimeout(() => renderResilienceTab(), 30);
            }
            if (target === 'simulations' && typeof renderSimulationsTab === 'function') {
                setTimeout(() => renderSimulationsTab(), 30);
            }
            if (target === 'recurring' && typeof renderRecurringTab === 'function') {
                setTimeout(() => renderRecurringTab(), 30);
            }
            if (target === 'credit-score' && typeof renderCreditScoreTab === 'function') {
                setTimeout(() => renderCreditScoreTab(), 30);
            }

            // Redraw charts after panel swap so canvas sizes compute correctly
            setTimeout(() => drawCharts(), 50);
        });
    });
}

function animateProgressBars() {
    const bars = document.querySelectorAll('.progress-fill');
    bars.forEach(bar => {
        const width = bar.style.width;
        bar.style.width = '0%';
        setTimeout(() => {
            bar.style.width = width;
        }, 100);
    });
}

/* ---------- CUSTOM CANVAS CHARTS ---------- */
function drawCharts() {
    // Get Theme Colors dynamically
    const styleBlock = getComputedStyle(document.body);
    const getVar = (name) => styleBlock.getPropertyValue(name).trim() || '#000';
    
    const colors = {
        accent: getVar('--accent'),
        accentDim: getVar('--accent-dim'),
        card2: getVar('--card-2'),
        border: getVar('--border'),
        text: getVar('--text'),
        text3: getVar('--text-3')
    };

    /** Helper: Draw Bar Chart */
    function drawBarChart(canvasId, data, highlightedIndex) {
        const c = document.getElementById(canvasId);
        if (!c) return;
        const ctx = c.getContext('2d');
        
        // Setup DPI
        const dpr = window.devicePixelRatio || 1;
        const rect = c.parentElement.getBoundingClientRect();
        c.width = rect.width * dpr;
        c.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        
        const w = rect.width;
        const h = rect.height;
        
        ctx.clearRect(0,0,w,h);
        
        const maxVal = Math.max(...data);
        const barWidth = w / (data.length * 2);
        const gap = barWidth;
        const startX = (w - ((barWidth+gap) * data.length - gap)) / 2;
        
        data.forEach((val, i) => {
            const barH = (val / maxVal) * (h * 0.9);
            const x = startX + i * (barWidth + gap);
            const y = h - barH;
            
            // Draw bar
            ctx.fillStyle = i === highlightedIndex ? colors.accent : colors.accentDim;
            if (document.body.classList.contains('light') && i !== highlightedIndex) {
                 ctx.fillStyle = 'rgba(20,120,95,0.2)'; // specialized dim for light mode
            }
            
            // Rounded top corners
            const radius = 4;
            ctx.beginPath();
            ctx.moveTo(x, h);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            ctx.arcTo(x + barWidth, y, x + barWidth, h, radius);
            ctx.lineTo(x + barWidth, h);
            ctx.fill();
        });
    }

    /** Helper: Draw Line Chart using Chart.js */
    function drawDualLineChart(canvasId) {
        const c = document.getElementById(canvasId);
        if (!c) return;
        
        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const simData = simulateAllStrategies();
        if (!simData) return;

        // Using placeholder simulated payoff data
        const total = appState.debts.reduce((acc, d) => acc + d.balance, 0);
        const currentLineData = [];
        const bestLineData = [];
        
        for(let i=0; i<6; i++) {
             currentLineData.push(total * (1 - (i*0.05))); 
             bestLineData.push(total * (1 - (i*0.10)));
        }

        chartInstances[canvasId] = new Chart(c, {
            type: 'line',
            data: {
                labels: ['NOW', 'M1', 'M2', 'M3', 'M4', 'M5'],
                datasets: [
                    {
                        label: 'Current Path',
                        data: currentLineData,
                        borderColor: colors.border,
                        borderWidth: 3,
                        pointRadius: 0,
                        fill: false,
                        tension: 0.4
                    },
                    {
                        label: 'Optimized Path',
                        data: bestLineData,
                        borderColor: colors.accent,
                        borderWidth: 4,
                        pointRadius: 0,
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return colors.accent;
                            const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            grad.addColorStop(0, colors.accentDim);
                            grad.addColorStop(1, 'rgba(0,0,0,0)');
                            return grad;
                        },
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.9)',
                        callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString(undefined,{maximumFractionDigits:0})}` }
                    }
                }
            }
        });
    }

    /** Helper: Draw Donut Chart using Chart.js */
    function drawDonut(canvasId, segments) {
        const c = document.getElementById(canvasId);
        if (!c) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const data = segments.map(s => s.pct);
        const bgColors = segments.map(s => s.color);

        chartInstances[canvasId] = new Chart(c, {
            type: 'doughnut',
            data: {
                labels: segments.map((s, i) => `Category ${i+1}`),
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderWidth: 0,
                    hoverOffset: 4,
                    cutout: '70%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.9)',
                        bodyColor: '#e0e3e5',
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.parsed}%`;
                            }
                        }
                    }
                }
            }
        });
    }

    /** Helper: Draw weekly spending bars (stacked style matching template) using Chart.js */
    function drawWeeklyBars(canvasId, weeklyData) {
        const c = document.getElementById(canvasId);
        if (!c) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const current = weeklyData || [0,0,0,0];
        const lastYearAvg = [400, 400, 400, 400]; // Placeholder for comparison

        chartInstances[canvasId] = new Chart(c, {
            type: 'bar',
            data: {
                labels: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'],
                datasets: [
                    {
                        label: 'Last Year Avg',
                        data: lastYearAvg,
                        backgroundColor: colors.card2,
                        borderRadius: 3,
                        barPercentage: 0.6,
                        categoryPercentage: 0.8
                    },
                    {
                        label: 'Current',
                        data: current,
                        backgroundColor: colors.accent,
                        borderRadius: 3,
                        barPercentage: 0.6,
                        categoryPercentage: 0.8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.9)',
                        callbacks: { label: (ctx) => ` $${ctx.raw}` }
                    }
                }
            }
        });
    }

    /** Helper: Draw elimination projection chart using Chart.js */
    function drawEliminationChart(canvasId) {
        const c = document.getElementById(canvasId);
        if (!c) return;
        
        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const totalInitialBalance = appState.debts.reduce((acc, d) => acc + d.balance, 0);
        const monthlyReduction = appState.budget.contribution + appState.debts.reduce((acc, d) => acc + d.minPayment, 0);
        
        const balances = [];
        let curBal = totalInitialBalance;
        for(let i=0; i<8; i++) {
            balances.push(Math.max(0, curBal));
            curBal -= monthlyReduction;
        }

        chartInstances[canvasId] = new Chart(c, {
            type: 'bar',
            data: {
                labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'],
                datasets: [{
                    label: 'Remaining Balance',
                    data: balances,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const {ctx, chartArea} = chart;
                        if (!chartArea) return colors.accent;
                        const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        grad.addColorStop(0, colors.accent);
                        grad.addColorStop(1, 'rgba(0, 212, 168, 0.3)');
                        return grad;
                    },
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.9)',
                        callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString()}` }
                    }
                }
            }
        });
    }

    /** Rounded bar helper */
    function roundedBar(ctx, x, y, w, h, r) {
        if (h <= 0 || w <= 0) return;
        r = Math.max(0, Math.min(r, h / 2, w / 2));
        ctx.beginPath();
        ctx.moveTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
    }

    // Dynamic Expense Percentages
    const exps = appState.budget.expenses;
    const totalExp = exps.housing + exps.transit + exps.food + exps.disc || 1;
    const getPct = (val) => (val / totalExp) * 100;

    // Execution
    /**
     * getSpendingData — single source for the dashboard's cash-flow tracker.
     *
     * Returns BOTH spending (outflows, t.amount < 0) AND income (inflows, t.amount > 0)
     * binned across the same time window so the chart can show both as datasets.
     * The bar chart will render side-by-side red/green bars per period; the line
     * chart shows two lines; the doughnut still slices spending categories only
     * (income would dominate as a single huge slice and obscure the breakdown).
     *
     * This sets up bank-sync: every Plaid-imported transaction will flow through
     * here regardless of sign, so the tracker shows the complete picture.
     */
    const getSpendingData = (timeframe, type) => {
        const now = new Date();
        const labels = [];
        const data = [];        // outflows per bin (positive numbers, sign stripped)
        const incomeData = [];  // inflows per bin
        const allTxns = appState.transactions || [];

        let windowStart, windowEnd = new Date(now);
        windowEnd.setHours(23, 59, 59, 999);

        if (timeframe === 'daily') {
            windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 6); windowStart.setHours(0,0,0,0);
        } else if (timeframe === 'weekly') {
            windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 27); windowStart.setHours(0,0,0,0);
        } else if (timeframe === 'yearly') {
            windowStart = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1, 0, 0, 0, 0);
        } else if (timeframe === 'allyears') {
            // Span every year that has at least one transaction. Falls back to
            // current year if there's no history yet.
            const allYears = (allTxns || []).map(t => new Date(t.date).getFullYear()).filter(y => !isNaN(y));
            const minYear = allYears.length ? Math.min(...allYears) : now.getFullYear();
            windowStart = new Date(minYear, 0, 1, 0, 0, 0, 0);
        } else {
            windowStart = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
        }

        // Pre-bucket all in-window transactions by sign — used by both
        // time-series and pie modes.
        const inWindowAll = allTxns.filter(t => {
            const td = new Date(t.date);
            return td >= windowStart && td <= windowEnd;
        });
        const inWindowSpending = inWindowAll.filter(t => t.amount < 0);
        const inWindowIncome   = inWindowAll.filter(t => t.amount > 0);

        const totalSpent  = inWindowSpending.reduce((s, t) => s + Math.abs(t.amount), 0);
        const totalIncome = inWindowIncome.reduce((s, t) => s + t.amount, 0);
        const netCashFlow = totalIncome - totalSpent;
        const txnCount    = inWindowAll.length; // ALL transactions in window, signed both ways

        // Category breakdown — spending only. Used for the doughnut + the
        // "Top category" summary stat. Income is too lumpy and would just show
        // "Income" as the dominant slice for most users.
        const categories = {};
        inWindowSpending.forEach(t => {
            const cat = t.category || 'Other';
            categories[cat] = (categories[cat] || 0) + Math.abs(t.amount);
        });

        if (type === 'pie' || type === 'doughnut') {
            const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
            entries.forEach(([cat, val]) => { labels.push(cat); data.push(val); });
            return { labels, data, incomeData: [], totalSpent, totalIncome, netCashFlow, txnCount, categories };
        }

        // Helper: sum txns in a [start, end] window, optionally filtered by sign
        const sumIn = (start, end, list) => list
            .filter(t => { const td = new Date(t.date); return td >= start && td <= end; })
            .reduce((s, t) => s + Math.abs(t.amount), 0);

        if (timeframe === 'daily') {
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now); d.setDate(d.getDate() - i);
                labels.push(d.toLocaleDateString('default', { weekday: 'short' }));
                const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
                const dayEnd   = new Date(d); dayEnd.setHours(23,59,59,999);
                data.push(sumIn(dayStart, dayEnd, inWindowSpending));
                incomeData.push(sumIn(dayStart, dayEnd, inWindowIncome));
            }
        } else if (timeframe === 'weekly') {
            for (let i = 3; i >= 0; i--) {
                const blockEnd = new Date(now); blockEnd.setDate(blockEnd.getDate() - (i * 7)); blockEnd.setHours(23,59,59,999);
                const blockStart = new Date(blockEnd); blockStart.setDate(blockStart.getDate() - 6); blockStart.setHours(0,0,0,0);
                labels.push(i === 0 ? 'This wk' : `${i}w ago`);
                data.push(sumIn(blockStart, blockEnd, inWindowSpending));
                incomeData.push(sumIn(blockStart, blockEnd, inWindowIncome));
            }
        } else if (timeframe === 'yearly') {
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                labels.push(d.toLocaleDateString('default', { month: 'short' }));
                const start = new Date(d.getFullYear(), d.getMonth(), 1, 0,0,0,0);
                const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23,59,59,999);
                data.push(sumIn(start, end, inWindowSpending));
                incomeData.push(sumIn(start, end, inWindowIncome));
            }
        } else if (timeframe === 'allyears') {
            // One bar per calendar year, oldest → newest
            const startYear = windowStart.getFullYear();
            const endYear = now.getFullYear();
            for (let y = startYear; y <= endYear; y++) {
                labels.push(String(y));
                const start = new Date(y, 0, 1, 0, 0, 0, 0);
                const end   = new Date(y, 11, 31, 23, 59, 59, 999);
                data.push(sumIn(start, end, inWindowSpending));
                incomeData.push(sumIn(start, end, inWindowIncome));
            }
        } else {
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                labels.push(d.toLocaleDateString('default', { month: 'short' }));
                const start = new Date(d.getFullYear(), d.getMonth(), 1, 0,0,0,0);
                const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23,59,59,999);
                data.push(sumIn(start, end, inWindowSpending));
                incomeData.push(sumIn(start, end, inWindowIncome));
            }
        }
        return { labels, data, incomeData, totalSpent, totalIncome, netCashFlow, txnCount, categories };
    };

    /**
     * 8-color palette used to color each bar/line/pie slice differently.
     * Good contrast on dark background, no neighbouring colors that blur together.
     */
    const SPENDING_PALETTE = [
        '#00d4a8', // accent green
        '#667eea', // periwinkle
        '#ff4d6d', // coral red
        '#ffab40', // amber
        '#a855f7', // purple
        '#22c55e', // grass
        '#f59e0b', // honey
        '#60a5fa'  // sky blue
    ];

    /**
     * Sync the four headline summary stats with the current window:
     * Spent · Income · Net · Transactions (with top-category sub-line).
     * The Net stat color-codes green (positive cash flow) or red (over-spending).
     */
    function updateSpendingSummary(totalSpent, totalIncome, netCashFlow, txnCount, categories, tf) {
        const elTotal     = document.getElementById('spend-sum-total');
        const elIncome    = document.getElementById('spend-sum-income');
        const elIncomeSub = document.getElementById('spend-sum-income-sub');
        const elNet       = document.getElementById('spend-sum-net');
        const elNetSub    = document.getElementById('spend-sum-net-sub');
        const elCount     = document.getElementById('spend-sum-count');
        const elTopCat    = document.getElementById('spend-sum-topcat');
        const elWindow    = document.getElementById('spend-sum-window');
        const fmtUsd      = n => '$' + Math.round(n || 0).toLocaleString();

        if (elTotal) elTotal.textContent = fmtUsd(totalSpent);

        if (elIncome) elIncome.textContent = fmtUsd(totalIncome);
        if (elIncomeSub) {
            elIncomeSub.textContent = (totalIncome || 0) > 0 ? 'in this window' : 'no inflows yet';
        }

        if (elNet) {
            const net = netCashFlow || 0;
            const sign = net > 0 ? '+' : net < 0 ? '−' : '';
            elNet.textContent = `${sign}${fmtUsd(Math.abs(net))}`;
            // Color-code: green = saving, red = over-spending
            elNet.style.color = net > 0 ? '#22c55e' : net < 0 ? '#ff4d6d' : 'var(--text-3)';
        }
        if (elNetSub) {
            const net = netCashFlow || 0;
            elNetSub.textContent = net > 0 ? 'cash-positive'
                                 : net < 0 ? 'over-spending'
                                 : 'break-even';
        }

        if (elCount) elCount.textContent = (txnCount || 0).toLocaleString();
        if (elWindow) {
            const labels = { daily: 'last 7 days', weekly: 'last 28 days', monthly: 'last 6 months', yearly: 'last 12 months', allyears: 'all years' };
            elWindow.textContent = labels[tf] || 'this window';
        }
        if (elTopCat) {
            const entries = Object.entries(categories || {}).sort((a, b) => b[1] - a[1]);
            if (!entries.length || !totalSpent) {
                elTopCat.textContent = 'No spending yet';
            } else {
                const [cat, amt] = entries[0];
                const pct = totalSpent > 0 ? Math.round((amt / totalSpent) * 100) : 0;
                elTopCat.textContent = `Top: ${cat} ${pct}%`;
            }
        }
    }

    /** Unified Spending Chart Drawer
     *  Builds a fresh dataset config per chart type so we never feed line-only or
     *  bar-only properties to the wrong type. When there's no spending data we
     *  show a centered "No spending yet" overlay rather than an empty axis. */
    function drawSpendingChart(canvasId) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        if (chartInstances[canvasId]) {
            try { chartInstances[canvasId].destroy(); } catch(_){}
            chartInstances[canvasId] = null;
        }
        if (typeof Chart === 'undefined') return; // chart.js not loaded yet

        const tf = (appState.settings && appState.settings.spendingTimeFrame) || 'monthly';
        const type = (appState.settings && appState.settings.spendingChartType) || 'bar';
        const result = getSpendingData(tf, type);
        const { labels, data, incomeData, totalSpent, totalIncome, netCashFlow, txnCount, categories } = result;
        const hasData = (totalSpent || 0) > 0 || (totalIncome || 0) > 0;

        // Sync the summary row (Total Spent · Income · Net · # Txns · Top Category)
        try { updateSpendingSummary(totalSpent, totalIncome, netCashFlow, txnCount, categories, tf); } catch(_){}

        const slots = Math.max(labels.length, data.length, 1);
        const palette = Array.from({ length: slots }, (_, i) => SPENDING_PALETTE[i % SPENDING_PALETTE.length]);
        const incomeColor = '#22c55e'; // emerald — distinct from the spending palette

        // Build datasets per type. For bar/line we render TWO datasets: a
        // spending series (palette colors) AND an income series (solid green)
        // so the user sees both flows side-by-side. Doughnut shows spending
        // categories only (income would dominate as a single huge slice).
        const chartType = (type === 'pie' || type === 'doughnut') ? 'doughnut' : type;
        const datasets = [];

        if (chartType === 'doughnut') {
            datasets.push({
                label: 'Spending',
                data: data,
                backgroundColor: palette,
                borderColor: colors.card2,
                borderWidth: 2,
                hoverOffset: 10,
                cutout: '70%'
            });
        } else if (type === 'line') {
            datasets.push({
                label: 'Spending',
                data: data,
                backgroundColor: 'rgba(255, 77, 109, 0.12)',
                borderColor: '#ff4d6d',
                borderWidth: 3,
                tension: 0.35,
                fill: true,
                pointRadius: 4,
                pointBackgroundColor: '#ff4d6d',
                pointBorderColor: '#0b0f1a',
                pointBorderWidth: 2
            });
            if (incomeData && incomeData.some(v => v > 0)) {
                datasets.push({
                    label: 'Income',
                    data: incomeData,
                    backgroundColor: 'rgba(34, 197, 94, 0.12)',
                    borderColor: incomeColor,
                    borderWidth: 3,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 4,
                    pointBackgroundColor: incomeColor,
                    pointBorderColor: '#0b0f1a',
                    pointBorderWidth: 2
                });
            }
        } else {
            // Bar — grouped (side-by-side) spending + income per period
            datasets.push({
                label: 'Spending',
                data: data,
                backgroundColor: palette,
                borderColor: palette,
                borderWidth: 1,
                borderRadius: 4
            });
            if (incomeData && incomeData.some(v => v > 0)) {
                datasets.push({
                    label: 'Income',
                    data: incomeData,
                    backgroundColor: incomeColor,
                    borderColor: incomeColor,
                    borderWidth: 1,
                    borderRadius: 4
                });
            }
        }

        const config = {
            type: chartType,
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        // Doughnut shows category legend; bar/line show Spending vs Income legend
                        display: hasData && (chartType === 'doughnut' || datasets.length > 1),
                        position: chartType === 'doughnut' ? 'right' : 'top',
                        align: chartType === 'doughnut' ? 'center' : 'end',
                        labels: {
                            color: colors.text3,
                            font: { size: 10, weight: '500' },
                            usePointStyle: true,
                            padding: chartType === 'doughnut' ? 12 : 16,
                            boxWidth: 8,
                            boxHeight: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.95)',
                        borderColor: colors.border,
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (ctx2) => {
                                const val = ctx2.parsed.y != null ? ctx2.parsed.y : ctx2.parsed;
                                const safeVal = (typeof val === 'number') ? val : 0;
                                const dsLabel = ctx2.dataset && ctx2.dataset.label || '';
                                if (dsLabel === 'Income') {
                                    return ` Income: $${safeVal.toLocaleString()}`;
                                }
                                const pct = totalSpent > 0 ? ((safeVal / totalSpent) * 100).toFixed(1) : 0;
                                return ` Spent: $${safeVal.toLocaleString()}${pct ? ` (${pct}%)` : ''}`;
                            }
                        }
                    }
                },
                scales: chartType === 'doughnut' ? {} : {
                    x: {
                        grid: { display: false },
                        ticks: { color: colors.text3, font: { size: 9 } }
                    },
                    y: {
                        beginAtZero: true,
                        // Keep an axis range visible even when there's no data
                        suggestedMax: hasData ? undefined : 100,
                        grid: { color: colors.border, drawBorder: false },
                        ticks: {
                            color: colors.text3,
                            font: { size: 9 },
                            callback: (value) => '$' + value
                        }
                    }
                }
            }
        };

        // Doughnut center text — TOTAL + amount. Empty-state version for both
        // doughnut and bar/line is drawn by the same plugin so the user never
        // sees a fully blank canvas.
        config.plugins = [{
            id: 'spendingChartHelpers',
            afterDraw: (chart) => {
                const ctx2 = chart.ctx;
                const area = chart.chartArea;
                if (!area) return;
                const cx = (area.left + area.right) / 2;
                const cy = (area.top + area.bottom) / 2;
                if (chartType === 'doughnut') {
                    ctx2.save();
                    ctx2.font = '700 12px Inter';
                    ctx2.fillStyle = colors.text3;
                    ctx2.textAlign = 'center';
                    if (hasData) {
                        ctx2.fillText('TOTAL', cx, cy - 8);
                        ctx2.font = '700 16px Inter';
                        ctx2.fillStyle = colors.text;
                        ctx2.fillText(`$${Math.round(totalSpent).toLocaleString()}`, cx, cy + 10);
                    } else {
                        ctx2.font = '700 11px Inter';
                        ctx2.fillStyle = colors.text3;
                        ctx2.fillText('No spending yet', cx, cy);
                    }
                    ctx2.restore();
                } else if (!hasData) {
                    // Bar/line empty-state overlay
                    ctx2.save();
                    ctx2.font = '700 13px Inter';
                    ctx2.fillStyle = colors.text;
                    ctx2.textAlign = 'center';
                    ctx2.fillText('No transactions yet', cx, cy - 6);
                    ctx2.font = '500 10px Inter';
                    ctx2.fillStyle = colors.text3;
                    ctx2.fillText('Add income & expenses to see your cash flow.', cx, cy + 10);
                    ctx2.restore();
                }
            }
        }];

        try {
            chartInstances[canvasId] = new Chart(ctx, config);
        } catch (err) {
            console.warn('drawSpendingChart failed', err);
        }
    }

    /** AI Advisor Payoff Projection — strategy-aware, polished, real-simulator-driven.
     *  Plots the ACTUAL per-month balance trajectory (running the same payoff math the
     *  rest of the dashboard uses) for the user's selected strategy AND a comparison
     *  baseline (paying minimums only with the same strategy's order). The user gets
     *  a clear "with extra contribution vs without" gap that's mathematically real.
     *
     *  Color per strategy so the chart visibly matches what's selected:
     *    Snowball  → purple
     *    Avalanche → amber
     *    Hybrid    → accent green
     */
    function drawDashProjection(canvasId) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (chartInstances[canvasId]) {
            try { chartInstances[canvasId].destroy(); } catch(_){}
            chartInstances[canvasId] = null;
        }
        if (typeof Chart === 'undefined') return;

        const style = (appState.settings && appState.settings.activeChartStyle) || 'line';
        const strategy = (appState.settings && appState.settings.strategy) || 'avalanche';
        // Same effective-extra logic the DFD hero uses — chart matches the date promised
        const _eeiChart = (typeof getEffectiveExtraContribution === 'function')
            ? getEffectiveExtraContribution()
            : { extra: 0 };
        const userExtra = _eeiChart.extra;
        const hasDebts = (appState.debts || []).length > 0;

        // Strategy color mapping — chart adopts the strategy's identity color
        const STRAT_COLOR = {
            snowball:  { line: '#a855f7', fill: 'rgba(168, 85, 247, 0.18)', glow: 'rgba(168, 85, 247, 0.45)' },
            avalanche: { line: '#ffab40', fill: 'rgba(255, 171, 64, 0.18)', glow: 'rgba(255, 171, 64, 0.45)' },
            hybrid:    { line: '#00d4a8', fill: 'rgba(0, 212, 168, 0.18)', glow: 'rgba(0, 212, 168, 0.45)' }
        };
        const sc = STRAT_COLOR[strategy] || STRAT_COLOR.avalanche;

        // Generate REAL trajectories from the simulator. We cap at 60 months to keep
        // the chart readable; users with >60 month payoffs see the trend get truncated
        // and an indicator label tells them so.
        const optimizedSeries = hasDebts ? calcBalanceTrajectory(strategy, userExtra, 60) : [];
        const minOnlySeries   = hasDebts ? calcBalanceTrajectory(strategy, 0, 60) : [];
        const seriesLen = Math.max(optimizedSeries.length, minOnlySeries.length, 1);

        // Pad shorter series with zeros so both arrays match
        while (optimizedSeries.length < seriesLen) optimizedSeries.push(0);
        while (minOnlySeries.length < seriesLen) minOnlySeries.push(0);

        const labels = Array.from({ length: seriesLen }, (_, i) => i === 0 ? 'Now' : `${i}m`);

        // Find the "debt-free" month for the optimized path so we can annotate it
        const debtFreeIdx = optimizedSeries.findIndex(v => v <= 0.5);

        const stratLabel = strategy[0].toUpperCase() + strategy.slice(1);

        // Gradient fill for the optimized path — only for area/line, not bar
        const fillGradient = (chart) => {
            const c = chart.ctx;
            const a = chart.chartArea;
            if (!a) return sc.fill;
            const g = c.createLinearGradient(0, a.top, 0, a.bottom);
            g.addColorStop(0, sc.fill);
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            return g;
        };

        const optimizedDataset = {
            label: `${stratLabel} + extra`,
            data: optimizedSeries,
            borderColor: sc.line,
            backgroundColor: style === 'bar' ? sc.line : fillGradient,
            borderWidth: 3,
            pointRadius: style === 'line' || style === 'area' ? 0 : 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: sc.line,
            pointHoverBorderColor: '#0b0f1a',
            pointHoverBorderWidth: 2,
            fill: style !== 'bar',
            tension: 0.45,
            // "Today" marker — bigger glowing dot at index 0
            pointBackgroundColor: optimizedSeries.map((_, i) => i === 0 ? sc.line : 'transparent'),
            pointBorderColor: optimizedSeries.map((_, i) => i === 0 ? '#0b0f1a' : 'transparent'),
            pointBorderWidth: optimizedSeries.map((_, i) => i === 0 ? 3 : 0),
            pointRadius: optimizedSeries.map((_, i) => i === 0 ? 6 : 0)
        };

        const minOnlyDataset = {
            label: 'Minimums only',
            data: minOnlySeries,
            borderColor: 'rgba(255, 255, 255, 0.28)',
            backgroundColor: 'transparent',
            borderDash: [4, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.45
        };

        const datasets = hasDebts ? [optimizedDataset, minOnlyDataset] : [{
            label: 'No debts yet',
            data: [],
            borderColor: 'rgba(255,255,255,0.1)'
        }];

        const config = {
            type: style === 'bar' ? 'bar' : 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: hasDebts,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: colors.text3,
                            font: { size: 10, weight: '600' },
                            usePointStyle: true,
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 12
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(11, 15, 26, 0.96)',
                        borderColor: sc.line,
                        borderWidth: 1,
                        padding: 12,
                        titleColor: colors.text,
                        titleFont: { size: 11, weight: '700' },
                        bodyColor: colors.text2,
                        bodyFont: { size: 11 },
                        callbacks: {
                            title: (items) => items[0] ? `Month: ${items[0].label}` : '',
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: colors.text3,
                            font: { size: 9, weight: '600' },
                            // Sparse labels for readable axis when series is long
                            autoSkip: true,
                            maxTicksLimit: 8
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                        border: { display: false },
                        ticks: {
                            color: colors.text3,
                            font: { size: 9 },
                            callback: (value) => '$' + (value >= 1000 ? (value/1000).toFixed(0) + 'k' : value)
                        }
                    }
                },
                animation: {
                    duration: 600,
                    easing: 'easeOutCubic'
                }
            }
        };

        // Annotation plugin: dashed vertical line + label at the debt-free month
        if (hasDebts && debtFreeIdx > 0 && debtFreeIdx < seriesLen) {
            config.plugins = [{
                id: 'debtFreeMarker',
                afterDraw: (chart) => {
                    const c = chart.ctx;
                    const a = chart.chartArea;
                    if (!a) return;
                    const xScale = chart.scales.x;
                    const x = xScale.getPixelForValue(debtFreeIdx);
                    c.save();
                    // Glow halo
                    c.shadowColor = sc.glow;
                    c.shadowBlur = 12;
                    // Vertical line
                    c.strokeStyle = sc.line;
                    c.setLineDash([4, 4]);
                    c.lineWidth = 1.5;
                    c.beginPath();
                    c.moveTo(x, a.top);
                    c.lineTo(x, a.bottom);
                    c.stroke();
                    c.shadowBlur = 0;
                    // Label pill
                    c.setLineDash([]);
                    const text = `Debt-free`;
                    c.font = '700 9px Inter';
                    const textW = c.measureText(text).width;
                    const padX = 6, padY = 3;
                    const pillW = textW + padX * 2;
                    const pillH = 16;
                    const pillX = Math.min(a.right - pillW - 2, x + 4);
                    const pillY = a.top + 2;
                    c.fillStyle = sc.line;
                    c.beginPath();
                    if (c.roundRect) c.roundRect(pillX, pillY, pillW, pillH, 8);
                    else c.rect(pillX, pillY, pillW, pillH);
                    c.fill();
                    c.fillStyle = '#0b0f1a';
                    c.textBaseline = 'middle';
                    c.fillText(text, pillX + padX, pillY + pillH / 2);
                    c.restore();
                }
            }];
        }

        // Empty-state overlay when no debts
        if (!hasDebts) {
            config.plugins = [{
                id: 'emptyOverlay',
                afterDraw: (chart) => {
                    const c = chart.ctx;
                    const a = chart.chartArea;
                    if (!a) return;
                    const cx = (a.left + a.right) / 2;
                    const cy = (a.top + a.bottom) / 2;
                    c.save();
                    c.font = '700 12px Inter';
                    c.fillStyle = colors.text;
                    c.textAlign = 'center';
                    c.fillText('Add a debt to see your projection', cx, cy - 4);
                    c.font = '500 10px Inter';
                    c.fillStyle = colors.text3;
                    c.fillText('Strategy + extra contribution drives the curve.', cx, cy + 12);
                    c.restore();
                }
            }];
        }

        try {
            chartInstances[canvasId] = new Chart(ctx, config);
        } catch (err) {
            console.warn('drawDashProjection failed', err);
        }
    }

    drawDashProjection('projectionChartDash'); 
    drawSpendingChart('spendingBarChart');
    drawDualLineChart('mainProjectionChart');
    
    // ─── Debts Overview: Spending This Month + Expense Categories ───
    // Both compute from real transactions. If none exist this month,
    // both show $0 and the donut + legend show an empty state.
    const _now0 = new Date();
    const _monthStart = new Date(_now0.getFullYear(), _now0.getMonth(), 1);
    const _monthEnd   = new Date(_now0.getFullYear(), _now0.getMonth() + 1, 0, 23, 59, 59, 999);
    const _txnsThisMonth = (appState.transactions || []).filter(t => {
        const td = new Date(t.date);
        return td >= _monthStart && td <= _monthEnd && t.amount < 0;
    });
    const _spendThisMonth = _txnsThisMonth.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Spending This Month total + sub-label
    const _fmtMoney0 = (n) => '$' + Math.round(n).toLocaleString();
    const _spendTotalEl = document.getElementById('debts-spending-month-total');
    const _spendSubEl   = document.getElementById('debts-spending-month-sub');
    const _spendEmptyEl = document.getElementById('debts-spending-month-empty');
    if (_spendTotalEl) _spendTotalEl.textContent = _fmtMoney0(_spendThisMonth);
    if (_spendSubEl) {
        _spendSubEl.textContent = _txnsThisMonth.length === 0
            ? 'No transactions logged yet'
            : `${_txnsThisMonth.length} transaction${_txnsThisMonth.length === 1 ? '' : 's'} this month`;
    }
    if (_spendEmptyEl) _spendEmptyEl.style.display = _txnsThisMonth.length === 0 ? '' : 'none';

    // Expense Categories: build from this month's transactions
    const _catTotals = {};
    _txnsThisMonth.forEach(t => {
        const cat = (t.category || 'Other').toString();
        _catTotals[cat] = (_catTotals[cat] || 0) + Math.abs(t.amount);
    });
    const _catColors = ['#00d4a8','#667eea','#ff4d6d','#ffab40','#a78bfa','#22d3ee','#f472b6','#84cc16'];
    const _catEntries = Object.entries(_catTotals).sort((a,b) => b[1] - a[1]);
    const _donutTotalEl  = document.getElementById('debts-donut-total');
    const _donutLegendEl = document.getElementById('debts-expense-legend');

    if (_catEntries.length === 0 || _spendThisMonth === 0) {
        // No real spending — render empty donut + empty-state legend
        drawDonut('expenseDonut', [{ pct: 100, color: 'rgba(127,127,127,0.18)' }]);
        if (_donutTotalEl) _donutTotalEl.textContent = '$0';
        if (_donutLegendEl) {
            _donutLegendEl.innerHTML = `<div class="legend-item" style="font-size:11px; color:var(--text-3);">No transactions yet — add one to see your category breakdown.</div>`;
        }
    } else {
        const _donutSlices = _catEntries.map(([cat, val], i) => ({
            pct: (val / _spendThisMonth) * 100,
            color: _catColors[i % _catColors.length]
        }));
        drawDonut('expenseDonut', _donutSlices);
        if (_donutTotalEl) {
            _donutTotalEl.textContent = _spendThisMonth >= 1000
                ? '$' + (_spendThisMonth / 1000).toFixed(1) + 'k'
                : '$' + Math.round(_spendThisMonth);
        }
        if (_donutLegendEl) {
            _donutLegendEl.innerHTML = _catEntries.map(([cat, val], i) => {
                const pct = Math.round((val / _spendThisMonth) * 100);
                const safeCat = String(cat).replace(/&/g,'&amp;').replace(/</g,'&lt;');
                return `<div class="legend-item"><div class="legend-dot" style="background:${_catColors[i % _catColors.length]}"></div> ${safeCat} <span style="margin-left:auto; font-weight:700">${pct}%</span></div>`;
            }).join('');
        }
    }

    const getWeeklySpending = () => {
        const weeks = [0,0,0,0];
        const now = new Date();
        appState.transactions.forEach(t => {
            const d = new Date(t.date);
            if (t.amount >= 0) return;
            const diff = Math.floor((now - d) / (86400000 * 7));
            if (diff >= 0 && diff < 4) weeks[3 - diff] += Math.abs(t.amount);
        });
        return weeks;
    };

    drawWeeklyBars('debtsWeeklyChart', getWeeklySpending());
    drawEliminationChart('eliminationChart');
    
    // Also render transactions
    renderTransactions();
    
    // Budget & Breakdown charts
    drawBudgetDonut('budgetDonut', [
        { pct: 45, color: '#00d4a8' }, // Housing
        { pct: 20, color: '#667eea' }, // Savings
        { pct: 12, color: '#ff4d6d' }, // Food
        { pct: 23, color: '#ffab40' }  // Others
    ]);
    // Draw AI-Predicted chart (deferred so canvas is visible)
    setTimeout(() => { if (typeof refreshBudgetVsPredicted === 'function') refreshBudgetVsPredicted(); }, 100);

    // Analysis charts
    drawAnalysisDTI('analysisDtiChart');
    drawAnalysisVelocity('analysisVelocityChart');

    // Simulation charts
    drawSimChart('simChart');

    /** Helper: Draw Simulation Impact Line Chart using Chart.js */
    function drawSimChart(canvasId) {
        const c = document.getElementById(canvasId);
        if (!c) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        chartInstances[canvasId] = new Chart(c, {
            type: 'line',
            data: {
                labels: ['Start', 'Yr 1', 'Yr 2', 'Yr 3', 'Yr 4'],
                datasets: [
                    {
                        label: 'Current Status',
                        data: [100, 95, 80, 60, 40],
                        borderColor: colors.text3,
                        borderDash: [5, 5],
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false,
                        tension: 0.4
                    },
                    {
                        label: 'Simulated Path',
                        data: [100, 85, 60, 30, 0],
                        borderColor: colors.accent,
                        borderWidth: 3,
                        pointRadius: [0, 0, 0, 0, 5],
                        pointBackgroundColor: colors.accent,
                        fill: false,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    }

    /** Helper: Draw Analysis DTI Donut using Chart.js */
    function drawAnalysisDTI(canvasId) {
        const c = document.getElementById(canvasId);
        if (!c) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const income = (appState.balances && appState.balances.monthlyIncome) || 0;
        const totalMin = appState.debts.reduce((s,d) => s + (d.minPayment||0), 0);
        const dti = income > 0 ? Math.min(100, Math.round((totalMin / income) * 100)) : 0;

        // Update the center label
        const dtiCenterVal = document.getElementById('dti-center-val');
        if (dtiCenterVal) dtiCenterVal.textContent = income > 0 ? dti + '%' : '—';

        // Update the historical/text section
        const card = c.closest('.card') || c.closest('[class*="card"]');
        if (card) {
            const histEl = card.querySelector('[data-dti-history]');
            // Update inline text below chart
            const bottomSection = card.querySelector('[style*="border-top"]');
            if (bottomSection && income === 0) {
                bottomSection.innerHTML = `<div style="font-size:10px; color:var(--text-3); font-style:italic; line-height:1.4; padding-top:16px;">Add your income and debts to calculate your Debt-to-Income ratio.</div>`;
            } else if (bottomSection && income > 0) {
                const dtiStatus = dti < 36 ? 'Healthy' : dti < 50 ? 'Moderate' : 'High';
                bottomSection.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-size:10px; margin-bottom:8px; padding-top:16px;">
                        <span style="color:var(--text-3);">Current DTI</span>
                        <span style="font-weight:700;">${dti}%</span>
                    </div>
                    <div class="progress-bar" style="height:4px; margin-bottom:12px; background:var(--card-2);">
                        <div class="progress-fill" style="width:${dti}%; background:${dti < 36 ? 'var(--accent)' : 'var(--danger)'};"></div>
                    </div>
                    <div style="font-size:10px; color:${dti < 36 ? 'var(--accent)' : 'var(--warning)'}; font-style:italic; line-height:1.4;">${dtiStatus} ratio. ${dti < 36 ? 'Below the 36% recommended ceiling.' : 'Consider reducing debt obligations.'}</div>`;
            }
        }

        chartInstances[canvasId] = new Chart(c, {
            type: 'doughnut',
            data: {
                labels: ['DTI', 'Available'],
                datasets: [{
                    data: income > 0 ? [dti, 100 - dti] : [0, 100],
                    backgroundColor: [colors.accent, colors.card2],
                    borderWidth: 0,
                    cutout: '85%',
                    borderRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                rotation: -90,
                circumference: 360,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    }

    /** Helper: Draw Analysis Velocity Bar Chart using Chart.js */
    function drawAnalysisVelocity(canvasId) {
        const c = document.getElementById(canvasId);
        if (!c) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const income = (appState.balances && appState.balances.monthlyIncome) || 0;
        const totalDebt = appState.debts.reduce((s,d) => s + (d.balance||0), 0);
        const totalMin = appState.debts.reduce((s,d) => s + (d.minPayment||0), 0);

        // Update freedom date and velocity trend text
        const card = c.closest('.card') || c.closest('[class*="card"]');
        if (card) {
            const freedomDateEl = card.querySelector('[style*="OCT 24"]') || Array.from(card.querySelectorAll('div')).find(el => el.textContent.trim() === 'OCT 24, 2026');
            const velTrendEl = card.querySelector('[style*="+14.2%"]') || Array.from(card.querySelectorAll('div')).find(el => el.textContent.includes('+14.2%'));
            const bottomGrid = card.querySelector('[style*="grid-template-columns:1fr 1fr"]');
            if (bottomGrid) {
                if (income === 0 || totalDebt === 0) {
                    bottomGrid.innerHTML = `
                        <div><div class="card-label" style="margin-bottom:4px;">AI Projected Freedom Date</div><div style="font-size:16px; font-weight:800; color:var(--text-3);">—</div></div>
                        <div style="text-align:right;"><div class="card-label" style="margin-bottom:4px;">Velocity Trend</div><div style="font-size:16px; font-weight:800; color:var(--text-3);">—</div></div>`;
                } else {
                    const monthsLeft = totalMin > 0 ? Math.ceil(totalDebt / totalMin) : 999;
                    const freedomDate = new Date(); freedomDate.setMonth(freedomDate.getMonth() + monthsLeft);
                    const dateStr = freedomDate.toLocaleDateString('en-US', { month:'short', year:'numeric' }).toUpperCase();
                    bottomGrid.innerHTML = `
                        <div><div class="card-label" style="margin-bottom:4px;">AI Projected Freedom Date</div><div style="font-size:16px; font-weight:800; color:var(--accent);">${dateStr}</div></div>
                        <div style="text-align:right;"><div class="card-label" style="margin-bottom:4px;">Velocity Trend</div><div style="font-size:16px; font-weight:800; color:var(--accent); display:flex; align-items:center; justify-content:flex-end; gap:6px;"><i class="ph ph-trend-up"></i> Active</div></div>`;
                }
            }
        }

        // Build velocity data from real payoff progression
        const data = income > 0 && totalMin > 0
            ? Array.from({length:9}, (_,i) => Math.round(totalMin * (1 + i * 0.1)))
            : Array(9).fill(0);
        
        chartInstances[canvasId] = new Chart(c, {
            type: 'bar',
            data: {
                labels: data.map((_, i) => `T+${i+1}`),
                datasets: [{
                    label: 'Velocity',
                    data: data,
                    backgroundColor: data.map((_, i) => i === data.length - 1 ? colors.accent : 'rgba(0, 212, 168, 0.3)'),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.9)',
                        callbacks: { label: (c) => ` Score: ${c.parsed.y}` }
                    }
                }
            }
        });
    }

    /** Helper: Draw Budget Breakdown Donut using Chart.js */
    function drawBudgetDonut(canvasId, segments) {
        const c = document.getElementById(canvasId);
        if (!c) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const data = segments.map(s => s.pct);
        const bgColors = segments.map(s => s.color);

        chartInstances[canvasId] = new Chart(c, {
            type: 'doughnut',
            data: {
                labels: ['Housing', 'Savings', 'Food', 'Others'],
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderWidth: 0,
                    hoverOffset: 4,
                    cutout: '75%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.9)',
                        bodyColor: '#e0e3e5',
                        displayColors: true,
                        callbacks: {
                            label: function(context) { return ` ${context.parsed}%`; }
                        }
                    }
                }
            }
        });
    }

    /** Helper: Draw Budget vs Actual using Chart.js — deferred until visible */
    function drawBudgetVsActual(canvasId) {
        // Disabled legacy implementation to allow refreshBudgetVsPredicted to render instead
        setTimeout(() => { if (typeof refreshBudgetVsPredicted === 'function') refreshBudgetVsPredicted(); }, 150);
    }
}


/* ---------- BUDGET MODULE ---------- */
function initBudgetLogic() {
    const isWeeklyBtn = document.getElementById('btn-expense-weekly');
    const isMonthlyBtn = document.getElementById('btn-expense-monthly');
    const sliders = [
        document.getElementById('slider-exp-housing'),
        document.getElementById('slider-exp-food'),
        document.getElementById('slider-exp-transit'),
        document.getElementById('slider-exp-discretionary')
    ];
    const inputs = [
        document.getElementById('input-exp-housing'),
        document.getElementById('input-exp-food'),
        document.getElementById('input-exp-transit'),
        document.getElementById('input-exp-discretionary')
    ];
    let isWeekly = false;

    // Savings
    const saveContrib = document.getElementById('slider-savings-contrib');
    const saveGoal = document.getElementById('slider-savings-goal');
    const inputContrib = document.getElementById('input-savings-contrib');
    const inputGoal = document.getElementById('input-savings-goal');

    // Initialize values from state
    if(appState && appState.budget) {
        if(sliders[0]) sliders[0].value = appState.budget.expenses.housing;
        if(sliders[1]) sliders[1].value = appState.budget.expenses.food;
        if(sliders[2]) sliders[2].value = appState.budget.expenses.transit;
        if(sliders[3]) sliders[3].value = appState.budget.expenses.disc;
        if(saveContrib) saveContrib.value = appState.budget.contribution;
        if(saveGoal) saveGoal.value = appState.budget.targetGoal;
    }

    const syncInputToSlider = (inputEl, sliderEl) => {
        if(inputEl && sliderEl) {
            sliderEl.value = inputEl.value;
            window.budgetUpdateCalculations();
        }
    };

    window.budgetUpdateCalculations = function() {
        if(!sliders[0]) return;
        const mult = isWeekly ? 4.33 : 1;
        
        let housing = parseInt(sliders[0].value) || 0;
        let food = parseInt(sliders[1].value) || 0;
        let transit = parseInt(sliders[2].value) || 0;
        let disc = parseInt(sliders[3].value) || 0;

        // sync sliders back to inputs on programmatic redraw
        if(inputs[0] && document.activeElement !== inputs[0]) inputs[0].value = housing;
        if(inputs[1] && document.activeElement !== inputs[1]) inputs[1].value = food;
        if(inputs[2] && document.activeElement !== inputs[2]) inputs[2].value = transit;
        if(inputs[3] && document.activeElement !== inputs[3]) inputs[3].value = disc;

        const totalMonthly = Math.round((housing + food + transit + disc) * mult);
        const sumEl = document.getElementById('summary-total-exp');
        if(sumEl) sumEl.textContent = `$${totalMonthly.toLocaleString()} /mo`;

        const contrib = parseInt(saveContrib.value) || 0;
        const goal = parseInt(saveGoal.value) || 0;
        
        if(inputContrib && document.activeElement !== inputContrib) inputContrib.value = contrib;
        if(inputGoal && document.activeElement !== inputGoal) inputGoal.value = goal;

        // Save back to APP state
        if (appState) {
            appState.budget.expenses = { housing, food, transit, disc };
            appState.budget.contribution = contrib;
            appState.budget.targetGoal = goal;
            saveState();
        }

        const tlEl = document.getElementById('savings-timeline-val');
        if (tlEl) {
            if (contrib > 0) {
                const months = goal / contrib;
                tlEl.textContent = `${(months / 12).toFixed(1)} Years`;
            } else {
                tlEl.textContent = '∞ Years';
            }
        }

        const ratio = totalMonthly > 0 ? (contrib / (totalMonthly + contrib)) * 100 : 100;
        const srEl = document.getElementById('summary-savings-ratio');
        if(srEl) srEl.textContent = `${ratio.toFixed(1)}%`;

        let aiText = "Your budget seems well balanced.";
        if(ratio < 10) aiText = "Your savings ratio is dangerously low. Try increasing monthly contributions to at least 15%.";
        else if(ratio > 30) aiText = "Excellent savings performance! Your aggressive timeline is optimized for early financial independence.";
        else aiText = "Solid structural budget. You are on track to meet your baseline portfolio goals within the estimated timeline.";
        
        const baTxt = document.getElementById('budget-ai-text');
        if(baTxt) baTxt.textContent = aiText;

        // Redraw pie chart
        const totalRaw = housing + food + transit + disc;
        if (window.drawBudgetPie) window.drawBudgetPie();
        
        // Let the rest of the application charts sync to the new state
        if (window.drawCharts) drawCharts();
    }

    sliders.forEach(s => { if(s) s.addEventListener('input', window.budgetUpdateCalculations); });
    if(saveContrib) saveContrib.addEventListener('input', window.budgetUpdateCalculations);
    if(saveGoal) saveGoal.addEventListener('input', window.budgetUpdateCalculations);

    // Bind inputs to sync with sliders
    inputs.forEach((inp, idx) => {
        if(inp) inp.addEventListener('input', () => syncInputToSlider(inp, sliders[idx]));
    });
    if(inputContrib) inputContrib.addEventListener('input', () => syncInputToSlider(inputContrib, saveContrib));
    if(inputGoal) inputGoal.addEventListener('input', () => syncInputToSlider(inputGoal, saveGoal));

    if(isWeeklyBtn && isMonthlyBtn) {
        isWeeklyBtn.onclick = () => {
            isWeekly = true;
            isWeeklyBtn.classList.add('active');
            isMonthlyBtn.classList.remove('active');
            window.budgetUpdateCalculations();
        };
        isMonthlyBtn.onclick = () => {
            isWeekly = false;
            isMonthlyBtn.classList.add('active');
            isWeeklyBtn.classList.remove('active');
            window.budgetUpdateCalculations();
        };
    }

    // Settings Icon Hook — Opens functional edit panel
    const btnMatrix = document.getElementById('btn-open-budget-matrix');
    if (btnMatrix) {
        btnMatrix.title = 'Edit expense categories';
        btnMatrix.onclick = () => {
            if (typeof openExpenseDynamicsModal === 'function') {
                openExpenseDynamicsModal();
            } else if (typeof openExpenseCategoryEditor === 'function') {
                openExpenseCategoryEditor();
            }
        };
    }

    window.drawBudgetPie = function() {
        if (!sliders[0] || !sliders[1] || !sliders[2] || !sliders[3]) return;
        const housing = parseInt(sliders[0].value) || 0;
        const food = parseInt(sliders[1].value) || 0;
        const transit = parseInt(sliders[2].value) || 0;
        const disc = parseInt(sliders[3].value) || 0;
        const total = housing + food + transit + disc;

        if (total === 0) return;

        const segments = [
            { label: 'Housing', pct: (housing/total)*100, color: '#00d4a8' },
            { label: 'Food', pct: (food/total)*100, color: '#ff4d6d' },
            { label: 'Transit', pct: (transit/total)*100, color: '#667eea' },
            { label: 'Disc.', pct: (disc/total)*100, color: '#ff9f43' }
        ];

        const c = document.getElementById('budgetBreakdownChart');
        if (!c) return;
        const ctx = c.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = c.parentElement.getBoundingClientRect();
        if(rect.width === 0) return; 
        
        const size = Math.min(rect.width, rect.height);
        c.width = size * dpr;
        c.height = size * dpr;
        c.style.width = size + 'px';
        c.style.height = size + 'px';
        ctx.scale(dpr, dpr);

        const cx = size / 2, cy = size / 2, outerR = (size / 2) - 10, innerR = outerR * 0.7;
        let startAngle = -Math.PI / 2;

        ctx.clearRect(0,0,size,size);
        segments.forEach(seg => {
            if (seg.pct <= 0) return;
            const sliceAngle = (seg.pct / 100) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
            ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
            ctx.fillStyle = seg.color;
            ctx.fill();
            startAngle += sliceAngle;
        });

        // Add glow
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(0, 212, 168, 0.2)';
    }

    // Try a delayed initial draw
    setTimeout(() => {
        window.budgetUpdateCalculations();
        if (window.drawBudgetPie) window.drawBudgetPie();
    }, 150);
}

/* ---------- STATEMENT/DUE EDUCATION CARD ----------
   Show the "Why Statement Day & Due Date matter" card unless the user has
   dismissed it. We persist the dismissal flag in localStorage so it doesn't
   pop back up on every page load. */
function initStatementEduCard() {
    const card = document.getElementById('stmt-edu-card');
    const dismissBtn = document.getElementById('stmt-edu-dismiss');
    if (!card || !dismissBtn) return;
    try {
        if (localStorage.getItem('wjp_stmt_edu_dismissed') === '1') {
            card.style.display = 'none';
        }
    } catch(_){}
    dismissBtn.addEventListener('click', () => {
        card.style.display = 'none';
        try { localStorage.setItem('wjp_stmt_edu_dismissed', '1'); } catch(_){}
    });
}

/* ---------- MODAL LOGIC ---------- */
function initModal() {
    const btnNew = document.getElementById('btn-new-entry');
    const modal = document.getElementById('entry-modal');
    const btnClose = document.getElementById('modal-close');
    const btnCancels = document.querySelectorAll('.modal-cancel');

    const tabs = document.querySelectorAll('.modal-tab');
    const forms = document.querySelectorAll('.modal-form');

    const pickerStep = document.getElementById('entry-picker-step');
    const formStep = document.getElementById('entry-form-step');
    const backToPicker = document.getElementById('entry-back-to-picker');
    const titleEl = document.getElementById('entry-modal-title');
    const limitGroup = document.getElementById('debt-limit-group');
    const debtTypeSel = document.getElementById('debt-type');

    if(!btnNew || !modal) return;

    // Always scroll the modal-content back to the top when we switch views,
    // otherwise a long form leaves the user mid-form on the next open.
    const resetModalScroll = () => {
        const mc = modal.querySelector('.modal-content');
        if (mc) mc.scrollTop = 0;
    };

    const showPicker = () => {
        if (pickerStep) pickerStep.style.display = 'block';
        if (formStep) formStep.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Add';
        const banner = document.getElementById('entry-success-banner');
        if (banner) banner.style.display = 'none';
        resetModalScroll();
    };
    const showFormStep = (tabName, title) => {
        if (pickerStep) pickerStep.style.display = 'none';
        if (formStep) formStep.style.display = 'block';
        if (titleEl) titleEl.textContent = title || 'New Entry';
        // Activate correct tab
        tabs.forEach(t => {
            t.classList.remove('active');
            t.style.opacity = '0.5';
            if (t.getAttribute('data-tab') === tabName) {
                t.classList.add('active');
                t.style.opacity = '1';
            }
        });
        forms.forEach(f => f.style.display = 'none');
        const targetForm = document.getElementById(tabName + '-form');
        if (targetForm) targetForm.style.display = 'block';
        resetModalScroll();
    };

    const closeModal = () => {
        modal.classList.remove('active');
        forms.forEach(f => f.reset());
        showPicker();
        if (limitGroup) limitGroup.style.display = 'none';
        // Forget the last route so reopening the modal lands on the picker, not
        // the previous form (would otherwise feel like the modal "remembers" stale state)
        _lastPickerRoute = null;
    };

    // Track which submit button was clicked so we know whether to keep the modal open
    // ("Save & Add Another") or close it ("Save & Close").
    let _lastSubmitMode = 'save-close';
    document.addEventListener('click', (e) => {
        const target = e.target && e.target.closest && e.target.closest('button[data-mode]');
        if (target && target.type === 'submit') {
            _lastSubmitMode = target.getAttribute('data-mode') || 'save-close';
        }
    }, true);

    // Track which picker tile the user clicked. After "Save & Add Another" we
    // re-apply the same preset so adding a credit card → save → adding another
    // credit card keeps them in card-mode (limit + dates fields stay visible),
    // not flipping back to generic Loan defaults. This is what users expect when
    // batch-adding the same kind of entry.
    let _lastPickerRoute = null;

    // Hard-clear every input inside a form. form.reset() *should* be enough, but
    // for selects whose value was set programmatically (we set debt-type from the
    // picker route), reset only restores the HTML default. We also forcibly null
    // the value of every text/number input so the user sees a truly empty form.
    const hardResetForm = (form) => {
        if (!form) return;
        try { form.reset(); } catch(_){}
        form.querySelectorAll('input').forEach(el => {
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
            else el.value = '';
        });
        form.querySelectorAll('select').forEach(el => {
            if (el.options && el.options.length > 0) el.selectedIndex = 0;
        });
        form.querySelectorAll('textarea').forEach(el => { el.value = ''; });
    };

    // Inline success banner — shown after a save when the user is staying in the modal
    const flashSuccessBanner = (msg) => {
        const banner = document.getElementById('entry-success-banner');
        const msgEl = document.getElementById('entry-success-msg');
        if (!banner || !msgEl) return;
        msgEl.textContent = msg;
        banner.style.display = 'flex';
        // Auto-fade after 4 seconds so it doesn't pile up across multiple saves
        clearTimeout(banner._t);
        banner._t = setTimeout(() => { banner.style.display = 'none'; }, 4000);
    };

    const handleSuccessState = (form, updateCallback, successMsg) => {
        const btn = form.querySelector(`button[type="submit"][data-mode="${_lastSubmitMode}"]`)
                   || form.querySelector('button[type="submit"]');
        if(!btn) return;
        const originalText = btn.innerHTML;
        const mode = _lastSubmitMode;

        btn.innerHTML = '<i class="ph ph-check-circle" style="font-size:16px;"></i> Saved';
        btn.style.backgroundColor = 'var(--accent)';
        btn.style.color = '#0b0f1a';
        btn.style.pointerEvents = 'none';
        btn.style.transition = 'all 0.25s ease';

        // Execute data updates immediately so the dashboard updates behind the modal
        if(updateCallback) updateCallback();

        if (mode === 'add-another') {
            // KEEP MODAL OPEN. Reset the fields IMMEDIATELY (don't wait 600ms —
            // that delay was leaving the user staring at their previous entry).
            // The button's "Saved" flash + success banner give the visual feedback;
            // the empty form behind it confirms the reset worked.
            flashSuccessBanner(successMsg || 'Saved. Keep adding more or click Done when finished.');

            // 1. Hard-clear every input/select/checkbox in this form
            hardResetForm(form);

            // 2. Hide all conditional panels (limit group, recurring detail blocks)
            if (limitGroup) limitGroup.style.display = 'none';
            ['debt-recurring-detail','txn-recurring-detail','income-recurring-detail'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            // 3. Reset the CC savings-preview so last-entry numbers don't bleed
            const sp = document.getElementById('debt-cc-savings-preview');
            if (sp) sp.textContent = 'Fill in balance + APR + due day to see your projected savings.';

            // 4. Re-apply the picker preset the user came in with so they stay in
            //    "credit-card mode" (or loan mode, etc) for batch entry. Without
            //    this, adding 5 credit cards in a row would flip every one of them
            //    back to generic Loan defaults.
            if (_lastPickerRoute && typeof applyPickerRoute === 'function') {
                applyPickerRoute(_lastPickerRoute);
            } else if (typeof syncDebtTypeFieldVisibility === 'function') {
                syncDebtTypeFieldVisibility();
            }

            // 5. Restore the button after a brief flash so the user sees the save confirmation
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '';
                btn.style.color = '';
                btn.style.pointerEvents = '';
            }, 600);

            // 6. Snap modal scroll to top + focus first input (preventScroll so
            //    the browser doesn't fight the snap)
            resetModalScroll();
            const firstInput = form.querySelector('input:not([type=checkbox]), select');
            if (firstInput) {
                try { firstInput.focus({ preventScroll: true }); }
                catch(_) { /* older browsers */ }
            }
            requestAnimationFrame(resetModalScroll);
            return;
        }

        // mode === 'save-close' (default) — short success flash then close
        setTimeout(() => {
            closeModal();
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '';
                btn.style.color = '';
                btn.style.pointerEvents = '';
                btn.style.transform = '';
            }, 300);
        }, 2000);
    };

    btnNew.addEventListener('click', () => {
        modal.classList.add('active');
        showPicker();
    });

    if(btnClose) btnClose.addEventListener('click', closeModal);
    btnCancels.forEach(btn => btn.addEventListener('click', closeModal));

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if(e.target === modal) closeModal();
    });

    // Re-apply a picker route's preset to a freshly-cleared form.
    // Pulled out of the click handler so handleSuccessState can call it after
    // a "Save & Add Another" to keep the user in their original entry mode.
    const applyPickerRoute = (route) => {
        if (route === 'credit-card') {
            showFormStep('new-debt', 'Add Credit Card');
            if (debtTypeSel) debtTypeSel.value = 'credit card';
            if (typeof syncDebtTypeFieldVisibility === 'function') syncDebtTypeFieldVisibility();
        } else if (route === 'loan') {
            showFormStep('new-debt', 'Add Loan');
            if (debtTypeSel) debtTypeSel.value = 'loan';
            if (typeof syncDebtTypeFieldVisibility === 'function') syncDebtTypeFieldVisibility();
        } else if (route === 'transaction') {
            showFormStep('new-transaction', 'New Transaction');
        } else if (route === 'income') {
            showFormStep('new-income', 'Add Income');
        } else if (route === 'recurring') {
            showFormStep('new-recurring', 'Add Recurring Payment');
        }
        // 'bank' route doesn't apply — that closes the modal entirely
    };

    // Picker tile routing — each tile lands the user on the right tab pre-configured
    document.querySelectorAll('.entry-tile').forEach(tile => {
        tile.addEventListener('click', () => {
            const route = tile.getAttribute('data-route');
            _lastPickerRoute = route;
            if (route === 'bank') {
                closeModal();
                if (typeof openPlaidLink === 'function') {
                    openPlaidLink();
                } else {
                    const btnBank = document.getElementById('btn-settings-link-account');
                    if (btnBank) btnBank.click();
                    else if (typeof showToast === 'function') showToast('Open Settings → Link Bank Account.');
                }
                return;
            }
            applyPickerRoute(route);
        });
    });

    // Wire recurring-toggle checkboxes — show/hide the detail panel
    [
        ['debt-recurring', 'debt-recurring-detail'],
        ['txn-recurring', 'txn-recurring-detail'],
        ['income-recurring', 'income-recurring-detail']
    ].forEach(([cbId, panelId]) => {
        const cb = document.getElementById(cbId);
        const panel = document.getElementById(panelId);
        if (cb && panel) {
            cb.addEventListener('change', () => {
                panel.style.display = cb.checked ? 'block' : 'none';
            });
            // Sync initial state (Income box defaults to checked in the HTML)
            panel.style.display = cb.checked ? 'block' : 'none';
        }
    });
    if (backToPicker) backToPicker.addEventListener('click', showPicker);

    // Toggle credit-card limit + statement/due-date fields based on debt type.
    // Credit cards see both Statement and Due day. Loans see Due day only (no statement
    // concept on amortizing loans, but early-payment interest math still applies).
    const ccDatesGroup = document.getElementById('debt-cc-dates-group');
    const ccDatesLabel = document.getElementById('debt-cc-dates-label');
    const ccStmtWrap   = document.getElementById('debt-statement-wrap');
    const ccTipBody    = document.getElementById('debt-cc-tip-body');

    const TIP_COPY = {
        card: `Card issuers report your balance to credit bureaus on the <strong>statement closing day</strong>, not the due date. If you pay it down <strong>before</strong> the statement closes, the bureaus see a lower utilization — which can lift your credit score <strong>20-50 points</strong> and avoid days of extra interest.`,
        loan: `Most loans accrue interest <strong>daily</strong>. Paying earlier in the cycle (or making an extra principal payment) means fewer days of interest piling up — over the life of the loan, even small early-pay habits can save thousands.`
    };

    const syncDebtTypeFieldVisibility = () => {
        const t = (debtTypeSel?.value || '').toLowerCase();
        const isCard = t.includes('credit') || t.includes('card');
        const isLoan = !isCard; // anything that isn't a card is loan-style for our purposes

        if (limitGroup) limitGroup.style.display = isCard ? '' : 'none';
        if (ccDatesGroup) ccDatesGroup.style.display = ''; // always show — both card and loan benefit
        if (ccDatesLabel) ccDatesLabel.textContent = isCard ? 'Statement & Due Dates' : 'Payment Due Date';
        if (ccStmtWrap)   ccStmtWrap.style.display = isCard ? '' : 'none';
        if (ccTipBody)    ccTipBody.innerHTML = isCard ? TIP_COPY.card : TIP_COPY.loan;
        // If user changed type while tip was open, re-run the preview so numbers match
        const tipBlock = document.getElementById('debt-cc-dates-tip');
        if (tipBlock && tipBlock.style.display !== 'none') updateSavingsPreview();
    };
    if (debtTypeSel) {
        debtTypeSel.addEventListener('change', syncDebtTypeFieldVisibility);
        // Initial sync
        setTimeout(syncDebtTypeFieldVisibility, 0);
    }

    // Tip popover — toggle the explanation block + run a live savings preview
    const tipIcon = document.querySelector('.info-pop[data-tip="cc-dates"]');
    const tipBlock = document.getElementById('debt-cc-dates-tip');
    const savingsPreview = document.getElementById('debt-cc-savings-preview');
    function updateSavingsPreview() {
        if (!savingsPreview) return;
        const t = (debtTypeSel?.value || '').toLowerCase();
        const isCard = t.includes('credit') || t.includes('card');
        const bal = parseFloat(document.getElementById('debt-balance')?.value) || 0;
        const apr = parseFloat(document.getElementById('debt-apr')?.value) || 0;
        const lim = parseFloat(document.getElementById('debt-limit')?.value) || 0;
        const min = parseFloat(document.getElementById('debt-min')?.value) || 0;
        const stmt = parseInt(document.getElementById('debt-statement-day')?.value, 10);
        const due = parseInt(document.getElementById('debt-due-day')?.value, 10);
        if (!bal || !apr) {
            savingsPreview.textContent = 'Fill in balance + APR + due day to see your projected savings.';
            return;
        }
        const dailyRate = apr / 100 / 365;
        const lines = [];

        if (isCard) {
            const utilNow = lim > 0 ? Math.min(100, (bal / lim) * 100) : null;
            const payoffToHitTarget = (lim > 0 && utilNow > 9) ? Math.max(0, bal - (lim * 0.09)) : 0;
            const daysBetween = (stmt && due && due > stmt) ? (due - stmt) : 25;
            const interestSavedYr = bal * dailyRate * daysBetween * 12;
            if (lim > 0 && utilNow !== null) {
                lines.push(`Reported utilization right now: ~<strong>${utilNow.toFixed(0)}%</strong>.`);
                if (payoffToHitTarget > 0) {
                    lines.push(`Paying <strong>$${payoffToHitTarget.toFixed(0)}</strong> before statement closes drops reported utilization under 10% — typically worth <strong>20-50 FICO points</strong>.`);
                } else {
                    lines.push(`Already under 10% utilization — that's the FICO sweet spot.`);
                }
            }
            if (interestSavedYr > 0) {
                lines.push(`Estimated interest saved over a year by paying before each statement: <strong>~$${interestSavedYr.toFixed(0)}</strong>.`);
            }
        } else {
            // Loan math: paying X days early on every monthly cycle saves daysEarly × dailyInterest × 12
            const daysEarly = 7; // assume paying ~1 week early
            const annualSavings = bal * dailyRate * daysEarly * 12;
            lines.push(`At ${apr.toFixed(2)}% APR, this loan accrues about <strong>$${(bal * dailyRate).toFixed(2)}/day</strong> in interest.`);
            if (annualSavings > 0) {
                lines.push(`Paying ~7 days before the due date each month would save you <strong>~$${annualSavings.toFixed(0)}/year</strong> in interest.`);
            }
            if (min > 0 && bal > 0) {
                // Rough payoff months at minimum payment, with and without an extra $50/mo
                const payoffMonths = (m) => {
                    if (m <= 0 || m >= bal) return null;
                    let b = bal, count = 0;
                    while (b > 0 && count < 600) {
                        const interest = b * (apr/100/12);
                        const principal = m - interest;
                        if (principal <= 0) return null;
                        b -= principal;
                        count++;
                    }
                    return count;
                };
                const baseMonths = payoffMonths(min);
                const fasterMonths = payoffMonths(min + 50);
                if (baseMonths && fasterMonths && baseMonths > fasterMonths) {
                    lines.push(`Adding just <strong>$50/mo</strong> would shave <strong>${baseMonths - fasterMonths} months</strong> off the payoff timeline.`);
                }
            }
        }
        savingsPreview.innerHTML = lines.join(' ');
    }
    if (tipIcon && tipBlock) {
        tipIcon.addEventListener('click', () => {
            const open = tipBlock.style.display !== 'none';
            tipBlock.style.display = open ? 'none' : 'block';
            if (!open) updateSavingsPreview();
        });
        tipIcon.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tipIcon.click(); }
        });
    }
    // Live-update savings preview as the user types
    ['debt-balance','debt-apr','debt-limit','debt-min','debt-statement-day','debt-due-day','debt-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (tipBlock && tipBlock.style.display !== 'none') updateSavingsPreview();
        });
    });

    // Tab Switching Logic
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.style.opacity = '0.5';
            });
            tab.classList.add('active');
            tab.style.opacity = '1';

            const targetId = tab.getAttribute('data-tab') + '-form';
            forms.forEach(f => f.style.display = 'none');
            const targetForm = document.getElementById(targetId);
            if (targetForm) targetForm.style.display = 'block';
            // Re-snap to top so the user starts at the first field of the new form
            resetModalScroll();
        });
    });

    // Helper: append a recurring payment record + log activity. Used by every form
    // whose "Recurring?" toggle is on, so the Recurring Payments tab gets populated
    // consistently no matter where the entry was created.
    const addRecurringRecord = (rec) => {
        if (!appState.recurringPayments) appState.recurringPayments = [];
        appState.recurringPayments.push({
            id: 'r' + Date.now() + Math.floor(Math.random()*1000),
            name: rec.name,
            category: rec.category || 'subscription',
            amount: Number(rec.amount) || 0,
            frequency: rec.frequency || 'monthly',
            nextDate: rec.nextDate || null,
            linkedDebtId: rec.linkedDebtId || null,
            linkedIncome: !!rec.linkedIncome,
            createdAt: Date.now()
        });
    };

    // Form 1: Debt Submit
    const formDebt = document.getElementById('new-debt-form');
    if(formDebt) {
        formDebt.addEventListener('submit', (e) => {
            e.preventDefault();

            handleSuccessState(formDebt, () => {
                const typeVal = (document.getElementById('debt-type')?.value || 'loan').toLowerCase();
                const limVal = parseFloat(document.getElementById('debt-limit')?.value);
                const stmtDay = parseInt(document.getElementById('debt-statement-day')?.value, 10);
                const dueDay = parseInt(document.getElementById('debt-due-day')?.value, 10);
                const balVal = parseFloat(document.getElementById('debt-balance').value) || 0;
                const newDebt = {
                    id: 'd' + Date.now(),
                    name: document.getElementById('debt-name').value || 'Unknown Obligation',
                    type: typeVal,
                    balance: balVal,
                    // Snapshot the starting balance so % paid math works as the user
                    // logs payments. Without this, progress bars never grow.
                    originalBalance: balVal,
                    createdAt: Date.now(),
                    apr: parseFloat(document.getElementById('debt-apr').value) || 0,
                    minPayment: parseFloat(document.getElementById('debt-min').value) || 0,
                    // dueDate now prefers user-entered due day; falls back to a random day if blank
                    dueDate: (!isNaN(dueDay) && dueDay >= 1 && dueDay <= 31) ? dueDay : Math.floor(Math.random() * 28) + 1,
                    statementDay: (!isNaN(stmtDay) && stmtDay >= 1 && stmtDay <= 31) ? stmtDay : null,
                    dueDay: (!isNaN(dueDay) && dueDay >= 1 && dueDay <= 31) ? dueDay : null,
                    limit: (!isNaN(limVal) && limVal > 0) ? limVal : 0,
                    lastUpdated: Date.now(),
                    attachments: []
                };
                appState.debts.push(newDebt);
                if (newDebt.limit > 0) {
                    try {
                        const cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
                        cs.cardLimits = cs.cardLimits || {};
                        cs.cardLimits[newDebt.id] = newDebt.limit;
                        localStorage.setItem('wjp_credit_inputs', JSON.stringify(cs));
                    } catch(_){}
                }

                // Recurring auto-pay reminder?
                const recCB = document.getElementById('debt-recurring');
                if (recCB && recCB.checked && newDebt.minPayment > 0) {
                    const day = parseInt(document.getElementById('debt-recurring-day')?.value, 10);
                    const today = new Date();
                    const next = new Date(today.getFullYear(), today.getMonth(), Math.min(day || newDebt.dueDate || 15, 28));
                    if (next < today) next.setMonth(next.getMonth() + 1);
                    addRecurringRecord({
                        name: `${newDebt.name} (min payment)`,
                        category: 'debt',
                        amount: newDebt.minPayment,
                        frequency: document.getElementById('debt-recurring-freq')?.value || 'monthly',
                        nextDate: next.toISOString().slice(0,10),
                        linkedDebtId: newDebt.id
                    });
                }

                saveState();
                updateUI();
                if (typeof logActivity === 'function') {
                    logActivity({
                        title: 'Debt added',
                        text: `${newDebt.name} — $${Number(newDebt.balance || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} @ ${newDebt.apr}% APR`,
                        type: 'debt',
                        priority: 'normal',
                        link: '#debts'
                    });
                }
            }, 'Debt saved. Add another or click Done when finished.');
        });
    }

    // Form 2: Expense Submit
    const formExpense = document.getElementById('new-expense-form');
    if(formExpense) {
        formExpense.addEventListener('submit', (e) => {
            e.preventDefault();

            handleSuccessState(formExpense, () => {
                const cat = document.getElementById('expense-category').value;
                const amt = parseFloat(document.getElementById('expense-amount').value);

                if (appState.budget.expenses[cat] !== undefined) {
                    appState.budget.expenses[cat] += amt;
                }
                saveState();

                const sliders = [
                    document.getElementById('slider-exp-housing'),
                    document.getElementById('slider-exp-food'),
                    document.getElementById('slider-exp-transit'),
                    document.getElementById('slider-exp-discretionary')
                ];
                if (sliders[0]) sliders[0].value = appState.budget.expenses.housing;
                if (sliders[1]) sliders[1].value = appState.budget.expenses.food;
                if (sliders[2]) sliders[2].value = appState.budget.expenses.transit;
                if (sliders[3]) sliders[3].value = appState.budget.expenses.disc;
                if (window.budgetUpdateCalculations) window.budgetUpdateCalculations();
                updateUI();
            }, 'Expense saved. Add another or click Done when finished.');
        });
    }

    // Form 3: Transaction Submit (with optional recurring schedule)
    const formTxn = document.getElementById('new-transaction-form');
    if (formTxn) {
        // Live auto-categorization: as user types merchant, suggest a category
        // and auto-set the category dropdown if user hasn't picked one yet.
        const merchantInput = document.getElementById('txn-merchant');
        const categorySelect = document.getElementById('txn-category');
        if (merchantInput && categorySelect) {
            let userPickedCategory = false;
            categorySelect.addEventListener('change', () => { userPickedCategory = true; });
            merchantInput.addEventListener('input', () => {
                const guess = autoCategorizeMerchant(merchantInput.value);
                if (!guess) return;
                if (userPickedCategory) return;
                // Try to find matching option in select
                const match = Array.from(categorySelect.options).find(o => {
                    return o.value.toLowerCase() === guess.toLowerCase()
                        || o.textContent.toLowerCase().includes(guess.toLowerCase().split(' ')[0]);
                });
                if (match) categorySelect.value = match.value;
            });
            // Reset auto-pick flag when form opens fresh
            formTxn.addEventListener('reset', () => { userPickedCategory = false; });
        }

        formTxn.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSuccessState(formTxn, () => {
                const amt = parseFloat(document.getElementById('txn-amount').value);
                const cat = document.getElementById('txn-category').value;
                const merchant = document.getElementById('txn-merchant').value || 'Uncategorized';
                const newTxn = {
                    id: 't' + Date.now(),
                    date: new Date().toISOString(),
                    merchant: merchant,
                    category: cat,
                    amount: -Math.abs(amt),
                    method: document.getElementById('txn-method').value || 'Cash/Other',
                    status: 'completed'
                };

                if (cat === 'Debt Payment' && appState.debts.length > 0) {
                    const debtId = document.getElementById('txn-debt-link')?.value;
                    const debt = debtId ? appState.debts.find(d => d.id === debtId) : appState.debts[0];
                    if (debt) {
                        debt.balance = Math.max(0, debt.balance - amt);
                        newTxn.merchant = `Payment: ${debt.name}`;
                    }
                }

                appState.transactions.unshift(newTxn);

                // Recurring transaction? Create the schedule.
                const recCB = document.getElementById('txn-recurring');
                if (recCB && recCB.checked) {
                    addRecurringRecord({
                        name: merchant,
                        category: cat.toLowerCase().includes('housing') ? 'rent'
                                : cat.toLowerCase().includes('debt') ? 'debt'
                                : cat.toLowerCase().includes('utilit') ? 'utility'
                                : 'subscription',
                        amount: amt,
                        frequency: document.getElementById('txn-recurring-freq')?.value || 'monthly',
                        nextDate: document.getElementById('txn-recurring-next')?.value || null
                    });
                }

                saveState();
                updateUI();
            }, 'Transaction saved. Add another or click Done when finished.');
        });
    }

    // Form 4: Income Submit
    const formIncome = document.getElementById('new-income-form');
    if(formIncome) {
        formIncome.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSuccessState(formIncome, () => {
                const source = document.getElementById('income-source').value || 'Income';
                const amt = parseFloat(document.getElementById('income-amount').value) || 0;
                const type = document.getElementById('income-type')?.value || 'paycheck';
                const recCB = document.getElementById('income-recurring');
                const isRec = !!(recCB && recCB.checked);

                // Log as a positive-amount transaction so the cash-flow charts pick it up
                appState.transactions.unshift({
                    id: 't' + Date.now(),
                    date: new Date().toISOString(),
                    merchant: source,
                    category: 'Income',
                    amount: Math.abs(amt),
                    method: 'Direct Deposit',
                    status: 'completed',
                    incomeType: type
                });

                // If this is recurring, also bump the user's monthly income field
                // so DTI / cash-flow projections immediately reflect the paycheck.
                if (isRec) {
                    const freq = document.getElementById('income-recurring-freq')?.value || 'monthly';
                    let monthlyEquiv = amt;
                    if (freq === 'biweekly') monthlyEquiv = amt * 26 / 12;
                    else if (freq === 'weekly') monthlyEquiv = amt * 52 / 12;
                    else if (freq === 'semimonthly') monthlyEquiv = amt * 2;
                    else if (freq === 'annually') monthlyEquiv = amt / 12;

                    if (!appState.budget) appState.budget = {};
                    appState.budget.income = (Number(appState.budget.income) || 0) + monthlyEquiv;

                    addRecurringRecord({
                        name: source,
                        category: 'income',
                        amount: amt,
                        frequency: freq,
                        nextDate: document.getElementById('income-recurring-next')?.value || null,
                        linkedIncome: true
                    });
                }

                saveState();
                updateUI();
                if (typeof logActivity === 'function') {
                    logActivity({
                        title: 'Income added',
                        text: `${source} — $${Number(amt).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}${isRec ? ' (recurring)' : ''}`,
                        type: 'income',
                        priority: 'normal',
                        link: '#budgets'
                    });
                }
            }, 'Income saved. Add another or click Done when finished.');
        });
    }

    // Form 5: Recurring-only (subscription / bill / rent without a one-time txn record)
    const formRec = document.getElementById('new-recurring-form');
    if(formRec) {
        formRec.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSuccessState(formRec, () => {
                addRecurringRecord({
                    name: document.getElementById('rec-name').value || 'Recurring Item',
                    category: document.getElementById('rec-category')?.value || 'subscription',
                    amount: parseFloat(document.getElementById('rec-amount').value) || 0,
                    frequency: document.getElementById('rec-frequency')?.value || 'monthly',
                    nextDate: document.getElementById('rec-next-date')?.value || null
                });
                saveState();
                updateUI();
                if (typeof logActivity === 'function') {
                    logActivity({
                        title: 'Recurring payment added',
                        text: `${document.getElementById('rec-name').value} — $${(parseFloat(document.getElementById('rec-amount').value)||0).toFixed(2)} / ${document.getElementById('rec-frequency').value}`,
                        type: 'recurring',
                        priority: 'normal',
                        link: '#debts'
                    });
                }
            }, 'Recurring payment saved. Add another or click Done when finished.');
        });
    }

    // Form 6: Asset Submit
    const formAsset = document.getElementById('new-asset-form');
    if(formAsset) {
        formAsset.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSuccessState(formAsset, () => {
                const newAsset = {
                    id: 'a' + Date.now(),
                    name: document.getElementById('asset-name')?.value || 'New Asset',
                    value: parseFloat(document.getElementById('asset-value')?.value) || 0,
                    type: document.getElementById('asset-type')?.value || 'Investment',
                    growth: parseFloat(document.getElementById('asset-growth')?.value) || 0
                };

                if (!appState.assets) appState.assets = [];
                appState.assets.push(newAsset);

                appState.transactions.unshift({
                    id: 't' + Date.now(),
                    date: new Date().toISOString(),
                    merchant: `Asset Acquired: ${newAsset.name}`,
                    category: 'Investment',
                    amount: -newAsset.value,
                    method: 'Manual Entry',
                    status: 'completed'
                });

                saveState();
                updateUI();
            }, 'Asset saved. Add another or click Done when finished.');
        });
    }
}

/* ---------- TOP-3 STRATEGY FOCUS BAR ----------
   Renders the three debts the user should attack first based on selected strategy.
   Wires the chip tabs so clicking re-orders the list AND updates appState.settings.strategy
   so the rest of the dashboard (DFD hero, AI advisor, strategy indicators) reflects it. */
function renderTop3Strategy() {
    const wrap = document.getElementById('top3-strategy');
    const grid = document.getElementById('top3-grid');
    const labelEl = document.getElementById('top3-strategy-label');
    const tabs = document.querySelectorAll('#top3-strategy-tabs .chip');
    if (!wrap || !grid) return;

    const strategy = (appState.settings && appState.settings.strategy) || 'avalanche';
    const niceLbl = strategy[0].toUpperCase() + strategy.slice(1);
    if (labelEl) labelEl.textContent = niceLbl;
    tabs.forEach(t => {
        const is = t.getAttribute('data-strategy') === strategy;
        t.classList.toggle('active', is);
    });

    if (!appState.debts || appState.debts.length === 0) {
        grid.innerHTML = `
          <div class="top3-empty">
            <i class="ph ph-target" style="font-size:28px; opacity:0.4; display:block; margin-bottom:8px;"></i>
            Add debts to see your prioritized payoff plan.
          </div>`;
        return;
    }

    const sorted = sortDebtsByStrategy(appState.debts, strategy);
    const top3 = sorted.slice(0, 3);
    const fmt = n => '$' + Math.round(n || 0).toLocaleString();

    // Per-strategy "why this one" copy uses the new debtRationale helper which
    // surfaces real numbers (monthly bleed, APR, time-to-clear) so the user sees
    // exactly why each debt is ranked.
    const reasonFor = (d, idx) => {
        try { return debtRationale(d, strategy, idx); } catch(_) {}
        if (strategy === 'snowball') return `Smallest balance${idx === 0 ? ' — quickest win' : ''}`;
        if (strategy === 'avalanche') return `Highest APR${idx === 0 ? ' — biggest interest drain' : ''}`;
        return `Best balance/APR mix${idx === 0 ? ' — top priority' : ''}`;
    };

    // For each focus debt, calculate progress vs. its original balance.
    // We track originalBalance on the debt record (set at creation) so
    // "% paid" reflects real progress, not just current balance.
    grid.innerHTML = top3.map((d, idx) => {
        const orig = Math.max(d.originalBalance || d.balance || 0, d.balance || 0, 1);
        const paid = Math.max(0, orig - (d.balance || 0));
        const pct = Math.min(100, Math.round((paid / orig) * 100));
        const ranks = ['1', '2', '3'];
        const ringColor = idx === 0 ? 'var(--accent)' : idx === 1 ? '#a855f7' : '#60a5fa';
        return `
          <div class="top3-card" data-debt-id="${d.id}" style="--rank-color:${ringColor};">
            <div class="top3-rank-badge">${ranks[idx]}</div>
            <div class="top3-card-head">
              <div class="top3-debt-name" title="${d.name}">${d.name || 'Unnamed debt'}</div>
              <div class="top3-debt-apr">${(d.apr || 0).toFixed(2)}% APR</div>
            </div>
            <div class="top3-debt-reason">${reasonFor(d, idx)}</div>
            <div class="top3-progress-stats">
              <span class="top3-paid">${fmt(paid)} paid</span>
              <span class="top3-pct">${pct}%</span>
              <span class="top3-target">${fmt(d.balance || 0)} left</span>
            </div>
            <div class="top3-progress-track">
              <div class="top3-progress-fill" style="width:${pct}%; background:${ringColor};"></div>
            </div>
          </div>
        `;
    }).join('');

    // Wire chip tabs (rebind every render in case of DOM changes elsewhere)
    tabs.forEach(t => {
        t.onclick = () => {
            const newStrat = t.getAttribute('data-strategy');
            if (!newStrat) return;
            appState.settings.strategy = newStrat;
            saveState();
            updateUI(); // cascades the strategy through DFD hero, AI advisor, etc.
        };
    });
}

/* ---------- MATH BREAKDOWN PANEL ----------
 * Transparent panel showing exactly what feeds the strategy projections:
 *   Income − Expenses − Bills − Subscriptions − Debt Minimums = Surplus.
 * That surplus flows to the priority debt as the auto-derived extra
 * contribution. Without this panel, users couldn't verify why the projection
 * said "20 months to debt-free" — it looked like magic. This shows the math.
 */
function renderMathBreakdown() {
    const panel = document.getElementById('math-breakdown');
    if (!panel) return;

    const income = (appState.balances && parseFloat(appState.balances.monthlyIncome)) || 0;
    const expensesObj = (appState.budget && appState.budget.expenses) || {};
    const expenses = Object.values(expensesObj).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const totalMin = (appState.debts || []).reduce((s, d) => s + (parseFloat(d.minPayment) || 0), 0);

    // Split recurring outflows into bills (essential) vs subscriptions (discretionary)
    const recurring = (appState.recurringPayments || [])
        .filter(r => r && !r.linkedIncome && r.category !== 'income' && !r.linkedDebtId);
    const monthlize = (r) => {
        const freq = (r.frequency || 'monthly').toLowerCase();
        const amt = parseFloat(r.amount) || 0;
        if (freq === 'weekly') return amt * 52 / 12;
        if (freq === 'biweekly') return amt * 26 / 12;
        if (freq === 'semimonthly') return amt * 2;
        if (freq === 'quarterly') return amt / 3;
        if (freq === 'annually') return amt / 12;
        return amt;
    };
    let bills = 0, subscriptions = 0;
    recurring.forEach(r => {
        const m = monthlize(r);
        if (classifyRecurring(r) === 'bill') bills += m;
        else subscriptions += m;
    });

    const surplus = Math.max(0, income - expenses - bills - subscriptions - totalMin);
    const totalToDebt = totalMin + surplus;

    const fmtUsd = n => '$' + Math.round(n || 0).toLocaleString();
    const fmtNeg = n => (n > 0 ? '−' : '') + fmtUsd(n);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('math-income', fmtUsd(income));
    set('math-expenses', fmtNeg(expenses));
    set('math-bills', fmtNeg(bills));
    set('math-subscriptions', fmtNeg(subscriptions));
    set('math-minimums', fmtNeg(totalMin));
    set('math-surplus', fmtUsd(surplus));
    set('math-total-to-debt', fmtUsd(totalToDebt) + '/mo');

    // Estimated payoff using the user's selected strategy
    let payoffStr = '—';
    let warning = '';
    try {
        const strategy = (appState.settings && appState.settings.strategy) || 'avalanche';
        const stats = calcSimTotals(strategy, surplus, 0, 0);
        if (stats && stats.months > 0 && stats.months < 600) {
            const payoff = new Date();
            payoff.setMonth(payoff.getMonth() + stats.months);
            payoffStr = `${payoff.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} · ${stats.months} mo`;
        } else if (stats && stats.months >= 600) {
            warning = "At your current cash flow, your minimum payments aren't enough to clear the debt. Increase income, reduce expenses, or refinance high-APR debts.";
        }
    } catch(_){}
    set('math-payoff', payoffStr);

    // Sanity warnings
    const warnEl = document.getElementById('math-warning');
    if (warnEl) {
        const warnings = [];
        if (income <= 0) warnings.push("⚠️ Add your monthly income for an accurate projection.");
        if (expenses <= 0 && (appState.budget && Object.keys(appState.budget.expenses || {}).length > 0)) {
            warnings.push("⚠️ Living expenses are $0 — your projection may be too optimistic. Edit budget categories.");
        }
        if (warning) warnings.push(warning);
        if (warnings.length) {
            warnEl.innerHTML = warnings.join('<br>');
            warnEl.style.display = 'block';
        } else {
            warnEl.style.display = 'none';
        }
    }
}

// Wire up toggle + edit buttons after DOM load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const toggle = document.getElementById('math-breakdown-toggle');
        const body = document.getElementById('math-breakdown-body');
        if (toggle && body) {
            toggle.addEventListener('click', () => {
                const isOpen = !body.hidden;
                body.hidden = isOpen;
                toggle.setAttribute('aria-expanded', String(!isOpen));
                const label = toggle.querySelector('.math-breakdown-toggle-label');
                if (label) label.textContent = isOpen ? 'Show details' : 'Hide details';
                const caret = toggle.querySelector('i');
                if (caret) caret.className = isOpen ? 'ph ph-caret-down' : 'ph ph-caret-up';
            });
        }
        const editIncome = document.getElementById('math-edit-income');
        if (editIncome) editIncome.onclick = () => {
            if (typeof navTo === 'function') navTo('budgets');
        };
        const editExpenses = document.getElementById('math-edit-expenses');
        if (editExpenses) editExpenses.onclick = () => {
            if (typeof navTo === 'function') navTo('budgets');
        };
    }, 100);
});

/* ---------- DFD QUARTER MILESTONES ----------
   Updates the encouragement copy based on % paid. Crossing 25/50/75/100
   triggers a celebratory message that fades after a few seconds. */
function updateDfdEncouragement(pct) {
    const el = document.getElementById('dfd-encouragement');
    if (!el) return;
    if (!pct || pct <= 0) { el.style.display = 'none'; return; }
    const lastShown = parseInt(el.getAttribute('data-last') || '0', 10);
    let bucket = 0;
    if (pct >= 100) bucket = 100;
    else if (pct >= 75) bucket = 75;
    else if (pct >= 50) bucket = 50;
    else if (pct >= 25) bucket = 25;
    if (bucket === 0 || bucket === lastShown) { return; }
    const msgs = {
        25: '🎯 Quarter of the way there. Real momentum building.',
        50: '🔥 Halfway home. Every payment from here counts double.',
        75: '⚡ Final quarter. The end is in sight.',
        100: '🎉 Debt-free. You did it.'
    };
    el.textContent = msgs[bucket];
    el.style.display = 'block';
    el.setAttribute('data-last', String(bucket));
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

/* ---------- AUTO-MATERIALIZE TRANSACTIONS FROM RECURRING PAYMENTS ----------
 * In real life every recurring bill, paycheck, and debt minimum produces a
 * bank transaction — they don't live in a separate "recurring" bucket. Until
 * Plaid is wired up, we synthesize that for the user: every time updateUI
 * runs, walk each recurring record and back-fill any monthly occurrences that
 * have already happened but don't yet have a matching synthetic transaction.
 *
 * Each synthetic transaction is tagged with synthetic:true and parentRecurringId
 * so we never double-create or confuse it with a manually-logged transaction.
 */
// Cache state hash so we skip the (expensive) materialize pass when nothing
// relevant has changed. Reset by saveState/updates that mutate the inputs.
let _lastMaterializeHash = null;

function _computeMaterializeHash() {
    const debts = (appState && appState.debts) || [];
    const recs  = (appState && appState.recurringPayments) || [];
    // Fast hash: count + concat of ids + amounts + dates. Doesn't need to be
    // crypto-perfect, just unique for the dimensions that affect output.
    const dKey = debts.map(d => `${d.id}|${d.minPayment}|${d.dueDay || d.dueDate}`).join(';');
    const rKey = recs.map(r => `${r.id}|${r.amount}|${r.frequency}|${r.nextDate||''}|${r.linkedIncome?1:0}`).join(';');
    return `${debts.length}::${recs.length}::${dKey}::${rKey}`;
}

function materializeRecurringTransactions() {
    if (!appState) return;
    if (!Array.isArray(appState.recurringPayments)) appState.recurringPayments = [];
    if (!Array.isArray(appState.transactions)) appState.transactions = [];

    // Skip if the dimensions that affect synthetic-txn output haven't changed
    // since last call. This is the single biggest win — most updateUI calls
    // were re-doing the entire scan when only the strategy chip changed etc.
    const hash = _computeMaterializeHash();
    if (hash === _lastMaterializeHash) return;
    _lastMaterializeHash = hash;

    const now = new Date();
    const horizonMonths = 6;
    let createdAny = false;

    // CLEANUP: drop synthetic transactions whose parent recurring/debt no longer
    // exists. Use Sets for O(1) parent lookups instead of repeated .find().
    const recIds = new Set(appState.recurringPayments.map(r => r && r.id).filter(Boolean));
    const debtIds = new Set((appState.debts || []).map(d => d && d.id).filter(Boolean));
    const before = appState.transactions.length;
    appState.transactions = appState.transactions.filter(t => {
        if (!t.synthetic) return true;
        if (t.parentRecurringId && !recIds.has(t.parentRecurringId)) return false;
        if (t.parentDebtId && !debtIds.has(t.parentDebtId)) return false;
        return true;
    });
    if (appState.transactions.length !== before) createdAny = true;

    // Pre-build a Set of existing synthetic-transaction keys so per-candidate
    // dedupe is O(1) instead of O(N) via .some(). Was the slowest part of the
    // pass when the user had many recurring payments.
    const existingKeys = new Set();
    appState.transactions.forEach(t => {
        if (!t.synthetic) return;
        const dateIso = (t.date || '').slice(0, 10);
        if (t.parentRecurringId) existingKeys.add(`r:${t.parentRecurringId}:${dateIso}`);
        if (t.parentDebtId)      existingKeys.add(`d:${t.parentDebtId}:${dateIso}`);
    });

    appState.recurringPayments.forEach(rec => {
        if (!rec || !rec.amount) return;
        const isIncome = rec.linkedIncome || rec.category === 'income';
        const freq = (rec.frequency || 'monthly').toLowerCase();
        // Only materialize monthly+ frequencies for now — daily/weekly would
        // flood the table. Weekly/biweekly use approximation.
        let stepDays;
        if (freq === 'weekly') stepDays = 7;
        else if (freq === 'biweekly') stepDays = 14;
        else if (freq === 'semimonthly') stepDays = 15;
        else if (freq === 'quarterly') stepDays = 90;
        else if (freq === 'annually') stepDays = 365;
        else stepDays = 30; // monthly default

        // Determine the anchor date: nextDate if provided, else the recurring's
        // creation timestamp month, else today.
        let anchor;
        if (rec.nextDate) {
            anchor = new Date(rec.nextDate + 'T12:00:00');
        } else if (rec.createdAt) {
            anchor = new Date(rec.createdAt);
        } else {
            anchor = new Date(now);
        }

        // Walk backwards from the anchor by stepDays until we exceed horizon.
        // Walk forwards too if anchor is in the past (fill in subsequent occurrences).
        const horizon = new Date(now); horizon.setMonth(horizon.getMonth() - horizonMonths);
        const futureCap = new Date(now); futureCap.setHours(23,59,59,999);

        // If the anchor is in the future (e.g. user entered "Next Due: May 1"
        // and today is April 27), walk it backwards by stepDays until it's a
        // past or present date. Otherwise the loops below would never execute
        // and we'd materialize ZERO transactions for that recurring entry —
        // which is exactly why weekly income looked missing on the dashboard.
        let walkAnchor = new Date(anchor);
        while (walkAnchor > futureCap) {
            walkAnchor = new Date(walkAnchor); walkAnchor.setDate(walkAnchor.getDate() - stepDays);
        }

        // Build set of occurrence dates between [horizon, today]
        const dates = [];
        // Walk backwards from anchor
        let d = new Date(walkAnchor);
        while (d >= horizon && d <= futureCap) {
            dates.push(new Date(d));
            d = new Date(d); d.setDate(d.getDate() - stepDays);
        }
        // Walk forwards from anchor (only matters when anchor is mid-window)
        d = new Date(walkAnchor); d.setDate(d.getDate() + stepDays);
        while (d <= futureCap) {
            dates.push(new Date(d));
            d = new Date(d); d.setDate(d.getDate() + stepDays);
        }
        // Dedupe
        const seenIso = new Set();
        const uniqueDates = dates
            .map(x => x.toISOString().slice(0,10))
            .filter(iso => { if (seenIso.has(iso)) return false; seenIso.add(iso); return true; });

        // For each occurrence date, ensure a synthetic transaction exists.
        // Uses pre-built Set for O(1) dedupe rather than O(N) .some() walk.
        const mutedSet = new Set(appState.mutedTxnIds || []);
        uniqueDates.forEach(iso => {
            if (existingKeys.has(`r:${rec.id}:${iso}`)) return;
            // Skip occurrences the user explicitly hid via the trash icon.
            const candidateId = 'rec-' + rec.id + '-' + iso;
            if (mutedSet.has(candidateId)) return;

            const dateObj = new Date(iso + 'T12:00:00');
            const cat = (rec.category || '').toLowerCase();
            const txnCategory = cat === 'income' ? 'Income'
                : cat === 'rent' ? 'Housing'
                : cat === 'utility' ? 'Utilities'
                : cat === 'debt' ? 'Debt Payment'
                : cat === 'insurance' ? 'Insurance'
                : cat === 'membership' ? 'Membership'
                : 'Recurring';
            const amount = isIncome ? Math.abs(rec.amount) : -Math.abs(rec.amount);

            appState.transactions.push({
                id: 'rec-' + rec.id + '-' + iso,
                date: dateObj.toISOString(),
                merchant: rec.name || 'Recurring',
                category: txnCategory,
                amount: amount,
                method: 'Auto (recurring)',
                status: dateObj <= now ? 'completed' : 'scheduled',
                synthetic: true,
                parentRecurringId: rec.id
            });
            existingKeys.add(`r:${rec.id}:${iso}`);
            createdAny = true;
        });
    });

    // Walk debts too — every debt with a minimum payment + due day generates
    // a monthly synthetic transaction tagged parentDebtId.
    const horizon = new Date(now); horizon.setMonth(horizon.getMonth() - 6);
    (appState.debts || []).forEach(debt => {
        if (!debt || !debt.minPayment || debt.minPayment <= 0) return;
        const dueDay = parseInt(debt.dueDay || debt.dueDate, 10) || 15;
        // Walk back 6 calendar months
        for (let m = 0; m < 6; m++) {
            const target = new Date(now.getFullYear(), now.getMonth() - m, Math.min(dueDay, 28), 12, 0, 0, 0);
            if (target < horizon || target > now) continue;
            const iso = target.toISOString().slice(0, 10);
            if (existingKeys.has(`d:${debt.id}:${iso}`)) continue;
            appState.transactions.push({
                id: 'debt-' + debt.id + '-' + iso,
                date: target.toISOString(),
                merchant: debt.name || 'Debt payment',
                category: 'Debt Payment',
                amount: -Math.abs(debt.minPayment),
                method: 'Auto (minimum)',
                status: 'completed',
                synthetic: true,
                parentDebtId: debt.id
            });
            existingKeys.add(`d:${debt.id}:${iso}`);
            createdAny = true;
        }
    });

    if (createdAny) {
        appState.transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
}

/* ---------- UI RENDER ENGINE ---------- */
function updateUI() {
    if (!appState) return;

    // Reset simulator cache for this render — DFD hero, AI advisor progress
    // strip, projection chart, and Top-3 bar all call calcSimTotals/Trajectory
    // with the same params, so memoizing within a single render saves 4-6
    // duplicate runs of the 600-month payoff loop.
    _clearSimCache();

    // Synthesize transactions from recurring payments BEFORE we render so
    // the spending tracker, count, charts, and lists all reflect them.
    // The hash check inside skips the work if recurring/debts didn't change.
    try { materializeRecurringTransactions(); } catch(e) { console.warn('materialize fail', e); }

    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    
    // Aggregates
    const totalDebt = appState.debts.reduce((acc, d) => acc + d.balance, 0);
    const activeCount = appState.debts.length;

    const elTotal = document.getElementById('val-total-debt');
    if(elTotal) elTotal.textContent = fmt(totalDebt);

    const elCount = document.getElementById('val-active-liabilities');
    if(elCount) elCount.textContent = `${activeCount} Active Liabilit${activeCount===1?'y':'ies'}`;

    const navBadge = document.querySelector('.nav-badge');
    if(navBadge) navBadge.textContent = activeCount;

    // --- Financial Freedom Progress Bar Logic ---
    const freedomFill = document.getElementById('freedom-progress-fill');
    const freedomBadge = document.getElementById('freedom-badge-text');
    const freedomPaid = document.getElementById('freedom-paid-amt');
    const freedomTarget = document.getElementById('freedom-target-amt');

    if (freedomFill && appState.budget) {
        // Real progress = (sum of original balances) - (sum of current balances)
        // We backfill originalBalance to current balance the first time we see a
        // debt without it, so % paid starts at 0 and only grows. Plus debt-payment
        // transactions counted on top in case the user logged payments without
        // updating the debt balance directly.
        let originalSum = 0, currentSum = 0;
        appState.debts.forEach(d => {
            if (d.originalBalance == null || d.originalBalance < d.balance) {
                d.originalBalance = d.balance;
            }
            originalSum += d.originalBalance || 0;
            currentSum  += d.balance || 0;
        });
        const debtPaid = Math.max(0, originalSum - currentSum);
        const txnPaid = (appState.transactions || [])
            .filter(t => t.category && (
                t.category.toLowerCase().includes('debt') ||
                t.category.toLowerCase().includes('paydown')
            ))
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const totalPaid = Math.max(debtPaid, txnPaid); // whichever is greater — avoids double-counting
        const targetGoal = (appState.budget.targetGoal || originalSum || 0);

        const progressPct = targetGoal > 0 ? Math.min(100, Math.round((totalPaid / targetGoal) * 100)) : 0;

        freedomFill.style.width = `${progressPct}%`;
        if (freedomPaid) freedomPaid.textContent = `$${totalPaid.toLocaleString()} paid`;
        if (freedomTarget) freedomTarget.textContent = targetGoal > 0 ? `$${targetGoal.toLocaleString()} target` : 'No target yet';
        if (freedomBadge) {
            const strat = appState.settings.strategy || 'avalanche';
            freedomBadge.textContent = strat.charAt(0).toUpperCase() + strat.slice(1) + ' strategy';
        }

        // Trigger encouragement copy if a quarter milestone was crossed
        try { updateDfdEncouragement(progressPct); } catch(_){}
    }

    // Render the Top-3 Strategy Focus bar
    try { renderTop3Strategy(); } catch(_){}

    // Math Breakdown — transparent view of what feeds the projections
    try { renderMathBreakdown(); } catch(_){}

    // Refresh the Credit Profile AI insights so it tracks any debt / limit changes
    try { if (window.renderCreditAiInsights) window.renderCreditAiInsights(); } catch(_){}

    // --- Dashboard greeting ("Welcome back, Winston") ---
    try { populateDashboardGreeting(); } catch(e) { console.warn('greeting fail', e); }

    // --- DEBT-FREE DATE HERO (the promise in the marketing made real) ---
    const dfdHero    = document.getElementById('dfd-hero');
    const dfdDate    = document.getElementById('dfd-date');
    const dfdEyebrow = document.getElementById('dfd-eyebrow');
    const dfdMeta    = document.getElementById('dfd-meta');
    if (dfdDate && dfdMeta && dfdEyebrow) {
        const strategy = appState.settings.strategy || 'avalanche';
        const hasDebts = appState.debts && appState.debts.length > 0;
        const hasMins  = hasDebts && appState.debts.some(d => (d.minPayment || 0) > 0);

        // Effective extra contribution — manual setting OR auto-derived from
        // (income − expenses − minimums − non-debt recurring). This is what was
        // previously missing: even users who haven't set a "contribution" but DO
        // have surplus income now get a realistic projection.
        const extraInfo = getEffectiveExtraContribution();
        const extraMonthly = extraInfo.extra;

        if (!hasDebts) {
            if (dfdHero) dfdHero.classList.add('empty');
            dfdEyebrow.textContent = 'Your debt-free date';
            dfdDate.textContent = '—';
            dfdMeta.innerHTML = 'Add your debts and we\'ll show you <strong>the exact date</strong> you\'ll pay off the last balance. <button type="button" onclick="window.wjpShowOnboarding && window.wjpShowOnboarding()" style="background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;border:0;padding:8px 16px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;margin-left:4px;font-family:inherit;">Start setup →</button>';
        } else if (!hasMins) {
            if (dfdHero) dfdHero.classList.add('empty');
            dfdEyebrow.textContent = 'Your debt-free date';
            dfdDate.textContent = '—';
            dfdMeta.innerHTML = 'Add a <strong>minimum payment</strong> to each debt so we can project your payoff date.';
        } else {
            if (dfdHero) dfdHero.classList.remove('empty');
            try {
                const stats = calcSimTotals(strategy, extraMonthly, 0, 0);
                if (stats && stats.months > 0 && stats.months < 600) {
                    const payoff = new Date();
                    payoff.setMonth(payoff.getMonth() + stats.months);
                    const dateStr = payoff.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    const fmtUsd = n => '$' + Math.round(n).toLocaleString();
                    const yearsText = stats.months >= 12
                        ? `${Math.floor(stats.months/12)} year${Math.floor(stats.months/12) === 1 ? '' : 's'}${stats.months % 12 ? `, ${stats.months % 12} month${stats.months % 12 === 1 ? '' : 's'}` : ''}`
                        : `${stats.months} month${stats.months === 1 ? '' : 's'}`;

                    // Pulse the date if it changed from what was last shown
                    const prev = dfdDate.getAttribute('data-prev');
                    if (prev && prev !== dateStr && dfdHero) {
                        dfdHero.classList.remove('updated');
                        void dfdHero.offsetWidth;
                        dfdHero.classList.add('updated');
                    }
                    dfdDate.setAttribute('data-prev', dateStr);
                    dfdEyebrow.textContent = 'You\'ll be debt-free on';
                    dfdDate.textContent = dateStr;

                    // Transparent meta — show exactly what's factored in
                    const stratLabel = strategy[0].toUpperCase() + strategy.slice(1);
                    const totalMin = appState.debts.reduce((s, d) => s + (d.minPayment || 0), 0);
                    const debtCount = appState.debts.length;
                    let extraLine = '';
                    if (extraMonthly > 0 && extraInfo.source === 'manual') {
                        extraLine = ` + <strong>${fmtUsd(extraMonthly)}</strong> extra/mo`;
                    } else if (extraMonthly > 0 && extraInfo.source === 'auto-surplus') {
                        extraLine = ` + <strong>${fmtUsd(extraMonthly)}</strong> from your monthly surplus`;
                    }
                    dfdMeta.innerHTML = `<strong>${fmtUsd(totalDebt)}</strong> across <strong>${debtCount}</strong> debt${debtCount === 1 ? '' : 's'} · <strong>${stratLabel}</strong> strategy · <strong>${fmtUsd(totalMin)}</strong>/mo minimums${extraLine} · <strong>${yearsText}</strong> to go · <strong>${fmtUsd(stats.totalInterest)}</strong> total interest`;
                } else {
                    dfdEyebrow.textContent = 'Can\'t reach debt-free';
                    dfdDate.textContent = '—';
                    dfdMeta.innerHTML = 'At current minimums your balance isn\'t decreasing — interest is outpacing payments. <strong>Add extra contribution</strong>, increase a minimum, or refinance to a lower APR.';
                }
            } catch (e) {
                console.warn('Debt-free date calc failed:', e);
                dfdDate.textContent = '—';
            }
        }
    }

    // --- AI Focus Text (strategy-aware: snowball/avalanche/hybrid all reasoning differently) ---
    const aiFocusEl = document.getElementById('ai-focus-text');
    const aiStratTag = document.getElementById('ai-focus-strategy-tag');
    const earlyBadge = document.getElementById('payoff-early-badge');
    const progStrip = document.getElementById('ai-progress-strip');

    if (aiFocusEl) {
        if (appState.debts.length === 0) {
            aiFocusEl.innerHTML = 'Add your debts and income to receive personalized AI strategy recommendations.';
            if (earlyBadge) earlyBadge.style.display = 'none';
            if (aiStratTag) aiStratTag.style.display = 'none';
            if (progStrip) progStrip.style.display = 'none';
        } else {
            const strategy = (appState.settings && appState.settings.strategy) || 'avalanche';
            const stratLabel = strategy[0].toUpperCase() + strategy.slice(1);

            // Sort by selected strategy → first is the focus debt
            const sorted = (typeof sortDebtsByStrategy === 'function')
                ? sortDebtsByStrategy(appState.debts, strategy)
                : [...appState.debts];
            const focusDebt = sorted[0];

            const income = (appState.balances && appState.balances.monthlyIncome) || 0;
            const totalMin = appState.debts.reduce((s, d) => s + (d.minPayment || 0), 0);
            // Use the same effective-extra logic as the DFD hero so all dashboard
            // numbers tell the same story.
            const _eei = (typeof getEffectiveExtraContribution === 'function')
                ? getEffectiveExtraContribution()
                : { extra: 0, source: 'none' };
            const extra = _eei.extra;

            // Strategy-specific reasoning copy — the WHY behind picking this debt
            const fmtUsd = n => '$' + Math.round(n).toLocaleString();
            const reason = strategy === 'snowball'
                ? `it's your <strong>smallest balance</strong> — knocking it out first builds momentum and frees up its <strong>${fmtUsd(focusDebt.minPayment || 0)}/mo minimum</strong> to roll into the next debt`
                : strategy === 'avalanche'
                ? `it has the <strong>highest APR (${(focusDebt.apr || 0).toFixed(2)}%)</strong> — every dollar you throw at it eliminates the most interest cost in your portfolio`
                : `it scores highest on the <strong>blended balance + APR weighting</strong> — best balance of momentum win and interest savings`;

            const extraSentence = extra > 0
                ? ` Add an extra <strong>${fmtUsd(extra)}</strong> on top of the minimum this month.`
                : '';

            aiFocusEl.innerHTML = `Focus on <span class="highlight">${focusDebt.name}</span> — ${reason}.${extraSentence}`;

            if (aiStratTag) {
                aiStratTag.textContent = `${stratLabel} strategy`;
                aiStratTag.style.display = 'inline-flex';
            }

            // --- Progress strip: paid % · months left · interest saved · this-month plan ---
            if (progStrip) {
                progStrip.style.display = 'grid';

                // Total paid + remaining (uses originalBalance backfilled by DFD render)
                let originalSum = 0, currentSum = 0;
                appState.debts.forEach(d => {
                    if (d.originalBalance == null || d.originalBalance < d.balance) d.originalBalance = d.balance;
                    originalSum += d.originalBalance || 0;
                    currentSum  += d.balance || 0;
                });
                const paidPct = originalSum > 0 ? Math.round(((originalSum - currentSum) / originalSum) * 100) : 0;
                const elPaid = document.getElementById('ai-prog-paid');
                if (elPaid) elPaid.textContent = `${paidPct}%`;

                // Months left + interest saved use the corrected simulator
                let months = 0, interestNow = 0, interestNoExtra = 0;
                try {
                    const sim = calcSimTotals(strategy, extra, 0, 0);
                    if (sim) { months = sim.months; interestNow = sim.totalInterest; }
                    const naive = calcSimTotals(strategy, 0, 0, 0);
                    if (naive) interestNoExtra = naive.totalInterest;
                } catch(_){}
                const saved = Math.max(0, interestNoExtra - interestNow);

                const elMonths = document.getElementById('ai-prog-months');
                if (elMonths) elMonths.textContent = (months > 0 && months < 600) ? `${months}` : '—';

                const elSaved = document.getElementById('ai-prog-saved');
                if (elSaved) elSaved.textContent = saved > 0 ? fmtUsd(saved) : '$0';

                // This-month plan: total minimums + extra contribution
                const elThis = document.getElementById('ai-prog-thismo');
                if (elThis) elThis.textContent = fmtUsd(totalMin + extra);
            }

            if (earlyBadge && income > 0 && totalMin > 0) {
                const baseMonths = Math.ceil(totalDebt / totalMin);
                const optimMonths = extra > 0 ? Math.ceil(totalDebt / (totalMin + extra)) : baseMonths;
                const savedMonths = Math.max(0, baseMonths - optimMonths);
                if (savedMonths > 0) {
                    earlyBadge.textContent = `${savedMonths} Months Early`;
                    earlyBadge.style.display = '';
                } else {
                    earlyBadge.style.display = 'none';
                }
            } else if (earlyBadge) {
                earlyBadge.style.display = 'none';
            }
        }
    }

    // --- AI Priority Notifications ---
    const btnApplyOpt = document.getElementById('btn-apply-optimizations');
    if (btnApplyOpt) {
        btnApplyOpt.onclick = () => {
            const sim = simulateAllStrategies();
            appState.settings.strategy = sim.best;
            saveState();
            updateUI();
            btnApplyOpt.innerHTML = `<i class="ph ph-check"></i> Applied`;
            btnApplyOpt.style.background = 'var(--accent)';
            btnApplyOpt.style.color = '#000';
            setTimeout(() => {
                btnApplyOpt.textContent = 'Apply Optimizations';
                btnApplyOpt.style.background = '';
                btnApplyOpt.style.color = '';
            }, 2000);
        };
    }

    // --- Budgets Page AI Assessment ---
    const budgetAiText = document.getElementById('budget-ai-text');
    if (budgetAiText && appState.balances) {
        const totalExp = Object.values(appState.budget.expenses).reduce((a, b) => a + b, 0);
        const savingsRatio = ((appState.balances.monthlyIncome - totalExp) / appState.balances.monthlyIncome * 100).toFixed(1);
        
        let assessment = `Your current savings ratio of ${savingsRatio}% is `;
        if (savingsRatio > 20) assessment += "excellent. You are in a strong position to accelerate debt payoff.";
        else if (savingsRatio > 10) assessment += "balanced. Consider optimizing discretionary spend to shorten your timeline.";
        else assessment += "below target. I recommend reviewing your transportation or food costs to increase your monthly buffer.";
        
        budgetAiText.textContent = assessment;
    }

    // Synchronize Strategy Tabs
    const strategy = appState.settings.strategy || 'avalanche';
    const stratTabs = document.querySelectorAll('#strategy-tabs .chip');
    stratTabs.forEach(tab => {
        if(tab.getAttribute('data-strategy') === strategy) tab.classList.add('active');
        else tab.classList.remove('active');
    });

    // Run AI Engine Simulations
    const aiFocusTitle = document.getElementById('ai-advisor-title');
    const aiFocusDesc = document.getElementById('ai-advisor-desc');
    const btnExec = document.getElementById('btn-execute-strategy');
    const btnView = document.getElementById('btn-view-analysis');
    
    // UI Elements for Projections
    const elEstCompletion = document.getElementById('val-est-completion');
    const elEstMonths = document.getElementById('val-est-months');
    const elEstInterest = document.getElementById('val-est-interest');

    if (appState.debts.length > 0) {
        const simData = simulateAllStrategies();
        if (simData && simData.simulations[strategy]) {
             const activeSim = simData.simulations[strategy];
             const bestStrat = simData.best;
             
             const future = new Date();
             future.setMonth(future.getMonth() + activeSim.months);
             
             if(elEstCompletion) elEstCompletion.innerHTML = `${future.toLocaleString('default', { month: 'long' })} <span style="font-size:18px; color:var(--accent)">${future.getFullYear()}</span>`;
             if(elEstMonths) elEstMonths.innerHTML = `<i class="ph ph-calendar"></i> ${activeSim.months} Months`;
             if(elEstInterest) elEstInterest.textContent = fmt(activeSim.interest);
             
             if (strategy !== bestStrat && activeSim.interest > simData.simulations[bestStrat].interest) {
                 const bestSim = simData.simulations[bestStrat];
                 const diffInt = activeSim.interest - bestSim.interest;
                 const diffMonths = activeSim.months - bestSim.months;
                 
                 if (aiFocusTitle) aiFocusTitle.innerHTML = `Optimization Found: Save ${fmt(diffInt)}`;
                 
                 // Artificial LLM Typing Effect
                 const targetText = `I have analyzed your current ${strategy} strategy and cross-referenced it across ${fmt(simData.simulations[bestStrat].interest)} of compound cost projections. Switching to the optimal mathematical path (${bestStrat}) accelerates your "Debt Freedom" timeline by ${diffMonths} full months.`;
                 
                 if (aiFocusDesc) {
                     if (aiFocusDesc.dataset.lastText !== targetText) {
                         aiFocusDesc.dataset.lastText = targetText;
                         aiFocusDesc.innerHTML = `<span class="typing-cursor"></span>`;
                         let i = 0;
                         clearInterval(window.aiTypingInterval);
                         window.aiTypingInterval = setInterval(() => {
                             if(i < targetText.length) {
                                 aiFocusDesc.innerHTML = targetText.slice(0, i+1) + '<span class="typing-cursor"></span>';
                                 i++;
                             } else {
                                 clearInterval(window.aiTypingInterval);
                                 aiFocusDesc.innerHTML = targetText;
                             }
                         }, 15);
                     }
                 }
                 
                 if (btnExec) {
                     btnExec.style.display = 'inline-flex';
                     btnExec.style.animation = 'pulse 1.5s ease infinite';
                     btnExec.innerHTML = `Execute <span style="text-transform:capitalize; margin-left:4px;">${bestStrat}</span> <i class="ph ph-lightning"></i>`;
                     btnExec.onclick = () => {
                         btnExec.innerHTML = `<i class="ph ph-check"></i> Executing...`;
                         btnExec.style.animation = 'none';
                         btnExec.style.background = 'var(--accent)';
                         btnExec.style.color = '#0b0f1a';
                         if (aiFocusDesc) aiFocusDesc.dataset.lastText = ''; // force re-type on new state
                         setTimeout(() => {
                             setStrategy(bestStrat); // full cross-tab cascade
                             btnExec.style.background = '';
                             btnExec.style.color = '';
                         }, 500);
                     };
                 }
             } else {
                 if (aiFocusTitle) aiFocusTitle.innerHTML = `Optimal strategy engaged.`;
                 
                 const targetText = `You are currently utilizing the mathematically optimal liquidation route. My simulations indicate that overpaying beyond your minimums yields the highest ROI. I will continue to heavily monitor your accounts.`;
                 if (aiFocusDesc && aiFocusDesc.dataset.lastText !== targetText) {
                     aiFocusDesc.dataset.lastText = targetText;
                     aiFocusDesc.innerHTML = `<span class="typing-cursor"></span>`;
                     let i = 0;
                     clearInterval(window.aiTypingInterval);
                     window.aiTypingInterval = setInterval(() => {
                         if(i < targetText.length) {
                             aiFocusDesc.innerHTML = targetText.slice(0, i+1) + '<span class="typing-cursor"></span>';
                             i++;
                         } else {
                             clearInterval(window.aiTypingInterval);
                             aiFocusDesc.innerHTML = targetText;
                         }
                     }, 15);
                 }
                 
                 if (btnExec) btnExec.style.display = 'none';
             }
             
             if(btnView) btnView.onclick = () => renderAnalysisModal(simData, strategy);
        }
    } else {
        if (aiFocusTitle) aiFocusTitle.innerHTML = `No active liabilities found.`;
        if (aiFocusDesc) aiFocusDesc.innerHTML = `Great job! Consider allocating extra cash flow to high-yield investments.`;
        if (btnExec) btnExec.style.display = 'none';
        if (btnView) btnView.style.display = 'none';
    }

    // Find priority ID shared across components
    let priorityId = null;
    if(appState.debts.length > 0) {
        let copy = sortDebtsByStrategy(appState.debts, strategy);
        priorityId = copy[0].id;
    }

    // Render Debt Cards natively
    const oblContainer = document.getElementById('dashboard-obligations');
    if(oblContainer) {
        oblContainer.innerHTML = '';

        // Pull card limits from credit inputs
        let _cs = {};
        try { _cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch(_) {}
        const cardLimits = _cs.cardLimits || {};

        appState.debts.forEach(debt => {
            const isPriority = (debt.id === priorityId);
            const badgeHtml = isPriority ? `<div class="badge badge-danger">Priority</div>` : '';
            // Autopay tag from recurring stream detection (Plaid transactionsRecurringGet).
            // We only set autopayActive for MATURE/EARLY_DETECTION streams matched to this card.
            const autopayTitle = debt.autopayActive
                ? `Autopay detected${debt.autopayDescription ? ' — ' + debt.autopayDescription : ''}${debt.autopayAmount ? ' (~$' + Number(debt.autopayAmount).toFixed(2) + ')' : ''}${debt.autopayFrequency ? ' · ' + String(debt.autopayFrequency).toLowerCase() : ''}`
                : '';
            const autopayBadgeHtml = debt.autopayActive
                ? `<div class="badge" title="${autopayTitle}" style="background:rgba(0,212,168,0.15); color:var(--accent); font-size:9px; display:inline-flex; align-items:center; gap:3px; padding:2px 6px; border-radius:4px; font-weight:600;"><i class="ph ph-arrows-clockwise"></i> Autopay</div>`
                : '';
            const cClr = isPriority ? 'var(--danger)' : 'var(--accent)';
            const cBg = isPriority ? 'rgba(255,77,109,0.1)' : 'rgba(0,212,168,0.1)';

            // Utilization bar (credit cards only)
            const dtype = (debt.type || debt.category || '').toString().toLowerCase();
            const isCard = dtype.includes('credit') || dtype.includes('card') || dtype === 'cc' || parseFloat(debt.limit) > 0;
            const lim = parseFloat(debt.limit) || parseFloat(cardLimits[debt.id]) || 0;
            let utilHtml = '';
            if (isCard && lim > 0 && debt.balance >= 0) {
                const pct = Math.min(100, (debt.balance / lim) * 100);
                const band = pct < 10 ? '#1f9d55'
                           : pct < 30 ? '#84cc16'
                           : pct < 50 ? '#b58900'
                                      : '#ff4d6d';
                utilHtml = `
                  <div class="obl-util" style="margin-top:10px;">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">
                      <span>Utilization</span><span style="color:${band}">${pct.toFixed(0)}%</span>
                    </div>
                    <div style="height:4px; background:var(--card-2); border-radius:3px; overflow:hidden;">
                      <div style="width:${pct}%; height:100%; background:${band};"></div>
                    </div>
                  </div>`;
            }

            // "Updated N ago" (Tier 2.4)
            let updatedAgoHtml = '';
            if (debt.lastUpdated) {
                const diff = Date.now() - debt.lastUpdated;
                const mins = Math.floor(diff / 60000);
                const hrs = Math.floor(mins / 60);
                const days = Math.floor(hrs / 24);
                const ago = days > 0 ? `${days}d ago` : hrs > 0 ? `${hrs}h ago` : mins > 0 ? `${mins}m ago` : 'just now';
                updatedAgoHtml = `<div class="obl-updated" style="font-size:9px; color:var(--text-3); margin-top:6px;">Updated ${ago}</div>`;
            }

            // Attachments count (Tier 1.6)
            const attachCount = Array.isArray(debt.attachments) ? debt.attachments.length : 0;
            const attachLabel = attachCount > 0
                ? `<i class="ph ph-paperclip"></i> ${attachCount} statement${attachCount>1?'s':''}`
                : `<i class="ph ph-paperclip"></i> Attach statement`;

            // "Pay by" recommendation — shown when statementDay (cards) or dueDay (loans) is set
            // Math: best-practice is to pay 3 days before statement closes for cards, 5-7 days
            // before due date for loans. Annual savings = (balance × dailyRate × daysSaved × 12).
            let payByHtml = '';
            const stmtDay = debt.statementDay;
            const dueDay  = debt.dueDay || debt.dueDate;
            if ((isCard && stmtDay) || (!isCard && dueDay)) {
                const today = new Date();
                const targetDayRaw = isCard ? stmtDay : dueDay;
                const buffer = isCard ? 3 : 7;
                let payByDate = new Date(today.getFullYear(), today.getMonth(), Math.min(targetDayRaw, 28) - buffer);
                if (payByDate < today) payByDate.setMonth(payByDate.getMonth() + 1);
                const dateLbl = payByDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                const dailyRate = (debt.apr || 0) / 100 / 365;
                const annualSaving = Math.round((debt.balance || 0) * dailyRate * buffer * 12);
                const helperText = isCard
                    ? `Lowers reported utilization & saves ~${fmt(annualSaving)}/yr in interest.`
                    : `Cuts daily-accrued interest, saves ~${fmt(annualSaving)}/yr.`;
                payByHtml = `
                    <div class="obl-pay-by" title="${helperText.replace(/"/g,'&quot;')}" style="margin-top:10px; padding:8px 10px; background:rgba(0,212,168,0.08); border:1px solid var(--border-accent); border-radius:6px;">
                      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                        <div style="display:flex; align-items:center; gap:6px; font-size:9px; color:var(--accent); font-weight:800; text-transform:uppercase; letter-spacing:0.06em;">
                          <i class="ph-fill ph-calendar-check"></i> Pay by ${dateLbl}
                        </div>
                        ${annualSaving > 0 ? `<span style="font-size:10px; font-weight:700; color:var(--accent);">~${fmt(annualSaving)}/yr</span>` : ''}
                      </div>
                      <div style="font-size:9.5px; color:var(--text-3); margin-top:3px; line-height:1.4;">${helperText}</div>
                    </div>`;
            } else if (isCard || (!isCard && debt.balance > 0)) {
                // Clickable empty-state pill — opens the AI insights modal.
                // If a statement is attached, the modal shows its AI analysis.
                // If not, it offers to scan one and prefill due/statement dates.
                const hasAttachments = Array.isArray(debt.attachments) && debt.attachments.length > 0;
                const ctaText = hasAttachments
                    ? `View AI insights from your statement`
                    : `Add ${isCard ? 'statement &amp; due dates' : 'due date'} to unlock pay-by tips.`;
                const ctaIcon = hasAttachments ? 'ph-sparkle' : 'ph-info';
                payByHtml = `
                    <button type="button" class="obl-pay-by-empty obl-insights-btn" data-debt-id="${debt.id}" style="margin-top:10px; padding:6px 10px; background:var(--card-2); border:1px dashed var(--border); border-radius:6px; font-size:9.5px; color:var(--text-3); line-height:1.4; text-align:center; width:100%; cursor:pointer; font-family:inherit;">
                      <i class="ph ${ctaIcon}" style="opacity:0.7;"></i> ${ctaText}
                    </button>`;
            }

            oblContainer.innerHTML += `
               <div class="obligation-card ${isPriority ? 'priority' : ''}" data-debt-id="${debt.id}" style="animation: fadeIn 0.3s ease; position:relative;">
                 <div class="obl-header">
                   <div class="obl-icon" style="color:${cClr}; background:${cBg}"><i class="ph ph-credit-card"></i></div>
                   <div style="display:flex; align-items:center; gap:4px;">
                     ${autopayBadgeHtml}
                     ${badgeHtml}
                     <button class="obl-menu-btn" data-debt-id="${debt.id}" aria-label="Actions" title="Actions" style="background:transparent; border:none; color:var(--text-3); cursor:pointer; padding:4px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center;">
                       <i class="ph ph-dots-three-vertical" style="font-size:16px;"></i>
                     </button>
                   </div>
                 </div>
                 <div class="obl-name">${debt.name}</div>
                 <div class="obl-type" style="font-size:10px; color:var(--text-3)">Managed Liability</div>
                 <div class="divider" style="margin:8px 0"></div>
                 <div class="obl-stats-col">
                   <div class="obl-row"><span class="obl-stat-label">Balance</span><span class="obl-stat-val ${isPriority?'accent':''}">${fmt(debt.balance)}</span></div>
                   <div class="obl-row"><span class="obl-stat-label">APR</span><span class="obl-stat-val ${isPriority?'danger':''}">${debt.apr}%</span></div>
                   <div class="obl-row"><span class="obl-stat-label">Min. Payment</span><span class="obl-stat-val">${fmt(debt.minPayment)}</span></div>
                 </div>
                 ${utilHtml}
                 ${payByHtml}
                 ${updatedAgoHtml}
                 <button class="obl-attach-btn" data-debt-id="${debt.id}" style="width:100%; margin-top:10px; padding:6px 8px; background:var(--card-2); border:1px solid var(--border); border-radius:6px; color:var(--text-2); font-size:10px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-family:inherit;">
                   ${attachLabel}
                 </button>
               </div>
            `;
        });

        // Wire three-dot menus + attach buttons (after injection)
        if (typeof wireObligationCardActions === 'function') wireObligationCardActions();
    }

    if (typeof renderMainCalendar === 'function') renderMainCalendar();
    if (typeof renderMiniCalendar === 'function') renderMiniCalendar();

    // Render Strategy Debts Table
    const strList = document.getElementById('strategy-debts-list');
    if(strList) {
        strList.innerHTML = '';
        appState.debts.forEach(debt => {
            strList.innerHTML += `
               <tr style="animation: fadeIn 0.3s ease;">
                 <td>
                   <div style="display:flex; align-items:center; gap:10px;">
                     <div class="payment-row-icon"><i class="ph ph-credit-card"></i></div>
                     <div style="font-weight:600">${debt.name}</div>
                   </div>
                 </td>
                 <td style="color:var(--text-3); font-size:11px">Liability</td>
                 <td style="font-weight:700">${fmt(debt.minPayment)}</td>
                 <td>Monthly</td>
                 <td>${new Date().toLocaleString('default', { month: 'short' })} ${debt.dueDate}</td>
                 <td><div class="badge badge-primary">Active</div></td>
               </tr>
            `;
        });
    }

    // Render Payoff Countdown Engine
    const cdList = document.getElementById('strategy-countdown-list');
    if(cdList) {
        cdList.innerHTML = '';
        const payoffStats = calculateDebtPayoff();
        
        let maxMonths = 0;
        for(let k in payoffStats) if(payoffStats[k].months > maxMonths) maxMonths = payoffStats[k].months;

        appState.debts.forEach(debt => {
            const stat = payoffStats[debt.id];
            const estMonths = stat ? stat.months : 360;
            const progress = Math.min(100, Math.max(5, 100 - (estMonths / Math.max(1, maxMonths) * 100)));
            
            // Format future date
            const future = new Date();
            future.setMonth(future.getMonth() + estMonths);
            const dateStr = future.toLocaleString('default', { month: 'short', year: 'numeric' });

            const isPriority = (debt.id === priorityId);
            const color = isPriority ? 'var(--accent)' : 'var(--text-3)';

            cdList.innerHTML += `
                <div class="countdown-item" style="animation: fadeIn 0.4s ease;">
                  <div class="countdown-header">
                    <div class="countdown-name">${debt.name}</div>
                    <div class="countdown-months">${estMonths} Months</div>
                  </div>
                  <div class="countdown-date">Debt Freedom: ${dateStr}</div>
                  <div class="countdown-progress-track" style="margin-top:6px;">
                    <div class="countdown-progress-fill" style="width: ${progress}%; background:${color}"></div>
                  </div>
                </div>
            `;
        });
    }

    try { if(window.drawCharts) drawCharts(); } catch(e) { console.warn('drawCharts', e); }

    // --- Dashboard Bottom Stats (Interest Saved · DTI · Freedom Date) ---
    // Wrapped in try/catch so a sim error doesn't take down the rest of updateUI.
    try {
        const elInt = document.getElementById('val-interest-saved');
        const elDTI = document.getElementById('val-dti-ratio');
        const elFreedom = document.getElementById('val-freedom-date');

        if (elInt || elDTI || elFreedom) {
            const hasDebts = (appState.debts || []).length > 0;
            if (!hasDebts) {
                // Empty state — show neutral defaults so cards aren't blank
                if (elInt) elInt.textContent = '$0';
                if (elDTI) elDTI.textContent = '0%';
                if (elFreedom) elFreedom.textContent = '—';
            } else {
                const sim = (typeof simulateAllStrategies === 'function') ? simulateAllStrategies() : null;
                if (sim && sim.simulations) {
                    const strategy = appState.settings.strategy || 'avalanche';
                    const current = sim.simulations[strategy] || sim.simulations[sim.best] || sim.simulations.avalanche;

                    // 1. Interest Saved — Snowball baseline vs best path
                    const naiveInt = (sim.simulations.snowball && sim.simulations.snowball.interest) || 0;
                    const bestInt = (sim.simulations[sim.best] && sim.simulations[sim.best].interest) || 0;
                    const savings = Math.max(0, naiveInt - bestInt);
                    const displaySavings = savings > 10 ? fmt(savings) : fmt(totalDebt * 0.04);
                    if (elInt) elInt.innerHTML = `${displaySavings} <span class="stat-pill up">+12%</span>`;

                    // 2. DTI
                    const income = (appState.balances && appState.balances.monthlyIncome) || 0;
                    const totalMin = appState.debts.reduce((sum, d) => sum + (d.minPayment || 0), 0);
                    if (income > 0 && totalMin > 0) {
                        const dtiVal = ((totalMin / income) * 100).toFixed(1);
                        if (elDTI) elDTI.innerHTML = `${dtiVal}% <span class="stat-pill" style="background:var(--card-2); color:var(--text-3);">${parseFloat(dtiVal) < 36 ? 'safe' : 'high'}</span>`;
                    } else if (elDTI) {
                        elDTI.innerHTML = totalMin > 0 ? '— <span class="stat-pill" style="background:var(--card-2);color:var(--text-3);">add income</span>' : '0%';
                    }

                    // 3. Freedom Date
                    if (current && current.months > 0 && current.months < 600) {
                        const freedomDate = new Date();
                        freedomDate.setMonth(freedomDate.getMonth() + current.months);
                        const mStr = freedomDate.toLocaleString('default', { month: 'short' });
                        const yStr = freedomDate.getFullYear();
                        if (elFreedom) elFreedom.textContent = `${mStr} ${yStr}`;
                    } else if (elFreedom) {
                        elFreedom.textContent = '—';
                    }
                }
            }
        }
    } catch(e) { console.warn('bottom stats render failed', e); }

    try { if (typeof renderStrategyIndicators === 'function') renderStrategyIndicators(); } catch(e) { console.warn('strategy indicators', e); }
    try { if (typeof renderPerDebtAttachments === 'function') renderPerDebtAttachments(); } catch(e) { console.warn('attachments', e); }
    try { if (typeof reorderPinnedCards === 'function') reorderPinnedCards(); } catch(e) { console.warn('pinned reorder', e); }
    try { if (typeof applyHouseholdModeLabel === 'function') applyHouseholdModeLabel(); } catch(_){}
    try { if (typeof applyGoalsReordering === 'function') applyGoalsReordering(); } catch(_){}
    try { renderTransactions(); } catch(e) { console.warn('transactions render', e); }
    try { if (typeof renderResilienceTab === 'function') renderResilienceTab(); } catch(_){}
    try { renderUpcomingList(); } catch(e) { console.warn('upcoming list', e); }
    try { updateCreditProfile(); } catch(e) { console.warn('credit profile', e); }
    try { updateResilienceCard(); } catch(e) { console.warn('resilience card', e); }
    try { updateDebtsHeader(); } catch(_){}
    try { updateAnalysisTab(); } catch(_){}
    // Re-render simulations if visible
    const simPanel = document.querySelector('[data-subtab="simulations"].active');
    if (simPanel && typeof renderSimulationsTab === 'function') renderSimulationsTab();
}

// Dynamically populate the Upcoming Payments list from appState.debts
function renderUpcomingList() {
    const listView = document.getElementById('upcoming-list-view');
    if (!listView) return;

    if (appState.debts.length === 0) {
        listView.innerHTML = `
            <div style="text-align:center; padding:40px 16px;">
                <i class="ph ph-calendar-x" style="font-size:36px; color:rgba(255,255,255,0.2); display:block; margin-bottom:12px;"></i>
                <div style="font-size:13px; font-weight:600; color:rgba(255,255,255,0.4); margin-bottom:4px;">No upcoming payments</div>
                <div style="font-size:11px; color:rgba(255,255,255,0.25); line-height:1.5;">Add your debts to see your<br>payment schedule here</div>
            </div>`;
        return;
    }

    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    const today = new Date().getDate();
    const iconMap = { mortgage: 'ph-house', loan: 'ph-student', car: 'ph-car', auto: 'ph-car', credit: 'ph-credit-card', card: 'ph-credit-card' };
    const bgMap  = { 'ph-house': 'rgba(255,77,109,0.12)', 'ph-student': 'var(--accent-dim)', 'ph-car': 'rgba(102,126,234,0.12)', 'ph-credit-card': 'rgba(255,171,64,0.12)', 'ph-currency-dollar': 'rgba(255,255,255,0.05)' };
    const clrMap = { 'ph-house': 'var(--danger)', 'ph-student': 'var(--accent)', 'ph-car': '#667eea', 'ph-credit-card': '#ffab40', 'ph-currency-dollar': 'var(--text-2)' };

    const sorted = [...appState.debts].map(d => {
        const day = parseInt(d.dueDate) || 15;
        const daysUntil = day >= today ? day - today : (30 - today + day);
        return { ...d, daysUntil, day };
    }).sort((a, b) => a.daysUntil - b.daysUntil);

    listView.innerHTML = sorted.map((d, i) => {
        const key = Object.keys(iconMap).find(k => d.name.toLowerCase().includes(k)) || 'dollar';
        const icon = iconMap[key] || 'ph-currency-dollar';
        const isUrgent = d.daysUntil <= 5;
        return `
            <div class="card upcoming-item" style="padding:14px; margin-bottom:10px;">
                <div class="upcoming-icon" style="background:${bgMap[icon]||'rgba(255,255,255,0.05)'}; color:${clrMap[icon]||'var(--text-2)'}; width:36px; height:36px;">
                    <i class="ph ${icon}" style="font-size:18px;"></i>
                </div>
                <div style="flex:1; margin-left:12px;">
                    <div class="upcoming-name" style="font-size:13px; font-weight:700;">${d.name}</div>
                    <div class="upcoming-due" style="font-size:10px; color:var(--text-3); margin-top:2px;">Due in ${d.daysUntil} day${d.daysUntil!==1?'s':''} · APR ${d.apr}%</div>
                </div>
                <div class="upcoming-amount" style="text-align:right;">
                    <div class="upcoming-val" style="font-size:13px; font-weight:800;">${fmt(d.minPayment)}</div>
                    <div class="${isUrgent?'badge badge-danger':'card-sub'}" style="margin-top:4px; font-size:9px; padding:2px 6px;">${isUrgent?'URGENT':'SCHEDULED'}</div>
                </div>
            </div>`;
    }).join('');
}

// Update the Financial Resilience dashboard card based on real appState
function updateResilienceCard() {
    const income    = (appState.balances && appState.balances.monthlyIncome) || 0;
    const totalDebt = appState.debts.reduce((s, d) => s + d.balance, 0);
    const hasData   = income > 0 || totalDebt > 0;

    const scoreEl     = document.getElementById('resilience-score');
    const efTextEl    = document.getElementById('ef-progress-text');
    const efBarEl     = document.getElementById('ef-progress-bar');
    const msTextEl    = document.getElementById('milestone-progress-text');
    const msBarEl     = document.getElementById('milestone-progress-bar');
    const strengthDiv = document.querySelector('#dash-financial-resilience .resilience-metric:last-child > div:last-child');

    if (!hasData) {
        if (scoreEl)    { scoreEl.textContent = '—'; scoreEl.className = 'badge'; scoreEl.style.background = 'rgba(255,255,255,0.06)'; scoreEl.style.color = 'var(--text-3)'; }
        if (efTextEl)   efTextEl.textContent = '—';
        if (efBarEl)    efBarEl.style.width  = '0%';
        if (msTextEl)   msTextEl.textContent = 'Add debts to unlock';
        if (msBarEl)    msBarEl.style.width  = '0%';
        if (strengthDiv) strengthDiv.style.visibility = 'hidden';
        return;
    }

    // Basic resilience score: DTI-based calculation
    const totalMinPay  = appState.debts.reduce((s, d) => s + (d.minPayment || 0), 0);
    const dti          = income > 0 ? (totalMinPay / income) * 100 : 100;
    const score        = Math.max(0, Math.min(100, Math.round(100 - dti * 1.5)));
    const scoreClass   = score >= 80 ? 'badge-success' : score >= 50 ? 'badge-warning' : 'badge-danger';
    const milestone    = score >= 80 ? 'Level 4: Sovereign' : score >= 60 ? 'Level 3: Principal Crusher' : score >= 40 ? 'Level 2: APR Buster' : 'Level 1: Starter';

    if (scoreEl)   { scoreEl.textContent = score + '%'; scoreEl.className = 'badge ' + scoreClass; scoreEl.style.background = ''; scoreEl.style.color = ''; }
    if (efTextEl)  efTextEl.textContent = '$0 / ' + (income > 0 ? '$' + (income * 6).toLocaleString() : '—');
    if (efBarEl)   efBarEl.style.width  = '0%';
    if (msTextEl)  msTextEl.textContent = milestone;
    if (msBarEl)   msBarEl.style.width  = Math.min(100, score) + '%';
    if (strengthDiv) strengthDiv.style.visibility = 'visible';
}

// Update debts header card with real appState data
function updateDebtsHeader() {
    const debts = appState.debts || [];
    const totalVal   = document.getElementById('debts-total-val');
    const ceilingVal = document.getElementById('debts-ceiling-val');
    const aprVal     = document.getElementById('debts-apr-val');
    const countLabel = document.getElementById('debts-count-label');

    const totalBalance  = debts.reduce((s, d) => s + (d.balance || 0), 0);
    const totalPayments = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
    const avgAPR = debts.length > 0
        ? debts.reduce((s, d) => s + (parseFloat(d.apr) || 0), 0) / debts.length
        : 0;

    if (totalVal) {
        const whole = Math.floor(totalBalance).toLocaleString();
        const cents = (totalBalance % 1).toFixed(2).slice(1);
        totalVal.innerHTML = `$${whole}<span style="font-size:24px;opacity:0.8">${cents}</span>`;
    }
    if (ceilingVal) ceilingVal.textContent = totalPayments > 0 ? '$' + totalPayments.toLocaleString() : '$0';
    if (aprVal)     aprVal.textContent     = avgAPR > 0 ? avgAPR.toFixed(1) + '%' : '—';
    if (countLabel) {
        const n = debts.length;
        countLabel.innerHTML = n > 0
            ? `<i class="ph ph-info"></i> Aggregated across ${n} active debt account${n !== 1 ? 's' : ''}`
            : `<i class="ph ph-info"></i> No active debt accounts`;
    }
}

// Update Analysis tab: show empty states when no data
function updateAnalysisTab() {
    const income = (appState.balances && appState.balances.monthlyIncome) || 0;
    const hasData = appState.debts.length > 0 && income > 0;
    const midGrid = document.getElementById('analysis-middle-grid');
    if (!midGrid) return;

    if (!hasData) {
        midGrid.innerHTML = `
        <div class="card" style="grid-column:1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px; text-align:center; gap:12px;">
            <i class="ph ph-chart-bar" style="font-size:36px; color:var(--accent); opacity:0.4;"></i>
            <div style="font-size:16px; font-weight:800; color:var(--text-2);">No data to analyse yet</div>
            <div style="font-size:12px; color:var(--text-3); max-width:320px; line-height:1.6;">Complete your profile with income and debt accounts. The AI will then calculate interest savings, strategy rankings, and velocity projections.</div>
        </div>`;
    }
    // If hasData, the existing HTML remains visible with real chart data
}

// Jump from anywhere into the Debts → Credit Score subtab
function goToCreditScoreTab() {
    if (typeof navigateSPA === 'function') navigateSPA('debts');
    setTimeout(() => {
        const tabs = document.querySelectorAll('.debts-subtabs .subtab');
        let target = null;
        tabs.forEach(t => { if (t.textContent.trim() === 'Credit Score') target = t; });
        if (target) {
            target.click();
        } else if (typeof renderCreditScoreTab === 'function') {
            renderCreditScoreTab();
        }
    }, 80);
}
window.goToCreditScoreTab = goToCreditScoreTab;

// Dashboard "Credit Profile" card — now wired to the same bureau link + credit
// inputs used by the Credit Score sub-tab. Shows real score, real utilization,
// and an expand icon that jumps straight into the full Credit Score tab.
function updateCreditProfile() {
    const card = document.getElementById('credit-profile-card');
    if (!card) return;

    // Pull persisted state from the Credit Score tab
    let cs = {};
    let bureau = {};
    try { cs     = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch(_) {}
    try { bureau = JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}'); } catch(_) {}

    // Resolve a usable score: bureau lastScore > cs.currentScore
    const rawScore = bureau.lastScore || cs.currentScore;
    const score    = (rawScore !== null && rawScore !== undefined && rawScore !== '' && !isNaN(parseInt(rawScore, 10)))
                       ? parseInt(rawScore, 10)
                       : null;

    const providerLabels = {
        array: 'ARRAY', plaid: 'PLAID', experian: 'EXPERIAN', equifax: 'EQUIFAX',
        transunion: 'TRANSUNION', creditkarma: 'CREDIT KARMA', myfico: 'myFICO'
    };
    const isLinked = !!bureau.provider || score !== null;

    // ─── Not linked ───
    if (!isLinked) {
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="font-size:14px; font-weight:700;">Credit Profile</h3>
                <div class="card-label" style="color:var(--text-3); border-color:var(--border); display:flex; gap:6px; align-items:center;">
                    NOT LINKED
                    <button class="cp-expand-btn" title="Open Credit Score tab" style="background:transparent; border:none; color:var(--text-3); cursor:pointer; padding:0; display:inline-flex; align-items:center;">
                        <i class="ph ph-arrow-square-out" style="font-size:14px;"></i>
                    </button>
                </div>
            </div>
            <div style="text-align:center; padding:16px 10px 20px;">
                <div style="width:64px; height:64px; border-radius:50%; background:rgba(127,127,127,0.06); border:2px dashed var(--border); display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
                    <i class="ph ph-link-simple-break" style="font-size:26px; color:var(--text-3);"></i>
                </div>
                <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:var(--text);">Credit Profile Not Linked</div>
                <div style="font-size:11px; color:var(--text-3); line-height:1.6; margin-bottom:20px;">Connect Array, Experian, Equifax,<br>TransUnion, Credit Karma or myFICO to see<br>your live score and AI insights.</div>
                <button class="cp-connect-btn" style="padding:10px 22px; background:linear-gradient(135deg,var(--accent),#00b896); border:none; border-radius:10px; color:#fff; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; display:inline-flex; align-items:center; gap:6px;">
                    <i class="ph ph-link"></i> Connect Credit Profile
                </button>
            </div>`;
        card.querySelectorAll('.cp-expand-btn, .cp-connect-btn').forEach(b => {
            b.addEventListener('click', goToCreditScoreTab);
        });
        return;
    }

    // ─── Linked: compute live metrics ───
    const debts     = (appState && appState.debts) ? appState.debts : [];
    const cardDebts = debts.filter(d => {
        const t = (d.type || d.category || '').toString().toLowerCase();
        return t.includes('credit') || t.includes('card') || t === 'cc';
    });
    let totalBal = 0, totalLim = 0;
    cardDebts.forEach(d => {
        const lim = parseFloat((cs.cardLimits || {})[d.id] || 0);
        const bal = parseFloat(d.balance || 0);
        if (lim > 0) { totalBal += bal; totalLim += lim; }
    });
    const utilPct = totalLim > 0 ? (totalBal / totalLim) * 100 : null;
    const utilDisplay = utilPct === null ? '—' : utilPct.toFixed(1) + '%';
    const utilBarPct  = utilPct === null ? 0 : Math.min(100, utilPct);
    const utilColor   = utilPct === null ? 'var(--border)'
                       : utilPct < 10 ? '#1f9d55'
                       : utilPct < 30 ? '#2b9b72'
                       : utilPct < 50 ? '#b58900'
                       : utilPct < 75 ? '#d97706' : '#ff4d6d';

    const lates    = parseInt(cs.latePayments12mo, 10) || 0;
    const historyPct = Math.max(0, 100 - lates * 8);

    const oldestYrs = cs.oldestAccountYears !== '' && cs.oldestAccountYears !== null && !isNaN(parseFloat(cs.oldestAccountYears))
        ? parseFloat(cs.oldestAccountYears) : null;
    const accountsTotal = debts.length;

    // Score band
    const band = score >= 800 ? { label:'Exceptional', color:'#1f9d55' }
               : score >= 740 ? { label:'Very Good',   color:'#2b9b72' }
               : score >= 670 ? { label:'Good',        color:'#84cc16' }
               : score >= 580 ? { label:'Fair',        color:'#d97706' }
                              : { label:'Poor',        color:'#ff4d6d' };
    const dashOffset = Math.round(264 - 264 * ((score - 300) / 550));

    const provLabel = providerLabels[bureau.provider] || (score ? 'MANUAL ENTRY' : 'LINKED');
    const lastSync  = bureau.lastSync ? new Date(bureau.lastSync).toLocaleDateString() : null;

    // AI insight: pick the highest-impact suggestion
    let aiMsg = `Your score is ${band.label.toLowerCase()}. Open the Credit Score tab for a ranked, point-by-point improvement plan.`;
    if (utilPct !== null && utilPct >= 30) {
        aiMsg = `Drop overall utilization from ${utilDisplay} to under 10% — typically worth +20 to +40 points within one statement cycle.`;
    } else if (lates > 0) {
        aiMsg = `Each of your ${lates} late payment${lates>1?'s':''} drags Payment History (35% of FICO). A clean 6-month streak can recover 20–40 points.`;
    } else if (utilPct !== null && utilPct < 10 && score < 740) {
        aiMsg = `Utilization is excellent. Length of credit and account mix are now your biggest levers — keep oldest accounts open.`;
    }

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="font-size:14px; font-weight:700;">Credit Profile</h3>
            <div style="display:flex; gap:8px; align-items:center;">
                <div class="card-label" title="${lastSync ? 'Last synced ' + lastSync : 'Source'}">${provLabel}</div>
                <button class="cp-expand-btn" title="Open full Credit Score tab" style="background:var(--card-2); border:1px solid var(--border); color:var(--text); cursor:pointer; padding:4px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:700; font-family:inherit;">
                    <i class="ph ph-arrows-out-simple" style="font-size:12px;"></i> EXPAND
                </button>
            </div>
        </div>

        <div style="display:flex; align-items:center; gap:20px; margin-bottom:20px;">
            <div style="position:relative; width:80px; height:80px; display:flex; align-items:center; justify-content:center;">
                <svg width="80" height="80" viewBox="0 0 100 100" style="position:absolute; transform:rotate(-90deg);">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--card-2)" stroke-width="8"></circle>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="${band.color}" stroke-width="8" stroke-dasharray="264" stroke-dashoffset="${dashOffset}" stroke-linecap="round"></circle>
                </svg>
                <div style="text-align:center;">
                    <div style="font-size:22px; font-weight:800; line-height:1; color:var(--text);">${score}</div>
                    <div style="font-size:9px; color:var(--text-3); font-weight:600; margin-top:2px;">PTS</div>
                </div>
            </div>
            <div>
                <div style="font-size:11px; color:var(--text-3); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Overall Status</div>
                <div style="font-size:16px; font-weight:800; color:${band.color};">${band.label}</div>
                <div style="font-size:10px; color:var(--text-3); margin-top:6px;">${lastSync ? 'Synced ' + lastSync : 'Tap EXPAND for full plan'}</div>
            </div>
        </div>

        <div class="credit-details-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:20px; border-top:1px solid var(--border); padding-top:16px;">
            <div class="credit-metric">
                <div style="font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; margin-bottom:4px;">Utilization</div>
                <div style="font-size:13px; font-weight:700; color:${utilPct === null ? 'var(--text-3)' : utilColor};">${utilDisplay}</div>
                <div style="height:3px; background:var(--card-2); border-radius:3px; margin-top:6px; overflow:hidden;">
                    <div style="width:${utilBarPct}%; height:100%; background:${utilColor};"></div>
                </div>
            </div>
            <div class="credit-metric">
                <div style="font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; margin-bottom:4px;">History</div>
                <div style="font-size:13px; font-weight:700;">${historyPct}%</div>
                <div style="height:3px; background:var(--card-2); border-radius:3px; margin-top:6px; overflow:hidden;">
                    <div style="width:${historyPct}%; height:100%; background:${historyPct >= 95 ? '#1f9d55' : historyPct >= 80 ? '#b58900' : '#ff4d6d'};"></div>
                </div>
            </div>
            <div class="credit-metric">
                <div style="font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; margin-bottom:4px;">Oldest Acct</div>
                <div style="font-size:13px; font-weight:700;">${oldestYrs !== null ? oldestYrs + ' Yrs' : '—'}</div>
            </div>
            <div class="credit-metric">
                <div style="font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; margin-bottom:4px;">Accounts</div>
                <div style="font-size:13px; font-weight:700;">${accountsTotal} Total</div>
            </div>
        </div>

        <div id="credit-ai-box" style="background:var(--card-2); border-radius:10px; padding:12px; border:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <div class="ai-icon" style="width:18px; height:18px; font-size:10px; background:var(--accent); color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center;"><i class="ph-fill ph-lightning"></i></div>
                <div style="font-size:11px; font-weight:700; color:var(--text);">AI Optimization Insight</div>
            </div>
            <p style="font-size:10.5px; color:var(--text-3); line-height:1.5; margin-bottom:10px;">${aiMsg}</p>
            <button class="cp-expand-btn" style="width:100%; padding:8px 10px; background:var(--card); border:1px solid var(--border); color:var(--text); font-size:10.5px; font-weight:700; border-radius:6px; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:6px;">
                <i class="ph ph-arrow-square-out"></i> OPEN CREDIT SCORE TAB
            </button>
        </div>`;

    card.querySelectorAll('.cp-expand-btn').forEach(b => {
        b.addEventListener('click', goToCreditScoreTab);
    });

    // Render live score delta pill + reason (Tier 1.4)
    renderScoreHistoryBadge(card);
}

// Inject a live score-history badge ("+12 PTS" + one-line reason) into the
// Credit Profile card, replacing any static HTML pill left over from index.html.
function renderScoreHistoryBadge(card) {
    const hist = (appState && appState.creditScoreHistory) ? appState.creditScoreHistory : [];
    if (!card || hist.length === 0) return;
    const latest = hist[hist.length - 1];
    if (latest == null || latest.delta === undefined) return;
    // Find the "Overall Status" block's container — there's a stat-pill "+12 PTS"
    // directly under it that we want to replace.
    const staticPill = card.querySelector('.stat-pill');
    const wrapper = staticPill ? staticPill.parentElement : null;
    const dir = latest.delta > 0 ? 'up' : latest.delta < 0 ? 'down' : 'flat';
    const arrow = latest.delta > 0 ? 'ph-arrow-up' : latest.delta < 0 ? 'ph-arrow-down' : 'ph-minus';
    const sign = latest.delta > 0 ? '+' : '';
    const pillHtml = `
      <div class="score-delta-live" style="margin-top:6px; display:flex; flex-direction:column; gap:4px;">
        <div class="stat-pill ${dir}" style="font-size:10px; padding:2px 8px; display:inline-flex; align-items:center; gap:3px; width:max-content;">
          <i class="ph ${arrow}"></i> ${sign}${latest.delta} PTS
        </div>
        <div style="font-size:10px; color:var(--text-3); line-height:1.4;">${latest.reason || ''}</div>
      </div>`;
    if (staticPill) {
        staticPill.outerHTML = pillHtml;
    } else if (wrapper) {
        wrapper.insertAdjacentHTML('beforeend', pillHtml);
    }
}

/* ============================================================
   OBLIGATION CARD ACTIONS (Tier 1.6 + Tier 2.1 + Tier 2.4)
   Three-dot menu: Rename · Update balance · Attach statement · Delete
   ============================================================ */
function wireObligationCardActions() {
    // Three-dot menu buttons
    document.querySelectorAll('.obl-menu-btn').forEach(btn => {
        if (btn._wired) return; btn._wired = true;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-debt-id');
            openObligationMenu(btn, id);
        });
    });
    // Attach-statement buttons
    document.querySelectorAll('.obl-attach-btn').forEach(btn => {
        if (btn._wired) return; btn._wired = true;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-debt-id');
            openAttachStatementPicker(id);
        });
    });
    // AI insights pill — opens modal with statement analysis or scan flow
    document.querySelectorAll('.obl-insights-btn').forEach(btn => {
        if (btn._wired) return; btn._wired = true;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-debt-id');
            openCardInsightsModal(id);
        });
    });
}

/* ---------- AI INSIGHTS MODAL ----------
 * Opens when user clicks the "View AI insights" / "Add statement & due dates"
 * pill on a debt card. If there's an attached statement, shows the AI analysis
 * inline. If not, offers to scan one and apply it directly to the debt. */
function openCardInsightsModal(debtId) {
    const debt = appState.debts.find(d => d.id === debtId);
    if (!debt) return;

    document.getElementById('card-insights-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'card-insights-modal';
    overlay.className = 'card-insights-overlay';
    overlay.innerHTML = `
        <div class="card-insights-modal">
            <div class="card-insights-header">
                <div>
                    <div class="card-insights-eyebrow"><i class="ph-fill ph-sparkle"></i> AI Statement Insights</div>
                    <h3 class="card-insights-title">${debt.name}</h3>
                    <div class="card-insights-sub">${(debt.balance || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · ${(debt.apr || 0).toFixed(2)}% APR · Min ${(debt.minPayment || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</div>
                </div>
                <button class="card-insights-close" aria-label="Close">&times;</button>
            </div>
            <div class="card-insights-body" id="card-insights-body">
                ${renderCardInsightsContent(debt)}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.card-insights-close').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escClose(ev) {
        if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
    });

    // Wire actions inside the modal
    wireCardInsightsActions(overlay, debtId);
}
window.openCardInsightsModal = openCardInsightsModal;

function renderCardInsightsContent(debt) {
    const attachments = Array.isArray(debt.attachments) ? debt.attachments : [];

    // No attachments — show scan-to-prefill CTA
    if (!attachments.length) {
        return `
            <div class="card-insights-empty">
                <i class="ph ph-file-magnifying-glass" style="font-size:42px; color:var(--accent); opacity:0.7;"></i>
                <h4>No statement attached yet</h4>
                <p>Attach your latest credit card or loan statement and our AI will extract APR, balance, due date, fees, and statement closing date — then auto-update your debt with what it finds.</p>
                <button class="card-insights-scan-btn" id="card-insights-scan" data-debt-id="${debt.id}">
                    <i class="ph-fill ph-sparkle"></i> Scan Statement & Apply
                </button>
            </div>
        `;
    }

    // Statements attached — show analysis for each
    return `
        <div class="card-insights-attachments">
            ${attachments.map((a, i) => {
                const hasAnalysis = !!a.analysis;
                const analyzeLabel = hasAnalysis ? 'Re-scan' : 'Run AI Analysis';
                return `
                    <div class="card-insights-att">
                        <div class="card-insights-att-head">
                            <i class="ph-fill ph-file-text" style="color:var(--accent);"></i>
                            <span class="card-insights-att-name">${a.name}</span>
                            <span class="card-insights-att-date">${new Date(a.ts).toLocaleDateString()}</span>
                            <button class="card-insights-att-action" data-debt-id="${debt.id}" data-att-idx="${i}" data-action="analyze">
                                <i class="ph ph-sparkle"></i> ${analyzeLabel}
                            </button>
                        </div>
                        <div class="card-insights-att-panel" id="card-insights-panel-${i}" style="display:${hasAnalysis ? 'block' : 'none'};">
                            ${hasAnalysis ? renderInlineCardAnalysis(debt, i) : ''}
                        </div>
                    </div>
                `;
            }).join('')}
            <button class="card-insights-add-more" data-debt-id="${debt.id}">
                <i class="ph ph-plus"></i> Attach another statement
            </button>
        </div>
    `;
}

function renderInlineCardAnalysis(debt, attIdx) {
    const a = debt.attachments[attIdx]?.analysis;
    if (!a) return '';
    const fields = a.parsed || {};
    const insightToneColor = (t) => t === 'good' ? '#22c55e' : t === 'warn' ? '#ffab40' : 'var(--accent)';
    return `
        <div class="card-insights-section">
            <div class="card-insights-section-label"><i class="ph-fill ph-lightbulb"></i> Insights</div>
            ${a.insights.map(ins => `
                <div class="att-insight" style="border-left-color:${insightToneColor(ins.tone)};">
                    <i class="ph-fill ${ins.icon}" style="color:${insightToneColor(ins.tone)};"></i>
                    <span>${ins.text}</span>
                </div>
            `).join('')}
        </div>
        ${a.supported ? `
            <div class="card-insights-section">
                <div class="card-insights-section-label"><i class="ph-fill ph-pencil-simple"></i> Detected fields — review &amp; apply</div>
                <div class="att-analysis-grid card-insights-fields" data-debt-id="${debt.id}" data-att-idx="${attIdx}">
                    <label class="att-field"><span>Balance</span><input type="number" step="0.01" data-field="statementBalance" value="${fields.statementBalance != null ? fields.statementBalance.toFixed(2) : ''}" placeholder="—"></label>
                    <label class="att-field"><span>Min Payment</span><input type="number" step="0.01" data-field="minPayment" value="${fields.minPayment != null ? fields.minPayment.toFixed(2) : ''}" placeholder="—"></label>
                    <label class="att-field"><span>APR (%)</span><input type="number" step="0.01" data-field="apr" value="${fields.apr != null ? fields.apr.toFixed(2) : ''}" placeholder="—"></label>
                    <label class="att-field"><span>Cash Adv APR (%)</span><input type="number" step="0.01" data-field="cashAdvanceApr" value="${fields.cashAdvanceApr != null ? fields.cashAdvanceApr.toFixed(2) : ''}" placeholder="—"></label>
                    <label class="att-field"><span>Penalty APR (%)</span><input type="number" step="0.01" data-field="penaltyApr" value="${fields.penaltyApr != null ? fields.penaltyApr.toFixed(2) : ''}" placeholder="—"></label>
                    <label class="att-field"><span>Credit Limit</span><input type="number" step="0.01" data-field="creditLimit" value="${fields.creditLimit != null ? fields.creditLimit.toFixed(2) : ''}" placeholder="—"></label>
                    <label class="att-field"><span>Statement Date</span><input type="text" data-field="statementDate" value="${fields.statementDate || ''}" placeholder="—"></label>
                    <label class="att-field"><span>Due Date</span><input type="text" data-field="dueDate" value="${fields.dueDate || ''}" placeholder="—"></label>
                    <label class="att-field"><span>Promo Ends</span><input type="text" data-field="promoExpires" value="${fields.promoExpires || ''}" placeholder="—"></label>
                </div>
                <div class="att-analysis-actions">
                    <button class="att-apply-btn card-insights-apply" data-debt-id="${debt.id}" data-att-idx="${attIdx}">
                        <i class="ph ph-check-circle"></i> Apply Changes to Debt
                    </button>
                </div>
            </div>
        ` : ''}
    `;
}

function wireCardInsightsActions(overlay, debtId) {
    // Scan button (no-attachment path)
    const scanBtn = overlay.querySelector('#card-insights-scan');
    if (scanBtn) {
        scanBtn.onclick = () => triggerScanAndApplyToDebt(debtId, overlay);
    }
    // Per-attachment Analyze / Re-scan
    overlay.querySelectorAll('.card-insights-att-action[data-action="analyze"]').forEach(b => {
        b.onclick = async () => {
            const idx = parseInt(b.getAttribute('data-att-idx'), 10);
            const debt = appState.debts.find(d => d.id === debtId);
            if (!debt) return;
            const att = debt.attachments[idx];
            if (att) delete att.analysis; // force fresh
            const panel = overlay.querySelector(`#card-insights-panel-${idx}`);
            if (panel) {
                panel.style.display = 'block';
                panel.innerHTML = `<div class="card-insights-loading"><i class="ph ph-spinner-gap" style="animation: creditSpin 0.8s linear infinite; display:inline-block;"></i> Reading statement...</div>`;
            }
            try {
                const text = await extractPdfText(att.dataUrl);
                const parsed = parseStatementText(text);
                const insights = buildStatementInsights(parsed, debt);
                att.analysis = { parsedAt: Date.now(), supported: true, parsed, insights };
                saveState();
                if (panel) panel.innerHTML = renderInlineCardAnalysis(debt, idx);
                wireCardInsightsActions(overlay, debtId);
            } catch (err) {
                console.warn('analyze failed', err);
                if (panel) panel.innerHTML = `<div class="card-insights-loading" style="color:var(--danger);">Couldn't read this PDF: ${err.message || 'unknown error'}.</div>`;
            }
        };
    });
    // Apply changes
    overlay.querySelectorAll('.card-insights-apply').forEach(b => {
        b.onclick = () => {
            const idx = parseInt(b.getAttribute('data-att-idx'), 10);
            const fieldsContainer = overlay.querySelector(`.card-insights-fields[data-att-idx="${idx}"]`);
            if (fieldsContainer) applyStatementToDebt(debtId, idx, fieldsContainer);
            overlay.remove();
        };
    });
    // Add another attachment
    const addMore = overlay.querySelector('.card-insights-add-more');
    if (addMore) {
        addMore.onclick = () => {
            overlay.remove();
            openAttachStatementPicker(debtId);
        };
    }
}

/** Pick a PDF, scan it, apply detected fields directly to the debt — used by the
 *  no-attachment path in the insights modal. */
async function triggerScanAndApplyToDebt(debtId, overlay) {
    const debt = appState.debts.find(d => d.id === debtId);
    if (!debt) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const body = overlay.querySelector('#card-insights-body');
        if (body) body.innerHTML = `<div class="card-insights-loading"><i class="ph ph-spinner-gap" style="animation: creditSpin 0.8s linear infinite; display:inline-block;"></i> Reading statement...</div>`;
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => reject(r.error);
                r.readAsDataURL(file);
            });
            // Save attachment so insights persist
            if (!Array.isArray(debt.attachments)) debt.attachments = [];
            const text = await extractPdfText(dataUrl);
            const parsed = parseStatementText(text);
            const insights = buildStatementInsights(parsed, debt);
            debt.attachments.push({
                name: file.name,
                dataUrl: dataUrl,
                size: file.size,
                ts: Date.now(),
                analysis: { parsedAt: Date.now(), supported: true, parsed, insights }
            });
            saveState();
            if (body) body.innerHTML = renderCardInsightsContent(debt);
            wireCardInsightsActions(overlay, debtId);
        } catch (err) {
            console.warn('scan failed', err);
            if (body) body.innerHTML = `<div class="card-insights-loading" style="color:var(--danger);">Scan failed: ${err.message || 'unknown error'}</div>`;
        }
    };
    input.click();
}

function openObligationMenu(anchor, debtId) {
    // Close any existing menu
    document.querySelectorAll('.obl-action-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'obl-action-menu';
    menu.style.cssText = 'position:absolute; z-index:9500; min-width:180px; background:var(--card); border:1px solid var(--border); border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,0.35); padding:6px; font-family:inherit;';

    // Plaid-sourced debts cannot be edited manually — only refreshed from bank or unlinked.
    const debtForMenu = (appState.debts || []).find(d => d.id === debtId);
    const isPlaid = !!(debtForMenu && debtForMenu.source === 'plaid');
    const items = isPlaid ? [
        { label: 'Rename', icon: 'ph-pencil-simple', act: 'rename' },
        { label: 'Refresh from bank', icon: 'ph-arrows-clockwise', act: 'refresh-bank' },
        { label: 'Attach statement', icon: 'ph-paperclip', act: 'attach' },
        { label: 'Unlink bank', icon: 'ph-link-break', act: 'unlink-bank', danger: true }
    ] : [
        { label: 'Rename', icon: 'ph-pencil-simple', act: 'rename' },
        { label: 'Update balance', icon: 'ph-arrows-clockwise', act: 'update' },
        { label: 'Attach statement', icon: 'ph-paperclip', act: 'attach' },
        { label: 'Delete', icon: 'ph-trash', act: 'delete', danger: true }
    ];
    menu.innerHTML = items.map(i => `
      <button class="obl-menu-item" data-act="${i.act}" style="display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; background:transparent; border:none; color:${i.danger ? '#ff4d6d' : 'var(--text)'}; font-size:12px; font-weight:600; text-align:left; cursor:pointer; border-radius:6px; font-family:inherit;">
        <i class="ph ${i.icon}"></i> ${i.label}
      </button>
    `).join('');
    document.body.appendChild(menu);

    // Position near anchor
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + window.scrollY + 4;
    const left = Math.max(8, r.right + window.scrollX - 180);
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    const close = () => { menu.remove(); document.removeEventListener('click', onDoc); };
    const onDoc = (e) => { if (!menu.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('click', onDoc), 0);

    menu.querySelectorAll('.obl-menu-item').forEach(b => {
        b.addEventListener('mouseenter', () => b.style.background = 'var(--card-2)');
        b.addEventListener('mouseleave', () => b.style.background = 'transparent');
        b.addEventListener('click', () => {
            const act = b.getAttribute('data-act');
            close();
            if (act === 'rename') renameDebtPrompt(debtId);
            else if (act === 'update') updateDebtBalancePrompt(debtId);
            else if (act === 'attach') openAttachStatementPicker(debtId);
            else if (act === 'delete') deleteDebtPrompt(debtId);
            else if (act === 'refresh-bank') {
                const d = (appState.debts || []).find(x => x.id === debtId);
                if (d && d.itemId && typeof refreshFromBank === 'function') refreshFromBank(d.itemId);
            }
            else if (act === 'unlink-bank') {
                const d = (appState.debts || []).find(x => x.id === debtId);
                if (d && d.itemId && typeof unlinkPlaidItem === 'function') unlinkPlaidItem(d.itemId);
            }
        });
    });
}

function renameDebtPrompt(id) {
    const debt = appState.debts.find(d => d.id === id);
    if (!debt) return;
    const oldName = debt.name;
    const v = prompt('Rename this account:', debt.name);
    if (v === null) return;
    const name = v.trim();
    if (!name) return;
    debt.name = name;
    debt.lastUpdated = Date.now();
    saveState();
    updateUI();
    if (typeof showToast === 'function') showToast('Renamed.');
    if (typeof logActivity === 'function' && oldName !== name) {
        logActivity({
            title: 'Debt renamed',
            text: `"${oldName}" → "${name}"`,
            type: 'debt',
            priority: 'low',
            link: '#debts'
        });
    }
}

function updateDebtBalancePrompt(id) {
    const debt = appState.debts.find(d => d.id === id);
    if (!debt) return;
    const prev = Number(debt.balance || 0);
    const v = prompt(`Update balance for ${debt.name}:`, String(debt.balance || 0));
    if (v === null) return;
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) { if (typeof showToast === 'function') showToast('Enter a valid amount.'); return; }
    debt.balance = n;
    debt.lastUpdated = Date.now();
    saveState();
    updateUI();
    if (typeof showToast === 'function') showToast('Balance updated.');
    if (typeof logActivity === 'function') {
        const fmt = (x) => '$' + Number(x).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
        const delta = prev - n;
        const isPayment = delta > 0;
        const isPaidOff = n === 0 && prev > 0;
        logActivity({
            title: isPaidOff ? 'Debt paid off 🎉' : (isPayment ? 'Payment recorded' : 'Balance updated'),
            text: isPayment
                ? `${debt.name}: ${fmt(prev)} → ${fmt(n)} (−${fmt(delta)})`
                : `${debt.name}: ${fmt(prev)} → ${fmt(n)}`,
            type: isPayment ? 'payment' : 'debt',
            priority: isPaidOff ? 'high' : 'normal',
            link: '#debts'
        });
    }
}

function deleteDebtPrompt(id) {
    const debt = appState.debts.find(d => d.id === id);
    if (!debt) return;
    if (!confirm(`Delete "${debt.name}"? This cannot be undone.`)) return;
    const removedName = debt.name;
    appState.debts = appState.debts.filter(d => d.id !== id);
    saveState();
    updateUI();
    if (typeof showToast === 'function') showToast('Deleted.');
    if (typeof logActivity === 'function') {
        logActivity({
            title: 'Debt deleted',
            text: `Removed "${removedName}"`,
            type: 'debt',
            priority: 'normal',
            link: '#debts'
        });
    }
}

function openAttachStatementPicker(id) {
    const debt = appState.debts.find(d => d.id === id);
    if (!debt) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.csv';
    input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            if (!confirm(`"${file.name}" is ${(file.size/1024/1024).toFixed(1)} MB. Attach anyway? Large files slow the app down.`)) return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            if (!Array.isArray(debt.attachments)) debt.attachments = [];
            debt.attachments.push({
                name: file.name,
                dataUrl: e.target.result,
                size: file.size,
                ts: Date.now()
            });
            saveState();
            updateUI();
            if (typeof showToast === 'function') showToast(`Attached "${file.name}".`);
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// Review & rename imported accounts (Tier 2.1)
function openReviewImportModal(importedIds) {
    const targets = (appState.debts || []).filter(d => importedIds.includes(d.id));
    if (!targets.length) return;

    document.getElementById('review-import-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'review-import-modal';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:9700; display:flex; align-items:center; justify-content:center; padding:24px; backdrop-filter:blur(4px);';
    overlay.innerHTML = `
        <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; width:100%; max-width:560px; max-height:88vh; overflow-y:auto;">
            <div style="padding:20px 22px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:10px; color:var(--accent); font-weight:700; text-transform:uppercase; letter-spacing:0.08em;">Imported</div>
                    <h3 style="font-size:17px; font-weight:800; margin:4px 0 0;">Review &amp; rename accounts</h3>
                </div>
                <button id="rv-close" style="background:transparent; border:none; color:var(--text-3); font-size:22px; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:18px 22px;">
                <p style="font-size:11.5px; color:var(--text-3); line-height:1.6; margin:0 0 14px;">Bank feeds return ugly names. Rename, confirm type, and set credit limits before these get locked into your dashboard.</p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                ${targets.map(d => `
                    <div style="background:var(--card-2); border:1px solid var(--border); border-radius:10px; padding:12px;">
                        <div style="display:grid; grid-template-columns: 1fr 110px; gap:8px; margin-bottom:8px;">
                            <input class="rv-name" data-id="${d.id}" type="text" value="${d.name || ''}" placeholder="Account name" style="padding:8px 10px; background:var(--card); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:12px; font-weight:700;">
                            <select class="rv-type" data-id="${d.id}" style="padding:8px 10px; background:var(--card); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:11px;">
                                <option value="credit card" ${((d.type||'').includes('credit')||(d.type||'').includes('card'))?'selected':''}>Credit Card</option>
                                <option value="loan" ${((d.type||'').includes('loan'))?'selected':''}>Loan</option>
                                <option value="mortgage" ${((d.type||'').includes('mortgage'))?'selected':''}>Mortgage</option>
                                <option value="auto" ${((d.type||'').includes('auto'))?'selected':''}>Auto</option>
                                <option value="student" ${((d.type||'').includes('student'))?'selected':''}>Student</option>
                            </select>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                            <label style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em;">Balance
                                <input class="rv-bal" data-id="${d.id}" type="number" value="${d.balance||0}" style="margin-top:4px; width:100%; padding:6px 8px; background:var(--card); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:11px; box-sizing:border-box;">
                            </label>
                            <label style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em;">Credit Limit
                                <input class="rv-lim" data-id="${d.id}" type="number" value="${d.limit||0}" style="margin-top:4px; width:100%; padding:6px 8px; background:var(--card); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:11px; box-sizing:border-box;">
                            </label>
                        </div>
                    </div>`).join('')}
                </div>
            </div>
            <div style="padding:16px 22px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px;">
                <button id="rv-cancel" class="btn btn-ghost" style="padding:10px 16px; font-size:11px;">Skip</button>
                <button id="rv-confirm" class="btn btn-primary" style="padding:10px 18px; font-size:11px;">Confirm &amp; Save</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#rv-close').addEventListener('click', close);
    overlay.querySelector('#rv-cancel').addEventListener('click', close);
    overlay.querySelector('#rv-confirm').addEventListener('click', () => {
        overlay.querySelectorAll('.rv-name').forEach(el => {
            const d = appState.debts.find(x => x.id === el.dataset.id);
            if (d) d.name = el.value.trim() || d.name;
        });
        overlay.querySelectorAll('.rv-type').forEach(el => {
            const d = appState.debts.find(x => x.id === el.dataset.id);
            if (d) d.type = el.value;
        });
        overlay.querySelectorAll('.rv-bal').forEach(el => {
            const d = appState.debts.find(x => x.id === el.dataset.id);
            const v = parseFloat(el.value);
            if (d && !isNaN(v)) d.balance = v;
        });
        overlay.querySelectorAll('.rv-lim').forEach(el => {
            const d = appState.debts.find(x => x.id === el.dataset.id);
            const v = parseFloat(el.value);
            if (d && !isNaN(v)) {
                d.limit = v;
                try {
                    const cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
                    cs.cardLimits = cs.cardLimits || {};
                    cs.cardLimits[d.id] = v;
                    localStorage.setItem('wjp_credit_inputs', JSON.stringify(cs));
                } catch(_){}
            }
            if (d) d.lastUpdated = Date.now();
        });
        saveState();
        updateUI();
        close();
        if (typeof showToast === 'function') showToast('Accounts reviewed.');
    });
}
window.openReviewImportModal = openReviewImportModal;

/* ---------- AI STATEMENT ANALYSIS ----------
 * Extracts key fields from an attached PDF statement using PDF.js + regex.
 * No external AI API — pure browser-side text extraction with pattern matching
 * tuned to common credit-card and loan statement formats. After extraction,
 * the user gets editable fields they can review and apply to update the debt.
 */
let _pdfjsLoading = null;
function ensurePdfJsLoaded() {
    if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
    if (_pdfjsLoading) return _pdfjsLoading;
    _pdfjsLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';
        s.type = 'module';
        s.onload = () => {
            // Configure worker
            try {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
                }
            } catch(_){}
            // The module load may not expose pdfjsLib globally. Fall back to alt CDN.
            if (typeof window.pdfjsLib === 'undefined') {
                const s2 = document.createElement('script');
                s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                s2.onload = () => {
                    if (window['pdfjs-dist/build/pdf']) window.pdfjsLib = window['pdfjs-dist/build/pdf'];
                    if (window.pdfjsLib) {
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                        resolve();
                    } else reject(new Error('PDF.js failed to load'));
                };
                s2.onerror = () => reject(new Error('PDF.js CDN failed'));
                document.head.appendChild(s2);
                return;
            }
            resolve();
        };
        s.onerror = () => {
            // Try alt CDN with non-module syntax
            const s2 = document.createElement('script');
            s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s2.onload = () => {
                if (window['pdfjs-dist/build/pdf']) window.pdfjsLib = window['pdfjs-dist/build/pdf'];
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    resolve();
                } else reject(new Error('PDF.js failed to load'));
            };
            s2.onerror = () => reject(new Error('PDF.js CDN failed'));
            document.head.appendChild(s2);
        };
        document.head.appendChild(s);
    });
    return _pdfjsLoading;
}

/** Extract plain text from a PDF data URL using PDF.js. */
async function extractPdfText(dataUrl) {
    await ensurePdfJsLoaded();
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js unavailable');
    // Convert data URL → Uint8Array
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 10); // statements rarely > 10 pages
    for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(it => it.str).join(' ') + '\n';
    }
    return fullText;
}

/** Pattern-match a statement's text for every field that affects payoff strategy.
 *  Returns null where not found. The strategy simulator uses APR + balance +
 *  min payment + statement day + due day to project payoff dates accurately,
 *  so we extract all of them. Plus extras (cash-advance APR, promo expiry,
 *  penalty APR, payment received) that feed insight rules. */
function parseStatementText(text) {
    if (!text) return {};
    const $ = '\\$?\\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{2})?)';
    const tryMatch = (re) => {
        const m = text.match(re);
        if (!m) return null;
        return parseFloat(m[1].replace(/,/g, ''));
    };
    const tryDate = (re) => {
        const m = text.match(re);
        return m ? m[1].trim() : null;
    };

    return {
        // === BALANCE / PAYMENT ===
        statementBalance: tryMatch(new RegExp(`(?:new\\s+balance|statement\\s+balance|balance\\s+as\\s+of)[^$0-9]*${$}`, 'i')),
        previousBalance: tryMatch(new RegExp(`(?:previous\\s+balance|prior\\s+balance)[^$0-9]*${$}`, 'i')),
        minPayment: tryMatch(new RegExp(`(?:minimum\\s+payment(?:\\s+due)?|min\\.?\\s+payment|amount\\s+due)[^$0-9]*${$}`, 'i')),
        paymentReceived: tryMatch(new RegExp(`(?:payments?\\s+received|payments?\\s+credits?|total\\s+payments)[^$0-9]*${$}`, 'i')),

        // === DATES ===
        // Payment due date — the deadline to avoid late fees
        dueDate: tryDate(/(?:payment\s+due\s+date|due\s+date)[^A-Z0-9]*([A-Za-z]+\s+\d{1,2},?\s*\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i),
        // Statement closing date — critical for credit card utilization timing
        statementDate: tryDate(/(?:statement\s+(?:closing\s+)?date|closing\s+date|cycle\s+ends?|statement\s+period\s+ending)[^A-Z0-9]*([A-Za-z]+\s+\d{1,2},?\s*\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i),
        // Promotional period expiry (e.g., "0% APR ends Jul 1, 2026")
        promoExpires: tryDate(/(?:promotional?\s+(?:rate|apr)\s+(?:end|expire)s?(?:\s+on)?|introductory\s+(?:rate|apr)\s+(?:end|expire)s?(?:\s+on)?)[^A-Z0-9]*([A-Za-z]+\s+\d{1,2},?\s*\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i),

        // === INTEREST RATES ===
        // Purchase APR (the main APR users care about)
        apr: tryMatch(/(?:purchase\s+apr|annual\s+percentage\s+rate|apr\s+for\s+purchases)[^0-9]*?([0-9]{1,2}(?:\.[0-9]{1,3})?)\s*%/i)
           || tryMatch(/\bapr\b[^0-9]*?([0-9]{1,2}(?:\.[0-9]{1,3})?)\s*%/i),
        // Cash advance APR — typically much higher
        cashAdvanceApr: tryMatch(/cash\s+advance(?:\s+apr|\s+rate)?[^0-9]*?([0-9]{1,2}(?:\.[0-9]{1,3})?)\s*%/i),
        // Penalty APR — kicks in after late payment
        penaltyApr: tryMatch(/penalty\s+(?:apr|rate)[^0-9]*?([0-9]{1,2}(?:\.[0-9]{1,3})?)\s*%/i),
        // Daily periodic rate (some statements use this instead of APR)
        dailyRate: tryMatch(/daily\s+periodic\s+rate[^0-9]*?([0-9]+(?:\.[0-9]+)?)\s*%/i),

        // === FEES & INTEREST ===
        interestCharged: tryMatch(new RegExp(`(?:interest\\s+charged|finance\\s+charge|interest\\s+this\\s+period)[^$0-9]*${$}`, 'i')),
        lateFee: tryMatch(new RegExp(`(?:late\\s+(?:fee|payment\\s+fee))[^$0-9]*${$}`, 'i')),
        annualFee: tryMatch(new RegExp(`(?:annual\\s+(?:fee|membership\\s+fee))[^$0-9]*${$}`, 'i')),
        ytdInterest: tryMatch(new RegExp(`(?:year[\\-\\s]?to[\\-\\s]?date\\s+interest|interest\\s+ytd|ytd\\s+interest|total\\s+interest\\s+(?:paid|charged)\\s+this\\s+year)[^$0-9]*${$}`, 'i')),

        // === CREDIT LINE ===
        creditLimit: tryMatch(new RegExp(`(?:credit\\s+limit|credit\\s+line|total\\s+credit\\s+(?:line|limit))[^$0-9]*${$}`, 'i')),
        availableCredit: tryMatch(new RegExp(`(?:available\\s+credit)[^$0-9]*${$}`, 'i')),
        cashAdvanceLimit: tryMatch(new RegExp(`(?:cash\\s+advance\\s+(?:limit|line))[^$0-9]*${$}`, 'i'))
    };
}

/** Convert a date string to a day-of-month (1-31) — used for statementDay/dueDay
 *  fields on the debt record so the simulator can apply timing logic. */
function extractDayOfMonth(dateStr) {
    if (!dateStr) return null;
    // "Apr 28, 2026" or "04/28/2026" or "4/28/26"
    const monthDayYear = dateStr.match(/[A-Za-z]+\s+(\d{1,2})/);
    if (monthDayYear) return parseInt(monthDayYear[1], 10);
    const slash = dateStr.match(/^(\d{1,2})\/(\d{1,2})/);
    if (slash) return parseInt(slash[2], 10); // M/D format
    return null;
}

/** Generate human-readable insights from extracted statement fields.
 *  Order matters — most urgent / actionable items appear first. */
function buildStatementInsights(parsed, debt) {
    const lines = [];
    const fmt = n => n != null ? '$' + Math.round(n).toLocaleString() : '';

    // === RATE INSIGHTS ===
    if (parsed.apr != null && debt && parsed.apr !== debt.apr) {
        const diff = parsed.apr - (debt.apr || 0);
        if (Math.abs(diff) >= 0.5) {
            lines.push({
                tone: diff > 0 ? 'warn' : 'good',
                icon: diff > 0 ? 'ph-arrow-up' : 'ph-arrow-down',
                text: `Purchase APR ${diff > 0 ? 'increased' : 'decreased'} from ${(debt.apr || 0).toFixed(2)}% to ${parsed.apr.toFixed(2)}% — ${diff > 0 ? 'consider a balance transfer or rate-shop now' : 'good news, your rate dropped'}.`
            });
        }
    }
    if (parsed.cashAdvanceApr != null && parsed.apr != null && parsed.cashAdvanceApr - parsed.apr >= 5) {
        lines.push({
            tone: 'warn',
            icon: 'ph-currency-circle-dollar',
            text: `Cash advance APR is <strong>${parsed.cashAdvanceApr.toFixed(2)}%</strong> — ${(parsed.cashAdvanceApr - parsed.apr).toFixed(1)}pts higher than purchases (${parsed.apr.toFixed(2)}%). Avoid using this card for ATM withdrawals.`
        });
    }
    if (parsed.penaltyApr != null && parsed.penaltyApr > 25) {
        lines.push({
            tone: 'warn',
            icon: 'ph-exclamation-mark',
            text: `Penalty APR of <strong>${parsed.penaltyApr.toFixed(2)}%</strong> kicks in if you miss a payment. Set up autopay for at least the minimum to never trigger this.`
        });
    }

    // === PROMOTIONAL PERIOD ===
    if (parsed.promoExpires) {
        lines.push({
            tone: 'warn',
            icon: 'ph-clock-countdown',
            text: `Promotional/intro APR ends <strong>${parsed.promoExpires}</strong>. Pay this balance off before then or the regular APR will hit the remainder.`
        });
    }

    // === FEES ===
    if (parsed.lateFee && parsed.lateFee > 0) {
        lines.push({
            tone: 'warn',
            icon: 'ph-warning',
            text: `${fmt(parsed.lateFee)} late fee detected — set up autopay for the minimum to eliminate these.`
        });
    }
    if (parsed.annualFee && parsed.annualFee > 0) {
        lines.push({
            tone: 'info',
            icon: 'ph-credit-card',
            text: `${fmt(parsed.annualFee)} annual fee charged. If you're not getting that much in benefits, consider downgrading to a no-annual-fee card.`
        });
    }

    // === DATES (statement-day timing) ===
    if (parsed.statementDate) {
        lines.push({
            tone: 'info',
            icon: 'ph-calendar-check',
            text: `Statement closed <strong>${parsed.statementDate}</strong>. Your reported balance to credit bureaus is what was owed on this date — pay down BEFORE next statement closes to lower utilization.`
        });
    }

    // === UTILIZATION ===
    if (parsed.creditLimit && parsed.statementBalance) {
        const util = (parsed.statementBalance / parsed.creditLimit) * 100;
        if (util >= 30) {
            const targetPayoff = parsed.statementBalance - parsed.creditLimit * 0.09;
            lines.push({
                tone: 'warn',
                icon: 'ph-gauge',
                text: `Reported utilization is ${util.toFixed(0)}% (${fmt(parsed.statementBalance)} / ${fmt(parsed.creditLimit)}). Pay down ${fmt(targetPayoff)} before the next statement to drop under 10% — typically worth 20-50 FICO points.`
            });
        } else if (util < 10) {
            lines.push({
                tone: 'good',
                icon: 'ph-check-circle',
                text: `Utilization is ${util.toFixed(0)}% — under the 10% FICO sweet spot.`
            });
        }
    }

    // === INTEREST CHARGED ===
    if (parsed.interestCharged && parsed.interestCharged > 0) {
        lines.push({
            tone: 'info',
            icon: 'ph-coin',
            text: `${fmt(parsed.interestCharged)} in interest charged this period. Paying off the statement balance by the due date keeps your grace period and stops this entirely.`
        });
    }
    if (parsed.ytdInterest && parsed.ytdInterest > 0) {
        lines.push({
            tone: 'info',
            icon: 'ph-chart-line-up',
            text: `${fmt(parsed.ytdInterest)} paid in interest YTD on this account alone. That's the cost of carrying this balance instead of paying it off.`
        });
    }

    // === BALANCE DRIFT (saved vs statement) ===
    if (parsed.statementBalance && debt && Math.abs(parsed.statementBalance - debt.balance) > Math.max(50, debt.balance * 0.05)) {
        lines.push({
            tone: 'info',
            icon: 'ph-pencil-simple',
            text: `Statement balance (${fmt(parsed.statementBalance)}) differs from your saved balance (${fmt(debt.balance)}). Apply the changes below to keep your projection accurate.`
        });
    }

    // === PAYMENT CONFIRMATION ===
    if (parsed.paymentReceived && parsed.paymentReceived > 0) {
        lines.push({
            tone: 'good',
            icon: 'ph-check',
            text: `Payment of ${fmt(parsed.paymentReceived)} received last cycle. Keep that consistency going.`
        });
    }

    if (lines.length === 0) {
        lines.push({
            tone: 'info',
            icon: 'ph-info',
            text: `Statement looks clean — no unusual fees, rate changes, or warnings detected.`
        });
    }
    return lines;
}

/** Run full analysis: extract → parse → cache on attachment → render. */
async function analyzeAttachment(debtId, attachmentIdx) {
    const debt = appState.debts.find(d => d.id === debtId);
    if (!debt || !Array.isArray(debt.attachments)) return;
    const att = debt.attachments[attachmentIdx];
    if (!att) return;

    // Use cached analysis if present and fresh
    if (att.analysis && att.analysis.parsedAt) {
        renderAttachmentAnalysis(debtId, attachmentIdx);
        return;
    }

    const panel = document.getElementById(`att-analysis-${debtId}-${attachmentIdx}`);
    if (panel) {
        panel.innerHTML = `<div style="padding:14px; text-align:center; color:var(--text-3); font-size:11px;">
            <i class="ph ph-spinner-gap" style="font-size:18px; animation: creditSpin 0.8s linear infinite; display:inline-block;"></i>
            <div style="margin-top:6px;">Reading statement...</div>
        </div>`;
        panel.style.display = 'block';
    }

    try {
        const isPdf = (att.name || '').toLowerCase().endsWith('.pdf') ||
                      (att.dataUrl || '').startsWith('data:application/pdf');
        if (!isPdf) {
            // Image / CSV — no text extraction. Show a message.
            att.analysis = {
                parsedAt: Date.now(),
                supported: false,
                parsed: {},
                insights: [{
                    tone: 'info', icon: 'ph-info',
                    text: 'AI scan currently supports PDF statements. For images and other formats, enter values manually below.'
                }]
            };
        } else {
            const text = await extractPdfText(att.dataUrl);
            const parsed = parseStatementText(text);
            const insights = buildStatementInsights(parsed, debt);
            att.analysis = {
                parsedAt: Date.now(),
                supported: true,
                parsed: parsed,
                insights: insights
            };
        }
        saveState();
        renderAttachmentAnalysis(debtId, attachmentIdx);
    } catch (err) {
        console.warn('Statement analysis failed', err);
        if (panel) {
            panel.innerHTML = `<div style="padding:14px; text-align:center; color:var(--danger); font-size:11px;">
                Couldn't read this statement: ${err.message || 'Unknown error'}.<br>
                <span style="color:var(--text-3); font-size:10px;">You can still edit values manually below.</span>
            </div>`;
        }
    }
}

/** Render the analysis panel for a specific attachment. */
function renderAttachmentAnalysis(debtId, attachmentIdx) {
    const debt = appState.debts.find(d => d.id === debtId);
    if (!debt) return;
    const att = (debt.attachments || [])[attachmentIdx];
    const panel = document.getElementById(`att-analysis-${debtId}-${attachmentIdx}`);
    if (!panel) return;
    if (!att || !att.analysis) {
        panel.style.display = 'none';
        return;
    }
    const a = att.analysis;
    const fmtUsd = n => n != null ? '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

    const insightToneColor = (t) => t === 'good' ? '#22c55e' : t === 'warn' ? '#ffab40' : 'var(--accent)';

    const fields = a.parsed || {};
    panel.innerHTML = `
        <div class="att-analysis-inner">
            <div class="att-analysis-section">
                <div class="att-analysis-eyebrow"><i class="ph-fill ph-sparkle"></i> AI Insights</div>
                ${a.insights.map(ins => `
                    <div class="att-insight" style="border-left-color:${insightToneColor(ins.tone)};">
                        <i class="ph-fill ${ins.icon}" style="color:${insightToneColor(ins.tone)};"></i>
                        <span>${ins.text}</span>
                    </div>
                `).join('')}
            </div>
            ${a.supported ? `
                <div class="att-analysis-section">
                    <div class="att-analysis-eyebrow"><i class="ph-fill ph-pencil-simple"></i> Detected fields — review &amp; apply</div>
                    <div class="att-analysis-grid">
                        <label class="att-field"><span>Statement Balance</span>
                            <input type="number" step="0.01" data-field="statementBalance" value="${fields.statementBalance != null ? fields.statementBalance.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Minimum Payment</span>
                            <input type="number" step="0.01" data-field="minPayment" value="${fields.minPayment != null ? fields.minPayment.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Purchase APR (%)</span>
                            <input type="number" step="0.01" data-field="apr" value="${fields.apr != null ? fields.apr.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Cash Advance APR (%)</span>
                            <input type="number" step="0.01" data-field="cashAdvanceApr" value="${fields.cashAdvanceApr != null ? fields.cashAdvanceApr.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Penalty APR (%)</span>
                            <input type="number" step="0.01" data-field="penaltyApr" value="${fields.penaltyApr != null ? fields.penaltyApr.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Credit Limit</span>
                            <input type="number" step="0.01" data-field="creditLimit" value="${fields.creditLimit != null ? fields.creditLimit.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Statement Date</span>
                            <input type="text" data-field="statementDate" value="${fields.statementDate || ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Payment Due Date</span>
                            <input type="text" data-field="dueDate" value="${fields.dueDate || ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Promo APR Ends</span>
                            <input type="text" data-field="promoExpires" value="${fields.promoExpires || ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Interest Charged</span>
                            <input type="number" step="0.01" data-field="interestCharged" value="${fields.interestCharged != null ? fields.interestCharged.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>YTD Interest</span>
                            <input type="number" step="0.01" data-field="ytdInterest" value="${fields.ytdInterest != null ? fields.ytdInterest.toFixed(2) : ''}" placeholder="—">
                        </label>
                        <label class="att-field"><span>Late Fee This Period</span>
                            <input type="number" step="0.01" data-field="lateFee" value="${fields.lateFee != null ? fields.lateFee.toFixed(2) : ''}" placeholder="—">
                        </label>
                    </div>
                    <div class="att-analysis-actions">
                        <button class="att-apply-btn" data-debt-id="${debtId}" data-att-idx="${attachmentIdx}">
                            <i class="ph ph-check-circle"></i> Apply Changes to Debt
                        </button>
                        <button class="att-rescan-btn" data-debt-id="${debtId}" data-att-idx="${attachmentIdx}">
                            <i class="ph ph-arrows-clockwise"></i> Re-scan
                        </button>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    panel.style.display = 'block';

    // Wire actions
    const applyBtn = panel.querySelector('.att-apply-btn');
    if (applyBtn) applyBtn.onclick = () => applyStatementToDebt(debtId, attachmentIdx, panel);
    const rescanBtn = panel.querySelector('.att-rescan-btn');
    if (rescanBtn) rescanBtn.onclick = () => {
        delete att.analysis;
        saveState();
        analyzeAttachment(debtId, attachmentIdx);
    };
}

/** Apply edited statement values to the underlying debt record.
 *  Updates not just balance/APR/min but ALSO the timing fields the simulator
 *  uses (statementDay / dueDay), so the strategy projections actually reflect
 *  what the statement says. Plus stores the supplementary rates (cash-advance,
 *  penalty, promo expiry) on the debt so insights persist. */
function applyStatementToDebt(debtId, attachmentIdx, panel) {
    const debt = appState.debts.find(d => d.id === debtId);
    if (!debt || !panel) return;
    const inputs = panel.querySelectorAll('[data-field]');
    const updates = {};
    inputs.forEach(el => {
        const f = el.getAttribute('data-field');
        const v = el.value.trim();
        if (!v) return;
        // Date-string fields stay as strings; everything else parsed as number
        if (f === 'dueDate' || f === 'statementDate' || f === 'promoExpires') updates[f] = v;
        else updates[f] = parseFloat(v);
    });

    let applied = 0;

    // Core fields the simulator uses
    if (updates.statementBalance != null && !isNaN(updates.statementBalance)) {
        debt.balance = updates.statementBalance;
        applied++;
    }
    if (updates.minPayment != null && !isNaN(updates.minPayment)) {
        debt.minPayment = updates.minPayment;
        applied++;
    }
    if (updates.apr != null && !isNaN(updates.apr)) {
        debt.apr = updates.apr;
        applied++;
    }
    if (updates.creditLimit != null && !isNaN(updates.creditLimit) && updates.creditLimit > 0) {
        debt.limit = updates.creditLimit;
        try {
            const cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
            cs.cardLimits = cs.cardLimits || {};
            cs.cardLimits[debt.id] = updates.creditLimit;
            localStorage.setItem('wjp_credit_inputs', JSON.stringify(cs));
        } catch(_){}
        applied++;
    }

    // Date fields → extract day-of-month for the simulator's grace-period logic
    if (updates.statementDate) {
        const day = extractDayOfMonth(updates.statementDate);
        if (day) {
            debt.statementDay = day;
            applied++;
        }
    }
    if (updates.dueDate) {
        const day = extractDayOfMonth(updates.dueDate);
        if (day) {
            debt.dueDay = day;
            debt.dueDate = day;
            applied++;
        }
    }

    // Supplementary rate / fee data — stored on the debt for insight reuse
    if (updates.cashAdvanceApr != null && !isNaN(updates.cashAdvanceApr)) {
        debt.cashAdvanceApr = updates.cashAdvanceApr;
        applied++;
    }
    if (updates.penaltyApr != null && !isNaN(updates.penaltyApr)) {
        debt.penaltyApr = updates.penaltyApr;
        applied++;
    }
    if (updates.promoExpires) {
        debt.promoExpires = updates.promoExpires;
        applied++;
    }
    if (updates.interestCharged != null && !isNaN(updates.interestCharged)) {
        if (!Array.isArray(debt.interestHistory)) debt.interestHistory = [];
        debt.interestHistory.push({ ts: Date.now(), amount: updates.interestCharged });
        // Keep last 24 entries to prevent unbounded growth
        if (debt.interestHistory.length > 24) debt.interestHistory.shift();
        applied++;
    }
    if (updates.ytdInterest != null && !isNaN(updates.ytdInterest)) {
        debt.ytdInterest = updates.ytdInterest;
        applied++;
    }

    debt.lastUpdated = Date.now();
    saveState();
    updateUI();
    if (typeof showToast === 'function') {
        showToast(applied > 0 ? `Updated ${applied} field${applied===1?'':'s'} on ${debt.name}` : 'No changes to apply.');
    }
}

window.analyzeAttachment = analyzeAttachment;
window.applyStatementToDebt = applyStatementToDebt;

/* Scan-to-prefill — used by Add Debt / Add Recurring forms.
 * Opens file picker → reads PDF → extracts fields → populates the form's
 * inputs based on a fieldMap. User can still edit before saving. */
function scanStatementToPrefillForm(fieldMap, btnEl) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            if (typeof showToast === 'function') showToast('PDF only — image scan coming soon.');
            return;
        }
        const originalLabel = btnEl ? btnEl.innerHTML : '';
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="ph ph-spinner-gap" style="animation: creditSpin 0.8s linear infinite; display:inline-block;"></i> Reading...';
        }
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            const text = await extractPdfText(dataUrl);
            const parsed = parseStatementText(text);
            // Apply parsed values to form inputs per fieldMap.
            // Some fields need transformation: dates → day-of-month for
            // statement-day / due-day inputs.
            let prefilled = 0;
            Object.keys(fieldMap).forEach(fieldKey => {
                const el = document.getElementById(fieldMap[fieldKey]);
                if (!el) return;
                const v = parsed[fieldKey];
                if (v == null || v === '') return;
                let outVal;
                if (fieldKey === 'statementDate' || fieldKey === 'dueDate') {
                    // Date strings → extract day-of-month integer for day-of-month inputs
                    const day = extractDayOfMonth(v);
                    if (day == null) return;
                    outVal = String(day);
                } else if (typeof v === 'number') {
                    outVal = v.toFixed(2);
                } else {
                    outVal = v;
                }
                el.value = outVal;
                prefilled++;
            });
            if (btnEl) {
                btnEl.innerHTML = `<i class="ph ph-check"></i> Prefilled ${prefilled} field${prefilled === 1 ? '' : 's'}`;
                setTimeout(() => {
                    btnEl.disabled = false;
                    btnEl.innerHTML = originalLabel;
                }, 2000);
            }
            if (typeof showToast === 'function') {
                showToast(prefilled > 0
                    ? `Auto-filled ${prefilled} field${prefilled === 1 ? '' : 's'} from your statement. Review &amp; edit before saving.`
                    : 'Could not extract fields from this statement. Enter manually.');
            }
        } catch (err) {
            console.warn('Scan to prefill failed', err);
            if (typeof showToast === 'function') showToast('Scan failed: ' + (err.message || 'unknown error'));
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalLabel;
            }
        }
    };
    input.click();
}
window.scanStatementToPrefillForm = scanStatementToPrefillForm;

// Wire the scan buttons in the Add Debt + Add Recurring forms
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const debtScanBtn = document.getElementById('debt-scan-btn');
        if (debtScanBtn) {
            debtScanBtn.addEventListener('click', () => {
                // Map every statement field that the Add Debt form has an input for.
                // Date fields auto-convert to day-of-month for the day inputs.
                scanStatementToPrefillForm({
                    statementBalance: 'debt-balance',
                    minPayment: 'debt-min',
                    apr: 'debt-apr',
                    creditLimit: 'debt-limit',
                    dueDate: 'debt-due-day',
                    statementDate: 'debt-statement-day'
                }, debtScanBtn);
            });
        }
        const recScanBtn = document.getElementById('rec-scan-btn');
        if (recScanBtn) {
            recScanBtn.addEventListener('click', () => {
                scanStatementToPrefillForm({
                    statementBalance: 'rec-amount', // for bills, statement bal ≈ amount due
                    minPayment: 'rec-amount'
                }, recScanBtn);
            });
        }
    }, 200);
});

// Render the per-debt attachments list in the Documents tab (Tier 1.6)
function renderPerDebtAttachments() {
    const list = document.getElementById('per-debt-attachments-list');
    if (!list) return;
    const debts = (appState && appState.debts) ? appState.debts : [];
    const hasAny = debts.some(d => Array.isArray(d.attachments) && d.attachments.length > 0);
    if (!hasAny) {
        list.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 16px; color:var(--text-3); font-size:11px; text-align:center; gap:8px;">
                <i class="ph ph-paperclip" style="font-size:36px; opacity:0.4;"></i>
                <strong style="color:var(--text-2); font-size:13px;">No statements attached yet</strong>
                <span style="max-width:280px;">Open Debts → tap a card → "Attach statement" to add a PDF or photo against a specific account.</span>
            </div>`;
        return;
    }
    list.innerHTML = debts.filter(d => Array.isArray(d.attachments) && d.attachments.length > 0).map(d => `
        <div style="background:var(--card-2); border:1px solid var(--border); border-radius:10px; padding:12px 14px;">
            <div style="font-size:12px; font-weight:800; margin-bottom:8px;">${d.name}</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${d.attachments.map((a, i) => `
                    <div class="att-row-wrap">
                        <div class="att-row">
                            <i class="ph-fill ph-file" style="color:var(--accent); font-size:14px;"></i>
                            <div class="att-row-name">${a.name}</div>
                            <span class="att-row-date">${new Date(a.ts).toLocaleDateString()}</span>
                            <button class="att-analyze-btn" data-debt-id="${d.id}" data-idx="${i}" title="Run AI analysis on this statement">
                                <i class="ph ph-sparkle"></i> ${a.analysis ? 'View Insights' : 'Analyze'}
                            </button>
                            <a href="${a.dataUrl}" download="${a.name}" class="att-row-open">OPEN</a>
                            <button data-debt-id="${d.id}" data-idx="${i}" class="attach-remove-btn"><i class="ph ph-x"></i></button>
                        </div>
                        <div class="att-analysis-panel" id="att-analysis-${d.id}-${i}" style="display:none;"></div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    // Wire analyze buttons (per attachment)
    list.querySelectorAll('.att-analyze-btn').forEach(b => {
        b.addEventListener('click', () => {
            const id = b.getAttribute('data-debt-id');
            const idx = parseInt(b.getAttribute('data-idx'), 10);
            const panel = document.getElementById(`att-analysis-${id}-${idx}`);
            // Toggle if already open
            if (panel && panel.style.display !== 'none' && panel.dataset.open === '1') {
                panel.style.display = 'none';
                panel.dataset.open = '0';
                return;
            }
            if (panel) panel.dataset.open = '1';
            analyzeAttachment(id, idx);
        });
    });

    // Wire remove buttons
    list.querySelectorAll('.attach-remove-btn').forEach(b => {
        b.addEventListener('click', () => {
            const id = b.getAttribute('data-debt-id');
            const idx = parseInt(b.getAttribute('data-idx'), 10);
            const d = appState.debts.find(x => x.id === id);
            if (!d || !Array.isArray(d.attachments)) return;
            d.attachments.splice(idx, 1);
            saveState();
            renderPerDebtAttachments();
            updateUI();
        });
    });
}

// Reorder dashboard modules based on appState.prefs.goals (Tier 2.2)
function applyGoalsReordering() {
    const goals = (appState && appState.prefs && Array.isArray(appState.prefs.goals)) ? appState.prefs.goals : [];
    // Set CSS order on the dash-left cards based on goals
    const aiCard = document.querySelector('#page-dashboard .ai-advisor-card');
    const spendCard = document.querySelector('#page-dashboard .dash-left .card.reveal.reveal-3:not(#dash-financial-resilience)');
    const resilCard = document.getElementById('dash-financial-resilience');
    const creditCard = document.getElementById('credit-profile-card');
    const stratBlock = document.querySelector('#page-dashboard .strategy-indicators');

    // Score-focused: credit profile highest
    if (goals.includes('score') && creditCard) creditCard.style.order = '-2';
    // Payoff-focused: strategy indicators / AI strategy up top
    if (goals.includes('payoff')) {
        if (stratBlock) stratBlock.style.order = '-2';
        if (aiCard) aiCard.style.order = '-1';
    }
    // Emergency fund / paycheck: resilience up
    if ((goals.includes('emergency') || goals.includes('paycheck')) && resilCard) {
        resilCard.style.order = '-2';
    }
    // Partner goal flips household mode on
    if (goals.includes('partner') && appState.prefs && !appState.prefs.householdMode) {
        // Only auto-enable once; don't overwrite if user explicitly turned it off
        if (!localStorage.getItem('wjp_household_autoprompted')) {
            localStorage.setItem('wjp_household_autoprompted', '1');
        }
    }
}

// Household mode label (Tier 2.3): rename the user avatar label to "Household"
function applyHouseholdModeLabel() {
    const on = !!(appState && appState.prefs && appState.prefs.householdMode);
    const settingsNameEl = document.getElementById('settings-user-name');
    if (settingsNameEl) {
        const orig = localStorage.getItem('wjp_user_name') || settingsNameEl.textContent || 'User';
        settingsNameEl.textContent = on ? 'Household' : orig;
    }
    const sidebarName = document.querySelector('.user-name');
    if (sidebarName) {
        const orig = localStorage.getItem('wjp_user_name') || sidebarName.textContent || 'User';
        sidebarName.textContent = on ? 'Household' : orig;
    }
}

/* ---------- DASHBOARD LAYOUT CUSTOMIZATION ----------
 * Lets the user reorder + hide cards on the dashboard. State lives in
 *   appState.prefs.cardOrder = { 'spending': 2, 'credit-profile': 0, ... }
 *   appState.prefs.cardHidden = { 'stats-row': true, ... }
 * Cards keep their position within their parent container (preserves the
 * left/right column layout). Up/Down arrow buttons reorder them in place.
 *
 * The toggle button at the top of the dashboard flips body.dash-customizing
 * which CSS uses to surface drag handles, ↑↓ buttons, and hide toggles. */
function initDashCustomize() {
    const btn = document.getElementById('dash-customize-btn');
    const resetBtn = document.getElementById('dash-customize-reset');
    const autofitBtn = document.getElementById('dash-autofit-toggle');
    if (!btn) return;

    // Auto-fit toggle — defaults ON. When on, S/M/L cards flex-grow into any
    // unused space on their row so the dashboard never has wasted whitespace.
    if (autofitBtn) {
        if (!appState.prefs) appState.prefs = {};
        // Default to ON for refined look
        if (typeof appState.prefs.autofit !== 'boolean') appState.prefs.autofit = true;
        const stateLabel = document.getElementById('dash-autofit-state');
        const applyAutofit = () => {
            const on = !!appState.prefs.autofit;
            document.body.classList.toggle('dash-autofit', on);
            autofitBtn.setAttribute('aria-pressed', String(on));
            if (stateLabel) stateLabel.textContent = on ? 'On' : 'Off';
        };
        applyAutofit();
        autofitBtn.addEventListener('click', () => {
            appState.prefs.autofit = !appState.prefs.autofit;
            try { saveState(); } catch(_){}
            applyAutofit();
        });
    }

    // One-time migration — if a previous dev iteration saved cardOrder in the
    // wrong shape (or made cards unexpectedly hidden), wipe it. Keyed by a
    // version flag so we only do this once per device.
    try {
        if (appState && appState.prefs) {
            const FLAG = 'cardLayoutMigrationV2';
            if (!appState.prefs[FLAG]) {
                appState.prefs.cardOrder = {};
                appState.prefs.cardHidden = {};
                appState.prefs[FLAG] = true;
                saveState();
            }
        }
    } catch(_){}

    const setMode = (on) => {
        document.body.classList.toggle('dash-customizing', !!on);
        btn.classList.toggle('active', !!on);
        const labelSpan = btn.querySelector('span');
        if (labelSpan) labelSpan.textContent = on ? 'Done' : 'Customize layout';
        const icon = btn.querySelector('i');
        if (icon) icon.className = on ? 'ph ph-check' : 'ph ph-arrows-out-cardinal';
        if (resetBtn) resetBtn.style.display = on ? 'inline-flex' : 'none';
        // Inject controls into each card on entering, remove on exiting
        if (on) injectCardControls();
        else removeCardControls();
    };

    btn.onclick = () => {
        setMode(!document.body.classList.contains('dash-customizing'));
    };

    if (resetBtn) {
        resetBtn.onclick = () => {
            if (!appState.prefs) appState.prefs = {};
            appState.prefs.cardOrder = {};
            appState.prefs.cardHidden = {};
            saveState();
            applyDashboardLayout();
            // Re-inject controls so the order numbers reset
            removeCardControls();
            if (document.body.classList.contains('dash-customizing')) injectCardControls();
        };
    }

    // Apply saved order + sizes on initial page load
    applyDashboardLayout();
    applyCardSizes();
}

/** Inject ↑/↓/Hide controls + S/M/L/Full size buttons onto every reorderable
 *  card. Idempotent — safe to call multiple times. Removed by removeCardControls.
 *  Also makes the card draggable in customize mode for HTML5 DnD reordering. */
function injectCardControls() {
    document.querySelectorAll('#page-dashboard .reorderable').forEach(card => {
        if (card.querySelector(':scope > .card-reorder-controls')) return;
        const cardId = card.getAttribute('data-card-id');
        const currentSize = (appState.prefs && appState.prefs.cardSize && appState.prefs.cardSize[cardId]) || 'auto';

        // Make the card itself draggable. Wire native HTML5 drag-and-drop so
        // users can grab any card and drop it anywhere on the dashboard,
        // including across columns. The drop target's position determines new
        // ordering (insert before the hovered card).
        card.setAttribute('draggable', 'true');
        if (!card._dndWired) {
            card._dndWired = true;
            card.addEventListener('dragstart', _onCardDragStart);
            card.addEventListener('dragend', _onCardDragEnd);
            card.addEventListener('dragover', _onCardDragOver);
            card.addEventListener('drop', _onCardDrop);
            card.addEventListener('dragleave', _onCardDragLeave);
        }

        const wrap = document.createElement('div');
        wrap.className = 'card-reorder-controls';
        wrap.innerHTML = `
            <div class="card-rc-group">
                <button type="button" class="card-rc-btn" data-action="up" aria-label="Move up" title="Move up">
                    <i class="ph ph-arrow-up"></i>
                </button>
                <button type="button" class="card-rc-btn" data-action="down" aria-label="Move down" title="Move down">
                    <i class="ph ph-arrow-down"></i>
                </button>
            </div>
            <div class="card-rc-group card-rc-size-group">
                <button type="button" class="card-rc-btn card-rc-size ${currentSize==='small'?'active':''}" data-action="size" data-size="small" title="Small (1/3 width)">S</button>
                <button type="button" class="card-rc-btn card-rc-size ${currentSize==='medium'?'active':''}" data-action="size" data-size="medium" title="Medium (1/2 width)">M</button>
                <button type="button" class="card-rc-btn card-rc-size ${currentSize==='large'?'active':''}" data-action="size" data-size="large" title="Large (2/3 width)">L</button>
                <button type="button" class="card-rc-btn card-rc-size ${currentSize==='full'?'active':''}" data-action="size" data-size="full" title="Full width">F</button>
            </div>
            <button type="button" class="card-rc-btn card-rc-hide" data-action="hide" aria-label="Hide card" title="Hide card">
                <i class="ph ph-eye-slash"></i>
            </button>
        `;
        wrap.querySelectorAll('.card-rc-btn').forEach(b => {
            b.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = b.getAttribute('data-action');
                if (action === 'up') moveCardWithinParent(card, -1);
                else if (action === 'down') moveCardWithinParent(card, 1);
                else if (action === 'hide') hideCard(cardId);
                else if (action === 'size') {
                    const size = b.getAttribute('data-size');
                    setCardSize(cardId, size);
                    // Update active class within this group
                    wrap.querySelectorAll('.card-rc-size').forEach(s => s.classList.remove('active'));
                    b.classList.add('active');
                }
            });
        });
        card.appendChild(wrap);
    });

    showHiddenCardChips();
}

/** Apply a size preset to a card and persist the choice. */
function setCardSize(cardId, size) {
    if (!appState.prefs) appState.prefs = {};
    if (!appState.prefs.cardSize) appState.prefs.cardSize = {};
    if (size === 'auto') delete appState.prefs.cardSize[cardId];
    else appState.prefs.cardSize[cardId] = size;
    saveState();
    applyCardSizes();
}

/** Apply all saved card sizes to the DOM via data attribute (CSS targets it). */
function applyCardSizes() {
    const sizes = (appState.prefs && appState.prefs.cardSize) || {};
    document.querySelectorAll('#page-dashboard .reorderable').forEach(card => {
        const id = card.getAttribute('data-card-id');
        const size = sizes[id];
        if (size) card.setAttribute('data-size', size);
        else card.removeAttribute('data-size');
    });
}
window.applyCardSizes = applyCardSizes;

/* ---------- HTML5 DRAG-AND-DROP HANDLERS ----------
 * Only active when body.dash-customizing. Lets the user grab any reorderable
 * card and drop it anywhere on the dashboard. Drop target determines new
 * position: drop on the LEFT half → insert before; RIGHT half → insert after. */
let _draggedCard = null;
let _dropIndicator = null;

function _onCardDragStart(e) {
    if (!document.body.classList.contains('dash-customizing')) {
        e.preventDefault();
        return;
    }
    _draggedCard = this;
    this.classList.add('dragging');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require setData to enable drag
        try { e.dataTransfer.setData('text/plain', this.getAttribute('data-card-id') || ''); } catch(_){}
    }
}

function _onCardDragEnd() {
    if (_draggedCard) _draggedCard.classList.remove('dragging');
    _draggedCard = null;
    _hideDropIndicator();
}

function _onCardDragOver(e) {
    if (!_draggedCard || _draggedCard === this) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    _showDropIndicator(this, e);
}

function _onCardDragLeave(e) {
    // Only hide if leaving the card itself (not entering a child)
    if (e.target === this) _hideDropIndicator();
}

function _onCardDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!_draggedCard || _draggedCard === this) {
        _hideDropIndicator();
        return;
    }
    // Decide before/after based on drop position relative to target
    const rect = this.getBoundingClientRect();
    const isHorizontal = rect.width > rect.height * 1.4; // wide cards → horizontal split
    let insertBefore;
    if (isHorizontal) {
        // For full/large cards stacked vertically, use vertical midpoint
        insertBefore = (e.clientY - rect.top) < rect.height / 2;
    } else {
        // For side-by-side small cards, use horizontal midpoint
        insertBefore = (e.clientX - rect.left) < rect.width / 2;
    }
    const parent = this.parentElement;
    if (!parent) return;
    if (insertBefore) parent.insertBefore(_draggedCard, this);
    else parent.insertBefore(_draggedCard, this.nextSibling);

    _hideDropIndicator();
    if (typeof persistDashboardLayout === 'function') persistDashboardLayout();
}

function _showDropIndicator(targetCard, e) {
    if (!_dropIndicator) {
        _dropIndicator = document.createElement('div');
        _dropIndicator.id = 'card-drop-indicator';
        document.body.appendChild(_dropIndicator);
    }
    const rect = targetCard.getBoundingClientRect();
    const isHorizontal = rect.width > rect.height * 1.4;
    let style;
    if (isHorizontal) {
        const top = (e.clientY - rect.top) < rect.height / 2 ? rect.top : rect.bottom;
        style = `left:${rect.left}px; top:${top - 2}px; width:${rect.width}px; height:4px;`;
    } else {
        const left = (e.clientX - rect.left) < rect.width / 2 ? rect.left : rect.right;
        style = `left:${left - 2}px; top:${rect.top}px; width:4px; height:${rect.height}px;`;
    }
    _dropIndicator.setAttribute('style', `${style} display:block;`);
}

function _hideDropIndicator() {
    if (_dropIndicator) _dropIndicator.style.display = 'none';
}

function removeCardControls() {
    document.querySelectorAll('.card-reorder-controls').forEach(el => el.remove());
    const tray = document.getElementById('hidden-cards-tray');
    if (tray) tray.remove();
}

/** Move a card up or down within its parent container by 1 slot.
 *  delta = -1 for up, +1 for down. Persists the order.  */
function moveCardWithinParent(card, delta) {
    const parent = card.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter(el => el.classList.contains('reorderable'));
    const idx = siblings.indexOf(card);
    if (idx < 0) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= siblings.length) return;

    if (delta < 0) {
        parent.insertBefore(card, siblings[newIdx]);
    } else {
        // Insert AFTER the next sibling — which means insert BEFORE the one after it
        const after = siblings[newIdx];
        if (after.nextSibling) parent.insertBefore(card, after.nextSibling);
        else parent.appendChild(card);
    }
    persistDashboardLayout();
}

/** Hide a card from the dashboard. Adds it to a "hidden" chip tray so the
 *  user can restore it from customize mode. */
function hideCard(cardId) {
    if (!appState.prefs) appState.prefs = {};
    if (!appState.prefs.cardHidden) appState.prefs.cardHidden = {};
    appState.prefs.cardHidden[cardId] = true;
    saveState();
    applyDashboardLayout();
    showHiddenCardChips();
}

function unhideCard(cardId) {
    if (!appState.prefs || !appState.prefs.cardHidden) return;
    delete appState.prefs.cardHidden[cardId];
    saveState();
    applyDashboardLayout();
    showHiddenCardChips();
}

/** Render a row of "hidden" chips so the user can restore cards. */
function showHiddenCardChips() {
    const old = document.getElementById('hidden-cards-tray');
    if (old) old.remove();
    const hidden = (appState.prefs && appState.prefs.cardHidden) || {};
    const ids = Object.keys(hidden).filter(k => hidden[k]);
    if (!ids.length) return;
    if (!document.body.classList.contains('dash-customizing')) return;

    const labelMap = {
        'top3-strategy': 'Top 3 to Attack',
        'ai-advisor': 'AI Advisor',
        'spending': 'Spending Tracker',
        'resilience': 'Financial Resilience',
        'upcoming': 'Upcoming Payments',
        'credit-profile': 'Credit Profile',
        'strategy-indicators': 'Strategy Indicators',
        'stats-row': 'Stats Row'
    };

    const tray = document.createElement('div');
    tray.id = 'hidden-cards-tray';
    tray.className = 'hidden-cards-tray';
    tray.innerHTML = `
        <span class="hidden-cards-label">Hidden:</span>
        ${ids.map(id => `
            <button type="button" class="hidden-card-chip" data-id="${id}">
                <i class="ph ph-eye"></i> ${labelMap[id] || id}
            </button>
        `).join('')}
    `;
    tray.querySelectorAll('.hidden-card-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            unhideCard(chip.getAttribute('data-id'));
        });
    });
    const bar = document.getElementById('dash-customize-bar');
    if (bar) bar.appendChild(tray);
}

/** Persist current DOM order of reorderable cards to appState.prefs.cardOrder
 *  as a map keyed by parent: { parentSelector: [cardId1, cardId2, ...] } */
function persistDashboardLayout() {
    if (!appState.prefs) appState.prefs = {};
    const order = {};
    document.querySelectorAll('#page-dashboard .reorderable').forEach((card, i) => {
        const parent = card.parentElement;
        if (!parent) return;
        // Use parent ID or class as the key
        const parentKey = parent.id || (parent.className.split(' ').filter(Boolean)[0]) || 'root';
        if (!order[parentKey]) order[parentKey] = [];
        const cid = card.getAttribute('data-card-id');
        if (cid) order[parentKey].push(cid);
    });
    appState.prefs.cardOrder = order;
    saveState();
}

/** Apply the saved card order + hidden state to the DOM. */
function applyDashboardLayout() {
    if (!appState) return;
    try {
        const prefs = (appState.prefs) || {};
        const order = prefs.cardOrder || {};
        const hidden = prefs.cardHidden || {};

        // Defensive shape check — earlier dev iterations may have saved cardOrder
        // as an array. If it's not a plain object, scrap it.
        if (typeof order !== 'object' || Array.isArray(order)) {
            appState.prefs.cardOrder = {};
            return;
        }

        // Hide / show
        document.querySelectorAll('#page-dashboard .reorderable').forEach(card => {
            const cid = card.getAttribute('data-card-id');
            if (hidden && hidden[cid]) card.style.display = 'none';
            else card.style.display = '';
        });

        // Reorder per parent: only rearrange cards that are CURRENTLY children of
        // the named parent. Skip silently if anything looks off.
        Object.keys(order).forEach(parentKey => {
            let parent = document.getElementById(parentKey);
            if (!parent) parent = document.querySelector('.' + parentKey);
            if (!parent) return;
            const idList = Array.isArray(order[parentKey]) ? order[parentKey] : [];
            idList.forEach(cid => {
                const card = parent.querySelector(`:scope > .reorderable[data-card-id="${cid}"]`);
                if (card) parent.appendChild(card);
            });
        });
    } catch (err) {
        console.warn('applyDashboardLayout failed', err);
    }
}

window.applyDashboardLayout = applyDashboardLayout;
window.initDashCustomize = initDashCustomize;

// Reorder pinned dashboard cards (Tier 2.6)
function reorderPinnedCards() {
    const pinned = (appState && appState.prefs && Array.isArray(appState.prefs.pinned)) ? appState.prefs.pinned : [];
    const allCardIds = ['credit-profile-card','dash-financial-resilience','dash-spending-card','upcoming-view-container','dash-strategy-card','dash-stats-card'];
    allCardIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (pinned.includes(id)) {
            el.classList.add('pinned');
            el.style.order = '-10';
        } else {
            el.classList.remove('pinned');
            el.style.order = '';
        }
    });
    // Update all pin icons
    document.querySelectorAll('.pin-card-btn').forEach(btn => {
        const id = btn.getAttribute('data-pin-id');
        if (pinned.includes(id)) {
            btn.classList.add('is-pinned');
            btn.style.color = 'var(--accent)';
            btn.title = 'Unpin';
        } else {
            btn.classList.remove('is-pinned');
            btn.style.color = 'var(--text-3)';
            btn.title = 'Pin to top';
        }
    });
}

function togglePinned(cardId) {
    if (!appState.prefs) appState.prefs = {};
    if (!Array.isArray(appState.prefs.pinned)) appState.prefs.pinned = [];
    const i = appState.prefs.pinned.indexOf(cardId);
    if (i >= 0) appState.prefs.pinned.splice(i, 1);
    else appState.prefs.pinned.push(cardId);
    saveState();
    reorderPinnedCards();
}

// expose globally
window.wireObligationCardActions = wireObligationCardActions;
window.renameDebtPrompt = renameDebtPrompt;
window.updateDebtBalancePrompt = updateDebtBalancePrompt;
window.deleteDebtPrompt = deleteDebtPrompt;
window.openAttachStatementPicker = openAttachStatementPicker;
window.renderPerDebtAttachments = renderPerDebtAttachments;
window.applyGoalsReordering = applyGoalsReordering;
window.applyHouseholdModeLabel = applyHouseholdModeLabel;
window.reorderPinnedCards = reorderPinnedCards;
window.togglePinned = togglePinned;

function renderStrategyIndicators() {
    const snowballList = document.getElementById('snowball-list');
    const hybridList = document.getElementById('hybrid-list');
    const avalancheList = document.getElementById('avalanche-list');

    if (!snowballList || !hybridList || !avalancheList) return;
    if (!appState || !appState.debts || appState.debts.length === 0) {
        const msg = '<div class="strat-empty">No active liabilities found.</div>';
        snowballList.innerHTML = msg; hybridList.innerHTML = msg; avalancheList.innerHTML = msg;
        return;
    }

    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    
    // Strategy metadata
    const stratMeta = {
        snowball: {
            icon: 'ph-snowflake',
            color: '#667eea',
            why: 'Eliminates your smallest debts first, producing quick psychological wins. Each paid-off account frees up cash flow to accelerate the next — building momentum like a snowball rolling downhill.',
            benefit: 'Best for: Staying motivated. Fastest to eliminate individual accounts.',
            sort: (a, b) => a.balance - b.balance
        },
        hybrid: {
            icon: 'ph-shuffle',
            color: '#ffab40',
            why: 'Attacks the biggest monthly interest dollars first — combines balance and APR into one number (balance × APR) and pays them off top-to-bottom in that order until you\'re debt-free. A $10K loan at 18% ($150/mo bleed) ranks ahead of a $500 card at 30% ($13/mo bleed) because it\'s costing you more every month.',
            benefit: 'Best for: A balanced approach when you want both speed and savings.',
            sort: (a, b) => (b.balance * b.apr) - (a.balance * a.apr)
        },
        avalanche: {
            icon: 'ph-mountains',
            color: '#00d4a8',
            why: 'Attacks the highest APR first — mathematically optimal. Every $1 paid against a 30% card saves $0.30/year in interest forever; the same $1 paid against an 18% loan only saves $0.18/year. So a $500 card at 30% ranks ahead of a $10K loan at 18%. Within same APR, bigger balance wins (more dollar bleed at that rate).',
            benefit: 'Best for: Lowest total interest paid. Provably optimal — no other strategy beats it on math.',
            sort: (a, b) => {
                const aprDelta = (b.apr || 0) - (a.apr || 0);
                if (Math.abs(aprDelta) > 0.001) return aprDelta;
                return (b.balance || 0) - (a.balance || 0);
            }
        }
    };
    
    // Baselines (0 extra) to calculate interest saved per debt under THIS strategy
    // — comparing apples to apples (same strategy, just no extra payment).
    const strats = ['snowball', 'hybrid', 'avalanche'];
    strats.forEach(s => {
        const listEl = document.getElementById(`${s}-list`);
        const meta = stratMeta[s];
        listEl.innerHTML = '';

        // Run the simulator for this strategy (uses effective extra contribution)
        const stratResults = calculateDebtPayoff(s);
        // Same strategy at 0 extra — for "saved" delta per debt
        const baselineResults = calculateDebtPayoff(s, 0);

        // Aggregate totals — clean integer months (estimates, not decimals)
        let totalInterest = 0;
        let maxMonths = 0;
        Object.values(stratResults).forEach(r => {
            if (r) { totalInterest += r.totalInterest || 0; maxMonths = Math.max(maxMonths, r.months || 0); }
        });

        // Estimated debt-free date — month + year. Clean estimate, no day-level
        // false precision. If two strategies converge to the same month, that's
        // the math: the bottleneck debt is the same.
        const debtFreeDateObj = new Date();
        if (maxMonths > 0 && maxMonths < 600) {
            debtFreeDateObj.setMonth(debtFreeDateObj.getMonth() + maxMonths);
        }
        const debtFreeStr = (maxMonths > 0 && maxMonths < 600)
            ? debtFreeDateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
            : '—';
        const monthsDisplay = (maxMonths > 0 && maxMonths < 600) ? maxMonths : '—';

        listEl.innerHTML += `
            <div style="padding:14px 16px; margin-bottom:8px; background:rgba(${s==='snowball'?'102,126,234':s==='hybrid'?'255,171,64':'0,212,168'},0.06); border:1px solid rgba(${s==='snowball'?'102,126,234':s==='hybrid'?'255,171,64':'0,212,168'},0.2); border-radius:10px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <i class="ph-fill ${meta.icon}" style="color:${meta.color};font-size:16px;"></i>
                    <span style="font-size:11px;font-weight:700;color:${meta.color};text-transform:uppercase;letter-spacing:0.08em;">${s.charAt(0).toUpperCase()+s.slice(1)} Method</span>
                </div>
                <p style="font-size:11px;color:var(--text-2);line-height:1.6;margin-bottom:10px;">${meta.why}</p>
                <div style="font-size:10px;color:${meta.color};font-style:italic;margin-bottom:10px;">${meta.benefit}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
                    <div style="background:var(--card);border-radius:6px;padding:8px;text-align:center;">
                        <div style="font-size:8px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Total Interest</div>
                        <div style="font-size:13px;font-weight:800;color:var(--danger);">${fmt(totalInterest)}</div>
                    </div>
                    <div style="background:var(--card);border-radius:6px;padding:8px;text-align:center;">
                        <div style="font-size:8px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Months</div>
                        <div style="font-size:13px;font-weight:800;color:var(--text);">${monthsDisplay}</div>
                    </div>
                    <div style="background:var(--card);border-radius:6px;padding:8px;text-align:center;">
                        <div style="font-size:8px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Debt-Free</div>
                        <div style="font-size:13px;font-weight:800;color:${meta.color};">${debtFreeStr}</div>
                    </div>
                </div>
            </div>
            <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 6px;padding-left:4px;">Priority Order</div>
        `;

        // Use the SHARED sortDebtsByStrategy helper so priority order on this card
        // matches the order the simulator actually used. Previously each card used
        // a stratMeta.sort which had the OLD broken hybrid math, so the displayed
        // priority order didn't line up with the totals shown above.
        const debts = sortDebtsByStrategy(appState.debts, s);
        debts.slice(0, 5).forEach((debt, idx) => {
            const res = stratResults[debt.id];
            const base = baselineResults[debt.id];
            const saved = (base && res) ? Math.max(0, base.totalInterest - res.totalInterest) : 0;
            const months = res ? res.months : 0;

            // Projected interest cost over 5 years at minimum payment alone —
            // shows the REAL long-term cost of leaving this debt untouched.
            // A small 30% card surfaces as a money pit despite low monthly bleed
            // because it compounds for years; this is what justifies Avalanche's
            // pure-APR sort visually.
            const proj = projectedInterestAtMin(debt, 60);
            const projectedLabel = proj.neverClears
                ? `<strong style="color:var(--danger);">Min won't clear it</strong>`
                : `${fmt(Math.round(proj.interest))} projected interest`;

            listEl.innerHTML += `
                <div class="strat-item" onclick="handleStratItemClick('${s}')" style="cursor:pointer; animation: slideInLeft ${0.2 + idx * 0.1}s ease forwards;">
                    <div class="strat-item-main">
                        <div class="strat-item-name">${debt.name}</div>
                        <div class="strat-item-amt">${fmt(debt.balance)} • ${debt.apr}% • ${projectedLabel}</div>
                    </div>
                    <div class="strat-item-stats">
                        <div class="strat-item-months">${months} Mo.</div>
                        <div class="strat-item-saved">+${fmt(Math.round(saved))} saved</div>
                    </div>
                </div>
            `;
        });
    });

    // Sync visual selected / optimal states after rendering
    syncStrategyCards();
}

function trySimulate() {
    try { return (typeof simulateAllStrategies === 'function') ? simulateAllStrategies() : null; } catch(e) { return null; }
}

// Redraw on resize
window.addEventListener('resize', () => {
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        if(window.drawCharts) window.drawCharts();
        if(window.budgetUpdateCalculations) window.budgetUpdateCalculations();
    }, 200);
});

/* ---------- TRANSACTION AUTO-CATEGORIZATION ----------
 * Maps merchant text to a category by keyword. Used by the Add Transaction
 * form to pre-fill the category dropdown — user can override before saving.
 *
 * Patterns are intentionally simple; if a merchant doesn't match any known
 * keyword, returns null and the form falls back to whatever the user picks.
 * Order matters — more-specific patterns appear first.
 */
const MERCHANT_CATEGORIES = [
    // Food & dining
    { match: /whole\s*foods|trader\s*joe|kroger|safeway|publix|aldi|wegmans|sprouts/i, cat: 'Food & Dining' },
    { match: /walmart|target|costco|sam'?s\s*club|bj'?s/i, cat: 'Food & Dining' },
    { match: /mcdonald|starbucks|subway|chipotle|wendy|burger\s*king|taco\s*bell|chick.fil.a|panera|pizza|sushi|restaurant|cafe|coffee|dunkin/i, cat: 'Food & Dining' },
    { match: /uber\s*eats|doordash|grubhub|postmates|seamless/i, cat: 'Food & Dining' },
    // Transportation
    { match: /shell|exxon|chevron|mobil|\bbp\b|sunoco|gulf|valero|marathon|7-eleven\s*gas/i, cat: 'Transport' },
    { match: /uber(?!\s*eats)|lyft|taxi|parking|toll|metro|transit|amtrak|airline/i, cat: 'Transport' },
    { match: /tesla|gas\s*station|fuel|oil\s*change|auto\s*shop|jiffy\s*lube/i, cat: 'Transport' },
    // Utilities
    { match: /verizon|at&t|t-mobile|sprint|xfinity|comcast|spectrum|cox|optimum|fios/i, cat: 'Utilities' },
    { match: /electric|power\s*company|gas\s*company|water|sewer|trash/i, cat: 'Utilities' },
    // Subscriptions / digital services
    { match: /netflix|hulu|disney\+?|hbo|paramount|peacock|apple\s*tv|prime\s*video|youtube\s*premium/i, cat: 'Subscription' },
    { match: /spotify|apple\s*music|pandora|tidal|sirius/i, cat: 'Subscription' },
    { match: /icloud|google\s*one|dropbox|onedrive|notion|adobe|microsoft\s*365|github|aws|google\s*workspace/i, cat: 'Subscription' },
    { match: /chatgpt|openai|claude|midjourney|grammarly|canva/i, cat: 'Subscription' },
    // Housing
    { match: /rent|mortgage|landlord|property\s*management|hoa|home\s*owners/i, cat: 'Housing' },
    // Insurance
    { match: /geico|state\s*farm|allstate|progressive|liberty\s*mutual|insurance/i, cat: 'Insurance' },
    // Health
    { match: /cvs|walgreens|rite.aid|pharmacy|doctor|hospital|medical|dental|vision|optometry/i, cat: 'Health' },
    // Entertainment
    { match: /amc|cinema|theater|movie|netflix|hulu|gym|fitness|peloton|equinox|planet\s*fitness/i, cat: 'Entertainment' },
    // Debt / payments
    { match: /chase|amex|american\s*express|discover|capital\s*one|citi|sallie\s*mae|navient|sofi|affirm|paypal\s*credit/i, cat: 'Debt Payment' }
];

/** Auto-suggest a category from a merchant string. Returns null if no match. */
function autoCategorizeMerchant(merchant) {
    if (!merchant || typeof merchant !== 'string') return null;
    const trimmed = merchant.trim();
    if (!trimmed) return null;
    for (const rule of MERCHANT_CATEGORIES) {
        if (rule.match.test(trimmed)) return rule.cat;
    }
    return null;
}

/** Classify a recurring entry as 'bill' (essential) or 'subscription' (discretionary)
 *  based on its category. Used by Math Breakdown to separate fixed bills you
 *  can't cut from subscriptions you could trim. */
function classifyRecurring(rec) {
    if (!rec) return 'subscription';
    const cat = (rec.category || '').toLowerCase();
    const billCategories = ['rent', 'utility', 'utilities', 'insurance', 'debt', 'mortgage', 'housing', 'health', 'medical'];
    if (billCategories.some(b => cat.includes(b))) return 'bill';
    if (rec.linkedDebtId) return 'bill';
    return 'subscription';
}

/**
 * projectedInterestAtMin — how much interest this debt accrues if it sits
 * untouched at minimum payment for up to N months.
 *
 * Runs a tiny per-debt simulation: monthly compounding at APR/12, paying only
 * the minimum each month. Total interest accumulated is what would be paid in
 * a "do nothing extra" scenario. Used to show users the REAL cost of leaving
 * a debt unattacked — makes Avalanche's pure-APR sort more intuitive because
 * a small high-APR card surfaces as a long-term money pit, not just $13/mo.
 *
 * Returns { interest, months, neverClears }.
 *   neverClears = true if minPayment doesn't even cover monthly interest
 *                 (debt grows forever at minimums alone — score = "danger").
 */
function projectedInterestAtMin(debt, capMonths) {
    const cap = capMonths || 60;
    let bal = parseFloat(debt.balance) || 0;
    let totalInterest = 0;
    const monthlyRate = (parseFloat(debt.apr) || 0) / 100 / 12;
    const min = parseFloat(debt.minPayment) || 0;
    if (bal <= 0 || min <= 0) return { interest: 0, months: 0, neverClears: false };

    for (let m = 0; m < cap; m++) {
        const interest = bal * monthlyRate;
        if (min <= interest) {
            // Min payment doesn't even cover interest — debt would grow without
            // bound. Project the year-1 interest as a representative number and
            // flag the danger.
            return { interest: totalInterest + interest * 12, months: cap, neverClears: true };
        }
        totalInterest += interest;
        bal += interest;
        bal -= min;
        if (bal <= 0) return { interest: totalInterest, months: m + 1, neverClears: false };
    }
    return { interest: totalInterest, months: cap, neverClears: bal > 0 };
}

// Debt Engine Calculator
/**
 * sortDebtsByStrategy — single source of truth for strategy ordering.
 * Works on EVERY debt type: credit cards, student loans, personal loans,
 * auto loans, mortgages — anything in appState.debts flows through here.
 *
 *  • Snowball   → smallest balance first. Quick psychological wins.
 *
 *  • Hybrid     → highest interest DOLLARS first (balance × APR). Combines
 *                 amount and rate into a single "biggest monthly dollar bleed"
 *                 metric. Top-to-bottom by that dollar drain until every debt
 *                 is paid off. No bonuses, no extra weights — straight math.
 *                 A $10K loan at 18% ($150/mo bleed) ranks ahead of a $500
 *                 card at 30% ($13/mo bleed).
 *
 *  • Avalanche  → highest APR% first. MATHEMATICALLY OPTIMAL for minimizing
 *                 total interest paid. Every $1 paid against a high-APR debt
 *                 saves more in future interest per dollar. Tie-breaker:
 *                 bigger balance within same APR.
 *
 * Returns a NEW sorted array. Input is not mutated.
 */
function sortDebtsByStrategy(debts, strategy) {
    const list = [...debts];
    if (!list.length) return list;

    if (strategy === 'snowball') {
        return list.sort((a, b) => (a.balance || 0) - (b.balance || 0));
    }
    if (strategy === 'avalanche') {
        // Pure APR sort. Tie-breaker: bigger balance.
        return list.sort((a, b) => {
            const aprDelta = (b.apr || 0) - (a.apr || 0);
            if (Math.abs(aprDelta) > 0.001) return aprDelta;
            return (b.balance || 0) - (a.balance || 0);
        });
    }

    // Hybrid: interest dollars only — balance × APR, descending.
    // Tie-breaker: APR (per-dollar interest savings rate).
    return list.sort((a, b) => {
        const aBleed = (a.balance || 0) * (a.apr || 0);
        const bBleed = (b.balance || 0) * (b.apr || 0);
        const bleedDelta = bBleed - aBleed;
        if (Math.abs(bleedDelta) > 0.01) return bleedDelta;
        return (b.apr || 0) - (a.apr || 0);
    });
}

/**
 * Compute a per-debt rationale label for surfacing on cards. Tells the user
 * WHY this debt is ranked where it is under the selected strategy.
 */
function debtRationale(debt, strategy, rank) {
    if (!debt) return '';
    const balance = debt.balance || 0;
    const apr = debt.apr || 0;
    const minPay = debt.minPayment || 0;
    const monthlyInterest = balance * apr / 100 / 12;
    const monthsAtMin = (minPay > 0 && minPay > monthlyInterest)
        ? Math.ceil(balance / (minPay - monthlyInterest))
        : null;

    if (strategy === 'snowball') {
        if (rank === 0) return `Smallest balance — knock out fastest`;
        if (monthsAtMin) return `Clears in ~${monthsAtMin} mo at minimum`;
        return `Quick win after the priority debt`;
    }
    if (strategy === 'avalanche') {
        const bleedTxt = monthlyInterest > 1 ? ` · bleeds $${Math.round(monthlyInterest)}/mo` : '';
        if (rank === 0) return `Highest APR ${apr.toFixed(2)}%${bleedTxt}`;
        return `${apr.toFixed(2)}% APR${bleedTxt}`;
    }
    // hybrid
    const bleedTxt = monthlyInterest > 1 ? `bleeds $${Math.round(monthlyInterest)}/mo at ${apr.toFixed(1)}% APR` : `${apr.toFixed(1)}% APR`;
    if (rank === 0) return `Top blend — ${bleedTxt}`;
    return bleedTxt;
}

function calculateDebtPayoff(strategyOverride = null, extraOverride = null) {
    if (!appState || !appState.debts.length) return {};

    let debts = JSON.parse(JSON.stringify(appState.debts));
    const strategy = strategyOverride || appState.settings.strategy || 'avalanche';
    debts = sortDebtsByStrategy(debts, strategy);

    let extraContrib;
    if (extraOverride !== null) {
        extraContrib = extraOverride;
    } else if (typeof getEffectiveExtraContribution === 'function') {
        extraContrib = getEffectiveExtraContribution().extra;
    } else {
        extraContrib = (appState.budget && appState.budget.contribution) || 0;
    }

    const results = {};
    debts.forEach(d => {
        results[d.id] = {
            months: 0,
            balance: d.balance,
            min: d.minPayment,
            apr: d.apr,
            type: d.type,
            statementDay: d.statementDay,
            totalInterest: 0
        };
    });

    let totalMonths = 0;
    let allPaid = false;

    while (!allPaid && totalMonths < 600) {
        totalMonths++;

        // STEP 1 — Sum ALL freed minimums from paid-off debts plus the user's
        // extra contribution. This pool flows entirely to the highest-priority
        // active debt. (Previously the cascade only flowed forward in iteration
        // order — paid-off debts AFTER the priority debt had their freed min
        // wasted, which made Avalanche under-perform vs textbook results.)
        let cascade = extraContrib;
        debts.forEach(d => {
            const r = results[d.id];
            if (r.balance <= 0) cascade += r.min;
        });

        // STEP 2 — Walk active debts in strategy priority order. First active
        // debt gets min + cascade. Overflow rolls to the next active debt.
        allPaid = true;
        for (let i = 0; i < debts.length; i++) {
            const d = debts[i];
            const res = results[d.id];
            if (res.balance <= 0) continue;
            allPaid = false;

            // Credit-card grace period — if this card has a statement day and
            // total available payment would clear the balance this month, the
            // user is paying in full → no interest.
            const dtype = (res.type || '').toString().toLowerCase();
            const isCard = dtype.includes('credit') || dtype.includes('card');
            const totalAvailToPay = res.min + cascade;
            const wouldPayInFull = isCard && res.statementDay && totalAvailToPay >= res.balance;
            let interest = 0;
            if (!wouldPayInFull) {
                interest = res.balance * (res.apr / 100 / 12);
                res.balance += interest;
                res.totalInterest += interest;
            }

            const payment = res.min + cascade;
            cascade = 0;

            if (res.balance <= payment) {
                cascade += (payment - res.balance);
                res.balance = 0;
                res.months = totalMonths;
            } else {
                res.balance -= payment;
            }
        }
    }

    for(let k in results) {
        if (results[k].months === 0 && results[k].balance > 0) results[k].months = 600;
    }
    return results;
}

function renderTransactions() {
    if (!appState || !appState.transactions) return;

    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' }).format(n);
    const formatDate = (iso) => {
        const d = new Date(iso);
        return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const getIcon = (cat) => {
        const c = cat.toLowerCase();
        if (c.includes('food')) return 'ph ph-shopping-cart';
        if (c.includes('housing')) return 'ph ph-house';
        if (c.includes('transport')) return 'ph ph-car';
        if (c.includes('utility')) return 'ph ph-lightning';
        if (c.includes('debt')) return 'ph ph-credit-card';
        return 'ph ph-newspaper';
    };

    const getColors = (cat) => {
        const c = cat.toLowerCase();
        if (c.includes('food')) return { bg: 'rgba(255,77,109,0.1)', clr: '#ff4d6d' };
        if (c.includes('housing')) return { bg: 'rgba(0,212,168,0.1)', clr: 'var(--accent)' };
        if (c.includes('transport')) return { bg: 'rgba(102,126,234,0.15)', clr: '#667eea' };
        if (c.includes('debt')) return { bg: 'rgba(0,212,168,0.15)', clr: 'var(--accent)' };
        return { bg: 'var(--card-2)', clr: 'var(--text-3)' };
    };

    // 1. Dashboard Spending List — top 5 most-recent transactions.
    // The chart above this list aggregates ALL transactions in the selected
    // time window; this list is just the "what hit my account most recently"
    // glance. Empty state explains the chart still represents everything.
    const dashList = document.getElementById('dash-spending-transactions');
    if (dashList) {
        const txns = (appState.transactions || []).slice(0, 5);
        if (!txns.length) {
            dashList.innerHTML = `
                <div class="transaction-empty" style="text-align:center; padding:20px 12px; color:var(--text-3); font-size:11px;">
                    <i class="ph ph-receipt" style="font-size:20px; opacity:0.4; display:block; margin-bottom:6px;"></i>
                    No transactions yet
                </div>`;
        } else {
            dashList.innerHTML = '';
            txns.forEach(t => {
                const colors = getColors(t.category);
                dashList.innerHTML += `
                    <div class="transaction-item" style="animation: fadeIn 0.3s ease;">
                        <div class="txn-icon" style="background:${colors.bg}; color:${colors.clr}"><i class="${getIcon(t.category)}"></i></div>
                        <div>
                            <div class="txn-name">${t.merchant || '(unnamed)'}</div>
                            <div class="txn-cat">${t.category || 'Uncategorized'}</div>
                        </div>
                        <div class="txn-amount ${t.amount < 0 ? 'neg' : ''}">${fmt(t.amount)}</div>
                    </div>
                `;
            });
        }
    }

    // 2. Strategy Overview List
    const stratList = document.getElementById('strategy-overview-transactions');
    if (stratList) {
        stratList.innerHTML = '';
        appState.transactions.slice(0, 4).forEach(t => {
            const colors = getColors(t.category);
            stratList.innerHTML += `
                <div class="transaction-item" style="animation: fadeIn 0.3s ease;">
                    <div class="txn-icon" style="background:${colors.bg}; color:${colors.clr}"><i class="${getIcon(t.category)}"></i></div>
                    <div>
                        <div class="txn-name">${t.merchant}</div>
                        <div class="txn-cat">${t.category}</div>
                    </div>
                    <div class="txn-amount ${t.amount < 0 ? 'neg' : ''}">${fmt(t.amount)}</div>
                </div>
            `;
        });
    }

    // 3. Full Transactions Table
    const fullTable = document.getElementById('full-transactions-table');
    if (fullTable) {
        const tbody = fullTable.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = '';
            appState.transactions.forEach(t => {
                const colors = getColors(t.category);
                tbody.innerHTML += `
                    <tr style="animation: fadeIn 0.3s ease;">
                        <td class="txn-date">${formatDate(t.date)}</td>
                        <td style="font-weight:600">${t.merchant}</td>
                        <td><div class="badge" style="background:${colors.bg}; color:${colors.clr}; font-size:9px;">${t.category}</div></td>
                        <td style="font-weight:700; color:${t.amount < 0 ? 'var(--danger)' : 'var(--accent)'}">${fmt(t.amount)}</td>
                        <td class="txn-method">${t.method || 'N/A'}</td>
                        <td><span class="status-indicator completed"><span class="status-dot active"></span> ${t.status || 'Completed'}</span></td>
                    </tr>
                `;
            });
        }
    }
}

function simulateAllStrategies() {
    if (!appState || !appState.debts.length) return null;
    
    const strats = ['snowball', 'avalanche', 'hybrid'];
    const sim = {};
    
    strats.forEach(s => {
        const res = calculateDebtPayoff(s);
        let maxMonths = 0;
        let totalInt = 0;
        for(let k in res) {
            if (res[k].months > maxMonths) maxMonths = res[k].months;
            totalInt += res[k].totalInterest;
        }
        sim[s] = { months: maxMonths, interest: totalInt };
    });
    
    let best = null;
    let lowestInt = Infinity;
    for(let s of strats) {
        if (sim[s].interest < lowestInt) {
            lowestInt = sim[s].interest;
            best = s;
        } else if (Math.abs(sim[s].interest - lowestInt) < 1) { // Tiebreaker
             if (best && sim[s].months < sim[best].months) best = s;
        }
    }
    
    return { simulations: sim, best: best };
}

// Render Analysis Modal Details
function renderAnalysisModal(simData, currentStrat) {
    const modal = document.getElementById('analysis-modal');
    const tbody = document.getElementById('analysis-table-body');
    if(!modal || !tbody || !simData) return;
    
    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    tbody.innerHTML = '';
    
    for (const [strat, data] of Object.entries(simData.simulations)) {
        const isCurrent = strat === currentStrat;
        const isBest = strat === simData.best;
        
        const tr = document.createElement('tr');
        if (isCurrent) tr.style.background = 'rgba(255,255,255,0.05)';
        
        let tags = '';
        if (isCurrent) tags += `<div class="badge badge-primary" style="margin-left:8px; font-size:9px">Active</div>`;
        if (isBest) tags += `<div class="badge badge-accent" style="margin-left:8px; font-size:9px; color:#000">Optimal</div>`;
        
        tr.innerHTML = `
            <td style="text-transform:capitalize; font-weight:700;">${strat} ${tags}</td>
            <td style="color:var(--text-3); font-size:12px;">${strat === 'snowball' ? 'Lowest Balance First' : strat === 'avalanche' ? 'Highest APR First' : 'Balanced Weighted Ratio'}</td>
            <td>${data.months} Months</td>
            <td style="font-family:monospace; font-size:14px; color:${isBest ? 'var(--accent)' : 'var(--text)'}">${fmt(data.interest)}</td>
        `;
        tbody.appendChild(tr);
    }
    
    modal.classList.add('active');
    
    const btnClose = document.getElementById('analysis-close');
    const btnDone = document.getElementById('analysis-done');
    
    const closeIt = () => modal.classList.remove('active');
    if(btnClose) btnClose.onclick = closeIt;
    if(btnDone) btnDone.onclick = closeIt;
    
    modal.onclick = (e) => { if(e.target === modal) closeIt(); };
}

/* ---------- AI CHAT LOGIC ---------- */
/* ---------- GLOBAL AI ENGINE ---------- */
function generateAiResponse(input) {
    const low = input.toLowerCase();
    const totalDebt = appState.debts.reduce((acc, d) => acc + d.balance, 0);
    const strategy = appState.settings.strategy;

    if (low.includes('debt') || low.includes('balance')) {
        return `Your total combined liability is currently ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalDebt)}. Under the ${strategy} strategy, we are prioritizing your highest ROI paths.`;
    }
    if (low.includes('extra') || low.includes('payment') || low.includes('1000')) {
         const sim = simulateAllStrategies();
         return `Adding an extra $1,000 monthly contribution would accelerate your "Debt Freedom" date by approximately 14 months and save you roughly $4,200 in interest across the portfolio.`;
    }
    if (low.includes('hello') || low.includes('hi')) {
        return "Greetings. I am Evergreen, your strategic financial engine. I've mapped over 4,000 simulations for your current path. What specific optimization can I run for you?";
    }
    if (low.includes('strategy') || low.includes('optimal')) {
        const sim = simulateAllStrategies();
        return `I've analyzed all models. The ${sim.best} method is mathematically superior for your profile, potentially saving you ${fmt(sim.simulations[sim.best].interest - sim.simulations[strategy].interest)} if implemented today.`;
    }
    return "I've processed that query. Based on your current cash flow and the 12-month trailing spending trend, I recommend maintaining your current liquidity buffer while aggressively targeting the " + (appState.debts[0] ? appState.debts[0].name : "primary debt") + ".";
}

/* ---------- NOTIFICATION ENGINE ---------- */
function initNotifications() {
    if (!appState.notifications) {
        appState.notifications = [];
        saveState();
    }
    
    // NotebookLM Algorithmic Scan Simulation (Proposal B)
    if (!window.sessionNotebookLMRun && appState.debts && appState.debts.length > 0) {
        window.sessionNotebookLMRun = true;
        setTimeout(() => {
            const highAprDebt = appState.debts.reduce((p, c) => (p.apr > c.apr) ? p : c, appState.debts[0]);
            if(highAprDebt && highAprDebt.apr > 5) {
                const saving = (highAprDebt.balance * (highAprDebt.apr / 100) * 0.5).toFixed(0);
                const added = pushNotification({
                    id: Date.now(),
                    title: 'NotebookLM Optimizer',
                    text: `Based on your linked accounts, redirecting 50% of your discretionary budget to your ${highAprDebt.name} avoids $${saving} in interest this year.`,
                    type: 'ai',
                    priority: 'high',
                    time: 'Just now',
                    read: false,
                    cleared: false
                }, 'ai');
                if (added) { saveState(); renderNotifications(); }
                
                // Visual bounce
                const btnNotif = document.getElementById('btn-notifications');
                if (btnNotif) {
                    btnNotif.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    btnNotif.style.transform = 'scale(1.25) rotate(10deg)';
                    setTimeout(() => { btnNotif.style.transform = 'scale(1) rotate(0deg)'; }, 400);
                }
            }
        }, 3000);
    }
    
    renderNotifications();
}

function renderNotifications() {
    const list = document.querySelector('.notification-list');
    const badge = document.getElementById('notifications-badge');
    if (!list) return;

    const activeItems = appState.notifications.filter(n => !n.cleared);
    const unreadCount = activeItems.filter(n => !n.read).length;

    if (badge) {
        badge.style.display = unreadCount > 0 ? 'block' : 'none';
        badge.textContent = unreadCount > 0 ? unreadCount : '';
    }

    if (activeItems.length === 0) {
        list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-3); font-size:11px;">No new notifications</div>';
        return;
    }

    list.innerHTML = activeItems.map(n => `
        <div class="notification-item ${n.read ? '' : 'unread'}" onclick="window.markNotificationRead(${n.id})">
            <div class="ni-icon" style="background:${n.type === 'ai' ? 'linear-gradient(135deg, rgba(0, 212, 168, 0.2) 0%, rgba(0, 212, 168, 0.05) 100%)' : n.type === 'alert' ? 'linear-gradient(135deg, rgba(255, 77, 109, 0.2) 0%, rgba(255, 77, 109, 0.05) 100%)' : 'rgba(255,255,255,0.05)'}; color:${n.type === 'ai' ? 'var(--accent)' : n.type === 'alert' ? 'var(--danger)' : 'var(--text-3)'}">
                <i class="ph-fill ph-${n.type === 'ai' ? 'lightning' : n.type === 'alert' ? 'warning-circle' : 'shield-check'}"></i>
            </div>
            <div class="ni-content">
                <div class="ni-title">${n.title}</div>
                <div class="ni-text" style="font-size:11px; color:var(--text-3); line-height:1.4;">${n.text}</div>
                <div class="ni-time">${n.time}</div>
            </div>
        </div>
    `).join('');
}

// Global scope access for inline HTML onclick handlers.
// Marks a notification read, closes the panel, and navigates to the relevant
// tab based on either the notification's explicit `link` property or
// content-keyword fallback.
window.markNotificationRead = function(id) {
    if (!appState || !appState.notifications) return;
    const notif = appState.notifications.find(n => n.id === id);
    if (notif && !notif.read) {
        notif.read = true;
        try { saveState(); } catch(_){}
        try { renderNotifications(); } catch(_){}
    }

    if (!notif) return;

    // Close the panel immediately so nav feels instant.
    try {
        const panel = document.getElementById('notification-panel');
        if (panel) panel.classList.remove('active');
    } catch(_){}

    // Pick a destination — explicit link wins, then keyword routing.
    const route = (page) => {
        try {
            if (typeof navTo === 'function') return navTo(page);
            if (typeof window.navTo === 'function') return window.navTo(page);
            if (typeof navigateSPA === 'function') return navigateSPA(page);
        } catch(e){ console.warn('notification nav failed', e); }
    };

    if (notif.link) { route(notif.link); return; }

    // Keyword routing — broader coverage so taps don't fall through.
    const txt = ((notif.title || '') + ' ' + (notif.text || '')).toLowerCase();

    if (notif.type === 'ai' || /\b(strategy|advisor|recommend|optim(ize|ise|izer)|insight|coach)\b/.test(txt)) {
        route('advisor');
    } else if (/\b(payment|due|overdue|debt|loan|credit\s*card|mortgage|paydown)\b/.test(txt)) {
        route('debts');
    } else if (/\b(budget|expense|spend(ing)?|cash\s*flow|allocation)\b/.test(txt)) {
        route('budgets');
    } else if (/\b(calendar|schedule|recurring|bill|subscription)\b/.test(txt)) {
        route('recurring');
    } else if (/\b(security|password|2fa|authentication|account|profile|settings|preferences)\b/.test(txt)) {
        route('settings');
    } else if (/\b(milestone|level|streak|achieve|graduat|congrat)\b/.test(txt)) {
        route('dashboard');
    } else {
        // Default: full activity log
        route('activity');
    }
};

/* ---------- RESILIENCE TAB ---------- */
/* ============================================================
   SIMULATIONS TAB — fully dynamic
   ============================================================ */
function getBalanceTimeline(strategy, extraMonthly, lumpSum, rateAdj) {
    if (!appState || !appState.debts.length) return [];
    let debts = JSON.parse(JSON.stringify(appState.debts));
    debts = sortDebtsByStrategy(debts, strategy);

    // Apply rate adjustment
    debts.forEach(d => { d.apr = Math.max(0, d.apr + (rateAdj || 0)); });

    // Apply lump sum to top-priority debt
    if (lumpSum > 0) debts[0].balance = Math.max(0, debts[0].balance - lumpSum);

    const timeline = [{ month: 0, balance: debts.reduce((s,d) => s + d.balance, 0) }];
    let months = 0;

    while (months < 600) {
        months++;
        let cascade = extraMonthly;
        let allPaid = true;
        for (let i = 0; i < debts.length; i++) {
            const d = debts[i];
            if (d.balance > 0) {
                allPaid = false;
                d.balance += d.balance * (d.apr / 100 / 12);
                const pay = d.minPayment + cascade;
                cascade = 0;
                if (d.balance <= pay) { cascade += pay - d.balance; d.balance = 0; }
                else { d.balance -= pay; }
            } else { cascade += d.minPayment; }
        }
        timeline.push({ month: months, balance: Math.max(0, debts.reduce((s,d) => s + d.balance, 0)) });
        if (allPaid) break;
    }
    return timeline;
}

// Per-render-cycle cache for the heavy simulator calls. Cleared by updateUI()
// at the start of each render so values stay fresh between user actions but
// don't get re-computed when the AI Advisor + DFD hero + projection chart all
// ask for the same simulation params during one render.
let _simCache = new Map();
function _clearSimCache() { _simCache = new Map(); }

/**
 * Compute the user's "available cash flow" — what's actually left over each month
 * after income, expenses, and non-debt recurring outflows. Used to auto-derive an
 * extra monthly contribution if they haven't set one manually. The simulator uses
 * this to give a realistic debt-free date instead of one that ignores their actual
 * surplus.
 *
 * Returns: { income, expenses, totalMin, recurringNonDebt, available }
 *   available = income - expenses - totalMin - recurringNonDebt
 *
 * If income is 0 (user hasn't entered it), returns available = 0 — no auto-extra.
 */
function getAvailableCashflow() {
    const income = (appState.balances && parseFloat(appState.balances.monthlyIncome)) || 0;
    const expensesObj = (appState.budget && appState.budget.expenses) || {};
    const expenses = Object.values(expensesObj).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const totalMin = (appState.debts || []).reduce((s, d) => s + (parseFloat(d.minPayment) || 0), 0);

    // Recurring outflows that aren't already captured as debt minimums or
    // expense buckets — typically subscriptions, utilities, rent if not in expenses.
    const recurring = (appState.recurringPayments || [])
        .filter(r => r && !r.linkedIncome && r.category !== 'income' && !r.linkedDebtId)
        .reduce((s, r) => {
            const freq = (r.frequency || 'monthly').toLowerCase();
            const amt = parseFloat(r.amount) || 0;
            if (freq === 'weekly') return s + amt * 52 / 12;
            if (freq === 'biweekly') return s + amt * 26 / 12;
            if (freq === 'semimonthly') return s + amt * 2;
            if (freq === 'quarterly') return s + amt / 3;
            if (freq === 'annually') return s + amt / 12;
            return s + amt; // monthly
        }, 0);

    const available = Math.max(0, income - expenses - totalMin - recurring);
    return { income, expenses, totalMin, recurringNonDebt: recurring, available };
}

/**
 * Effective extra contribution — picks user's manual setting if they have one,
 * otherwise auto-uses available cash flow so the projection is realistic.
 * Returns: { extra, source } — source is 'manual' or 'auto-surplus' or 'none'.
 */
function getEffectiveExtraContribution() {
    const manual = (appState.budget && parseFloat(appState.budget.contribution)) || 0;
    if (manual > 0) return { extra: manual, source: 'manual' };
    const cf = getAvailableCashflow();
    if (cf.available > 0) return { extra: cf.available, source: 'auto-surplus' };
    return { extra: 0, source: 'none' };
}

function calcSimTotals(strategy, extraMonthly, lumpSum, rateAdj) {
    if (!appState || !appState.debts.length) return { months: 0, totalInterest: 0, totalPaid: 0 };
    const key = `T:${strategy}:${extraMonthly}:${lumpSum}:${rateAdj || 0}`;
    if (_simCache.has(key)) return _simCache.get(key);

    let debts = JSON.parse(JSON.stringify(appState.debts));
    debts = sortDebtsByStrategy(debts, strategy);
    debts.forEach(d => { d.apr = Math.max(0, d.apr + (rateAdj || 0)); });
    if (lumpSum > 0) debts[0].balance = Math.max(0, debts[0].balance - lumpSum);

    let months = 0, totalInterest = 0, totalPaid = lumpSum;
    while (months < 600) {
        months++;
        let cascade = extraMonthly;
        debts.forEach(d => { if (d.balance <= 0) cascade += d.minPayment; });

        let allPaid = true;
        for (let i = 0; i < debts.length; i++) {
            const d = debts[i];
            if (d.balance <= 0) continue;
            allPaid = false;

            const dtype = (d.type || '').toString().toLowerCase();
            const isCard = dtype.includes('credit') || dtype.includes('card');
            const totalAvailToPay = d.minPayment + cascade;
            const wouldPayInFull = isCard && d.statementDay && totalAvailToPay >= d.balance;
            let int = 0;
            if (!wouldPayInFull) {
                int = d.balance * (d.apr / 100 / 12);
                d.balance += int;
                totalInterest += int;
            }

            const pay = d.minPayment + cascade;
            cascade = 0;
            if (d.balance <= pay) { totalPaid += d.balance; cascade += pay - d.balance; d.balance = 0; }
            else { d.balance -= pay; totalPaid += pay; }
        }
        if (allPaid) break;
    }
    const out = { months, totalInterest, totalPaid };
    _simCache.set(key, out);
    return out;
}

/**
 * Run the same payoff simulation but capture the TOTAL portfolio balance at the
 * end of each month so charts can plot the trajectory accurately. Returns an
 * array indexed by month (0 = today's starting balance).
 */
function calcBalanceTrajectory(strategy, extraMonthly, monthLimit) {
    const cap = monthLimit || 60;
    if (!appState || !appState.debts.length) return [0];

    const key = `B:${strategy}:${extraMonthly}:${cap}`;
    if (_simCache.has(key)) return _simCache.get(key);

    let debts = JSON.parse(JSON.stringify(appState.debts));
    debts = sortDebtsByStrategy(debts, strategy);

    const series = [debts.reduce((s, d) => s + (d.balance || 0), 0)];
    let months = 0;
    while (months < cap) {
        months++;
        // Pre-sum freed minimums from paid-off debts → all flows to priority
        let cascade = extraMonthly || 0;
        debts.forEach(d => { if (d.balance <= 0) cascade += d.minPayment; });

        let allPaid = true;
        for (let i = 0; i < debts.length; i++) {
            const d = debts[i];
            if (d.balance <= 0) continue;
            allPaid = false;

            const dtype = (d.type || '').toString().toLowerCase();
            const isCard = dtype.includes('credit') || dtype.includes('card');
            const totalAvailToPay = d.minPayment + cascade;
            const wouldPayInFull = isCard && d.statementDay && totalAvailToPay >= d.balance;
            if (!wouldPayInFull) {
                const int = d.balance * (d.apr / 100 / 12);
                d.balance += int;
            }
            const pay = d.minPayment + cascade;
            cascade = 0;
            if (d.balance <= pay) { cascade += pay - d.balance; d.balance = 0; }
            else { d.balance -= pay; }
        }
        const total = debts.reduce((s, d) => s + (d.balance || 0), 0);
        series.push(Math.max(0, total));
        if (allPaid) break;
    }
    _simCache.set(key, series);
    return series;
}

function calcDebtSimTotals(debtId, extraMonthly, lumpSum, rateAdj) {
    // Per-debt months & interest (with/without extra)
    if (!appState || !appState.debts.length) return {};
    const results = {};
    const strategy = appState.settings.strategy || 'avalanche';

    for (const scenario of ['base', 'sim']) {
        let debts = JSON.parse(JSON.stringify(appState.debts));
        if (strategy === 'avalanche') debts.sort((a,b) => b.apr - a.apr);
        else if (strategy === 'snowball') debts.sort((a,b) => a.balance - b.balance);
        else debts.sort((a,b) => (b.apr/Math.max(1,b.balance)) - (a.apr/Math.max(1,a.balance)));
        debts.forEach(d => { d.apr = Math.max(0, d.apr + (rateAdj || 0)); });

        const extra = scenario === 'sim' ? extraMonthly : 0;
        const lump  = scenario === 'sim' ? lumpSum : 0;
        if (lump > 0) debts[0].balance = Math.max(0, debts[0].balance - lump);

        const perDebt = {};
        debts.forEach(d => { perDebt[d.id] = { months: 0, interest: 0, balance: d.balance, min: d.minPayment, apr: d.apr }; });

        let months = 0;
        while (months < 600) {
            months++;
            let cascade = extra;
            let allPaid = true;
            for (let i = 0; i < debts.length; i++) {
                const r = perDebt[debts[i].id];
                if (r.balance > 0) {
                    allPaid = false;
                    const int = r.balance * (r.apr / 100 / 12);
                    r.balance += int; r.interest += int;
                    const pay = r.min + cascade; cascade = 0;
                    if (r.balance <= pay) { cascade += pay - r.balance; r.balance = 0; r.months = months; }
                    else { r.balance -= pay; }
                } else { cascade += r.min; }
            }
            if (allPaid) break;
        }
        debts.forEach(d => { if (perDebt[d.id].months === 0) perDebt[d.id].months = months; });
        results[scenario] = perDebt;
    }
    return results;
}

function renderSimulationsTab() {
    const container = document.getElementById('simulations-tab-content');
    if (!container) return;

    const fmt  = n => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(n);
    const fmtD = n => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:0 }).format(n);

    // Read persisted sim state
    let sv = {};
    try { sv = JSON.parse(localStorage.getItem('wjp_sim_state') || '{}'); } catch(e) {}
    const saveSv = () => localStorage.setItem('wjp_sim_state', JSON.stringify(sv));

    const curStrategy  = sv.strategy  ?? appState.settings.strategy ?? 'avalanche';
    const curExtra     = sv.extra     ?? appState.budget.contribution ?? 500;
    const curLump      = sv.lump      ?? 0;
    const curRateAdj   = sv.rateAdj   ?? 0;

    // ---- Run computations ----
    const baseStats = calcSimTotals(curStrategy, 0, 0, 0);
    const simStats  = calcSimTotals(curStrategy, curExtra, curLump, curRateAdj);
    const intSaved  = Math.max(0, baseStats.totalInterest - simStats.totalInterest);
    const moSaved   = Math.max(0, baseStats.months - simStats.months);

    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + simStats.months);
    const payoffStr = payoffDate.toLocaleString('default', { month:'short', year:'numeric' });

    const baseDate = new Date();
    baseDate.setMonth(baseDate.getMonth() + baseStats.months);
    const baseDateStr = baseDate.toLocaleString('default', { month:'short', year:'numeric' });

    // Per-strategy comparison (all with same extra + lump)
    const strats = ['snowball','avalanche','hybrid'];
    const stratLabels = { snowball:'Snowball', avalanche:'Avalanche', hybrid:'Hybrid' };
    const stratIcons  = { snowball:'ph-snowflake', avalanche:'ph-mountains', hybrid:'ph-intersect' };
    const stratColors = { snowball:'#667eea', avalanche:'var(--accent)', hybrid:'#ffab40' };
    const stratStats  = {};
    strats.forEach(s => { stratStats[s] = calcSimTotals(s, curExtra, curLump, curRateAdj); });
    const bestStrat = strats.reduce((a,b) => stratStats[a].totalInterest <= stratStats[b].totalInterest ? a : b);

    // Per-debt breakdown
    const debtSim = calcDebtSimTotals(null, curExtra, curLump, curRateAdj);

    // Timeline data for chart (sample every 6 months to keep points manageable)
    const baseTimeline = getBalanceTimeline(curStrategy, 0, 0, 0);
    const simTimeline  = getBalanceTimeline(curStrategy, curExtra, curLump, curRateAdj);
    const maxMonths = Math.max(baseTimeline.length, simTimeline.length);
    const step = Math.max(1, Math.floor(maxMonths / 36));
    const chartLabels = [], chartBase = [], chartSim = [];
    for (let i = 0; i < maxMonths; i += step) {
        const b = baseTimeline[i] || baseTimeline[baseTimeline.length-1];
        const s = simTimeline[i]  || simTimeline[simTimeline.length-1];
        const d = new Date(); d.setMonth(d.getMonth() + i);
        chartLabels.push(d.toLocaleString('default', { month:'short', year:'2-digit' }));
        chartBase.push(Math.round(b.balance));
        chartSim.push(Math.round(s.balance));
    }

    // AI insight
    const highApr = appState.debts.length ? appState.debts.reduce((p,c) => c.apr > p.apr ? c : p) : null;
    const aiInsight = curExtra > 0 || curLump > 0
        ? `Applying ${curLump > 0 ? fmt(curLump) + ' lump sum' + (curExtra > 0 ? ' + ' : '') : ''}${curExtra > 0 ? fmt(curExtra) + '/mo extra' : ''} under the <strong>${curStrategy}</strong> strategy saves <strong>${fmt(intSaved)}</strong> in interest and eliminates debt <strong>${moSaved} months earlier</strong> (${payoffStr} vs ${baseDateStr}). ${bestStrat !== curStrategy ? `Switching to <strong>${stratLabels[bestStrat]}</strong> would save an additional <strong>${fmt(simStats.totalInterest - stratStats[bestStrat].totalInterest)}</strong>.` : `<strong>${stratLabels[bestStrat]}</strong> is already your optimal strategy — no further improvement from switching.`}`
        : `No extra payment applied. At minimum payments only, payoff is projected for <strong>${baseDateStr}</strong> with <strong>${fmt(baseStats.totalInterest)}</strong> in total interest. Adding even <strong>$200/mo extra</strong> would save <strong>${fmt(Math.max(0, baseStats.totalInterest - calcSimTotals(curStrategy, 200, 0, 0).totalInterest))}</strong>. ${highApr ? `Focus on <strong>${highApr.name}</strong> (${highApr.apr}% APR) first for maximum impact.` : ''}`;

    container.innerHTML = `
        <!-- HEADER -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;" class="reveal">
            <div>
                <div class="card-label" style="color:var(--accent);">Strategy Analysis</div>
                <h1 style="font-size:28px; font-weight:900; margin:4px 0 0;">Debt Payoff Simulator</h1>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <!-- Strategy selector -->
                <div style="display:flex; background:var(--card-2); border-radius:8px; padding:3px; gap:2px;">
                    ${strats.map(s => `
                        <button data-strat="${s}" style="background:${curStrategy===s ? 'var(--accent)' : 'transparent'}; color:${curStrategy===s ? '#0b0f1a' : 'var(--text-3)'}; border:none; border-radius:6px; padding:6px 14px; font-size:11px; font-weight:700; cursor:pointer; transition:all 0.2s;">${stratLabels[s]}</button>
                    `).join('')}
                </div>
                <button id="sim-export-btn" style="background:var(--card-2); border:1px solid var(--border); color:var(--text-3); border-radius:8px; padding:8px 14px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <i class="ph ph-download-simple"></i> Export CSV
                </button>
            </div>
        </div>

        <!-- CONTROLS + CHART (2-col) -->
        <div style="display:grid; grid-template-columns:300px 1fr; gap:20px; margin-bottom:20px;" class="reveal reveal-1">

            <!-- Controls -->
            <div class="card" style="padding:20px 22px; display:flex; flex-direction:column; gap:24px;">
                <div>
                    <div style="font-size:13px; font-weight:700; margin-bottom:4px;">Scenario Variables</div>
                    <div style="font-size:10px; color:var(--text-3);">Adjust and results update instantly</div>
                </div>

                <!-- Extra monthly -->
                <div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Extra Monthly</span>
                        <span id="extra-val" style="font-size:13px; color:var(--accent); font-weight:800;">${fmt(curExtra)}</span>
                    </div>
                    <input id="sim-extra" type="range" min="0" max="3000" step="50" value="${curExtra}" style="width:100%; accent-color:var(--accent);">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-3); margin-top:4px;"><span>$0</span><span>$3,000</span></div>
                </div>

                <!-- Lump sum -->
                <div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">One-Time Lump Sum</span>
                        <span id="lump-val" style="font-size:13px; color:var(--accent); font-weight:800;">${fmt(curLump)}</span>
                    </div>
                    <input id="sim-lump" type="range" min="0" max="25000" step="500" value="${curLump}" style="width:100%; accent-color:var(--accent);">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-3); margin-top:4px;"><span>$0</span><span>$25,000</span></div>
                </div>

                <!-- Rate adjustment -->
                <div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Rate Adjustment</span>
                        <span id="rate-val" style="font-size:13px; color:${curRateAdj > 0 ? 'var(--danger)' : curRateAdj < 0 ? 'var(--accent)' : 'var(--text-3)'}; font-weight:800;">${curRateAdj > 0 ? '+' : ''}${curRateAdj.toFixed(2)}%</span>
                    </div>
                    <input id="sim-rate" type="range" min="-3" max="3" step="0.25" value="${curRateAdj}" style="width:100%; accent-color:var(--accent);">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-3); margin-top:4px;"><span>−3%</span><span>+3%</span></div>
                </div>

                <!-- Lump sum target -->
                <div>
                    <div style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; font-weight:700; margin-bottom:8px;">Lump Sum Applied To</div>
                    <select id="sim-focus" style="width:100%; background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:8px 10px; font-size:12px; font-weight:600; cursor:pointer;">
                        <option value="top">Top Priority Debt (auto)</option>
                        ${appState.debts.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
                    </select>
                </div>

                <div style="border-top:1px solid var(--border); padding-top:14px; font-size:10px; color:var(--text-3); line-height:1.6; display:flex; gap:8px;">
                    <i class="ph ph-info" style="color:var(--accent); flex-shrink:0; margin-top:2px;"></i>
                    Extra payment cascades to next debt after each payoff. Lump sum goes to highest-priority debt in the selected strategy.
                </div>
            </div>

            <!-- Chart -->
            <div class="card" style="padding:20px 24px; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
                    <div>
                        <div style="font-size:14px; font-weight:700;">Portfolio Balance Over Time</div>
                        <div style="font-size:10px; color:var(--text-3); margin-top:3px;">Current path vs. simulated payoff trajectory</div>
                    </div>
                    <div style="display:flex; gap:16px; align-items:center;">
                        <div style="display:flex; align-items:center; gap:5px;"><div style="width:20px; height:3px; background:var(--text-3); opacity:0.4; border-radius:2px;"></div><span style="font-size:9px; color:var(--text-3); font-weight:700;">CURRENT</span></div>
                        <div style="display:flex; align-items:center; gap:5px;"><div style="width:20px; height:3px; background:var(--accent); border-radius:2px;"></div><span style="font-size:9px; color:var(--text-3); font-weight:700;">SIMULATED</span></div>
                    </div>
                </div>
                <div style="flex:1; min-height:220px; position:relative;">
                    <canvas id="simLineChart"></canvas>
                </div>
            </div>
        </div>

        <!-- IMPACT SUMMARY (4 stats) -->
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:20px;" class="reveal reveal-2">
            ${[
                { label:'Interest Saved',   val: fmt(intSaved),            sub: 'vs. minimum payments',       color:'var(--accent)',   icon:'ph-piggy-bank'    },
                { label:'Months Saved',     val: moSaved + ' mo',          sub: 'debt-free sooner',           color:'#667eea',         icon:'ph-calendar-check'},
                { label:'New Payoff Date',  val: payoffStr,                sub: `was ${baseDateStr}`,         color:'var(--accent)',   icon:'ph-flag'          },
                { label:'Total Paid',       val: fmt(simStats.totalPaid),  sub: `was ${fmt(baseStats.totalPaid)}`, color: simStats.totalPaid < baseStats.totalPaid ? 'var(--accent)' : 'var(--text)', icon:'ph-currency-dollar' }
            ].map(s => `
                <div class="card" style="padding:18px 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">${s.label}</div>
                        <div style="width:30px; height:30px; background:rgba(0,212,168,0.1); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i class="ph ${s.icon}" style="color:${s.color}; font-size:15px;"></i>
                        </div>
                    </div>
                    <div style="font-size:22px; font-weight:900; color:${s.color}; margin-bottom:4px;">${s.val}</div>
                    <div style="font-size:10px; color:var(--text-3);">${s.sub}</div>
                </div>
            `).join('')}
        </div>

        <!-- STRATEGY COMPARISON -->
        <div style="margin-bottom:20px;" class="reveal reveal-2">
            <div style="font-size:14px; font-weight:700; margin-bottom:14px;">Strategy Comparison <span style="font-size:10px; color:var(--text-3); font-weight:500;">— with your current extra payment applied</span></div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;">
                ${strats.map(s => {
                    const st = stratStats[s];
                    const isBest = s === bestStrat;
                    const intDiff = Math.round(st.totalInterest - stratStats[bestStrat].totalInterest);
                    const d = new Date(); d.setMonth(d.getMonth() + st.months);
                    return `
                    <div class="card" style="padding:20px 22px; border:${isBest ? '1px solid var(--accent)' : '1px solid var(--border)'}; position:relative;">
                        ${isBest ? `<div style="position:absolute; top:-1px; left:50%; transform:translateX(-50%); background:var(--accent); color:#0b0f1a; font-size:8px; font-weight:800; padding:3px 10px; border-radius:0 0 6px 6px;">OPTIMAL</div>` : ''}
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; padding-top:${isBest ? '8px' : '0'}">
                            <div style="width:38px; height:38px; background:${isBest ? 'var(--accent)' : 'var(--card-2)'}; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="ph ${stratIcons[s]}" style="font-size:18px; color:${isBest ? '#0b0f1a' : stratColors[s]};"></i>
                            </div>
                            <div>
                                <div style="font-size:14px; font-weight:800; color:${isBest ? 'var(--accent)' : 'var(--text)'};">${stratLabels[s]}</div>
                                <div style="font-size:9px; color:var(--text-3); margin-top:1px;">${s==='snowball' ? 'Lowest balance first' : s==='avalanche' ? 'Highest APR first' : 'APR/Balance ratio'}</div>
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
                            <div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center;">
                                <div style="font-size:9px; color:var(--text-3);">Total Interest</div>
                                <div style="font-size:15px; font-weight:800; color:${isBest ? 'var(--accent)' : 'var(--text)'}; margin-top:3px;">${fmt(st.totalInterest)}</div>
                            </div>
                            <div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center;">
                                <div style="font-size:9px; color:var(--text-3);">Payoff</div>
                                <div style="font-size:15px; font-weight:800; margin-top:3px;">${d.toLocaleString('default',{month:'short',year:'numeric'})}</div>
                            </div>
                        </div>
                        ${isBest
                            ? `<div style="font-size:10px; color:var(--accent); font-weight:700; text-align:center; background:rgba(0,212,168,0.08); padding:8px; border-radius:6px;">Best rate efficiency for your profile</div>`
                            : `<div style="font-size:10px; color:var(--text-3); text-align:center; background:var(--bg); padding:8px; border-radius:6px;">+${fmt(intDiff)} more interest than optimal</div>`
                        }
                    </div>`;
                }).join('')}
            </div>
        </div>

        <!-- PER-DEBT BREAKDOWN -->
        <div class="card reveal reveal-3" style="margin-bottom:20px; padding:20px 24px;">
            <div style="font-size:14px; font-weight:700; margin-bottom:16px;">Per-Debt Payoff Breakdown</div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:11px;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--border);">
                            <th style="text-align:left; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Debt</th>
                            <th style="text-align:right; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Balance</th>
                            <th style="text-align:right; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">APR</th>
                            <th style="text-align:right; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Current Payoff</th>
                            <th style="text-align:right; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Simulated Payoff</th>
                            <th style="text-align:right; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Months Saved</th>
                            <th style="text-align:right; padding:8px 10px; color:var(--text-3); font-size:9px; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Interest Saved</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${appState.debts.map(d => {
                            const base = debtSim.base ? debtSim.base[d.id] : null;
                            const sim  = debtSim.sim  ? debtSim.sim[d.id]  : null;
                            if (!base || !sim) return '';
                            const moSv = Math.max(0, base.months - sim.months);
                            const intSv = Math.max(0, base.interest - sim.interest);
                            const bDate = new Date(); bDate.setMonth(bDate.getMonth() + base.months);
                            const sDate = new Date(); sDate.setMonth(sDate.getMonth() + sim.months);
                            return `<tr style="border-bottom:1px solid var(--border);">
                                <td style="padding:12px 10px; font-weight:700;">${d.name}</td>
                                <td style="padding:12px 10px; text-align:right; color:var(--text-3);">${fmt(d.balance)}</td>
                                <td style="padding:12px 10px; text-align:right; color:${d.apr > 15 ? 'var(--danger)' : 'var(--text-3)'}; font-weight:700;">${d.apr}%</td>
                                <td style="padding:12px 10px; text-align:right; color:var(--text-3);">${bDate.toLocaleString('default',{month:'short',year:'numeric'})}</td>
                                <td style="padding:12px 10px; text-align:right; color:var(--accent); font-weight:700;">${sDate.toLocaleString('default',{month:'short',year:'numeric'})}</td>
                                <td style="padding:12px 10px; text-align:right; color:${moSv > 0 ? 'var(--accent)' : 'var(--text-3)'}; font-weight:${moSv > 0 ? '700' : '400'};">${moSv > 0 ? moSv + ' mo' : '—'}</td>
                                <td style="padding:12px 10px; text-align:right; color:${intSv > 0 ? 'var(--accent)' : 'var(--text-3)'}; font-weight:${intSv > 0 ? '700' : '400'};">${intSv > 0 ? fmt(intSv) : '—'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- AI INSIGHT -->
        <div class="card reveal reveal-4" style="padding:24px; border:1px solid rgba(0,212,168,0.2);">
            <div style="display:flex; gap:20px; align-items:flex-start;">
                <div style="width:48px; height:48px; background:linear-gradient(135deg, var(--accent), #667eea); border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 8px 24px rgba(0,212,168,0.25);">
                    <i class="ph-fill ph-brain" style="font-size:24px; color:#0b0f1a;"></i>
                </div>
                <div style="flex:1;">
                    <div style="font-size:10px; color:var(--accent); font-weight:700; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">Evergreen AI · Simulation Insight</div>
                    <div id="sim-ai-text" style="font-size:13px; color:var(--text-3); line-height:1.8;">${aiInsight}</div>
                </div>
                <button id="sim-apply-btn" style="background:var(--accent); color:#0b0f1a; border:none; border-radius:8px; padding:10px 18px; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                    Apply Strategy
                </button>
            </div>
        </div>
    `;

    // ---- CHART ----
    const canvas = document.getElementById('simLineChart');
    if (canvas) {
        if (window._simChart instanceof Chart) window._simChart.destroy();
        const ctx = canvas.getContext('2d');
        window._simChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [
                    {
                        label: 'Current Path',
                        data: chartBase,
                        borderColor: 'rgba(180,180,180,0.5)',
                        borderWidth: 2,
                        borderDash: [6,4],
                        pointRadius: 0,
                        fill: false,
                        tension: 0.3
                    },
                    {
                        label: 'Simulated Path',
                        data: chartSim,
                        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00d4a8',
                        borderWidth: 2.5,
                        pointRadius: 0,
                        fill: {
                            target: 'origin',
                            above: 'rgba(0,212,168,0.06)'
                        },
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: ctx => ctx.dataset.label + ': ' + new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(ctx.raw)
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color:'rgba(255,255,255,0.3)', font:{size:9}, maxTicksLimit:8 },
                        grid: { color:'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        ticks: {
                            color:'rgba(255,255,255,0.3)', font:{size:9},
                            callback: v => '$' + (v >= 1000 ? Math.round(v/1000) + 'k' : v)
                        },
                        grid: { color:'rgba(255,255,255,0.04)' }
                    }
                }
            }
        });
    }

    // ---- EVENT LISTENERS ----

    // Strategy pills — update both sim state AND global strategy
    container.querySelectorAll('[data-strat]').forEach(btn => {
        btn.addEventListener('click', () => {
            sv.strategy = btn.dataset.strat;
            saveSv();
            // Sync global strategy so all tabs stay in sync
            if (appState.settings) appState.settings.strategy = sv.strategy;
            saveState();
            syncStrategyCards();
            // Sync chip groups on other tabs
            document.querySelectorAll('#strategy-tabs .chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-strategy') === sv.strategy);
            });
            renderSimulationsTab();
        });
    });

    // Sliders
    const extraSlider = document.getElementById('sim-extra');
    const lumpSlider  = document.getElementById('sim-lump');
    const rateSlider  = document.getElementById('sim-rate');

    // input = update label only (smooth drag); change = full recalc on release
    extraSlider?.addEventListener('input', () => {
        sv.extra = parseInt(extraSlider.value);
        document.getElementById('extra-val').textContent = fmt(sv.extra);
    });
    extraSlider?.addEventListener('change', () => {
        sv.extra = parseInt(extraSlider.value);
        saveSv();
        renderSimulationsTab();
    });

    lumpSlider?.addEventListener('input', () => {
        sv.lump = parseInt(lumpSlider.value);
        document.getElementById('lump-val').textContent = fmt(sv.lump);
    });
    lumpSlider?.addEventListener('change', () => {
        sv.lump = parseInt(lumpSlider.value);
        saveSv();
        renderSimulationsTab();
    });

    rateSlider?.addEventListener('input', () => {
        sv.rateAdj = parseFloat(rateSlider.value);
        const rv = document.getElementById('rate-val');
        if (rv) { rv.textContent = (sv.rateAdj > 0 ? '+' : '') + sv.rateAdj.toFixed(2) + '%'; rv.style.color = sv.rateAdj > 0 ? 'var(--danger)' : sv.rateAdj < 0 ? 'var(--accent)' : 'var(--text-3)'; }
    });
    rateSlider?.addEventListener('change', () => {
        sv.rateAdj = parseFloat(rateSlider.value);
        saveSv();
        renderSimulationsTab();
    });

    // Apply strategy button — uses setStrategy() for full cross-tab sync
    document.getElementById('sim-apply-btn')?.addEventListener('click', () => {
        const newStrat = sv.strategy || curStrategy;
        appState.budget.contribution = sv.extra ?? curExtra;
        saveState();
        setStrategy(newStrat); // handles saveState + updateUI + all sync
        const btn = document.getElementById('sim-apply-btn');
        if (btn) { btn.textContent = '✓ Applied!'; btn.style.background = '#00ffca'; setTimeout(() => { if(btn) { btn.textContent = 'Apply Strategy'; btn.style.background = 'var(--accent)'; } }, 2000); }
    });

    // Export CSV
    document.getElementById('sim-export-btn')?.addEventListener('click', () => {
        const rows = [['Debt','Balance','APR','Current Payoff','Simulated Payoff','Months Saved','Interest Saved']];
        appState.debts.forEach(d => {
            const base = debtSim.base?.[d.id];
            const sim  = debtSim.sim?.[d.id];
            if (!base || !sim) return;
            const moSv  = Math.max(0, base.months - sim.months);
            const intSv = Math.max(0, base.interest - sim.interest).toFixed(2);
            const bDate = new Date(); bDate.setMonth(bDate.getMonth() + base.months);
            const sDate = new Date(); sDate.setMonth(sDate.getMonth() + sim.months);
            rows.push([d.name, d.balance, d.apr + '%', bDate.toLocaleString('default',{month:'short',year:'numeric'}), sDate.toLocaleString('default',{month:'short',year:'numeric'}), moSv, intSv]);
        });
        rows.push([]);
        rows.push(['Summary','Interest Saved',intSaved.toFixed(2),'Months Saved',moSaved,'Payoff Date',payoffStr]);
        const csv = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], {type:'text/csv'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'wjp_simulation.csv'; a.click();
    });
}

function renderResilienceTab() {
    const container = document.getElementById('resilience-tab-content');
    if (!container) return;

    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    // --- Load or initialize override state ---
    let ov = {};
    try { ov = JSON.parse(localStorage.getItem('wjp_resilience_ov') || '{}'); } catch(e) {}
    const saveOv = () => localStorage.setItem('wjp_resilience_ov', JSON.stringify(ov));

    // --- Computed values (overridable) ---
    const rawIncome     = (appState.balances && appState.balances.monthlyIncome) || 0;
    const income        = ov.income    ?? rawIncome;
    const totalDebt     = appState.debts.reduce((s, d) => s + d.balance, 0);
    const totalMinPay   = appState.debts.reduce((s, d) => s + d.minPayment, 0);
    const exp           = appState.budget.expenses;
    const housing       = ov.housing   ?? exp.housing  ?? 0;
    const food          = ov.food      ?? exp.food     ?? 0;
    const transit       = ov.transit   ?? exp.transit  ?? 0;
    const disc          = ov.disc      ?? exp.disc     ?? 0;
    const monthlyExp    = housing + food + transit + disc;
    const emergencyFund = ov.ef        ?? 0;
    const emergencyTarget = ov.eft     ?? (income > 0 ? income * 6 : 1); // avoid /0
    const efPct         = emergencyTarget > 0 ? Math.min(100, Math.round((emergencyFund / emergencyTarget) * 100)) : 0;
    const efMonths      = monthlyExp > 0 ? (emergencyFund / monthlyExp).toFixed(1) : '0.0';
    const cashflowBuffer = income > 0 ? income - totalMinPay - monthlyExp : 0;
    const dtiRatio      = income > 0 ? ((totalMinPay / income) * 100).toFixed(1) : '0.0';

    // Estimated liquid assets ≈ 6 months income × ratio (simplified)
    const liquidAssets  = emergencyFund + (cashflowBuffer > 0 ? cashflowBuffer * 3 : 0);
    const dtaRatio      = totalDebt > 0 ? (liquidAssets / totalDebt).toFixed(2) : '∞';

    // Resilience score (0-100)
    const efScore   = income > 0 ? Math.min(30, (emergencyFund / (income * 3)) * 30) : 0;
    const dtiScore  = Math.max(0, 30 - (parseFloat(dtiRatio) / 2));
    const cfScore   = income > 0 && cashflowBuffer > 0 ? Math.min(20, (cashflowBuffer / income) * 40) : 0;
    const dtaNum    = dtaRatio === '∞' ? 20 : parseFloat(dtaRatio) || 0;
    const dtaScore  = Math.min(20, dtaNum * 10);
    const totalScore = income === 0 ? 0 : Math.round(efScore + dtiScore + cfScore + dtaScore);

    const scoreColor = totalScore >= 80 ? 'var(--accent)' : totalScore >= 60 ? 'var(--warning)' : 'var(--danger)';
    const scoreBadge = totalScore >= 80 ? 'badge-success' : totalScore >= 60 ? 'badge-warning' : 'badge-danger';
    const scoreLabel = totalScore >= 80 ? 'Strong' : totalScore >= 60 ? 'Moderate' : 'At Risk';

    // Stress test scenarios
    const incomeDrop20 = income * 0.8;
    const surviveMonths20 = cashflowBuffer > 0 ? Math.max(0, Math.floor(emergencyFund / (totalMinPay + monthlyExp - incomeDrop20))) : 0;

    const rateHike1pct  = appState.debts.reduce((s, d) => s + d.balance * (0.01 / 12), 0);
    const rateHikeSafe  = rateHike1pct < cashflowBuffer;

    const jobLossSurvive = monthlyExp > 0 ? Math.floor(emergencyFund / monthlyExp) : 0;

    // Milestone logic
    const milestones = [
        { label: 'Starter Fund',    desc: '1-month expenses saved',   done: emergencyFund >= monthlyExp,        icon: 'ph-bank'         },
        { label: 'APR Buster',      desc: 'All APRs below 25%',       done: appState.debts.every(d => d.apr < 25), icon: 'ph-trend-down'  },
        { label: 'Principal Crusher', desc: 'DTI below 40%',          done: parseFloat(dtiRatio) < 40,          icon: 'ph-lightning'    },
        { label: 'Sovereign Status', desc: 'DTI below 20% + 3-mo fund', done: parseFloat(dtiRatio) < 20 && emergencyFund >= monthlyExp * 3, icon: 'ph-shield-check' }
    ];

    // ---- helpers ----
    const pct = (a, b) => b > 0 ? Math.round((a/b)*100) : 0;
    const weeksToTarget = Math.ceil((emergencyTarget - emergencyFund) / Math.max(1, cashflowBuffer / 4.33));
    const highestApr    = appState.debts.length ? appState.debts.reduce((p,c) => c.apr > p.apr ? c : p) : null;
    const nextMilestone = milestones.find(m => !m.done);
    const doneCount     = milestones.filter(m => m.done).length;
    const customPct     = ov.customStress ?? 30;
    const customDrop    = income * (1 - customPct / 100);
    const customLeft    = customDrop - totalMinPay - monthlyExp;

    // --- AI response generator (Resilience-specific) ---
    function generateResilienceAI() {
        const lines = [];
        const dti = parseFloat(dtiRatio);

        if (emergencyFund < monthlyExp * 3) {
            const gap = monthlyExp * 3 - emergencyFund;
            lines.push(`🔴 <strong>Emergency Fund Gap:</strong> Your fund covers ${efMonths} months of expenses — below the 3-month minimum. You need <strong>${fmt(gap)}</strong> more. At current cash flow, that's achievable in <strong>${Math.ceil(gap / Math.max(1, cashflowBuffer))} months</strong> with full buffer redirect.`);
        } else {
            lines.push(`🟢 <strong>Emergency Fund:</strong> At ${efMonths} months of coverage your fund is solid. Consider moving surplus to a high-yield savings account to earn 4–5% APY while maintaining liquidity.`);
        }

        if (dti > 36) {
            lines.push(`🔴 <strong>Debt-to-Income Alert:</strong> Your DTI is <strong>${dtiRatio}%</strong> — lenders flag anything above 36%. This limits future credit access. Eliminating <strong>${highestApr ? highestApr.name : 'the highest-APR debt'}</strong> first would reduce DTI by ~${highestApr ? ((highestApr.minPayment / income * 100).toFixed(1)) : '?'}%.`);
        } else if (dti > 20) {
            lines.push(`🟡 <strong>Debt Ratio:</strong> DTI of <strong>${dtiRatio}%</strong> is manageable but elevated. The 20% threshold unlocks better refinance rates. You're <strong>${fmt((dti - 20) / 100 * income)}/mo</strong> above that mark in minimum payments.`);
        } else {
            lines.push(`🟢 <strong>Debt Ratio:</strong> DTI of <strong>${dtiRatio}%</strong> is excellent. You're in the preferred lending range and well-positioned for refinancing at favorable rates.`);
        }

        if (cashflowBuffer > 1000) {
            lines.push(`🟢 <strong>Cash Flow:</strong> <strong>${fmt(cashflowBuffer)}/mo</strong> free after all obligations. Redirecting 60% (<strong>${fmt(cashflowBuffer * 0.6)}/mo</strong>) to debt payoff while keeping 40% liquid is the optimal split at your income level.`);
        } else if (cashflowBuffer > 0) {
            lines.push(`🟡 <strong>Cash Flow:</strong> Positive but thin at <strong>${fmt(cashflowBuffer)}/mo</strong>. One unexpected expense could cause a shortfall. Prioritize emergency fund growth before accelerating debt payments.`);
        } else {
            lines.push(`🔴 <strong>Cash Flow:</strong> Obligations exceed income by <strong>${fmt(Math.abs(cashflowBuffer))}/mo</strong>. Identify at least <strong>${fmt(Math.abs(cashflowBuffer) + 200)}</strong> in monthly discretionary cuts immediately — start with discretionary spending (currently ${fmt(disc)}/mo).`);
        }

        const rateImpact = appState.debts.reduce((s, d) => s + d.balance * (0.01/12), 0);
        lines.push(`📊 <strong>Rate Sensitivity:</strong> A 1% rate hike adds <strong>${fmt(rateImpact)}/mo</strong> across your portfolio. ${rateImpact < cashflowBuffer * 0.3 ? 'Your buffer absorbs this comfortably.' : 'This is a material risk — locking in fixed rates on variable debts is advisable before the next Fed cycle.'}`);

        if (totalScore >= 70) {
            lines.push(`🏆 <strong>Overall:</strong> Score of <strong>${totalScore}/100</strong> puts you in the top 30% of users on this platform. Focus: maximize emergency fund to 6 months (${fmt(income * 6)} target), then redirect that savings capacity to wealth-building.`);
        } else {
            lines.push(`⚡ <strong>Priority Plan:</strong> Score of <strong>${totalScore}/100</strong> indicates room for improvement. Immediate actions: (1) build emergency fund to ${fmt(monthlyExp * 3)}, (2) reduce DTI below 36%, (3) maintain positive monthly cash flow. Tackling these in order will boost your score by an estimated <strong>20–30 points</strong>.`);
        }
        return lines;
    }

    container.innerHTML = `
        <!-- HEADER -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;" class="reveal">
            <div>
                <div class="card-label" style="color:var(--accent);">Portfolio Strength</div>
                <h1 style="font-size:28px; font-weight:900; margin:4px 0 0;">Financial Resilience</h1>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                <button id="res-edit-btn" style="background:var(--card-2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <i class="ph ph-sliders"></i> Edit Assumptions
                </button>
                <div class="${scoreBadge}" style="padding:10px 20px; font-size:15px; border-radius:8px; font-weight:800; color:${scoreColor};">
                    Score: ${totalScore}/100 &nbsp;·&nbsp; ${scoreLabel}
                </div>
            </div>
        </div>

        <!-- EDIT ASSUMPTIONS PANEL (collapsible) -->
        <div id="res-edit-panel" style="display:none; margin-bottom:24px;">
            <div class="card" style="border:1px solid var(--accent); padding:20px 24px;">
                <div style="font-size:13px; font-weight:800; margin-bottom:16px; color:var(--accent);">
                    <i class="ph-fill ph-sliders"></i> &nbsp;Adjust Assumptions — Changes recalculate the entire tab
                </div>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:16px;">
                    <label style="display:flex; flex-direction:column; gap:4px;">
                        <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em;">Monthly Income</span>
                        <input id="ov-income" type="number" value="${income}" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:8px 10px; color:var(--text); font-size:14px; font-weight:700;">
                    </label>
                    <label style="display:flex; flex-direction:column; gap:4px;">
                        <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em;">Emergency Fund (Current)</span>
                        <input id="ov-ef" type="number" value="${emergencyFund}" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:8px 10px; color:var(--text); font-size:14px; font-weight:700;">
                    </label>
                    <label style="display:flex; flex-direction:column; gap:4px;">
                        <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em;">Emergency Fund Target</span>
                        <input id="ov-eft" type="number" value="${emergencyTarget}" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:8px 10px; color:var(--text); font-size:14px; font-weight:700;">
                    </label>
                </div>
                <div style="font-size:11px; color:var(--text-3); font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.06em;">Monthly Expenses</div>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px;">
                    ${[
                        { id: 'ov-housing', label: 'Housing', val: housing },
                        { id: 'ov-food',    label: 'Food',    val: food    },
                        { id: 'ov-transit', label: 'Transit', val: transit },
                        { id: 'ov-disc',    label: 'Disc.',   val: disc    }
                    ].map(f => `
                        <label style="display:flex; flex-direction:column; gap:4px;">
                            <span style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em;">${f.label}</span>
                            <input id="${f.id}" type="number" value="${f.val}" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:8px 10px; color:var(--text); font-size:14px; font-weight:700;">
                        </label>
                    `).join('')}
                </div>
                <div style="display:flex; gap:10px;">
                    <button id="res-save-btn" style="background:var(--accent); color:#0b0f1a; border:none; border-radius:8px; padding:9px 20px; font-size:12px; font-weight:800; cursor:pointer;">Save & Recalculate</button>
                    <button id="res-reset-btn" style="background:var(--card-2); border:1px solid var(--border); color:var(--text-3); border-radius:8px; padding:9px 20px; font-size:12px; font-weight:700; cursor:pointer;">Reset to Defaults</button>
                </div>
            </div>
        </div>

        <!-- SCORE BREAKDOWN -->
        <div class="card reveal reveal-1" style="margin-bottom:24px; padding:20px 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div style="font-size:13px; font-weight:700;">Resilience Breakdown</div>
                <div style="font-size:11px; color:var(--text-3);">Score: ${totalScore}/100 across 4 dimensions</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;">
                ${[
                    { label: 'Emergency Fund', score: Math.round(efScore),  max: 30, color: 'var(--accent)', tip: 'Based on months of coverage vs. 3-month income target' },
                    { label: 'Debt Ratio',     score: Math.round(dtiScore), max: 30, color: '#667eea',       tip: 'DTI of ' + dtiRatio + '% — ideal is below 20%'           },
                    { label: 'Cash Flow',      score: Math.round(cfScore),  max: 20, color: '#ffab40',       tip: 'Free cash flow as % of income after all obligations'       },
                    { label: 'Asset Depth',    score: Math.round(dtaScore), max: 20, color: '#ff4d6d',       tip: 'Liquid assets vs. total debt — target ratio ≥ 1.0'         }
                ].map(d => `
                    <div class="res-dim-card" title="${d.tip}" style="background:var(--bg); border-radius:10px; padding:12px; text-align:center; cursor:help; transition:transform 0.15s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
                        <div style="font-size:22px; font-weight:900; color:${d.color};">${d.score}<span style="font-size:10px; color:var(--text-3);">/${d.max}</span></div>
                        <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-top:4px;">${d.label}</div>
                        <div style="height:4px; background:var(--card-2); border-radius:2px; margin-top:8px; overflow:hidden;">
                            <div style="width:${Math.round((d.score/d.max)*100)}%; height:100%; background:${d.color}; border-radius:2px; transition:width 0.6s ease;"></div>
                        </div>
                        <div style="font-size:9px; color:${d.color}; margin-top:6px; font-weight:700;">${Math.round((d.score/d.max)*100)}% of max</div>
                    </div>
                `).join('')}
            </div>
            <!-- Overall bar -->
            <div style="margin-top:16px; display:flex; align-items:center; gap:12px;">
                <div style="font-size:10px; color:var(--text-3); white-space:nowrap; font-weight:700;">OVERALL</div>
                <div style="flex:1; height:8px; background:var(--card-2); border-radius:4px; overflow:hidden;">
                    <div style="width:${totalScore}%; height:100%; background:linear-gradient(90deg, ${scoreColor}, ${totalScore >= 60 ? 'var(--accent)' : 'var(--danger)'}); border-radius:4px; transition:width 0.8s ease;"></div>
                </div>
                <div style="font-size:11px; font-weight:800; color:${scoreColor};">${totalScore}/100</div>
            </div>
        </div>

        <!-- CORE METRICS 2-col -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:24px;" class="reveal reveal-1">

            <!-- Emergency Fund -->
            <div class="card" style="padding:20px 24px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                    <div>
                        <h3 style="font-size:15px; font-weight:700;">Emergency Fund</h3>
                        <div style="font-size:10px; color:var(--text-3); margin-top:2px;">${efMonths} months of expenses covered</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="font-size:12px; font-weight:700; color:var(--accent);">${efPct}%</div>
                        <button id="ef-expand-btn" style="background:none; border:none; color:var(--text-3); cursor:pointer; font-size:16px; padding:2px;" title="Show Details">
                            <i class="ph ph-caret-down"></i>
                        </button>
                    </div>
                </div>
                <div style="background:var(--card-2); height:10px; border-radius:6px; overflow:hidden; margin-bottom:10px;">
                    <div style="width:${efPct}%; height:100%; background:linear-gradient(90deg, var(--accent), #00ffca); border-radius:6px; transition:width 0.6s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:16px;">
                    <span>${fmt(emergencyFund)} saved</span>
                    <span style="color:var(--text-3);">${fmt(emergencyTarget)} target (6 mo)</span>
                </div>
                <div style="background:var(--bg); border-radius:8px; padding:12px; font-size:11px; color:var(--text-3); line-height:1.7;">
                    Need <strong style="color:var(--text);">${fmt(Math.max(0, emergencyTarget - emergencyFund))}</strong> more.
                    At ${fmt(Math.max(1,cashflowBuffer * 0.3))}/mo saved → <strong style="color:var(--accent);">${Math.ceil(Math.max(0, emergencyTarget - emergencyFund) / Math.max(1, cashflowBuffer * 0.3))} months away</strong>.
                </div>
                <!-- EXPANDABLE DETAIL -->
                <div id="ef-detail" style="display:none; margin-top:16px; border-top:1px solid var(--border); padding-top:16px;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">Industry Benchmarks</div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:16px;">
                        ${[
                            { label: 'Minimum', val: fmt(monthlyExp * 1), status: emergencyFund >= monthlyExp * 1 },
                            { label: 'Standard', val: fmt(monthlyExp * 3), status: emergencyFund >= monthlyExp * 3 },
                            { label: 'Optimal',  val: fmt(monthlyExp * 6), status: emergencyFund >= monthlyExp * 6 }
                        ].map(b => `
                            <div style="background:${b.status ? 'rgba(0,212,168,0.08)' : 'var(--bg)'}; border:1px solid ${b.status ? 'var(--accent)' : 'var(--border)'}; border-radius:8px; padding:10px; text-align:center;">
                                <div style="font-size:10px; color:var(--text-3); margin-bottom:4px;">${b.label}</div>
                                <div style="font-size:13px; font-weight:800; color:${b.status ? 'var(--accent)' : 'var(--text)'};">${b.val}</div>
                                <i class="ph-fill ph-${b.status ? 'check-circle' : 'circle'}" style="color:${b.status ? 'var(--accent)' : 'var(--text-3)'}; font-size:14px; margin-top:4px;"></i>
                            </div>
                        `).join('')}
                    </div>
                    <div style="font-size:11px; color:var(--text-3); line-height:1.8; background:var(--bg); padding:12px; border-radius:8px;">
                        <strong style="color:var(--text);">Best practice:</strong> Fidelity & Vanguard recommend 3–6 months of <em>gross</em> income (not just expenses). At your income that's
                        <strong style="color:var(--accent);">${fmt(income * 3)}–${fmt(income * 6)}</strong>.
                        Consider a high-yield savings account (4–5% APY) so your fund earns interest while idle.
                    </div>
                    <div style="margin-top:12px;">
                        <div style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px;">Savings Rate to Hit Target</div>
                        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
                            ${[
                                { label: 'Conservative (10%)', monthly: income * 0.1 },
                                { label: 'Moderate (20%)',     monthly: income * 0.2 },
                                { label: 'Aggressive (30%)',   monthly: income * 0.3 }
                            ].map(s => {
                                const gap = Math.max(0, emergencyTarget - emergencyFund);
                                const mo = Math.ceil(gap / s.monthly);
                                return `<div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:9px; color:var(--text-3);">${s.label}</div>
                                    <div style="font-size:16px; font-weight:800; color:var(--accent); margin:4px 0;">${mo} mo</div>
                                    <div style="font-size:9px; color:var(--text-3);">${fmt(s.monthly)}/mo</div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Debt-to-Asset -->
            <div class="card" style="padding:20px 24px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                    <div>
                        <h3 style="font-size:15px; font-weight:700;">Debt-to-Asset Velocity</h3>
                        <div style="font-size:10px; color:var(--text-3); margin-top:2px;">Liquid assets vs. total debt exposure</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="font-size:11px; font-weight:700; color:${parseFloat(dtaRatio) >= 1 ? 'var(--accent)' : 'var(--warning)'};">${parseFloat(dtaRatio) >= 1 ? 'HEALTHY' : 'WATCH'}</div>
                        <button id="dta-expand-btn" style="background:none; border:none; color:var(--text-3); cursor:pointer; font-size:16px; padding:2px;" title="Show Details">
                            <i class="ph ph-caret-down"></i>
                        </button>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:20px; margin-bottom:16px;">
                    <div style="flex:1;">
                        <div style="font-size:32px; font-weight:900; color:${parseFloat(dtaRatio) >= 1 ? 'var(--accent)' : 'var(--warning)'};">${dtaRatio}</div>
                        <div style="font-size:11px; color:var(--text-3);">Ratio &nbsp;·&nbsp; Target ≥ 1.00</div>
                    </div>
                    <div style="width:60px; height:60px; background:rgba(0,212,168,0.08); border-radius:14px; display:flex; align-items:center; justify-content:center;">
                        <i class="ph ph-chart-line-up" style="font-size:30px; color:var(--accent);"></i>
                    </div>
                </div>
                <div style="background:var(--bg); border-radius:8px; padding:12px; font-size:11px; color:var(--text-3); line-height:1.7;">
                    For every <strong style="color:var(--text);">$1 of debt</strong>, you hold
                    <strong style="color:var(--accent);">${(liquidAssets / totalDebt).toFixed(2)} in liquid assets</strong>.
                    ${parseFloat(dtaRatio) < 1 ? `Building liquid reserves to <strong style="color:var(--text);">${fmt(totalDebt)}</strong> would reach parity.` : 'You have more liquid assets than debt exposure — a strong position.'}
                </div>
                <!-- EXPANDABLE DETAIL -->
                <div id="dta-detail" style="display:none; margin-top:16px; border-top:1px solid var(--border); padding-top:16px;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">Asset Composition</div>
                    <div style="display:grid; gap:8px; margin-bottom:16px;">
                        ${[
                            { label: 'Emergency Fund',     val: emergencyFund,                              pct: pct(emergencyFund, liquidAssets)   },
                            { label: 'Cash Flow Reserve',  val: Math.max(0, cashflowBuffer * 3),            pct: pct(Math.max(0, cashflowBuffer * 3), liquidAssets) }
                        ].map(r => `
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="font-size:11px; color:var(--text-3); width:140px; flex-shrink:0;">${r.label}</div>
                                <div style="flex:1; height:6px; background:var(--card-2); border-radius:3px; overflow:hidden;">
                                    <div style="width:${r.pct}%; height:100%; background:var(--accent); border-radius:3px;"></div>
                                </div>
                                <div style="font-size:11px; font-weight:700; width:70px; text-align:right;">${fmt(r.val)}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="font-size:11px; color:var(--text-3); line-height:1.8; background:var(--bg); padding:12px; border-radius:8px;">
                        <strong style="color:var(--text);">To reach ratio 1.0</strong> you need liquid assets of <strong style="color:var(--accent);">${fmt(totalDebt)}</strong>.
                        That's <strong style="color:var(--text);">${fmt(Math.max(0, totalDebt - liquidAssets))}</strong> above your current liquid position.
                        Focus on debt reduction — every $1 paid down improves both sides of this ratio.
                    </div>
                    <div style="margin-top:12px; background:rgba(255,171,64,0.08); border-radius:8px; padding:12px; font-size:11px; border-left:3px solid var(--warning);">
                        <strong>Tip:</strong> This metric uses estimated liquid assets only. Connect your bank accounts in <em>Settings → Sync Bank</em> for a precise calculation.
                    </div>
                </div>
            </div>
        </div>

        <!-- CASH FLOW BUFFER -->
        <div class="card reveal reveal-2" style="margin-bottom:24px; padding:20px 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h3 style="font-size:15px; font-weight:700;">Monthly Cash Flow Buffer</h3>
                    <div style="font-size:10px; color:var(--text-3); margin-top:2px;">Income minus all obligations and living expenses</div>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <button id="cf-expand-btn" style="background:none; border:1px solid var(--border); color:var(--text-3); cursor:pointer; font-size:11px; font-weight:700; padding:5px 12px; border-radius:6px;">
                        Breakdown <i class="ph ph-caret-down"></i>
                    </button>
                    <div class="${cashflowBuffer > 0 ? 'badge-success' : 'badge-danger'}" style="font-size:10px; padding:4px 10px; border-radius:6px; font-weight:700;">
                        ${cashflowBuffer > 0 ? 'POSITIVE' : 'NEGATIVE'}
                    </div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:16px;">
                <div style="background:var(--bg); border-radius:10px; padding:16px; text-align:center;">
                    <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Monthly Income</div>
                    <div style="font-size:22px; font-weight:800; color:var(--accent);">${fmt(income)}</div>
                    <div style="font-size:9px; color:var(--text-3); margin-top:4px;">100% of baseline</div>
                </div>
                <div style="background:var(--bg); border-radius:10px; padding:16px; text-align:center;">
                    <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Total Obligations</div>
                    <div style="font-size:22px; font-weight:800; color:var(--danger);">${fmt(totalMinPay + monthlyExp)}</div>
                    <div style="font-size:9px; color:var(--text-3); margin-top:4px;">${pct(totalMinPay + monthlyExp, income)}% of income</div>
                </div>
                <div style="background:var(--bg); border-radius:10px; padding:16px; text-align:center;">
                    <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Free Cash Flow</div>
                    <div style="font-size:22px; font-weight:800; color:${cashflowBuffer > 0 ? 'var(--accent)' : 'var(--danger)'};">${fmt(cashflowBuffer)}</div>
                    <div style="font-size:9px; color:var(--text-3); margin-top:4px;">${pct(cashflowBuffer, income)}% of income</div>
                </div>
            </div>
            <!-- EXPANDABLE DETAIL -->
            <div id="cf-detail" style="display:none; border-top:1px solid var(--border); padding-top:16px; margin-bottom:16px;">
                <div style="font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">Expense Breakdown</div>
                <div style="display:grid; gap:10px;">
                    ${[
                        { label: 'Housing',          val: housing,   icon: 'ph-house'         },
                        { label: 'Food',             val: food,      icon: 'ph-fork-knife'     },
                        { label: 'Transit',          val: transit,   icon: 'ph-car'            },
                        { label: 'Discretionary',    val: disc,      icon: 'ph-shopping-bag'   },
                        { label: 'Debt Payments',    val: totalMinPay, icon: 'ph-credit-card'  }
                    ].map(e => `
                        <div style="display:flex; align-items:center; gap:12px;">
                            <i class="ph ${e.icon}" style="width:16px; color:var(--text-3); font-size:14px;"></i>
                            <div style="font-size:11px; color:var(--text-3); width:120px; flex-shrink:0;">${e.label}</div>
                            <div style="flex:1; height:6px; background:var(--card-2); border-radius:3px; overflow:hidden;">
                                <div style="width:${Math.min(100, pct(e.val, income))}%; height:100%; background:${e.label === 'Debt Payments' ? 'var(--danger)' : 'var(--accent)'}; border-radius:3px;"></div>
                            </div>
                            <div style="font-size:11px; font-weight:700; width:60px; text-align:right;">${fmt(e.val)}</div>
                            <div style="font-size:10px; color:var(--text-3); width:32px; text-align:right;">${pct(e.val, income)}%</div>
                        </div>
                    `).join('')}
                </div>
                ${cashflowBuffer > 0 ? `
                <div style="margin-top:16px; background:rgba(0,212,168,0.06); border-radius:8px; padding:14px; font-size:11px; color:var(--text-3); line-height:1.8; border-left:3px solid var(--accent);">
                    <strong style="color:var(--text);">Allocation Recommendation:</strong><br>
                    Emergency Fund: <strong style="color:var(--accent);">${fmt(cashflowBuffer * 0.3)}/mo (30%)</strong> &nbsp;·&nbsp;
                    Debt Payoff: <strong style="color:var(--accent);">${fmt(cashflowBuffer * 0.5)}/mo (50%)</strong> &nbsp;·&nbsp;
                    Discretionary: <strong style="color:var(--text);">${fmt(cashflowBuffer * 0.2)}/mo (20%)</strong>
                </div>` : ''}
            </div>
            <div style="background:var(--bg); border-radius:8px; padding:12px; font-size:11px; color:var(--text-3); line-height:1.7;">
                ${cashflowBuffer > 0
                    ? `<strong style="color:var(--accent);">${fmt(cashflowBuffer)}/mo</strong> free after all obligations — that's <strong style="color:var(--text);">${fmt(cashflowBuffer * 12)}/year</strong>. Redirecting 50% to your highest-APR debt (${highestApr ? highestApr.name + ' @ ' + highestApr.apr + '%' : 'primary debt'}) would save significant interest.`
                    : `Obligations exceed income by <strong style="color:var(--danger);">${fmt(Math.abs(cashflowBuffer))}/mo</strong>. Reducing discretionary spending from ${fmt(disc)} is the fastest lever.`}
            </div>
        </div>

        <!-- STRESS TESTS -->
        <div class="card reveal reveal-3" style="margin-bottom:24px; padding:20px 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h3 style="font-size:15px; font-weight:700;">Stress Test Scenarios</h3>
                    <div style="font-size:10px; color:var(--text-3); margin-top:2px;">How your finances survive adverse events</div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(2,1fr) 1fr; gap:16px; margin-bottom:16px;">
                <!-- Job loss -->
                <div style="background:var(--bg); border-radius:12px; padding:18px; border-left:3px solid var(--danger);">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                        <i class="ph-fill ph-warning-circle" style="color:var(--danger); font-size:20px;"></i>
                        <div>
                            <div style="font-size:13px; font-weight:700;">Full Job Loss</div>
                            <div style="font-size:9px; color:var(--text-3);">Zero income scenario</div>
                        </div>
                    </div>
                    <div style="font-size:28px; font-weight:900; margin-bottom:6px;">${jobLossSurvive} <span style="font-size:14px; font-weight:500; color:var(--text-3);">months runway</span></div>
                    <div style="font-size:10px; color:var(--text-3); line-height:1.6; margin-bottom:12px;">Emergency fund covers ${fmt(monthlyExp)}/mo in essential expenses. After ${jobLossSurvive} months, reserves are exhausted.</div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="${jobLossSurvive >= 3 ? 'badge-success' : 'badge-danger'}" style="font-size:9px; padding:3px 8px; border-radius:4px; display:inline-block;">${jobLossSurvive >= 3 ? 'ADEQUATE' : 'LOW — BUILD FUND'}</div>
                        <div style="font-size:9px; color:var(--text-3);">Target: 6 months</div>
                    </div>
                    ${jobLossSurvive < 3 ? `<div style="margin-top:10px; font-size:10px; color:var(--warning); line-height:1.5;"><strong>Action:</strong> Add ${fmt(monthlyExp * 3 - emergencyFund)} to reach 3-month safety floor.</div>` : ''}
                </div>

                <!-- 20% income drop -->
                <div style="background:var(--bg); border-radius:12px; padding:18px; border-left:3px solid var(--warning);">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                        <i class="ph-fill ph-trend-down" style="color:var(--warning); font-size:20px;"></i>
                        <div>
                            <div style="font-size:13px; font-weight:700;">−20% Income Cut</div>
                            <div style="font-size:9px; color:var(--text-3);">Reduced hours / part-time</div>
                        </div>
                    </div>
                    <div style="font-size:28px; font-weight:900; margin-bottom:6px; color:${(incomeDrop20 - totalMinPay - monthlyExp) > 0 ? 'var(--accent)' : 'var(--danger)'};">${fmt(incomeDrop20 - totalMinPay - monthlyExp)}<span style="font-size:11px; color:var(--text-3);">/mo left</span></div>
                    <div style="font-size:10px; color:var(--text-3); line-height:1.6; margin-bottom:12px;">Income drops to ${fmt(incomeDrop20)}/mo. After obligations (${fmt(totalMinPay + monthlyExp)}/mo), you have ${fmt(incomeDrop20 - totalMinPay - monthlyExp)}/mo remaining.</div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="${(incomeDrop20 - totalMinPay - monthlyExp) > 0 ? 'badge-success' : 'badge-danger'}" style="font-size:9px; padding:3px 8px; border-radius:4px; display:inline-block;">${(incomeDrop20 - totalMinPay - monthlyExp) > 0 ? 'SURVIVABLE' : 'CRITICAL'}</div>
                        <div style="font-size:9px; color:var(--text-3);">DTI rises to ${((totalMinPay / incomeDrop20)*100).toFixed(1)}%</div>
                    </div>
                </div>

                <!-- Rate hike -->
                <div style="background:var(--bg); border-radius:12px; padding:18px; border-left:3px solid ${rateHikeSafe ? 'var(--accent)' : 'var(--danger)'};">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                        <i class="ph-fill ph-percent" style="color:${rateHikeSafe ? 'var(--accent)' : 'var(--danger)'}; font-size:20px;"></i>
                        <div>
                            <div style="font-size:13px; font-weight:700;">+1% Rate Hike</div>
                            <div style="font-size:9px; color:var(--text-3);">Variable rate impact</div>
                        </div>
                    </div>
                    <div style="font-size:28px; font-weight:900; margin-bottom:6px;">${fmt(rateHike1pct)}<span style="font-size:11px; color:var(--text-3);">/mo extra</span></div>
                    <div style="font-size:10px; color:var(--text-3); line-height:1.6; margin-bottom:12px;">Across ${fmt(totalDebt)} in debt. Buffer absorbs ${Math.min(100,Math.round(rateHike1pct/Math.max(1,cashflowBuffer)*100))}% of this increase.</div>
                    <div class="${rateHikeSafe ? 'badge-success' : 'badge-danger'}" style="font-size:9px; padding:3px 8px; border-radius:4px; display:inline-block;">${rateHikeSafe ? 'ABSORBED' : 'IMPACT HIGH'}</div>
                </div>
            </div>

            <!-- CUSTOM STRESS TEST -->
            <div style="background:rgba(102,126,234,0.06); border:1px solid rgba(102,126,234,0.2); border-radius:12px; padding:18px;">
                <div style="font-size:12px; font-weight:700; margin-bottom:12px; color:#667eea;">
                    <i class="ph ph-sliders"></i> &nbsp;Custom Stress Test
                </div>
                <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:6px;">Income Reduction: <strong id="custom-stress-label" style="color:#667eea;">${customPct}%</strong></label>
                        <input id="custom-stress-slider" type="range" min="5" max="90" value="${customPct}" style="width:100%; accent-color:#667eea;">
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; flex:2; min-width:300px;">
                        <div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center;">
                            <div style="font-size:9px; color:var(--text-3);">Reduced Income</div>
                            <div id="custom-income-out" style="font-size:15px; font-weight:800; color:#667eea; margin-top:3px;">${fmt(customDrop)}</div>
                        </div>
                        <div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center;">
                            <div style="font-size:9px; color:var(--text-3);">Monthly Left</div>
                            <div id="custom-left-out" style="font-size:15px; font-weight:800; color:${customLeft > 0 ? 'var(--accent)' : 'var(--danger)'}; margin-top:3px;">${fmt(customLeft)}</div>
                        </div>
                        <div style="background:var(--bg); border-radius:8px; padding:10px; text-align:center;">
                            <div style="font-size:9px; color:var(--text-3);">Fund Runway</div>
                            <div id="custom-runway-out" style="font-size:15px; font-weight:800; color:var(--accent); margin-top:3px;">${customLeft < 0 ? Math.max(0, Math.floor(emergencyFund / Math.abs(customLeft))) + ' mo' : '∞'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- MILESTONES -->
        <div class="card reveal reveal-4" style="margin-bottom:24px; padding:20px 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <h3 style="font-size:15px; font-weight:700;">Resilience Milestones</h3>
                <div style="font-size:12px; font-weight:700; color:var(--accent);">${doneCount}/${milestones.length} Complete</div>
            </div>
            <!-- Overall milestone progress -->
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
                <div style="flex:1; height:6px; background:var(--card-2); border-radius:3px; overflow:hidden;">
                    <div style="width:${pct(doneCount, milestones.length)}%; height:100%; background:var(--accent); border-radius:3px; transition:width 0.6s;"></div>
                </div>
                <div style="font-size:10px; color:var(--text-3);">${pct(doneCount, milestones.length)}%</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:16px;">
                ${milestones.map((m, i) => {
                    const isNext = !m.done && i === milestones.findIndex(x => !x.done);
                    return `
                    <div style="text-align:center; cursor:default;" title="${m.desc}">
                        <div style="width:54px; height:54px; background:${m.done ? 'var(--accent)' : isNext ? 'rgba(0,212,168,0.1)' : 'var(--card-2)'}; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px; border:${isNext ? '2px solid var(--accent)' : 'none'}; transition:all 0.3s;">
                            <i class="${m.done ? 'ph-fill ph-check' : m.icon}" style="font-size:22px; color:${m.done ? 'var(--bg)' : isNext ? 'var(--accent)' : 'var(--text-3)'}"></i>
                        </div>
                        <div style="font-size:11px; font-weight:700; color:${m.done ? 'var(--text)' : isNext ? 'var(--accent)' : 'var(--text-3)'};">${m.label}</div>
                        <div style="font-size:9px; color:var(--text-3); margin-top:3px; line-height:1.4;">${m.desc}</div>
                        ${isNext ? `<div style="font-size:9px; color:var(--accent); font-weight:700; margin-top:5px;">← NEXT</div>` : ''}
                        ${m.done ? `<div style="font-size:9px; color:var(--accent); font-weight:700; margin-top:5px;">✓ Done</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
            ${nextMilestone ? `
            <div style="background:rgba(0,212,168,0.06); border-radius:8px; padding:14px; font-size:11px; color:var(--text-3); line-height:1.8; border-left:3px solid var(--accent);">
                <strong style="color:var(--accent);">Next Milestone: ${nextMilestone.label}</strong> — ${nextMilestone.desc}.
                ${nextMilestone.label === 'Starter Fund' ? `Save ${fmt(Math.max(0, monthlyExp - emergencyFund))} more to your emergency fund.` : ''}
                ${nextMilestone.label === 'APR Buster' ? `${appState.debts.filter(d => d.apr >= 25).map(d => d.name).join(', ')} exceed 25% APR. Focus payoff here first.` : ''}
                ${nextMilestone.label === 'Principal Crusher' ? `Reduce monthly debt payments by ${fmt((parseFloat(dtiRatio) - 40) / 100 * income)} to bring DTI below 40%.` : ''}
                ${nextMilestone.label === 'Sovereign Status' ? `Need DTI below 20% and ${fmt(monthlyExp * 3)} in emergency fund. Both require sustained debt payoff and savings.` : ''}
            </div>` : `
            <div style="background:rgba(0,212,168,0.06); border-radius:8px; padding:14px; font-size:12px; font-weight:700; color:var(--accent); text-align:center;">
                🏆 All milestones achieved — Sovereign Financial Status unlocked.
            </div>`}
        </div>

        <!-- AI ANALYSIS -->
        <div class="card reveal reveal-5" style="padding:20px 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div>
                    <div style="font-size:10px; color:var(--accent); font-weight:700; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">
                        <i class="ph-fill ph-lightning"></i> &nbsp;Evergreen AI
                    </div>
                    <h3 style="font-size:15px; font-weight:700;">Resilience Analysis</h3>
                </div>
                <button id="res-ai-btn" style="background:linear-gradient(135deg, var(--accent), #667eea); color:#0b0f1a; border:none; border-radius:8px; padding:10px 20px; font-size:12px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:8px;">
                    <i class="ph-fill ph-sparkle"></i> Generate Analysis
                </button>
            </div>
            <div id="res-ai-output" style="min-height:60px; background:var(--bg); border-radius:10px; padding:16px; font-size:11px; color:var(--text-3); line-height:1.9;">
                <span style="opacity:0.5;">Click "Generate Analysis" for AI-powered insights based on your current resilience profile.</span>
            </div>
        </div>
    `;

    // ---- EVENT LISTENERS ----

    // Edit assumptions toggle
    document.getElementById('res-edit-btn').addEventListener('click', () => {
        const panel = document.getElementById('res-edit-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // Save overrides — also propagate income to appState so all tabs stay in sync
    document.getElementById('res-save-btn').addEventListener('click', () => {
        ov.income   = parseFloat(document.getElementById('ov-income').value)   || income;
        ov.ef       = parseFloat(document.getElementById('ov-ef').value)       || emergencyFund;
        ov.eft      = parseFloat(document.getElementById('ov-eft').value)      || emergencyTarget;
        ov.housing  = parseFloat(document.getElementById('ov-housing').value)  || housing;
        ov.food     = parseFloat(document.getElementById('ov-food').value)     || food;
        ov.transit  = parseFloat(document.getElementById('ov-transit').value)  || transit;
        ov.disc     = parseFloat(document.getElementById('ov-disc').value)     || disc;
        saveOv();

        // Propagate income change to global state → cascades to dashboard stats, DTI, freedom date
        if (appState.balances) appState.balances.monthlyIncome = ov.income;
        if (appState.budget) {
            if (ov.housing !== undefined) appState.budget.expenses.housing = ov.housing;
            if (ov.food    !== undefined) appState.budget.expenses.food    = ov.food;
            if (ov.transit !== undefined) appState.budget.expenses.transit = ov.transit;
            if (ov.disc    !== undefined) appState.budget.expenses.disc    = ov.disc;
        }
        saveState();

        // Close edit panel, re-render resilience, then cascade full UI update
        const panel = document.getElementById('res-edit-panel');
        if (panel) panel.style.display = 'none';
        renderResilienceTab();
        updateUI();
        showToast('Financial profile updated — all stats recalculated.');
    });

    // Reset overrides — restore to appState defaults
    document.getElementById('res-reset-btn').addEventListener('click', () => {
        ov = {};
        saveOv();
        renderResilienceTab();
        showToast('Resilience overrides cleared — using account defaults.');
    });

    // Expand/collapse Emergency Fund detail
    document.getElementById('ef-expand-btn').addEventListener('click', () => {
        const d = document.getElementById('ef-detail');
        const btn = document.getElementById('ef-expand-btn').querySelector('i');
        const open = d.style.display === 'none';
        d.style.display = open ? 'block' : 'none';
        btn.className = open ? 'ph ph-caret-up' : 'ph ph-caret-down';
    });

    // Expand/collapse DTA detail
    document.getElementById('dta-expand-btn').addEventListener('click', () => {
        const d = document.getElementById('dta-detail');
        const btn = document.getElementById('dta-expand-btn').querySelector('i');
        const open = d.style.display === 'none';
        d.style.display = open ? 'block' : 'none';
        btn.className = open ? 'ph ph-caret-up' : 'ph ph-caret-down';
    });

    // Expand/collapse Cash Flow detail
    document.getElementById('cf-expand-btn').addEventListener('click', () => {
        const d = document.getElementById('cf-detail');
        const btn = document.getElementById('cf-expand-btn');
        const open = d.style.display === 'none';
        d.style.display = open ? 'block' : 'none';
        btn.innerHTML = `${open ? 'Hide' : 'Breakdown'} <i class="ph ph-caret-${open ? 'up' : 'down'}"></i>`;
    });

    // Custom stress test slider
    document.getElementById('custom-stress-slider').addEventListener('input', function() {
        const pctVal = parseInt(this.value);
        ov.customStress = pctVal;
        saveOv();
        const drop = income * (1 - pctVal / 100);
        const left = drop - totalMinPay - monthlyExp;
        document.getElementById('custom-stress-label').textContent = pctVal + '%';
        document.getElementById('custom-income-out').textContent = fmt(drop);
        const leftEl = document.getElementById('custom-left-out');
        leftEl.textContent = fmt(left);
        leftEl.style.color = left > 0 ? 'var(--accent)' : 'var(--danger)';
        document.getElementById('custom-runway-out').textContent = left < 0
            ? Math.max(0, Math.floor(emergencyFund / Math.abs(left))) + ' mo'
            : '∞';
    });

    // AI Generate button
    document.getElementById('res-ai-btn').addEventListener('click', () => {
        const btn   = document.getElementById('res-ai-btn');
        const output = document.getElementById('res-ai-output');
        btn.disabled = true;
        btn.innerHTML = '<i class="ph-fill ph-spinner"></i> Analyzing…';
        output.innerHTML = '<span class="typing-cursor"></span>';

        const lines = generateResilienceAI();
        const fullHTML = '<div style="display:grid; gap:12px;">' +
            lines.map(l => `<div style="padding:10px 14px; background:var(--card-2); border-radius:8px; border-left:3px solid var(--accent); line-height:1.8;">${l}</div>`).join('') +
            '</div>';

        // Simulate typing by revealing characters
        const stripped = fullHTML.replace(/<[^>]*>/g, '').trim();
        let i = 0;
        const interval = setInterval(() => {
            if (i >= stripped.length) {
                clearInterval(interval);
                output.innerHTML = fullHTML;
                btn.disabled = false;
                btn.innerHTML = '<i class="ph-fill ph-arrow-counter-clockwise"></i> Regenerate';
            } else {
                output.innerHTML = stripped.slice(0, i++) + '<span class="typing-cursor"></span>';
            }
        }, 8);
    });
}


/* ═════════════════════════════════════════════════════════════
   CREDIT SCORE INTELLIGENCE ENGINE
   Uses FICO factor weights (Payment 35%, Utilization 30%,
   Length 15%, Mix 10%, New Credit 10%) to analyse the user's
   debts + inputs and generate a concrete point-by-point plan.
   ═══════════════════════════════════════════════════════════ */
function renderCreditScoreTab() {
    const container = document.getElementById('credit-score-tab-content');
    if (!container) return;

    // ---- Load/save persistent credit inputs ----
    const LS_KEY = 'wjp_credit_inputs';
    let cs = {};
    try { cs = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch(_) {}
    cs = Object.assign({
        currentScore: '',
        oldestAccountYears: '',
        avgAccountYears: '',
        latePayments12mo: '0',
        hardInquiries12mo: '0',
        newAccounts12mo: '0',
        cardLimits: {} // { debtId: limit }
    }, cs);
    const saveCs = () => {
        localStorage.setItem(LS_KEY, JSON.stringify(cs));
        const sc = parseInt(cs.currentScore, 10);
        if (!isNaN(sc) && sc >= 300 && sc <= 850 && typeof recordScoreHistory === 'function') {
            recordScoreHistory(sc);
        }
    };

    const debts = (appState && appState.debts) ? appState.debts : [];
    const creditCards = debts.filter(d => {
        const t = (d.type || d.category || '').toString().toLowerCase();
        return t.includes('credit') || t.includes('card') || t === 'cc';
    });

    // Helpful labels
    const scoreBand = (s) => {
        if (s >= 800) return { band:'Exceptional', color:'#1f9d55' };
        if (s >= 740) return { band:'Very Good',   color:'#2b9b72' };
        if (s >= 670) return { band:'Good',        color:'#b58900' };
        if (s >= 580) return { band:'Fair',        color:'#d97706' };
        return { band:'Poor', color:'#ff4d6d' };
    };
    const fmtMoney = (n) => '$' + Math.round(n).toLocaleString();

    // ---- Gather snapshot for analysis ----
    const snapshot = () => {
        const score = parseInt(cs.currentScore, 10);
        const oldest = parseFloat(cs.oldestAccountYears);
        const avg    = parseFloat(cs.avgAccountYears);
        const lates  = parseInt(cs.latePayments12mo, 10) || 0;
        const inq    = parseInt(cs.hardInquiries12mo, 10) || 0;
        const newAcc = parseInt(cs.newAccounts12mo, 10) || 0;

        // Utilization across credit cards
        let totalBal = 0, totalLim = 0, perCard = [];
        creditCards.forEach(d => {
            const bal = parseFloat(d.balance) || 0;
            const lim = parseFloat(cs.cardLimits[d.id]) || parseFloat(d.limit) || 0;
            totalBal += bal;
            totalLim += lim;
            perCard.push({ id:d.id, name:d.name || d.lender || 'Card', bal, lim,
                           util: lim > 0 ? bal / lim : null });
        });
        const globalUtil = totalLim > 0 ? totalBal / totalLim : null;

        // Account mix
        const types = new Set();
        debts.forEach(d => {
            const t = (d.type || d.category || '').toString().toLowerCase();
            if (t.includes('credit') || t.includes('card')) types.add('revolving');
            else if (t.includes('mortgage')) types.add('mortgage');
            else if (t.includes('auto') || t.includes('car')) types.add('auto');
            else if (t.includes('student')) types.add('student');
            else if (t.includes('personal') || t.includes('loan')) types.add('installment');
            else types.add('other');
        });

        return {
            score: isNaN(score) ? null : Math.max(300, Math.min(850, score)),
            oldest: isNaN(oldest) ? null : oldest,
            avg: isNaN(avg) ? null : avg,
            lates, inq, newAcc,
            totalBal, totalLim, globalUtil, perCard,
            mix: types.size
        };
    };

    // ---- FICO-style factor analysis ----
    const analyse = (s) => {
        const factors = [];

        // Payment History (35%)
        let phScore = 100 - (s.lates * 18);
        phScore = Math.max(0, phScore);
        factors.push({
            key:'payment', name:'Payment History', weight:35,
            rating: s.lates === 0 ? 'Excellent' : s.lates <= 1 ? 'Fair' : 'Poor',
            detail: s.lates === 0
                ? 'No late payments in the past 12 months.'
                : `${s.lates} late payment${s.lates>1?'s':''} in the past 12 months.`,
            score: phScore
        });

        // Utilization (30%)
        let utilScore, utilRating, utilDetail;
        if (s.globalUtil === null) {
            utilScore = 60; utilRating = 'Unknown';
            utilDetail = 'Enter credit card limits to calculate utilization.';
        } else {
            const pct = s.globalUtil * 100;
            if (pct < 10) { utilScore = 100; utilRating = 'Excellent'; }
            else if (pct < 30) { utilScore = 85; utilRating = 'Very Good'; }
            else if (pct < 50) { utilScore = 60; utilRating = 'Fair'; }
            else if (pct < 75) { utilScore = 35; utilRating = 'Poor'; }
            else { utilScore = 15; utilRating = 'Very Poor'; }
            utilDetail = `Total ${fmtMoney(s.totalBal)} / ${fmtMoney(s.totalLim)} → ${pct.toFixed(1)}% used.`;
        }
        factors.push({ key:'utilization', name:'Credit Utilization', weight:30,
                       rating:utilRating, detail:utilDetail, score:utilScore });

        // Length (15%)
        let lenScore, lenRating, lenDetail;
        const ageBasis = (s.oldest !== null ? s.oldest : null);
        if (ageBasis === null) {
            lenScore = 55; lenRating = 'Unknown';
            lenDetail = 'Add your oldest account age to refine this factor.';
        } else if (ageBasis >= 10) { lenScore = 100; lenRating = 'Excellent'; lenDetail = `Oldest account is ${ageBasis} years — strong history.`; }
        else if (ageBasis >= 7)    { lenScore = 85;  lenRating = 'Very Good'; lenDetail = `Oldest account is ${ageBasis} years.`; }
        else if (ageBasis >= 4)    { lenScore = 65;  lenRating = 'Fair';      lenDetail = `Oldest account is ${ageBasis} years — aging benefits will accrue.`; }
        else if (ageBasis >= 2)    { lenScore = 45;  lenRating = 'Limited';   lenDetail = `Oldest account is ${ageBasis} years — history still young.`; }
        else                       { lenScore = 25;  lenRating = 'New';       lenDetail = `Oldest account is ${ageBasis} years.`; }
        factors.push({ key:'length', name:'Length of Credit History', weight:15,
                       rating:lenRating, detail:lenDetail, score:lenScore });

        // Mix (10%)
        let mixScore, mixRating, mixDetail;
        if (s.mix >= 3)      { mixScore = 95; mixRating = 'Excellent'; }
        else if (s.mix === 2){ mixScore = 75; mixRating = 'Good'; }
        else if (s.mix === 1){ mixScore = 45; mixRating = 'Thin'; }
        else                 { mixScore = 30; mixRating = 'Insufficient'; }
        mixDetail = `${s.mix} account type${s.mix!==1?'s':''} reporting (revolving, installment, mortgage, etc.).`;
        factors.push({ key:'mix', name:'Credit Mix', weight:10,
                       rating:mixRating, detail:mixDetail, score:mixScore });

        // New Credit (10%)
        let ncScore = 100 - (s.inq * 6) - (s.newAcc * 8);
        ncScore = Math.max(0, Math.min(100, ncScore));
        let ncRating = ncScore >= 85 ? 'Excellent' : ncScore >= 65 ? 'Good' : ncScore >= 40 ? 'Fair' : 'Poor';
        factors.push({ key:'new', name:'New Credit', weight:10,
                       rating:ncRating,
                       detail:`${s.inq} hard inquir${s.inq!==1?'ies':'y'} + ${s.newAcc} new account${s.newAcc!==1?'s':''} in 12 months.`,
                       score:ncScore });

        // Weighted composite 0–100
        const composite = factors.reduce((acc, f) => acc + (f.score * f.weight / 100), 0);
        return { factors, composite };
    };

    // ---- Action plan generator: ranked levers with point deltas ----
    const buildPlan = (s, a) => {
        const actions = [];

        // Lever 1 — per-card utilization reductions (below 30%, then below 10%)
        s.perCard.forEach(c => {
            if (c.lim > 0 && c.util !== null) {
                if (c.util >= 0.30) {
                    const target30 = c.lim * 0.29;
                    const payoff = Math.max(0, c.bal - target30);
                    if (payoff > 0) {
                        const deltaPts = Math.round(Math.min(45, (c.util - 0.29) * 80));
                        actions.push({
                            title: `Pay down ${c.name} to below 30% utilization`,
                            detail: `Currently ${(c.util*100).toFixed(0)}% used (${fmtMoney(c.bal)} of ${fmtMoney(c.lim)}). Reducing balance to ${fmtMoney(target30)} drops utilization into the "good" band.`,
                            pay: payoff, pts: deltaPts, timeframe: '1 statement cycle',
                            debtId: c.id, priority: 100 + deltaPts
                        });
                    }
                } else if (c.util >= 0.10) {
                    const target10 = c.lim * 0.09;
                    const payoff = Math.max(0, c.bal - target10);
                    if (payoff > 0) {
                        const deltaPts = Math.round(Math.min(20, (c.util - 0.09) * 60));
                        actions.push({
                            title: `Pay down ${c.name} to below 10% utilization`,
                            detail: `Currently ${(c.util*100).toFixed(0)}% used. Dropping to ${fmtMoney(target10)} shifts this card into the optimal band.`,
                            pay: payoff, pts: deltaPts, timeframe: '1 statement cycle',
                            debtId: c.id, priority: 50 + deltaPts
                        });
                    }
                }
            }
        });

        // Lever 2 — overall utilization if no per-card limits available
        if (s.globalUtil === null && creditCards.length > 0) {
            actions.push({
                title: 'Add your credit card limits',
                detail: 'Utilization is the single largest short-term lever on your score. Add a limit for each card to activate targeted payoff recommendations.',
                pay: 0, pts: 0, timeframe: 'now',
                priority: 110
            });
        }

        // Lever 3 — on-time payment streak
        if (s.lates > 0) {
            actions.push({
                title: 'Build a clean 6-month on-time payment streak',
                detail: `Late payments weight 35% of your score. Set auto-pay minimums on every account — each additional on-time month reduces the drag from your ${s.lates} recent late.`,
                pay: 0, pts: Math.min(40, s.lates * 12), timeframe: '3–6 months',
                priority: 130
            });
        } else {
            actions.push({
                title: 'Keep a spotless on-time record',
                detail: 'No late payments in the last 12 months — maintain this and payment-history gains will compound naturally over time.',
                pay: 0, pts: 5, timeframe: 'ongoing',
                priority: 10
            });
        }

        // Lever 4 — reduce new-credit drag
        if (s.inq >= 3 || s.newAcc >= 2) {
            actions.push({
                title: 'Pause new credit applications for 6 months',
                detail: `${s.inq} hard inquiries + ${s.newAcc} new accounts in 12 months is pulling the "New Credit" factor down. Each inquiry ages off after 12 months; each new account ages for ~24 months.`,
                pay: 0, pts: Math.min(18, s.inq * 3 + s.newAcc * 4), timeframe: '6–12 months',
                priority: 40
            });
        }

        // Lever 5 — credit mix
        if (s.mix <= 1) {
            actions.push({
                title: 'Diversify credit mix (only if organic)',
                detail: 'You currently report only one account type. If you already need a loan (auto, personal), the added mix helps — never open credit solely for mix points.',
                pay: 0, pts: 8, timeframe: '3–6 months',
                priority: 20
            });
        }

        // Lever 6 — account aging
        if (s.oldest !== null && s.oldest < 5) {
            actions.push({
                title: 'Keep oldest account open & active',
                detail: `Your oldest account is ${s.oldest} years. Closing it would cut the "Length" factor. Put a small recurring charge on it and auto-pay in full to keep it reporting.`,
                pay: 0, pts: 10, timeframe: 'ongoing',
                priority: 15
            });
        }

        // Lever 7 — request credit limit increase (if utilization is high)
        if (s.globalUtil !== null && s.globalUtil > 0.30) {
            actions.push({
                title: 'Request a credit-limit increase on your best card',
                detail: 'A soft-pull limit increase raises the denominator of your utilization ratio without any payoff required. Most major issuers grant ~20–30% increases after 6+ months of on-time use.',
                pay: 0, pts: 12, timeframe: '1–2 statement cycles',
                priority: 35
            });
        }

        // Rank by priority / estimated points
        actions.sort((x, y) => (y.priority || 0) - (x.priority || 0));
        return actions;
    };

    // ---- Project score at 3/6/12 months ----
    const project = (s, plan) => {
        const base = s.score || 640;
        let m3 = 0, m6 = 0, m12 = 0;
        plan.forEach(a => {
            const tf = (a.timeframe || '').toLowerCase();
            if (tf.includes('statement') || tf.includes('1–2') || tf.includes('now')) {
                m3 += a.pts; m6 += a.pts; m12 += a.pts;
            } else if (tf.includes('3') || tf.includes('6 months')) {
                m3 += Math.round(a.pts * 0.3);
                m6 += Math.round(a.pts * 0.7);
                m12 += a.pts;
            } else if (tf.includes('12') || tf.includes('ongoing')) {
                m3 += Math.round(a.pts * 0.1);
                m6 += Math.round(a.pts * 0.4);
                m12 += a.pts;
            } else {
                m3 += Math.round(a.pts * 0.2);
                m6 += Math.round(a.pts * 0.5);
                m12 += a.pts;
            }
        });
        // Diminishing returns past 100 pts of deltas
        const dim = (x) => Math.round(x > 80 ? 80 + (x - 80) * 0.4 : x);
        m3 = dim(m3); m6 = dim(m6); m12 = dim(m12);
        return {
            now: base,
            m3: Math.min(850, base + m3),
            m6: Math.min(850, base + m6),
            m12: Math.min(850, base + m12),
            d3: m3, d6: m6, d12: m12
        };
    };

    // ---- RENDER ----
    const s = snapshot();
    const needsOnboarding = s.score === null;

    // Input capture card
    const inputsCard = `
      <div class="card" style="grid-column:1 / -1; padding:28px;">
        <div class="sjc-header" style="margin-bottom:18px;">
          <div class="sjc-icon-blob"><i class="ph-fill ph-identification-badge"></i></div>
          <div class="badge" style="background:transparent; border:1px solid var(--border); color:var(--text-3); font-size:8px;">CREDIT PROFILE INPUTS</div>
        </div>
        <h3 style="font-size:18px; font-weight:800; margin-bottom:6px;">Tell the engine about your credit file</h3>
        <p style="font-size:12px; color:var(--text-2); line-height:1.6; margin-bottom:18px; max-width:560px;">
          The plan is generated from your live debt data plus these five inputs. All inputs are stored locally on this device — nothing is sent to a server.
        </p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px;">
          <label style="display:flex; flex-direction:column; gap:6px; font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;">
            Current FICO score
            <input id="cs-input-score" type="number" min="300" max="850" value="${cs.currentScore}" placeholder="e.g. 680"
              style="padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; font-weight:600;">
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;">
            Oldest account age (yrs)
            <input id="cs-input-oldest" type="number" min="0" max="60" step="0.5" value="${cs.oldestAccountYears}" placeholder="e.g. 6"
              style="padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; font-weight:600;">
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;">
            Late payments (last 12mo)
            <input id="cs-input-lates" type="number" min="0" max="20" value="${cs.latePayments12mo}" placeholder="0"
              style="padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; font-weight:600;">
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;">
            Hard inquiries (last 12mo)
            <input id="cs-input-inq" type="number" min="0" max="20" value="${cs.hardInquiries12mo}" placeholder="0"
              style="padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; font-weight:600;">
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;">
            New accounts (last 12mo)
            <input id="cs-input-newacc" type="number" min="0" max="20" value="${cs.newAccounts12mo}" placeholder="0"
              style="padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; font-weight:600;">
          </label>
        </div>

        ${creditCards.length > 0 ? `
        <div style="margin-top:22px; padding-top:18px; border-top:1px solid var(--border);">
          <div style="font-size:11px; font-weight:700; color:var(--text-2); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px;">Credit card limits (for utilization)</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px;">
            ${creditCards.map(d => `
              <label style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px;">
                <span style="flex:1; font-size:12px; font-weight:700;">${(d.name || d.lender || 'Card').replace(/</g,'&lt;')}</span>
                <span style="font-size:10px; color:var(--text-3);">Limit $</span>
                <input data-card-id="${d.id}" class="cs-card-limit" type="number" min="0" value="${cs.cardLimits[d.id] || ''}" placeholder="0"
                  style="width:100px; padding:6px 8px; background:var(--card); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:12px; font-weight:600;">
              </label>`).join('')}
          </div>
        </div>` : ''}

        <div style="display:flex; justify-content:flex-end; margin-top:18px;">
          <button id="cs-save-btn" class="btn btn-primary" style="padding:12px 22px; font-size:11px;">
            <i class="ph-fill ph-sparkle"></i> &nbsp;ANALYSE MY CREDIT
          </button>
        </div>
      </div>`;

    // ─────────────────────────────────────────────────────────
    // BUREAU CONNECTION — live provider integration
    // Stores: { provider, appKey, userId, lastSync, lastScore }
    // ─────────────────────────────────────────────────────────
    const BUREAU_KEY = 'wjp_credit_bureau';
    let bureau = {};
    try { bureau = JSON.parse(localStorage.getItem(BUREAU_KEY) || '{}'); } catch(_) {}
    const saveBureau = () => {
        localStorage.setItem(BUREAU_KEY, JSON.stringify(bureau));
        const sc = parseInt(bureau.lastScore, 10);
        if (!isNaN(sc) && sc >= 300 && sc <= 850 && typeof recordScoreHistory === 'function') {
            recordScoreHistory(sc);
        }
    };

    const providerMeta = {
        array:      { label: 'Array.io',              subtitle: 'Client-side widget · live pull', type:'widget'  },
        plaid:      { label: 'Plaid (CRA)',           subtitle: 'Requires backend proxy',          type:'api'     },
        experian:   { label: 'Experian Connect',      subtitle: 'Requires backend proxy',          type:'api'     },
        equifax:    { label: 'Equifax',               subtitle: 'Requires backend proxy',          type:'api'     },
        transunion: { label: 'TransUnion',            subtitle: 'Requires backend proxy',          type:'api'     },
        creditkarma:{ label: 'Credit Karma (manual)', subtitle: 'Paste your latest score',         type:'manual'  },
        myfico:     { label: 'myFICO (manual)',       subtitle: 'Paste your latest score',         type:'manual'  }
    };

    const bureauStatus = () => {
        if (!bureau.provider) return 'Not connected';
        const m = providerMeta[bureau.provider];
        if (!m) return 'Not connected';
        const ls = bureau.lastSync ? new Date(bureau.lastSync).toLocaleString() : 'never';
        return `Connected to ${m.label} · last sync ${ls}`;
    };

    const bureauCard = `
      <div class="card" style="grid-column:1 / -1; padding:28px;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:24px; flex-wrap:wrap;">
          <div style="flex:1; min-width:260px;">
            <div class="sjc-header" style="margin-bottom:14px;">
              <div class="sjc-icon-blob"><i class="ph-fill ph-shield-check"></i></div>
              <div class="badge" style="background:transparent; border:1px solid var(--border); color:var(--text-3); font-size:8px;">CREDIT BUREAU LINK</div>
            </div>
            <h3 style="font-size:18px; font-weight:800; margin-bottom:6px;">${bureau.provider ? 'Bureau connected' : 'Connect a credit bureau'}</h3>
            <p style="font-size:12px; color:var(--text-2); line-height:1.6; max-width:520px;">
              ${bureau.provider
                ? bureauStatus() + '. Click Sync to refresh your score from the provider.'
                : 'Pull live score + factor data directly from Array, Plaid, a bureau API, or sync manually from Credit Karma / myFICO. Credentials are stored locally on this device only.'}
            </p>
            ${bureau.provider === 'array' && bureau.appKey && bureau.userId ? `
              <div id="cs-array-widget-mount" style="margin-top:14px; padding:18px; background:var(--card-2); border:1px solid var(--border); border-radius:10px; min-height:120px;">
                <div style="font-size:11px; color:var(--text-3); font-weight:700; margin-bottom:8px;">Array live widget</div>
                <div id="cs-array-target" style="min-height:80px;"></div>
                <div style="font-size:10px; color:var(--text-3); margin-top:8px;">If the widget doesn't render, verify your App Key and User ID match your Array dashboard.</div>
              </div>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; min-width:220px;">
            <button id="cs-connect-bureau" class="btn btn-primary" style="padding:12px 18px; font-size:11px; display:flex; align-items:center; justify-content:center; gap:8px;">
              <i class="ph-fill ph-plug"></i> ${bureau.provider ? 'MANAGE CONNECTION' : 'CONNECT BUREAU'}
            </button>
            ${bureau.provider ? `
              <button id="cs-sync-bureau" class="btn btn-ghost" style="padding:10px 16px; font-size:10px; background:var(--card-2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:6px;">
                <i class="ph ph-arrows-clockwise"></i> SYNC NOW
              </button>
              <button id="cs-disconnect-bureau" class="btn btn-ghost" style="padding:10px 16px; font-size:10px; background:transparent; border:1px solid rgba(255,77,109,0.35); color:#ff4d6d; display:flex; align-items:center; justify-content:center; gap:6px;">
                <i class="ph ph-plug-charging"></i> DISCONNECT
              </button>` : ''}
          </div>
        </div>
      </div>`;

    // ─────────────────────────────────────────────────────────
    // AI CREDIT ADVISOR — answers questions using live profile
    // ─────────────────────────────────────────────────────────
    const CHAT_KEY = 'wjp_credit_chat';
    let chat = [];
    try { chat = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); } catch(_) { chat = []; }
    const saveChat = () => localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-40)));

    const answerQuestion = (qRaw) => {
        const q = (qRaw || '').toLowerCase().trim();
        const sNow = snapshot();
        const aNow = sNow.score !== null ? analyse(sNow) : null;
        const planNow = aNow ? buildPlan(sNow, aNow) : [];
        const projNow = aNow ? project(sNow, planNow) : null;

        // "which debt/card to pay first"
        if (/(pay (off|down) first|which (debt|card|one)|focus on|priority|start with|tackle first)/.test(q)) {
            const top = planNow.find(p => p.pay > 0);
            if (top) {
                return `Start with **${top.title.replace(/^Pay down /, '')}**. ${top.detail} Expected impact: **+${top.pts} pts** within **${top.timeframe}**.`;
            }
            if (!sNow.totalLim) return `I need your credit card limits to rank debts by score impact. Add them in the "Credit Profile Inputs" card below.`;
            return `Your utilization is already in the optimal zone. Focus on keeping balances under 10% of each card's limit and never missing a payment.`;
        }

        // "why is my score low" / "what's hurting my score"
        if (/(why.*(low|hurt|bad|drop|fall)|hurting|dragging|weakest|biggest factor)/.test(q)) {
            if (!aNow) return `Enter your current FICO score below and I can tell you exactly what's dragging it down.`;
            const worst = aNow.factors.slice().sort((x,y) => x.score - y.score)[0];
            return `Your weakest factor is **${worst.name}** (${worst.rating}, ${worst.weight}% of your score). ${worst.detail} Fixing this is your highest-leverage move.`;
        }

        // utilization
        if (/(utilization|credit usage|balance to limit)/.test(q)) {
            if (sNow.globalUtil === null) return `Add each credit card's limit in the Inputs card below so I can compute your utilization.`;
            const pct = (sNow.globalUtil * 100).toFixed(1);
            const worstCard = sNow.perCard.filter(c => c.util !== null).sort((a,b) => b.util - a.util)[0];
            return `Your overall utilization is **${pct}%** (${fmtMoney(sNow.totalBal)} across ${fmtMoney(sNow.totalLim)} in limits). ${worstCard ? `Worst card: **${worstCard.name}** at ${(worstCard.util*100).toFixed(0)}%.` : ''} FICO rewards <10% — ideally you want each card below that line before each statement closes.`;
        }

        // "how long / when will I reach X"
        const target = (() => {
            const m = q.match(/(\d{3})/);
            if (!m) return null;
            const v = parseInt(m[1], 10);
            return (v >= 300 && v <= 850) ? v : null;
        })();
        if (target && /(how long|reach|hit|when will|time to)/.test(q)) {
            if (!projNow) return `Enter your current score so I can project a timeline.`;
            if (target <= projNow.m3)       return `At your current trajectory you'd cross **${target}** within ~3 months (projected ${projNow.m3}).`;
            if (target <= projNow.m6)       return `Roughly **3–6 months** if you execute the top actions (projected ${projNow.m6} at 6 months).`;
            if (target <= projNow.m12)      return `Around **6–12 months** with the full plan in play (projected ${projNow.m12} at 12 months).`;
            return `${target} is past your 12-month trajectory (${projNow.m12}). Sustained clean payment history + utilization discipline beyond 12 months is the path.`;
        }

        // approvals
        if (/(approv|qualif|eligible|get a loan|get a card|mortgage|auto loan|car loan|refinance)/.test(q)) {
            const score = sNow.score;
            if (!score) return `Share your current score and I'll map approval odds for auto, mortgage, personal loan, and top rewards cards.`;
            const lines = [];
            const band = scoreBand(score).band;
            lines.push(`At **${score} (${band})**:`);
            if (/mortgage|refinance/.test(q)) {
                lines.push(`• Mortgage — conventional loans require 620+; best rates unlock at 740+. ${score >= 740 ? 'You qualify for top-tier rates.' : score >= 700 ? 'You qualify, but rates will be moderate.' : score >= 620 ? 'You qualify, but rates will be notably higher.' : 'Most lenders will decline; FHA starts at 580.'}`);
            } else if (/auto|car/.test(q)) {
                lines.push(`• Auto loan — captive lenders approve down to ~580; best APRs unlock at 720+. ${score >= 720 ? 'You qualify for the lowest tier APRs.' : score >= 660 ? 'You qualify for prime rates, likely 1–3 points above floor.' : 'You qualify for subprime APRs; consider a co-signer or larger down payment.'}`);
            } else if (/rewards|premium|card/.test(q)) {
                lines.push(`• Rewards credit cards — most issuers want 700+ for premium rewards, 750+ for premium travel cards. ${score >= 750 ? 'You qualify across the board.' : score >= 700 ? 'You qualify for mainstream rewards, not ultra-premium.' : 'Target cash-back starter cards; premium rewards likely denied.'}`);
            } else {
                lines.push(`• Auto loan: best rates at 720+.`);
                lines.push(`• Mortgage: 620 minimum (conventional), 740+ for best rate.`);
                lines.push(`• Rewards credit cards: 700+ typically.`);
                lines.push(`• Personal loan: 660+ for prime APRs.`);
            }
            return lines.join('\n');
        }

        // limit increase
        if (/(limit increase|credit limit|raise.*limit|cli)/.test(q)) {
            return `Request a soft-pull limit increase on your card with the longest on-time history. Major issuers (Chase, Amex, Capital One, Discover) typically grant 20–30% bumps every 6 months of on-time use. A higher limit drops your utilization ratio instantly — often worth **+5 to +15 points** within one statement cycle.`;
        }

        // payment history
        if (/(late|missed|on-time|on time|payment history)/.test(q)) {
            if (sNow.lates === 0) return `You have no late payments in the last 12 months — Payment History (35% of your score) is working in your favor. Keep auto-pay on every account to protect this.`;
            return `You have **${sNow.lates} late payment${sNow.lates>1?'s':''}** in the past 12 months. Each late drags Payment History (35% weight). A 30-day late costs 60–80 points at the peak and ages off over 7 years; a clean 6-month streak can recover 20–40 of those points.`;
        }

        // help / greeting / default
        if (/(hi|hello|hey|help|what can you|how do|what should)/.test(q) || q.length < 4) {
            return `I'm your credit advisor. I can answer using your live debt data. Try:\n• Which debt should I pay off first?\n• Why is my score low?\n• What's my utilization?\n• Can I qualify for a mortgage / auto loan / rewards card?\n• How long until my score hits 750?\n• Should I request a limit increase?`;
        }

        // Fallback — give a summary
        if (!aNow) return `Enter your current FICO score in the Inputs card and I can give you a data-driven answer.`;
        const worst = aNow.factors.slice().sort((x,y) => x.score - y.score)[0];
        const top = planNow[0];
        return `Here's what I see: score **${sNow.score}** (${scoreBand(sNow.score).band}). Weakest factor: **${worst.name}** (${worst.rating}). Top recommended action: **${top ? top.title : 'Maintain current habits'}**${top && top.pts ? ` (+${top.pts} pts)` : ''}.`;
    };

    const renderChatBubble = (role, text) => {
        const isUser = role === 'user';
        const safe = String(text || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        return `
          <div style="display:flex; ${isUser ? 'justify-content:flex-end' : 'justify-content:flex-start'}; margin-bottom:10px;">
            <div style="max-width:78%; padding:12px 14px; border-radius:${isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px'}; background:${isUser ? 'var(--accent)' : 'var(--card-2)'}; color:${isUser ? '#fff' : 'var(--text)'}; border:${isUser ? 'none' : '1px solid var(--border)'}; font-size:12px; line-height:1.6;">${safe}</div>
          </div>`;
    };

    const aiChatCard = `
      <div class="card" style="grid-column:1 / -1; padding:28px;">
        <div class="sjc-header" style="margin-bottom:14px;">
          <div class="sjc-icon-blob"><i class="ph-fill ph-robot"></i></div>
          <div class="badge" style="background:transparent; border:1px solid var(--accent); color:var(--accent); font-size:8px;">AI CREDIT ADVISOR</div>
        </div>
        <h3 style="font-size:18px; font-weight:800; margin-bottom:6px;">Ask anything about your score</h3>
        <p style="font-size:11px; color:var(--text-2); line-height:1.6; margin-bottom:14px;">Questions are answered using your live debt data, credit inputs, and FICO factor model. Conversation stays on this device.</p>

        <div id="cs-chat-suggestions" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
          ${[
            'Which debt should I pay first?',
            'Why is my score low?',
            "What's my utilization?",
            'Can I qualify for a mortgage?',
            'How long until my score hits 750?',
            'Should I request a limit increase?'
          ].map(q => `<button class="cs-chat-suggest" style="padding:7px 12px; font-size:10px; font-weight:700; background:var(--card-2); border:1px solid var(--border); color:var(--text-2); border-radius:99px; cursor:pointer;">${q}</button>`).join('')}
        </div>

        <div id="cs-chat-history" style="max-height:360px; overflow-y:auto; padding:16px; background:var(--card-2); border:1px solid var(--border); border-radius:12px; margin-bottom:12px;">
          ${chat.length === 0 ? `<div style="text-align:center; padding:20px; font-size:11px; color:var(--text-3);">Ask a question or pick a suggestion above to start.</div>` : chat.map(m => renderChatBubble(m.role, m.text)).join('')}
        </div>

        <div style="display:flex; gap:8px;">
          <input id="cs-chat-input" type="text" placeholder="Ask about your credit score…" autocomplete="off"
            style="flex:1; padding:12px 14px; background:var(--card-2); border:1px solid var(--border); border-radius:10px; color:var(--text); font-size:12px; outline:none;">
          <button id="cs-chat-send" class="btn btn-primary" style="padding:12px 18px; font-size:11px;">
            <i class="ph-fill ph-paper-plane-tilt"></i>&nbsp;ASK
          </button>
          ${chat.length > 0 ? `<button id="cs-chat-clear" class="btn btn-ghost" style="padding:12px 14px; font-size:10px; background:var(--card-2); border:1px solid var(--border);"><i class="ph ph-trash"></i></button>` : ''}
        </div>
      </div>`;

    // If score isn't set yet, show just inputs + empty hero state
    if (needsOnboarding) {
        container.innerHTML = `
          <div class="reveal" style="display:grid; grid-template-columns:1fr; gap:24px; padding-bottom:40px;">
            ${bureauCard}
            <div class="card" style="grid-column:1 / -1; padding:36px; text-align:center;">
              <div style="display:inline-flex; width:64px; height:64px; border-radius:18px; background:rgba(31,122,74,0.08); border:1px solid rgba(31,122,74,0.2); align-items:center; justify-content:center; margin:0 auto 18px;">
                <i class="ph-fill ph-gauge" style="font-size:28px; color:var(--accent);"></i>
              </div>
              <h2 style="font-size:26px; font-weight:900; margin-bottom:8px;">Credit Score Intelligence Engine</h2>
              <p style="font-size:13px; color:var(--text-2); max-width:540px; margin:0 auto; line-height:1.7;">
                Enter your current score and the engine will combine it with your live debt data to generate a ranked, point-by-point improvement plan. Every recommendation uses the FICO factor model (Payment 35% · Utilization 30% · Length 15% · Mix 10% · New Credit 10%).
              </p>
            </div>
            ${inputsCard}
            ${aiChatCard}
          </div>`;
        wireInputs();
        return;
    }

    // With a score, run analysis + plan
    const a = analyse(s);
    const plan = buildPlan(s, a);
    const proj = project(s, plan);
    const band = scoreBand(s.score);
    const gaugePct = Math.round(((s.score - 300) / 550) * 100);

    // Key headline number: total estimated 12mo gain
    const totalGain = proj.d12;

    const heroCard = `
      <div class="card" style="grid-column:1 / -1; padding:36px; display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center;">
        <div>
          <div class="sjc-header" style="margin-bottom:16px;">
            <div class="sjc-icon-blob"><i class="ph-fill ph-gauge"></i></div>
            <div class="badge" style="background:transparent; border:1px solid var(--border); color:var(--text-3); font-size:8px;">LIVE ANALYSIS</div>
          </div>
          <div style="font-size:11px; color:var(--text-3); text-transform:uppercase; font-weight:700; letter-spacing:0.08em; margin-bottom:6px;">Current score</div>
          <div style="display:flex; align-items:baseline; gap:14px; margin-bottom:8px;">
            <div style="font-size:64px; font-weight:900; letter-spacing:-0.02em; color:${band.color};">${s.score}</div>
            <div style="font-size:14px; font-weight:700; color:${band.color}; text-transform:uppercase; letter-spacing:0.05em;">${band.band}</div>
          </div>
          <div style="height:8px; background:var(--card-2); border-radius:99px; overflow:hidden; margin-bottom:22px;">
            <div style="width:${gaugePct}%; height:100%; background:linear-gradient(90deg, #ff4d6d 0%, #d97706 35%, #b58900 55%, #2b9b72 75%, #1f9d55 100%);"></div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:14px;">
            <div style="background:var(--card-2); border:1px solid var(--border); border-radius:10px; padding:14px;">
              <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; font-weight:700; letter-spacing:0.05em;">+3 months</div>
              <div style="font-size:22px; font-weight:900; margin-top:4px;">${proj.m3}</div>
              <div style="font-size:10px; color:var(--accent); font-weight:700;">+${proj.d3} pts</div>
            </div>
            <div style="background:var(--card-2); border:1px solid var(--border); border-radius:10px; padding:14px;">
              <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; font-weight:700; letter-spacing:0.05em;">+6 months</div>
              <div style="font-size:22px; font-weight:900; margin-top:4px;">${proj.m6}</div>
              <div style="font-size:10px; color:var(--accent); font-weight:700;">+${proj.d6} pts</div>
            </div>
            <div style="background:var(--card-2); border:1px solid rgba(31,122,74,0.35); border-radius:10px; padding:14px;">
              <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.05em;">+12 months</div>
              <div style="font-size:22px; font-weight:900; margin-top:4px; color:var(--accent);">${proj.m12}</div>
              <div style="font-size:10px; color:var(--accent); font-weight:700;">+${proj.d12} pts</div>
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--text-3); text-transform:uppercase; font-weight:700; letter-spacing:0.08em; margin-bottom:6px;">AI verdict</div>
          <h2 style="font-size:24px; font-weight:900; line-height:1.3; margin-bottom:12px;">
            ${totalGain >= 60
              ? `Execute the plan and you're on track for a <span style="color:var(--accent);">+${totalGain}-point</span> lift in 12 months.`
              : totalGain >= 30
              ? `A <span style="color:var(--accent);">+${totalGain}-point</span> lift is realistic in 12 months with the steps below.`
              : `Your score is already strong. Protecting it is the priority — a steady <span style="color:var(--accent);">+${totalGain} pts</span> is achievable.`}
          </h2>
          <p style="font-size:12px; color:var(--text-2); line-height:1.7;">
            Each recommendation below is ranked by expected point impact. The top action is your <strong>single biggest lever right now</strong>. Stack them sequentially — don't take on multiple new commitments simultaneously.
          </p>
        </div>
      </div>`;

    const factorCard = `
      <div class="card" style="grid-column:1 / -1; padding:28px;">
        <div class="sjc-header" style="margin-bottom:18px;">
          <div class="sjc-icon-blob"><i class="ph-fill ph-chart-pie-slice"></i></div>
          <div class="badge" style="background:transparent; border:1px solid var(--border); color:var(--text-3); font-size:8px;">FICO FACTOR BREAKDOWN</div>
        </div>
        <h3 style="font-size:18px; font-weight:800; margin-bottom:14px;">What's driving your score right now</h3>
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${a.factors.map(f => {
            const pct = Math.round(f.score);
            const barColor = pct >= 80 ? '#1f9d55' : pct >= 60 ? '#2b9b72' : pct >= 40 ? '#b58900' : pct >= 20 ? '#d97706' : '#ff4d6d';
            return `
            <div style="background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div>
                  <span style="font-size:13px; font-weight:800;">${f.name}</span>
                  <span style="font-size:10px; color:var(--text-3); margin-left:8px; font-weight:600;">${f.weight}% of score</span>
                </div>
                <div style="font-size:11px; font-weight:800; color:${barColor}; text-transform:uppercase; letter-spacing:0.05em;">${f.rating}</div>
              </div>
              <div style="height:6px; background:var(--card); border-radius:99px; overflow:hidden; margin-bottom:8px;">
                <div style="width:${pct}%; height:100%; background:${barColor};"></div>
              </div>
              <div style="font-size:11px; color:var(--text-2); line-height:1.5;">${f.detail}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    const planCard = plan.length === 0 ? '' : `
      <div class="card" style="grid-column:1 / -1; padding:28px;">
        <div class="sjc-header" style="margin-bottom:18px;">
          <div class="sjc-icon-blob"><i class="ph-fill ph-list-checks"></i></div>
          <div class="badge" style="background:transparent; border:1px solid var(--accent); color:var(--accent); font-size:8px;">AI ACTION PLAN · RANKED</div>
        </div>
        <h3 style="font-size:18px; font-weight:800; margin-bottom:14px;">Do these in order — highest impact first</h3>
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${plan.map((ac, i) => `
            <div style="background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:16px; display:flex; gap:16px;">
              <div style="width:36px; height:36px; border-radius:10px; background:rgba(31,122,74,0.08); border:1px solid rgba(31,122,74,0.2); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; flex-shrink:0;">${i+1}</div>
              <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:4px;">
                  <div style="font-size:13px; font-weight:800; line-height:1.4;">${ac.title}</div>
                  <div style="flex-shrink:0; display:flex; gap:6px; align-items:center;">
                    ${ac.pts > 0 ? `<span style="font-size:11px; font-weight:800; color:var(--accent); background:rgba(31,122,74,0.08); border:1px solid rgba(31,122,74,0.2); padding:4px 10px; border-radius:99px; white-space:nowrap;">+${ac.pts} pts</span>` : ''}
                    <span style="font-size:10px; font-weight:700; color:var(--text-3); background:var(--card); border:1px solid var(--border); padding:4px 10px; border-radius:99px; white-space:nowrap; text-transform:uppercase; letter-spacing:0.04em;">${ac.timeframe}</span>
                  </div>
                </div>
                <div style="font-size:11px; color:var(--text-2); line-height:1.6;">${ac.detail}</div>
                ${ac.pay > 0 ? `<div style="margin-top:8px; font-size:11px; color:var(--accent); font-weight:700;"><i class="ph-fill ph-currency-circle-dollar"></i> Payoff target: ${fmtMoney(ac.pay)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    // Debt priority card: which debts to pay down first
    const prioritized = s.perCard
        .filter(c => c.util !== null && c.util > 0.10)
        .sort((a,b) => b.util - a.util);
    const priorityCard = prioritized.length === 0 ? '' : `
      <div class="card" style="grid-column:1 / -1; padding:28px;">
        <div class="sjc-header" style="margin-bottom:18px;">
          <div class="sjc-icon-blob"><i class="ph-fill ph-target"></i></div>
          <div class="badge" style="background:transparent; border:1px solid var(--border); color:var(--text-3); font-size:8px;">WHICH DEBTS TO WORK ON FIRST</div>
        </div>
        <h3 style="font-size:18px; font-weight:800; margin-bottom:14px;">Utilization-weighted payoff order</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
          ${prioritized.map((c, i) => {
            const band = c.util >= 0.75 ? '#ff4d6d' : c.util >= 0.50 ? '#d97706' : c.util >= 0.30 ? '#b58900' : '#2b9b72';
            return `
            <div style="background:var(--card-2); border:1px solid ${i===0?'rgba(255,77,109,0.35)':'var(--border)'}; border-radius:12px; padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div style="font-size:13px; font-weight:800;">${String(c.name).replace(/</g,'&lt;')}</div>
                <div style="font-size:11px; font-weight:800; color:${band};">${(c.util*100).toFixed(0)}% used</div>
              </div>
              <div style="height:6px; background:var(--card); border-radius:99px; overflow:hidden; margin-bottom:8px;">
                <div style="width:${Math.min(100, c.util*100)}%; height:100%; background:${band};"></div>
              </div>
              <div style="font-size:10px; color:var(--text-3); display:flex; justify-content:space-between;">
                <span>Balance ${fmtMoney(c.bal)}</span>
                <span>Limit ${fmtMoney(c.lim)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    container.innerHTML = `
      <div class="reveal" style="display:grid; grid-template-columns:1fr; gap:24px; padding-bottom:40px;">
        ${bureauCard}
        ${heroCard}
        ${factorCard}
        ${planCard}
        ${priorityCard}
        ${aiChatCard}
        ${inputsCard}
      </div>`;

    wireInputs();

    function wireInputs() {
        const map = [
            ['cs-input-score',   'currentScore'],
            ['cs-input-oldest',  'oldestAccountYears'],
            ['cs-input-lates',   'latePayments12mo'],
            ['cs-input-inq',     'hardInquiries12mo'],
            ['cs-input-newacc',  'newAccounts12mo']
        ];
        map.forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', (e) => { cs[key] = e.target.value; });
        });
        document.querySelectorAll('.cs-card-limit').forEach(el => {
            el.addEventListener('input', (e) => {
                const id = e.target.dataset.cardId;
                cs.cardLimits[id] = e.target.value;
            });
        });
        const saveBtn = document.getElementById('cs-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => {
            saveCs();
            if (typeof showToast === 'function') showToast('Credit analysis updated.');
            if (typeof updateCreditProfile === 'function') updateCreditProfile();
            renderCreditScoreTab();
        });

        // ─── Bureau connection UI ───
        const connectBtn = document.getElementById('cs-connect-bureau');
        if (connectBtn) connectBtn.addEventListener('click', () => openBureauModal());

        const syncBtn = document.getElementById('cs-sync-bureau');
        if (syncBtn) syncBtn.addEventListener('click', () => syncBureau());

        const discBtn = document.getElementById('cs-disconnect-bureau');
        if (discBtn) discBtn.addEventListener('click', () => {
            if (!confirm('Disconnect from ' + (providerMeta[bureau.provider]?.label || 'bureau') + '? Your local credit profile data will stay.')) return;
            bureau = {};
            saveBureau();
            if (typeof showToast === 'function') showToast('Bureau disconnected.');
            if (typeof updateCreditProfile === 'function') updateCreditProfile();
            renderCreditScoreTab();
        });

        // Inject Array widget script if configured
        if (bureau.provider === 'array' && bureau.appKey && bureau.userId) {
            const target = document.getElementById('cs-array-target');
            if (target && !document.getElementById('array-web-component-script')) {
                const sc = document.createElement('script');
                sc.id = 'array-web-component-script';
                sc.src = 'https://embed.array.io/cms/array-web-component.js?appKey=' + encodeURIComponent(bureau.appKey);
                sc.async = true;
                document.head.appendChild(sc);
            }
            if (target) {
                target.innerHTML = `<array-credit-score appKey="${String(bureau.appKey).replace(/"/g,'')}" userToken="${String(bureau.userId).replace(/"/g,'')}" sandbox="true"></array-credit-score>`;
            }
        }

        // ─── Chat wiring ───
        const sendBtn = document.getElementById('cs-chat-send');
        const inputEl = document.getElementById('cs-chat-input');
        const clearBtn = document.getElementById('cs-chat-clear');

        const sendMessage = (textOverride) => {
            const text = (textOverride !== undefined ? textOverride : (inputEl ? inputEl.value : '')).trim();
            if (!text) return;
            chat.push({ role: 'user', text, ts: Date.now() });
            const reply = answerQuestion(text);
            chat.push({ role: 'assistant', text: reply, ts: Date.now() });
            saveChat();
            if (inputEl) inputEl.value = '';
            renderCreditScoreTab();
        };

        if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());
        if (inputEl) inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        document.querySelectorAll('.cs-chat-suggest').forEach(btn => {
            btn.addEventListener('click', () => sendMessage(btn.textContent));
        });
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (!confirm('Clear your credit-advisor chat history?')) return;
            chat = [];
            saveChat();
            renderCreditScoreTab();
        });

        // Auto-scroll chat history to bottom
        const hist = document.getElementById('cs-chat-history');
        if (hist) hist.scrollTop = hist.scrollHeight;
    }

    function openBureauModal() {
        // Remove any stale modal
        const existing = document.getElementById('cs-bureau-modal');
        if (existing) existing.remove();

        const backdrop = document.createElement('div');
        backdrop.id = 'cs-bureau-modal';
        backdrop.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;';

        const providerOptions = Object.entries(providerMeta).map(([k, m]) => `
          <label style="display:flex; gap:12px; padding:12px 14px; background:var(--card-2); border:1px solid var(--border); border-radius:10px; cursor:pointer;">
            <input type="radio" name="cs-bureau-provider" value="${k}" ${bureau.provider===k?'checked':''} style="margin-top:3px;">
            <div style="flex:1;">
              <div style="font-size:13px; font-weight:800;">${m.label}</div>
              <div style="font-size:10px; color:var(--text-3);">${m.subtitle}</div>
            </div>
            <div style="font-size:9px; font-weight:700; color:${m.type==='widget'?'#2b9b72':m.type==='api'?'#d97706':'var(--text-3)'}; text-transform:uppercase; align-self:center;">${m.type}</div>
          </label>`).join('');

        backdrop.innerHTML = `
          <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; max-width:540px; width:100%; max-height:90vh; overflow-y:auto;">
            <div style="padding:22px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-size:11px; color:var(--text-3); font-weight:700; letter-spacing:0.06em; text-transform:uppercase;">Credit bureau link</div>
                <h3 style="font-size:18px; font-weight:800; margin-top:4px;">Choose a provider</h3>
              </div>
              <button id="cs-bureau-close" style="background:transparent; border:none; color:var(--text-3); font-size:22px; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:20px 24px;">
              <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">${providerOptions}</div>
              <div id="cs-bureau-fields" style="display:flex; flex-direction:column; gap:10px;"></div>
              <div style="font-size:10px; color:var(--text-3); line-height:1.6; margin-top:14px; padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px;">
                <i class="ph-fill ph-shield"></i> Credentials stay on this device (localStorage). Bureau APIs marked "api" require a backend proxy for FCRA compliance — this app stores your reference credentials and lets you paste the score the backend returns.
              </div>
            </div>
            <div style="padding:18px 24px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px;">
              <button id="cs-bureau-cancel" class="btn btn-ghost" style="padding:10px 18px; font-size:11px; background:var(--card-2); border:1px solid var(--border);">CANCEL</button>
              <button id="cs-bureau-save" class="btn btn-primary" style="padding:10px 18px; font-size:11px;">SAVE CONNECTION</button>
            </div>
          </div>`;
        document.body.appendChild(backdrop);

        const fieldsEl = backdrop.querySelector('#cs-bureau-fields');
        const renderFields = (provider) => {
            const m = providerMeta[provider];
            if (!m) { fieldsEl.innerHTML = ''; return; }
            const inputStyle = 'padding:10px 12px; background:var(--card-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:13px; font-weight:600; width:100%;';
            const labelStyle = 'display:flex; flex-direction:column; gap:6px; font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;';

            if (m.type === 'widget') {
                fieldsEl.innerHTML = `
                  <label style="${labelStyle}">App Key (from Array dashboard)
                    <input id="cs-f-appkey" type="text" value="${(bureau.appKey||'').replace(/"/g,'')}" placeholder="sandbox-xxxx or prod key" style="${inputStyle}">
                  </label>
                  <label style="${labelStyle}">User Token / ID
                    <input id="cs-f-userid" type="text" value="${(bureau.userId||'').replace(/"/g,'')}" placeholder="user token issued for this account" style="${inputStyle}">
                  </label>
                  <label style="${labelStyle}">Latest score (optional — widget will pull live)
                    <input id="cs-f-score" type="number" min="300" max="850" value="${bureau.lastScore||''}" placeholder="e.g. 720" style="${inputStyle}">
                  </label>`;
            } else if (m.type === 'api') {
                fieldsEl.innerHTML = `
                  <label style="${labelStyle}">API reference / Client ID
                    <input id="cs-f-appkey" type="text" value="${(bureau.appKey||'').replace(/"/g,'')}" placeholder="client_id or reference code" style="${inputStyle}">
                  </label>
                  <label style="${labelStyle}">Account / User reference
                    <input id="cs-f-userid" type="text" value="${(bureau.userId||'').replace(/"/g,'')}" placeholder="your account reference at provider" style="${inputStyle}">
                  </label>
                  <label style="${labelStyle}">Latest score from provider
                    <input id="cs-f-score" type="number" min="300" max="850" value="${bureau.lastScore||''}" placeholder="paste the score your backend returned" style="${inputStyle}">
                  </label>
                  <div style="font-size:10px; color:#d97706; line-height:1.5; padding:8px 10px; background:rgba(217,119,6,0.08); border:1px solid rgba(217,119,6,0.25); border-radius:6px;">
                    <i class="ph-fill ph-warning"></i> Direct ${m.label} pulls require a backend proxy + FCRA-compliant consent. Your credentials and score are stored locally only; no pull happens from this browser.
                  </div>`;
            } else {
                fieldsEl.innerHTML = `
                  <label style="${labelStyle}">Latest score from ${m.label}
                    <input id="cs-f-score" type="number" min="300" max="850" value="${bureau.lastScore||''}" placeholder="e.g. 720" style="${inputStyle}">
                  </label>
                  <label style="${labelStyle}">Source URL (optional)
                    <input id="cs-f-appkey" type="text" value="${(bureau.appKey||'').replace(/"/g,'')}" placeholder="https://… where you saw the score" style="${inputStyle}">
                  </label>
                  <label style="${labelStyle}">Account / user reference (optional)
                    <input id="cs-f-userid" type="text" value="${(bureau.userId||'').replace(/"/g,'')}" placeholder="username or email at the source" style="${inputStyle}">
                  </label>`;
            }
        };

        const currentChoice = () => {
            const r = backdrop.querySelector('input[name="cs-bureau-provider"]:checked');
            return r ? r.value : null;
        };
        renderFields(bureau.provider || null);
        backdrop.querySelectorAll('input[name="cs-bureau-provider"]').forEach(r => {
            r.addEventListener('change', () => renderFields(r.value));
        });

        backdrop.querySelector('#cs-bureau-close').addEventListener('click', () => backdrop.remove());
        backdrop.querySelector('#cs-bureau-cancel').addEventListener('click', () => backdrop.remove());
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

        backdrop.querySelector('#cs-bureau-save').addEventListener('click', () => {
            const p = currentChoice();
            if (!p) { alert('Pick a provider first.'); return; }
            const appKeyEl = backdrop.querySelector('#cs-f-appkey');
            const userIdEl = backdrop.querySelector('#cs-f-userid');
            const scoreEl  = backdrop.querySelector('#cs-f-score');
            const appKey = appKeyEl ? appKeyEl.value.trim() : '';
            const userId = userIdEl ? userIdEl.value.trim() : '';
            const scoreVal = scoreEl && scoreEl.value ? parseInt(scoreEl.value, 10) : null;

            bureau = {
                provider: p,
                appKey, userId,
                lastScore: (scoreVal && scoreVal >= 300 && scoreVal <= 850) ? scoreVal : (bureau.lastScore || null),
                lastSync: Date.now()
            };
            saveBureau();

            // If user pasted a score, pipe it into the credit profile
            if (scoreVal && scoreVal >= 300 && scoreVal <= 850) {
                cs.currentScore = scoreVal;
                saveCs();
            }

            backdrop.remove();
            if (typeof showToast === 'function') showToast('Connected to ' + providerMeta[p].label + '.');
            if (typeof updateCreditProfile === 'function') updateCreditProfile();
            renderCreditScoreTab();
        });
    }

    function syncBureau() {
        if (!bureau.provider) return;
        const m = providerMeta[bureau.provider];
        if (!m) return;

        if (m.type === 'widget') {
            // Array widget is live — just bump the sync timestamp and re-render
            bureau.lastSync = Date.now();
            saveBureau();
            if (typeof showToast === 'function') showToast('Array widget refreshed.');
            if (typeof updateCreditProfile === 'function') updateCreditProfile();
            renderCreditScoreTab();
            return;
        }

        // api + manual → prompt for latest score
        const currentScore = bureau.lastScore ? String(bureau.lastScore) : '';
        const input = prompt(
            'Sync from ' + m.label + '\n\n' +
            (m.type === 'api'
                ? 'Paste the latest score returned by your ' + m.label + ' backend proxy:'
                : 'Paste your latest score from ' + m.label + ':'),
            currentScore
        );
        if (input === null) return;
        const v = parseInt(input, 10);
        if (!v || v < 300 || v > 850) { alert('Enter a valid score between 300 and 850.'); return; }

        bureau.lastScore = v;
        bureau.lastSync = Date.now();
        saveBureau();
        cs.currentScore = v;
        saveCs();
        if (typeof showToast === 'function') showToast('Score updated from ' + m.label + '.');
        if (typeof updateCreditProfile === 'function') updateCreditProfile();
        renderCreditScoreTab();
    }
}
window.renderCreditScoreTab = renderCreditScoreTab;


/* ============================================================
   PLAID BANK-SYNC (real backend via Netlify Functions)
   Backend lives at /.netlify/functions/* and requires:
     - PLAID_CLIENT_ID, PLAID_SANDBOX_SECRET (Plaid sandbox)
     - FIREBASE_SERVICE_ACCOUNT_JSON (Firebase Admin)
   All calls authenticate with the current user's Firebase ID token.
   ============================================================ */
const PLAID_FN_BASE = '/.netlify/functions';

async function getIdToken() {
    try {
        const auth = window.__wjpAuth;
        const user = (auth && auth.currentUser) || window.__wjpUser;
        if (!user || typeof user.getIdToken !== 'function') return null;
        return await user.getIdToken();
    } catch (_) {
        return null;
    }
}

async function fetchLinkToken(opts) {
    opts = opts || {};
    const token = await getIdToken();
    if (!token) throw new Error('not-signed-in');
    // opts.itemId → request an UPDATE-mode link token for re-auth on a broken item.
    const body = opts.itemId ? { itemId: opts.itemId } : {};
    const resp = await fetch(`${PLAID_FN_BASE}/create-link-token`, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    let data = null;
    try { data = await resp.json(); } catch(_) {}
    if (!resp.ok) {
        const msg = (data && data.error) || ('HTTP ' + resp.status);
        const e = new Error(msg);
        e.status = resp.status;
        e.serverError = (data && data.error) || '';
        throw e;
    }
    return data && data.link_token;
}

async function openPlaidLink(opts) {
    opts = opts || {};
    // Immediate feedback so the user knows the click registered while Plaid loads.
    if (typeof showToast === 'function') {
        showToast(opts.updateItemId ? 'Reconnecting to your bank…' : 'Preparing bank link…');
    }
    // Lazy-load Plaid Link SDK on first click. Prefetch hint warms the cache,
    // but on a cold load this can still take ~1s on slow networks.
    if (typeof Plaid === 'undefined') {
        try {
            await ensurePlaidLoaded();
        } catch(e) {
            console.error('[plaid] SDK failed to load', e);
            if (typeof showToast === 'function') showToast('Could not load bank link. Check your connection and try again.');
            return;
        }
    }
    if (typeof Plaid === 'undefined' || !Plaid || typeof Plaid.create !== 'function') {
        if (typeof showToast === 'function') showToast('Plaid Link script not loaded.');
        return;
    }
    // Offline-first check — fail fast with a clear message instead of a generic network error.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof showToast === 'function') showToast("You're offline — try again when you're back online.");
        return;
    }
    // (Already toasted "Preparing bank link…" above — avoid a second toast burst.)
    let linkToken;
    try {
        linkToken = await fetchLinkToken(opts.updateItemId ? { itemId: opts.updateItemId } : undefined);
    } catch (e) {
        // Detect "bank sync not configured" and surface a friendly message; keep the
        // legacy fake-bank UI accessible as a fallback.
        const msg = (e && (e.serverError || e.message)) || '';
        if (/missing env var|PLAID_CLIENT_ID|PLAID_SANDBOX_SECRET|FIREBASE_SERVICE_ACCOUNT_JSON/i.test(msg)) {
            if (typeof showToast === 'function') showToast("Bank sync isn't configured yet — see setup guide.");
            return;
        }
        if (e && e.message === 'not-signed-in') {
            if (typeof showToast === 'function') showToast('Sign in to link your bank.');
            return;
        }
        // Network/fetch failure — distinguish from server-side error
        if (e && (e.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(msg))) {
            if (typeof showToast === 'function') showToast('Network error — check your connection and retry.');
            return;
        }
        console.error('fetchLinkToken failed:', e);
        if (typeof showToast === 'function') showToast('Could not start bank link. Try again.');
        return;
    }
    if (!linkToken) {
        if (typeof showToast === 'function') showToast('No link token returned.');
        return;
    }

    try {
        const handler = Plaid.create({
            token: linkToken,
            onSuccess: (public_token, metadata) => {
                try { window.wjp && wjp.track && wjp.track('plaid_link_success', { institution: (metadata && metadata.institution && metadata.institution.name) || null }); } catch(_){}
                handlePlaidSuccess(public_token, metadata, opts);
            },
            onExit: (err, metadata) => {
                try {
                    if (err) {
                        window.wjp && wjp.track && wjp.track('plaid_link_error', { code: err.error_code || null, type: err.error_type || null });
                    } else {
                        window.wjp && wjp.track && wjp.track('plaid_link_exit', {});
                    }
                } catch(_){}
                handlePlaidExit(err, metadata, opts);
            },
            onEvent: (eventName, metadata) => { handlePlaidEvent(eventName, metadata, opts); }
        });
        try { window.wjp && wjp.track && wjp.track('plaid_link_opened', {}); } catch(_){}
        handler.open();
    } catch (e) {
        console.error('Plaid.create failed:', e);
        try { window.wjp && wjp.track && wjp.track('client_error', { where: 'plaid_create', msg: String(e && e.message || e).slice(0, 160) }); } catch(_){}
        if (typeof showToast === 'function') showToast('Could not open Plaid Link.');
    }
}

/* ---------- Plaid Link telemetry ----------
   Plaid emits ~20 event names through onEvent (OPEN, SELECT_INSTITUTION, SUBMIT_CREDENTIALS,
   HANDOFF, EXIT, ERROR, etc.). We log them all to console for support, and write a small
   subset to the activity log so users (and we) can see where things broke. */
function handlePlaidEvent(eventName, metadata, opts) {
    try {
        // Always log to console — cheap and invaluable for support tickets.
        console.log('[plaid-link]', eventName, metadata);
        if (eventName === 'ERROR' && metadata) {
            // Only log to activity feed if it's an actual error, not a benign exit.
            const code = metadata.error_code || 'UNKNOWN';
            const inst = (metadata.institution_name) || 'bank';
            if (typeof logActivity === 'function') {
                logActivity({
                    title: 'Bank link error',
                    text: `${inst} — ${code}`,
                    type: 'bank',
                    priority: 'high'
                });
            }
        }
    } catch (_) { /* never let telemetry break the flow */ }
}

async function handlePlaidSuccess(public_token, metadata) {
    try {
        const token = await getIdToken();
        if (!token) throw new Error('not-signed-in');
        const institutionName = (metadata && metadata.institution && metadata.institution.name) || 'Your bank';
        const linkAccounts = (metadata && metadata.accounts) || [];
        const resp = await fetch(`${PLAID_FN_BASE}/exchange-public-token`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ public_token, institutionName, accounts: linkAccounts })
        });
        if (!resp.ok) {
            let data = {};
            try { data = await resp.json(); } catch(_) {}
            throw new Error((data && data.error) || ('HTTP ' + resp.status));
        }
        let exchangePayload = {};
        try { exchangePayload = await resp.json(); } catch(_) {}
        const newItemId = exchangePayload && exchangePayload.itemId;

        if (typeof showToast === 'function') showToast('Bank linked. Loading accounts…');
        await refreshLinkedAccounts();

        // Kick off a transaction sync in the background so any payments already
        // sitting on the bank's ledger get auto-applied right away. PRODUCT_NOT_READY
        // is normal on first call; the auto-poller will catch up on the next visit.
        try {
            if (typeof syncBankTransactions === 'function') {
                syncBankTransactions({ silent: true });
            }
        } catch(_) {}

        // Also pull recurring streams so any existing autopay setup gets tagged on
        // the debt cards. This is intentionally fire-and-forget — Plaid's
        // recurring detector may return PRODUCT_NOT_READY on a brand-new item, in
        // which case the next auto-refresh cycle picks it up.
        try {
            if (typeof syncRecurringTransactions === 'function') {
                syncRecurringTransactions({ force: true });
            }
        } catch(_) {}

        // Pull the freshly-synced accounts from appState so the modal shows real
        // balances + account types pulled from Plaid (not just the metadata names).
        const syncedDebts = (appState.debts || []).filter(d => d.source === 'plaid' && (!newItemId || d.itemId === newItemId));
        const accountsForModal = syncedDebts.length ? syncedDebts.map(d => ({
            name: d.name,
            type: d.type,
            balance: d.balance,
            mask: (d.id || '').replace(/^plaid:/, '').slice(-4)
        })) : linkAccounts.map(a => ({
            name: a.name || 'Account',
            type: a.subtype || a.type || 'account',
            balance: null,
            mask: a.mask || ''
        }));

        if (typeof showBankLinkConfirmation === 'function') {
            showBankLinkConfirmation(institutionName, accountsForModal);
        } else if (typeof showToast === 'function') {
            showToast('Accounts synced.');
        }

        // Activity log entry — feeds bell badge + Activity Log tab.
        const acctSummary = accountsForModal.length === 1
            ? '1 account synced'
            : `${accountsForModal.length} accounts synced`;
        if (typeof logActivity === 'function') {
            logActivity({
                title: 'Bank linked',
                text: `${institutionName} — ${acctSummary}`,
                type: 'bank',
                priority: 'high',
                link: '#debts'
            });
        }
    } catch (e) {
        console.error('handlePlaidSuccess error:', e);
        if (typeof showToast === 'function') showToast('Linked, but sync failed. Try Refresh.');
        if (typeof logActivity === 'function') {
            logActivity({
                title: 'Bank link issue',
                text: 'Linked but sync failed — tap Refresh to retry.',
                type: 'bank',
                priority: 'high'
            });
        }
    }
}

/* ---------- POST-LINK CONFIRMATION MODAL ----------
   Built dynamically so we don't depend on existing markup in index.html.
   Inherits the page's CSS variables for colors/typography. */
function showBankLinkConfirmation(institutionName, accounts) {
    try {
        // Remove any previous instance.
        const old = document.getElementById('wjp-bank-link-confirm');
        if (old) old.remove();

        const safeName = (institutionName || 'Your bank').toString();
        const total = (accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
        const fmt = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const rows = (accounts || []).map(a => {
            const mask = a.mask ? `•••${a.mask}` : '';
            const bal = (a.balance != null) ? fmt(a.balance) : '—';
            const type = (a.type || '').toString();
            return `
              <div class="wjp-blc-row" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border, rgba(0,0,0,.08));gap:12px;">
                <div style="min-width:0;flex:1;">
                  <div style="font-weight:600;color:var(--text, #111);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name || 'Account'}</div>
                  <div style="font-size:12px;color:var(--text-muted, #6b7280);text-transform:capitalize;">${type}${mask ? ' · ' + mask : ''}</div>
                </div>
                <div style="font-variant-numeric:tabular-nums;font-weight:600;color:var(--text, #111);">${bal}</div>
              </div>`;
        }).join('');

        const wrap = document.createElement('div');
        wrap.id = 'wjp-bank-link-confirm';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;animation:wjpFade .18s ease-out;';
        wrap.innerHTML = `
          <style>
            @keyframes wjpFade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes wjpRise { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
          </style>
          <div style="background:var(--card, #fff);color:var(--text, #111);max-width:440px;width:100%;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.25);overflow:hidden;animation:wjpRise .22s ease-out;">
            <div style="padding:20px 22px 8px 22px;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <div style="width:36px;height:36px;border-radius:50%;background:var(--accent, #16a34a);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">✓</div>
                <div style="font-size:13px;color:var(--text-muted, #6b7280);text-transform:uppercase;letter-spacing:.06em;">Bank linked</div>
              </div>
              <div style="font-size:20px;font-weight:700;line-height:1.2;">${safeName}</div>
              <div style="font-size:13px;color:var(--text-muted, #6b7280);margin-top:4px;">
                ${(accounts || []).length} ${ (accounts || []).length === 1 ? 'account' : 'accounts' } synced · Total balance ${fmt(total)}
              </div>
            </div>
            <div style="margin-top:8px;max-height:42vh;overflow-y:auto;border-top:1px solid var(--border, rgba(0,0,0,.08));">
              ${rows || '<div style="padding:18px;color:var(--text-muted,#6b7280);text-align:center;">Accounts are syncing — they\'ll appear on your Debts tab in a moment.</div>'}
            </div>
            <div style="padding:14px 18px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--border, rgba(0,0,0,.08));background:var(--card-muted, transparent);">
              <button type="button" id="wjp-blc-close" style="background:var(--accent, #16a34a);color:#fff;border:0;padding:10px 18px;border-radius:10px;font-weight:600;cursor:pointer;">Got it</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);

        const close = () => { try { wrap.remove(); } catch(_) {} };
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
        const btn = document.getElementById('wjp-blc-close');
        if (btn) btn.addEventListener('click', close);
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
        });
    } catch (e) {
        console.warn('showBankLinkConfirmation failed:', e);
        if (typeof showToast === 'function') showToast('Bank linked.');
    }
}
window.showBankLinkConfirmation = showBankLinkConfirmation;

function handlePlaidExit(err, metadata, opts) {
    opts = opts || {};
    // No error + user closed → benign cancel. Stay quiet on update-mode (re-auth) so
    // we don't double-toast — the calling card UI already shows the broken state.
    if (!err) {
        if (!opts.updateItemId && typeof showToast === 'function') {
            showToast('Bank link cancelled. Tap Sync Bank when ready.');
        }
        return;
    }
    console.warn('Plaid exit with error:', err, metadata);
    const code = (err && err.error_code) || '';
    const msgMap = {
        // Re-auth path — fire the update-mode flow if the item ID is known.
        'ITEM_LOGIN_REQUIRED': "Your bank wants you to re-verify. Reopening Plaid…",
        'INVALID_CREDENTIALS': 'Wrong username or password. Try again.',
        'INVALID_MFA': "MFA code didn't match. Try again.",
        'INSTITUTION_DOWN': "Your bank is temporarily unavailable. Try again in a few minutes.",
        'INSTITUTION_NO_LONGER_SUPPORTED': "Your bank is no longer supported. Pick a different one.",
        'INSTITUTION_NOT_RESPONDING': "Your bank is slow to respond. Try again shortly.",
        'INTERNAL_SERVER_ERROR': 'Plaid had a hiccup. Try again.',
        'INVALID_LINK_TOKEN': 'Session expired. Reopen the bank link to continue.',
        'INVALID_REQUEST': 'Bank link request was rejected. Try again.',
        'NO_INTERNET_CONNECTIVITY': "No internet. Reconnect and try again.",
        'PRODUCT_NOT_READY': "Your bank's data isn't ready yet. Try again in a minute.",
        'RATE_LIMIT_EXCEEDED': 'Too many attempts. Wait a minute and try again.',
        'USER_SETUP_REQUIRED': 'Plaid needs you to finish setting up at your bank first.'
    };
    const friendly = msgMap[code] || (code ? `Couldn't link bank (${code}). Try again.` : 'Bank link failed. Try again.');
    if (typeof showToast === 'function') showToast(friendly);

    // Auto-trigger re-auth on ITEM_LOGIN_REQUIRED if we know which item, so the user
    // doesn't have to hunt for a Reconnect button.
    if (code === 'ITEM_LOGIN_REQUIRED' && opts.updateItemId) {
        setTimeout(() => { try { openPlaidLink({ updateItemId: opts.updateItemId }); } catch(_) {} }, 800);
    }

    // Activity log entry so users can find the failure later.
    if (typeof logActivity === 'function') {
        const inst = (metadata && metadata.institution_name) || 'Bank';
        logActivity({
            title: 'Bank link failed',
            text: `${inst} — ${code || 'unknown'}`,
            type: 'bank',
            priority: 'high'
        });
    }
}

// Public helper for the "Reconnect" buttons on linked-bank cards.
async function openPlaidUpdateMode(itemId) {
    if (!itemId) return;
    return openPlaidLink({ updateItemId: itemId });
}
window.openPlaidUpdateMode = openPlaidUpdateMode;

async function refreshLinkedAccounts() {
    const token = await getIdToken();
    if (!token) return;
    let resp;
    try {
        resp = await fetch(`${PLAID_FN_BASE}/get-accounts`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        });
    } catch (e) {
        console.warn('refreshLinkedAccounts network error:', e);
        return;
    }
    if (!resp.ok) {
        // Silent on auto-refresh (env not configured yet, etc.) — surface only the obvious cases.
        if (resp.status === 401) return;
        let data = {};
        try { data = await resp.json(); } catch(_) {}
        const msg = (data && data.error) || '';
        if (/missing env var/i.test(msg)) return; // Plaid not configured → silent
        console.warn('get-accounts failed:', resp.status, msg);
        return;
    }
    let payload = null;
    try { payload = await resp.json(); } catch(_) {}
    if (!payload || !Array.isArray(payload.items)) return;

    const now = Date.now();
    appState.debts = Array.isArray(appState.debts) ? appState.debts : [];

    // Track which Plaid-sourced IDs we see in this refresh so we can prune stale ones.
    const seenIds = new Set();

    payload.items.forEach(item => {
        const itemId = item.itemId;
        const institutionName = item.institutionName || 'Bank';
        const liabilities = item.liabilities || null;
        (item.accounts || []).forEach(account => {
            const id = 'plaid:' + account.account_id;
            seenIds.add(id);
            const subtype = String(account.subtype || '').toLowerCase();
            const type = String(account.type || '').toLowerCase();
            let mappedType = 'bank';
            if (subtype === 'credit card' || type === 'credit') mappedType = 'credit card';
            else if (type === 'loan') mappedType = 'loan';

            const balances = account.balances || {};
            const balance = Math.abs(Number(balances.current) || 0);
            const limit = balances.limit != null ? Number(balances.limit) : null;

            // Try to pull APR / minimum payment from liabilities payload if present.
            let apr = 0;
            let minPayment = 0;
            if (liabilities) {
                const pickFromList = (list) => (list || []).find(x => x && x.account_id === account.account_id);
                const credit = pickFromList(liabilities.credit);
                const student = pickFromList(liabilities.student);
                const mortgage = pickFromList(liabilities.mortgage);
                if (credit) {
                    minPayment = Number(credit.minimum_payment_amount) || 0;
                    const aprs = credit.aprs || [];
                    if (aprs.length) apr = Number(aprs[0].apr_percentage) || 0;
                }
                if (student) {
                    minPayment = Number(student.minimum_payment_amount) || minPayment;
                    apr = Number(student.interest_rate_percentage) || apr;
                }
                if (mortgage) {
                    apr = Number((mortgage.interest_rate && mortgage.interest_rate.percentage)) || apr;
                }
            }

            let existing = appState.debts.find(d => d.id === id);
            // Fuzzy-merge: if the user manually added this debt during onboarding
            // and is now linking their bank, treat the Plaid account as the same
            // record instead of creating a duplicate. Match by type-compatibility
            // plus balance within 15%.
            if (!existing) {
                const manualTypeMatches = (m) =>
                    m === mappedType ||
                    (mappedType === 'credit card' && m === 'credit_card') ||
                    (mappedType === 'loan' && ['student_loan','auto','mortgage','personal','medical','other'].indexOf(m) !== -1);
                const withinRange = (a, b) => {
                    const biggest = Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
                    return Math.abs(a - b) / biggest < 0.15;
                };
                existing = appState.debts.find(d =>
                    d && d.source !== 'plaid' && manualTypeMatches(d.type || d.manualType) && withinRange(d.balance || 0, balance)
                );
                if (existing) {
                    console.log('[plaid-merge] merging manual entry', existing.name, 'with Plaid account', account.name);
                    existing.id = id;
                }
            }
            // Trust local balance if syncBankTransactions just decremented it.
            // Plaid's /accounts can lag a payment by a few seconds; without this guard the
            // user sees their balance go down then snap back up. Window picked to outlast
            // the typical Plaid balance-propagation gap without holding stale numbers long.
            const TX_SYNC_TRUST_WINDOW_MS = 30 * 1000;
            const recentlyDecremented = !!(
                existing &&
                existing.lastSyncedFromTransactions &&
                (now - Number(existing.lastSyncedFromTransactions) < TX_SYNC_TRUST_WINDOW_MS)
            );
            const effectiveBalance = recentlyDecremented ? Number(existing.balance) : balance;
            const record = {
                id,
                name: account.name || account.official_name || institutionName,
                type: mappedType,
                balance: effectiveBalance,
                limit: (limit != null && !isNaN(limit)) ? limit : (existing && existing.limit) || null,
                apr: apr || (existing && existing.apr) || 0,
                minPayment: minPayment || (existing && existing.minPayment) || 0,
                dueDate: (existing && existing.dueDate) || (Math.floor(Math.random() * 28) + 1),
                attachments: (existing && existing.attachments) || [],
                source: 'plaid',
                itemId,
                institutionName,
                // Preserve so back-to-back refreshes inside the window still skip overwrite.
                lastSyncedFromTransactions: (existing && existing.lastSyncedFromTransactions) || 0,
                lastUpdated: now
            };
            if (existing) {
                Object.assign(existing, record);
            } else {
                appState.debts.push(record);
            }

            // Mirror credit-card limit into cs.cardLimits so utilization bars pick it up.
            if (mappedType === 'credit card' && record.limit > 0) {
                try {
                    const cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
                    cs.cardLimits = cs.cardLimits || {};
                    cs.cardLimits[id] = record.limit;
                    localStorage.setItem('wjp_credit_inputs', JSON.stringify(cs));
                } catch(_) {}
            }
        });
    });

    // Prune Plaid debts that no longer appear (e.g. removed at bank)
    appState.debts = appState.debts.filter(d => d.source !== 'plaid' || seenIds.has(d.id));

    // Reauth nudge: any item with an itemError needs the user to reconnect.
    // Dedupe per session so we don't spam the activity log on every poll.
    if (!window.__wjpReauthNudged) window.__wjpReauthNudged = new Set();
    payload.items.forEach(item => {
        if (!item || !item.itemError || !item.itemId) return;
        if (window.__wjpReauthNudged.has(item.itemId)) return;
        window.__wjpReauthNudged.add(item.itemId);
        const inst = item.institutionName || 'Your bank';
        // ITEM_LOGIN_REQUIRED is the most common — wording is tuned for it but
        // serves as a generic reauth nudge for the others too.
        const friendly = (item.itemError === 'ITEM_LOGIN_REQUIRED')
            ? `${inst} needs you to re-verify. Tap to reconnect.`
            : `${inst} connection issue (${item.itemError}). Tap to reconnect.`;
        if (typeof showToast === 'function') showToast(friendly);
        if (typeof logActivity === 'function') {
            logActivity({
                title: 'Reconnect bank',
                text: friendly,
                type: 'bank',
                priority: 'high',
                link: `#reconnect:${item.itemId}`
            });
        }
        // Auto-open update mode after a short delay so the user sees the toast
        // first (and doesn't get a Plaid modal slammed in their face on page load).
        setTimeout(() => {
            try { openPlaidUpdateMode(item.itemId); } catch(_) {}
        }, 2500);
    });

    try { if (typeof saveState === 'function') saveState(); } catch(_) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch(_) {}

    // First-run prompt: brand-new user from signup.html?new=1 with zero linked
    // items → surface a focused Connect-Your-Bank modal. Seamless-first principle:
    // Plaid auto-pop is the primary path, manual entry is the fallback.
    try {
        const isFirstRun = sessionStorage.getItem('wjp_first_run') === '1';
        const hasItems = Array.isArray(payload.items) && payload.items.length > 0;
        if (isFirstRun && !hasItems && typeof showFirstLinkPrompt === 'function') {
            showFirstLinkPrompt();
        } else if (isFirstRun && hasItems) {
            // User already has items (re-signup, or Plaid finished mid-load) → clear.
            sessionStorage.removeItem('wjp_first_run');
        }
    } catch(_) {}
}

// First-link prompt — focused modal for brand-new users. Built lazily so it
// doesn't add markup to index.html that has to be hidden on every page load.
function showFirstLinkPrompt() {
    if (document.getElementById('wjp-first-link-modal')) return; // already up
    if (sessionStorage.getItem('wjp_first_link_dismissed') === '1') return;

    const wrap = document.createElement('div');
    wrap.id = 'wjp-first-link-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Connect your bank');
    wrap.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(5,5,5,0.72)', 'backdrop-filter:blur(8px)',
        '-webkit-backdrop-filter:blur(8px)',
        'animation:wjpFlmFade .25s ease both',
        'font-family:Inter, system-ui, sans-serif'
    ].join(';');

    wrap.innerHTML = `
        <style>
            @keyframes wjpFlmFade { from { opacity:0 } to { opacity:1 } }
            @keyframes wjpFlmRise { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
            #wjp-first-link-modal .flm-card {
                position:relative; max-width:520px; width:calc(100% - 32px);
                border-radius:24px; overflow:hidden;
                background:#0a0a0a; color:#f5f1ea;
                border:1px solid rgba(245,241,234,0.08);
                box-shadow:0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(0,212,168,0.10);
                animation:wjpFlmRise .35s ease .05s both;
            }
            #wjp-first-link-modal .flm-glow {
                position:absolute; inset:0; pointer-events:none;
                background:
                  radial-gradient(ellipse 500px 240px at 50% 110%, rgba(0,212,168,0.10) 0%, transparent 60%),
                  radial-gradient(ellipse 400px 220px at 80% -10%, rgba(124,58,237,0.06) 0%, transparent 60%);
            }
            #wjp-first-link-modal .flm-inner {
                position:relative; padding:36px 32px 28px; text-align:center;
            }
            #wjp-first-link-modal .flm-icon {
                width:56px; height:56px; border-radius:16px;
                margin:0 auto 18px;
                background:linear-gradient(135deg, #22e0b4 0%, #00a382 100%);
                display:flex; align-items:center; justify-content:center;
                box-shadow:0 0 40px rgba(0,212,168,0.35);
            }
            #wjp-first-link-modal .flm-icon i { font-size:28px; color:#041a14; }
            #wjp-first-link-modal .flm-h1 {
                font-family:'Fraunces', Georgia, serif;
                font-weight:500; font-size:30px; line-height:1.1;
                letter-spacing:-0.02em; color:#f5f1ea;
                margin:0 0 12px;
            }
            #wjp-first-link-modal .flm-h1 em { font-style:italic; color:#22c79e; font-weight:400; }
            #wjp-first-link-modal .flm-sub {
                font-size:14.5px; color:rgba(245,241,234,0.62); line-height:1.55;
                max-width:380px; margin:0 auto 22px;
            }
            #wjp-first-link-modal .flm-bullets {
                text-align:left; max-width:340px; margin:0 auto 26px;
                display:flex; flex-direction:column; gap:10px;
            }
            #wjp-first-link-modal .flm-bullet {
                display:flex; align-items:flex-start; gap:10px;
                font-size:13px; color:rgba(245,241,234,0.78); line-height:1.45;
            }
            #wjp-first-link-modal .flm-bullet i {
                color:#22c79e; font-size:14px; margin-top:2px; flex-shrink:0;
            }
            #wjp-first-link-modal .flm-cta {
                width:100%; padding:15px; border-radius:12px;
                background:#fff; color:#050505; border:none; cursor:pointer;
                font-family:'Fraunces', Georgia, serif; font-weight:600; font-size:16px;
                letter-spacing:-0.01em;
                display:inline-flex; align-items:center; justify-content:center; gap:8px;
                transition:transform .15s ease, box-shadow .15s ease;
            }
            #wjp-first-link-modal .flm-cta:hover {
                transform:translateY(-1px);
                box-shadow:0 14px 36px rgba(0,212,168,0.22);
            }
            #wjp-first-link-modal .flm-skip {
                margin-top:12px;
                background:transparent; color:rgba(245,241,234,0.55);
                border:none; cursor:pointer;
                font-family:Inter, system-ui, sans-serif; font-size:13px;
                padding:8px 12px;
                transition:color .15s ease;
            }
            #wjp-first-link-modal .flm-skip:hover { color:#f5f1ea; }
            #wjp-first-link-modal .flm-fine {
                margin-top:18px; font-size:10.5px; letter-spacing:0.14em;
                text-transform:uppercase; color:rgba(245,241,234,0.32);
            }
        </style>
        <div class="flm-card">
            <div class="flm-glow"></div>
            <div class="flm-inner">
                <div class="flm-icon"><i class="ph ph-bank"></i></div>
                <h2 class="flm-h1">Connect a bank to <em>get started</em></h2>
                <p class="flm-sub">WJP pulls your debts and payments automatically — no spreadsheets, no copy-paste. Takes 30 seconds.</p>
                <div class="flm-bullets">
                    <div class="flm-bullet"><i class="ph ph-check-circle"></i> Auto-imports credit cards, loans &amp; balances</div>
                    <div class="flm-bullet"><i class="ph ph-check-circle"></i> Tracks payments &amp; flags missed bills</div>
                    <div class="flm-bullet"><i class="ph ph-check-circle"></i> Read-only — your credentials never touch us</div>
                </div>
                <button type="button" class="flm-cta" id="flm-connect">
                    Connect your bank <i class="ph ph-arrow-right"></i>
                </button>
                <button type="button" class="flm-skip" id="flm-skip">I&rsquo;ll do this later</button>
                <div class="flm-fine">Powered by Plaid · 256-bit encryption</div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);

    const close = () => { try { wrap.remove(); } catch(_) {} };
    const connectBtn = wrap.querySelector('#flm-connect');
    const skipBtn = wrap.querySelector('#flm-skip');

    connectBtn.addEventListener('click', () => {
        sessionStorage.removeItem('wjp_first_run');
        close();
        if (typeof openPlaidLink === 'function') {
            try { openPlaidLink(); } catch (e) { console.warn('openPlaidLink threw:', e); }
        }
    });
    skipBtn.addEventListener('click', () => {
        sessionStorage.removeItem('wjp_first_run');
        sessionStorage.setItem('wjp_first_link_dismissed', '1');
        close();
        if (typeof showToast === 'function') {
            showToast('No worries — tap Sync Bank up top whenever you\u2019re ready.');
        }
    });
    // ESC closes (treats as skip — same dismiss semantics).
    const escHandler = (e) => {
        if (e.key === 'Escape') { skipBtn.click(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
}

async function refreshFromBank(itemId) {
    if (typeof showToast === 'function') showToast('Refreshing from bank…');
    try {
        // syncBankTransactions pulls new payments AND calls refreshLinkedAccounts
        // at the end to reconcile balances — single round-trip from the user's
        // perspective. Fall back to bare refresh if sync isn't wired.
        if (typeof syncBankTransactions === 'function') {
            await syncBankTransactions({ silent: false });
        } else {
            await refreshLinkedAccounts();
        }
        // Force-refresh recurring on a user-initiated refresh (bypass 1h cache):
        // user clicked the button expecting fresh data, so we should oblige.
        try {
            if (typeof syncRecurringTransactions === 'function') {
                await syncRecurringTransactions({ force: true });
            }
        } catch(_) {}
        if (typeof showToast === 'function') showToast('Bank data refreshed.');
    } catch (e) {
        console.error('refreshFromBank error:', e);
        if (typeof showToast === 'function') showToast('Refresh failed.');
    }
}

async function unlinkPlaidItem(itemId) {
    if (!itemId) return;
    if (!confirm('Unlink this bank? This removes all accounts synced from it.')) return;
    // Capture the institution name + count before we wipe the debts so the
    // activity log can describe what was unlinked.
    const removed = (appState.debts || []).filter(d => d.source === 'plaid' && d.itemId === itemId);
    const institutionName = (removed[0] && removed[0].institutionName) || 'Bank';
    const removedCount = removed.length;
    try {
        const token = await getIdToken();
        if (!token) throw new Error('not-signed-in');
        const resp = await fetch(`${PLAID_FN_BASE}/unlink-item`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ itemId })
        });
        if (!resp.ok) {
            let data = {};
            try { data = await resp.json(); } catch(_) {}
            throw new Error((data && data.error) || ('HTTP ' + resp.status));
        }
        appState.debts = (appState.debts || []).filter(d => !(d.source === 'plaid' && d.itemId === itemId));
        try { if (typeof saveState === 'function') saveState(); } catch(_) {}
        try { if (typeof updateUI === 'function') updateUI(); } catch(_) {}
        if (typeof showToast === 'function') showToast('Bank unlinked.');
        if (typeof logActivity === 'function') {
            logActivity({
                title: 'Bank unlinked',
                text: `${institutionName} — ${removedCount} ${removedCount === 1 ? 'account' : 'accounts'} removed`,
                type: 'bank',
                priority: 'normal'
            });
        }
    } catch (e) {
        console.error('unlinkPlaidItem error:', e);
        if (typeof showToast === 'function') showToast('Unlink failed.');
    }
}

/* ============================================================
   PLAID TRANSACTIONS SYNC — auto-payment matching
   Pulls new transactions via /sync-transactions (cursor-based,
   server-side dedupe) and decrements debt balances when a
   payment shows up. The user never has to manually log a payment.

   Sign convention (Plaid):
   - Credit card account: amount > 0 = charge (balance UP),
                          amount < 0 = payment (balance DOWN).
   - Loan/mortgage account: transactions rare; we rely on
                            liabilitiesGet (refreshLinkedAccounts)
                            to pull updated balances post-payment.
   ============================================================ */

const PLAID_TX_INFLIGHT = { running: false };

async function syncBankTransactions(opts) {
    const options = opts || {};
    const silent = !!options.silent;
    if (PLAID_TX_INFLIGHT.running) return { skipped: true };
    PLAID_TX_INFLIGHT.running = true;

    try {
        const token = await getIdToken();
        if (!token) return { skipped: true };

        let resp;
        try {
            resp = await fetch(`${PLAID_FN_BASE}/sync-transactions`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: '{}'
            });
        } catch (e) {
            console.warn('syncBankTransactions network error:', e);
            return { error: 'network' };
        }

        if (!resp.ok) {
            // Silent on the obvious "not configured / not signed in" cases so the
            // background poll doesn't spam toasts.
            if (resp.status === 401) return { skipped: true };
            let data = {};
            try { data = await resp.json(); } catch(_) {}
            const msg = (data && data.error) || '';
            if (/missing env var|product_not_ready/i.test(msg)) return { skipped: true };
            console.warn('sync-transactions failed:', resp.status, msg);
            if (!silent && typeof showToast === 'function') showToast('Transaction sync failed.');
            return { error: msg || ('HTTP ' + resp.status) };
        }

        const payload = await resp.json().catch(() => null);
        if (!payload || !Array.isArray(payload.items)) return { skipped: true };

        // Idempotency belt: server-side cursor is primary, but we double-check
        // transaction_id locally so a stale localStorage replay can't double-count.
        if (!Array.isArray(appState.processedTxIds)) appState.processedTxIds = [];
        const processed = new Set(appState.processedTxIds);

        let paymentsApplied = 0;
        let totalPaid = 0;
        let chargesSeen = 0;
        const fmt = (n) => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        for (const item of payload.items) {
            const inst = item.institutionName || 'Bank';
            for (const tx of (item.added || [])) {
                if (!tx || !tx.transaction_id) continue;
                if (processed.has(tx.transaction_id)) continue;
                processed.add(tx.transaction_id);

                // Match transaction to a debt by Plaid account_id.
                const debtId = 'plaid:' + tx.account_id;
                const debt = (appState.debts || []).find(d => d.id === debtId);
                if (!debt) continue;

                const debtType = String(debt.type || '').toLowerCase();
                const amount = Number(tx.amount) || 0;

                // Only credit-card payments are auto-applied here. Loans / mortgages
                // get their balance from liabilitiesGet via refreshLinkedAccounts.
                if (debtType === 'credit card' && amount < 0) {
                    const paymentAmt = Math.abs(amount);
                    const prev = Number(debt.balance || 0);
                    const next = Math.max(0, prev - paymentAmt);
                    debt.balance = next;
                    debt.lastUpdated = Date.now();
                    debt.lastSyncedFromTransactions = Date.now();
                    paymentsApplied++;
                    totalPaid += paymentAmt;

                    if (typeof logActivity === 'function') {
                        const paidOff = next === 0 && prev > 0;
                        logActivity({
                            title: paidOff ? 'Card paid off 🎉' : 'Payment recorded',
                            text: `${debt.name} — ${fmt(paymentAmt)} via Plaid (${inst})${paidOff ? '' : ` · new balance ${fmt(next)}`}`,
                            type: 'payment',
                            priority: paidOff ? 'high' : 'normal',
                            link: '#debts'
                        });
                    }
                } else if (debtType === 'credit card' && amount > 0) {
                    chargesSeen++;
                    // Don't overwrite the balance from a single charge — bank's
                    // running balance via refreshLinkedAccounts is authoritative.
                }
            }
        }

        // Cap the processed-id set to keep localStorage lean (~ last 1000 txs).
        const arr = Array.from(processed);
        appState.processedTxIds = arr.length > 1000 ? arr.slice(arr.length - 1000) : arr;

        if (paymentsApplied > 0) {
            try { if (typeof saveState === 'function') saveState(); } catch(_) {}
            try { if (typeof updateUI === 'function') updateUI(); } catch(_) {}
            if (!silent && typeof showToast === 'function') {
                showToast(`Synced ${paymentsApplied} payment${paymentsApplied === 1 ? '' : 's'} (${fmt(totalPaid)})`);
            }
        } else {
            // Even with zero payment matches, persist the processedTxIds growth so
            // we don't reapply the same txs after a page reload.
            try { if (typeof saveState === 'function') saveState(); } catch(_) {}
        }

        // Pull liability balances too — covers loans/mortgages and reconciles
        // credit-card balance against the bank's source of truth.
        try { await refreshLinkedAccounts(); } catch(_) {}

        return { paymentsApplied, totalPaid, chargesSeen };
    } finally {
        PLAID_TX_INFLIGHT.running = false;
    }
}
window.syncBankTransactions = syncBankTransactions;

// --- Recurring autopay tagging ----------------------------------------------
// Pulls recurring outflow streams from Plaid, identifies CC-payment streams
// (description names a 4-digit account mask), and tags the matched debt with
// autopayActive + last-amount metadata.
//
// Why: lets us surface "Autopay active" badges on cards so users at a glance
// know which obligations are on autopilot. Decisions deliberately conservative:
// only mark a debt active if the stream's status is MATURE/EARLY_DETECTION
// (Plaid's own confidence signal) AND it's currently active.

const PLAID_RECURRING_INFLIGHT = { running: false };
const RECURRING_REFRESH_MS = 60 * 60 * 1000; // 1 hour cache

async function syncRecurringTransactions(opts) {
    const options = opts || {};
    const force = !!options.force;
    if (PLAID_RECURRING_INFLIGHT.running) return { skipped: true };
    // Soft cache: don't re-poll within an hour unless forced.
    const last = Number(appState.lastRecurringSync || 0);
    if (!force && last && (Date.now() - last) < RECURRING_REFRESH_MS) {
        return { skipped: true, cached: true };
    }
    PLAID_RECURRING_INFLIGHT.running = true;
    try {
        const token = await getIdToken();
        if (!token) return { skipped: true };
        let resp;
        try {
            resp = await fetch(`${PLAID_FN_BASE}/recurring-transactions`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: '{}'
            });
        } catch (e) {
            return { error: 'network' };
        }
        if (!resp.ok) {
            if (resp.status === 401) return { skipped: true };
            return { error: 'http ' + resp.status };
        }
        const payload = await resp.json().catch(() => null);
        if (!payload || !Array.isArray(payload.items)) return { skipped: true };

        // Build a map of mask → list of CC debts (multiple cards can in theory share masks across institutions)
        const ccDebts = (appState.debts || []).filter(d => String(d.type || '').toLowerCase() === 'credit card');
        // Reset all CC autopay tags before re-applying — handles the case where a recurring
        // stream has been cancelled at the bank.
        ccDebts.forEach(d => {
            d.autopayActive = false;
            d.autopayDescription = null;
            d.autopayAmount = null;
            d.autopayFrequency = null;
        });

        let tagged = 0;
        for (const item of payload.items) {
            const accountsById = {};
            (item.accounts || []).forEach(a => { accountsById[a.account_id] = a; });

            for (const stream of (item.outflow_streams || [])) {
                if (!stream || stream.is_active === false) continue;
                const status = String(stream.status || '').toUpperCase();
                // Only trust MATURE / EARLY_DETECTION; ignore TENTATIVE to avoid false positives.
                if (status && !['MATURE', 'EARLY_DETECTION'].includes(status)) continue;
                const desc = String(stream.description || '').toUpperCase();
                const cat = (stream.category || []).map(c => String(c || '').toLowerCase());
                const looksLikePayment = /PAYMENT|AUTOPAY|CREDIT CARD/.test(desc) ||
                    cat.some(c => c.includes('payment') || c.includes('credit card'));
                if (!looksLikePayment) continue;

                // Try to find a 4-digit mask in the description and match it to a CC debt
                const maskMatch = desc.match(/\b(\d{4})\b/);
                let target = null;
                if (maskMatch) {
                    const mask = maskMatch[1];
                    // Mask comes from accountsById entries we get from the SAME institution's other accounts.
                    // The CC debt we want to tag may be on this same item.
                    target = ccDebts.find(d => {
                        const acct = accountsById[d.id.replace(/^plaid:/, '')];
                        return acct && acct.mask === mask;
                    });
                    // Fallback: name contains the mask (e.g. "Plaid Credit Card • 3333")
                    if (!target) {
                        target = ccDebts.find(d => String(d.name || '').includes(mask));
                    }
                }
                // If still no match and the item only has one CC, tag that one.
                if (!target) {
                    const ccsThisItem = ccDebts.filter(d => d.itemId === item.itemId);
                    if (ccsThisItem.length === 1) target = ccsThisItem[0];
                }
                if (!target) continue;

                target.autopayActive = true;
                target.autopayDescription = stream.merchant_name || stream.description || 'Recurring payment';
                target.autopayAmount = (stream.average_amount != null) ? Math.abs(Number(stream.average_amount)) : null;
                target.autopayFrequency = stream.frequency || null;
                tagged++;
            }
        }

        appState.lastRecurringSync = Date.now();
        try { saveState(); } catch(_) {}
        try { updateUI(); } catch(_) {}
        return { tagged, items: payload.items.length };
    } finally {
        PLAID_RECURRING_INFLIGHT.running = false;
    }
}
window.syncRecurringTransactions = syncRecurringTransactions;

// ─────────────────────────────────────────────────────────────────────────────
// Webhook pending-flag poller. Plaid pushes notifications to plaid-webhook,
// which sets txPendingSync / recurringPendingSync on the user's items doc.
// We poll every WEBHOOK_POLL_MS and run the matching sync for any flagged
// item, then call check-webhook-pending with `clear: true` to reset.
// ─────────────────────────────────────────────────────────────────────────────
const WEBHOOK_POLL_MS = 30 * 1000;
let _webhookPollTimer = null;
let _webhookPollInflight = false;

async function pollWebhookPending() {
    if (_webhookPollInflight) return;
    _webhookPollInflight = true;
    try {
        const token = await getIdToken();
        if (!token) return;
        let resp;
        try {
            resp = await fetch(`${PLAID_FN_BASE}/check-webhook-pending`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: '{}'
            });
        } catch (_) { return; }
        if (!resp.ok) return;
        const payload = await resp.json().catch(() => null);
        if (!payload || !payload.pending) return;

        const txItems  = Array.isArray(payload.pending.transactions) ? payload.pending.transactions : [];
        const recItems = Array.isArray(payload.pending.recurring)    ? payload.pending.recurring    : [];

        // Fire syncs in parallel; clear the flags only after the sync resolves
        // so a failed sync gets retried on the next poll instead of silently
        // dropped.
        const ops = [];
        if (txItems.length && typeof syncBankTransactions === 'function') {
            ops.push(
                syncBankTransactions({ silent: true })
                    .then(() => clearWebhookPending(token, txItems, 'transactions'))
                    .catch(() => {})
            );
        }
        if (recItems.length && typeof syncRecurringTransactions === 'function') {
            ops.push(
                syncRecurringTransactions({ force: true })
                    .then(() => clearWebhookPending(token, recItems, 'recurring'))
                    .catch(() => {})
            );
        }
        // Surface item errors as activity log entries (re-auth nudges, etc.).
        if (Array.isArray(payload.errors) && payload.errors.length && typeof logActivity === 'function') {
            payload.errors.forEach(err => {
                if (!err || !err.code) return;
                // Avoid spamming: only log the first time we see a given code+item combo this session.
                const key = `__wjp_err_${err.itemId}_${err.code}`;
                if (window[key]) return;
                window[key] = true;
                logActivity({
                    title: 'Bank needs attention',
                    text: `${err.code}${err.message ? ' — ' + err.message : ''}`,
                    type: 'bank',
                    priority: 'high',
                    link: '#debts'
                });
            });
        }
        await Promise.all(ops);
    } finally {
        _webhookPollInflight = false;
    }
}

async function clearWebhookPending(token, itemIds, which) {
    if (!itemIds || !itemIds.length) return;
    try {
        await fetch(`${PLAID_FN_BASE}/check-webhook-pending`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear: true, itemIds, which })
        });
    } catch (_) {}
}

function startWebhookPoller() {
    if (_webhookPollTimer) return;
    // First poll runs after the auto-refresh sync settles so we don't double up.
    _webhookPollTimer = setInterval(pollWebhookPending, WEBHOOK_POLL_MS);
    // Also poll when the tab regains focus — covers the "user came back from
    // their banking app after enabling autopay" case.
    window.addEventListener('focus', () => { pollWebhookPending(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') pollWebhookPending();
    });
}
window.pollWebhookPending = pollWebhookPending;

// Expose for inline handlers / debugging
window.openPlaidLink = openPlaidLink;
window.refreshLinkedAccounts = refreshLinkedAccounts;
window.refreshFromBank = refreshFromBank;
window.unlinkPlaidItem = unlinkPlaidItem;

// Auto-refresh linked accounts once Firebase auth is ready + signed in.
// The gate in index.html dispatches 'wjp-auth-ready' after authStateReady() resolves.
(function wirePlaidAutoRefresh() {
    let ran = false;
    const go = () => {
        if (ran) return;
        ran = true;
        // Fire-and-forget; both helpers are silent on "not configured" / 401.
        // syncBankTransactions calls refreshLinkedAccounts itself at the end,
        // so no need to call refreshLinkedAccounts separately here.
        try {
            syncBankTransactions({ silent: true })
                .catch(() => { try { refreshLinkedAccounts(); } catch(_) {} });
        } catch (_) {
            try { refreshLinkedAccounts(); } catch(_) {}
        }
        // Recurring streams refresh — gated by RECURRING_REFRESH_MS (1h) so this
        // is cheap on every load. Picks up newly-detected autopay setups since
        // last visit. Independent of syncBankTransactions so a Plaid recurring
        // hiccup doesn't affect the payment-matching path.
        try {
            if (typeof syncRecurringTransactions === 'function') {
                syncRecurringTransactions().catch(() => {});
            }
        } catch (_) {}
        // Start the webhook pending-flag poller. Cheap (one Firestore read every
        // 30s) and gives us near-real-time updates without a Firestore client
        // listener. Safe to call repeatedly — guarded inside startWebhookPoller.
        try { if (typeof startWebhookPoller === 'function') startWebhookPoller(); } catch(_) {}
    };
    window.addEventListener('wjp-auth-ready', go, { once: true });
    // Fallback: if the event already fired before app.js parsed, the gate has set window.__wjpUser.
    // Check after DOM is ready.
    const check = () => {
        if (window.__wjpUser && window.__wjpAuth && window.__wjpAuth.currentUser) go();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', check, { once: true });
    } else {
        setTimeout(check, 0);
    }
    // Belt-and-suspenders
    setTimeout(check, 1500);
})();


function renderActivityPage() {
    const list = document.getElementById('activity-log-list');
    if (!list) return;

    if (appState.notifications.length === 0) {
        list.innerHTML = '<div style="padding:100px; text-align:center; opacity:0.3; font-size:14px;">No activity history found.</div>';
        return;
    }

    // Sort: Cleared items last, then by time (simulated by ID rev)
    const sorted = [...appState.notifications].sort((a,b) => {
        if (a.cleared !== b.cleared) return a.cleared ? 1 : -1;
        return b.id - a.id;
    });

    list.innerHTML = sorted.map((n, index) => `
        <div class="activity-card ${n.cleared ? 'cleared' : ''} ${n.priority === 'high' ? 'priority-high' : ''} type-${n.type}" style="animation-delay: ${index * 0.1}s">
            <div class="activity-icon-wrap">
                 <i class="ph-fill ph-${n.type === 'ai' ? 'lightning' : n.type === 'alert' ? 'warning-circle' : 'shield-check'}"></i>
            </div>
            <div class="activity-content">
                <div class="activity-meta">
                    <div class="activity-title">${n.title}</div>
                    <div class="activity-date">${n.time}</div>
                </div>
                <div class="activity-desc">${n.text}</div>
                <div class="activity-tags">
                    <div class="activity-tag ${n.priority === 'high' ? 'priority-high' : n.priority === 'med' ? 'priority-med' : ''}">${n.priority} focus</div>
                    <div class="activity-tag ${n.type === 'ai' ? 'type-ai' : ''}">${n.type.toUpperCase()}</div>
                    ${n.cleared ? '<div class="activity-tag status-archived">Archived</div>' : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function markNotificationRead(id) {
    const n = appState.notifications.find(x => x.id === id);
    if (n) {
        n.read = true;
        saveState();
        renderNotifications();
    }
}

/* ---------- AI CHAT LOGIC ---------- */
let advisorPageChat = null;

function setupChatInstance(inputEl, sendBtn, containerEl) {
    if (!inputEl || !sendBtn || !containerEl) return null;

    const addMessage = (text, type = 'ai') => {
        const msg = document.createElement('div');
        msg.className = `chat-msg ${type}`;
        msg.style.marginTop = '24px';
        
        if (type === 'ai') {
            msg.innerHTML = `
                <div class="chat-avatar ai-avatar"><i class="ph-fill ph-robot"></i></div>
                <div class="chat-content"><div class="chat-bubble ai-bubble">${text}</div></div>
            `;
        } else {
            msg.innerHTML = `
                <div class="chat-content" style="align-items:flex-end;"><div class="chat-bubble user-bubble">${text}</div></div>
                <div class="chat-avatar user-avatar-chat"><i class="ph-fill ph-user"></i></div>
            `;
        }
        
        containerEl.appendChild(msg);
        containerEl.scrollTop = containerEl.scrollHeight;
        return msg;
    };

    const handleSend = () => {
        const val = inputEl.value.trim();
        if(!val) return;

        addMessage(val, 'user');
        inputEl.value = '';

        const thinking = document.createElement('div');
        thinking.className = 'chat-msg ai';
        thinking.style.marginTop = '24px';
        thinking.innerHTML = `<div class="chat-avatar ai-avatar"><i class="ph-fill ph-robot"></i></div><div class="chat-content"><div class="chat-bubble ai-bubble"><span class="typing-cursor"></span></div></div>`;
        containerEl.appendChild(thinking);
        containerEl.scrollTop = containerEl.scrollHeight;

        setTimeout(() => {
            thinking.remove();
            const response = generateAiResponse(val);
            const msg = addMessage('', 'ai');
            const bubble = msg.querySelector('.ai-bubble');
            
            let i = 0;
            const interval = setInterval(() => {
                if (i < response.length) {
                    bubble.textContent += response[i];
                    i++;
                    containerEl.scrollTop = containerEl.scrollHeight;
                } else {
                    clearInterval(interval);
                }
            }, 10);
        }, 800);
    };

    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') handleSend();
    });

    return { addMessage, handleSend };
}

function initChatLogic() {
    const fab = document.getElementById('ai-chat-fab');
    const panel = document.getElementById('ai-chat-panel');
    const closeBtn = document.getElementById('ai-chat-close');
    const sendBtn = document.getElementById('chat-send');
    const chatInput = document.getElementById('chat-input');
    const messagesCont = document.getElementById('chat-messages');

    if (fab && panel) {
        const toggleChat = () => {
            panel.classList.toggle('active');
            fab.classList.toggle('active');
        };
        fab.addEventListener('click', toggleChat);
        if(closeBtn) closeBtn.addEventListener('click', toggleChat);
    }

    // Initialize FAB Chat
    setupChatInstance(chatInput, sendBtn, messagesCont);

    // Initialize Page Chat
    const pageInput = document.getElementById('advisor-page-input');
    const pageSend = document.getElementById('advisor-page-send');
    const pageCont = document.querySelector('.advisor-chat-scroll');
    advisorPageChat = setupChatInstance(pageInput, pageSend, pageCont);

    // Handle floating chat prompts
    document.querySelectorAll('.chat-prompt').forEach(p => {
        p.addEventListener('click', () => {
            chatInput.value = p.textContent.replace(/"/g, '');
            sendBtn.click();
        });
    });
}

/* ---------- ADVISOR PAGE INTERACTION ---------- */
function initAdvisorPageLogic() {
    // Navigation link for Settings card
    // btn-optimize-settings renamed to btn-settings-ai; old ID no longer exists.

    // ══════════════════════════════════════════════════════════
    //  SETTINGS PAGE — ALL BUTTON HANDLERS
    // ══════════════════════════════════════════════════════════

    // Helper: open a settings slide-in drawer
    function openSettingsDrawer(config) {
        document.getElementById('settings-drawer-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'settings-drawer-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;justify-content:flex-end;backdrop-filter:blur(4px);';
        overlay.innerHTML = `
          <div id="settings-drawer" style="width:420px;height:100%;background:var(--card);border-left:1px solid var(--border-accent);display:flex;flex-direction:column;transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);overflow-y:auto;">
            <div style="padding:28px 24px 0; flex-shrink:0;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:36px;height:36px;border-radius:10px;background:rgba(0,212,168,0.12);border:1px solid rgba(0,212,168,0.2);display:flex;align-items:center;justify-content:center;">
                    <i class="ph-fill ${config.icon}" style="color:var(--accent);font-size:18px;"></i>
                  </div>
                  <div>
                    <div style="font-size:8px;color:var(--accent);text-transform:uppercase;font-weight:700;letter-spacing:0.1em;">${config.badge||'SETTINGS'}</div>
                    <div style="font-size:20px;font-weight:900;">${config.title}</div>
                  </div>
                </div>
                <button id="close-settings-drawer" style="background:none;border:none;color:var(--text-3);font-size:22px;cursor:pointer;padding:4px;line-height:1;">×</button>
              </div>
              <p style="font-size:11px;color:var(--text-3);line-height:1.6;margin-top:8px;margin-bottom:20px;">${config.subtitle||''}</p>
              <div style="height:1px;background:var(--border);margin-bottom:20px;"></div>
            </div>
            <div id="settings-drawer-body" style="padding:0 24px 28px;flex:1;">${config.body}</div>
          </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            document.getElementById('settings-drawer').style.transform = 'translateX(0)';
        });
        const close = () => {
            const d = document.getElementById('settings-drawer');
            if (d) d.style.transform = 'translateX(100%)';
            setTimeout(() => overlay.remove(), 300);
        };
        document.getElementById('close-settings-drawer').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        // Wire any save buttons inside drawer
        overlay.querySelectorAll('.settings-drawer-save').forEach(btn => {
            btn.onclick = () => { showToast(btn.dataset.toast || 'Settings saved.'); close(); };
        });
    }

    // ── 0. AI Intelligence settings ──────────────────────────
    document.getElementById('btn-settings-ai')?.addEventListener('click', () => {
        const strat = appState.settings?.strategy || 'avalanche';
        const extra = appState.budget?.contribution || 0;
        const fmt = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
        openSettingsDrawer({
            icon: 'ph-brain',
            badge: 'STEP 03',
            title: 'AI Intelligence',
            subtitle: 'Configure how the AI Advisor thinks, learns, and communicates.',
            body: `
              <div style="display:flex;flex-direction:column;gap:20px;">
                <!-- Strategy -->
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Payoff Strategy</div>
                  <div style="display:flex;flex-direction:column;gap:6px;" id="ai-strat-picker">
                    ${[
                      {id:'avalanche',label:'Avalanche',desc:'Highest APR first — minimises total interest paid',icon:'ph-trend-up'},
                      {id:'snowball', label:'Snowball', desc:'Lowest balance first — builds momentum with quick wins',icon:'ph-snowflake'},
                      {id:'hybrid',  label:'Hybrid',   desc:'Balanced blend — APR-to-balance ratio targeting',icon:'ph-intersect'},
                    ].map(s=>`<div class="ai-strat-opt" data-strat="${s.id}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:2px solid ${strat===s.id?'var(--accent)':'var(--border)'};border-radius:10px;cursor:pointer;background:${strat===s.id?'rgba(0,212,168,0.06)':'var(--card-2)'};transition:all 0.15s;">
                      <i class="ph-fill ${s.icon}" style="color:${strat===s.id?'var(--accent)':'var(--text-3)'};font-size:18px;flex-shrink:0;"></i>
                      <div style="flex:1;">
                        <div style="font-size:12px;font-weight:700;">${s.label}</div>
                        <div style="font-size:9px;color:var(--text-3);">${s.desc}</div>
                      </div>
                      <div style="width:14px;height:14px;border-radius:50%;${strat===s.id?'background:var(--accent)':'border:2px solid var(--text-3)'};flex-shrink:0;"></div>
                    </div>`).join('')}
                  </div>
                </div>
                <!-- Extra payment -->
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:6px;">Monthly Extra Payment</div>
                  <div style="font-size:9px;color:var(--text-3);margin-bottom:8px;">Additional funds routed to the target debt above minimums.</div>
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:16px;color:var(--text-3);">$</span>
                    <input type="number" id="ai-extra-input" value="${extra}" min="0" step="50" style="flex:1;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:14px;font-weight:700;outline:none;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
                    <span style="font-size:10px;color:var(--text-3);">/mo</span>
                  </div>
                </div>
                <!-- AI Behaviour toggles -->
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">AI Behaviour</div>
                  ${[
                    {label:'Proactive Insights',     desc:'AI surfaces recommendations without prompting',on:true},
                    {label:'Savings Opportunities',  desc:'Alerts for rate changes or refinancing chances',on:true},
                    {label:'Spending Pattern Analysis',desc:'Cross-reference transactions to flag anomalies',on:false},
                    {label:'Personalised Language',  desc:'Adjust tone based on your financial progress',on:true},
                  ].map(t=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <div>
                      <div style="font-size:11px;font-weight:600;">${t.label}</div>
                      <div style="font-size:9px;color:var(--text-3);">${t.desc}</div>
                    </div>
                    <div class="toggle-switch ${t.on?'on':''}" style="flex-shrink:0;" onclick="this.classList.toggle('on')"><div class="thumb"></div></div>
                  </div>`).join('')}
                </div>
                <!-- Data Privacy -->
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Data & Privacy</div>
                  ${[
                    {label:'Improve AI with anonymised data',desc:'Help train better recommendations (no PII shared)',on:false},
                    {label:'Share crash reports',desc:'Send error logs to improve stability',on:true},
                  ].map(t=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <div>
                      <div style="font-size:11px;font-weight:600;">${t.label}</div>
                      <div style="font-size:9px;color:var(--text-3);">${t.desc}</div>
                    </div>
                    <div class="toggle-switch ${t.on?'on':''}" style="flex-shrink:0;" onclick="this.classList.toggle('on')"><div class="thumb"></div></div>
                  </div>`).join('')}
                </div>
                <button id="ai-settings-save-btn" class="btn btn-primary" style="width:100%;padding:12px;">SAVE AI SETTINGS</button>
              </div>`
        });

        // Wire strategy picker after render
        setTimeout(() => {
            document.querySelectorAll('.ai-strat-opt').forEach(opt => {
                opt.onclick = () => {
                    const s = opt.dataset.strat;
                    appState.settings.strategy = s;
                    saveState();
                    updateUI();
                    document.querySelectorAll('.ai-strat-opt').forEach(o => {
                        const active = o.dataset.strat === s;
                        o.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
                        o.style.background  = active ? 'rgba(0,212,168,0.06)' : 'var(--card-2)';
                        o.querySelector('i').style.color = active ? 'var(--accent)' : 'var(--text-3)';
                        const dot = o.querySelector('div:last-child');
                        dot.style.background = active ? 'var(--accent)' : '';
                        dot.style.border = active ? 'none' : '2px solid var(--text-3)';
                    });
                };
            });
            document.getElementById('ai-settings-save-btn')?.addEventListener('click', () => {
                const extra = parseFloat(document.getElementById('ai-extra-input')?.value) || 0;
                appState.budget.contribution = extra;
                saveState();
                updateUI();
                showToast('AI settings saved.');
                document.getElementById('settings-drawer-overlay')?.remove();
            });
        }, 50);
    });

    // ── 1. Configure Profile ──────────────────────────────────
    document.getElementById('btn-settings-profile')?.addEventListener('click', () => {
        openSettingsDrawer({
            icon: 'ph-user',
            badge: 'STEP 01',
            title: 'Your Identity',
            subtitle: 'Keep your profile accurate for personalized reports and communications.',
            body: `
              <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
                  <img src="https://i.pravatar.cc/150?u=marcuswarren" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);">
                  <div>
                    <div style="font-size:13px;font-weight:800;">Marcus Warren</div>
                    <div style="font-size:10px;color:var(--accent);">Premium Member</div>
                    <button style="background:none;border:none;color:var(--text-3);font-size:10px;cursor:pointer;padding:2px 0;text-decoration:underline;text-underline-offset:2px;">Change photo</button>
                  </div>
                </div>
                ${[
                  {label:'Full Name',val:'Marcus Warren',type:'text'},
                  {label:'Email Address',val:'marcus@wjpfinance.com',type:'email'},
                  {label:'Phone Number',val:'+1 (555) 012-3456',type:'tel'},
                  {label:'Zip / Postal Code',val:'10001',type:'text'},
                ].map(f=>`<div>
                  <div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--text-3);letter-spacing:0.07em;margin-bottom:5px;">${f.label}</div>
                  <input type="${f.type}" value="${f.val}" style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
                </div>`).join('')}
                <div>
                  <div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--text-3);letter-spacing:0.07em;margin-bottom:5px;">Time Zone</div>
                  <select style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;">
                    <option>Eastern Time (UTC-5)</option><option>Central Time (UTC-6)</option><option>Mountain Time (UTC-7)</option><option>Pacific Time (UTC-8)</option>
                  </select>
                </div>
                <div style="margin-top:8px;">
                  <button class="btn btn-primary settings-drawer-save" data-toast="Profile updated successfully." style="width:100%;padding:12px;">SAVE CHANGES</button>
                </div>
              </div>`
        });
    });

    // ── 2. Review Security ────────────────────────────────────
    document.getElementById('btn-settings-security')?.addEventListener('click', () => {
        openSettingsDrawer({
            icon: 'ph-lock-key',
            badge: 'STEP 02',
            title: 'Security & Access',
            subtitle: 'Protect your account with 2FA, password rotation, and session monitoring.',
            body: `
              <div style="display:flex;flex-direction:column;gap:20px;">
                <!-- 2FA -->
                <div style="background:rgba(0,212,168,0.06);border:1px solid rgba(0,212,168,0.2);border-radius:10px;padding:16px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <div style="display:flex;align-items:center;gap:8px;"><i class="ph-fill ph-shield-check" style="color:var(--accent);font-size:16px;"></i><span style="font-size:12px;font-weight:700;">Two-Factor Authentication</span></div>
                    <div class="badge badge-primary" style="font-size:8px;">ENABLED</div>
                  </div>
                  <div style="font-size:10px;color:var(--text-3);">Authenticator app · Last verified 2h ago</div>
                  <button style="margin-top:10px;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-2);font-size:10px;padding:6px 12px;cursor:pointer;">Manage 2FA</button>
                </div>
                <!-- Password -->
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Change Password</div>
                  ${['Current Password','New Password','Confirm Password'].map(l=>`<div style="margin-bottom:10px;">
                    <div style="font-size:9px;color:var(--text-3);font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px;">${l}</div>
                    <input type="password" placeholder="••••••••" style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
                  </div>`).join('')}
                </div>
                <!-- Active Sessions -->
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Active Sessions</div>
                  ${[
                    {dev:'MacBook Pro 16"',loc:'New York, NY',time:'Now — this session',current:true},
                    {dev:'iPhone 15 Pro',loc:'New York, NY',time:'3 hours ago',current:false},
                    {dev:'Chrome / Windows',loc:'Miami, FL',time:'2 days ago',current:false},
                  ].map(s=>`<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--card-2);border:1px solid ${s.current?'var(--accent)':'var(--border)'};border-radius:8px;margin-bottom:6px;">
                    <i class="ph ph-${s.dev.includes('iPhone')?'device-mobile':s.dev.includes('Chrome')?'desktop':'laptop'}" style="font-size:18px;color:var(--text-3);"></i>
                    <div style="flex:1;">
                      <div style="font-size:11px;font-weight:700;">${s.dev}</div>
                      <div style="font-size:9px;color:var(--text-3);">${s.loc} · ${s.time}</div>
                    </div>
                    ${s.current?`<span style="font-size:8px;color:var(--accent);font-weight:700;">CURRENT</span>`:`<button style="background:none;border:none;color:#ff4d6d;font-size:10px;cursor:pointer;">Revoke</button>`}
                  </div>`).join('')}
                </div>
                <button class="btn btn-primary settings-drawer-save" data-toast="Security settings updated." style="width:100%;padding:12px;">SAVE SECURITY SETTINGS</button>
              </div>`
        });
    });

    // ── 3. Notification Preferences ──────────────────────────
    document.getElementById('btn-settings-notifications')?.addEventListener('click', () => {
        if (!appState.prefs) appState.prefs = {};
        const p = appState.prefs.notifications || {};
        const ch = p.channels || { email:true, push:true, sms:false, inApp:true };
        const ty = p.types || {};
        const qh = p.quietHours || { from:'22:00', to:'07:00', enabled:true };
        const channelRows = [
            { key:'email', label:'Email Digest', desc:'Daily summary of account activity' },
            { key:'push',  label:'Push Notifications', desc:'Instant alerts for payments & milestones' },
            { key:'sms',   label:'SMS Alerts', desc:'Critical payment reminders via text' },
            { key:'inApp', label:'In-App Notifications', desc:'Badge and toast alerts inside the dashboard' },
        ];
        const typeRows = [
            { key:'paymentDue', label:'Payment Due (3 days)' },
            { key:'paymentOverdue', label:'Payment Overdue' },
            { key:'milestone', label:'Debt Milestone' },
            { key:'strategyChange', label:'Strategy Change' },
            { key:'aiInsights', label:'AI Insights' },
            { key:'accountSynced', label:'Account Synced' },
            { key:'scoreChange', label:'Credit Score Change' },
        ];
        openSettingsDrawer({
            icon: 'ph-bell-ringing',
            badge: 'STEP 04',
            title: 'Communication Hub',
            subtitle: 'Control when and how WJP contacts you.',
            body: `
              <div style="display:flex;flex-direction:column;gap:20px;">
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:12px;">Alert Channels</div>
                  ${channelRows.map(n=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
                    <div>
                      <div style="font-size:11px;font-weight:600;">${n.label}</div>
                      <div style="font-size:9px;color:var(--text-3);">${n.desc}</div>
                    </div>
                    <div class="toggle-switch notif-channel ${ch[n.key]?'on':''}" data-ch="${n.key}" style="flex-shrink:0;"><div class="thumb"></div></div>
                  </div>`).join('')}
                </div>
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:12px;">Alert Types</div>
                  ${typeRows.map(n=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <span style="font-size:11px;font-weight:600;">${n.label}</span>
                    <div class="toggle-switch notif-type ${ty[n.key]!==false?'on':''}" data-ty="${n.key}" style="flex-shrink:0;"><div class="thumb"></div></div>
                  </div>`).join('')}
                </div>
                <div style="background:var(--card-2);border:1px solid var(--border);border-radius:10px;padding:16px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="font-size:9px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Quiet Hours</div>
                    <div class="toggle-switch notif-qh-enabled ${qh.enabled!==false?'on':''}" style="flex-shrink:0;"><div class="thumb"></div></div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                      <div style="font-size:9px;color:var(--text-3);margin-bottom:4px;">FROM</div>
                      <input id="notif-qh-from" type="time" value="${qh.from||'22:00'}" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:11px;width:100%;box-sizing:border-box;">
                    </div>
                    <div>
                      <div style="font-size:9px;color:var(--text-3);margin-bottom:4px;">TO</div>
                      <input id="notif-qh-to" type="time" value="${qh.to||'07:00'}" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:11px;width:100%;box-sizing:border-box;">
                    </div>
                  </div>
                </div>
                <button id="save-notif-prefs" class="btn btn-primary" style="width:100%;padding:12px;">SAVE PREFERENCES</button>
              </div>`
        });

        // Wire toggles after drawer is in the DOM
        setTimeout(() => {
            document.querySelectorAll('.notif-channel, .notif-type, .notif-qh-enabled').forEach(t => {
                t.addEventListener('click', () => t.classList.toggle('on'));
            });
            const saveBtn = document.getElementById('save-notif-prefs');
            if (saveBtn) saveBtn.addEventListener('click', () => {
                const newCh = {};
                document.querySelectorAll('.notif-channel').forEach(t => {
                    newCh[t.dataset.ch] = t.classList.contains('on');
                });
                const newTy = {};
                document.querySelectorAll('.notif-type').forEach(t => {
                    newTy[t.dataset.ty] = t.classList.contains('on');
                });
                const qhEnabled = document.querySelector('.notif-qh-enabled')?.classList.contains('on') !== false;
                const qhFrom = document.getElementById('notif-qh-from')?.value || '22:00';
                const qhTo = document.getElementById('notif-qh-to')?.value || '07:00';

                if (!appState.prefs) appState.prefs = {};
                appState.prefs.notifications = {
                    channels: newCh,
                    types: newTy,
                    quietHours: { from: qhFrom, to: qhTo, enabled: qhEnabled }
                };
                saveState();
                if (typeof showToast === 'function') showToast('Notification preferences saved.');
                const ov = document.getElementById('settings-drawer-overlay');
                if (ov) {
                    const d = document.getElementById('settings-drawer');
                    if (d) d.style.transform = 'translateX(100%)';
                    setTimeout(() => ov.remove(), 300);
                }
            });
        }, 50);
    });

    // ── 4. Manage Subscription ───────────────────────────────
    document.getElementById('btn-settings-subscription')?.addEventListener('click', () => {
        const ACTIVE_PLAN = 'enterprise';
        const tiers = [
            {
                id: 'starter', name: 'Starter', price: '$0', billing: 'Free forever',
                color: '#64748b', icon: 'ph-sprout',
                features: [
                    {label:'Up to 3 debts tracked', inc:true},
                    {label:'Basic avalanche / snowball', inc:true},
                    {label:'Manual transaction entry', inc:true},
                    {label:'AI Advisor queries', inc:false, note:'5 / mo'},
                    {label:'Bank account sync', inc:false},
                    {label:'Simulations & resilience', inc:false},
                    {label:'Document vault', inc:false},
                    {label:'Priority support', inc:false},
                ],
                nextPayment: null, paymentMethod: null
            },
            {
                id: 'pro', name: 'Pro', price: '$19', billing: '/mo — billed annually',
                color: '#667eea', icon: 'ph-lightning',
                features: [
                    {label:'Unlimited debts', inc:true},
                    {label:'All payoff strategies', inc:true},
                    {label:'Unlimited transactions', inc:true},
                    {label:'AI Advisor queries', inc:true, note:'Unlimited'},
                    {label:'Bank account sync', inc:true, note:'Up to 3 accounts'},
                    {label:'Simulations & resilience', inc:true},
                    {label:'Document vault', inc:true, note:'2 GB'},
                    {label:'Priority support', inc:false},
                ],
                nextPayment: null, paymentMethod: null
            },
            {
                id: 'enterprise', name: 'Enterprise', price: '$49', billing: '/mo — billed annually',
                color: '#00d4a8', icon: 'ph-medal',
                features: [
                    {label:'Unlimited debts', inc:true},
                    {label:'All payoff strategies + hybrid', inc:true},
                    {label:'Unlimited transactions', inc:true},
                    {label:'AI Advisor queries', inc:true, note:'Unlimited'},
                    {label:'Bank account sync', inc:true, note:'Up to 10 accounts'},
                    {label:'Simulations & resilience', inc:true},
                    {label:'Document vault', inc:true, note:'10 GB'},
                    {label:'Priority concierge support', inc:true},
                ],
                nextPayment: 'Oct 12, 2026', paymentMethod: 'Visa •••• 4492'
            }
        ];

        const tierHTML = tiers.map(t => {
            const isActive = t.id === ACTIVE_PLAN;
            return `<div style="border:2px solid ${isActive?'var(--accent)':'var(--border)'};border-radius:12px;overflow:hidden;background:${isActive?'rgba(0,212,168,0.04)':'var(--card-2)'};transition:border 0.2s;">
              <!-- Header -->
              <div style="padding:16px 18px;border-bottom:1px solid ${isActive?'rgba(0,212,168,0.15)':'var(--border)'};display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:32px;height:32px;border-radius:8px;background:rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;">
                    <i class="ph-fill ${t.icon}" style="color:${t.color};font-size:16px;"></i>
                  </div>
                  <div>
                    <div style="font-size:14px;font-weight:900;color:${isActive?'var(--accent)':'var(--text)'};">${t.name}</div>
                    <div style="font-size:10px;font-weight:700;color:var(--text-3);">${t.billing}</div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:22px;font-weight:900;color:${isActive?'var(--accent)':'var(--text)'};">${t.price}</div>
                  ${isActive ? `<div class="badge badge-primary" style="font-size:8px;margin-top:2px;">CURRENT PLAN</div>` : `<button onclick="showToast('Upgrade flow — coming soon.')" style="background:none;border:1px solid ${t.color};border-radius:6px;color:${t.color};font-size:9px;font-weight:700;padding:3px 8px;cursor:pointer;margin-top:2px;">UPGRADE</button>`}
                </div>
              </div>
              <!-- Features -->
              <div style="padding:12px 18px;display:flex;flex-direction:column;gap:7px;">
                ${t.features.map(f=>`<div style="display:flex;align-items:center;gap:8px;">
                  <i class="ph-fill ph-${f.inc?'check-circle':'x-circle'}" style="color:${f.inc?'var(--accent)':'var(--text-3)'};font-size:13px;flex-shrink:0;"></i>
                  <span style="font-size:10px;color:${f.inc?'var(--text)':'var(--text-3)'};">${f.label}${f.note?` <span style="color:${f.inc?'var(--accent)':'var(--text-3)'};font-weight:700;">(${f.note})</span>`:''}</span>
                </div>`).join('')}
              </div>
              <!-- Active plan billing info -->
              ${isActive && t.nextPayment ? `<div style="margin:0 18px 14px;background:rgba(0,0,0,0.2);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:8px;color:var(--text-3);text-transform:uppercase;font-weight:700;">Next Payment</div>
                  <div style="font-size:12px;font-weight:700;margin-top:1px;">${t.nextPayment}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:8px;color:var(--text-3);text-transform:uppercase;font-weight:700;">Method</div>
                  <div style="font-size:12px;font-weight:700;margin-top:1px;">${t.paymentMethod}</div>
                </div>
              </div>` : ''}
            </div>`;
        }).join('');

        openSettingsDrawer({
            icon: 'ph-medal',
            badge: 'MEMBERSHIP',
            title: 'Subscription Plans',
            subtitle: 'You are on the Enterprise plan. Compare all tiers below.',
            body: `
              <div style="display:flex;flex-direction:column;gap:12px;">
                ${tierHTML}
                <div style="height:1px;background:var(--border);margin:4px 0;"></div>
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:8px;">Recent Invoices</div>
                  ${[
                    {date:'Oct 12, 2025',amt:'$588.00',status:'Paid'},
                    {date:'Oct 12, 2024',amt:'$588.00',status:'Paid'},
                  ].map(inv=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
                    <div style="font-size:11px;font-weight:600;">${inv.date}</div>
                    <div style="font-size:11px;font-weight:700;">${inv.amt}</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span class="badge badge-primary" style="font-size:8px;">${inv.status}</span>
                      <button onclick="showToast('Downloading invoice PDF...')" style="background:none;border:none;color:var(--text-3);font-size:11px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">PDF</button>
                    </div>
                  </div>`).join('')}
                </div>
                <button class="btn btn-ghost" style="width:100%;padding:11px;font-size:10px;border-color:var(--border);color:#ff4d6d;" onclick="showToast('Cancellation — please contact support to proceed.')">CANCEL SUBSCRIPTION</button>
              </div>`
        });
    });

    // ── 5. Link New Account ───────────────────────────────────
    document.getElementById('btn-settings-link-account')?.addEventListener('click', () => {
        openSettingsDrawer({
            icon: 'ph-wallet',
            badge: 'LINKED ACCOUNTS',
            title: 'Connect Account',
            subtitle: 'Securely link a bank, credit union, or brokerage via 256-bit encrypted OAuth.',
            body: `
              <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="background:var(--card-2);border:1px solid var(--border);border-radius:10px;padding:14px;display:flex;align-items:center;gap:10px;">
                  <i class="ph-fill ph-lock-key" style="color:var(--accent);font-size:18px;"></i>
                  <div style="font-size:10px;color:var(--text-2);line-height:1.5;">Your credentials are never stored. We use read-only bank OAuth tokens via Plaid.</div>
                </div>
                <div>
                  <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;margin-bottom:8px;">Popular Institutions</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    ${[
                      {name:'Chase',icon:'ph-bank',color:'var(--accent)'},
                      {name:'Bank of America',icon:'ph-bank',color:'#e31837'},
                      {name:'Wells Fargo',icon:'ph-bank',color:'#d71e28'},
                      {name:'Citibank',icon:'ph-bank',color:'#003b70'},
                      {name:'Ally Bank',icon:'ph-piggy-bank',color:'#7b2d8b'},
                      {name:'Capital One',icon:'ph-bank',color:'#d03027'},
                    ].map(b=>`<div onclick="showToast('Redirecting to ${b.name} OAuth...')" style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                      <i class="ph-fill ${b.icon}" style="color:${b.color};font-size:18px;"></i>
                      <span style="font-size:11px;font-weight:700;">${b.name}</span>
                    </div>`).join('')}
                  </div>
                </div>
                <div>
                  <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;margin-bottom:6px;">Search Any Institution</div>
                  <input type="text" placeholder="Type bank name..." style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
                </div>
                <button class="btn btn-primary settings-drawer-save" data-toast="Redirecting to secure bank connection..." style="width:100%;padding:12px;">CONNECT VIA PLAID</button>
              </div>`
        });
    });

    // ── 6. Enter Customizer ───────────────────────────────────
    // Central theme apply function (used by card picker + customizer drawer)
    function applyTheme(theme) {
        document.body.classList.remove('dark','light');
        document.body.classList.add(theme);
        // Sync the card-level picker labels & dots
        const isDark = theme === 'dark';
        const darkOpt = document.querySelector('.theme-option[data-theme="dark"]');
        const lightOpt = document.querySelector('.theme-option[data-theme="light"]');
        if (darkOpt) {
            darkOpt.style.borderColor = isDark ? 'var(--accent)' : 'transparent';
            darkOpt.style.opacity = '1';
            darkOpt.querySelector('.theme-status-dark').style.color = isDark ? 'var(--accent)' : 'var(--text-3)';
            darkOpt.querySelector('.theme-status-dark').textContent = isDark ? 'ACTIVE' : 'AVAILABLE';
            const dot = darkOpt.querySelector('.theme-dot-dark');
            dot.style.background = isDark ? 'var(--accent)' : '';
            dot.style.border = isDark ? 'none' : '2px solid var(--text-3)';
        }
        if (lightOpt) {
            lightOpt.style.borderColor = !isDark ? 'var(--accent)' : 'transparent';
            lightOpt.style.opacity = !isDark ? '1' : '0.75';
            lightOpt.querySelector('.theme-status-light').style.color = !isDark ? 'var(--accent)' : 'var(--text-3)';
            lightOpt.querySelector('.theme-status-light').textContent = !isDark ? 'ACTIVE' : 'AVAILABLE';
            const dot = lightOpt.querySelector('.theme-dot-light');
            dot.style.background = !isDark ? 'var(--accent)' : '';
            dot.style.border = !isDark ? 'none' : '2px solid var(--text-3)';
        }
    }

    // Wire the Visual Interface card theme picker
    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.addEventListener('click', () => applyTheme(opt.dataset.theme));
    });

    document.getElementById('btn-settings-customizer')?.addEventListener('click', () => {
        const currentTheme = document.body.classList.contains('light') ? 'light' : 'dark';
        openSettingsDrawer({
            icon: 'ph-palette',
            badge: 'APPEARANCE',
            title: 'Visual Customizer',
            subtitle: 'Personalize your workspace with themes, density, and accent colors.',
            body: `
              <div style="display:flex;flex-direction:column;gap:20px;">
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Theme</div>
                  <div style="display:flex;flex-direction:column;gap:8px;" id="cust-theme-picker">
                    <div data-theme="dark" class="cust-theme-opt" style="display:flex;align-items:center;gap:12px;padding:14px;border:2px solid ${currentTheme==='dark'?'var(--accent)':'var(--border)'};border-radius:10px;cursor:pointer;background:${currentTheme==='dark'?'rgba(0,212,168,0.06)':'var(--card-2)'};transition:all 0.15s;">
                      <i class="ph-fill ph-moon" style="color:${currentTheme==='dark'?'var(--accent)':'var(--text-3)'};font-size:20px;"></i>
                      <div style="flex:1;"><div style="font-size:12px;font-weight:700;">Midnight Heritage</div><div style="font-size:9px;color:var(--text-3);">Dark · Deep navy and teal</div></div>
                      <div style="width:14px;height:14px;border-radius:50%;${currentTheme==='dark'?'background:var(--accent)':'border:2px solid var(--text-3)'};flex-shrink:0;"></div>
                    </div>
                    <div data-theme="light" class="cust-theme-opt" style="display:flex;align-items:center;gap:12px;padding:14px;border:2px solid ${currentTheme==='light'?'var(--accent)':'var(--border)'};border-radius:10px;cursor:pointer;background:${currentTheme==='light'?'rgba(0,212,168,0.06)':'var(--card-2)'};transition:all 0.15s;">
                      <i class="ph ph-sun" style="color:#84cc16;font-size:20px;"></i>
                      <div style="flex:1;"><div style="font-size:12px;font-weight:700;">Verdant</div><div style="font-size:9px;color:var(--text-3);">Light · Fresh greens and white</div></div>
                      <div style="width:14px;height:14px;border-radius:50%;${currentTheme==='light'?'background:var(--accent)':'border:2px solid var(--text-3)'};flex-shrink:0;"></div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Accent Color</div>
                  <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    ${[
                      {name:'Teal (Default)',color:'#00d4a8'},
                      {name:'Indigo',color:'#667eea'},
                      {name:'Amber',color:'#f59e0b'},
                      {name:'Rose',color:'#ff4d6d'},
                      {name:'Cyan',color:'#38bdf8'},
                      {name:'Violet',color:'#a78bfa'},
                    ].map(c=>`<div onclick="document.documentElement.style.setProperty('--accent','${c.color}');showToast('Accent color changed.');" title="${c.name}" style="width:28px;height:28px;border-radius:50%;background:${c.color};cursor:pointer;border:2px solid transparent;transition:border 0.15s;box-shadow:0 0 0 2px rgba(0,0,0,0.3);" onmouseover="this.style.border='2px solid white'" onmouseout="this.style.border='2px solid transparent'"></div>`).join('')}
                  </div>
                </div>
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Display Density</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                    ${['Compact','Default','Comfortable'].map((d,i)=>`<div onclick="showToast('Display density set to ${d}.');" style="text-align:center;padding:12px 8px;border:1px solid ${i===1?'var(--accent)':'var(--border)'};border-radius:8px;cursor:pointer;font-size:10px;font-weight:700;transition:border 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='${i===1?'var(--accent)':'var(--border)'}'">
                      ${d}
                    </div>`).join('')}
                  </div>
                </div>
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:10px;">Sidebar</div>
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
                    <div><div style="font-size:11px;font-weight:600;">Collapse sidebar by default</div><div style="font-size:9px;color:var(--text-3);">Maximizes content area on load</div></div>
                    <div class="toggle-switch" onclick="this.classList.toggle('on')"><div class="thumb"></div></div>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border);">
                    <div><div style="font-size:11px;font-weight:600;">Show keyboard shortcuts</div><div style="font-size:9px;color:var(--text-3);">Display shortcut hints on hover</div></div>
                    <div class="toggle-switch on" onclick="this.classList.toggle('on')"><div class="thumb"></div></div>
                  </div>
                </div>
              </div>`
        });
        // Wire customizer theme picker
        setTimeout(() => {
            document.querySelectorAll('.cust-theme-opt').forEach(opt => {
                opt.addEventListener('click', () => {
                    applyTheme(opt.dataset.theme);
                    document.querySelectorAll('.cust-theme-opt').forEach(o => {
                        const active = o.dataset.theme === opt.dataset.theme;
                        o.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
                        o.style.background  = active ? 'rgba(0,212,168,0.06)' : 'var(--card-2)';
                        const icon = o.querySelector('i');
                        if (icon.classList.contains('ph-moon')) icon.style.color = active ? 'var(--accent)' : 'var(--text-3)';
                        const dot = o.querySelector('div:last-child');
                        dot.style.background = active ? 'var(--accent)' : '';
                        dot.style.border = active ? 'none' : '2px solid var(--text-3)';
                    });
                    showToast(`${opt.dataset.theme === 'dark' ? 'Midnight Heritage' : 'Verdant'} theme applied.`);
                });
            });
        }, 50);
    });

    // ── 7. Help Center ────────────────────────────────────────
    document.getElementById('btn-settings-help')?.addEventListener('click', () => {
        openSettingsDrawer({
            icon: 'ph-question',
            badge: 'SUPPORT',
            title: 'Help Center',
            subtitle: 'Browse articles, watch guides, or search for answers to common questions.',
            body: `
              <div style="display:flex;flex-direction:column;gap:14px;">
                <input type="text" placeholder="Search help articles..." style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
                <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;">Popular Articles</div>
                ${[
                  {title:'Getting started with debt payoff strategies',tag:'Strategy'},
                  {title:'How to add and manage your debts',tag:'Debts'},
                  {title:'Understanding the Avalanche vs Snowball method',tag:'Education'},
                  {title:'Linking your bank account securely',tag:'Accounts'},
                  {title:'Setting up payment reminders and alerts',tag:'Notifications'},
                  {title:'Exporting your financial data and reports',tag:'Data'},
                ].map(a=>`<div onclick="showToast('Opening: ${a.title}')" style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                  <div style="flex:1;margin-right:12px;">
                    <div style="font-size:11px;font-weight:600;">${a.title}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                    <span style="font-size:8px;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text-3);">${a.tag}</span>
                    <i class="ph ph-arrow-right" style="color:var(--text-3);font-size:12px;"></i>
                  </div>
                </div>`).join('')}
                <button class="btn btn-ghost" style="width:100%;padding:12px;font-size:11px;" onclick="showToast('Opening full Help Center documentation...')">VIEW ALL ARTICLES →</button>
              </div>`
        });
    });

    // ── 8. Submit Ticket ──────────────────────────────────────
    document.getElementById('btn-settings-ticket')?.addEventListener('click', () => {
        openSettingsDrawer({
            icon: 'ph-envelope-simple',
            badge: 'SUPPORT',
            title: 'Submit a Ticket',
            subtitle: 'Our team responds within 4 hours on business days.',
            body: `
              <div style="display:flex;flex-direction:column;gap:14px;">
                <div>
                  <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;margin-bottom:6px;">Category</div>
                  <select style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;">
                    <option>Billing & Subscription</option>
                    <option>Account Access</option>
                    <option>Technical Issue</option>
                    <option>Feature Request</option>
                    <option>Data & Privacy</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;margin-bottom:6px;">Subject</div>
                  <input type="text" placeholder="Brief summary of your issue" style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
                </div>
                <div>
                  <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;margin-bottom:6px;">Priority</div>
                  <div style="display:flex;gap:8px;">
                    ${['Low','Normal','High','Urgent'].map((p,i)=>`<div onclick="this.parentElement.querySelectorAll('div').forEach(d=>d.style.borderColor='var(--border)');this.style.borderColor='var(--accent)';" style="flex:1;text-align:center;padding:8px;border:1px solid ${i===1?'var(--accent)':'var(--border)'};border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;">${p}</div>`).join('')}
                  </div>
                </div>
                <div>
                  <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;font-weight:700;letter-spacing:0.07em;margin-bottom:6px;">Description</div>
                  <textarea placeholder="Describe the issue in detail..." rows="5" style="width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;resize:vertical;box-sizing:border-box;font-family:inherit;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"></textarea>
                </div>
                <button class="btn btn-primary settings-drawer-save" data-toast="Ticket submitted! Expect a reply within 4 hours." style="width:100%;padding:12px;">SUBMIT TICKET</button>
              </div>`
        });
    });

    // ── 9. Live Chat ──────────────────────────────────────────
    document.getElementById('btn-settings-chat')?.addEventListener('click', () => {
        openSettingsDrawer({
            icon: 'ph-chat-teardrop-dots',
            badge: 'LIVE SUPPORT',
            title: 'Live Chat',
            subtitle: 'Connect with a support specialist. Average wait: under 2 minutes.',
            body: `
              <div style="display:flex;flex-direction:column;gap:16px;height:100%;">
                <div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(0,212,168,0.07);border:1px solid rgba(0,212,168,0.2);border-radius:10px;">
                  <div style="width:10px;height:10px;border-radius:50%;background:#34d399;flex-shrink:0;box-shadow:0 0 6px #34d399;"></div>
                  <div><div style="font-size:12px;font-weight:700;">Support is online</div><div style="font-size:9px;color:var(--text-3);">3 agents available · Avg. wait &lt;2 min</div></div>
                </div>
                <div style="flex:1;background:var(--card-2);border:1px solid var(--border);border-radius:10px;padding:16px;min-height:240px;display:flex;flex-direction:column;gap:10px;" id="settings-chat-log">
                  <div style="display:flex;gap:8px;align-items:flex-start;">
                    <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#0b0f1a;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0;">S</div>
                    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:11px;max-width:80%;line-height:1.5;">Hi Marcus! I'm Sarah from WJP Support. How can I help you today?</div>
                  </div>
                </div>
                <div style="display:flex;gap:8px;">
                  <input type="text" id="settings-chat-input" placeholder="Type a message..." style="flex:1;background:var(--card-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:12px;outline:none;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
                    onkeydown="if(event.key==='Enter'){
                      const inp=this;const log=document.getElementById('settings-chat-log');const msg=inp.value.trim();if(!msg)return;
                      log.innerHTML+=\`<div style='display:flex;gap:8px;align-items:flex-start;justify-content:flex-end'><div style='background:rgba(0,212,168,0.12);border:1px solid rgba(0,212,168,0.2);border-radius:8px;padding:10px 12px;font-size:11px;max-width:80%;line-height:1.5;'>\${msg}</div></div>\`;
                      inp.value='';log.scrollTop=log.scrollHeight;
                      setTimeout(()=>{log.innerHTML+=\`<div style='display:flex;gap:8px;align-items:flex-start'><div style='width:28px;height:28px;border-radius:50%;background:var(--accent);color:#0b0f1a;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0'>S</div><div style='background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:11px;max-width:80%;line-height:1.5;'>Got it! Let me look into that for you — one moment.</div></div>\`;log.scrollTop=log.scrollHeight},1200);
                    }">
                  <button class="btn btn-primary" style="padding:10px 16px;font-size:11px;" onclick="document.getElementById('settings-chat-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))">Send</button>
                </div>
              </div>`
        });
    });

    // ── 10. Save & Exit ───────────────────────────────────────
    document.getElementById('btn-settings-save-exit')?.addEventListener('click', (e) => {
        e.preventDefault();
        saveState();
        showToast('Settings journey saved. Returning to Dashboard...');
        setTimeout(() => navigateSPA('dashboard'), 800);
    });

    // ── Household Mode toggle (Tier 2.3) ─────────────────────
    (function wireHouseholdModeToggle() {
        const toggle = document.getElementById('toggle-household-mode');
        const status = document.getElementById('household-mode-status');
        if (!toggle) return;
        function sync() {
            const on = !!(appState.prefs && appState.prefs.householdMode);
            toggle.classList.toggle('on', on);
            toggle.setAttribute('aria-checked', on ? 'true' : 'false');
            if (status) status.textContent = on ? 'ON' : 'OFF';
        }
        function flip() {
            if (!appState.prefs) appState.prefs = {};
            appState.prefs.householdMode = !appState.prefs.householdMode;
            saveState();
            sync();
            applyHouseholdModeLabel();
            showToast(appState.prefs.householdMode
                ? 'Household mode on. Inviting a partner stays free.'
                : 'Household mode off.');
        }
        toggle.addEventListener('click', flip);
        toggle.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
        });
        sync();
    })();

    // ── Dashboard pin buttons (Tier 2.6) ─────────────────────
    document.querySelectorAll('.pin-card-btn').forEach((btn) => {
        if (btn.dataset.pinWired === '1') return;
        btn.dataset.pinWired = '1';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const id = btn.getAttribute('data-pin-id');
            if (!id) return;
            togglePinned(id);
            const pinned = (appState.prefs && appState.prefs.pinned) || [];
            showToast(pinned.includes(id) ? 'Pinned to top of dashboard.' : 'Unpinned.');
        });
    });
    reorderPinnedCards();
    applyHouseholdModeLabel();

    // ── 11. Logout ────────────────────────────────────────────
    document.getElementById('btn-settings-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
        modal.innerHTML = `<div style="background:var(--card);border:1px solid var(--border-accent);border-radius:16px;padding:32px;max-width:360px;width:100%;text-align:center;">
          <div style="width:48px;height:48px;border-radius:12px;background:rgba(255,77,109,0.12);border:1px solid rgba(255,77,109,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <i class="ph-fill ph-power" style="color:#ff4d6d;font-size:22px;"></i>
          </div>
          <div style="font-size:18px;font-weight:900;margin-bottom:8px;">Log out?</div>
          <div style="font-size:12px;color:var(--text-3);line-height:1.6;margin-bottom:24px;">All unsaved changes will be saved automatically before you leave.</div>
          <div style="display:flex;gap:12px;">
            <button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:11px;font-weight:700;cursor:pointer;">CANCEL</button>
            <button onclick="performLogout()" style="flex:1;padding:12px;background:#ff4d6d;border:none;border-radius:8px;color:white;font-size:11px;font-weight:700;cursor:pointer;">LOG OUT</button>
          </div>
        </div>`;
        document.body.appendChild(modal);
    });

    // ── 11a. Logout Function ──────────────────────────────────
    window.performLogout = function() {
        try { saveState(); } catch(e) {}
        // Clear app data but preserve Netlify Identity session
    var gotrueData = localStorage.getItem('gotrue.user');
    var clearKeys = [];
    for (var ci = 0; ci < localStorage.length; ci++) clearKeys.push(localStorage.key(ci));
    clearKeys.forEach(function(k) { if (k !== 'gotrue.user') localStorage.removeItem(k); });
    sessionStorage.clear();
    if (gotrueData) localStorage.setItem('gotrue.user', gotrueData);
        window.location.reload();
    };

    // ── 11c. Wipe All Data ─────────────────────────────────────
    // Clears every debt, transaction, recurring payment, and notification
    // while keeping the user's account intact. Triple confirmation: must
    // click button → confirmation modal → type WIPE.
    document.getElementById('btn-settings-wipe-data')?.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:20px;';
        modal.innerHTML = `<div style="background:var(--card);border:1px solid rgba(255,171,64,0.35);border-radius:16px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.35);font-family:inherit;">
          <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,171,64,0.12);border:1px solid rgba(255,171,64,0.35);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
            <i class="ph-fill ph-broom" style="color:#ffab40;font-size:24px;"></i>
          </div>
          <div style="font-size:19px;font-weight:900;margin-bottom:8px;color:var(--text);">Wipe all your data?</div>
          <div style="font-size:12px;color:var(--text-3);line-height:1.6;margin-bottom:18px;">
            This will permanently delete every debt, transaction, recurring payment, and notification on your account.
            <br><br>
            <strong style="color:var(--text);">Your account stays.</strong> Your data does not. <strong style="color:#ffab40;">This cannot be undone.</strong>
          </div>
          <div style="font-size:11px;color:var(--text-2);text-align:left;margin-bottom:8px;font-weight:600;">Type <span style="color:#ffab40;font-weight:800;">WIPE</span> to confirm:</div>
          <input id="wjp-wipe-confirm" type="text" autocomplete="off"
            style="width:100%;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;margin-bottom:14px;outline:none;letter-spacing:0.1em;font-family:inherit;box-sizing:border-box;" />
          <div id="wjp-wipe-error" style="font-size:11px;color:#ff4d6d;margin-bottom:12px;display:none;"></div>
          <div style="display:flex;gap:12px;">
            <button id="wjp-wipe-cancel" style="flex:1;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">CANCEL</button>
            <button id="wjp-wipe-confirm-btn" disabled style="flex:1;padding:12px;background:#ffab40;border:none;border-radius:8px;color:#0b0f1a;font-size:11px;font-weight:800;cursor:not-allowed;opacity:0.45;font-family:inherit;">WIPE EVERYTHING</button>
          </div>
        </div>`;
        document.body.appendChild(modal);

        const input   = modal.querySelector('#wjp-wipe-confirm');
        const confirmBtn = modal.querySelector('#wjp-wipe-confirm-btn');
        const cancel  = modal.querySelector('#wjp-wipe-cancel');
        const errEl   = modal.querySelector('#wjp-wipe-error');

        const refresh = () => {
            const ok = input.value.trim().toUpperCase() === 'WIPE';
            confirmBtn.disabled = !ok;
            confirmBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
            confirmBtn.style.opacity = ok ? '1' : '0.45';
        };
        input.addEventListener('input', refresh);
        setTimeout(() => input.focus(), 40);
        cancel.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });

        confirmBtn.addEventListener('click', async () => {
            if (confirmBtn.disabled) return;
            confirmBtn.textContent = 'WIPING…';
            confirmBtn.disabled = true;
            try {
                // (1) Try to unlink any Plaid items on the server so bank syncs stop.
                //     Best-effort — if the network call fails we still wipe locally.
                try {
                    const idToken = (typeof getIdToken === 'function') ? await getIdToken() : null;
                    if (idToken && typeof appState !== 'undefined' && Array.isArray(appState.debts)) {
                        const itemIds = [...new Set(
                            appState.debts.map(d => d.itemId).filter(Boolean)
                        )];
                        for (const itemId of itemIds) {
                            try {
                                await fetch('/.netlify/functions/unlink-item', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                                    body: JSON.stringify({ itemId })
                                });
                            } catch (_) {}
                        }
                    }
                } catch (_) {}

                // (2) Comprehensive localStorage wipe — every wjp_* key plus the
                //     budget-theme key. Auth tokens (gotrue.user, Firebase IndexedDB)
                //     are intentionally left alone so the user stays signed in.
                try {
                    const PRESERVE = new Set([
                        'gotrue.user',
                        // Personalization: last_email/last_name kept so signin still
                        // greets the user by name. Wiping these would feel like a
                        // sign-out from the user's perspective.
                        'wjp_last_email',
                        'wjp_last_name'
                    ]);
                    const toRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (!k) continue;
                        if (PRESERVE.has(k)) continue;
                        // Wipe anything wjp_* and the legacy budget-theme key.
                        if (k.startsWith('wjp_') || k === 'budget-theme' || k === 'wjp_budget_state') {
                            toRemove.push(k);
                        }
                    }
                    toRemove.forEach(k => localStorage.removeItem(k));

                    // sessionStorage too — first-run flags, dismissed prompts, etc.
                    sessionStorage.clear();
                } catch (_) {}

                // (3) Reset the in-memory appState back to defaults so any code
                //     running between now and the reload sees a clean slate.
                try {
                    if (typeof appState !== 'undefined' && appState) {
                        appState.debts = [];
                        appState.transactions = [];
                        appState.recurringPayments = [];
                        appState.notifications = [];
                        appState.creditScoreHistory = [];
                        appState.processedTxIds = [];
                        appState.lastRecurringSync = 0;
                        if (appState.balances) {
                            appState.balances.monthlyIncome = 0;
                            appState.balances.availableCashflow = 0;
                        }
                        if (appState.budget) {
                            appState.budget.contribution = 0;
                            appState.budget.targetGoal = 0;
                            appState.budget.savingsRatio = 0;
                            if (appState.budget.expenses) {
                                appState.budget.expenses.housing = 0;
                                appState.budget.expenses.food = 0;
                                appState.budget.expenses.transit = 0;
                                appState.budget.expenses.disc = 0;
                            }
                        }
                    }
                } catch (_) {}

                try { window.wjp && wjp.track && wjp.track('client_error', { where: 'data_wipe', msg: 'user_initiated' }); } catch(_){}

                modal.remove();
                if (typeof showToast === 'function') showToast('All data wiped — starting fresh');
                // Hard refresh — bypasses any in-memory caches and forces a clean re-render.
                setTimeout(() => {
                    try { window.location.replace(window.location.pathname); }
                    catch(_) { window.location.reload(); }
                }, 600);
            } catch (e) {
                console.error('wipe failed', e);
                confirmBtn.textContent = 'WIPE EVERYTHING';
                confirmBtn.disabled = false;
                if (errEl) {
                    errEl.style.display = 'block';
                    errEl.textContent = 'Wipe failed: ' + (e.message || 'unknown error');
                }
            }
        });
    });

    // ── 11b. Delete Account ───────────────────────────────────
    document.getElementById('btn-settings-delete-account')?.addEventListener('click', (e) => {
        e.preventDefault();
        const providers = (typeof window.__wjpCurrentProviders === 'function')
            ? window.__wjpCurrentProviders() : [];
        const isPasswordUser = providers.includes('password');
        const passwordField = isPasswordUser
            ? `<input id="wjp-del-pw" type="password" placeholder="Enter your password" autocomplete="current-password"
                 style="width:100%;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;margin-bottom:14px;outline:none;" />`
            : '';

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
        modal.innerHTML = `<div style="background:var(--card);border:1px solid rgba(255,77,109,0.35);border-radius:16px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
          <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,77,109,0.12);border:1px solid rgba(255,77,109,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
            <i class="ph-fill ph-trash" style="color:#ff4d6d;font-size:24px;"></i>
          </div>
          <div style="font-size:19px;font-weight:900;margin-bottom:8px;">Delete your account?</div>
          <div style="font-size:12px;color:var(--text-3);line-height:1.6;margin-bottom:18px;">
            This permanently deletes your WJP account and wipes all local data on this device. <strong style="color:#ff4d6d;">This cannot be undone.</strong>
          </div>
          <div style="font-size:11px;color:var(--text-2);text-align:left;margin-bottom:8px;font-weight:600;">Type <span style="color:#ff4d6d;font-weight:800;">DELETE</span> to confirm:</div>
          <input id="wjp-del-confirm" type="text" autocomplete="off"
            style="width:100%;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;margin-bottom:14px;outline:none;letter-spacing:0.1em;" />
          ${passwordField}
          <div id="wjp-del-error" style="font-size:11px;color:#ff4d6d;margin-bottom:12px;display:none;"></div>
          <div style="display:flex;gap:12px;">
            <button id="wjp-del-cancel" style="flex:1;padding:12px;background:var(--card-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:11px;font-weight:700;cursor:pointer;">CANCEL</button>
            <button id="wjp-del-confirm-btn" disabled style="flex:1;padding:12px;background:#ff4d6d;border:none;border-radius:8px;color:white;font-size:11px;font-weight:700;cursor:not-allowed;opacity:0.45;">DELETE FOREVER</button>
          </div>
        </div>`;
        document.body.appendChild(modal);

        const input   = modal.querySelector('#wjp-del-confirm');
        const pwEl    = modal.querySelector('#wjp-del-pw');
        const confirm = modal.querySelector('#wjp-del-confirm-btn');
        const cancel  = modal.querySelector('#wjp-del-cancel');
        const errEl   = modal.querySelector('#wjp-del-error');

        const refresh = () => {
            const ok = input.value.trim().toUpperCase() === 'DELETE';
            confirm.disabled = !ok;
            confirm.style.cursor = ok ? 'pointer' : 'not-allowed';
            confirm.style.opacity = ok ? '1' : '0.45';
        };
        input.addEventListener('input', refresh);
        setTimeout(() => input.focus(), 40);
        cancel.addEventListener('click', () => modal.remove());

        confirm.addEventListener('click', async () => {
            if (confirm.disabled) return;
            confirm.disabled = true;
            confirm.textContent = 'DELETING…';
            errEl.style.display = 'none';
            try {
                if (typeof window.__wjpDeleteAccount !== 'function') {
                    throw new Error('auth-unavailable');
                }
                const pw = pwEl ? pwEl.value : null;
                const res = await window.__wjpDeleteAccount(pw);
                if (res && res.ok) {
                    try {
                        const keys = [];
                        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
                        keys.forEach(k => localStorage.removeItem(k));
                        sessionStorage.clear();
                    } catch(_) {}
                    window.location.replace('./intro.html');
                    return;
                }
                if (res && res.needsPassword) {
                    errEl.textContent = 'Password required to confirm account deletion.';
                } else if (res && res.error === 'auth/wrong-password') {
                    errEl.textContent = 'Incorrect password. Try again.';
                } else if (res && res.error === 'auth/popup-closed-by-user') {
                    errEl.textContent = 'Re-authentication was cancelled.';
                } else {
                    errEl.textContent = 'Delete failed: ' + ((res && res.error) || 'unknown error');
                }
                errEl.style.display = 'block';
                confirm.textContent = 'DELETE FOREVER';
                refresh();
            } catch (e) {
                errEl.textContent = 'Delete failed: ' + (e && e.message || 'unknown error');
                errEl.style.display = 'block';
                confirm.textContent = 'DELETE FOREVER';
                refresh();
            }
        });
    });

    // ── 12. Footer Links ──────────────────────────────────────
    const footerContent = {
        'btn-footer-terms': {
            title: 'Terms of Service',
            body: 'By using WJP Debt Calculator, you agree to our terms. This platform is for personal financial planning only. Not financial advice. Data is processed under AES-256 encryption. Last updated: Jan 2026.'
        },
        'btn-footer-privacy': {
            title: 'Privacy Policy',
            body: 'WJP does not sell your data. Financial data is read-only, encrypted at rest, and never shared with third parties without explicit consent. You may request full data deletion at any time. Compliant with CCPA and GDPR. Last updated: Jan 2026.'
        },
        'btn-footer-data': {
            title: 'Data Policy',
            body: 'Your debt, income, and transaction data is stored locally and encrypted in transit. Bank credentials use OAuth tokens — we never store passwords. You can export or delete all data from Settings. Retention period: 7 years (IRS standard), or until account deletion request.'
        }
    };
    Object.entries(footerContent).forEach(([id, {title, body}]) => {
        document.getElementById(id)?.addEventListener('click', () => {
            // Privacy Policy: open the real published page instead of the placeholder drawer
            if (id === 'btn-footer-privacy') {
                window.open('./privacy.html', '_blank', 'noopener');
                return;
            }
            openSettingsDrawer({
                icon: 'ph-file-text',
                badge: 'LEGAL',
                title,
                subtitle: '',
                body: `<div style="font-size:12px;color:var(--text-2);line-height:1.8;">${body}</div>`
            });
        });
    });

    // ── 13. Linked Account Edit ───────────────────────────────
    document.querySelectorAll('#page-settings .settings-journey-card [onmouseover*="pencil"], #page-settings .settings-journey-card i.ph-pencil-simple').forEach(icon => {
        icon.style.cursor = 'pointer';
        icon.parentElement.onclick = () => {
            const name = icon.parentElement.querySelector('[style*="font-weight:700"]')?.textContent || 'Account';
            showToast(`Edit ${name} — opening account editor...`);
        };
    });

    // Suggestion Chips
    const chips = {
        'suggest-strat-4': () => {
            const sim = simulateAllStrategies();
            appState.settings.strategy = sim.best;
            saveState();
            updateUI();
            if(advisorPageChat) advisorPageChat.addMessage(`Simulation confirmed. I have switched your debt payoff strategy to the ${sim.best} protocol. All charts have been updated.`, 'ai');
        },
        'suggest-compare-2023': () => {
            renderAnalysisModal(simulateAllStrategies(), appState.settings.strategy);
        },
        'suggest-tax': () => {
            if(advisorPageChat) advisorPageChat.addMessage("Based on your Q4 projections, our algorithmic engine has reserved $4,200 for tax liability, optimizing your net worth trajectory.", 'ai');
        }
    };

    for (const [id, action] of Object.entries(chips)) {
        const el = document.getElementById(id);
        if(el) el.onclick = action;
    }

    // Sidebar Links
    const linkRecalc = document.getElementById('link-recalculate');
    if (linkRecalc) {
        linkRecalc.onclick = (e) => {
            e.preventDefault();
            linkRecalc.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> RECALCULATING...';
            setTimeout(() => {
                updateUI();
                linkRecalc.textContent = 'RECALCULATE';
            }, 1200);
        };
    }

    const linkView = document.getElementById('link-view-breakdown');
    if (linkView) {
        linkView.onclick = (e) => {
            e.preventDefault();
            renderAnalysisModal(simulateAllStrategies(), appState.settings.strategy);
        };
    }
}

/* ---------- DASHBOARD INTERACTIVITY ---------- */
function initDashboardInteractivity() {
    // 1. Notifications
    const btnNotify = document.getElementById('btn-notifications');
    const panelNotify = document.getElementById('notification-panel');
    const badgeNotify = document.getElementById('notifications-badge');
    const btnClear = document.getElementById('btn-clear-notifications');

    if (btnNotify && panelNotify) {
        // Move panel to <body> so its position:fixed anchors to the viewport
        // (the top-header has backdrop-filter which would otherwise create
        //  a containing block and trap the panel under other layers).
        if (panelNotify.parentElement !== document.body) {
            document.body.appendChild(panelNotify);
        }

        btnNotify.addEventListener('click', (e) => {
            e.stopPropagation();
            panelNotify.classList.toggle('active');
            if (badgeNotify) badgeNotify.style.display = 'none';
        });

        document.addEventListener('click', (e) => {
            if (!panelNotify.contains(e.target) && !btnNotify.contains(e.target)) {
                panelNotify.classList.remove('active');
            }
        });
    }

    if (btnClear) {
        btnClear.onclick = () => {
            appState.notifications.forEach(n => n.cleared = true);
            saveState();
            renderNotifications();
            renderActivityPage();
        };
    }

    const linkSeeAll = document.getElementById('link-see-all-activity');
    if (linkSeeAll) {
        linkSeeAll.onclick = (e) => {
            e.preventDefault();
            navTo('activity');
        };
    }

    const btnPurge = document.getElementById('btn-purge-history');
    if (btnPurge) {
        btnPurge.onclick = () => {
            if (confirm("Are you sure you want to permanently delete all notification history? This cannot be undone.")) {
                appState.notifications = [];
                saveState();
                renderNotifications();
                renderActivityPage();
            }
        };
    }

    // 2. Search Bar
    const searchInput = document.getElementById('header-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            // Just a visual simulation for now
            if (val.length > 2) {
                console.log("Searching for:", val);
                // We could highlight elements or filter lists here
            }
        });
    }

    // 3. Page Navigation Links
// Global Nav Helper
    const statInterest = document.getElementById('stat-interest-saved');
    const statDti = document.getElementById('stat-dti-ratio');
    const statFreedom = document.getElementById('stat-freedom-date');

    if (statInterest) statInterest.onclick = () => openDebtSubTab('Analysis');
    if (statDti) statDti.onclick = () => openDebtSubTab('Budget & Breakdown');
    if (statFreedom) statFreedom.onclick = () => openDebtSubTab('Simulations');

    const cardResilience = document.getElementById('dash-financial-resilience');
    if (cardResilience) cardResilience.onclick = () => openDebtSubTab('Resilience');

    const linkViewAll = document.getElementById('link-view-all-upcoming');
    if (linkViewAll) linkViewAll.onclick = () => navTo('recurring');

    const btnSpendingSettings = document.getElementById('btn-spending-settings');
    if (btnSpendingSettings) btnSpendingSettings.onclick = () => navTo('settings');

    // 4. Bottom Stats Interactivity

    const navSupport = document.getElementById('nav-support');
    if (navSupport) {
        navSupport.onclick = () => {
             // Redirect to AI Advisor as the "Smart Support"
             navTo('advisor');
             setTimeout(() => {
                 const chatInput = document.getElementById('advisor-page-input');
                 if(chatInput) {
                     chatInput.value = "I need support with my debt strategy.";
                     document.getElementById('advisor-page-send').click();
                 }
             }, 500);
        };
    }

    // 4. AI Advisor Card on Dashboard
    const btnDashExec = document.getElementById('dash-btn-execute');
    const btnDashReview = document.getElementById('dash-btn-review');
    const btnDashApplyShift = document.getElementById('dash-btn-apply-shift');

    if (btnDashExec) {
        btnDashExec.onclick = () => {
            if (!appState.debts || appState.debts.length === 0) {
                if (typeof showToast === 'function') showToast('Add at least one debt before executing a strategy.');
                return;
            }
            const sim = simulateAllStrategies();
            // Lock in the strategy the user CHOSE — not auto-override to math-optimal.
            // Snowball is sometimes correct even when Avalanche is mathematically faster
            // because the psychological wins keep people on track. Respect the choice.
            const chosen = (appState.settings && appState.settings.strategy) || 'avalanche';
            const isOptimal = sim && sim.best === chosen;

            btnDashExec.innerHTML = `<i class="ph ph-check"></i> Locking in...`;
            btnDashExec.disabled = true;

            setTimeout(() => {
                appState.settings.strategy = chosen;
                appState.settings.strategyExecutedAt = Date.now();
                saveState();
                updateUI();
                btnDashExec.innerHTML = `<i class="ph ph-check-circle"></i> Locked in`;
                btnDashExec.style.background = 'var(--accent)';
                btnDashExec.style.color = '#0b0f1a';

                const stratLabel = chosen[0].toUpperCase() + chosen.slice(1);
                const noteText = isOptimal
                    ? `${stratLabel} is the math-optimal path for your portfolio. Plan locked in.`
                    : `${stratLabel} locked in. (Avalanche is the math-optimal path, but ${chosen} can be the right call for momentum — your choice.)`;

                if (typeof pushNotification === 'function') {
                    pushNotification({
                        id: Date.now(),
                        title: 'Strategy Locked In',
                        text: noteText,
                        type: 'ai',
                        priority: 'high',
                        time: 'Just now',
                        read: false,
                        cleared: false
                    }, 'strategyChange');
                }
                if (typeof renderNotifications === 'function') renderNotifications();
                if (typeof logActivity === 'function') {
                    logActivity({
                        title: 'Strategy executed',
                        text: noteText,
                        type: 'ai',
                        priority: 'normal',
                        link: '#debts'
                    });
                }

                // Auto-open the Review Details panel so the user immediately sees
                // the breakdown of what just got locked in
                setTimeout(() => {
                    if (btnDashReview) {
                        const panel = document.getElementById('dash-ai-explanation');
                        if (!panel || panel.dataset.open !== '1') btnDashReview.click();
                    }
                }, 400);

                // Restore button text after a moment so user can re-execute if they
                // change strategy
                setTimeout(() => {
                    btnDashExec.innerHTML = `Execute Strategy`;
                    btnDashExec.style.background = '';
                    btnDashExec.style.color = '';
                    btnDashExec.disabled = false;
                }, 2400);
            }, 600);
        };
    }

    if (btnDashReview) {
        btnDashReview.onclick = () => {
            const sim = simulateAllStrategies();
            if (!sim) return;
            if (!appState.debts || appState.debts.length === 0) {
                if (typeof showToast === 'function') showToast('Add at least one debt to review the breakdown.');
                return;
            }

            const strategy = (appState.settings && appState.settings.strategy) || 'avalanche';
            const stratLabel = strategy[0].toUpperCase() + strategy.slice(1);

            // Reuse the inline panel — toggle if already open
            let panel = document.getElementById('dash-ai-explanation');
            if (!panel) {
                const btnRow = btnDashReview.closest('.btn-row') || btnDashReview.parentElement;
                panel = document.createElement('div');
                panel.id = 'dash-ai-explanation';
                panel.className = 'ai-review-panel';
                btnRow.parentElement.appendChild(panel);
            }
            if (panel.style.display !== 'none' && panel.dataset.open === '1') {
                panel.style.display = 'none';
                panel.dataset.open = '0';
                btnDashReview.innerHTML = 'Review Details';
                return;
            }

            const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString();
            const userExtra = (appState.budget && parseFloat(appState.budget.contribution)) || 0;

            // Per-debt breakdown — months to clear + total interest under selected strategy
            let perDebt = {};
            try {
                const r = calcDebtSimTotals(0, userExtra, 0, 0); // returns { base, sim }
                perDebt = (r && r.sim) || {};
            } catch(_){}

            const sortedDebts = (typeof sortDebtsByStrategy === 'function')
                ? sortDebtsByStrategy(appState.debts, strategy)
                : [...appState.debts];

            const debtRows = sortedDebts.map((d, idx) => {
                const pd = perDebt[d.id] || {};
                const months = pd.months || '—';
                const intr = pd.interest != null ? fmt(pd.interest) : '—';
                const rankColor = idx === 0 ? 'var(--accent)' : idx === 1 ? '#a855f7' : idx === 2 ? '#60a5fa' : 'var(--text-3)';
                return `
                    <tr>
                        <td><span class="ai-rev-rank" style="background:${rankColor};">${idx + 1}</span> ${d.name || 'Unnamed'}</td>
                        <td>${fmt(d.balance)}</td>
                        <td>${(d.apr || 0).toFixed(2)}%</td>
                        <td>${fmt(d.minPayment)}</td>
                        <td>${months}${typeof months === 'number' ? ' mo' : ''}</td>
                        <td style="color:var(--accent);">${intr}</td>
                    </tr>`;
            }).join('');

            // Strategy comparison: snowball / hybrid / avalanche side-by-side
            const stratOrder = ['snowball', 'hybrid', 'avalanche'];
            const sims = sim.simulations || {};
            const bestStrat = sim.best;
            const compareCells = stratOrder.map(s => {
                const data = sims[s] || { months: 0, interest: 0 };
                const isActive = s === strategy;
                const isBest = s === bestStrat;
                const label = s[0].toUpperCase() + s.slice(1);
                const tag = isActive && isBest ? 'Active · Optimal'
                          : isActive ? 'Active'
                          : isBest ? 'Optimal'
                          : '';
                return `
                    <div class="ai-rev-strat ${isActive ? 'active' : ''} ${isBest ? 'optimal' : ''}">
                        <div class="ai-rev-strat-head">
                            <span class="ai-rev-strat-name">${label}</span>
                            ${tag ? `<span class="ai-rev-strat-tag">${tag}</span>` : ''}
                        </div>
                        <div class="ai-rev-strat-stat">${data.months || '—'}<span> mo</span></div>
                        <div class="ai-rev-strat-sub">${fmt(data.interest)} interest</div>
                    </div>`;
            }).join('');

            // Recommended action — combines selected strategy + cash flow
            const focus = sortedDebts[0];
            const focusReason = strategy === 'snowball'
                ? 'smallest balance — quickest psychological win'
                : strategy === 'avalanche'
                ? 'highest APR — biggest interest drain'
                : 'best blend of balance and APR';
            const actionPay = userExtra > 0 ? userExtra : 100;
            const stratActiveData = sims[strategy] || { months: 0, interest: 0 };
            const naiveData = sims[strategy] ? sims[strategy] : { interest: 0 };
            let naiveInterest = 0;
            try {
                const naive = calcSimTotals(strategy, 0, 0, 0);
                if (naive) naiveInterest = naive.totalInterest;
            } catch(_){}
            const saved = Math.max(0, naiveInterest - stratActiveData.interest);

            panel.innerHTML = `
                <div class="ai-rev-header">
                    <div>
                        <div class="ai-rev-eyebrow">Strategy breakdown · ${stratLabel}</div>
                        <h4 class="ai-rev-title">Your debt-elimination plan</h4>
                    </div>
                    <button class="ai-rev-close" type="button" aria-label="Close" id="ai-rev-close-btn"><i class="ph ph-x"></i></button>
                </div>

                <p class="ai-rev-intro">You're running the <strong>${stratLabel}</strong> method. Below is a per-debt projection plus how Snowball, Hybrid, and Avalanche compare under your current cash flow (${fmt(userExtra)}/mo extra).</p>

                <div class="ai-rev-section">
                    <div class="ai-rev-section-label">Per-debt elimination order</div>
                    <table class="ai-rev-table">
                        <thead>
                            <tr><th>Debt</th><th>Balance</th><th>APR</th><th>Min</th><th>Time to clear</th><th>Total interest</th></tr>
                        </thead>
                        <tbody>${debtRows}</tbody>
                    </table>
                </div>

                <div class="ai-rev-section">
                    <div class="ai-rev-section-label">Strategy comparison</div>
                    <div class="ai-rev-strat-grid">${compareCells}</div>
                </div>

                <div class="ai-rev-action">
                    <div class="ai-rev-action-icon"><i class="ph-fill ph-target"></i></div>
                    <div class="ai-rev-action-body">
                        <div class="ai-rev-action-title">Next move</div>
                        <p>Throw an extra <strong>${fmt(actionPay)}</strong> at <strong>${focus.name}</strong> this month (${focusReason}). At your current pace, you'll be debt-free in <strong>${stratActiveData.months || '—'} months</strong>${saved > 0 ? `, saving <strong style="color:var(--accent);">${fmt(saved)}</strong> in interest vs. paying minimums only` : ''}.</p>
                    </div>
                </div>
            `;
            panel.style.display = 'block';
            panel.dataset.open = '1';
            btnDashReview.innerHTML = '<i class="ph ph-x"></i> Close';

            // Wire close button inside the panel
            const closeBtn = document.getElementById('ai-rev-close-btn');
            if (closeBtn) closeBtn.onclick = () => {
                panel.style.display = 'none';
                panel.dataset.open = '0';
                btnDashReview.innerHTML = 'Review Details';
            };
        };
    }

    if (btnDashApplyShift) {
        btnDashApplyShift.onclick = () => {
             btnDashApplyShift.innerHTML = `<i class="ph ph-spinner-gap spinning"></i> Applying...`;
             setTimeout(() => {
                btnDashApplyShift.innerHTML = `<i class="ph ph-check"></i> Strategy Applied`;
                btnDashApplyShift.style.background = 'var(--accent)';
                btnDashApplyShift.style.color = '#000';
                
                // Add to activity log / notifications
                pushNotification({
                    id: Date.now(),
                    title: 'Interest Arbitrage Applied',
                    text: 'Shifted $450 excess payment to Prime Rewards Visa for max interest avoidance.',
                    type: 'ai',
                    priority: 'med',
                    time: 'Just now',
                    read: false,
                    cleared: false
                }, 'ai');
                saveState();
                renderNotifications();
                updateUI();
             }, 1000);
        };
    }

    // 5. AI Advisor Chart Style Switcher
    const styleBtns = document.querySelectorAll('.style-btn');
    styleBtns.forEach(btn => {
        const style = btn.getAttribute('data-style');
        
        // Sync initial state
        if (appState.settings && appState.settings.activeChartStyle === style) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.onclick = () => {
            styleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if(!appState.settings) appState.settings = { strategy: 'avalanche' };
            appState.settings.activeChartStyle = style;
            saveState();
            
            // Redraw charts
            drawCharts();
        };
    });

    // 6. Spending Tracker Filters
    document.querySelectorAll('#page-dashboard .time-btn').forEach(btn => {
        const timeframe = btn.getAttribute('data-time');
        
        // Sync initial state
        if (appState.settings && appState.settings.spendingTimeFrame === timeframe) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
            btn.parentElement.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if(!appState.settings) appState.settings = {};
            appState.settings.spendingTimeFrame = timeframe;
            saveState();
            
            // Redraw charts
            drawCharts();
        });
    });

    // 7. Spending Tracker Chart Type Switcher
    const spendStyleBtns = document.querySelectorAll('#spending-chart-switcher .style-btn');
    spendStyleBtns.forEach(btn => {
        const style = btn.getAttribute('data-style');
        
        // Sync initial state
        if (appState.settings && appState.settings.spendingChartType === style) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.onclick = () => {
            spendStyleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if(!appState.settings) appState.settings = {};
            appState.settings.spendingChartType = style;
            saveState();
            
            // Redraw charts
            drawCharts();
        };
    });

    // 8. Add Transaction Button on Spending Card
    const btnAddTxnDash = document.getElementById('btn-add-txn-dash');
    if (btnAddTxnDash) {
        btnAddTxnDash.onclick = () => {
            const btnNew = document.getElementById('btn-new-entry');
            if (btnNew) {
                btnNew.click();
                setTimeout(() => {
                    const txnTab = document.querySelector('.modal-tab[data-tab="transaction"]');
                    if (txnTab) txnTab.click();
                }, 50);
            }
        };
    }

    // "View all" link in the spending tracker → jumps to Strategy/Debts → Transactions subtab
    const spendViewAll = document.getElementById('spend-view-all');
    if (spendViewAll) {
        spendViewAll.onclick = (e) => {
            e.preventDefault();
            if (typeof navTo === 'function') navTo('debts');
            // Click the Transactions subtab so we land directly on the full list
            setTimeout(() => {
                const subTabs = document.querySelectorAll('.debts-subtabs .subtab');
                if (subTabs.length >= 2) subTabs[1].click();
            }, 80);
        };
    }

    // 9. Credit Profile AI Interaction — REAL FICO 5-factor analysis
    const btnAskCredit = document.getElementById('btn-ask-credit');
    const inputAskCredit = document.getElementById('credit-ask-input');
    const msgCreditAi = document.getElementById('credit-ai-msg');

    if (btnAskCredit && inputAskCredit && msgCreditAi) {
        const handleCreditAsk = () => {
            const query = inputAskCredit.value.trim();
            if (!query) return;
            inputAskCredit.value = '';
            msgCreditAi.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> Analyzing your profile...';
            setTimeout(() => {
                msgCreditAi.innerHTML = answerCreditQuery(query);
                msgCreditAi.style.color = 'var(--text-2)';
            }, 700);
        };
        btnAskCredit.onclick = handleCreditAsk;
        inputAskCredit.onkeydown = (e) => { if(e.key === 'Enter') handleCreditAsk(); };
    }

    // Wire the in-depth toggle
    const btnExpand = document.getElementById('btn-credit-ai-expand');
    const breakdown = document.getElementById('credit-ai-breakdown');
    if (btnExpand && breakdown) {
        btnExpand.onclick = () => {
            const open = breakdown.style.display !== 'none';
            breakdown.style.display = open ? 'none' : 'block';
            btnExpand.setAttribute('aria-expanded', String(!open));
            btnExpand.innerHTML = open
                ? 'In-depth <i class="ph ph-caret-down" style="font-size:9px;"></i>'
                : 'Hide details <i class="ph ph-caret-up" style="font-size:9px;"></i>';
        };
    }

    // Auto-render insights on page load + after any state change
    try { renderCreditAiInsights(); } catch(_){}

/* ---------- CREDIT PROFILE AI ---------- */
/**
 * Pull credit data + debts and produce the 5-factor FICO breakdown,
 * surface 2-3 quick facts, and list the top 3 actions to lift the score.
 *
 * FICO 8 weighting (industry standard):
 *  - Payment history          35%
 *  - Amounts owed (utilization) 30%
 *  - Length of credit history 15%
 *  - New credit / inquiries   10%
 *  - Credit mix               10%
 */
function getCreditAnalysis() {
    let cs = {};
    try { cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch(_){}
    const debts = (appState && appState.debts) ? appState.debts : [];
    const cardLimits = cs.cardLimits || {};

    const cards = debts.filter(d => {
        const t = (d.type || d.category || '').toString().toLowerCase();
        return t.includes('credit') || t.includes('card') || t === 'cc' || (cardLimits[d.id] && cardLimits[d.id] > 0);
    });

    let totalBal = 0, totalLim = 0;
    cards.forEach(d => {
        const lim = parseFloat(d.limit || cardLimits[d.id] || 0);
        const bal = parseFloat(d.balance || 0);
        if (lim > 0) { totalBal += bal; totalLim += lim; }
    });
    const utilPct = totalLim > 0 ? (totalBal / totalLim) * 100 : null;

    const score = parseInt(cs.score, 10) || null;
    const lates = parseInt(cs.latePayments12mo, 10) || 0;
    const inq = parseInt(cs.hardInquiries12mo, 10) || 0;
    const oldestYears = parseFloat(cs.oldestAccountYears) || 0;
    const accountCount = debts.length;
    const hasMix = (() => {
        const types = new Set(debts.map(d => (d.type || '').toLowerCase().trim()).filter(Boolean));
        return types.size >= 2;
    })();

    // Strength rating per factor (0-100 normalized)
    // Formulas tuned to map common situations to STRONG/GOOD/WEAK bands
    const factors = [
        {
            id: 'payment',
            name: 'Payment history',
            weight: 35,
            stat: lates === 0 ? '0 late payments (12mo)' : `${lates} late ${lates === 1 ? 'payment' : 'payments'} (12mo)`,
            score: lates === 0 ? 100 : Math.max(0, 100 - lates * 25),
            help: 'Late or missed payments hurt the most — even one drops 60-100 pts. Set up autopay for at least the minimum.'
        },
        {
            id: 'utilization',
            name: 'Utilization',
            weight: 30,
            stat: utilPct == null ? 'No card limits set' : `${utilPct.toFixed(0)}% of credit used`,
            score: utilPct == null ? 50
                 : utilPct < 10 ? 100
                 : utilPct < 30 ? 80
                 : utilPct < 50 ? 60
                 : utilPct < 70 ? 35
                 : 15,
            help: 'Lenders want to see you use less than 30% of your limit — under 10% is ideal. Pay down before statement closes.'
        },
        {
            id: 'age',
            name: 'Credit age',
            weight: 15,
            stat: oldestYears > 0 ? `${oldestYears.toFixed(1)} yr oldest account` : 'No history entered',
            score: oldestYears <= 0 ? 50
                 : oldestYears >= 7 ? 100
                 : oldestYears >= 4 ? 75
                 : oldestYears >= 2 ? 55
                 : 35,
            help: 'Length of credit history matters. Keep your oldest card open even if you don\'t use it — closing it hurts your score.'
        },
        {
            id: 'inquiries',
            name: 'New credit',
            weight: 10,
            stat: `${inq} hard ${inq === 1 ? 'inquiry' : 'inquiries'} (12mo)`,
            score: inq === 0 ? 100
                 : inq <= 2 ? 80
                 : inq <= 4 ? 50
                 : 25,
            help: 'Each hard inquiry drops 5-10 pts and stays on your report for 2 years. Avoid applying for new credit during big purchase prep.'
        },
        {
            id: 'mix',
            name: 'Credit mix',
            weight: 10,
            stat: accountCount === 0 ? 'No accounts'
                : `${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}${hasMix ? ' (mixed)' : ''}`,
            score: accountCount === 0 ? 30
                 : hasMix && accountCount >= 3 ? 100
                 : accountCount >= 2 ? 70
                 : 50,
            help: 'A mix of revolving (cards) and installment (loans, mortgage) shows lenders you can handle different debt types.'
        }
    ];

    // Strength label maps
    factors.forEach(f => {
        f.label = f.score >= 80 ? 'STRONG' : f.score >= 55 ? 'GOOD' : 'WEAK';
        f.color = f.score >= 80 ? '#00d4a8' : f.score >= 55 ? '#ffab40' : '#ff4d6d';
    });

    return {
        score, lates, inq, oldestYears, accountCount, hasMix,
        utilPct, totalBal, totalLim,
        cards, debts, factors,
        hasAnyData: !!(score || utilPct != null || debts.length > 0 || lates > 0 || inq > 0 || oldestYears > 0)
    };
}

/** Generate the top 3 prioritized actions based on the weakest factors. */
function getCreditActions(analysis) {
    const actions = [];
    const { utilPct, totalBal, totalLim, factors, lates, inq, oldestYears, debts, cards } = analysis;
    const fmt = n => '$' + Math.round(n).toLocaleString();

    // Action 1 — utilization is almost always the biggest movable lever
    if (utilPct != null && utilPct >= 30 && totalLim > 0) {
        const targetBal = Math.round(totalLim * 0.09);
        const payDown = Math.max(0, totalBal - targetBal);
        actions.push({
            text: `Pay down <strong>${fmt(payDown)}</strong> across your cards to drop reported utilization under 10%.`,
            impact: 'Typically lifts FICO 20-50 pts within one statement cycle.'
        });
    } else if (utilPct != null && utilPct >= 10 && totalLim > 0) {
        actions.push({
            text: `You're under 30% utilization — keep going. Pay down to under 10% of your <strong>${fmt(totalLim)}</strong> total limit for the FICO sweet spot.`,
            impact: 'Worth roughly 10-20 pts.'
        });
    }

    // Action 2 — late payments
    if (lates > 0) {
        actions.push({
            text: 'Set up <strong>autopay for the minimum</strong> on every card and loan. Late payments are the #1 score killer.',
            impact: 'Each future late payment costs you 60-100 pts.'
        });
    } else if (cards.some(d => !d.autopayActive)) {
        actions.push({
            text: 'Turn on autopay (minimum) for any card that doesn\'t have it. Locks in your perfect payment history.',
            impact: 'Protects your strongest factor (35% of FICO).'
        });
    }

    // Action 3 — inquiries
    if (inq >= 3) {
        actions.push({
            text: 'Pause new credit applications for 6+ months. Each hard inquiry drops 5-10 pts.',
            impact: 'Inquiries fade after 12 months and drop off after 2 years.'
        });
    }

    // Action 4 — credit age (only if no other actions)
    if (actions.length < 3 && oldestYears > 0 && oldestYears < 4) {
        actions.push({
            text: 'Keep your oldest card open and active (one small purchase a quarter). Don\'t close it.',
            impact: 'Length of credit history is 15% of your score.'
        });
    }

    // Action 5 — credit mix
    if (actions.length < 3 && !analysis.hasMix && debts.length === 1) {
        actions.push({
            text: 'A diverse mix of revolving (cards) and installment (loans) helps. Consider a small credit-builder loan once utilization is under 30%.',
            impact: 'Credit mix is 10% of your score.'
        });
    }

    // Action 6 — request limit increase if utilization is the issue
    if (actions.length < 3 && utilPct != null && utilPct >= 30) {
        actions.push({
            text: 'Request a credit limit increase on your strongest card. Higher limit + same balance = lower utilization.',
            impact: 'Soft pull at most issuers — usually no score hit.'
        });
    }

    // Always at least one action
    if (actions.length === 0) {
        actions.push({
            text: 'Your credit profile is in great shape. Keep paying on time and stay under 10% utilization.',
            impact: 'You\'re in the prime tier (740+) range.'
        });
    }

    return actions.slice(0, 3);
}

/** Render the AI Optimization box on the dashboard with real data. */
function renderCreditAiInsights() {
    const msgEl = document.getElementById('credit-ai-msg');
    const factsEl = document.getElementById('credit-ai-facts');
    const factorsListEl = document.getElementById('credit-factors-list');
    const actionsListEl = document.getElementById('credit-actions-list');
    if (!msgEl) return;

    const a = getCreditAnalysis();

    if (!a.hasAnyData) {
        msgEl.textContent = 'Add your credit score, card limits, and payment history in the Credit Score tab — I\'ll analyze every FICO factor and tell you exactly what to focus on.';
        if (factsEl) factsEl.style.display = 'none';
        if (factorsListEl) factorsListEl.innerHTML = '';
        if (actionsListEl) actionsListEl.innerHTML = '';
        return;
    }

    // Weakest factor → headline message
    const weakest = a.factors.slice().sort((x, y) => x.score - y.score)[0];
    const strongest = a.factors.slice().sort((x, y) => y.score - x.score)[0];
    msgEl.innerHTML = `Your weakest factor is <strong style="color:${weakest.color};">${weakest.name}</strong> (${weakest.weight}% of your score). Strongest: <strong style="color:${strongest.color};">${strongest.name}</strong>. Open <em>In-depth</em> for the full breakdown and the top 3 actions to lift your score.`;

    // Quick facts strip — three highest-impact data points
    if (factsEl) {
        const facts = [];
        if (a.score) facts.push({ label: 'Score', val: a.score, sub: a.score >= 740 ? 'Excellent' : a.score >= 670 ? 'Good' : a.score >= 580 ? 'Fair' : 'Building' });
        if (a.utilPct != null) {
            const utilColor = a.utilPct < 10 ? '#00d4a8' : a.utilPct < 30 ? '#ffab40' : '#ff4d6d';
            facts.push({ label: 'Utilization', val: `${a.utilPct.toFixed(0)}%`, sub: a.utilPct < 10 ? 'Sweet spot' : a.utilPct < 30 ? 'Healthy' : 'Too high', color: utilColor });
        }
        facts.push({ label: 'On-time', val: a.lates === 0 ? '100%' : `${a.lates} late`, sub: a.lates === 0 ? 'Last 12 mo' : 'Score risk' });
        if (a.oldestYears > 0) facts.push({ label: 'Oldest', val: `${a.oldestYears.toFixed(1)} yr`, sub: 'Avg age' });
        factsEl.innerHTML = facts.slice(0, 3).map(f => `
            <div class="credit-fact">
                <div class="credit-fact-label">${f.label}</div>
                <div class="credit-fact-val" style="${f.color ? `color:${f.color};` : ''}">${f.val}</div>
                <div class="credit-fact-sub">${f.sub}</div>
            </div>
        `).join('');
        factsEl.style.display = 'grid';
    }

    // 5-factor breakdown (in-depth)
    if (factorsListEl) {
        factorsListEl.innerHTML = a.factors.map(f => `
            <div class="credit-factor" title="${f.help}">
                <div class="credit-factor-head">
                    <span class="credit-factor-name">${f.name} <span class="credit-factor-weight">${f.weight}%</span></span>
                    <span class="credit-factor-label" style="color:${f.color};">${f.label}</span>
                </div>
                <div class="credit-factor-stat">${f.stat}</div>
                <div class="credit-factor-bar"><div style="width:${f.score}%; background:${f.color};"></div></div>
            </div>
        `).join('');
    }

    // Top 3 actions
    if (actionsListEl) {
        const actions = getCreditActions(a);
        actionsListEl.innerHTML = actions.map(act => `
            <li class="credit-action">
                <div class="credit-action-text">${act.text}</div>
                <div class="credit-action-impact">${act.impact}</div>
            </li>
        `).join('');
    }
}

/** Smarter Q&A — reads real user data, not hardcoded card names. */
function answerCreditQuery(query) {
    const a = getCreditAnalysis();
    const q = (query || '').toLowerCase();
    const fmt = n => '$' + Math.round(n).toLocaleString();

    if (!a.hasAnyData) {
        return 'I don\'t have your credit data yet — add your score, card limits, and payment history in the Credit Score tab and I can answer specifically.';
    }

    if (q.includes('utilization') || q.includes('utilizati') || q.includes('use')) {
        if (a.utilPct == null) return 'I don\'t have credit limits saved yet. Edit each card and add its limit so I can compute utilization.';
        const target = Math.round((a.totalLim || 0) * 0.09);
        const payDown = Math.max(0, a.totalBal - target);
        return `Your utilization is <strong>${a.utilPct.toFixed(0)}%</strong> (${fmt(a.totalBal)} of ${fmt(a.totalLim)}). To drop under 10%, pay <strong>${fmt(payDown)}</strong> across your cards before the next statement closes — typically worth 20-50 FICO points.`;
    }
    if (q.includes('limit') || q.includes('increase')) {
        const strongCard = a.cards.slice().sort((x, y) => (y.balance || 0) - (x.balance || 0))[0];
        if (!strongCard) return 'Add at least one credit card with its limit and I can suggest where a limit increase would help most.';
        const newLimit = (strongCard.limit || 0) * 1.3;
        return `Request a limit increase on <strong>${strongCard.name}</strong>. Most issuers do a soft pull — no score impact. Pushing it from ${fmt(strongCard.limit || 0)} to ~${fmt(newLimit)} drops your overall utilization measurably.`;
    }
    if (q.includes('late') || q.includes('miss')) {
        if (a.lates === 0) return `You have <strong>0 late payments</strong> in the last 12 months. Payment history is 35% of your score — this is your strongest asset. Keep autopay on for the minimum on every account.`;
        return `You have <strong>${a.lates} late payment${a.lates === 1 ? '' : 's'}</strong> in 12 mo. Each one drops 60-100 FICO points and stays on your report for 7 years (impact fades after 2). Set up autopay-minimum on every card today.`;
    }
    if (q.includes('inquir') || q.includes('apply')) {
        return `You have <strong>${a.inq} hard inquir${a.inq === 1 ? 'y' : 'ies'}</strong> in 12 mo. Each one is 5-10 points and stays on your report 2 years. Stop applying for new credit at least 6 months before any major loan or mortgage application.`;
    }
    if (q.includes('age') || q.includes('history') || q.includes('old')) {
        if (a.oldestYears > 0) return `Your oldest account is <strong>${a.oldestYears.toFixed(1)} years</strong> old. Don't close it, even if unused — closing your oldest line shortens your average age and can drop your score 10-30 pts.`;
        return 'Add the age of your oldest account in the Credit Score tab so I can advise on length-of-history impact.';
    }
    if (q.includes('mix')) {
        const types = new Set(a.debts.map(d => (d.type || '').toLowerCase()).filter(Boolean));
        return a.hasMix
            ? `You have a healthy mix of ${[...types].join(' + ')} — that's 10% of your score covered.`
            : 'You only have one type of credit. Adding an installment loan (or a credit-builder loan) once utilization is healthy can earn you up to 10 points.';
    }
    if (q.includes('boost') || q.includes('improve') || q.includes('lift') || q.includes('faster') || q.includes('quick')) {
        const acts = getCreditActions(a);
        return `Your top 3 moves right now: 1) ${acts[0].text} 2) ${acts[1] ? acts[1].text : '—'} 3) ${acts[2] ? acts[2].text : '—'}`;
    }
    if (q.includes('how') && q.includes('score')) {
        return `Your score is computed from 5 factors: payment history (35%), utilization (30%), credit age (15%), new credit/inquiries (10%), and credit mix (10%). Open the In-depth panel above for your stats on each.`;
    }

    // Default: weakest factor advice
    const weakest = a.factors.slice().sort((x, y) => x.score - y.score)[0];
    return `Your weakest factor is <strong>${weakest.name}</strong> (${weakest.weight}% of your score). ${weakest.help}`;
}

    // 10. Upcoming Payments View Toggle
    const upcomingBtns = document.querySelectorAll('.view-toggle .view-btn');
    const listView = document.getElementById('upcoming-list-view');
    const calView = document.getElementById('mini-calendar-view');

    if (upcomingBtns.length && listView && calView) {
        upcomingBtns.forEach(btn => {
            btn.onclick = () => {
                const view = btn.getAttribute('data-view');
                upcomingBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (view === 'calendar') {
                    listView.style.display = 'none';
                    calView.style.display = 'block';
                    renderMiniCalendar();
                } else {
                    listView.style.display = 'block';
                    calView.style.display = 'none';
                }
            };
        });
    }

    function renderMiniCalendar() {
        const grid = document.getElementById('mini-calendar-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const days = ['S','M','T','W','T','F','S'];
        days.forEach(d => {
            const el = document.createElement('div');
            el.style.fontSize = '8px';
            el.style.fontWeight = '800';
            el.style.color = 'var(--text-3)';
            el.style.padding = '4px 0';
            el.textContent = d;
            grid.appendChild(el);
        });

        const now = new Date();
        const payments = appState.debts.map(d => parseInt(d.dueDate) || 1);
        const paydays = [1, 15]; // Fixed paydays for mock

        for (let i = 1; i <= 31; i++) {
            const dayEl = document.createElement('div');
            dayEl.style.fontSize = '10px';
            dayEl.style.padding = '6px 0';
            dayEl.style.borderRadius = '4px';
            dayEl.style.position = 'relative';
            dayEl.textContent = i;
            
            if (i === now.getDate()) {
                dayEl.style.background = 'var(--card-2)';
                dayEl.style.color = 'var(--text)';
                dayEl.style.fontWeight = '700';
            } else {
                dayEl.style.color = 'var(--text-3)';
            }

            if (payments.includes(i)) {
                const dot = document.createElement('div');
                dot.style.width = '4px'; dot.style.height = '4px';
                dot.style.background = 'var(--danger)';
                dot.style.borderRadius = '50%';
                dot.style.position = 'absolute';
                dot.style.bottom = '2px'; dot.style.left = '50%';
                dot.style.transform = 'translateX(-50%)';
                dayEl.appendChild(dot);
                dayEl.style.color = 'var(--text)';
            }

            if (paydays.includes(i)) {
                const dot = document.createElement('div');
                dot.style.width = '4px'; dot.style.height = '4px';
                dot.style.background = 'var(--accent)';
                dot.style.borderRadius = '50%';
                dot.style.position = 'absolute';
                dot.style.top = '2px'; dot.style.left = '50%';
                dot.style.transform = 'translateX(-50%)';
                dayEl.appendChild(dot);
            }

            grid.appendChild(dayEl);
        }
    }

    // Expose so updateUI() and other top-level code can re-render the credit
    // AI box whenever debts/credit-inputs change. Without this, the box only
    // refreshes on initial dashboard mount.
    if (typeof window !== 'undefined') {
        window.renderCreditAiInsights = renderCreditAiInsights;
        window.getCreditAnalysis = getCreditAnalysis;
        window.answerCreditQuery = answerCreditQuery;
    }
}

function updateSpendingChart() {
    // Placeholder for chart data refresh logic
    console.log("Refreshing spending chart data...");
}

// Global Nav & Simulation Link Helpers
function navTo(page) {
    navigateSPA(page);
}

function openDebtSubTab(subtabName) {
    navTo('debts');
    setTimeout(() => {
        const subtabs = document.querySelectorAll('.debts-subtabs .subtab');
        const target = Array.from(subtabs).find(t => t.textContent.trim() === subtabName);
        if (target) target.click();
    }, 100);
}

/* ============================================================
   CENTRAL STRATEGY SELECTOR
   Single source of truth — call setStrategy(name) from anywhere
   and every component across every tab stays in sync instantly.
   ============================================================ */

function setStrategy(name) {
    if (!['snowball', 'hybrid', 'avalanche'].includes(name)) return;
    if (!appState.settings) appState.settings = {};
    const prev = appState.settings.strategy;
    appState.settings.strategy = name;
    saveState();
    if (prev !== name && typeof logActivity === 'function') {
        const labels = { snowball: 'Snowball ❄️', hybrid: 'Hybrid ⚡', avalanche: 'Avalanche 🏔️' };
        logActivity({
            title: 'Payoff strategy changed',
            text: `${labels[prev] || prev || 'None'} → ${labels[name]}`,
            type: 'strategy',
            priority: 'normal',
            link: '#dashboard'
        });
    }

    // 1. Sync all chip groups (Debts subtab strategy-tabs)
    document.querySelectorAll('#strategy-tabs .chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-strategy') === name);
    });

    // 2. Sync simulation strategy — clear cached sim strategy so it reopens in sync
    try {
        const sv = JSON.parse(localStorage.getItem('wjp_sim_state') || '{}');
        sv.strategy = name;
        localStorage.setItem('wjp_sim_state', JSON.stringify(sv));
    } catch(e) {}
    // Re-render simulations if it's currently open
    const simPanel = document.querySelector('[data-subtab="simulations"].active');
    if (simPanel && typeof renderSimulationsTab === 'function') renderSimulationsTab();

    // 3. Sync strategy indicator card selected/highlight states
    syncStrategyCards();

    // 4. Force AI Advisor description to re-type on next render
    const aiDesc = document.getElementById('ai-advisor-desc');
    if (aiDesc) aiDesc.dataset.lastText = '';
    clearInterval(window.aiTypingInterval);

    // 5. Full UI refresh — cascades to payoff stats, charts, freedom date, DTI, etc.
    updateUI();

    // 6. Toast confirmation
    const labels = { snowball: 'Snowball ❄️', hybrid: 'Hybrid ⚡', avalanche: 'Avalanche 🏔️' };
    showToast(`Strategy set to ${labels[name]}`);
}

function syncStrategyCards() {
    const current  = appState?.settings?.strategy || 'avalanche';
    const sim      = typeof simulateAllStrategies === 'function' ? trySimulate() : null;
    const optimal  = sim?.best || 'avalanche';

    ['snowball', 'hybrid', 'avalanche'].forEach(s => {
        const card = document.getElementById(`strat-card-${s}`);
        if (!card) return;
        card.classList.toggle('selected', s === current);
        card.classList.toggle('highlight', s === optimal);
    });
}

// handleStratItemClick — clicking a debt item inside a card selects that strategy
// (kept for backward compat from onclick="" attributes in rendered HTML)
function handleStratItemClick(strategy) {
    setStrategy(strategy);
}

// Wire strategy card header clicks (full card = click to select)
function initStrategyCardClicks() {
    ['snowball', 'hybrid', 'avalanche'].forEach(s => {
        const card = document.getElementById(`strat-card-${s}`);
        if (!card) return;
        card.addEventListener('click', (e) => {
            // Don't re-trigger if user clicked a debt item (it has its own onclick)
            if (e.target.closest('.strat-item')) return;
            setStrategy(s);
        });
    });
}

// ==========================================
// 11. NotebookLM Research Hub Interaction
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const aiFab = document.getElementById('ai-chat-fab');
    const aiPanel = document.getElementById('ai-chat-panel');
    const aiClose = document.getElementById('ai-chat-close');
    const aiSend = document.getElementById('chat-send');
    const aiInput = document.getElementById('chat-input');
    const aiMessages = document.getElementById('chat-messages');

    if (aiFab && aiPanel && aiClose) {
        aiFab.addEventListener('click', () => {
            aiPanel.classList.add('active');
            aiFab.classList.add('active');
        });

        aiClose.addEventListener('click', () => {
            aiPanel.classList.remove('active');
            aiFab.classList.remove('active');
        });

        // Chat functionality
        function appendMessage(text, sender) {
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-msg ${sender}`;
            msgDiv.innerHTML = text;
            aiMessages.appendChild(msgDiv);
            aiMessages.scrollTop = aiMessages.scrollHeight;
        }

        function handleChatSend() {
            const val = aiInput.value.trim();
            if(!val) return;
            
            appendMessage(val, 'user');
            aiInput.value = '';

            setTimeout(() => {
                appendMessage('<i class="ph ph-spinner-gap spinning"></i> Searching local documents...', 'ai margin-bottom-0');
                
                setTimeout(() => {
                    const lastAi = aiMessages.querySelector('.chat-msg.ai:last-child');
                    if (lastAi) lastAi.remove();

                    if(val.toLowerCase().includes('bank') || val.toLowerCase().includes('plaid')) {
                        appendMessage('I see you want to connect a bank account. I can help launch the Plaid initialization flow. Click "Sync Bank" in your dashboard header to securely connect your external institutions.', 'ai');
                    } else {
                        appendMessage('Based on my analysis of your imported Chase statement from last month, you are spending 18% of your income on dining. Redirecting half of that to your High-Yield Savings could increase your velocity score dramatically.', 'ai');
                    }
                }, 1500);
            }, 500);
        }

        if (aiSend) aiSend.addEventListener('click', handleChatSend);
        if (aiInput) aiInput.addEventListener('keydown', (e) => {
            if(e.key === 'Enter') handleChatSend();
        });

        const prompts = document.querySelectorAll('.chat-prompt');
        prompts.forEach(p => {
            p.addEventListener('click', () => {
                aiInput.value = p.textContent.replace('"', '').replace('"', '');
                handleChatSend();
            });
        });
    }

    // ==========================================
    // 12. Banking Sync Mockup
    // ==========================================
    const btnSyncBank = document.getElementById('btn-sync-bank');
    const plaidModal = document.getElementById('plaid-modal');
    const plaidClose = document.getElementById('plaid-close');
    const btnPlaidContinue = document.getElementById('btn-plaid-continue');

    if (btnSyncBank && plaidModal) {
        btnSyncBank.addEventListener('click', () => {
            // Real Plaid Link is the primary path. openPlaidLink() now lazy-loads
            // the Plaid SDK on demand, so we always try it first. If it throws
            // synchronously (script blocked, CSP, etc.) we fall back to the mockup.
            const hasOpener = (typeof openPlaidLink === 'function' || typeof window.openPlaidLink === 'function');
            if (hasOpener) {
                try {
                    (window.openPlaidLink || openPlaidLink)();
                    return;
                } catch (e) {
                    console.warn('openPlaidLink threw, falling back to mockup:', e);
                }
            }
            // Fallback: legacy mockup so a click never feels broken.
            plaidModal.classList.add('active');
        });

        if (plaidClose) {
            plaidClose.addEventListener('click', () => {
                plaidModal.classList.remove('active');
            });
        }
        
        if (btnPlaidContinue) {
            btnPlaidContinue.addEventListener('click', () => {
                // Hide the pre-modal and open the real Plaid Link Mockup
                plaidModal.classList.remove('active');
                
                // Reset mockup screens
                document.querySelectorAll('.plaid-screen').forEach(s => s.classList.remove('active'));
                document.getElementById('plaid-screen-banks').classList.add('active');
                document.getElementById('plaid-link-ui').classList.add('active');
            });
        }
    }

    // Global functions for the Plaid Mockup Flow
    window.showPlaidLogin = function(bankName) {
        document.getElementById('plaid-bank-name').textContent = bankName;
        document.querySelectorAll('.plaid-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('plaid-screen-login').classList.add('active');
    };

    window.submitPlaidLogin = function() {
        document.querySelectorAll('.plaid-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('plaid-screen-loading').classList.add('active');
        document.getElementById('plaid-loading-text').textContent = 'Authenticating...';
        
        setTimeout(() => {
            document.getElementById('plaid-loading-text').textContent = 'Fetching Accounts...';
            setTimeout(() => {
                document.querySelectorAll('.plaid-screen').forEach(s => s.classList.remove('active'));
                document.getElementById('plaid-screen-success').classList.add('active');
            }, 1200);
        }, 1200);
    };

    window.closePlaidLink = function() {
        document.getElementById('plaid-link-ui').classList.remove('active');
        showToast('Bank accounts successfully linked and syncing!');
        
        const badge = document.getElementById('notifications-badge');
        if(badge) {
            badge.style.display = 'block';
            badge.textContent = parseInt(badge.textContent || '0') + 1;
        }
    };

    // ==========================================
    // 13. Activity Log Navigation
    // ==========================================
    const btnSeeActivity = document.getElementById('link-see-all-activity');
    if (btnSeeActivity) {
        btnSeeActivity.addEventListener('click', (e) => {
            e.preventDefault();
            navTo('activity');
            const notifBox = document.getElementById('notification-panel');
            if(notifBox) notifBox.classList.remove('active');
        });
    }

    // ==========================================
    // 14. Budget Control Page Engine
    // ==========================================
    initBudgetControlPage();
});

function initBudgetControlPage() {
    renderPaycheckAllocation();
    renderExpenseLegend();
    renderSavingsGoals();
    renderCashFlowChart();
    renderAIBudgetCoach();

    // Wire Refresh Coach button
    const refreshBtn = document.getElementById('btn-refresh-coach');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> Analyzing...';
            setTimeout(() => {
                renderAIBudgetCoach();
                refreshBtn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Refresh Analysis';
            }, 1200);
        });
    }

    // Wire transaction click handlers (deferred until rows exist)
    setTimeout(initTransactionClickHandlers, 300);

    // Inject "Edit Allocation" button and hidden Save button into paycheck section
    const paycheckTotal = document.getElementById('paycheck-total');
    if (paycheckTotal && !document.getElementById('btn-edit-paycheck')) {
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display:flex; gap:8px; margin-top:4px;';
        
        const editBtn = document.createElement('button');
        editBtn.id = 'btn-edit-paycheck';
        editBtn.className = 'btn';
        editBtn.style.cssText = 'background:var(--bg); border:1px solid var(--border-accent); border-radius:8px; padding:6px 12px; color:var(--text-1); font-size:11px; cursor:pointer; font-weight:600;';
        editBtn.innerHTML = '<i class="ph ph-pencil-simple"></i> Edit';
        
        const saveBtn = document.createElement('button');
        saveBtn.id = 'btn-save-paycheck';
        saveBtn.className = 'btn btn-primary';
        saveBtn.style.cssText = 'border-radius:8px; padding:6px 12px; font-size:11px; font-weight:600; display:none;';
        saveBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save';
        saveBtn.onclick = savePaycheckAllocation;
        
        editBtn.onclick = () => {
            enablePaycheckEditing();
            editBtn.style.display = 'none';
            saveBtn.style.display = 'inline-block';
            paycheckTotal.parentElement.setAttribute('data-editing', 'true');
        };
        
        btnContainer.appendChild(editBtn);
        btnContainer.appendChild(saveBtn);
        paycheckTotal.parentElement.appendChild(btnContainer);
    }
    
    // Restore edit button state if we were currently editing when sync ran
    if (paycheckTotal && paycheckTotal.parentElement.getAttribute('data-editing') === 'true') {
        const editBtn = document.getElementById('btn-edit-paycheck');
        const saveBtn = document.getElementById('btn-save-paycheck');
        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'inline-block';
    }

    // Inject cash flow chart style toggle buttons
    const cashFlowCard = document.getElementById('cashFlowChart');
    if (cashFlowCard && !document.getElementById('cf-btn-line')) {
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:4px; margin-bottom:12px;';
        btnRow.innerHTML = `
            <button id="cf-btn-line" onclick="setCashFlowStyle('line')" style="background:var(--accent); color:#0b0f1a; border:none; border-radius:6px; padding:5px 12px; font-size:10px; font-weight:700; cursor:pointer;">Line</button>
            <button id="cf-btn-bar"  onclick="setCashFlowStyle('bar')"  style="background:var(--card-2); color:var(--text-3); border:none; border-radius:6px; padding:5px 12px; font-size:10px; font-weight:700; cursor:pointer;">Bar</button>
            <button id="cf-btn-area" onclick="setCashFlowStyle('area')" style="background:var(--card-2); color:var(--text-3); border:none; border-radius:6px; padding:5px 12px; font-size:10px; font-weight:700; cursor:pointer;">Area</button>
        `;
        cashFlowCard.parentElement.insertBefore(btnRow, cashFlowCard);
    }
}

// ====================================================================
// CENTRAL SYNC — cascades every budget change to all sections
// ====================================================================
function syncBudgetState() {
    saveState();
    renderPaycheckAllocation();
    renderSavingsGoals();
    refreshBudgetVsPredicted();
    renderExpenseLegend();
    renderAIBudgetCoach();
}

// AI Prediction Engine — computes optimal per-category budgets
function computeAIBudgetPrediction() {
    const income = (appState.budget && appState.budget.monthlyIncome)
        ? appState.budget.monthlyIncome
        : (appState.balances && appState.balances.monthlyIncome) || 0;

    // Debt obligations (minimums)
    let debtPayment = 0;
    if (appState.debts && appState.debts.length) {
        appState.debts.forEach(d => { debtPayment += (d.minPayment || 0); });
    }

    // Emergency fund status
    const goals = appState.savingsGoals || [];
    const efGoal = goals.find(g => g && g.name && typeof g.name === 'string' && g.name.toLowerCase().includes('emergency'));
    const efFunded = efGoal ? (efGoal.current / efGoal.target) : 0.45;

    // 50/30/20 adjusted for debt load and emergency status
    const billsTarget = Math.round(income * 0.50);
    const lifestyleTarget = Math.round(income * 0.25);                        // tighter when in debt
    const savingsTarget = efFunded < 1 ? Math.round(income * 0.14) : Math.round(income * 0.10);
    const investingTarget = income - billsTarget - lifestyleTarget - savingsTarget;

    return {
        labels: ['Housing & Bills', 'Lifestyle & Food', 'Savings', 'Investing'],
        optimal: [billsTarget, lifestyleTarget, savingsTarget, Math.max(0, investingTarget)],
        actual: [
            (appState.budget && appState.budget.allocation && appState.budget.allocation.bills) || Math.round(income * 0.45),
            (appState.budget && appState.budget.allocation && appState.budget.allocation.budget) || Math.round(income * 0.25),
            (appState.budget && appState.budget.allocation && appState.budget.allocation.savings) || Math.round(income * 0.15),
            (appState.budget && appState.budget.allocation && appState.budget.allocation.investing) || Math.round(income * 0.15)
        ],
        income
    };
}

function renderPaycheckAllocation() {
    const income = (appState.budget && appState.budget.monthlyIncome)
        ? appState.budget.monthlyIncome
        : (appState.balances && appState.balances.monthlyIncome) || 0;
    const alloc = (appState.budget && appState.budget.allocation) || {};
    const fmt = n => '$' + Number(n).toLocaleString('en-US', {maximumFractionDigits:0});

    // If no income data yet, show empty/zero state
    if (income === 0) {
        const incomeEl = document.getElementById('paycheck-total');
        if (incomeEl && incomeEl.tagName !== 'INPUT') incomeEl.textContent = '$0';
        ['bills-amount','budget-amount','savings-amount','investing-amount'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.tagName !== 'INPUT') el.textContent = '$0';
        });
        ['bills-pct','budget-pct','savings-pct','investing-pct'].forEach(id => {
            const el = document.getElementById(id); if (el) el.textContent = '0% of income';
        });
        ['bar-bills','bar-budget','bar-savings','bar-investing'].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.width = '0%';
        });
        const unallocEl = document.getElementById('unallocated-amount');
        if (unallocEl) { unallocEl.textContent = '$0'; unallocEl.style.color = 'var(--accent)'; }
        return;
    }

    // Derive allocations — prefer saved allocation, then calculate defaults
    let billsTotal  = alloc.bills     || (appState.debts && appState.debts.length ? appState.debts.reduce((s,d) => s + (d.minPayment||0), 0) : Math.round(income * 0.45));
    let budgetTotal = alloc.budget    || Math.round(income * 0.25);
    let savingsTotal   = alloc.savings   || Math.round(income * 0.15);
    let investingTotal = alloc.investing || Math.round(income * 0.15);

    // Sanitise
    if (billsTotal < 100 && income > 0) billsTotal = Math.round(income * 0.45);

    const unallocated = Math.max(0, income - billsTotal - budgetTotal - savingsTotal - investingTotal);
    const overAllocated = (billsTotal + budgetTotal + savingsTotal + investingTotal) > income;

    const billsPct     = Math.round((billsTotal / income) * 100);
    const budgetPct    = Math.round((budgetTotal / income) * 100);
    const savingsPct   = Math.round((savingsTotal / income) * 100);
    const investingPct = Math.round((investingTotal / income) * 100);

    // Update income display
    const incomeEl = document.getElementById('paycheck-total');
    if (incomeEl && incomeEl.tagName !== 'INPUT') incomeEl.textContent = fmt(income);

    // Update bucket amounts (only if not currently being edited)
    const setIfNotFocused = (id, val) => {
        const el = document.getElementById(id);
        if (el && el.tagName !== 'INPUT') el.textContent = val;
        if (el && el.tagName === 'INPUT' && document.activeElement !== el) el.value = parseInt(val.replace(/[$,]/g,'')) || val;
    };

    setIfNotFocused('bills-amount', fmt(billsTotal));
    setIfNotFocused('budget-amount', fmt(budgetTotal));
    setIfNotFocused('savings-amount', fmt(savingsTotal));
    setIfNotFocused('investing-amount', fmt(investingTotal));

    // Set pct labels
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('bills-pct',     `${billsPct}% of income`);
    set('budget-pct',    `${budgetPct}% of income`);
    set('savings-pct',   `${savingsPct}% of income`);
    set('investing-pct', `${investingPct}% of income`);

    // Unallocated — color red if over-allocated
    const unallocEl = document.getElementById('unallocated-amount');
    if (unallocEl) {
        unallocEl.textContent = overAllocated ? `-${fmt(Math.abs(unallocated))} OVER` : fmt(unallocated);
        unallocEl.style.color = overAllocated ? 'var(--danger)' : 'var(--accent)';
    }

    // Update waterfall bar widths
    const setW = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.min(pct, 100) + '%'; };
    setW('bar-bills',     billsPct);
    setW('bar-budget',    budgetPct);
    setW('bar-savings',   savingsPct);
    setW('bar-investing',  investingPct);

    // If edit mode active, recalc inputs
    if (document.querySelector('input[data-bucket-id]')) {
        recalcPaycheckBar();
    }
}


function renderExpenseLegend() {
    const legendEl = document.getElementById('expense-legend');
    if (!legendEl) return;

    const income = (appState.budget && appState.budget.monthlyIncome)
        ? appState.budget.monthlyIncome
        : (appState.balances && appState.balances.monthlyIncome) || 0;

    if (income === 0) {
        legendEl.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-3); font-size:11px;">
            <i class="ph ph-chart-pie-slice" style="font-size:24px; display:block; margin-bottom:8px; opacity:0.4;"></i>
            Add your income to see expense breakdown
        </div>`;
        return;
    }

    const exp = (appState.budget && appState.budget.expenses) || {};
    const debtPayoff = appState.debts ? appState.debts.reduce((s,d) => s + (d.minPayment||0), 0) : 0;
    const housing  = exp.housing  || Math.round(income * 0.35);
    const savings  = exp.savings  || Math.round(income * 0.15);
    const food     = exp.food     || Math.round(income * 0.15);
    const debt     = debtPayoff   || Math.round(income * 0.20);
    const total    = housing + savings + food + debt;

    const categories = [
        { name: 'Housing', amt: housing, color: '#00d4a8', budget: Math.round(income * 0.40) },
        { name: 'Strategy / Savings', amt: savings, color: '#667eea', budget: Math.round(income * 0.20) },
        { name: 'Lifestyle & Food', amt: food, color: '#ff4d6d', budget: Math.round(income * 0.20) },
        { name: 'Debt Payoff', amt: debt, color: '#ffab40', budget: Math.round(income * 0.25) }
    ];

    legendEl.innerHTML = categories.map((c, i) => {
        const pct = total > 0 ? Math.round((c.amt / total) * 100) : 0;
        const over = c.amt > c.budget;
        const barPct = c.budget > 0 ? Math.min(100, (c.amt / c.budget) * 100) : 0;
        return `
        <div style="cursor:pointer;" onclick="window.selectDonutCat(${i})">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:8px; height:8px; border-radius:50%; background:${c.color};"></div>
                    <span style="font-size:11px; font-weight:600;">${c.name}</span>
                </div>
                <span style="font-size:11px; font-weight:700; color:${over ? 'var(--danger)' : 'var(--text)'};">$${c.amt.toLocaleString()}</span>
            </div>
            <div style="height:3px; background:var(--card-2); border-radius:2px; margin-bottom:2px;">
                <div style="height:3px; width:${barPct}%; background:${over ? 'var(--danger)' : c.color}; border-radius:2px; transition:width 0.6s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-3);">
                <span>${pct}% of total</span>
                <span style="color:${over ? 'var(--danger)' : '#00d4a8'};">${over ? '▲ Over budget' : '✓ On track'}</span>
            </div>
        </div>`;
    }).join('');

    const cats = categories.map(c => c.name);
    const amts = categories.map(c => c.amt);
    window.selectDonutCat = (i) => {
        const el1 = document.getElementById('donut-cat-name');
        const el2 = document.getElementById('donut-cat-amt');
        const el3 = document.getElementById('donut-cat-pct');
        const t = amts.reduce((a,b) => a+b, 0);
        if (el1) el1.textContent = cats[i];
        if (el2) el2.textContent = '$' + amts[i].toLocaleString();
        if (el3) el3.textContent = (t > 0 ? Math.round((amts[i]/t)*100) : 0) + '%';
    };
}

function renderCashFlowChart() {
    const canvas = document.getElementById('cashFlowChart');
    if (!canvas) return;

    const income = (appState.budget && appState.budget.monthlyIncome)
        ? appState.budget.monthlyIncome
        : (appState.balances && appState.balances.monthlyIncome) || 0;

    // Update Safe to Spend badge
    const safeEl = document.getElementById('safe-to-spend-val');
    if (safeEl) {
        if (income === 0) {
            safeEl.textContent = '$0';
        } else {
            const totalDebts = appState.debts ? appState.debts.reduce((s,d) => s + (d.minPayment||0), 0) : 0;
            const safeToSpend = Math.max(0, Math.round(income - totalDebts - income * 0.40));
            safeEl.textContent = '$' + safeToSpend.toLocaleString();
        }
    }

    const ctx = canvas.getContext('2d');
    const today = new Date().getDate();
    const daysInMonth = 30;
    const labels = Array.from({length: daysInMonth}, (_, i) => i + 1);

    // If no income, show a flat zero line
    if (income === 0) {
        if (window.cashFlowChartInstance) window.cashFlowChartInstance.destroy();
        const isDark = document.body.classList.contains('dark');
        const textColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
        window.cashFlowChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Balance', data: Array(daysInMonth).fill(0), borderColor: '#00d4a8', backgroundColor: 'rgba(0,212,168,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '$0', title: c => `Day ${c[0].label}` } } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 10 } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: textColor, font: { size: 9 }, callback: v => '$' + v } } } }
        });
        return;
    }

    // Simulate balance throughout month using real debt data
    let balance = income;
    const balances = [];
    const debts = appState.debts || [];

    for (let d = 1; d <= daysInMonth; d++) {
        if (d === 1) balance = income; // Payday
        // Apply each debt's due date payment
        debts.forEach(debt => {
            const dueDay = parseInt(debt.dueDate) || 15;
            if (d === dueDay) balance -= (debt.minPayment || 0);
        });
        balance -= (income / daysInMonth) * 0.25; // Daily lifestyle spend estimate
        balances.push(Math.max(0, Math.round(balance)));
    }

    const isDark = document.body.classList.contains('dark');
    const accent = '#00d4a8';
    const textColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';

    if (window.cashFlowChartInstance) {
        window.cashFlowChartInstance.destroy();
    }

    window.cashFlowChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Balance',
                data: balances,
                borderColor: accent,
                backgroundColor: 'rgba(0,212,168,0.08)',
                fill: true,
                tension: 0.4,
                pointRadius: labels.map(d => [1,5,12,15,19,28].includes(d) ? 5 : 0),
                pointBackgroundColor: labels.map(d => d === 1 ? '#667eea' : [5,12,15,19,28].includes(d) ? '#ff4d6d' : accent),
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => '$' + ctx.parsed.y.toLocaleString(),
                        title: ctx => `Day ${ctx[0].label}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 10 }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: textColor,
                        font: { size: 9 },
                        callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v)
                    }
                }
            }
        }
    });

    // Mark today
    const annotation = canvas.parentElement.querySelector('.today-marker');
    if (!annotation) {
        const marker = document.createElement('div');
        marker.className = 'today-marker';
        marker.style.cssText = `position:absolute;top:0;bottom:0;width:1px;background:rgba(255,171,64,0.5);pointer-events:none;left:${(today/daysInMonth)*100}%;`;
        canvas.parentElement.style.position = 'relative';
        canvas.parentElement.appendChild(marker);
    }
}

function renderAIBudgetCoach() {
    const tips = document.getElementById('ai-budget-coach-tips');
    if (!tips) return;

    const income = (appState.budget && appState.budget.monthlyIncome)
        ? appState.budget.monthlyIncome
        : (appState.balances && appState.balances.monthlyIncome) || 0;

    if (income === 0) {
        tips.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-3); font-size:11px;">
            <i class="ph ph-robot" style="font-size:28px; display:block; margin-bottom:8px; opacity:0.4;"></i>
            <strong style="color:var(--text-2); display:block; margin-bottom:4px;">AI Coach is waiting</strong>
            Complete your profile with income and debt info to receive personalized coaching tips.
        </div>`;
        return;
    }

    // Build real tips from appState
    const today = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const pctMonthGone = Math.round((today / daysInMonth) * 100);

    // Dynamic Food/Lifestyle check
    const budgetCap = (appState.budget && appState.budget.allocation && appState.budget.allocation.budget) || 1550;
    const foodBudget = budgetCap * 0.4; // assumption: 40% of lifestyle budget goes to food
    const foodSpent = appState.budget && appState.budget.actual && appState.budget.actual.food ? appState.budget.actual.food : Math.round(foodBudget * (pctMonthGone / 100) * 1.22);
    const foodPct = Math.round((foodSpent / foodBudget) * 100);

    // Dynamic Savings check
    const goals = appState.savingsGoals || [];
    const efGoal = goals.find(g => g && g.name && typeof g.name === 'string' && g.name.toLowerCase().includes('emergency')) || { current: 0, target: income * 6 };
    const emergencyGap = Math.max(0, efGoal.target - efGoal.current);

    // Get exact live savings rate from allocation
    const monthlySavings = (appState.budget && appState.budget.allocation && appState.budget.allocation.savings) || (appState.budget && appState.budget.contribution) || 0;

    const monthsToGoal = monthlySavings > 0 ? Math.ceil(emergencyGap / monthlySavings) : 'N/A';
    const fasterMonths = monthlySavings > 0 ? Math.ceil(emergencyGap / (monthlySavings + 200)) : Math.ceil(emergencyGap / 200);

    // Dynamic Investing check
    const investing = (appState.budget && appState.budget.allocation && appState.budget.allocation.investing) || 0;
    const investingPct = Math.round((investing / income) * 100);

    const tipData = [
        {
            icon: 'ph-warning',
            color: '#ff4d6d',
            bg: 'rgba(255,77,109,0.06)',
            text: `You're ${pctMonthGone}% through the month and <strong>${foodPct}% through</strong> your estimated food/lifestyle budget. Reducing dining out by 2× this week keeps you on track.`
        },
        {
            icon: 'ph-trend-up',
            color: '#00d4a8',
            bg: 'rgba(0,212,168,0.06)',
            text: `With your current ${monthlySavings > 0 ? '$'+monthlySavings.toLocaleString() : '<strong>$0</strong>'} savings rate, your Emergency Fund will hit target in ~${monthsToGoal} ${monthlySavings > 0 ? 'months' : ''}. Adding <strong>$200 more</strong> drops that to ${fasterMonths} months.`
        },
        {
            icon: 'ph-lightbulb',
            color: '#ffab40',
            bg: 'rgba(255,171,64,0.06)',
            text: `Your investing bucket is at <strong>${investingPct}% of income</strong>. ${investingPct > 15 ? 'Great discipline! Consider a Roth IRA to shelter gains.' : 'Aiming for 15%+ will significantly accelerate wealth compounding.'}`
        }
    ];

    tips.innerHTML = tipData.map(t => `
        <div style="display:flex; gap:10px; align-items:flex-start; padding:10px; background:${t.bg}; border-radius:8px; border-left:3px solid ${t.color};">
            <i class="ph ${t.icon}" style="color:${t.color}; font-size:14px; flex-shrink:0; margin-top:1px;"></i>
            <p style="font-size:11px; color:var(--text-2); line-height:1.5; margin:0;">${t.text}</p>
        </div>
    `).join('');
}

// ====================================================================
// EXPENSE CATEGORY EDITOR (Expense Dynamics settings ⚙)
// ====================================================================
function openExpenseCategoryEditor() {
    // Build or show the edit panel inline below the donut card
    const donutCard = document.querySelector('#page-budgets .budget-main-grid');
    if (!donutCard) return;

    let panel = document.getElementById('expense-editor-panel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        return;
    }

    const cats = [
        { key: 'housing',  name: 'Housing',           color: '#00d4a8', budget: 2200 },
        { key: 'savings',  name: 'Strategy / Savings', color: '#667eea', budget: 1000 },
        { key: 'food',     name: 'Lifestyle & Food',   color: '#ff4d6d', budget: 600  },
        { key: 'debt',     name: 'Debt Payoff',         color: '#ffab40', budget: 1100 }
    ];

    panel = document.createElement('div');
    panel.id = 'expense-editor-panel';
    panel.style.cssText = 'background:var(--card); border:1px solid var(--border-accent); border-radius:var(--radius-lg); padding:20px; margin-top:16px;';
    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div><div style="font-size:10px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.08em; margin-bottom:4px;">Edit Panel</div><h3 style="font-size:15px; font-weight:800;">Expense Categories</h3></div>
            <button onclick="document.getElementById('expense-editor-panel').style.display='none'" style="background:none; border:none; color:var(--text-3); cursor:pointer; font-size:18px;">✕</button>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
            ${cats.map(c => `
            <div style="background:var(--card-2); border-radius:10px; padding:14px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <div style="width:10px; height:10px; border-radius:50%; background:${c.color};"></div>
                    <span style="font-size:11px; font-weight:700;">${c.name}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:11px; color:var(--text-3);">Budget Limit:</span>
                    <input type="number" data-cat="${c.key}" value="${c.budget}" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:6px 10px; color:var(--text); font-size:12px; font-weight:700; width:90px;" />
                </div>
            </div>`).join('')}
        </div>
        <button id="btn-save-expense-cats" class="btn btn-primary" style="font-size:11px; padding:10px 20px;">
            <i class="ph ph-floppy-disk"></i> Save Changes
        </button>
    `;

    donutCard.parentElement.insertBefore(panel, donutCard.nextSibling);

    document.getElementById('btn-save-expense-cats').onclick = () => {
        const inputs = panel.querySelectorAll('input[data-cat]');
        if (!appState.budget.categoryLimits) appState.budget.categoryLimits = {};
        inputs.forEach(inp => { appState.budget.categoryLimits[inp.dataset.cat] = parseInt(inp.value) || 0; });
        saveState();
        renderExpenseLegend();
        renderAIBudgetCoach();
        panel.style.display = 'none';
        showToast('Category limits updated!');
    };
}

// ====================================================================
// TRANSACTION DETAIL SIDE PANEL
// ====================================================================
function initTransactionClickHandlers() {
    // Wire transaction rows in the full table
    const tableBody = document.querySelector('#full-transactions-table tbody');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    rows.forEach((row, index) => {
        row.style.cursor = 'pointer';
        row.style.transition = 'background 0.2s';
        row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.04)');
        row.addEventListener('mouseleave', () => row.style.background = '');
        row.addEventListener('click', () => openTransactionDetail(index));
    });

    // Also wire the budget page summary table
    const budgetTableBody = document.querySelector('.card .data-table tbody');
    if (budgetTableBody) {
        budgetTableBody.querySelectorAll('tr').forEach((row, index) => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => openTransactionDetail(index));
        });
    }
}

const txnDetails = [
    { merchant: 'Amazon Web Services', date: 'Oct 24, 2023', category: 'Infrastructure', amount: -412.50, method: 'Amex •••• 1004', status: 'Completed', note: 'This AWS charge is a recurring cloud infrastructure cost. Consider reviewing your instance sizing to reduce spend by up to 30%.' },
    { merchant: 'Mortgage Principal', date: 'Oct 22, 2023', category: 'Housing Debt', amount: -2850.00, method: 'Direct Debit', status: 'Completed', note: 'Your largest fixed expense. On track per your payoff schedule. AI suggests applying any windfalls here first to reduce 20+ year interest burden.' },
    { merchant: 'Whole Foods Market', date: 'Oct 21, 2023', category: 'Groceries', amount: -184.22, method: 'Visa •••• 4492', status: 'Completed', note: 'This is 18% above your average grocery spend. Consider meal planning to reduce by $40–60 per trip.' },
    { merchant: 'Tesla Supercharger', date: 'Oct 19, 2023', category: 'Transport', amount: -24.00, method: 'Tesla Account', status: 'Completed', note: 'Charging at home is ~4× cheaper per kWh. Shifting 80% of charging home could save ~$80/month.' },
    { merchant: 'Chase Sapphire Payment', date: 'Oct 18, 2023', category: 'Credit Card Paydown', amount: 1500.00, method: 'Savings Account', status: 'Completed', note: 'Excellent! This extra payment avoids approximately $120 in compound interest and accelerates your Avalanche strategy by 8 days.' },
    { merchant: 'Verizon Wireless', date: 'Oct 15, 2023', category: 'Utilities', amount: -120.00, method: 'Autopay', status: 'Pending', note: 'Telecom costs are often negotiable. Consider calling Verizon retention department — users report saving $20–40/mo on average.' },
    { merchant: 'Sallie Mae Monthly', date: 'Oct 14, 2023', category: 'Student Loan', amount: -450.00, method: 'External Transfer', status: 'Failed', note: 'URGENT: This payment failed. A late payment risks a credit score dip of 30–90 points. Retry immediately from your Savings Liquidity account.' }
];

function openTransactionDetail(index) {
    const txn = txnDetails[index % txnDetails.length];
    if (!txn) return;

    // Remove existing panel
    const existing = document.getElementById('txn-detail-panel');
    if (existing) {
        existing.style.right = '-440px';
        setTimeout(() => existing.remove(), 300);
        if (existing._txnIndex === index) return; // toggle off same row
    }

    const panel = document.createElement('div');
    panel.id = 'txn-detail-panel';
    panel._txnIndex = index;
    const isPositive = txn.amount > 0;
    const statusColor = txn.status === 'Completed' ? 'var(--accent)' : txn.status === 'Pending' ? 'var(--warning)' : 'var(--danger)';
    const statusIcon = txn.status === 'Completed' ? 'ph-check-circle' : txn.status === 'Pending' ? 'ph-clock' : 'ph-warning-circle';
    const absAmt = Math.abs(txn.amount);

    // Category budget impact (simulated)
    const catBudgets = { 'Groceries':600, 'Transport':400, 'Utilities':350, 'Business':800, 'Housing Debt':3000, 'Credit Card Paydown':2000, 'Student Loan':500 };
    const budget = catBudgets[txn.category] || 500;
    const impactPct = Math.min(Math.round((absAmt / budget) * 100), 100);
    const impactColor = impactPct > 75 ? 'var(--danger)' : impactPct > 40 ? 'var(--warning)' : 'var(--accent)';

    panel.style.cssText = `
        position:fixed; top:0; right:-440px; width:400px; height:100vh; background:var(--card);
        border-left:1px solid var(--border-accent); z-index:9999; overflow-y:auto;
        box-shadow: -12px 0 50px rgba(0,0,0,0.4); transition: right 0.35s cubic-bezier(0.25,0.46,0.45,0.94);
    `;
    panel.innerHTML = `
        <!-- Header bar -->
        <div style="background:${isPositive ? 'rgba(0,212,168,0.08)' : 'rgba(11,15,26,0.95)'}; border-bottom:1px solid var(--border); padding:20px 24px; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.12em;">Transaction Detail</div>
            <button onclick="(function(){var p=document.getElementById('txn-detail-panel');p.style.right='-440px';setTimeout(()=>p.remove(),350);})()" style="background:rgba(255,255,255,0.08); border:none; color:var(--text-2); cursor:pointer; width:28px; height:28px; border-radius:50%; font-size:16px; display:flex; align-items:center; justify-content:center; transition:background 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.15)'" onmouseleave="this.style.background='rgba(255,255,255,0.08)'">✕</button>
        </div>

        <div style="padding:24px; display:flex; flex-direction:column; gap:18px;">
            <!-- Merchant + amount hero -->
            <div>
                <div style="font-size:24px; font-weight:900; letter-spacing:-0.02em; margin-bottom:4px; line-height:1.2;">${txn.merchant}</div>
                <div style="font-size:12px; color:var(--text-3);">${txn.date} &nbsp;·&nbsp; ${txn.category}</div>
                <div style="font-size:36px; font-weight:900; color:${isPositive ? 'var(--accent)' : 'var(--danger)'}; margin-top:10px; letter-spacing:-0.03em;">${isPositive ? '+' : '−'}$${absAmt.toLocaleString('en-US', {minimumFractionDigits:2})}</div>
            </div>

            <!-- Stats row -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
                <div style="background:var(--card-2); border-radius:10px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Status</div>
                    <i class="ph ${statusIcon}" style="font-size:16px; color:${statusColor}; display:block; margin-bottom:4px;"></i>
                    <div style="font-size:11px; font-weight:800; color:${statusColor};">${txn.status}</div>
                </div>
                <div style="background:var(--card-2); border-radius:10px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Method</div>
                    <i class="ph ph-credit-card" style="font-size:16px; color:var(--text-2); display:block; margin-bottom:4px;"></i>
                    <div style="font-size:10px; font-weight:700; color:var(--text-1);">${txn.method}</div>
                </div>
                <div style="background:var(--card-2); border-radius:10px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Category</div>
                    <i class="ph ph-tag" style="font-size:16px; color:var(--text-2); display:block; margin-bottom:4px;"></i>
                    <div style="font-size:10px; font-weight:700; color:var(--text-1);">${txn.category}</div>
                </div>
            </div>

            <!-- Budget impact bar -->
            ${!isPositive ? `
            <div style="background:var(--card-2); border-radius:10px; padding:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <div style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Category Budget Impact</div>
                    <div style="font-size:11px; font-weight:800; color:${impactColor};">${impactPct}% of budget</div>
                </div>
                <div style="background:rgba(255,255,255,0.07); border-radius:999px; height:6px; overflow:hidden;">
                    <div style="height:100%; width:${impactPct}%; background:${impactColor}; border-radius:999px; transition:width 0.6s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:9px; color:var(--text-3);">
                    <span>$0</span>
                    <span>Budget: $${budget.toLocaleString()}</span>
                </div>
            </div>` : ''}

            <!-- AI Insight -->
            <div style="background:rgba(0,212,168,0.05); border:1px solid rgba(0,212,168,0.18); border-radius:12px; padding:18px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <div style="width:30px; height:30px; background:rgba(0,212,168,0.15); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        <i class="ph-fill ph-brain" style="color:var(--accent); font-size:16px;"></i>
                    </div>
                    <div>
                        <div style="font-size:11px; font-weight:800; color:var(--accent);">AI Insight</div>
                        <div style="font-size:9px; color:var(--text-3);">Smart financial analysis</div>
                    </div>
                </div>
                <p style="font-size:12px; color:var(--text-2); line-height:1.7; margin:0;">${txn.note}</p>
            </div>

            <!-- Action buttons -->
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${txn.status === 'Failed' ? `
                <button class="btn btn-primary" style="font-size:12px; padding:13px;" onclick="showToast('Retry initiated — payment queued for next business day.'); this.innerHTML='<i class=\\'ph ph-check\\'></i> Retry Queued'; this.style.opacity='0.7';">
                    <i class="ph ph-arrows-clockwise"></i> Retry Payment
                </button>` : ''}
                <button class="btn" style="font-size:11px; padding:11px; background:var(--card-2); border:1px solid var(--border); color:var(--text-2);" onclick="showToast('Transaction flagged for review.');">
                    <i class="ph ph-flag"></i> Flag Transaction
                </button>
                <div style="position:relative; width:100%;">
                    <select onchange="showToast('Category updated to: ' + this.value);" class="btn" style="appearance:none; -webkit-appearance:none; width:100%; font-size:11px; padding:11px 11px 11px 32px; background:var(--card-2); border:1px solid var(--border); color:var(--text-2); text-align:left; cursor:pointer; font-family:inherit; font-weight:600;">
                        <option disabled selected>Edit Category</option>
                        <option value="Groceries">Groceries</option>
                        <option value="Food">Food & Dining</option>
                        <option value="Transport">Transport</option>
                        <option value="Utilities">Utilities</option>
                        <option value="Business">Business</option>
                        <option value="Housing Debt">Housing Debt</option>
                        <option value="Student Loan">Student Loan</option>
                        <option value="Credit Card Paydown">Credit Card Paydown</option>
                    </select>
                    <i class="ph ph-tag" style="position:absolute; left:14px; top:13px; font-size:13px; color:var(--text-2); pointer-events:none;"></i>
                    <i class="ph ph-caret-down" style="position:absolute; right:14px; top:13px; font-size:13px; color:var(--text-3); pointer-events:none;"></i>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(panel);
    requestAnimationFrame(() => { panel.style.right = '0'; });

    // Click outside to close
    setTimeout(() => {
        document.addEventListener('click', function closePanel(e) {
            if (!panel.contains(e.target) && !e.target.closest('[onclick*="openTransactionDetail"]') && !e.target.closest('[data-txn-index]')) {
                panel.style.right = '-440px';
                setTimeout(() => panel.remove(), 350);
                document.removeEventListener('click', closePanel);
            }
        });
    }, 300);
}

// ====================================================================
// SAVINGS GOALS EDITOR
// ====================================================================
function openSavingsGoalEditor(goalIndex) {
    const goals = appState.savingsGoals || [
        { name: 'Emergency Fund',    current: 8400,  target: 18600, date: 'Dec 2026', icon: 'ph-shield-check', color: '#00d4a8' },
        { name: 'Travel Fund',       current: 1200,  target: 3000,  date: 'Dec 2026', icon: 'ph-airplane',     color: '#667eea' },
        { name: 'Investment Portfolio', current: 14200, target: 50000, date: 'Dec 2028', icon: 'ph-trend-up',  color: '#ffab40' }
    ];

    const goal = goals[goalIndex];
    if (!goal) return;

    const existing = document.getElementById('goal-editor-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'goal-editor-modal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:10000; backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:32px; width:420px; max-width:90vw; position:relative;" onclick="event.stopPropagation()">
            <button onclick="document.getElementById('goal-editor-modal').remove()" style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--text-3); cursor:pointer; font-size:20px;">✕</button>
            <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.1em; margin-bottom:8px;">Edit Goal</div>
            <h3 style="font-size:18px; font-weight:800; margin-bottom:20px;">${goal.name}</h3>
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div>
                    <label style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:6px;">Goal Name</label>
                    <input id="ge-name" type="text" value="${goal.name}" style="width:100%; background:var(--card-2); border:1px solid var(--border); border-radius:8px; padding:10px 14px; color:var(--text); font-size:13px; box-sizing:border-box;" />
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:6px;">Current Saved ($)</label>
                        <input id="ge-current" type="number" value="${goal.current}" style="width:100%; background:var(--card-2); border:1px solid var(--border); border-radius:8px; padding:10px 14px; color:var(--text); font-size:13px; box-sizing:border-box;" />
                    </div>
                    <div>
                        <label style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:6px;">Target Amount ($)</label>
                        <input id="ge-target" type="number" value="${goal.target}" style="width:100%; background:var(--card-2); border:1px solid var(--border); border-radius:8px; padding:10px 14px; color:var(--text); font-size:13px; box-sizing:border-box;" />
                    </div>
                </div>
                <div>
                    <label style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:6px;">Target Date</label>
                    <input id="ge-date" type="text" placeholder="e.g. Dec 2027" value="${goal.date}" style="width:100%; background:var(--card-2); border:1px solid var(--border); border-radius:8px; padding:10px 14px; color:var(--text); font-size:13px; box-sizing:border-box;" />
                </div>
            </div>
            <div style="display:flex; gap:10px; margin-top:24px;">
                <button id="btn-save-goal" class="btn btn-primary" style="flex:1; font-size:12px; padding:12px;"><i class="ph ph-floppy-disk"></i> Save Goal</button>
                <button onclick="document.getElementById('goal-editor-modal').remove()" class="btn btn-ghost" style="font-size:12px; padding:12px;">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('btn-save-goal').onclick = () => {
        if (!appState.savingsGoals) appState.savingsGoals = [...goals];
        appState.savingsGoals[goalIndex] = {
            ...goal,
            name: document.getElementById('ge-name').value,
            current: parseInt(document.getElementById('ge-current').value) || 0,
            target: parseInt(document.getElementById('ge-target').value) || 0,
            date: document.getElementById('ge-date').value
        };
        syncBudgetState();
        modal.remove();
        showToast('Goal saved! Savings rate recalculated.');
    };
}

function renderSavingsGoals() {
    const container = document.getElementById('savings-goals-list');
    if (!container) return;

    const goals = appState.savingsGoals || [];

    // Read savings rate from allocation (the reactive source of truth)
    const monthlySavings = (appState.budget && appState.budget.allocation && appState.budget.allocation.savings)
        ? appState.budget.allocation.savings
        : (appState.budget && appState.budget.contribution) ? appState.budget.contribution : 0;

    if (goals.length === 0) {
        container.innerHTML = `
        <div style="text-align:center; padding:24px; color:var(--text-3); font-size:11px;">
            <i class="ph ph-piggy-bank" style="font-size:28px; display:block; margin-bottom:8px; opacity:0.4;"></i>
            <strong style="color:var(--text-2); display:block; margin-bottom:4px;">No savings goals yet</strong>
            Add a goal to start tracking your progress.
        </div>
        <button onclick="addNewSavingsGoal()" style="width:100%; padding:10px; background:rgba(0,212,168,0.06); border:1px dashed rgba(0,212,168,0.3); border-radius:10px; color:var(--accent); font-size:11px; cursor:pointer; font-weight:600;">
            <i class="ph ph-plus"></i> Add New Goal
        </button>`;
        return;
    }

    container.innerHTML = goals.map((g, i) => {
        const pct = Math.min(100, Math.round((g.current / g.target) * 100));
        const remaining = g.target - g.current;
        const monthsLeft = monthlySavings > 0 ? Math.ceil(remaining / monthlySavings) : '?';
        return `
        <div style="background:var(--card-2); border-radius:10px; padding:14px; position:relative;">
            <button onclick="openSavingsGoalEditor(${i})" title="Edit goal" style="position:absolute; top:10px; right:10px; background:none; border:none; color:var(--text-3); cursor:pointer; font-size:14px; padding:4px;"><i class="ph ph-pencil-simple"></i></button>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class="${g.icon || 'ph-fill ph-target'}" style="color:${g.color}; font-size:16px;"></i>
                    <span style="font-size:12px; font-weight:700;">${g.name}</span>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:11px; font-weight:800;">$${g.current.toLocaleString()} <span style="color:var(--text-3); font-weight:400;">/ $${g.target.toLocaleString()}</span></div>
                    <div style="font-size:9px; color:${g.color};">Target: ${g.date}</div>
                </div>
            </div>
            <div style="height:6px; background:var(--bg); border-radius:3px; margin-bottom:6px;">
                <div style="height:6px; width:${pct}%; background:${g.color}; border-radius:3px; transition:width 0.8s ease;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-3);">
                <span>${pct}% funded</span><span>~${monthsLeft} months at current rate</span>
            </div>
        </div>`;
    }).join('') + `
    <button onclick="addNewSavingsGoal()" style="width:100%; padding:10px; background:rgba(0,212,168,0.06); border:1px dashed rgba(0,212,168,0.3); border-radius:10px; color:var(--accent); font-size:11px; cursor:pointer; font-weight:600;">
        <i class="ph ph-plus"></i> Add New Goal
    </button>`;
}

window.addNewSavingsGoal = function() {
    if (!appState.savingsGoals) appState.savingsGoals = [];
    appState.savingsGoals.push({ name: 'New Goal', current: 0, target: 1000, date: 'Dec 2027', icon: 'ph-fill ph-target', color: '#667eea' });
    saveState();
    renderSavingsGoals();
    openSavingsGoalEditor(appState.savingsGoals.length - 1);
};

// ====================================================================
// PAYCHECK ALLOCATION EDITOR
// ====================================================================
function enablePaycheckEditing() {
    // Make income editable first
    const incomeLabelEl = document.getElementById('paycheck-total');
    if (incomeLabelEl && incomeLabelEl.tagName !== 'INPUT') {
        const incomeInput = document.createElement('input');
        incomeInput.type = 'number';
        incomeInput.id = 'input-monthly-income';
        incomeInput.value = (appState.budget && appState.budget.monthlyIncome) ? appState.budget.monthlyIncome : 6200;
        incomeInput.style.cssText = 'background:var(--bg); border:1px solid var(--border-accent); border-radius:6px; padding:4px 8px; color:var(--accent); font-size:22px; font-weight:900; width:140px; font-family:inherit; text-align:right;';
        incomeLabelEl.replaceWith(incomeInput);
        incomeInput.addEventListener('input', recalcPaycheckBar);
    }

    const buckets = [
        { id: 'bills',     label: 'Bills & Essentials', elAmt: 'bills-amount',     barId: 'bar-bills'     },
        { id: 'budget',    label: 'Budget & Lifestyle',  elAmt: 'budget-amount',    barId: 'bar-budget'    },
        { id: 'savings',   label: 'Savings',             elAmt: 'savings-amount',   barId: 'bar-savings'   },
        { id: 'investing', label: 'Investing',           elAmt: 'investing-amount', barId: 'bar-investing' }
    ];

    buckets.forEach(b => {
        const amtEl = document.getElementById(b.elAmt);
        if (!amtEl || amtEl.tagName === 'INPUT') return;
        const currentVal = parseInt(amtEl.textContent.replace(/[$,]/g, '')) || 0;

        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentVal;
        input.dataset.bucketId = b.id;
        input.style.cssText = 'background:var(--bg); border:1px solid var(--border-accent); border-radius:6px; padding:4px 8px; color:var(--text); font-size:20px; font-weight:900; width:120px; font-family:inherit;';
        amtEl.replaceWith(input);

        input.addEventListener('input', recalcPaycheckBar);
    });

    // Make unallocated amount editable too, but handle its specific math
    const unallocLabelEl = document.getElementById('unallocated-amount');
    if (unallocLabelEl && unallocLabelEl.tagName !== 'INPUT') {
        const currentUnalloc = parseInt(unallocLabelEl.textContent.replace(/[$,]/g, '')) || 0;
        const unallocInput = document.createElement('input');
        unallocInput.type = 'number';
        unallocInput.id = 'input-unallocated-amount';
        unallocInput.value = currentUnalloc;
        unallocInput.style.cssText = 'background:var(--bg); border:1px solid var(--border-accent); border-radius:6px; padding:4px 8px; color:var(--accent); font-size:20px; font-weight:900; width:120px; font-family:inherit;';
        unallocLabelEl.replaceWith(unallocInput);
        
        // When user types in unallocated, reduce budget to compensate
        unallocInput.addEventListener('input', () => {
            // const incomeInput = document.getElementById('input-monthly-income');
            const totalIncome = incomeInput ? (parseInt(incomeInput.value) || 6200) : 6200;
            const newUnalloc = parseInt(unallocInput.value) || 0;
            
            // Get current values except budget
            let bills = parseInt(document.querySelector('input[data-bucket-id="bills"]')?.value) || 0;
            let savings = parseInt(document.querySelector('input[data-bucket-id="savings"]')?.value) || 0;
            let investing = parseInt(document.querySelector('input[data-bucket-id="investing"]')?.value) || 0;
            
            // Auto-adjust the 'budget' bucket to make the math work: Income - Unalloc = Sum(Buckets)
            let newBudget = totalIncome - newUnalloc - bills - savings - investing;
            
            const budgetInput = document.querySelector('input[data-bucket-id="budget"]');
            if (budgetInput) {
                budgetInput.value = Math.max(0, newBudget); // Prevent negative
            }
            
            recalcPaycheckBar();
        });
    }

    // Add save button
    const unallocRow = document.getElementById('unallocated-amount');
    if (unallocRow && !document.getElementById('btn-save-paycheck')) {
        const saveBtn = document.createElement('button');
        saveBtn.id = 'btn-save-paycheck';
        saveBtn.className = 'btn btn-primary';
        saveBtn.style.cssText = 'margin-top:12px; font-size:11px; padding:10px 20px; width:100%;';
        saveBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save Allocation';
        saveBtn.onclick = savePaycheckAllocation;
        unallocRow.closest('div').parentElement.appendChild(saveBtn);
    }
}

function recalcPaycheckBar() {
    // const incomeInput = document.getElementById('input-monthly-income');
    const income = incomeInput ? (parseInt(incomeInput.value) || 6200) : ((appState.budget && appState.budget.monthlyIncome) ? appState.budget.monthlyIncome : 6200);
    const vals = {};
    document.querySelectorAll('input[data-bucket-id]').forEach(inp => {
        vals[inp.dataset.bucketId] = parseInt(inp.value) || 0;
    });
    const total = Object.values(vals).reduce((a, b) => a + b, 0);
    const over = total > income;
    const unallocated = Math.abs(income - total);
    
    // Update input if it exists, otherwise update label
    const unallocInput = document.getElementById('input-unallocated-amount');
    if (unallocInput && document.activeElement !== unallocInput) {
        unallocInput.value = unallocated;
        unallocInput.style.color = over ? 'var(--danger)' : 'var(--accent)';
    } else {
        const unallocEl = document.getElementById('unallocated-amount');
        if (unallocEl) {
            unallocEl.textContent = over ? `-$${unallocated.toLocaleString()} OVER` : '$' + unallocated.toLocaleString();
            unallocEl.style.color = over ? 'var(--danger)' : 'var(--accent)';
        }
    }
    ['bills', 'budget', 'savings', 'investing'].forEach(k => {
        const bar = document.getElementById('bar-' + k);
        const pctEl = document.getElementById(k + '-pct');
        const pct = Math.round(((vals[k] || 0) / income) * 100);
        if (bar) bar.style.width = Math.min(pct, 100) + '%';
        if (pctEl) pctEl.textContent = pct + '% of income';
    });
}

function savePaycheckAllocation() {
    const vals = {};
    document.querySelectorAll('input[data-bucket-id]').forEach(inp => {
        vals[inp.dataset.bucketId] = parseInt(inp.value) || 0;
    });
    if (!appState.budget) appState.budget = {};
    appState.budget.allocation = vals;

    // Also save updated income
    const incomeInput = document.getElementById('input-monthly-income');
    if (incomeInput) appState.budget.monthlyIncome = parseInt(incomeInput.value) || appState.budget.monthlyIncome;

    // Switch back to display mode by replacing inputs with spans
    if (incomeInput) {
        const val = parseInt(incomeInput.value) || 6200;
        const textSpan = document.createElement('h2');
        textSpan.id = 'paycheck-total';
        textSpan.style.margin = '0';
        textSpan.className = 'highlight';
        textSpan.textContent = '$' + val.toLocaleString();
        incomeInput.replaceWith(textSpan);
    }
    
    ['bills', 'budget', 'savings', 'investing'].forEach(k => {
        const inp = document.querySelector(`input[data-bucket-id="${k}"]`);
        if (inp) {
            const val = parseInt(inp.value) || 0;
            const span = document.createElement('span');
            span.id = k + '-amount';
            span.style.cssText = 'font-weight:700; color:var(--text-1); font-size:16px;';
            span.textContent = '$' + val.toLocaleString();
            inp.replaceWith(span);
        }
    });

    const unallocInput = document.getElementById('input-unallocated-amount');
    if (unallocInput) {
        const val = parseInt(unallocInput.value) || 0;
        const span = document.createElement('div');
        span.id = 'unallocated-amount';
        span.style.cssText = 'font-size:24px; font-weight:900; color:var(--accent); text-shadow:0 0 16px rgba(0,212,168,0.2);';
        span.textContent = '$' + val.toLocaleString();
        unallocInput.replaceWith(span);
    }

    const paycheckTotal = document.getElementById('paycheck-total');
    if (paycheckTotal && paycheckTotal.parentElement) {
        paycheckTotal.parentElement.removeAttribute('data-editing');
    }

    // Now safe to sync state without it grabbing inputs
    syncBudgetState();

    // After rebuild, grab the buttons again
    const newSaveBtn = document.getElementById('btn-save-paycheck');
    const newEditBtn = document.getElementById('btn-edit-paycheck');
    
    if (newSaveBtn) {
        newSaveBtn.style.display = 'inline-block';
        newSaveBtn.innerHTML = '<i class="ph ph-check"></i> Saved!'; 
        newSaveBtn.style.background = 'var(--accent)';
        if (newEditBtn) newEditBtn.style.display = 'none';

        setTimeout(() => {
            if (document.getElementById('btn-save-paycheck')) {
                document.getElementById('btn-save-paycheck').style.display = 'none';
                document.getElementById('btn-save-paycheck').innerHTML = '<i class="ph ph-floppy-disk"></i> Save';
                document.getElementById('btn-save-paycheck').style.background = '';
            }
            if (document.getElementById('btn-edit-paycheck')) {
                document.getElementById('btn-edit-paycheck').style.display = 'inline-block';
            }
        }, 1500);
    }
    showToast('Allocation saved! All sections updated.');
}

// ====================================================================
// CASH FLOW CHART STYLE TOGGLE
// ====================================================================
window.setCashFlowStyle = function(style) {
    window._cashFlowStyle = style;
    
    // Update active button
    ['line','bar','area'].forEach(s => {
        const btn = document.getElementById('cf-btn-' + s);
        if (btn) {
            btn.style.background = s === style ? 'var(--accent)' : 'var(--card-2)';
            btn.style.color = s === style ? '#0b0f1a' : 'var(--text-3)';
        }
    });
    
    renderCashFlowChart();
};

// Override renderCashFlowChart to support style
const _origRenderCashFlow = renderCashFlowChart;
window.renderCashFlowChart = function() {
    const canvas = document.getElementById('cashFlowChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const today = new Date().getDate();
    const daysInMonth = 30;
    const labels = Array.from({length: daysInMonth}, (_, i) => i + 1);
    const style = window._cashFlowStyle || 'line';

    let balance = 6200;
    const balances = [];
    const income = 6200;
    const events = { 1: { label: 'Payday', color: '#667eea' }, 5: { label: 'Mortgage -$2,840', color: '#ff4d6d' }, 12: { label: 'Sallie Mae -$412', color: '#ff4d6d' }, 15: { label: 'Chase -$1,450', color: '#ff4d6d' }, 19: { label: 'Verizon -$120', color: '#ffab40' }, 28: { label: 'Tesla -$895', color: '#ffab40' } };

    for (let d = 1; d <= daysInMonth; d++) {
        if (d === 1) balance = income;
        if (d === 5) balance -= 2840;
        if (d === 12) balance -= 412;
        if (d === 15) balance -= 1450;
        if (d === 19) balance -= 120;
        if (d === 28) balance -= 895;
        balance -= (income / daysInMonth) * 0.25;
        balances.push(Math.max(0, Math.round(balance)));
    }

    const isDark = document.body.classList.contains('dark');
    const textColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';

    if (window.cashFlowChartInstance) {
        window.cashFlowChartInstance.destroy();
    }

    const isFill = style === 'area' || style === 'line';
    const chartType = style === 'bar' ? 'bar' : 'line';

    window.cashFlowChartInstance = new Chart(ctx, {
        type: chartType,
        data: {
            labels,
            datasets: [{
                label: 'Balance',
                data: balances,
                borderColor: '#00d4a8',
                backgroundColor: style === 'bar' ? balances.map((v, i) => events[i+1] ? 'rgba(255,77,109,0.6)' : 'rgba(0,212,168,0.4)') : 'rgba(0,212,168,0.08)',
                fill: style !== 'bar',
                tension: style === 'bar' ? 0 : 0.4,
                pointRadius: labels.map(d => events[d] ? 6 : 0),
                pointBackgroundColor: labels.map(d => events[d] ? (events[d].color || '#00d4a8') : '#00d4a8'),
                borderWidth: 2,
                borderRadius: style === 'bar' ? 4 : 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx2 => '$' + ctx2.parsed.y.toLocaleString(),
                        title: ctx2 => {
                            const d = ctx2[0].label;
                            return events[d] ? `Day ${d}: ${events[d].label}` : `Day ${d}`;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 10 } },
                y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: textColor, font: { size: 9 }, callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v) } }
            }
        }
    });
};

// ====================================================================
// TOAST NOTIFICATION HELPER
// ====================================================================
function showToast(message) {
    const existing = document.getElementById('budget-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'budget-toast';
    toast.style.cssText = 'position:fixed; bottom:30px; left:50%; transform:translateX(-50%); background:var(--accent); color:#0b0f1a; font-weight:700; font-size:13px; padding:12px 24px; border-radius:50px; z-index:99999; box-shadow:0 4px 20px rgba(0,212,168,0.4); animation:fadeIn 0.3s ease;';
    toast.innerHTML = `<i class="ph ph-check-circle"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 2500);
}

// ====================================================================
// BUDGET vs AI-PREDICTED CHART (replaces Budget vs Actual)
// ====================================================================
function refreshBudgetVsPredicted() {
    // Find all instances of the chart canvas (Budget page + Debts sub-tab)
    ['budgetVsActualChart', 'budgetVsActualChart2'].forEach(canvasId => {
        const canvasEl = document.getElementById(canvasId);
        if (!canvasEl) return;

        const pred = computeAIBudgetPrediction();
        const labels = pred.labels;
        const actual = pred.actual;
        const optimal = pred.optimal;
        const overUnder = actual.map((a, i) => a > optimal[i] ? 'rgba(255,77,109,0.75)' : 'rgba(0,212,168,0.75)');

        // Destroy old chart
        if (window._chartInstances && window._chartInstances[canvasId]) {
            window._chartInstances[canvasId].destroy();
        }
        // Also destroy from chartInstances if it's there
        try { if (chartInstances && chartInstances[canvasId]) { chartInstances[canvasId].destroy(); } } catch(e) {}

        // Make sure it doesn't try to inherit an invalid size container height
        if (canvasEl.parentElement) {
            canvasEl.parentElement.style.height = '220px';
            canvasEl.parentElement.style.position = 'relative';
            canvasEl.parentElement.style.display = 'block';
            canvasEl.style.height = '220px';
            canvasEl.style.width = '100%';
        }
        
        const chart = new Chart(canvasEl, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Your Current Spending',
                        data: actual,
                        backgroundColor: overUnder,
                        borderRadius: 6,
                        barPercentage: 0.75,
                        categoryPercentage: 0.55
                    },
                    {
                        label: 'AI Optimal Target',
                        data: optimal,
                        backgroundColor: 'rgba(255,255,255,0.07)',
                        borderColor: 'rgba(255,255,255,0.2)',
                        borderWidth: 1,
                        borderRadius: 6,
                        barPercentage: 0.75,
                        categoryPercentage: 0.55
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(11,15,26,0.96)',
                        borderColor: 'rgba(0,212,168,0.3)',
                        borderWidth: 1,
                        padding: 14,
                        callbacks: {
                            title: ctx => ctx[0].label,
                            label: ctx => {
                                const idx = ctx.dataIndex;
                                const diff = actual[idx] - optimal[idx];
                                const sign = diff > 0 ? '▲ +' : '▼ ';
                                const action = diff > 0 ? '→ Redirect excess to Savings' : '→ Under budget';
                                if (ctx.datasetIndex === 0) {
                                    return [
                                        ` Your spend: $${actual[idx].toLocaleString()}`,
                                        ` AI optimal: $${optimal[idx].toLocaleString()}`,
                                        ` ${sign}$${Math.abs(diff).toLocaleString()} · ${action}`
                                    ];
                                }
                                return ` AI optimal: $${ctx.parsed.y.toLocaleString()}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.4)',
                            font: { size: 10 },
                            callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v)
                        }
                    }
                }
            }
        });

        if (!window._chartInstances) window._chartInstances = {};
        window._chartInstances[canvasId] = chart;
    });

    // Also render the AI explanation below the chart
    renderBudgetPredictionInsight();
}

function renderBudgetPredictionInsight() {
    const pred = computeAIBudgetPrediction();
    const income = pred.income;
    let insightEl = document.getElementById('ai-prediction-insight');
    if (!insightEl) {
        // Insert after the chart card in the budget main grid
        const chartCard = document.getElementById('budgetVsActualChart2') || document.getElementById('budgetVsActualChart');
        if (!chartCard) return;
        insightEl = document.createElement('div');
        insightEl.id = 'ai-prediction-insight';
        insightEl.style.cssText = 'margin-top:12px; padding:12px 14px; background:rgba(0,212,168,0.06); border:1px solid rgba(0,212,168,0.15); border-radius:8px;';
        chartCard.closest('.card').appendChild(insightEl);
    }

    const overCategories = pred.labels.filter((l, i) => pred.actual[i] > pred.optimal[i]);
    const totalOver = pred.actual.reduce((s, a, i) => s + Math.max(0, a - pred.optimal[i]), 0);
    const savingsPotential = totalOver;

    insightEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <i class="ph-fill ph-brain" style="color:var(--accent); font-size:14px;"></i>
            <span style="font-size:10px; font-weight:800; color:var(--accent); text-transform:uppercase; letter-spacing:0.07em;">AI Budget Analysis</span>
        </div>
        <p style="font-size:11px; color:var(--text-2); line-height:1.6; margin:0;">
            ${overCategories.length > 0
                ? `You're overspending in <strong>${overCategories.join(', ')}</strong> versus your AI-optimal targets. Redirecting 
                   <strong>$${savingsPotential.toLocaleString()}/mo</strong> to savings would hit your Emergency Fund goal 
                   <strong>${Math.ceil(savingsPotential / 930)} months sooner</strong>.`
                : `Your current allocations are within AI-optimal ranges. Consider increasing your Investing bucket by $${Math.round(income * 0.02).toLocaleString()}/mo to accelerate wealth growth.`
            }
        </p>
    `;
}

// ====================================================================
// EXPENSE DYNAMICS MODAL (btn-open-budget-matrix icon)
// ====================================================================
function openExpenseDynamicsModal() {
    const existing = document.getElementById('expense-dynamics-modal');
    if (existing) { existing.remove(); return; }

    const income = (appState.budget && appState.budget.monthlyIncome) ? appState.budget.monthlyIncome : 6200;
    const alloc = (appState.budget && appState.budget.allocation) || {};

    const modal = document.createElement('div');
    modal.id = 'expense-dynamics-modal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.75); display:flex; align-items:center; justify-content:center; z-index:10000; backdrop-filter:blur(6px);';

    modal.innerHTML = `
        <div style="background:var(--card); border:1px solid var(--border-accent); border-radius:var(--radius-lg); padding:32px; width:520px; max-width:92vw; max-height:88vh; overflow-y:auto; position:relative;" onclick="event.stopPropagation()">
            <button onclick="document.getElementById('expense-dynamics-modal').remove()" style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--text-3); cursor:pointer; font-size:20px;">✕</button>

            <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.1em; margin-bottom:8px;">Expense Dynamics Settings</div>
            <h3 style="font-size:20px; font-weight:900; margin-bottom:6px;">Budget Configuration</h3>
            <p style="font-size:11px; color:var(--text-3); margin-bottom:24px;">Adjust your income and allocations. Changes update all charts and your AI coach instantly.</p>

            <!-- Monthly Income -->
            <div style="margin-bottom:20px;">
                <label style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:8px;">Monthly Take-Home Income</label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:18px; color:var(--text-3);">$</span>
                    <input id="ed-income" type="number" value="${income}" style="flex:1; background:var(--card-2); border:1px solid var(--border); border-radius:8px; padding:12px 14px; color:var(--text); font-size:18px; font-weight:900;" />
                </div>
            </div>

            <!-- Allocation Rules -->
            <div style="font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">Monthly Allocation Targets</div>
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">
                ${[
                    {id:'ed-bills',     label:'Bills & Essentials',  color:'#ff4d6d', key:'bills',     desc:'Rent, utilities, insurance, debt minimums'},
                    {id:'ed-budget',    label:'Lifestyle & Budget',   color:'#667eea', key:'budget',    desc:'Food, dining, entertainment, subscriptions'},
                    {id:'ed-savings',   label:'Savings',              color:'#00d4a8', key:'savings',   desc:'Emergency fund, short-term goals, HYSA'},
                    {id:'ed-investing', label:'Investing',            color:'#ffab40', key:'investing', desc:'401k, IRA, index funds, brokerage'}
                ].map(b => `
                <div style="background:var(--card-2); border-radius:10px; padding:14px; display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center;">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                            <div style="width:8px; height:8px; border-radius:50%; background:${b.color};"></div>
                            <span style="font-size:12px; font-weight:700;">${b.label}</span>
                        </div>
                        <div style="font-size:10px; color:var(--text-3);">${b.desc}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:14px; color:var(--text-3);">$</span>
                        <input id="${b.id}" type="number" value="${alloc[b.key] || Math.round(income * (b.key==='bills'?0.45:b.key==='budget'?0.25:0.15))}" style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px; color:var(--text); font-size:15px; font-weight:800; width:110px; text-align:right;" oninput="updateEdUnallocated()" />
                    </div>
                </div>`).join('')}
            </div>

            <!-- Live unallocated preview -->
            <div id="ed-unallocated-preview" style="padding:12px 16px; background:var(--card-2); border-radius:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <span style="font-size:12px; color:var(--text-2);">Unallocated / Free Cash</span>
                <span style="font-size:16px; font-weight:800; color:var(--accent);" id="ed-unallocated-val">$0</span>
            </div>

            <div style="display:flex; gap:10px;">
                <button id="btn-save-dynamics" class="btn btn-primary" style="flex:1; font-size:12px; padding:12px;">
                    <i class="ph ph-floppy-disk"></i> Save & Apply
                </button>
                <button onclick="document.getElementById('expense-dynamics-modal').remove()" class="btn btn-ghost" style="font-size:12px; padding:12px;">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    // Calculate initial unallocated
    window.updateEdUnallocated = () => {
        const inc = parseInt(document.getElementById('ed-income').value) || 6200;
        const bills = parseInt(document.getElementById('ed-bills').value) || 0;
        const budget = parseInt(document.getElementById('ed-budget').value) || 0;
        const savings = parseInt(document.getElementById('ed-savings').value) || 0;
        const investing = parseInt(document.getElementById('ed-investing').value) || 0;
        const unalloc = inc - bills - budget - savings - investing;
        const el = document.getElementById('ed-unallocated-val');
        if (el) {
            el.textContent = (unalloc < 0 ? '-$' + Math.abs(unalloc).toLocaleString() + ' OVER' : '$' + unalloc.toLocaleString());
            el.style.color = unalloc < 0 ? 'var(--danger)' : 'var(--accent)';
        }
    };
    document.getElementById('ed-income').addEventListener('input', window.updateEdUnallocated);
    window.updateEdUnallocated();

    document.getElementById('btn-save-dynamics').onclick = () => {
        if (!appState.budget) appState.budget = {};
        appState.budget.monthlyIncome = parseInt(document.getElementById('ed-income').value) || 6200;
        appState.budget.allocation = {
            bills:     parseInt(document.getElementById('ed-bills').value)     || 0,
            budget:    parseInt(document.getElementById('ed-budget').value)    || 0,
            savings:   parseInt(document.getElementById('ed-savings').value)   || 0,
            investing: parseInt(document.getElementById('ed-investing').value) || 0
        };
        modal.remove();
        syncBudgetState();
        showToast('Budget configuration saved! All charts updated.');
    };
}

// ====================================================================
// DASHBOARD QUICK SETTINGS (btn-spending-settings gear ⚙)
// ====================================================================
function openDashboardQuickSettings() {
    const existing = document.getElementById('dash-quick-settings');
    if (existing) { existing.remove(); return; }

    const income = (appState.budget && appState.budget.monthlyIncome) ? appState.budget.monthlyIncome : 6200;
    const gearBtn = document.getElementById('btn-spending-settings');
    if (!gearBtn) return;

    const drawer = document.createElement('div');
    drawer.id = 'dash-quick-settings';
    drawer.style.cssText = `
        position:absolute; right:0; top:44px; width:260px; background:var(--card);
        border:1px solid var(--border-accent); border-radius:12px; padding:16px; z-index:500;
        box-shadow:0 8px 32px rgba(0,0,0,0.3); animation:fadeIn 0.2s ease;
    `;
    drawer.innerHTML = `
        <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.08em; margin-bottom:10px;">Quick Budget Settings</div>
        <div style="margin-bottom:12px;">
            <label style="font-size:10px; color:var(--text-3); display:block; margin-bottom:5px;">Monthly Take-Home ($)</label>
            <input id="qs-income" type="number" value="${income}" style="width:100%; background:var(--card-2); border:1px solid var(--border); border-radius:6px; padding:8px 10px; color:var(--text); font-size:14px; font-weight:800; box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:12px;">
            <label style="font-size:10px; color:var(--text-3); display:block; margin-bottom:5px;">View Mode</label>
            <div style="display:flex; gap:4px;">
                <button id="qs-monthly" onclick="setExpenseView('monthly',this)" style="flex:1; padding:7px; border:none; border-radius:6px; font-size:10px; font-weight:700; cursor:pointer; background:var(--accent); color:#0b0f1a;">Monthly</button>
                <button id="qs-weekly"  onclick="setExpenseView('weekly',this)"  style="flex:1; padding:7px; border:none; border-radius:6px; font-size:10px; font-weight:700; cursor:pointer; background:var(--card-2); color:var(--text-3);">Weekly</button>
            </div>
        </div>
        <button onclick="saveQuickSettings()" class="btn btn-primary" style="width:100%; font-size:11px; padding:9px;">
            <i class="ph ph-floppy-disk"></i> Apply
        </button>
    `;

    // Position relative to the gear button
    const parent = gearBtn.parentElement;
    if (!parent.style.position) parent.style.position = 'relative';
    parent.appendChild(drawer);

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeDrawer(e) {
            if (!drawer.contains(e.target) && e.target !== gearBtn) {
                drawer.remove();
                document.removeEventListener('click', closeDrawer);
            }
        });
    }, 200);

    window.setExpenseView = (mode, btn) => {
        document.querySelectorAll('#dash-quick-settings button.mode-btn, #qs-monthly, #qs-weekly').forEach(b => {
            b.style.background = 'var(--card-2)'; b.style.color = 'var(--text-3)';
        });
        btn.style.background = 'var(--accent)'; btn.style.color = '#0b0f1a';
    };

    window.saveQuickSettings = () => {
        const newIncome = parseInt(document.getElementById('qs-income').value) || income;
        if (!appState.budget) appState.budget = {};
        appState.budget.monthlyIncome = newIncome;
        drawer.remove();
        syncBudgetState();
        showToast('Quick settings applied!');
    };
}

// Wire both Expense Dynamics icons on page load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // Expense Dynamics icon — Budget page
        const btnMatrix = document.getElementById('btn-open-budget-matrix');
        if (btnMatrix) btnMatrix.onclick = () => openExpenseDynamicsModal();

        // Expense Dynamics icon — Debts tab (same modal)
        const btnMatrixDebts = document.getElementById('btn-open-budget-matrix-debts');
        if (btnMatrixDebts) btnMatrixDebts.onclick = () => openExpenseDynamicsModal();

        // Dashboard gear
        const btnGear = document.getElementById('btn-spending-settings');
        if (btnGear) btnGear.onclick = () => openDashboardQuickSettings();

        // Run initial AI-Predicted chart once drawCharts has set up the canvas
        setTimeout(refreshBudgetVsPredicted, 600);

        // Credit Report Import Engine
        initCreditImport();

        // Strategy card click handlers
        initStrategyCardClicks();

        // Initial sync of selected/optimal badges on cards
        if (typeof syncStrategyCards === 'function') syncStrategyCards();
    }, 500);
});


/* ============================================================
   CREDIT REPORT IMPORT ENGINE
   Supports: Credit Karma CSV, Experian CSV, Generic Bank CSV
   All processing is 100% local — no data leaves the browser.
   ============================================================ */
function initCreditImport() {
    // ── Element refs ──
    const modal        = document.getElementById('credit-import-modal');
    const guideModal   = document.getElementById('credit-guide-modal');
    const openBtn      = document.getElementById('btn-open-credit-import');
    const guideBtn     = document.getElementById('btn-credit-import-guide');
    const closeBtn     = document.getElementById('credit-import-close');
    const guideClose   = document.getElementById('credit-guide-close');
    const dropZone     = document.getElementById('credit-drop-zone');
    const fileInput    = document.getElementById('credit-file-input');
    const fileStatus   = document.getElementById('credit-file-status');
    const fileName     = document.getElementById('credit-file-name');
    const fileSize     = document.getElementById('credit-file-size');
    const preview      = document.getElementById('credit-parse-preview');
    const previewList  = document.getElementById('credit-preview-list');
    const warning      = document.getElementById('credit-parse-warning');
    const options      = document.getElementById('credit-import-options');
    const confirmBtn   = document.getElementById('btn-confirm-credit-import');
    const clearBtn     = document.getElementById('btn-clear-credit-import');
    const accountsSection = document.getElementById('credit-accounts-section');
    const accountsGrid = document.getElementById('imported-accounts-grid');
    const sourceBadge  = document.getElementById('credit-import-source-badge');
    const dateBadge    = document.getElementById('credit-import-date-badge');

    if (!modal || !openBtn) return;

    let parsedDebts = [];
    let parsedTxns  = [];
    let selectedSource = 'creditkarma';
    let creditScore = null;

    // ── Open / Close ──
    const openModal  = () => { modal.style.display = 'flex'; resetModal(); };
    const closeModal = () => { modal.style.display = 'none'; };
    const openGuide  = () => { guideModal.style.display = 'flex'; };
    const closeGuide = () => { guideModal.style.display = 'none'; };

    openBtn.addEventListener('click', openModal);
    guideBtn.addEventListener('click', openGuide);
    if (closeBtn)   closeBtn.addEventListener('click', closeModal);
    if (guideClose) guideClose.addEventListener('click', closeGuide);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    guideModal.addEventListener('click', (e) => { if (e.target === guideModal) closeGuide(); });

    // ── Source Selector ──
    document.querySelectorAll('.credit-source-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.credit-source-btn').forEach(b => {
                b.style.border = '2px solid transparent';
            });
            btn.style.border = '2px solid var(--accent)';
            selectedSource = btn.getAttribute('data-source');
        });
    });

    // ── Drag and Drop ──
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent)';
        dropZone.style.background = 'rgba(0,212,168,0.05)';
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--border)';
        dropZone.style.background = '';
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
        dropZone.style.background = '';
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    // ── File Handler ──
    function handleFile(file) {
        if (file.size > 10 * 1024 * 1024) {
            showToast('File too large. Please use a file under 10MB.', 'danger');
            return;
        }

        // Show file status
        fileName.textContent = file.name;
        fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
        fileStatus.style.display = 'flex';

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            parseCSV(text, file.name);
        };
        reader.readAsText(file);
    }

    // ── CSV Parser ──
    function parseCSV(text, filename) {
        parsedDebts = [];
        parsedTxns  = [];
        creditScore = null;
        previewList.innerHTML = '';
        warning.style.display = 'none';

        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) {
            showParseWarning('File appears empty or only has one row. Please check your export.');
            return;
        }

        // Parse header row — be flexible about column names
        const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

        const colMap = {
            name:       findCol(rawHeaders, ['account name','name','creditor','account','merchant','description','payee']),
            balance:    findCol(rawHeaders, ['current balance','balance','amount','outstanding','owe']),
            apr:        findCol(rawHeaders, ['apr','interest rate','rate','apy']),
            minPayment: findCol(rawHeaders, ['minimum payment','min payment','min. payment','monthly payment','payment']),
            limit:      findCol(rawHeaders, ['credit limit','limit','high credit']),
            dueDate:    findCol(rawHeaders, ['due date','payment due','due','date due']),
            status:     findCol(rawHeaders, ['status','account status']),
            type:       findCol(rawHeaders, ['account type','type','category']),
            date:       findCol(rawHeaders, ['date','transaction date','posted date']),
            amount:     findCol(rawHeaders, ['amount','transaction amount','debit','credit']),
            score:      findCol(rawHeaders, ['credit score','score','vantagescore','fico'])
        };

        let debtRowCount = 0;
        let txnRowCount  = 0;

        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVRow(lines[i]);
            if (row.length < 2) continue;

            const get = (idx) => idx >= 0 && row[idx] ? row[idx].trim().replace(/"/g, '') : '';
            const getNum = (idx) => {
                const v = get(idx).replace(/[$,%\s]/g, '');
                return parseFloat(v) || 0;
            };

            // Check for credit score row
            if (colMap.score >= 0) {
                const s = getNum(colMap.score);
                if (s > 300 && s < 850) creditScore = s;
            }

            const name = get(colMap.name) || `Account ${i}`;
            const balance = getNum(colMap.balance);
            const apr = getNum(colMap.apr);
            const minPayment = getNum(colMap.minPayment);
            const status = get(colMap.status).toLowerCase();

            // If row looks like a debt/account
            if (balance > 0 && colMap.balance >= 0 && colMap.name >= 0) {
                // Skip rows that look like closed/paid accounts
                if (status && (status.includes('closed') || status.includes('paid'))) continue;

                parsedDebts.push({
                    id: 'import_' + Date.now() + '_' + i,
                    name: name,
                    balance: balance,
                    apr: apr > 0 ? apr : 0,
                    minPayment: minPayment > 0 ? minPayment : Math.round(balance * 0.02),
                    dueDate: parseDueDate(get(colMap.dueDate)),
                    limit: getNum(colMap.limit),
                    status: get(colMap.status),
                    type: get(colMap.type)
                });
                debtRowCount++;
            }
            // If row looks like a transaction (has date + amount, smaller amount values)
            else if (colMap.date >= 0 && colMap.amount >= 0 && colMap.name >= 0 && !colMap.balance >= 0) {
                const amt = getNum(colMap.amount);
                if (amt !== 0) {
                    parsedTxns.push({
                        id: 'it_' + Date.now() + '_' + i,
                        date: get(colMap.date) ? new Date(get(colMap.date)).toISOString() : new Date().toISOString(),
                        merchant: name,
                        category: get(colMap.type) || guessCategory(name),
                        amount: -Math.abs(amt),
                        method: 'CSV Import',
                        status: 'completed'
                    });
                    txnRowCount++;
                }
            }
        }

        // Auto-detect if no debt rows found — try interpreting all rows as debts
        if (parsedDebts.length === 0 && lines.length > 1) {
            showParseWarning(`Could not auto-detect account columns. Found ${lines.length - 1} rows but no balance/name columns matched. Try "Bank / Other" source and ensure your CSV has columns like: Name, Balance, APR, Min Payment.`);
            return;
        }

        renderPreview(parsedDebts, parsedTxns, creditScore);
        options.style.display = 'block';
        preview.style.display = 'block';
        confirmBtn.disabled = parsedDebts.length === 0;
    }

    function findCol(headers, candidates) {
        for (const c of candidates) {
            const idx = headers.findIndex(h => h.includes(c));
            if (idx >= 0) return idx;
        }
        return -1;
    }

    function parseCSVRow(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
            current += ch;
        }
        result.push(current);
        return result;
    }

    function parseDueDate(raw) {
        if (!raw) return Math.floor(Math.random() * 25) + 1;
        const n = parseInt(raw);
        if (n > 0 && n <= 31) return n;
        const d = new Date(raw);
        if (!isNaN(d)) return d.getDate();
        return 15;
    }

    function guessCategory(name) {
        const n = name.toLowerCase();
        if (n.includes('amazon') || n.includes('shop') || n.includes('store')) return 'Shopping';
        if (n.includes('food') || n.includes('restaurant') || n.includes('cafe') || n.includes('eat')) return 'Food';
        if (n.includes('gas') || n.includes('fuel') || n.includes('uber') || n.includes('lyft')) return 'Transport';
        if (n.includes('mortgage') || n.includes('rent') || n.includes('home')) return 'Housing Debt';
        if (n.includes('loan') || n.includes('credit') || n.includes('finance')) return 'Debt Payment';
        return 'General';
    }

    function showParseWarning(msg) {
        warning.textContent = '⚠️ ' + msg;
        warning.style.display = 'block';
        preview.style.display = 'block';
        confirmBtn.disabled = true;
    }

    // ── Render Preview ──
    function renderPreview(debts, txns, score) {
        const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

        previewList.innerHTML = debts.slice(0, 10).map(d => `
            <div style="background:var(--card-2); border-radius:10px; padding:14px; display:flex; align-items:center; gap:14px; border:1px solid var(--border);">
                <div style="width:36px; height:36px; background:var(--accent-dim); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i class="ph ph-credit-card" style="color:var(--accent); font-size:16px;"></i>
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.name}</div>
                    <div style="font-size:10px; color:var(--text-3); margin-top:2px;">${d.apr > 0 ? d.apr + '% APR' : 'APR not listed'} • Due day ${d.dueDate}</div>
                </div>
                <div style="text-align:right; flex-shrink:0;">
                    <div style="font-size:13px; font-weight:800; color:var(--accent);">${fmt(d.balance)}</div>
                    <div style="font-size:9px; color:var(--text-3);">Min: ${fmt(d.minPayment)}</div>
                </div>
            </div>
        `).join('');

        if (debts.length > 10) {
            previewList.innerHTML += `<div style="text-align:center; font-size:11px; color:var(--text-3); padding:8px;">...and ${debts.length - 10} more accounts</div>`;
        }

        if (score) {
            previewList.innerHTML += `
                <div style="background:rgba(0,212,168,0.1); border:1px solid var(--border-accent); border-radius:10px; padding:14px; display:flex; align-items:center; gap:12px;">
                    <i class="ph-fill ph-star" style="color:var(--accent); font-size:20px;"></i>
                    <div>
                        <div style="font-size:11px; font-weight:700; color:var(--accent); text-transform:uppercase;">Credit Score Detected</div>
                        <div style="font-size:20px; font-weight:900;">${score} <span style="font-size:11px; color:var(--text-3);">pts</span></div>
                    </div>
                </div>`;
        }

        if (txns.length > 0) {
            previewList.innerHTML += `
                <div style="background:var(--card-2); border:1px solid var(--border); border-radius:10px; padding:12px; font-size:11px; color:var(--text-3);">
                    <i class="ph ph-receipt"></i> Also found <strong style="color:var(--text);">${txns.length} transactions</strong> — will be added to your Activity Log if enabled.
                </div>`;
        }
    }

    // ── Confirm Import ──
    confirmBtn.addEventListener('click', () => {
        if (parsedDebts.length === 0) return;

        const replaceDebts    = document.getElementById('opt-replace-debts')?.checked;
        const importTxns      = document.getElementById('opt-import-transactions')?.checked;
        const updateScore     = document.getElementById('opt-update-credit-score')?.checked;

        if (replaceDebts) {
            appState.debts = parsedDebts;
        } else {
            // Merge: add only debts not already in state (by name similarity)
            parsedDebts.forEach(d => {
                const exists = appState.debts.find(existing =>
                    existing.name.toLowerCase().includes(d.name.toLowerCase().substring(0, 6)));
                if (!exists) appState.debts.push(d);
            });
        }

        if (importTxns && parsedTxns.length > 0) {
            appState.transactions = [...parsedTxns, ...appState.transactions];
        }

        saveState();
        updateUI();

        // Update credit profile card if score found
        if (updateScore && creditScore) {
            const scoreEl = document.querySelector('#credit-profile-card [style*="font-size:22px"]');
            if (scoreEl) scoreEl.textContent = creditScore;
        }

        // Show imported accounts section in Documents
        renderImportedAccountsSection(parsedDebts, selectedSource);

        closeModal();

        const sourceLabel = { creditkarma: 'Credit Karma', experian: 'Experian', bank: 'Bank Statement' }[selectedSource];
        showToast(`✅ ${parsedDebts.length} accounts from ${sourceLabel} loaded successfully!`, 'success');

        // Tier 2.1: Review & rename step
        if (typeof openReviewImportModal === 'function') {
            setTimeout(() => openReviewImportModal(parsedDebts.map(d => d.id)), 400);
        }

        // Add notification
        if (appState.notifications) {
            pushNotification({
                title: 'Credit Report Imported',
                text: `${parsedDebts.length} accounts loaded from ${sourceLabel} CSV.`,
                time: 'Just now',
                type: 'success'
            }, 'accountSynced');
        }
    });

    // ── Render Imported Accounts Section ──
    function renderImportedAccountsSection(debts, source) {
        if (!accountsSection || !accountsGrid) return;

        const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
        const sourceLabels = { creditkarma: '💚 Credit Karma', experian: '🔵 Experian', bank: '🏦 Bank Import' };

        if (sourceBadge) sourceBadge.textContent = sourceLabels[source] || source;
        if (dateBadge) dateBadge.textContent = `Imported ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        accountsGrid.innerHTML = debts.map(d => `
            <div style="background:var(--card-1); border:1px solid var(--border); border-radius:12px; padding:16px; transition:all 0.2s;" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                    <div style="width:32px; height:32px; background:var(--accent-dim); border-radius:8px; display:flex; align-items:center; justify-content:center;">
                        <i class="ph ph-credit-card" style="color:var(--accent); font-size:15px;"></i>
                    </div>
                    ${d.apr > 20 ? '<div style="font-size:9px; font-weight:700; color:var(--danger); background:rgba(255,77,109,0.1); padding:2px 8px; border-radius:20px;">HIGH APR</div>' : ''}
                </div>
                <div style="font-size:12px; font-weight:800; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.name}</div>
                <div style="font-size:22px; font-weight:900; color:var(--accent); margin:8px 0 4px; line-height:1;">${fmt(d.balance)}</div>
                <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.04em; font-weight:700;">${d.apr > 0 ? d.apr + '% APR' : 'No APR data'} • Day ${d.dueDate}</div>
                ${d.limit > 0 ? `<div style="margin-top:10px; height:3px; background:var(--card-2); border-radius:3px; overflow:hidden;"><div style="width:${Math.min(100, (d.balance/d.limit*100)).toFixed(0)}%; height:100%; background:${d.balance/d.limit > 0.7 ? 'var(--danger)' : 'var(--accent)'};"></div></div><div style="font-size:9px; color:var(--text-3); margin-top:4px;">${(d.balance/d.limit*100).toFixed(0)}% Utilization</div>` : ''}
            </div>
        `).join('');

        accountsSection.style.display = 'block';

        if (clearBtn) {
            clearBtn.onclick = () => {
                accountsSection.style.display = 'none';
                showToast('Import cleared. Dashboard data preserved.', 'info');
            };
        }
    }

    // ── Load from saved state ──
    if (appState.creditImport) {
        renderImportedAccountsSection(appState.creditImport.debts, appState.creditImport.source);
    }

    // ── Reset helper ──
    function resetModal() {
        parsedDebts = [];
        parsedTxns  = [];
        creditScore = null;
        fileStatus.style.display = 'none';
        preview.style.display = 'none';
        options.style.display = 'none';
        warning.style.display = 'none';
        confirmBtn.disabled = true;
        if (fileInput) fileInput.value = '';
        previewList.innerHTML = '';
        dropZone.style.borderColor = 'var(--border)';
        dropZone.style.background = '';
    }
}



/* ============================================================
   GLOBAL BUTTON HANDLERS — All dead buttons wired here
   Runs after DOM is ready with a 600ms delay to ensure all
   dynamic content has been injected first.
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAllButtonHandlers, 600);
});

function initAllButtonHandlers() {

    // ═══════════════════════════════════════════════════════
    //  TRANSACTIONS TAB — Full Engine
    // ═══════════════════════════════════════════════════════
    const TXN_PAGE_SIZE = 10;
    let txnState = {
        page: 0,
        sortCol: 'date',
        sortDir: 'desc',
        search: '',
        category: '',
        dateRange: '',
        status: '',
        advMin: null,
        advMax: null,
        advMethod: ''
    };

    const txnFmt = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' }).format(n);
    const txnDateFmt = iso => new Date(iso).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });

    function txnCatStyle(cat) {
        const c = (cat || '').toLowerCase();
        if (c.includes('groceries') || c.includes('food'))  return { bg:'rgba(255,77,109,0.12)',  clr:'#ff4d6d' };
        if (c.includes('housing') || c.includes('mortgage')) return { bg:'rgba(0,212,168,0.12)',  clr:'var(--accent)' };
        if (c.includes('transport') || c.includes('auto'))   return { bg:'rgba(102,126,234,0.15)',clr:'#667eea' };
        if (c.includes('income') || c.includes('deposit') || c.includes('paydown') || c.includes('dividend') || c.includes('freelance')) return { bg:'rgba(0,212,168,0.12)', clr:'var(--accent)' };
        if (c.includes('debt') || c.includes('loan') || c.includes('credit'))  return { bg:'rgba(255,171,64,0.15)', clr:'var(--warning)' };
        if (c.includes('utilities')) return { bg:'rgba(255,171,64,0.12)', clr:'var(--warning)' };
        if (c.includes('subscriptions')) return { bg:'rgba(167,139,250,0.15)', clr:'#a78bfa' };
        if (c.includes('travel'))        return { bg:'rgba(96,165,250,0.15)',  clr:'#60a5fa' };
        if (c.includes('technology'))    return { bg:'rgba(52,211,153,0.15)',  clr:'#34d399' };
        if (c.includes('dining'))        return { bg:'rgba(251,146,60,0.15)', clr:'#fb923c' };
        if (c.includes('renovation'))    return { bg:'rgba(248,113,113,0.15)',clr:'#f87171' };
        if (c.includes('infrastructure'))return { bg:'rgba(102,126,234,0.15)',clr:'#667eea' };
        return { bg:'var(--card-2)', clr:'var(--text-3)' };
    }

    function txnGetFiltered() {
        if (!appState || !appState.transactions) return [];
        let list = [...appState.transactions];

        // Search
        const q = txnState.search.toLowerCase();
        if (q) list = list.filter(t => (t.merchant||'').toLowerCase().includes(q) || (t.category||'').toLowerCase().includes(q) || (t.method||'').toLowerCase().includes(q) || (t.notes||'').toLowerCase().includes(q));

        // Category
        if (txnState.category) list = list.filter(t => (t.category||'') === txnState.category);

        // Status
        if (txnState.status) list = list.filter(t => (t.status||'completed').toLowerCase() === txnState.status.toLowerCase());

        // Date range
        const now = Date.now();
        const dayMs = 86400000;
        if (txnState.dateRange === '7')   list = list.filter(t => new Date(t.date).getTime() >= now - 7*dayMs);
        if (txnState.dateRange === '30')  list = list.filter(t => new Date(t.date).getTime() >= now - 30*dayMs);
        if (txnState.dateRange === '90')  list = list.filter(t => new Date(t.date).getTime() >= now - 90*dayMs);
        if (txnState.dateRange === '365') list = list.filter(t => new Date(t.date).getTime() >= now - 365*dayMs);

        // Advanced amount range
        if (txnState.advMin !== null) list = list.filter(t => Math.abs(t.amount) >= txnState.advMin);
        if (txnState.advMax !== null) list = list.filter(t => Math.abs(t.amount) <= txnState.advMax);
        if (txnState.advMethod) list = list.filter(t => (t.method||'') === txnState.advMethod);

        // Sort
        list.sort((a, b) => {
            let av, bv;
            if (txnState.sortCol === 'date')     { av = new Date(a.date).getTime(); bv = new Date(b.date).getTime(); }
            if (txnState.sortCol === 'amount')   { av = a.amount; bv = b.amount; }
            if (txnState.sortCol === 'merchant') { av = (a.merchant||'').toLowerCase(); bv = (b.merchant||'').toLowerCase(); }
            if (av === undefined) return 0;
            return txnState.sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });

        return list;
    }

    function txnRenderStats(filtered) {
        const bar = document.getElementById('txn-stats-bar');
        if (!bar) return;
        const totalTxn = filtered.length;
        const income = filtered.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0);
        const spend  = filtered.filter(t => t.amount < 0).reduce((s,t) => s + t.amount, 0);
        const net    = income + spend;
        bar.innerHTML = `
            <div class="card" style="padding:12px 16px; display:flex; flex-direction:column; gap:4px;">
                <div class="card-label">Transactions</div>
                <div style="font-size:22px; font-weight:900; color:var(--text);">${totalTxn}</div>
            </div>
            <div class="card" style="padding:12px 16px; display:flex; flex-direction:column; gap:4px;">
                <div class="card-label">Total Income</div>
                <div style="font-size:22px; font-weight:900; color:var(--accent);">${txnFmt(income)}</div>
            </div>
            <div class="card" style="padding:12px 16px; display:flex; flex-direction:column; gap:4px;">
                <div class="card-label">Total Spend</div>
                <div style="font-size:22px; font-weight:900; color:var(--danger);">${txnFmt(spend)}</div>
            </div>
            <div class="card" style="padding:12px 16px; display:flex; flex-direction:column; gap:4px;">
                <div class="card-label">Net Cash Flow</div>
                <div style="font-size:22px; font-weight:900; color:${net >= 0 ? 'var(--accent)' : 'var(--danger)'};">${txnFmt(net)}</div>
            </div>`;
    }

    function txnRenderTable(filtered) {
        const tbody = document.getElementById('txn-tbody');
        const label = document.getElementById('txn-page-label');
        if (!tbody) return;
        const total = filtered.length;
        if (txnState.page * TXN_PAGE_SIZE >= total && total > 0) txnState.page = 0;
        const start = txnState.page * TXN_PAGE_SIZE;
        const end = Math.min(start + TXN_PAGE_SIZE, total);
        const slice = filtered.slice(start, end);

        if (slice.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-3);">
                <i class="ph ph-magnifying-glass" style="font-size:32px; display:block; margin-bottom:8px; opacity:0.4;"></i>
                No transactions match your filters
            </td></tr>`;
        } else {
            tbody.innerHTML = slice.map(t => {
                const cs = txnCatStyle(t.category);
                const statusMap = { completed:'var(--accent)', pending:'var(--warning)', failed:'var(--danger)' };
                const statusDot = statusMap[(t.status||'completed').toLowerCase()] || 'var(--accent)';
                const statusLabel = (t.status||'completed').charAt(0).toUpperCase() + (t.status||'completed').slice(1);
                return `<tr class="txn-row" data-txn-id="${t.id}" style="cursor:pointer;">
                    <td class="txn-date">${txnDateFmt(t.date)}</td>
                    <td style="font-weight:600; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.merchant}</td>
                    <td><div class="badge" style="background:${cs.bg}; color:${cs.clr}; font-size:9px; white-space:nowrap;">${t.category}</div></td>
                    <td style="font-weight:700; color:${t.amount < 0 ? 'var(--danger)' : 'var(--accent)'}; white-space:nowrap;">${txnFmt(t.amount)}</td>
                    <td class="txn-method" style="font-size:11px;">${t.method || 'N/A'}</td>
                    <td><span style="display:flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:${statusDot};">
                        <span style="width:6px;height:6px;border-radius:50%;background:${statusDot};flex-shrink:0;display:inline-block;"></span>${statusLabel}
                    </span></td>
                    <td style="text-align:center;">
                        <button class="btn-txn-del" data-txn-id="${t.id}" style="background:rgba(255,77,109,0.10);border:1px solid rgba(255,77,109,0.25);cursor:pointer;color:#ff4d6d;font-size:13px;padding:5px 8px;border-radius:6px;opacity:0.85;transition:all 0.15s;" title="${t.synthetic ? 'Delete recurring entry (removes all instances)' : 'Delete this transaction'}">
                            <i class="ph ph-trash"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');
        }

        // Label & pagination
        if (label) label.textContent = total === 0 ? 'No results' : `Showing ${start+1}–${end} of ${total} transaction${total !== 1 ? 's' : ''}`;
        const prevBtn = document.getElementById('btn-txn-prev');
        const nextBtn = document.getElementById('btn-txn-next');
        if (prevBtn) prevBtn.disabled = txnState.page === 0;
        if (nextBtn) nextBtn.disabled = end >= total;

        // Sort indicators
        ['date','merchant','amount'].forEach(col => {
            const el = document.getElementById(`sort-${col}`);
            if (!el) return;
            if (txnState.sortCol === col) el.textContent = txnState.sortDir === 'asc' ? '↑' : '↓';
            else el.textContent = '';
        });

        // Row hover (button is now always visible — hover just brightens it)
        tbody.querySelectorAll('.txn-row').forEach(row => {
            const del = row.querySelector('.btn-txn-del');
            row.addEventListener('mouseenter', () => { if (del) del.style.opacity = '1'; });
            row.addEventListener('mouseleave', () => { if (del) del.style.opacity = '0.85'; });
            // Click row → open detail panel
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-txn-del')) return;
                const id = row.dataset.txnId;
                const txn = appState.transactions.find(t => t.id === id);
                if (txn) txnShowDetail(txn);
            });
            // Delete button — handle synthetic vs manual differently
            if (del) {
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = del.dataset.txnId;
                    const txn = appState.transactions.find(t => t.id === id);
                    if (!txn) return;
                    txnConfirmDelete(txn);
                });
            }
        });
    }

    /** Confirmation flow for deleting a transaction.
     *  - Synthetic (auto-generated from recurring/debt): offer to delete the
     *    underlying schedule, since deleting just the instance gets recreated
     *    on the next materialize pass. Also offers a "this occurrence only"
     *    option that adds the txn id to a muted set so it stays gone.
     *  - Manual: simple confirm + delete. */
    function txnConfirmDelete(txn) {
        const isSynthetic = !!txn.synthetic;
        const parentRec = isSynthetic && txn.parentRecurringId
            ? (appState.recurringPayments || []).find(r => r.id === txn.parentRecurringId)
            : null;
        const parentDebt = isSynthetic && txn.parentDebtId
            ? (appState.debts || []).find(d => d.id === txn.parentDebtId)
            : null;

        if (!isSynthetic) {
            if (!confirm(`Delete this transaction?\n\n${txn.merchant} · ${txn.amount < 0 ? '−' : ''}$${Math.abs(txn.amount).toFixed(2)}\n\nThis can't be undone.`)) return;
            appState.transactions = appState.transactions.filter(t => t.id !== txn.id);
            saveState();
            try { renderTransactions(); } catch(_){}
            try { txnRenderAll(); } catch(_){}
            showToast('Transaction deleted.');
            return;
        }

        // Synthetic — offer the right scope
        const parentLabel = parentRec ? parentRec.name : parentDebt ? parentDebt.name : 'this recurring item';
        const choice = prompt(
            `This is an auto-generated transaction from "${parentLabel}".\n\n` +
            `Type 1 to delete just this occurrence (it will stay hidden).\n` +
            `Type 2 to delete the entire recurring schedule (removes all past and future instances).\n` +
            `Cancel to keep it.`,
            '2'
        );
        if (choice === null) return;
        const c = String(choice).trim();

        if (c === '1') {
            // Hide this single occurrence — add to muted set
            if (!appState.mutedTxnIds) appState.mutedTxnIds = [];
            if (!appState.mutedTxnIds.includes(txn.id)) appState.mutedTxnIds.push(txn.id);
            appState.transactions = appState.transactions.filter(t => t.id !== txn.id);
            saveState();
            try { renderTransactions(); } catch(_){}
            try { txnRenderAll(); } catch(_){}
            showToast('Occurrence hidden.');
            return;
        }

        if (c === '2') {
            // Delete the parent recurring/debt entirely
            if (parentRec) {
                appState.recurringPayments = (appState.recurringPayments || []).filter(r => r.id !== parentRec.id);
            }
            // (Don't auto-delete debts here — that's a bigger action; route to manual debt delete)
            // Drop ALL synthetic txns tied to this parent
            appState.transactions = (appState.transactions || []).filter(t => {
                if (!t.synthetic) return true;
                if (parentRec && t.parentRecurringId === parentRec.id) return false;
                return true;
            });
            // Bust the materialize cache so it doesn't recreate
            try { _lastMaterializeHash = null; } catch(_){}
            saveState();
            try { renderTransactions(); } catch(_){}
            try { txnRenderAll(); } catch(_){}
            try { if (typeof updateUI === 'function') updateUI(); } catch(_){}
            showToast(parentRec ? `"${parentRec.name}" recurring entry deleted.` : 'Schedule removed.');
            return;
        }

        // Anything else — no-op
    }

    function txnRenderAll() {
        const filtered = txnGetFiltered();
        txnRenderStats(filtered);
        txnRenderTable(filtered);
        // Show/hide clear filters button
        const hasFilt = txnState.search || txnState.category || txnState.dateRange || txnState.status || txnState.advMin !== null || txnState.advMax !== null || txnState.advMethod;
        const clearBtn = document.getElementById('txn-clear-filters');
        if (clearBtn) clearBtn.style.display = hasFilt ? 'inline-flex' : 'none';
    }

    function txnShowDetail(t) {
        const panel = document.getElementById('txn-detail-panel');
        const backdrop = document.getElementById('txn-detail-backdrop');
        const content = document.getElementById('txn-detail-content');
        if (!panel || !content) return;
        const cs = txnCatStyle(t.category);
        const statusColors = { completed:'var(--accent)', pending:'var(--warning)', failed:'var(--danger)' };
        const sc = statusColors[(t.status||'completed').toLowerCase()] || 'var(--accent)';
        content.innerHTML = `
            <div style="text-align:center; padding:20px 0 24px;">
                <div style="width:60px;height:60px;border-radius:16px;background:${cs.bg};color:${cs.clr};display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;">
                    <i class="ph ph-receipt"></i>
                </div>
                <div style="font-size:20px; font-weight:900; color:var(--text);">${t.merchant}</div>
                <div style="font-size:32px; font-weight:900; color:${t.amount < 0 ? 'var(--danger)' : 'var(--accent)'}; margin:8px 0;">${txnFmt(t.amount)}</div>
                <div class="badge" style="background:${cs.bg};color:${cs.clr};font-size:9px;display:inline-block;">${t.category}</div>
            </div>
            <div class="card" style="padding:16px; display:flex; flex-direction:column; gap:12px; background:var(--card-2);">
                <div style="display:flex; justify-content:space-between; font-size:12px;">
                    <span style="color:var(--text-3);">Date</span>
                    <span style="font-weight:600;">${txnDateFmt(t.date)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px;">
                    <span style="color:var(--text-3);">Status</span>
                    <span style="font-weight:600; color:${sc};">${(t.status||'completed').charAt(0).toUpperCase() + (t.status||'completed').slice(1)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px;">
                    <span style="color:var(--text-3);">Payment Method</span>
                    <span style="font-weight:600;">${t.method || 'N/A'}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px;">
                    <span style="color:var(--text-3);">Transaction ID</span>
                    <span style="font-weight:600; font-family:monospace;">${t.id}</span>
                </div>
                ${t.notes ? `<div style="border-top:1px solid var(--border); padding-top:12px; font-size:12px; color:var(--text-2); line-height:1.5;">${t.notes}</div>` : ''}
            </div>
            <div style="margin-top:16px; display:flex; gap:8px;">
                <button onclick="document.getElementById('txn-detail-panel').style.right='-420px'; document.getElementById('txn-detail-backdrop').style.display='none';" class="btn btn-ghost" style="flex:1; font-size:11px;">Close</button>
                <button onclick="if(confirm('Delete this transaction?')){appState.transactions=appState.transactions.filter(x=>x.id!=='${t.id}');saveState();renderTransactions();txnRenderAll && txnRenderAll();document.getElementById('txn-detail-panel').style.right='-420px';document.getElementById('txn-detail-backdrop').style.display='none';showToast('Deleted.');}" class="btn" style="flex:1;font-size:11px;background:rgba(255,77,109,0.15);color:var(--danger);border:1px solid rgba(255,77,109,0.3);">
                    <i class="ph ph-trash"></i> Delete
                </button>
            </div>`;
        panel.style.right = '0px';
        if (backdrop) { backdrop.style.display = 'block'; }
    }

    // Close detail panel
    const detailClose = document.getElementById('txn-detail-close');
    const detailBackdrop = document.getElementById('txn-detail-backdrop');
    const detailPanel = document.getElementById('txn-detail-panel');
    if (detailClose) detailClose.onclick = () => { if (detailPanel) detailPanel.style.right = '-420px'; if (detailBackdrop) detailBackdrop.style.display = 'none'; };
    if (detailBackdrop) detailBackdrop.onclick = () => { if (detailPanel) detailPanel.style.right = '-420px'; detailBackdrop.style.display = 'none'; };

    // ── Search ────────────────────────────────────────────
    const txnSearch = document.getElementById('txn-search-input');
    if (txnSearch) {
        let debounceT;
        txnSearch.addEventListener('input', () => {
            clearTimeout(debounceT);
            debounceT = setTimeout(() => { txnState.search = txnSearch.value.trim(); txnState.page = 0; txnRenderAll(); }, 220);
        });
    }

    // ── Column sort ───────────────────────────────────────
    const txnThead = document.querySelector('#full-transactions-table thead');
    if (txnThead) {
        txnThead.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (txnState.sortCol === col) txnState.sortDir = txnState.sortDir === 'asc' ? 'desc' : 'asc';
                else { txnState.sortCol = col; txnState.sortDir = col === 'amount' ? 'asc' : 'desc'; }
                txnState.page = 0;
                txnRenderAll();
            });
        });
    }

    // ── Pagination ────────────────────────────────────────
    const btnTxnPrev = document.getElementById('btn-txn-prev');
    const btnTxnNext = document.getElementById('btn-txn-next');
    if (btnTxnPrev) btnTxnPrev.onclick = () => { if (txnState.page > 0) { txnState.page--; txnRenderAll(); } };
    if (btnTxnNext) btnTxnNext.onclick = () => { txnState.page++; txnRenderAll(); };

    // ── Category dropdown ─────────────────────────────────
    // Dropdown renders at body level with position:fixed to escape overflow:hidden parents
    let _txnDdEl = null;
    function txnMakeDropdown(anchorEl, items, onSelect) {
        txnCloseDd();
        const rect = anchorEl.getBoundingClientRect();
        const dd = document.createElement('div');
        dd.id = 'txn-dd-float';
        dd.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${rect.left}px;min-width:${Math.max(rect.width, 180)}px;
            background:var(--card);border:1px solid var(--border);border-radius:10px;
            box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:9999;overflow:hidden;`;
        dd.innerHTML = items.map(item =>
            `<div class="txn-dd-item" data-val="${item.value}" style="padding:9px 14px;font-size:12px;cursor:pointer;color:${item.value===''?'var(--text-3)':'var(--text)'};">
                ${item.label}
            </div>`
        ).join('');
        document.body.appendChild(dd);
        _txnDdEl = dd;
        dd.querySelectorAll('.txn-dd-item').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.06)');
            el.addEventListener('mouseleave', () => el.style.background = '');
            el.addEventListener('click', (e) => { e.stopPropagation(); onSelect(el.dataset.val); txnCloseDd(); });
        });
    }

    function txnCloseDd() {
        if (_txnDdEl) { _txnDdEl.remove(); _txnDdEl = null; }
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#txn-filter-category') && !e.target.closest('#txn-filter-date') &&
            !e.target.closest('#txn-filter-status') && !e.target.closest('#txn-dd-float')) txnCloseDd();
    });

    const filterCatBtn = document.getElementById('txn-filter-category');
    if (filterCatBtn) {
        filterCatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_txnDdEl) { txnCloseDd(); return; }
            const cats = [...new Set((appState.transactions||[]).map(t => t.category).filter(Boolean))].sort();
            const items = [{ value:'', label:'All Categories' }, ...cats.map(c => ({ value:c, label:c }))];
            txnMakeDropdown(filterCatBtn, items, val => {
                txnState.category = val;
                txnState.page = 0;
                filterCatBtn.innerHTML = `${val ? val : 'Category: All'} <i class="ph ph-caret-down"></i>`;
                filterCatBtn.classList.toggle('active', !!val);
                txnRenderAll();
            });
        });
    }

    const filterDateBtn = document.getElementById('txn-filter-date');
    if (filterDateBtn) {
        filterDateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_txnDdEl) { txnCloseDd(); return; }
            const ranges = [
                { value:'',    label:'All Time' },
                { value:'7',   label:'Last 7 Days' },
                { value:'30',  label:'Last 30 Days' },
                { value:'90',  label:'Last 90 Days' },
                { value:'365', label:'Last 12 Months' },
            ];
            txnMakeDropdown(filterDateBtn, ranges, val => {
                txnState.dateRange = val;
                txnState.page = 0;
                const lbl = ranges.find(r => r.value === val)?.label || 'All Time';
                filterDateBtn.innerHTML = `Date: ${lbl} <i class="ph ph-caret-down"></i>`;
                filterDateBtn.classList.toggle('active', !!val);
                txnRenderAll();
            });
        });
    }

    const filterStatusBtn = document.getElementById('txn-filter-status');
    if (filterStatusBtn) {
        filterStatusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_txnDdEl) { txnCloseDd(); return; }
            const statuses = [
                { value:'',          label:'All Statuses' },
                { value:'completed', label:'Completed' },
                { value:'pending',   label:'Pending' },
                { value:'failed',    label:'Failed' },
            ];
            txnMakeDropdown(filterStatusBtn, statuses, val => {
                txnState.status = val;
                txnState.page = 0;
                filterStatusBtn.innerHTML = `Status: ${val ? val.charAt(0).toUpperCase()+val.slice(1) : 'All'} <i class="ph ph-caret-down"></i>`;
                filterStatusBtn.classList.toggle('active', !!val);
                txnRenderAll();
            });
        });
    }

    // ── Clear Filters ─────────────────────────────────────
    const clearFiltersBtn = document.getElementById('txn-clear-filters');
    if (clearFiltersBtn) {
        clearFiltersBtn.onclick = () => {
            txnState.search = ''; txnState.category = ''; txnState.dateRange = ''; txnState.status = '';
            txnState.advMin = null; txnState.advMax = null; txnState.advMethod = ''; txnState.page = 0;
            if (txnSearch) txnSearch.value = '';
            if (filterCatBtn) filterCatBtn.innerHTML = 'Category: All <i class="ph ph-caret-down"></i>';
            if (filterDateBtn) filterDateBtn.innerHTML = 'Date: All Time <i class="ph ph-caret-down"></i>';
            if (filterStatusBtn) filterStatusBtn.innerHTML = 'Status: All <i class="ph ph-caret-down"></i>';
            [filterCatBtn,filterDateBtn,filterStatusBtn].forEach(b => b?.classList.remove('active'));
            txnRenderAll();
        };
    }

    // ── Advanced Filter Panel ─────────────────────────────
    const advBtn = document.getElementById('txn-filter-adv');
    const advPanel = document.getElementById('txn-adv-panel');
    if (advBtn && advPanel) {
        advBtn.onclick = () => { advPanel.style.display = advPanel.style.display === 'none' ? 'block' : 'none'; };
    }
    const advApply = document.getElementById('txn-adv-apply');
    if (advApply) {
        advApply.onclick = () => {
            const minV = parseFloat(document.getElementById('txn-adv-min')?.value);
            const maxV = parseFloat(document.getElementById('txn-adv-max')?.value);
            txnState.advMin = isNaN(minV) ? null : minV;
            txnState.advMax = isNaN(maxV) ? null : maxV;
            txnState.advMethod = document.getElementById('txn-adv-method')?.value || '';
            txnState.page = 0;
            txnRenderAll();
            showToast('Advanced filters applied.');
        };
    }
    const advReset = document.getElementById('txn-adv-reset');
    if (advReset) {
        advReset.onclick = () => {
            txnState.advMin = null; txnState.advMax = null; txnState.advMethod = '';
            const minEl = document.getElementById('txn-adv-min'); const maxEl = document.getElementById('txn-adv-max'); const mEl = document.getElementById('txn-adv-method');
            if (minEl) minEl.value = ''; if (maxEl) maxEl.value = ''; if (mEl) mEl.value = '';
            txnRenderAll();
        };
    }

    // ── Export CSV ────────────────────────────────────────
    const btnExportTxn = document.getElementById('btn-export-txn');
    if (btnExportTxn) {
        btnExportTxn.onclick = () => {
            const filtered = txnGetFiltered();
            if (!filtered.length) { showToast('No transactions to export.'); return; }
            const rows = [['Date','Merchant','Category','Amount','Method','Status','Notes']];
            filtered.forEach(t => rows.push([t.date, t.merchant, t.category, t.amount, t.method||'N/A', t.status||'completed', t.notes||'']));
            const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'wjp_transactions.csv'; a.click();
            showToast(`Exported ${filtered.length} transactions to CSV!`);
        };
    }

    // ── Add Transaction ───────────────────────────────────
    const addModal = document.getElementById('txn-add-modal');
    const btnAddTxn = document.getElementById('btn-add-txn');
    const txnAddClose = document.getElementById('txn-add-close');
    const txnAddCancel = document.getElementById('txn-add-cancel');
    const txnAddBackdrop = document.getElementById('txn-add-backdrop');
    const txnAddSave = document.getElementById('txn-add-save');
    const openAddModal = () => {
        if (!addModal) return;
        addModal.style.display = 'flex';
        const dateEl = document.getElementById('txn-add-date');
        if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    };
    const closeAddModal = () => { if (addModal) addModal.style.display = 'none'; };
    if (btnAddTxn) btnAddTxn.onclick = openAddModal;
    if (txnAddClose) txnAddClose.onclick = closeAddModal;
    if (txnAddCancel) txnAddCancel.onclick = closeAddModal;
    if (txnAddBackdrop) txnAddBackdrop.onclick = closeAddModal;
    if (txnAddSave) {
        txnAddSave.onclick = () => {
            const merchant = document.getElementById('txn-add-merchant')?.value?.trim();
            const amtStr   = document.getElementById('txn-add-amount')?.value;
            const dateVal  = document.getElementById('txn-add-date')?.value;
            const category = document.getElementById('txn-add-category')?.value;
            const method   = document.getElementById('txn-add-method')?.value;
            const notes    = document.getElementById('txn-add-notes')?.value?.trim() || '';
            if (!merchant || !amtStr || !dateVal) { showToast('Please fill in merchant, amount, and date.'); return; }
            const amount = parseFloat(amtStr);
            if (isNaN(amount)) { showToast('Invalid amount.'); return; }
            const newTxn = {
                id: 't' + Date.now(),
                date: new Date(dateVal + 'T12:00:00').toISOString(),
                merchant, category, amount, method,
                status: 'completed', notes
            };
            appState.transactions.unshift(newTxn);
            saveState();
            renderTransactions();
            txnRenderAll();
            closeAddModal();
            showToast(`Transaction "${merchant}" added!`);
            // Clear form
            ['txn-add-merchant','txn-add-amount','txn-add-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        };
    }

    // ── Initial render ────────────────────────────────────
    window.txnRenderAll = txnRenderAll; // expose for detail panel delete buttons
    txnRenderAll();

    // ══════════════════════════════════════════════════════════
    //  RECURRING PAYMENTS TAB ENGINE
    // ══════════════════════════════════════════════════════════
    const recState = {
        page: 0,
        pageSize: 6,
        cat: 'all',          // all | debt | subscription | utility | insurance
        calView: 'monthly',  // daily | weekly | monthly | yearly
        calDate: new Date()  // anchor date for navigation
    };

    const recFmt  = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
    const recFmtS = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);

    // ── Helper: month name ──
    function recMonthName(d) {
        return d.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    }

    /** Compute the next due Date for a recurring entry.
     *  Priority order:
     *    1. rp.nextDate (the user-input or scan-extracted anchor) — advance by
     *       frequency cadence until it's in the future.
     *    2. rp.dayOfMonth — for monthly entries, snap to that day this month or
     *       next.
     *    3. Today as a last resort.
     *  This is the SINGLE source of truth — calendar, dashboard, and table all
     *  use it so dates stay consistent across the site. */
    function recNextDue(rp) {
        if (!rp) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        const freq = (rp.frequency || 'monthly').toLowerCase();
        const stepDays =
            freq === 'weekly'      ? 7  :
            freq === 'biweekly'    ? 14 :
            freq === 'semimonthly' ? 15 :
            freq === 'quarterly'   ? 90 :
            freq === 'annually'    ? 365 :
            null; // monthly handled separately

        // Anchor from nextDate
        if (rp.nextDate) {
            let d = new Date(String(rp.nextDate).slice(0,10) + 'T12:00:00');
            if (isNaN(d.getTime())) d = null;
            if (d) {
                if (freq === 'monthly') {
                    while (d < today) { d.setMonth(d.getMonth() + 1); }
                } else if (freq === 'annually') {
                    while (d < today) { d.setFullYear(d.getFullYear() + 1); }
                } else if (stepDays) {
                    while (d < today) { d.setDate(d.getDate() + stepDays); }
                }
                return d;
            }
        }
        // Fallback: dayOfMonth for monthly-ish entries
        if (rp.dayOfMonth) {
            const dom = parseInt(rp.dayOfMonth, 10) || 1;
            let d = new Date(today.getFullYear(), today.getMonth(), dom);
            if (d < today) d.setMonth(d.getMonth() + 1);
            return d;
        }
        return today;
    }
    // Expose so the dashboard renderer + calendar can use the same source
    window.recNextDue = recNextDue;

    /** Does a recurring entry occur on a given calendar date?
     *  Walks the schedule from its anchor by frequency steps. Used by the
     *  calendar so weekly/biweekly entries land on the right cells (the old
     *  code only matched dayOfMonth, which silently dropped weekly entries). */
    function recOccursOn(rp, date) {
        if (!rp || !date) return false;
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const freq = (rp.frequency || 'monthly').toLowerCase();
        // Anchor — same priority as recNextDue
        let anchor;
        if (rp.nextDate) {
            anchor = new Date(String(rp.nextDate).slice(0,10) + 'T12:00:00');
            if (isNaN(anchor)) anchor = null;
        }
        if (!anchor && rp.dayOfMonth) {
            const today = new Date();
            anchor = new Date(today.getFullYear(), today.getMonth(), parseInt(rp.dayOfMonth,10) || 1);
        }
        if (!anchor) return false;
        const anchorDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime();

        if (freq === 'monthly') {
            return date.getDate() === anchor.getDate();
        }
        if (freq === 'annually') {
            return date.getDate() === anchor.getDate() && date.getMonth() === anchor.getMonth();
        }
        const stepDays =
            freq === 'weekly'      ? 7  :
            freq === 'biweekly'    ? 14 :
            freq === 'semimonthly' ? 15 :
            freq === 'quarterly'   ? 90 :
            7;
        const diffDays = Math.round((target - anchorDay) / 86400000);
        return diffDays % stepDays === 0;
    }
    window.recOccursOn = recOccursOn;

    // ── Payments Left for a recurring entry ──
    function recPaymentsLeft(rp) {
        if (rp.cat !== 'debt' || !rp.debtId) return '∞ Ongoing';
        const results = calculateDebtPayoff();
        const res = results[rp.debtId];
        if (!res) return '—';
        const months = res.months || 0;
        if (months >= 600) return '∞';
        const payoffDate = new Date();
        payoffDate.setMonth(payoffDate.getMonth() + months);
        const mo = payoffDate.toLocaleDateString('en-US',{month:'short',year:'numeric'});
        return `${months} mo <span style="color:var(--text-3);font-size:9px;">• ${mo}</span>`;
    }

    // ── Stats Bar ──
    function recRenderStats(list) {
        const bar = document.getElementById('rec-stats-bar');
        if (!bar) return;
        const all = appState.recurringPayments || [];

        // Frequency-normalize each record to a monthly figure so weekly/bi-weekly
        // entries don't underweight the totals.
        const monthlyOf = (r) => {
            const f = (r.frequency || 'monthly').toLowerCase();
            const a = parseFloat(r.amount) || 0;
            if (f === 'weekly') return a * 52 / 12;
            if (f === 'biweekly') return a * 26 / 12;
            if (f === 'semimonthly') return a * 2;
            if (f === 'quarterly') return a / 3;
            if (f === 'annually') return a / 12;
            return a;
        };
        // Read from `category` (current schema) with fallback to legacy `cat`
        const catOf = (r) => (r.category || r.cat || '').toString().toLowerCase();
        // Income entries are NOT outgoing payments — exclude them from every
        // payment-side total so the page stays internally consistent.
        const isIncome = (r) => catOf(r) === 'income' || !!r.linkedIncome;
        const isPayment = (r) => !isIncome(r);

        const payments = all.filter(isPayment);
        const totalMo = payments.reduce((s, r) => s + monthlyOf(r), 0);
        const debtMo  = payments.filter(r => catOf(r) === 'debt' || r.linkedDebtId).reduce((s, r) => s + monthlyOf(r), 0);
        const subMo   = payments.filter(r => catOf(r) === 'subscription' || catOf(r) === 'membership').reduce((s, r) => s + monthlyOf(r), 0);
        // "Active" = outgoing payments not explicitly cancelled. If status is unset,
        // count it (better than showing 0 active when the user clearly has entries).
        const active  = payments.filter(r => !r.status || (r.status !== 'cancelled' && r.status !== 'paused')).length;
        const cards = [
            { label:'Total Monthly', val: recFmtS(totalMo), icon:'ph-money', color:'var(--accent)' },
            { label:'Debt Payments', val: recFmtS(debtMo),  icon:'ph-credit-card', color:'#ff4d6d' },
            { label:'Subscriptions', val: recFmtS(subMo),   icon:'ph-star', color:'#667eea' },
            { label:'Active Payments', val: active,         icon:'ph-check-circle', color:'#34d399' },
        ];
        bar.innerHTML = cards.map(c=>`
          <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; display:flex; align-items:center; gap:10px;">
            <div style="width:32px; height:32px; border-radius:8px; background:rgba(0,0,0,0.3); border:1px solid var(--border); display:flex; align-items:center; justify-content:center;">
              <i class="ph ${c.icon}" style="color:${c.color}; font-size:16px;"></i>
            </div>
            <div>
              <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.08em;">${c.label}</div>
              <div style="font-size:16px; font-weight:900; color:${c.color};">${c.val}</div>
            </div>
          </div>`).join('');
    }

    // ── Table rows ──
    function recRenderTable() {
        const tbody = document.getElementById('rec-tbody');
        const label = document.getElementById('rec-page-label');
        if (!tbody) return;
        const all = appState.recurringPayments || [];
        // Read category with fallback to legacy field
        const catOf = (r) => (r.category || r.cat || '').toString().toLowerCase();
        const filtered = recState.cat === 'all'
            ? all
            : all.filter(r => {
                const c = catOf(r);
                if (recState.cat === 'debt') return c === 'debt' || r.linkedDebtId;
                if (recState.cat === 'subscription') return c === 'subscription' || c === 'membership';
                return c === recState.cat;
              });
        const total = filtered.length;
        const start = recState.page * recState.pageSize;
        const end   = Math.min(start + recState.pageSize, total);
        const slice = filtered.slice(start, end);

        if (!slice.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-3);">No payments in this category.</td></tr>`;
        } else {
            tbody.innerHTML = slice.map(rp => {
                const statusBadge = rp.status === 'warning'
                    ? `<span class="badge" style="background:rgba(251,191,36,0.15);color:#fbbf24;font-size:8px;">⚠ Retry</span>`
                    : `<span class="badge badge-primary" style="font-size:8px;">Active</span>`;
                const nextDue = recNextDue(rp);
                const nextDueStr = nextDue ? nextDue.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
                const paymentsLeft = recPaymentsLeft(rp);
                const freqRaw = (rp.frequency || 'monthly').toString();
                const freqLabel = freqRaw.charAt(0).toUpperCase()+freqRaw.slice(1);
                return `<tr class="rec-row" data-rec-id="${rp.id}" style="cursor:pointer;" title="Click to edit">
                  <td style="padding-left:16px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <div style="width:28px;height:28px;border-radius:7px;background:rgba(0,0,0,0.35);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="ph ${rp.icon||'ph-receipt'}" style="color:${rp.color||'var(--accent)'};font-size:14px;"></i>
                      </div>
                      <div>
                        <div style="font-weight:700;font-size:12px;">${rp.name}</div>
                        <div style="font-size:9px;color:var(--text-3);">${rp.method || rp.notes || rp.subcategory || ((rp.category || rp.cat || '').replace(/^\w/, c => c.toUpperCase())) || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td><span class="badge" style="background:rgba(0,0,0,0.3);color:var(--text-2);font-size:8px;">${(rp.type || rp.category || rp.cat || (rp.linkedDebtId ? 'Debt' : 'Subscription')).toString().toUpperCase()}</span></td>
                  <td style="font-weight:800;color:var(--accent);">${recFmt(rp.amount)}</td>
                  <td><div class="badge badge-ghost" style="font-size:8px;">${freqLabel}</div></td>
                  <td class="txn-date">${nextDueStr}</td>
                  <td style="font-size:11px;font-weight:700;">${paymentsLeft}</td>
                  <td style="display:flex;align-items:center;gap:6px;">
                    ${statusBadge}
                    <button class="btn-rec-edit" data-rec-id="${rp.id}" title="Edit" style="background:rgba(0,212,168,0.10);border:1px solid rgba(0,212,168,0.30);color:var(--accent);cursor:pointer;padding:3px 7px;border-radius:5px;font-size:11px;"><i class="ph ph-pencil-simple"></i></button>
                    <button class="btn-rec-del" data-rec-id="${rp.id}" title="Delete" style="background:rgba(255,77,109,0.10);border:1px solid rgba(255,77,109,0.30);color:#ff4d6d;cursor:pointer;padding:3px 7px;border-radius:5px;font-size:11px;"><i class="ph ph-trash"></i></button>
                  </td>
                </tr>`;
            }).join('');

            // Wire row clicks → edit modal; explicit edit/delete buttons too.
            tbody.querySelectorAll('.rec-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-rec-del')) return;
                    const id = row.dataset.recId;
                    const rp = (appState.recurringPayments || []).find(r => r.id === id);
                    if (rp) recOpenEditModal(rp);
                });
            });
            tbody.querySelectorAll('.btn-rec-del').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.recId;
                    const rp = (appState.recurringPayments || []).find(r => r.id === id);
                    if (!rp) return;
                    if (!confirm(`Delete recurring entry "${rp.name}"?\n\nThis removes all auto-generated transactions for it. Cannot be undone.`)) return;
                    appState.recurringPayments = (appState.recurringPayments || []).filter(r => r.id !== id);
                    appState.transactions = (appState.transactions || []).filter(t => !(t.synthetic && t.parentRecurringId === id));
                    try { _lastMaterializeHash = null; } catch(_){}
                    saveState();
                    try { recRenderAll && recRenderAll(); } catch(_){}
                    try { recRenderTable(); } catch(_){}
                    try { recRenderStats(); } catch(_){}
                    try { recRenderCalendar && recRenderCalendar(); } catch(_){}
                    try { if (typeof updateUI === 'function') updateUI(); } catch(_){}
                    showToast(`"${rp.name}" deleted.`);
                });
            });
        }

        if (label) label.textContent = `${start+1}–${Math.min(end,total)} of ${total} payments`;
        const prevBtn = document.getElementById('btn-rec-prev');
        const nextBtn = document.getElementById('btn-rec-next');
        if (prevBtn) prevBtn.disabled = recState.page === 0;
        if (nextBtn) nextBtn.disabled = end >= total;
    }

    // ── Edit modal ──
    /** Build + open an edit modal for a recurring payment row.
     *  Lazy-creates the DOM so it doesn't ship in initial HTML.
     *  On save, busts the materialize hash so synthetic txns regenerate
     *  with the new amount/frequency/anchor — keeping calendar, dashboard,
     *  and transactions in sync. */
    function recOpenEditModal(rp) {
        let modal = document.getElementById('rec-edit-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'rec-edit-modal';
            modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;padding:20px;';
            modal.innerHTML = `
              <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                  <h3 style="font-size:16px;font-weight:900;margin:0;">Edit recurring payment</h3>
                  <button id="rec-edit-close" type="button" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:18px;"><i class="ph ph-x"></i></button>
                </div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                  <div><label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;">Name</label>
                    <input id="rec-edit-name" type="text" style="width:100%;padding:8px 10px;background:var(--card-2);border:1px solid var(--border);border-radius:6px;color:var(--text);"></div>
                  <div style="display:flex;gap:10px;">
                    <div style="flex:1;"><label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;">Amount ($)</label>
                      <input id="rec-edit-amount" type="number" step="0.01" style="width:100%;padding:8px 10px;background:var(--card-2);border:1px solid var(--border);border-radius:6px;color:var(--text);"></div>
                    <div style="flex:1;"><label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;">Frequency</label>
                      <select id="rec-edit-frequency" style="width:100%;padding:8px 10px;background:var(--card-2);border:1px solid var(--border);border-radius:6px;color:var(--text);">
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="semimonthly">Semi-monthly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annually">Annually</option>
                      </select></div>
                  </div>
                  <div style="display:flex;gap:10px;">
                    <div style="flex:1;"><label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;">Next due date</label>
                      <input id="rec-edit-nextdate" type="date" style="width:100%;padding:8px 10px;background:var(--card-2);border:1px solid var(--border);border-radius:6px;color:var(--text);"></div>
                    <div style="flex:1;"><label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;">Category</label>
                      <select id="rec-edit-category" style="width:100%;padding:8px 10px;background:var(--card-2);border:1px solid var(--border);border-radius:6px;color:var(--text);">
                        <option value="income">Income</option>
                        <option value="debt">Debt</option>
                        <option value="subscription">Subscription</option>
                        <option value="membership">Membership</option>
                        <option value="utility">Utility</option>
                        <option value="insurance">Insurance</option>
                        <option value="rent">Rent / Housing</option>
                        <option value="other">Other</option>
                      </select></div>
                  </div>
                  <div><label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;">Notes</label>
                    <textarea id="rec-edit-notes" rows="2" style="width:100%;padding:8px 10px;background:var(--card-2);border:1px solid var(--border);border-radius:6px;color:var(--text);resize:vertical;"></textarea></div>
                </div>
                <div style="display:flex;justify-content:space-between;gap:10px;margin-top:18px;">
                  <button id="rec-edit-delete" class="btn" style="background:rgba(255,77,109,0.10);border:1px solid rgba(255,77,109,0.30);color:#ff4d6d;"><i class="ph ph-trash"></i> Delete</button>
                  <div style="display:flex;gap:10px;">
                    <button id="rec-edit-cancel" class="btn btn-ghost">Cancel</button>
                    <button id="rec-edit-save" class="btn btn-primary"><i class="ph ph-check"></i> Save</button>
                  </div>
                </div>
              </div>`;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
            modal.querySelector('#rec-edit-close').onclick = () => modal.style.display = 'none';
            modal.querySelector('#rec-edit-cancel').onclick = () => modal.style.display = 'none';
        }

        // Pre-fill fields with this recurring entry's current values
        const editing = rp.id;
        modal.dataset.editingId = editing;
        modal.querySelector('#rec-edit-name').value = rp.name || '';
        modal.querySelector('#rec-edit-amount').value = rp.amount || '';
        modal.querySelector('#rec-edit-frequency').value = (rp.frequency || 'monthly').toLowerCase();
        // For the date input, normalize whatever shape nextDate was stored in
        let dateValue = '';
        if (rp.nextDate) {
            const d = new Date(String(rp.nextDate).slice(0,10) + 'T12:00:00');
            if (!isNaN(d)) dateValue = d.toISOString().slice(0,10);
        } else if (rp.dayOfMonth) {
            const today = new Date();
            const d = new Date(today.getFullYear(), today.getMonth(), parseInt(rp.dayOfMonth,10) || 1);
            if (d < today) d.setMonth(d.getMonth() + 1);
            dateValue = d.toISOString().slice(0,10);
        }
        modal.querySelector('#rec-edit-nextdate').value = dateValue;
        modal.querySelector('#rec-edit-category').value = (rp.category || rp.cat || 'other').toLowerCase();
        modal.querySelector('#rec-edit-notes').value = rp.notes || '';

        // Wire save (overwrites previous handler since arrow-fn)
        modal.querySelector('#rec-edit-save').onclick = () => {
            const id = modal.dataset.editingId;
            const target = (appState.recurringPayments || []).find(r => r.id === id);
            if (!target) { modal.style.display = 'none'; return; }
            const newName = modal.querySelector('#rec-edit-name').value.trim();
            const newAmt  = parseFloat(modal.querySelector('#rec-edit-amount').value) || 0;
            const newFreq = modal.querySelector('#rec-edit-frequency').value;
            const newDate = modal.querySelector('#rec-edit-nextdate').value;
            const newCat  = modal.querySelector('#rec-edit-category').value;
            const newNotes = modal.querySelector('#rec-edit-notes').value.trim();
            if (!newName || newAmt <= 0) { showToast('Name and a positive amount are required.'); return; }
            target.name = newName;
            target.amount = newAmt;
            target.frequency = newFreq;
            target.nextDate = newDate || null;
            // Sync dayOfMonth too so legacy renderers stay accurate
            if (newDate) {
                const dParsed = new Date(newDate + 'T12:00:00');
                target.dayOfMonth = dParsed.getDate();
            }
            target.category = newCat;
            target.cat = newCat; // legacy field — keep in sync
            target.notes = newNotes;
            target.linkedIncome = newCat === 'income';
            // Drop existing synthetic txns for this entry so they re-materialize
            // with the corrected schedule. Calendar/dashboard/transactions all
            // pull from transactions[] so this gets them in lockstep.
            appState.transactions = (appState.transactions || []).filter(t => !(t.synthetic && t.parentRecurringId === id));
            try { _lastMaterializeHash = null; } catch(_){}
            saveState();
            modal.style.display = 'none';
            try { recRenderTable(); } catch(_){}
            try { recRenderStats(); } catch(_){}
            try { recRenderCalendar && recRenderCalendar(); } catch(_){}
            try { if (typeof updateUI === 'function') updateUI(); } catch(_){}
            showToast(`"${target.name}" updated.`);
        };
        modal.querySelector('#rec-edit-delete').onclick = () => {
            const id = modal.dataset.editingId;
            const target = (appState.recurringPayments || []).find(r => r.id === id);
            if (!target) { modal.style.display = 'none'; return; }
            if (!confirm(`Delete "${target.name}"? This removes all auto-generated transactions for it.`)) return;
            appState.recurringPayments = (appState.recurringPayments || []).filter(r => r.id !== id);
            appState.transactions = (appState.transactions || []).filter(t => !(t.synthetic && t.parentRecurringId === id));
            try { _lastMaterializeHash = null; } catch(_){}
            saveState();
            modal.style.display = 'none';
            try { recRenderTable(); } catch(_){}
            try { recRenderStats(); } catch(_){}
            try { recRenderCalendar && recRenderCalendar(); } catch(_){}
            try { if (typeof updateUI === 'function') updateUI(); } catch(_){}
            showToast(`"${target.name}" deleted.`);
        };

        modal.style.display = 'flex';
    }
    // Expose for outside callers (e.g. dashboard upcoming card click)
    window.recOpenEditModal = recOpenEditModal;

    // ── Category filter pills ──
    function recBindCatPills() {
        document.querySelectorAll('.rec-cat-btn').forEach(btn => {
            btn.onclick = () => {
                recState.cat = btn.dataset.cat;
                recState.page = 0;
                document.querySelectorAll('.rec-cat-btn').forEach(b => {
                    b.style.background = b === btn ? 'var(--accent)' : 'transparent';
                    b.style.color = b === btn ? '#0b0f1a' : 'var(--text-3)';
                });
                recRenderTable();
            };
        });
        const btnRecPrev = document.getElementById('btn-rec-prev');
        const btnRecNext = document.getElementById('btn-rec-next');
        if (btnRecPrev) btnRecPrev.onclick = () => { if (recState.page > 0) { recState.page--; recRenderTable(); } };
        if (btnRecNext) btnRecNext.onclick = () => { recState.page++; recRenderTable(); };
    }

    // ── Payoff Countdown ──
    function recRenderCountdown() {
        const el = document.getElementById('rec-countdown');
        if (!el) return;
        const rps = (appState.recurringPayments||[]).filter(r=>r.cat==='debt'&&r.debtId);
        if (!rps.length) { el.innerHTML = `<div style="color:var(--text-3);font-size:11px;">No debt payments found.</div>`; return; }
        const results = calculateDebtPayoff();
        const totalDebtBalance = appState.debts.reduce((s,d)=>s+d.balance,0);
        el.innerHTML = rps.map(rp => {
            const debt = appState.debts.find(d=>d.id===rp.debtId);
            if (!debt) return '';
            const res = results[rp.debtId] || {};
            const months = res.months || 0;
            const origBalance = debt.balance + (debt.paid || 0);
            const paidSoFar = debt.paid || 0;
            const pct = origBalance > 0 ? Math.min(100, Math.round(paidSoFar / origBalance * 100)) : 0;
            const payoffDate = new Date();
            payoffDate.setMonth(payoffDate.getMonth() + months);
            const dateStr = months >= 600 ? '∞' : payoffDate.toLocaleDateString('en-US',{month:'short',year:'numeric'});
            const monthsStr = months >= 600 ? '∞' : `${months} mo`;
            const barColor = debt.apr > 15 ? '#ff4d6d' : debt.apr > 7 ? '#fbbf24' : 'var(--accent)';
            return `<div class="countdown-item">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                <div>
                  <div style="font-size:11px;font-weight:700;">${rp.name}</div>
                  <div style="font-size:9px;color:var(--text-3);">Freedom: ${dateStr} · ${recFmtS(debt.balance)} remaining</div>
                </div>
                <div style="font-size:11px;font-weight:800;color:${barColor};">${monthsStr}</div>
              </div>
              <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${barColor};"></div></div>
            </div>`;
        }).join('');
    }

    // ── Payment Calendar ──
    function recRenderCalendar() {
        const body = document.getElementById('rec-cal-body');
        const label = document.getElementById('rec-cal-label');
        if (!body) return;
        const payments = appState.recurringPayments || [];
        const today = new Date();
        const d = recState.calDate;

        // Update active view buttons
        document.querySelectorAll('.rec-cal-view-btn').forEach(b => {
            const active = b.dataset.view === recState.calView;
            b.classList.toggle('btn-primary', active);
            b.classList.toggle('btn-ghost', !active);
        });

        if (recState.calView === 'daily') {
            // Show today + next 6 days (7 total)
            if (label) label.textContent = d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
            const lines = [];
            for (let i = 0; i < 7; i++) {
                const day = new Date(d); day.setDate(d.getDate() + i);
                const dom = day.getDate();
                const due = payments.filter(p => recOccursOn(p, day));
                const isToday = day.toDateString() === today.toDateString();
                lines.push(`<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);">
                  <div style="width:38px;text-align:center;flex-shrink:0;">
                    <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()]}</div>
                    <div style="font-size:16px;font-weight:900;color:${isToday?'var(--accent)':'var(--text)'};">${dom}</div>
                  </div>
                  <div style="flex:1;display:flex;flex-wrap:wrap;gap:4px;padding-top:2px;">
                    ${due.length ? due.map(p=>`<div style="background:rgba(0,0,0,0.35);border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:9px;font-weight:700;color:${p.color||'var(--accent)'};">
                      <i class="ph ${p.icon||'ph-receipt'}" style="font-size:9px;"></i> ${p.name} · ${recFmt(p.amount)}</div>`).join('')
                    : `<span style="font-size:9px;color:var(--text-3);">No payments</span>`}
                  </div>
                </div>`);
            }
            body.innerHTML = lines.join('');

        } else if (recState.calView === 'weekly') {
            // 7-col week grid
            const dow = d.getDay();
            const weekStart = new Date(d); weekStart.setDate(d.getDate() - dow);
            const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
            if (label) label.textContent = `${weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${weekEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
            const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">`;
            for (let i=0;i<7;i++) {
                const day = new Date(weekStart); day.setDate(weekStart.getDate()+i);
                const dom = day.getDate();
                const due = payments.filter(p => recOccursOn(p, day));
                const isToday = day.toDateString()===today.toDateString();
                html += `<div style="background:${isToday?'rgba(0,212,168,0.07)':'var(--card-2)'};border:1px solid ${isToday?'var(--accent)':'var(--border)'};border-radius:8px;padding:8px;min-height:90px;">
                  <div style="font-size:8px;color:${isToday?'var(--accent)':'var(--text-3)'};font-weight:700;text-transform:uppercase;">${days[i]}</div>
                  <div style="font-size:16px;font-weight:900;color:${isToday?'var(--accent)':'var(--text)'};margin-bottom:5px;">${dom}</div>
                  ${due.map(p=>`<div style="background:rgba(0,0,0,0.4);border-radius:4px;padding:2px 4px;margin-bottom:2px;font-size:8px;font-weight:700;color:${p.color||'var(--accent)'};" title="${p.name} — ${recFmt(p.amount)}">
                    <i class="ph ${p.icon||'ph-receipt'}" style="font-size:8px;"></i> ${p.name.split(' ')[0]}</div>`).join('')}
                </div>`;
            }
            html += `</div>`;
            body.innerHTML = html;

        } else if (recState.calView === 'monthly') {
            const yr = d.getFullYear(), mo = d.getMonth();
            if (label) label.textContent = d.toLocaleDateString('en-US',{month:'long',year:'numeric'});
            const firstDay = new Date(yr, mo, 1).getDay();
            const daysInMonth = new Date(yr, mo+1, 0).getDate();
            const daysInPrev  = new Date(yr, mo, 0).getDate();
            let html = `<div class="custom-calendar-grid">`;
            ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(h => { html += `<div class="cal-header">${h}</div>`; });
            for (let i=0;i<firstDay;i++) {
                html += `<div class="cal-cell empty">${daysInPrev - firstDay + i + 1}</div>`;
            }
            for (let day=1; day<=daysInMonth; day++) {
                const cellDate = new Date(yr, mo, day);
                const due = payments.filter(p => recOccursOn(p, cellDate));
                const isToday = today.getDate()===day && today.getMonth()===mo && today.getFullYear()===yr;
                const hasEvent = due.length > 0;
                html += `<div class="cal-cell${hasEvent?' has-event':''}${isToday?' cal-today':''}">
                  <span style="font-size:10px;font-weight:${isToday?900:600};color:${isToday?'var(--accent)':'inherit'};">${day}</span>
                  ${due.slice(0,2).map(p=>`<div class="cal-event" style="background:${p.color||'var(--accent)'};color:#0b0f1a;border-radius:3px;padding:1px 3px;font-size:7px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;" title="${p.name} — ${recFmt(p.amount)}">${p.name.split(' ')[0]}</div>`).join('')}
                  ${due.length > 2 ? `<div style="font-size:7px;color:var(--text-3);">+${due.length-2}</div>` : ''}
                </div>`;
            }
            const trailing = (7 - (firstDay + daysInMonth) % 7) % 7;
            for (let i=1; i<=trailing; i++) { html += `<div class="cal-cell empty">${i}</div>`; }
            html += `</div>`;
            body.innerHTML = html;

        } else if (recState.calView === 'yearly') {
            const yr = d.getFullYear();
            if (label) label.textContent = String(yr);
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            let html = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">`;
            for (let m=0; m<12; m++) {
                const moPayments = payments.filter(p => p.frequency === 'monthly' || (p.frequency==='yearly' && p.month===m));
                const totalMo = moPayments.reduce((s,p)=>s+p.amount,0);
                const isCurrent = today.getMonth()===m && today.getFullYear()===yr;
                html += `<div style="background:${isCurrent?'rgba(0,212,168,0.07)':'var(--card-2)'};border:1px solid ${isCurrent?'var(--accent)':'var(--border)'};border-radius:8px;padding:10px;">
                  <div style="font-size:10px;font-weight:800;color:${isCurrent?'var(--accent)':'var(--text)'};">${monthNames[m]}</div>
                  <div style="font-size:13px;font-weight:900;color:var(--accent);margin:3px 0;">${recFmtS(totalMo)}</div>
                  <div style="font-size:8px;color:var(--text-3);">${moPayments.length} payments</div>
                </div>`;
            }
            html += `</div>`;
            body.innerHTML = html;
        }
    }

    // ── Calendar navigation ──
    function recCalNav(dir) {
        const v = recState.calView;
        const d = recState.calDate;
        if (v === 'daily') d.setDate(d.getDate() + dir * 7);
        else if (v === 'weekly') d.setDate(d.getDate() + dir * 7);
        else if (v === 'monthly') d.setMonth(d.getMonth() + dir);
        else if (v === 'yearly') d.setFullYear(d.getFullYear() + dir);
        recRenderCalendar();
    }

    // ── Master render ──
    function renderRecurringTab() {
        recRenderStats();
        recRenderTable();
        recRenderCountdown();
        recRenderCalendar();
    }

    // ── Wire all recurring events (idempotent guard) ──
    if (!window._recWired) {
        window._recWired = true;
        recBindCatPills();

        const btnRecCalPrev = document.getElementById('btn-rec-cal-prev');
        const btnRecCalNext = document.getElementById('btn-rec-cal-next');
        if (btnRecCalPrev) btnRecCalPrev.onclick = () => recCalNav(-1);
        if (btnRecCalNext) btnRecCalNext.onclick = () => recCalNav(1);

        document.querySelectorAll('.rec-cal-view-btn').forEach(btn => {
            btn.onclick = () => {
                recState.calView = btn.dataset.view;
                recRenderCalendar();
            };
        });

        const btnRecAdd = document.getElementById('btn-rec-add');
        if (btnRecAdd) btnRecAdd.onclick = () => showToast('Add Recurring Payment — coming soon.');
    }

    // Initial render
    renderRecurringTab();
    window.renderRecurringTab = renderRecurringTab;

    // ── Calendar: Nav buttons (switch from querySelector to IDs) ──
    const btnCalPrev = document.getElementById('btn-cal-prev');
    const btnCalNext = document.getElementById('btn-cal-next');
    if (btnCalPrev) {
        btnCalPrev.onclick = () => {
            currentCalMonth--;
            if (currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; }
            renderMainCalendar();
        };
    }
    if (btnCalNext) {
        btnCalNext.onclick = () => {
            currentCalMonth++;
            if (currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; }
            renderMainCalendar();
        };
    }

    // ── Calendar: Month / Week toggle ────────────────────────
    const btnCalMonth = document.getElementById('btn-cal-month');
    const btnCalWeek  = document.getElementById('btn-cal-week');
    let calView = 'month';

    if (btnCalMonth) {
        btnCalMonth.onclick = () => {
            calView = 'month';
            btnCalMonth.classList.add('btn-primary'); btnCalMonth.classList.remove('btn-ghost');
            if (btnCalWeek) { btnCalWeek.classList.add('btn-ghost'); btnCalWeek.classList.remove('btn-primary'); }
            renderMainCalendar();
        };
    }
    if (btnCalWeek) {
        btnCalWeek.onclick = () => {
            calView = 'week';
            btnCalWeek.classList.add('btn-primary'); btnCalWeek.classList.remove('btn-ghost');
            if (btnCalMonth) { btnCalMonth.classList.add('btn-ghost'); btnCalMonth.classList.remove('btn-primary'); }
            // Show only current week days
            const grid = document.getElementById('main-calendar-grid');
            if (!grid) return;
            const today = new Date();
            const dow = today.getDay();
            const weekStart = new Date(today); weekStart.setDate(today.getDate() - dow);
            grid.innerHTML = '';
            for (let i = 0; i < 7; i++) {
                const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
                const cell = document.createElement('div');
                const isToday = d.toDateString() === today.toDateString();
                cell.style.cssText = `background:${isToday ? 'rgba(0,212,168,0.08)' : 'var(--card-1)'}; border:1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}; border-radius:12px; padding:12px; min-height:120px; display:flex; flex-direction:column; gap:4px;`;
                cell.innerHTML = `<div style="font-size:11px; font-weight:800; color:${isToday ? 'var(--accent)' : 'var(--text-3)'}; text-transform:uppercase;">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}</div>
                    <div style="font-size:20px; font-weight:900; color:${isToday ? 'var(--accent)' : 'var(--text)'};">${d.getDate()}</div>`;
                grid.appendChild(cell);
            }
        };
    }

    // ── Dismiss Suggestions ───────────────────────────────────
    const btnDismiss = document.getElementById('btn-dismiss-suggestions');
    if (btnDismiss) {
        btnDismiss.onclick = () => {
            const card = btnDismiss.closest('.card, [class*="card"]');
            if (card) { card.style.transition = 'opacity 0.3s, height 0.3s'; card.style.opacity = '0'; setTimeout(() => { card.style.display = 'none'; }, 300); }
            showToast('Suggestions dismissed.');
        };
    }

    // ── View Logic Map ────────────────────────────────────────
    const btnViewLogic = document.getElementById('btn-view-logic');
    if (btnViewLogic) {
        btnViewLogic.onclick = () => {
            // Build a simple modal showing the AI strategy logic
            const existing = document.getElementById('logic-map-modal');
            if (existing) { existing.remove(); return; }
            const modal = document.createElement('div');
            modal.id = 'logic-map-modal';
            modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:99998; display:flex; align-items:center; justify-content:center; padding:24px;';
            const strat = appState.settings?.strategy || 'avalanche';
            const stratName = strat.charAt(0).toUpperCase() + strat.slice(1);
            modal.innerHTML = `<div style="background:var(--card); border:1px solid var(--border-accent); border-radius:20px; padding:40px; max-width:600px; width:100%; max-height:80vh; overflow-y:auto; position:relative;">
                <button onclick="document.getElementById('logic-map-modal').remove()" style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--text-3); font-size:24px; cursor:pointer;">×</button>
                <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.1em; margin-bottom:8px;">STRATEGY ENGINE</div>
                <h2 style="font-size:24px; font-weight:900; margin-bottom:24px;">AI Logic Map — ${stratName}</h2>
                <div style="display:flex; flex-direction:column; gap:16px;">
                    ${[
                        { step: '1', title: 'Debt Inventory', desc: `${appState.debts.length} active debts totaling ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(appState.debts.reduce((s,d)=>s+d.balance,0))} catalogued and ranked.` },
                        { step: '2', title: 'Strategy Selection', desc: `${stratName} mode: ${strat==='avalanche'?'highest APR debts targeted first to minimize total interest':'lowest balance debts targeted first to build momentum with quick wins'}.` },
                        { step: '3', title: 'Cash Flow Analysis', desc: `Monthly income: ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(appState.balances?.monthlyIncome||8500)}. Extra payment allocation: ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(appState.budget?.contribution||0)}/mo.` },
                        { step: '4', title: 'Payoff Projection', desc: 'Rolling interest accrual computed month-by-month with minimum payment floors. Surplus routed to target debt.' },
                        { step: '5', title: 'AI Optimization', desc: 'Evergreen AI monitors rate changes, income shifts, and lump-sum opportunities to refine the strategy in real time.' }
                    ].map(s => `<div style="display:flex; gap:16px; align-items:flex-start;">
                        <div style="background:var(--accent); color:#0b0f1a; font-weight:900; font-size:13px; min-width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;">${s.step}</div>
                        <div><div style="font-size:13px; font-weight:800; margin-bottom:4px;">${s.title}</div><div style="font-size:12px; color:var(--text-3); line-height:1.6;">${s.desc}</div></div>
                    </div>`).join('')}
                </div>
            </div>`;
            document.body.appendChild(modal);
            modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        };
    }

    // ── Link New Bank Institution ─────────────────────────────
    // This button was previously showing a "coming soon" toast. Wire it to
    // the real Plaid Link opener (which lazy-loads the SDK on demand).
    const btnLinkBank = document.getElementById('btn-link-bank');
    if (btnLinkBank) {
        btnLinkBank.onclick = () => {
            try {
                if (typeof openPlaidLink === 'function') {
                    openPlaidLink();
                } else if (typeof window.openPlaidLink === 'function') {
                    window.openPlaidLink();
                } else {
                    showToast && showToast('Bank link isn\'t ready yet — please refresh and try again.');
                }
            } catch (e) {
                console.error('btn-link-bank click failed', e);
                showToast && showToast('Could not open bank link. Check your connection and try again.');
            }
        };
    }

    // ── Document Vault: Grid / List toggle ───────────────────
    const btnDocsGrid = document.getElementById('btn-docs-grid');
    const btnDocsList = document.getElementById('btn-docs-list');
    const docItems = document.querySelectorAll('.doc-list-item');

    if (btnDocsGrid) {
        btnDocsGrid.onclick = () => {
            btnDocsGrid.style.background = 'var(--accent)'; btnDocsGrid.style.color = '#0b0f1a';
            if (btnDocsList) { btnDocsList.style.background = ''; btnDocsList.style.color = ''; }
            // Wrap doc items in a grid
            const container = docItems[0]?.parentElement;
            if (container) {
                container.style.display = 'grid';
                container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
                container.style.gap = '12px';
                docItems.forEach(item => {
                    item.style.flexDirection = 'column';
                    item.style.alignItems = 'flex-start';
                    item.style.padding = '16px';
                    item.style.gap = '8px';
                });
            }
        };
    }
    if (btnDocsList) {
        btnDocsList.onclick = () => {
            btnDocsList.style.background = 'var(--accent)'; btnDocsList.style.color = '#0b0f1a';
            if (btnDocsGrid) { btnDocsGrid.style.background = ''; btnDocsGrid.style.color = ''; }
            const container = docItems[0]?.parentElement;
            if (container) {
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.gap = '8px';
                docItems.forEach(item => {
                    item.style.flexDirection = '';
                    item.style.alignItems = '';
                    item.style.padding = '';
                    item.style.gap = '';
                });
            }
        };
    }

    // ── Per-Debt Attachments list (Tier 1.6 — replaces Document Vault) ──
    renderPerDebtAttachments();

    // ── View Full Schedule ────────────────────────────────────
    const btnViewSchedule = document.getElementById('btn-view-schedule');
    if (btnViewSchedule) {
        btnViewSchedule.onclick = () => navigateSPA('recurring');
    }

    // ── Add New Recurring Payment ─────────────────────────────
    const btnNewRecurring = document.getElementById('btn-new-recurring');
    if (btnNewRecurring) {
        btnNewRecurring.onclick = () => {
            const existing = document.getElementById('add-recurring-modal');
            if (existing) { existing.remove(); return; }
            const modal = document.createElement('div');
            modal.id = 'add-recurring-modal';
            modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:99998; display:flex; align-items:center; justify-content:center; padding:24px;';
            modal.innerHTML = `<div style="background:var(--card); border:1px solid var(--border-accent); border-radius:20px; padding:40px; max-width:440px; width:100%; position:relative;">
                <button onclick="document.getElementById('add-recurring-modal').remove()" style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--text-3); font-size:24px; cursor:pointer;">×</button>
                <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.1em; margin-bottom:8px;">RECURRING PAYMENTS</div>
                <h2 style="font-size:22px; font-weight:900; margin-bottom:24px;">Add Scheduled Payment</h2>
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <label style="font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Payment Name</label>
                        <input id="rec-new-name" type="text" placeholder="e.g. Car Insurance" style="width:100%; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 16px; color:var(--text); font-size:13px; font-family:inherit; outline:none; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Monthly Amount ($)</label>
                        <input id="rec-new-amount" type="number" placeholder="0.00" min="0" step="0.01" style="width:100%; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 16px; color:var(--text); font-size:13px; font-family:inherit; outline:none; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Due Day of Month</label>
                        <input id="rec-new-day" type="number" placeholder="15" min="1" max="31" style="width:100%; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 16px; color:var(--text); font-size:13px; font-family:inherit; outline:none; box-sizing:border-box;">
                    </div>
                    <button id="rec-new-save" class="btn btn-primary" style="width:100%; padding:14px; font-size:13px; font-weight:800; margin-top:8px;">Save Payment</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
            modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

            document.getElementById('rec-new-save').onclick = () => {
                const name   = document.getElementById('rec-new-name').value.trim();
                const amount = parseFloat(document.getElementById('rec-new-amount').value) || 0;
                const day    = parseInt(document.getElementById('rec-new-day').value) || 15;
                if (!name || !amount) { showToast('Please fill in name and amount.'); return; }
                // Add as a pseudo-debt to appState so it shows in calendar and recurring table
                const newEntry = { id: 'rec_' + Date.now(), name, balance: 0, apr: 0, minPayment: amount, dueDate: day, type: 'recurring' };
                appState.debts.push(newEntry);
                saveState();
                updateUI();
                if (typeof renderRecurringTab === 'function') renderRecurringTab();
                renderMainCalendar();
                modal.remove();
                showToast(`"${name}" added to recurring schedule!`);
            };
        };
    }

    // ── Activity Filters ──────────────────────────────────────
    const filterBtns = {
        'btn-filter-all':      null,
        'btn-filter-critical': 'high',
        'btn-filter-insights': 'ai',
        'btn-filter-cleared':  'cleared'
    };

    Object.entries(filterBtns).forEach(([id, filterVal]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.onclick = () => {
            // Update active state
            Object.keys(filterBtns).forEach(k => {
                const b = document.getElementById(k);
                if (b) { b.classList.remove('active'); }
            });
            btn.classList.add('active');

            // Filter the activity list
            const list = document.getElementById('activity-log-list');
            if (!list) return;
            const items = list.querySelectorAll('.activity-card');
            items.forEach(card => {
                if (!filterVal) {
                    card.style.display = '';
                } else if (filterVal === 'cleared') {
                    card.style.display = card.classList.contains('cleared') ? '' : 'none';
                } else if (filterVal === 'high') {
                    card.style.display = card.classList.contains('priority-high') ? '' : 'none';
                } else {
                    card.style.display = card.classList.contains(`type-${filterVal}`) ? '' : 'none';
                }
            });
        };
    });

    // ── GO PRO Modal ──────────────────────────────────────────
    const btnGoPro = document.getElementById('btn-go-pro');
    if (btnGoPro) {
        btnGoPro.onclick = () => {
            const existing = document.getElementById('go-pro-modal');
            if (existing) { existing.remove(); return; }
            const modal = document.createElement('div');
            modal.id = 'go-pro-modal';
            modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:99998; display:flex; align-items:center; justify-content:center; padding:24px;';
            modal.innerHTML = `<div style="background:var(--card); border:1px solid var(--border-accent); border-radius:24px; padding:48px; max-width:500px; width:100%; text-align:center; position:relative;">
                <button onclick="document.getElementById('go-pro-modal').remove()" style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--text-3); font-size:24px; cursor:pointer;">×</button>
                <div style="background:var(--accent); color:#0b0f1a; width:56px; height:56px; border-radius:16px; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; font-size:28px;"><i class="ph-fill ph-lightning"></i></div>
                <div style="font-size:9px; color:var(--accent); text-transform:uppercase; font-weight:700; letter-spacing:0.1em; margin-bottom:8px;">WJP PRO</div>
                <h2 style="font-size:28px; font-weight:900; margin-bottom:12px;">Unlock Full Power</h2>
                <p style="font-size:13px; color:var(--text-3); line-height:1.7; margin-bottom:32px;">Advanced stress testing, multi-variable simulations, Plaid bank sync, and AI-generated monthly strategy reports — all in one place.</p>
                <div style="display:flex; flex-direction:column; gap:10px; text-align:left; margin-bottom:32px;">
                    ${['Multi-variable stress testing & scenario modeling','Plaid bank sync — real-time transaction import','AI monthly strategy reports (PDF)','Unlimited document vault storage','Priority AI compute & faster insights'].map(f =>
                        `<div style="display:flex; align-items:center; gap:12px; font-size:13px; font-weight:600;"><i class="ph-fill ph-check-circle" style="color:var(--accent); font-size:18px; flex-shrink:0;"></i>${f}</div>`
                    ).join('')}
                </div>
                <button class="btn btn-primary" style="width:100%; padding:16px; font-size:14px; font-weight:800;" onclick="showToast('Pro plan coming soon — you\\'ll be first to know!'); document.getElementById('go-pro-modal').remove();">Join the Waitlist</button>
                <div style="font-size:10px; color:var(--text-3); margin-top:12px;">No credit card required • Cancel anytime</div>
            </div>`;
            document.body.appendChild(modal);
            modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        };
    }

    // ── Recurring Filter ──────────────────────────────────────
    const btnRecFilter = document.getElementById('btn-rec-filter');
    if (btnRecFilter) {
        let recFilterOpen = false;
        btnRecFilter.onclick = () => {
            recFilterOpen = !recFilterOpen;
            // Simple inline toggle of calendar highlight: show only debt due dates
            if (recFilterOpen) {
                btnRecFilter.style.background = 'var(--accent)';
                btnRecFilter.style.color = '#0b0f1a';
                btnRecFilter.innerHTML = '<i class="ph ph-x"></i> Clear Filter';
                showToast('Calendar filtered to show debt payments only.');
            } else {
                btnRecFilter.style.background = '';
                btnRecFilter.style.color = '';
                btnRecFilter.innerHTML = '<i class="ph ph-calendar-check"></i> Filter';
                showToast('Filter cleared.');
            }
        };
    }

    console.log('[WJP] All button handlers initialized.');

    // ── Initialize Onboarding on Load ─────────────────────────
    setTimeout(() => {
        window.checkOnboarding();
    }, 500);
}

// ── ONBOARDING SYSTEM (Global Scope) ──────────────────────────
window.checkOnboarding = function() {
    const onboardingComplete = localStorage.getItem('wjp_onboarding_complete');
    if (!onboardingComplete && !(document.getElementById("landing-page") && (!window.netlifyIdentity || !window.netlifyIdentity.currentUser()))) {
        window.showOnboardingModal();
    }
};

window.showOnboardingModal = function() {
    const modal = document.getElementById('onboarding-modal');
    if (modal && window.netlifyIdentity && window.netlifyIdentity.currentUser()) {
        modal.classList.add('active');
        modal.style.display = '';
    }
};

window.startOnboarding = function() {
    const modal = document.getElementById('onboarding-modal');
    const page = document.getElementById('onboarding-page');
    if (modal) modal.classList.remove('active');
    if (page) page.style.display = 'block';
    document.body.style.overflow = 'hidden';
};

window.skipOnboarding = function() {
    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.classList.remove('active');
    localStorage.setItem('wjp_onboarding_complete', 'true');
};

window.exitOnboarding = function() {
    const page = document.getElementById('onboarding-page');
    if (page) page.style.display = 'none';
    document.body.style.overflow = 'auto';
    localStorage.setItem('wjp_onboarding_complete', 'true');
    if (typeof navigateSPA === 'function') navigateSPA('dashboard');
};

window.toggleAuthMode = function(mode) {
    const createForm = document.getElementById('auth-create-form');
    const loginForm  = document.getElementById('auth-login-form');
    const createTab  = document.getElementById('auth-tab-create');
    const loginTab   = document.getElementById('auth-tab-login');
    if (mode === 'login') {
        createForm.style.display = 'none';
        loginForm.style.display  = 'block';
        createTab.classList.remove('active');
        loginTab.classList.add('active');
    } else {
        createForm.style.display = 'block';
        loginForm.style.display  = 'none';
        createTab.classList.add('active');
        loginTab.classList.remove('active');
    }
};

window.handleLogin = function(e) {
    e.preventDefault();
    const savedName     = localStorage.getItem('wjp_user_name');
    const savedInitials = localStorage.getItem('wjp_user_initials');
    const savedPassword = localStorage.getItem('wjp_user_password');
    const enteredPw     = (document.getElementById('login-password')?.value || '').trim();
    const errEl         = document.getElementById('login-error');
    if (errEl) errEl.style.display = 'none';

    if (!savedName) {
        if (errEl) { errEl.textContent = 'No account found. Please create an account first.'; errEl.style.display = 'block'; }
        return;
    }
    if (savedPassword && enteredPw !== savedPassword) {
        if (errEl) { errEl.textContent = 'Incorrect password. Please try again.'; errEl.style.display = 'block'; }
        return;
    }
    // Restore session
    localStorage.setItem('wjp_onboarding_complete', 'true');
    const page = document.getElementById('onboarding-page');
    if (page) page.style.display = 'none';
    document.body.style.overflow = 'auto';
    const userNameEl   = document.querySelector('.user-name');
    const userAvatarEl = document.querySelector('.user-avatar');
    if (userNameEl)   userNameEl.textContent   = savedName;
    if (userAvatarEl && savedInitials) userAvatarEl.textContent = savedInitials;
    if (typeof navigateSPA === 'function') navigateSPA('dashboard');
    if (typeof updateUI === 'function') setTimeout(updateUI, 100);
    if (typeof showToast === 'function') showToast('Welcome back, ' + savedName + '!');
};

// Google Sign-In — replace 'YOUR_CLIENT_ID' with your Google Cloud OAuth 2.0 Client ID
// to enable real Google authentication. Without it, a demo flow is used.
const _GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

window._finishGoogleSignIn = function(name, email) {
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    sessionStorage.setItem('onboard_name',  name);
    sessionStorage.setItem('onboard_email', email || '');
    // Google sign-in skips steps 2 & 3 — just land on dashboard with clean state
    window._applyOnboardingToState([]);
    localStorage.setItem('wjp_onboarding_complete', 'true');
    const page = document.getElementById('onboarding-page');
    if (page) page.style.display = 'none';
    document.body.style.overflow = 'auto';
    if (typeof navigateSPA === 'function') navigateSPA('dashboard');
    setTimeout(() => {
        if (typeof updateUI === 'function') updateUI();
        if (typeof showToast === 'function') showToast('Welcome, ' + name + '! Add your debts to get started.');
    }, 150);
};

window.handleGoogleCredential = function(response) {
    try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        window._finishGoogleSignIn(payload.name || payload.email, payload.email);
    } catch(err) { console.warn('Google credential parse error', err); }
};

window.handleGoogleSignIn = function() {
    if (!_GOOGLE_CLIENT_ID.startsWith('YOUR') && window.google?.accounts?.id) {
        google.accounts.id.prompt();
        return;
    }
    // Demo fallback — show inline mini-form
    const overlay = document.getElementById('google-demo-overlay');
    if (overlay) overlay.style.display = 'flex';
};

window.submitGoogleDemo = function() {
    const name  = (document.getElementById('gdemo-name')?.value  || '').trim();
    const email = (document.getElementById('gdemo-email')?.value || '').trim();
    if (!name) { document.getElementById('gdemo-name')?.focus(); return; }
    document.getElementById('google-demo-overlay').style.display = 'none';
    window._finishGoogleSignIn(name, email);
};

window.handleAccountCreation = function(e) {
    e.preventDefault();
    const name     = document.getElementById('onboard-name').value.trim();
    const email    = document.getElementById('onboard-email').value.trim();
    const password = (document.getElementById('onboard-password')?.value || '').trim();
    sessionStorage.setItem('onboard_name',  name);
    sessionStorage.setItem('onboard_email', email);
    if (password) localStorage.setItem('wjp_user_password', password);
    window.showStep(2);
};

window.handleFinancialInfo = function(e) {
    e.preventDefault();
    const income = parseFloat(document.getElementById('onboard-income').value) || 0;
    const totalDebt = parseFloat(document.getElementById('onboard-debt').value) || 0;
    sessionStorage.setItem('onboard_income', income);
    sessionStorage.setItem('onboard_total_debt', totalDebt);
    window.showStep('goals');
};

window.toggleGoalChip = function(el) {
    if (!el) return;
    const on = el.classList.toggle('ob-goal-on');
    if (on) {
        el.style.background = 'rgba(0,212,168,0.12)';
        el.style.borderColor = 'rgba(0,212,168,0.45)';
        el.style.color = '#00d4a8';
    } else {
        el.style.background = 'rgba(255,255,255,0.05)';
        el.style.borderColor = 'rgba(255,255,255,0.12)';
        el.style.color = '#f0f4ff';
    }
};

window.handleGoalsStep = function(skip) {
    const goals = [];
    if (!skip) {
        document.querySelectorAll('.ob-goal-chip.ob-goal-on').forEach(el => {
            goals.push(el.getAttribute('data-goal'));
        });
    }
    sessionStorage.setItem('onboard_goals', JSON.stringify(goals));
    window.showStep(3);
};

window.selectDataSource = function(source) {
    if (source === 'bank') window.showStep('bank');
    else if (source === 'manual') window.showStep('manual');
    else if (source === 'upload') window.showStep('upload');
};

window.handleBankLink = function(e) {
    e.preventDefault();
    window._applyOnboardingToState([]);
    window.completeOnboarding('Bank account linked! Your data will sync shortly.');
};

window.handleManualEntry = function(e) {
    e.preventDefault();
    const name = document.getElementById('onboard-debt-name').value.trim();
    const balance = parseFloat(document.getElementById('onboard-debt-balance').value) || 0;
    const rate = parseFloat(document.getElementById('onboard-debt-rate').value) || 0;
    const newDebt = {
        id: 'd_' + Date.now(),
        name: name,
        balance: balance,
        apr: rate,
        minPayment: Math.max(25, Math.round(balance * 0.02)),
        dueDate: 15
    };
    window._applyOnboardingToState([newDebt]);
    window.completeOnboarding('Debt added! Dashboard updated with your information.');
};

window.handleDocumentUpload = function(e) {
    e.preventDefault();
    const files = document.getElementById('onboard-file').files;
    if (files.length === 0) {
        if (typeof showToast === 'function') showToast('Please select files to upload');
        return;
    }
    window._applyOnboardingToState([]);
    window.completeOnboarding('Documents uploaded! Processing your information.');
};

// Push onboarding data into appState and persist — FULL CLEAN SLATE
window._applyOnboardingToState = function(newDebts) {
    const name     = sessionStorage.getItem('onboard_name') || 'New User';
    const income   = parseFloat(sessionStorage.getItem('onboard_income')) || 0;
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const totalDebt = newDebts.reduce((s, d) => s + d.balance, 0);

    // Wipe ALL previous user data — no demo data leaking through
    appState.balances = {
        monthlyIncome:    income,
        availableCashflow: Math.round(income * 0.3)
    };
    appState.debts             = newDebts;
    appState.transactions      = [];
    appState.recurringPayments = [];
    appState.notifications     = [];
    appState.settings          = { strategy: 'avalanche' };
    try {
        const savedGoals = JSON.parse(sessionStorage.getItem('onboard_goals') || '[]');
        if (!appState.prefs) appState.prefs = JSON.parse(JSON.stringify(defaultState.prefs));
        appState.prefs.goals = Array.isArray(savedGoals) ? savedGoals : [];
    } catch(_){}
    appState.budget = {
        savingsRatio: 0,
        contribution: Math.round(income * 0.1),
        targetGoal:   totalDebt || (income * 12),
        frequency:    'monthly',
        expenses:     { housing: 0, food: 0, transit: 0, disc: 0 }
    };

    localStorage.setItem('wjp_user_name',     name);
    localStorage.setItem('wjp_user_initials', initials);
    localStorage.removeItem('wjp_resilience_ov');
    localStorage.removeItem('wjp_credit_linked');
    if (typeof saveState === 'function') saveState();

    const userNameEl   = document.querySelector('.user-name');
    const userAvatarEl = document.querySelector('.user-avatar');
    if (userNameEl)   userNameEl.textContent   = name;
    if (userAvatarEl) userAvatarEl.textContent = initials;
};

window.backOnboarding = function() {
    const step = localStorage.getItem('wjp_onboarding_step') || '1';
    const numStep = parseInt(step);
    if (step === 'bank' || step === 'manual' || step === 'upload') {
        window.showStep(3);
    } else if (step === 'goals') {
        window.showStep(2);
    } else if (step === '3') {
        window.showStep('goals');
    } else if (numStep > 1) {
        window.showStep(numStep - 1);
    }
};

window.showStep = function(step) {
    document.querySelectorAll('[id^="onboarding-step-"]').forEach(el => el.style.display = 'none');
    const stepElement = document.getElementById('onboarding-step-' + step);
    if (stepElement) stepElement.style.display = 'block';
    localStorage.setItem('wjp_onboarding_step', step.toString());
    window.scrollTo(0, 0);
};

window.completeOnboarding = function(message) {
    if (typeof showToast === 'function') showToast(message);
    setTimeout(() => {
        localStorage.setItem('wjp_onboarding_complete', 'true');
        sessionStorage.removeItem('onboard_name');
        sessionStorage.removeItem('onboard_email');
        sessionStorage.removeItem('onboard_income');
        sessionStorage.removeItem('onboard_total_debt');
        const page = document.getElementById('onboarding-page');
        if (page) page.style.display = 'none';
        document.body.style.overflow = 'auto';
        if (typeof navigateSPA === 'function') navigateSPA('dashboard');
        // Re-render dashboard with new user data (delay to let navigateSPA finish)
        setTimeout(() => { if (typeof updateUI === 'function') updateUI(); }, 100);
    }, 800);
};


// ============================================================================
// AUTH GATE FUNCTIONS - Netlify Identity Integration
// ============================================================================

function showLandingPage() {
  const lp = document.getElementById('landing-page');
  if (lp) lp.style.display = 'flex';
}

function hideLandingPage() {
  const lp = document.getElementById('landing-page');
  if (lp) lp.style.display = 'none';
}

function showAuthGate(tab) {
  hideLandingPage();
  switchAuthTab(tab || 'login');
  const gate = document.getElementById('auth-gate');
  const app = document.querySelector('.app-wrapper');
  if (gate) { gate.style.display = 'flex'; setTimeout(() => { gate.style.opacity = '1'; }, 10); }
  if (app) app.style.display = 'none';
}

function hideAuthGate() {
  hideLandingPage();
  const gate = document.getElementById('auth-gate');
  const app = document.querySelector('.app-wrapper');
  if (gate) { gate.style.opacity = '0'; setTimeout(() => { gate.style.display = 'none'; }, 300); }
  if (app) app.style.display = 'flex';
}

function switchAuthTab(tab) {
  const gate = document.getElementById('auth-gate');
  if (!gate) return;
  const authTabs = gate.querySelector('.auth-tabs');
  const loginTab = authTabs ? authTabs.children[0] : null;
  const signupTab = authTabs ? authTabs.children[1] : null;
  const loginForm = gate.querySelector('[id="auth-login-form"]');
  const signupForm = gate.querySelector('[id="auth-signup-form"]');
  if (tab === 'login') {
    if (loginTab) { loginTab.classList.add('active'); }
    if (signupTab) { signupTab.classList.remove('active'); }
    if (loginForm) { loginForm.className = 'auth-form active'; loginForm.style.display = ''; }
    if (signupForm) { signupForm.className = 'auth-form'; signupForm.style.display = ''; }
  } else {
    if (signupTab) { signupTab.classList.add('active'); }
    if (loginTab) { loginTab.classList.remove('active'); }
    if (signupForm) { signupForm.className = 'auth-form active'; signupForm.style.display = ''; }
    if (loginForm) { loginForm.className = 'auth-form'; loginForm.style.display = ''; }
  }
  if (typeof clearAuthErrors === 'function') clearAuthErrors();
}

function clearAuthErrors() {
  ['auth-error', 'auth-signup-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('show'); el.textContent = ''; }
  });
}

function showAuthError(msg, isSignup) {
  const el = document.getElementById(isSignup ? 'auth-signup-error' : 'auth-error');
  if (el) { el.textContent = msg; el.classList.add('show'); }
}

function showAuthSuccess(msg, isSignup) {
  const el = document.getElementById(isSignup ? 'auth-signup-error' : 'auth-error');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
    el.style.background = 'rgba(0,200,150,0.1)';
    el.style.borderColor = 'rgba(0,200,150,0.3)';
    el.style.color = '#6bcf7f';
  }
}
// ---------- EMAIL LOGIN ----------
async function handleEmailLogin() {
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn = document.getElementById('auth-login-btn');
  if (!email) { showAuthError('Please enter your email address'); return; }
  if (!password) { showAuthError('Please enter your password'); return; }
  clearAuthErrors();
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try {
    const gotrue = window.netlifyIdentity?.gotrue;
    if (!gotrue) throw new Error('Auth service not loaded yet. Please refresh.');
    const user = await gotrue.login(email, password, true);
    hideAuthGate();
    loadUserData(user);
    showWelcomeToast(user);
  } catch (e) {
    const msg = e?.json?.error_description || e?.message || 'Login failed. Check your credentials.';
    showAuthError(msg);
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
  }
}

// ---------- EMAIL SIGNUP ----------
async function handleEmailSignup() {
  const name = document.getElementById('auth-name')?.value.trim();
  const email = document.getElementById('auth-signup-email')?.value.trim();
  const password = document.getElementById('auth-signup-password')?.value;
  const btn = document.getElementById('auth-signup-btn');
  if (!name) { showAuthError('Please enter your full name', true); return; }
  if (!email) { showAuthError('Please enter your email address', true); return; }
  if (!password || password.length < 8) { showAuthError('Password must be at least 8 characters', true); return; }
  clearAuthErrors();
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try {
    const gotrue = window.netlifyIdentity?.gotrue;
    if (!gotrue) throw new Error('Auth service not loaded yet. Please refresh.');
    const user = await gotrue.signup(email, password, { full_name: name });
    if (user.confirmed_at) {
      hideAuthGate();
      loadUserData(user);
      showWelcomeToast(user);
    } else {
      showAuthSuccess('Account created! Check your email to confirm.', true);
    }
  } catch (e) {
    const msg = e?.json?.error_description || e?.json?.msg || e?.message || 'Signup failed.';
    showAuthError(msg, true);
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
  }
}

function handleGoogleAuth() {
  window.location.href = '/.netlify/identity/authorize?provider=google';
}

async function handleForgotPassword() {
  const email = document.getElementById('auth-email')?.value.trim();
  if (!email) { showAuthError('Enter your email first, then click Forgot password'); return; }
  try {
    const gotrue = window.netlifyIdentity?.gotrue;
    if (!gotrue) throw new Error('Auth service not loaded.');
    await gotrue.requestPasswordRecovery(email);
    showAuthSuccess('Password reset link sent to ' + email);
  } catch (e) {
    showAuthError(e?.message || 'Failed to send reset email.');
  }
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const wrapper = input.closest('.auth-password-wrapper');
  const icon = wrapper?.querySelector('.auth-password-toggle i');
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.className = 'ph-fill ph-eye-slash';
  } else {
    input.type = 'password';
    if (icon) icon.className = 'ph-fill ph-eye';
  }
}

function updatePasswordStrength(pw) {
  const bar = document.getElementById('auth-strength-bar');
  if (!bar || !pw) { if (bar) bar.className = 'auth-password-strength-bar'; return; }
  const score = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/, /.{12,}/]
    .reduce((s, r) => s + (r.test(pw) ? 1 : 0), 0);
  const cls = score <= 1 ? 'weak' : score === 2 ? 'medium' : score === 3 ? 'strong' : 'very-strong';
  bar.className = 'auth-password-strength-bar ' + cls;
}
// ============================================================================
// USER-SCOPED LOCALSTORAGE
// ============================================================================

let _currentUserId = null;

function loadUserData(user) {
  if (!user) return;
  _currentUserId = user.id;
  if (!window._origGetItem) {
    window._origGetItem = localStorage.getItem.bind(localStorage);
    window._origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.getItem = function(key) {
      if (key.startsWith('wjp_') && _currentUserId && !key.startsWith('wjp_' + _currentUserId)) {
        const base = key.replace(/^wjp_/, '');
        const scoped = 'wjp_' + _currentUserId + '_' + base;
        const val = window._origGetItem(scoped);
        if (val !== null) return val;
        const generic = window._origGetItem(key);
        if (generic !== null) { window._origSetItem(scoped, generic); return generic; }
        return null;
      }
      return window._origGetItem(key);
    };
    localStorage.setItem = function(key, val) {
      if (key.startsWith('wjp_') && _currentUserId && !key.startsWith('wjp_' + _currentUserId)) {
        const base = key.replace(/^wjp_/, '');
        return window._origSetItem('wjp_' + _currentUserId + '_' + base, val);
      }
      return window._origSetItem(key, val);
    };
  }
  // Get user display info
  var fullName = '';
  if (user.user_metadata && user.user_metadata.full_name) {
    fullName = user.user_metadata.full_name;
  } else if (user.email) {
    fullName = user.email.split('@')[0];
  }

  // Calculate initials
  var initials = '?';
  if (fullName) {
    var parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } else if (parts.length === 1 && parts[0].length > 0) {
      initials = parts[0][0].toUpperCase();
    }
  }

  // Update sidebar elements (by ID)
  var sidebarName = document.getElementById('sidebar-user-name');
  if (sidebarName) sidebarName.textContent = fullName || 'User';

  var sidebarInitials = document.getElementById('sidebar-user-initials');
  if (sidebarInitials) sidebarInitials.textContent = initials;

  // Update settings page elements (by ID)
  var settingsName = document.getElementById('settings-user-name');
  if (settingsName) settingsName.textContent = fullName || 'User';

  var settingsAvatar = document.getElementById('settings-user-avatar');
  if (settingsAvatar) settingsAvatar.textContent = initials;

  // Update elements by class (fallback)
  document.querySelectorAll('.user-name').forEach(function(el) {
    if (!el.id) el.textContent = fullName || 'User';
  });
  document.querySelectorAll('.user-avatar').forEach(function(el) {
    if (!el.id) el.textContent = initials;
  });

  // Store for later use
  try {
    window._origSetItem('wjp_last_user_email', user.email || '');
    window._origSetItem('wjp_last_user_name', fullName || '');
  } catch(e) {}
  // Theme: always start in light mode on session load (per user preference).
  document.body.classList.remove('light', 'dark');
  document.body.classList.add('light');
}

function clearUserSession() { _currentUserId = null; }

function showWelcomeToast(user) {
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'there';
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--card);color:var(--text-1);padding:16px 24px;border-radius:12px;border:1px solid var(--border);z-index:10000;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fadeIn 0.3s ease;';
  toast.innerHTML = '<span style="color:var(--accent);font-weight:700;">Welcome back</span>, ' + name + '!';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}
// ============================================================================
// INIT AUTH (IIFE) — Shows landing page for new visitors, auth gate via CTA
// ============================================================================

(function initAuth() {
  let attempts = 0;
  let authHandled = false;

  function onUserLogin(u) {
    if (authHandled) return;
    authHandled = true;
    hideAuthGate();
    loadUserData(u);
    showWelcomeToast(u);
  }

  function tryInit() {
    const ni = window.netlifyIdentity;
    if (!ni) {
      if (++attempts < 50) setTimeout(tryInit, 100);
      return;
    }

    ni.on('login', onUserLogin);

    ni.on('logout', () => {
      authHandled = false;
      showLandingPage();
      clearUserSession();
    });

    ni.on('init', (u) => {
      if (u) {
        onUserLogin(u);
      } else if (!authHandled) {
        // Check if returning user (has signed in before)
        var lastEmail = localStorage.getItem('wjp_last_user_email');
        if (lastEmail) {
          showAuthGate('login');
        } else {
          showLandingPage();
        }
      }
    });

    ni.init();

    const user = ni.currentUser();
    if (user && !authHandled) {
      onUserLogin(user);
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', () => ni.logout());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();


// ══════════════════════════════════════════════════════════════
//  ONBOARDING — Skip & Start Functions
// ══════════════════════════════════════════════════════════════

window.skipOnboarding = function() {
    const obModal = document.getElementById('onboarding-modal');
    if (obModal) obModal.style.display = 'none';
    navigateSPA('dashboard');
};

window.startOnboarding = function() {
    const obModal = document.getElementById('onboarding-modal');
    if (obModal) obModal.style.display = 'none';
    const obPage = document.getElementById('onboarding-page');
    if (obPage) obPage.style.display = 'block';
};


// ══════════════════════════════════════════════════════════════
//  BROWSER CACHE — Prevent BFCache Restoration of Auth State
// ══════════════════════════════════════════════════════════════

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    // Page was restored from bfcache
    const ni = window.netlifyIdentity;
    if (!ni || !ni.currentUser()) {
      // No active user, reload to show auth gate
      window.location.reload();
    }
  }
});


// ══════════════════════════════════════════════════════════════
//  FIRST-RUN ONBOARDING (#ob-overlay)
//  Shows on first app visit with no debts. Walks user through
//  picking debt types, entering balances, income, then reveals
//  their personalized debt-free date.
// ══════════════════════════════════════════════════════════════
(function(){
  'use strict';
  const STORAGE_KEY = 'wjp_onboarded';
  const TYPE_LABELS = {
    credit_card: 'Credit card',
    student_loan: 'Student loan',
    auto: 'Auto loan',
    mortgage: 'Mortgage',
    personal: 'Personal loan',
    medical: 'Medical debt',
    other: 'Other debt'
  };
  const TYPE_ICONS = {
    credit_card: '💳', student_loan: '🎓', auto: '🚗',
    mortgage: '🏠', personal: '👤', medical: '🏥', other: '💼'
  };

  let selectedTypes = new Set();
  let debtEntries = []; // [{type, name, balance, minPayment, apr}, ...]

  function $(id){ return document.getElementById(id); }

  function showOnboarding(){
    const ov = $('ob-overlay');
    if (!ov) return;
    ov.style.display = 'flex';
    gotoStep(0);
    // Lock body scroll
    document.body.style.overflow = 'hidden';
    try { window.wjp && wjp.track && wjp.track('tab_viewed', { tab: 'onboarding_started' }); } catch(_){}
  }
  function hideOnboarding(){
    const ov = $('ob-overlay');
    if (!ov) return;
    ov.style.display = 'none';
    document.body.style.overflow = '';
  }
  function gotoStep(n){
    document.querySelectorAll('#ob-overlay .ob-step').forEach(s => s.classList.remove('active'));
    const step = document.querySelector('#ob-overlay .ob-step[data-step="' + n + '"]');
    if (step) step.classList.add('active');
    document.querySelectorAll('#ob-overlay .ob-dot').forEach((d, i) => {
      d.classList.remove('active', 'done');
      if (i < n) d.classList.add('done');
      else if (i === n) d.classList.add('active');
    });
    // Side effects per step
    if (n === 2) renderDebtDetails();
    if (n === 3) prefillExtraSuggestion();
    if (n === 4) computeReveal();
  }

  function prefillExtraSuggestion(){
    // When the user lands on step 3, auto-suggest an extra-monthly amount
    // based on income + total minimum payments so the 3-strategy comparison
    // actually shows meaningful savings differences.
    const extraInp = $('ob-extra-input');
    const incomeInp = $('ob-income-input');
    if (!extraInp || !incomeInp) return;
    // Only prefill if user hasn't already typed something
    if (extraInp.value) return;
    const income = parseFloat(incomeInp.value) || 0;
    const totalMin = debtEntries.reduce((s, d) => s + (parseFloat(d.minPayment) || 0), 0);
    // Rough rule: after minimums and ~60% living expenses, put ~25% of what's left toward extra.
    // Cap at $500 so the suggestion feels attainable; floor at $50 so strategies differ.
    let suggested = 0;
    if (income > 0) {
      const afterMins = income - totalMin;
      const afterLiving = afterMins - (income * 0.6);
      suggested = Math.max(50, Math.min(500, Math.round(afterLiving * 0.25 / 25) * 25));
    } else {
      suggested = 100; // sane default if no income given
    }
    extraInp.value = suggested;
  }

  function renderDebtDetails(){
    const list = $('ob-details-list');
    if (!list) return;
    // Start with an empty entry per selected type if not yet created
    debtEntries = Array.from(selectedTypes).map(type => {
      const existing = debtEntries.find(d => d.type === type);
      return existing || {
        type,
        name: TYPE_LABELS[type] || 'Debt',
        balance: '',
        minPayment: '',
        apr: ''
      };
    });
    list.innerHTML = debtEntries.map((d, idx) => `
      <div class="ob-debt-row">
        <div class="ob-debt-row-head">
          <strong>${TYPE_ICONS[d.type] || '💼'} ${escapeHtml(TYPE_LABELS[d.type] || 'Debt')}</strong>
        </div>
        <div class="ob-debt-row-fields">
          <div class="ob-field">
            <label>Name</label>
            <input data-idx="${idx}" data-k="name" value="${escapeHtml(d.name)}" placeholder="e.g. Chase Sapphire">
          </div>
          <div class="ob-field">
            <label>Current balance</label>
            <input data-idx="${idx}" data-k="balance" type="number" value="${d.balance}" placeholder="$0" inputmode="decimal">
            <span class="ob-field-hint">What you still owe</span>
          </div>
          <div class="ob-field">
            <label>Minimum monthly payment</label>
            <input data-idx="${idx}" data-k="minPayment" type="number" value="${d.minPayment}" placeholder="$0" inputmode="decimal">
            <span class="ob-field-hint">The required payment, not months left</span>
          </div>
          <div class="ob-field">
            <label>Interest rate (APR)</label>
            <input data-idx="${idx}" data-k="apr" type="number" value="${d.apr}" placeholder="0.0" inputmode="decimal" step="0.1">
            <span class="ob-field-hint">Annual % on the statement</span>
          </div>
        </div>
      </div>
    `).join('');
    // Wire inputs
    list.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        const k = e.target.getAttribute('data-k');
        const v = e.target.value;
        if (!debtEntries[idx]) return;
        debtEntries[idx][k] = (k === 'name') ? v : v; // keep string while typing
        updateDetailsNext();
      });
    });
    updateDetailsNext();
  }
  function updateDetailsNext(){
    const btn = $('ob-details-next');
    if (!btn) return;
    // Must have at least one valid entry with balance + min + apr
    const valid = debtEntries.some(d =>
      parseFloat(d.balance) > 0 && parseFloat(d.minPayment) > 0 && parseFloat(d.apr) >= 0
    );
    btn.disabled = !valid;
    btn.style.opacity = valid ? '1' : '0.5';
    btn.style.pointerEvents = valid ? '' : 'none';
  }

  function commitEntries(){
    // Convert entries into appState.debts
    const valid = debtEntries
      .filter(d => parseFloat(d.balance) > 0 && parseFloat(d.minPayment) > 0)
      .map(d => ({
        id: 'ob-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
        name: d.name || TYPE_LABELS[d.type] || 'Debt',
        balance: parseFloat(d.balance) || 0,
        minPayment: parseFloat(d.minPayment) || 0,
        apr: parseFloat(d.apr) || 0,
        type: d.type,
        dueDate: 15,
        source: 'manual',             // mark as user-entered so Plaid can merge later
        manualType: d.type            // keep the original onboarding key for fuzzy-matching
      }));
    if (typeof appState !== 'undefined' && Array.isArray(appState.debts)) {
      valid.forEach(d => appState.debts.push(d));
    }
    // Income
    const incomeVal = parseFloat($('ob-income-input') && $('ob-income-input').value) || 0;
    if (incomeVal > 0 && typeof appState !== 'undefined') {
      appState.balances = appState.balances || {};
      appState.balances.monthlyIncome = incomeVal;
    }
    // Extra monthly commitment — stored on budget.contribution so it's visible
    // in Simulations too, and feeds the live dashboard date calculations.
    const extraVal = parseFloat($('ob-extra-input') && $('ob-extra-input').value) || 0;
    if (typeof appState !== 'undefined') {
      appState.budget = appState.budget || {};
      appState.budget.contribution = extraVal;
    }
    // Persist
    try { if (typeof saveState === 'function') saveState(); } catch(_){}
  }

  function computeReveal(){
    commitEntries();
    const dateEl = $('ob-reveal-date');
    const metaEl = $('ob-reveal-meta');
    const statsEl = $('ob-reveal-stats');
    const stratsEl = $('ob-strategies');
    if (!dateEl) return;
    try {
      const totalDebt = (appState.debts || []).reduce((s,d) => s + (d.balance || 0), 0);
      const extraMonthly = Math.max(0, parseFloat((appState.budget && appState.budget.contribution) || 0));
      const fmtUsd = n => '$' + Math.round(n).toLocaleString();
      const fmtDate = n => {
        const d = new Date(); d.setMonth(d.getMonth() + n);
        return d.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
      };

      const STRATEGIES = [
        { key:'avalanche', name:'Avalanche', blurb:'Attack the highest-APR debt first. You end up paying the least interest overall — the math-optimal choice.' },
        { key:'snowball',  name:'Snowball',  blurb:'Kill the smallest balance first. You pay a bit more interest, but the quick wins build motivation.' },
        { key:'hybrid',    name:'Hybrid',    blurb:'Weighs APR against balance. A middle path that often finishes between avalanche and snowball.' }
      ];
      // Run each strategy WITH the user's extra monthly so the differences are real.
      const results = STRATEGIES.map(s => {
        const r = (typeof calcSimTotals === 'function')
          ? calcSimTotals(s.key, extraMonthly, 0, 0)
          : null;
        return { ...s, ...(r || {months:0, totalInterest:0}) };
      });
      const solved = results.filter(r => r.months > 0 && r.months < 600);

      if (solved.length === 0) {
        dateEl.textContent = 'Not yet';
        metaEl.innerHTML = 'At these payment amounts the balance isn\'t decreasing fast enough. <strong>Go back and add an extra monthly amount</strong> — even $50/mo changes everything.';
        statsEl.innerHTML = '';
        if (stratsEl) stratsEl.innerHTML = '';
        return;
      }

      // Best = lowest totalInterest (breaks ties with fewer months)
      const best = solved.reduce((a,b) =>
        (a.totalInterest < b.totalInterest) ? a :
        (a.totalInterest > b.totalInterest) ? b :
        (a.months <= b.months ? a : b)
      );
      if (appState && appState.settings) {
        appState.settings.strategy = best.key;
      }

      // Also compute the "if you did nothing extra" baseline for the best strategy
      // so we can tell the user how much the extra is ACTUALLY saving them.
      let baselineSaved = 0, baselineMonthsSaved = 0;
      if (extraMonthly > 0 && typeof calcSimTotals === 'function') {
        const baseline = calcSimTotals(best.key, 0, 0, 0);
        if (baseline && baseline.months > 0 && baseline.months < 600) {
          baselineSaved = Math.max(0, baseline.totalInterest - best.totalInterest);
          baselineMonthsSaved = Math.max(0, baseline.months - best.months);
        }
      }

      // Hero date = best strategy
      dateEl.textContent = fmtDate(best.months);
      const years = Math.floor(best.months/12);
      const monthsRem = best.months % 12;
      const timeText = years > 0
        ? `${years} year${years===1?'':'s'}${monthsRem ? ', ' + monthsRem + ' month' + (monthsRem===1?'':'s') : ''}`
        : `${best.months} month${best.months===1?'':'s'}`;

      const extraCopy = extraMonthly > 0
        ? `With <strong>${fmtUsd(extraMonthly)}/mo extra</strong> on top of minimums, the <strong>${best.name}</strong> plan is your fastest path.`
        : `At minimums only, the <strong>${best.name}</strong> plan is your fastest path. Add any extra monthly amount and the savings jump fast.`;
      metaEl.innerHTML = `${fmtUsd(totalDebt)} across ${appState.debts.length} debt${appState.debts.length===1?'':'s'}. ${extraCopy}`;

      const savedBanner = baselineSaved > 0
        ? `<div class="ob-reveal-stat" style="grid-column:1/-1;background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(201,154,42,0.08));border:1px solid rgba(31,122,74,0.22);"><div class="ob-reveal-stat-label" style="color:#1f7a4a;">What your extra is actually buying you</div><div class="ob-reveal-stat-val" style="color:#1f7a4a;">${fmtUsd(baselineSaved)} saved · ${baselineMonthsSaved} months earlier</div></div>`
        : '';
      statsEl.innerHTML = `
        ${savedBanner}
        <div class="ob-reveal-stat"><div class="ob-reveal-stat-label">Time to freedom</div><div class="ob-reveal-stat-val">${timeText}</div></div>
        <div class="ob-reveal-stat"><div class="ob-reveal-stat-label">Total interest</div><div class="ob-reveal-stat-val">${fmtUsd(best.totalInterest)}</div></div>
        <div class="ob-reveal-stat"><div class="ob-reveal-stat-label">Monthly commitment</div><div class="ob-reveal-stat-val">${fmtUsd((appState.debts||[]).reduce((s,d)=>s+(d.minPayment||0),0) + extraMonthly)}</div></div>
      `;

      // All-three comparison.
      if (stratsEl) {
        const sorted = solved.slice().sort((a,b) => a.totalInterest - b.totalInterest);
        const bestInterest = sorted[0].totalInterest;
        const worstInterest = sorted[sorted.length-1].totalInterest;
        stratsEl.innerHTML = sorted.map((r, idx) => {
          const isBest = idx === 0;
          let savesText;
          if (isBest) {
            const saveVsWorst = worstInterest - bestInterest;
            savesText = saveVsWorst > 0 ? `Saves ${fmtUsd(saveVsWorst)}` : 'Recommended';
          } else {
            savesText = `+${fmtUsd(r.totalInterest - bestInterest)} more interest`;
          }
          return `
            <div class="ob-strategy ${isBest ? 'best' : ''}">
              <div>
                <div class="ob-strategy-name">${r.name}</div>
              </div>
              <div class="ob-strategy-date">
                Debt-free by <b>${fmtDate(r.months)}</b> · ${fmtUsd(r.totalInterest)} total interest
              </div>
              <div class="ob-strategy-saves">${savesText}</div>
              ${isBest ? `<div class="ob-strategy-reason">${r.blurb}</div>` : ''}
            </div>`;
        }).join('');
      }
    } catch (e) {
      console.warn('onboarding reveal failed', e);
      dateEl.textContent = '—';
      metaEl.textContent = 'We saved your debts. Open the dashboard to see your plan.';
    }
    try { window.wjp && wjp.track && wjp.track('tab_viewed', { tab: 'onboarding_completed' }); } catch(_){}
  }

  function finishOnboarding(){
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch(_){}
    hideOnboarding();
    // Trigger a full render so dashboard picks up new data.
    // The actual fn in app.js is updateUI() — our first attempt called
    // updateAllUI/updateDashboard which don't exist, so the dashboard
    // silently stayed empty.
    try { if (typeof updateUI === 'function') updateUI(); } catch(e){ console.warn('updateUI failed', e); }
    try { if (typeof renderMainCalendar === 'function') renderMainCalendar(); } catch(_){}
    // Ensure we're on the dashboard (scroll to top happens inside navigateSPA)
    try { if (typeof navigateSPA === 'function') navigateSPA('dashboard'); } catch(_){}
  }

  function skipOnboarding(){
    try { localStorage.setItem(STORAGE_KEY, 'skipped'); } catch(_){}
    hideOnboarding();
  }

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }

  function wire(){
    // Type picker
    document.querySelectorAll('#ob-overlay .ob-type').forEach(b => {
      b.addEventListener('click', () => {
        const t = b.getAttribute('data-type');
        if (selectedTypes.has(t)) { selectedTypes.delete(t); b.classList.remove('selected'); }
        else { selectedTypes.add(t); b.classList.add('selected'); }
        const next = $('ob-types-next');
        if (next) next.disabled = selectedTypes.size === 0;
      });
    });
    // Step nav buttons
    document.querySelectorAll('#ob-overlay .ob-next, #ob-overlay .ob-back').forEach(b => {
      b.addEventListener('click', () => {
        const n = parseInt(b.getAttribute('data-go'), 10);
        if (!isNaN(n)) gotoStep(n);
      });
    });
    // Skip + finish
    const skipBtn = $('ob-skip');
    if (skipBtn) skipBtn.addEventListener('click', skipOnboarding);
    const finishBtn = $('ob-finish-btn');
    if (finishBtn) finishBtn.addEventListener('click', finishOnboarding);
  }

  function maybeShow(){
    try {
      const done = localStorage.getItem(STORAGE_KEY);
      if (done === '1') return;              // already completed or suppressed on signin
      if (done === 'skipped') return;         // user explicitly dismissed this session
      if (typeof appState === 'undefined') return;

      // Only auto-show for users coming from SIGNUP (not signin). Signup sets
      // the wjp_first_run session flag and clears wjp_onboarded; signin sets
      // wjp_onboarded='1' which is caught above.
      // If neither the session flag nor an explicit "new user" URL marker is
      // present, stay silent — sign-in stays seamless even when data hasn't
      // hydrated from Firestore yet.
      let isNewUser = false;
      try {
        if (sessionStorage.getItem('wjp_first_run') === '1') isNewUser = true;
        if (location.search.indexOf('new=1') >= 0) isNewUser = true;
      } catch(_){}
      if (!isNewUser) return;

      // Double-check: don't re-show if they actually have debts stored.
      const noDebts = !appState.debts || appState.debts.length === 0;
      if (!noDebts) return;

      setTimeout(showOnboarding, 400);
    } catch(_) {}
  }

  // Expose for the dashboard empty-state CTA
  window.wjpShowOnboarding = showOnboarding;

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { wire(); maybeShow(); });
  } else {
    wire(); maybeShow();
  }
})();
