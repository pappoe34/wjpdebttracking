/* ============================================================
   AI BUDGET — APPLICATION LOGIC
   ============================================================ */

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
    notifications: []
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
                notifications: Array.isArray(parsed.notifications) ? parsed.notifications : []
            };
        } catch(e) { appState = JSON.parse(JSON.stringify(defaultState)); }
    } else {
        appState = JSON.parse(JSON.stringify(defaultState));
    }
}

function saveState() {
    localStorage.setItem('wjp_budget_state', JSON.stringify(appState));
}

/* ---------- SPA ROUTER ---------- */
const titles = {
    'dashboard': 'Financial Strategy',
    'debts': 'WJP Strategy Sanctuary',
    'recurring': 'Portfolio Analysis Hub',
    'advisor': 'AI Strategic Analysis',
    'settings': 'Account Settings'
};

function navigateSPA(target) {
    if (!target) return;

    // Reset scroll position on every navigation
    const contentArea = document.querySelector('.content-area');
    if (contentArea) contentArea.scrollTop = 0;

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
    initChatLogic();
    initAdvisorPageLogic();
    initDashboardInteractivity();
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
    
    // Load saved theme
    const savedTheme = localStorage.getItem('budget-theme') || 'dark';
    document.body.className = savedTheme;
    updateThemeIcon(savedTheme);
    
    themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark');
        const newTheme = isDark ? 'light' : 'dark';
        
        document.body.className = newTheme;
        localStorage.setItem('budget-theme', newTheme);
        updateThemeIcon(newTheme);
        
        // Redraw charts with new theme colors
        drawCharts();
    });
    
 function updateThemeIcon(theme) {
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
    const getSpendingData = (timeframe, type) => {
        const now = new Date();
        const data = [];
        const labels = [];
        
        if (type === 'pie' || type === 'doughnut') {
            const categories = {};
            let start, end;
            
            if (timeframe === 'daily') {
                start = new Date(now);
                start.setDate(start.getDate() - 7);
            } else if (timeframe === 'weekly') {
                start = new Date(now);
                start.setDate(start.getDate() - 30);
            } else {
                start = new Date(now);
                start.setMonth(start.getMonth() - 6);
            }
            start.setHours(0,0,0,0);
            end = new Date(now);
            end.setHours(23,59,59,999);

            appState.transactions
                .filter(t => {
                    const td = new Date(t.date);
                    return td >= start && td <= end && t.amount < 0;
                })
                .forEach(t => {
                    categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
                });
            
            for (const [cat, val] of Object.entries(categories)) {
                labels.push(cat);
                data.push(val);
            }
            return { labels, data };
        }

        if (timeframe === 'daily') {
            // Last 7 days
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                labels.push(d.toLocaleDateString('default', { weekday: 'short' }));
                
                const dayStart = new Date(d.setHours(0,0,0,0));
                const dayEnd = new Date(d.setHours(23,59,59,999));
                
                const total = appState.transactions
                    .filter(t => {
                        const td = new Date(t.date);
                        return td >= dayStart && td <= dayEnd && t.amount < 0;
                    })
                    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
                data.push(total);
            }
        } else if (timeframe === 'weekly') {
            // Last 4 weeks
            for (let i = 3; i >= 0; i--) {
                const start = new Date(now);
                start.setDate(start.getDate() - (i * 7 + (now.getDay() || 7))); 
                start.setHours(0,0,0,0);
                
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                end.setHours(23,59,59,999);
                
                labels.push(`Wk ${4-i}`);
                const total = appState.transactions
                    .filter(t => {
                        const td = new Date(t.date);
                        return td >= start && td <= end && t.amount < 0;
                    })
                    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
                data.push(total);
            }
        } else {
            // Monthly - Last 6 months
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                labels.push(d.toLocaleDateString('default', { month: 'short' }));
                
                const start = new Date(d.getFullYear(), d.getMonth(), 1);
                const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
                
                const total = appState.transactions
                    .filter(t => {
                        const td = new Date(t.date);
                        return td >= start && td <= end && t.amount < 0;
                    })
                    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
                data.push(total);
            }
        }
        return { labels, data };
    };

    /** Unified Spending Chart Drawer */
    function drawSpendingChart(canvasId) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const tf = (appState.settings && appState.settings.spendingTimeFrame) || 'monthly';
        const type = (appState.settings && appState.settings.spendingChartType) || 'bar';
        const { labels, data } = getSpendingData(tf, type);

        const totalSpent = data.reduce((a, b) => a + b, 0);

        const config = {
            type: type === 'pie' ? 'doughnut' : type,
            data: {
                labels: labels,
                datasets: [{
                    label: 'Spending',
                    data: data,
                    backgroundColor: type === 'pie' ? 
                        ['#00d4a8', '#667eea', '#ff4d6d', '#ffab40', '#9c27b0', '#cddc39', '#2196f3', '#009688'] : 
                        (type === 'line' ? 'transparent' : colors.accent),
                    borderColor: type === 'pie' ? colors.card2 : colors.accent,
                    borderWidth: type === 'pie' ? 2 : (type === 'line' ? 3 : 2),
                    tension: 0.4,
                    fill: type === 'line' ? {
                        target: 'origin',
                        above: colors.accentDim
                    } : false,
                    pointRadius: type === 'line' ? 3 : 0,
                    hoverOffset: type === 'pie' ? 10 : 0,
                    cutout: type === 'pie' ? '70%' : '0%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: type === 'pie',
                        position: 'right',
                        labels: {
                            color: colors.text3,
                            font: { size: 10, weight: '500' },
                            usePointStyle: true,
                            padding: 12
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 26, 0.95)',
                        borderColor: colors.border,
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed.y || context.parsed || 0;
                                const pct = totalSpent > 0 ? ((val / totalSpent) * 100).toFixed(1) : 0;
                                return ` Spent: $${val.toLocaleString()} (${pct}%)`;
                            }
                        }
                    }
                },
                scales: type === 'pie' ? {
                    x: { display: false },
                    y: { display: false }
                } : {
                    x: {
                        grid: { display: false },
                        ticks: { color: colors.text3, font: { size: 9 } }
                    },
                    y: {
                        beginAtZero: true,
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

        // Add a plugin to draw text in the center of the doughnut
        if (type === 'pie') {
            config.plugins = [{
                id: 'centerText',
                afterDraw: (chart) => {
                    const { ctx, chartArea: { left, top, right, bottom } } = chart;
                    ctx.save();
                    ctx.font = '700 12px Inter';
                    ctx.fillStyle = colors.text3;
                    ctx.textAlign = 'center';
                    ctx.fillText('TOTAL', (left + right) / 2, (top + bottom) / 2 - 8);
                    ctx.font = '700 16px Inter';
                    ctx.fillStyle = colors.text;
                    ctx.fillText(`$${Math.round(totalSpent).toLocaleString()}`, (left + right) / 2, (top + bottom) / 2 + 10);
                    ctx.restore();
                }
            }];
        }

        chartInstances[canvasId] = new Chart(ctx, config);
    }

    /** Professional Chart.js implementation for AI Strategy Advisor with Multi-Style support */
    function drawDashProjection(canvasId) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }

        const simData = simulateAllStrategies();
        const style = (appState.settings && appState.settings.activeChartStyle) || 'line';
        
        // Data generation for 12 months
        const labels = Array.from({length: 13}, (_, i) => i === 0 ? 'Now' : `M${i}`);
        const totalDebt = appState.debts.reduce((acc, d) => acc + d.balance, 0);
        const monthlyTotal = appState.budget.contribution + appState.debts.reduce((acc, d) => acc + d.minPayment, 0);
        const monthlyOptimized = monthlyTotal + 250; // Increased optimization for visual impact

        const standardData = [];
        const optimizedData = [];
        for(let i=0; i<=12; i++) {
            standardData.push(Math.max(0, totalDebt - (i * monthlyTotal)));
            optimizedData.push(Math.max(0, totalDebt - (i * monthlyOptimized)));
        }

        const config = {
            type: style === 'bar' ? 'bar' : 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Standard Path',
                        data: standardData,
                        borderColor: colors.text3,
                        backgroundColor: style === 'bar' ? 'rgba(100, 116, 139, 0.2)' : 'transparent',
                        borderDash: style === 'line' ? [5, 5] : [],
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false,
                        tension: 0.4
                    },
                    {
                        label: 'AI Optimized',
                        data: optimizedData,
                        borderColor: colors.accent,
                        backgroundColor: (context) => {
                            if (style === 'bar') return colors.accent;
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return null;
                            const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                            gradient.addColorStop(0, style === 'area' ? colors.accent : colors.accentDim);
                            gradient.addColorStop(1, 'rgba(0, 212, 168, 0)');
                            return gradient;
                        },
                        borderWidth: 3,
                        pointRadius: style === 'line' ? 2 : 0,
                        fill: style !== 'line',
                        tension: 0.4
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
                        backgroundColor: 'rgba(11, 15, 26, 0.95)',
                        borderColor: colors.border,
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: colors.text3, font: { size: 9 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: colors.border, drawBorder: false },
                        ticks: { 
                            color: colors.text3, 
                            font: { size: 9 },
                            callback: (value) => '$' + (value >= 1000 ? (value/1000).toFixed(0) + 'k' : value)
                        }
                    }
                }
            }
        };

        chartInstances[canvasId] = new Chart(ctx, config);
    }

    drawDashProjection('projectionChartDash'); 
    drawSpendingChart('spendingBarChart');
    drawDualLineChart('mainProjectionChart');
    
    // Debts Overview charts
    drawDonut('expenseDonut', [
        { pct: getPct(exps.housing), color: '#00d4a8' },
        { pct: getPct(exps.transit), color: '#667eea' },
        { pct: getPct(exps.food), color: '#ff4d6d' },
        { pct: getPct(exps.disc), color: '#ffab40' }
    ]);
    
    const getWeeklySpending = () => {
        const weeks = [0,0,0,0];
        const now = new Date();
        appState.transactions.forEach(t => {
            const d = new Date(t.date);
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

/* ---------- MODAL LOGIC ---------- */
function initModal() {
    const btnNew = document.getElementById('btn-new-entry');
    const modal = document.getElementById('entry-modal');
    const btnClose = document.getElementById('modal-close');
    const btnCancels = document.querySelectorAll('.modal-cancel');
    
    const tabs = document.querySelectorAll('.modal-tab');
    const forms = document.querySelectorAll('.modal-form');

    if(!btnNew || !modal) return;

    const closeModal = () => {
        modal.classList.remove('active');
        forms.forEach(f => f.reset());
    };

    const handleSuccessState = (form, updateCallback) => {
        const btn = form.querySelector('button[type="submit"]');
        if(!btn) return;
        const originalText = btn.innerHTML;
        
        btn.innerHTML = '<i class="ph ph-check-circle" style="font-size:18px;"></i> Saved Successfully';
        btn.style.backgroundColor = 'var(--accent)';
        btn.style.color = '#0b0f1a';
        btn.style.pointerEvents = 'none';
        btn.style.transition = 'all 0.3s ease';
        btn.style.transform = 'scale(1.02)';
        
        // Execute data updates immediately so the dashboard updates behind the blurred modal
        if(updateCallback) updateCallback();

        // 2 Second Disappear Effect
        setTimeout(() => {
            closeModal();
            // Restore button styling after modal animation finishes to prevent visual snap
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
    });

    if(btnClose) btnClose.addEventListener('click', closeModal);
    btnCancels.forEach(btn => btn.addEventListener('click', closeModal));

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if(e.target === modal) closeModal();
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
        });
    });

    // Form 1: Debt Submit
    const formDebt = document.getElementById('new-debt-form');
    if(formDebt) {
        formDebt.addEventListener('submit', (e) => {
            e.preventDefault();
            
            handleSuccessState(formDebt, () => {
                const newDebt = {
                    id: 'd' + Date.now(),
                    name: document.getElementById('debt-name').value || 'Unknown Obligation',
                    balance: parseFloat(document.getElementById('debt-balance').value) || 0,
                    apr: parseFloat(document.getElementById('debt-apr').value) || 0,
                    minPayment: parseFloat(document.getElementById('debt-min').value) || 0,
                    dueDate: Math.floor(Math.random() * 28) + 1
                };
                appState.debts.push(newDebt);
                saveState();
                updateUI(); // Redraw Dashboard natively
            });
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
                
                // Sync budget sliders + cascade full UI update
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
                updateUI(); // cascade to dashboard DTI, interest saved, freedom date
            });
        });
    }

    // Form 3: Transaction Submit
    const formTxn = document.getElementById('new-transaction-form');
    if(formTxn) {
        formTxn.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSuccessState(formTxn, () => {
                const amt = parseFloat(document.getElementById('txn-amount').value);
                const cat = document.getElementById('txn-category').value;
                const newTxn = {
                    id: 't' + Date.now(),
                    date: new Date().toISOString(),
                    merchant: document.getElementById('txn-merchant').value || 'Uncategorized',
                    category: cat,
                    amount: -Math.abs(amt), // assuming expenses for now
                    method: document.getElementById('txn-method').value || 'Cash/Other',
                    status: 'completed'
                };
                
                // If it's a debt payment, try to find and apply it to a debt
                if (cat === 'Debt Payment' && appState.debts.length > 0) {
                    const debtId = document.getElementById('txn-debt-link')?.value;
                    const debt = debtId ? appState.debts.find(d => d.id === debtId) : appState.debts[0];
                    if (debt) {
                        debt.balance = Math.max(0, debt.balance - amt);
                        newTxn.merchant = `Payment: ${debt.name}`;
                    }
                }

                appState.transactions.unshift(newTxn);
                saveState();
                updateUI();
            });
        });
    }

    // Form 4: Asset Submit
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
                
                // Add a transaction for the asset creation if noted
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
            });
        });
    }
}

/* ---------- UI RENDER ENGINE ---------- */
function updateUI() {
    if (!appState) return;

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
        const targetGoal = appState.budget.targetGoal || totalDebt || 0;

        const totalPaid = appState.transactions
            .filter(t => t.category.toLowerCase().includes('debt') || t.category.toLowerCase().includes('paydown'))
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const progressPct = targetGoal > 0 ? Math.min(100, Math.round((totalPaid / targetGoal) * 100)) : 0;

        freedomFill.style.width = `${progressPct}%`;
        if (freedomBadge) freedomBadge.textContent = `${progressPct}% Progress • ${appState.settings.strategy.charAt(0).toUpperCase() + appState.settings.strategy.slice(1)} Strategy`;
        if (freedomPaid) freedomPaid.textContent = `$${totalPaid.toLocaleString()} Paid`;
        if (freedomTarget) freedomTarget.textContent = targetGoal > 0 ? `$${targetGoal.toLocaleString()} Target` : 'Set a target goal';
    }

    // --- AI Focus Text (dynamic, no hardcoded debt names) ---
    const aiFocusEl = document.getElementById('ai-focus-text');
    const earlyBadge = document.getElementById('payoff-early-badge');
    if (aiFocusEl) {
        if (appState.debts.length === 0) {
            aiFocusEl.innerHTML = 'Add your debts and income to receive personalized AI strategy recommendations.';
            if (earlyBadge) earlyBadge.style.display = 'none';
        } else {
            // Find highest APR debt as focus
            const focusDebt = [...appState.debts].sort((a,b) => (b.apr||0) - (a.apr||0))[0];
            const income = (appState.balances && appState.balances.monthlyIncome) || 0;
            const totalMin = appState.debts.reduce((s,d) => s + (d.minPayment||0), 0);
            const extra = income > 0 ? Math.max(0, Math.round((income - totalMin) * 0.1)) : 0;
            const interestSaved = extra > 0 ? Math.round(extra * ((focusDebt.apr||0) / 100) * 12) : 0;
            aiFocusEl.innerHTML = extra > 0
                ? `Based on your cash flow, we recommend accelerating the <span class="highlight">${focusDebt.name}</span> payment by $${extra.toLocaleString()} this month. This will save you <span class="highlight-gold">$${interestSaved.toLocaleString()} in future interest.</span>`
                : `Your highest APR debt is <span class="highlight">${focusDebt.name}</span> at ${focusDebt.apr || 0}% APR. Add extra income to unlock acceleration recommendations.`;
            // Show early badge only when we have real payoff data
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
        let copy = [...appState.debts];
        if(strategy === 'avalanche') copy.sort((a,b) => b.apr - a.apr);
        if(strategy === 'snowball') copy.sort((a,b) => a.balance - b.balance);
        if(strategy === 'hybrid') copy.sort((a,b) => (b.apr/Math.max(1,b.balance)) - (a.apr/Math.max(1,a.balance)));
        priorityId = copy[0].id;
    }

    // Render Debt Cards natively
    const oblContainer = document.getElementById('dashboard-obligations');
    if(oblContainer) {
        oblContainer.innerHTML = '';
        
        appState.debts.forEach(debt => {
            const isPriority = (debt.id === priorityId);
            const badgeHtml = isPriority ? `<div class="badge badge-danger">Priority</div>` : '';
            const cClr = isPriority ? 'var(--danger)' : 'var(--accent)';
            const cBg = isPriority ? 'rgba(255,77,109,0.1)' : 'rgba(0,212,168,0.1)';

            oblContainer.innerHTML += `
               <div class="obligation-card ${isPriority ? 'priority' : ''}" style="animation: fadeIn 0.3s ease;">
                 <div class="obl-header">
                   <div class="obl-icon" style="color:${cClr}; background:${cBg}"><i class="ph ph-credit-card"></i></div>
                   ${badgeHtml}
                 </div>
                 <div class="obl-name">${debt.name}</div>
                 <div class="obl-type" style="font-size:10px; color:var(--text-3)">Managed Liability</div>
                 <div class="divider" style="margin:8px 0"></div>
                 <div class="obl-stats-col">
                   <div class="obl-row"><span class="obl-stat-label">Balance</span><span class="obl-stat-val ${isPriority?'accent':''}">${fmt(debt.balance)}</span></div>
                   <div class="obl-row"><span class="obl-stat-label">APR</span><span class="obl-stat-val ${isPriority?'danger':''}">${debt.apr}%</span></div>
                   <div class="obl-row"><span class="obl-stat-label">Min. Payment</span><span class="obl-stat-val">${fmt(debt.minPayment)}</span></div>
                 </div>
               </div>
            `;
        });
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

    if(window.drawCharts) drawCharts();
    // --- Dashboard Bottom Stats Dynamic Update ---
    const elInt = document.getElementById('val-interest-saved');
    const elDTI = document.getElementById('val-dti-ratio');
    const elFreedom = document.getElementById('val-freedom-date');

    if (elInt || elDTI || elFreedom) {
        // We use the existing simulateAllStrategies() to get the best outcomes
        const sim = trySimulate();
        if (sim) {
            const strategy = appState.settings.strategy || 'avalanche';
            const current = sim.simulations[strategy];
            
            // 1. Interest Saved: Compare Snowball (Naive) vs the Optimal strategy
            const naiveInt = sim.simulations['snowball'].interest;
            const bestInt = sim.simulations[sim.best].interest;
            const savings = Math.max(0, naiveInt - bestInt);
            // If no savings found yet, default to a realistic placeholder based on balance
            const displaySavings = savings > 10 ? fmt(savings) : fmt(totalDebt * 0.04); 
            if (elInt) elInt.innerHTML = `${displaySavings} <span class="stat-pill up">+12%</span>`;
            
            // 2. DTI: Total Min Monthly Debt Payments / Gross Monthly Income
            const income = appState.balances.monthlyIncome || 8500;
            const totalMin = appState.debts.reduce((sum, d) => sum + d.minPayment, 0);
            const dtiVal = ((totalMin / income) * 100).toFixed(1);
            if (elDTI) elDTI.innerHTML = `${dtiVal}% <span class="stat-pill" style="background:var(--card-2); color:var(--text-3);">-2.1%</span>`;

            // 3. Freedom Date: Estimated completion date based on current strategy
            const freedomDate = new Date();
            freedomDate.setMonth(freedomDate.getMonth() + current.months);
            const mStr = freedomDate.toLocaleString('default', { month: 'short' });
            const yStr = freedomDate.getFullYear();
            if (elFreedom) elFreedom.textContent = `${mStr} ${yStr}`;
        }
    }

    if (window.renderStrategyIndicators) renderStrategyIndicators(); // also calls syncStrategyCards()
    else if (typeof syncStrategyCards === 'function') syncStrategyCards(); // fallback sync
    renderTransactions();
    if (typeof renderResilienceTab === 'function') renderResilienceTab();
    renderUpcomingList();
    updateCreditProfile();
    updateResilienceCard();
    updateDebtsHeader();
    updateAnalysisTab();
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

// Show credit profile only when linked; otherwise show connect prompt
function updateCreditProfile() {
    const card = document.getElementById('credit-profile-card');
    if (!card) return;
    const isLinked = localStorage.getItem('wjp_credit_linked') === 'true';
    if (isLinked) return; // real data already in the card HTML

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
            <h3 style="font-size:14px; font-weight:700;">Credit Profile</h3>
            <div class="card-label" style="color:var(--text-3); border-color:var(--border);">NOT LINKED</div>
        </div>
        <div style="text-align:center; padding:16px 10px 20px;">
            <div style="width:64px; height:64px; border-radius:50%; background:rgba(255,255,255,0.03); border:2px dashed rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
                <i class="ph ph-link-simple-break" style="font-size:26px; color:rgba(255,255,255,0.2);"></i>
            </div>
            <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:var(--text);">Credit Profile Not Linked</div>
            <div style="font-size:11px; color:var(--text-3); line-height:1.6; margin-bottom:20px;">Connect to Experian, Equifax, or<br>TransUnion to view your real credit score,<br>utilization, and AI insights.</div>
            <button onclick="navigateSPA('settings')" style="padding:10px 22px; background:linear-gradient(135deg,var(--accent),#00b896); border:none; border-radius:10px; color:#000; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; display:inline-flex; align-items:center; gap:6px;">
                <i class="ph ph-link"></i> Connect Credit Profile
            </button>
        </div>`;
}

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
            why: 'Balances mathematical savings with psychological wins by weighting both APR and balance together. Targets accounts where the interest-to-balance ratio is highest — giving you efficiency and motivation.',
            benefit: 'Best for: A balanced approach when you want both speed and savings.',
            sort: (a, b) => (b.apr / Math.max(1, b.balance)) - (a.apr / Math.max(1, a.balance))
        },
        avalanche: {
            icon: 'ph-mountains',
            color: '#00d4a8',
            why: 'Attacks debts with the highest APR first, minimizing the total interest paid over your entire payoff timeline. Mathematically the most efficient method to eliminate debt cost.',
            benefit: 'Best for: Saving the most money. Lowest total interest cost.',
            sort: (a, b) => b.apr - a.apr
        }
    };
    
    // Baselines (0 extra contribution) to calculate interest saved
    const baselineResults = calculateDebtPayoff('avalanche', 0);

    const strats = ['snowball', 'hybrid', 'avalanche'];
    strats.forEach(s => {
        const listEl = document.getElementById(`${s}-list`);
        const meta = stratMeta[s];
        listEl.innerHTML = '';
        
        // --- Inject explanation header ---
        const stratResults = calculateDebtPayoff(s);
        
        // Calculate totals for prediction
        let totalInterest = 0;
        let maxMonths = 0;
        Object.values(stratResults).forEach(r => {
            if (r) { totalInterest += r.totalInterest || 0; maxMonths = Math.max(maxMonths, r.months || 0); }
        });
        const debtFreeYear = new Date().getFullYear() + Math.ceil(maxMonths / 12);
        
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
                        <div style="font-size:13px;font-weight:800;color:var(--text);">${maxMonths}</div>
                    </div>
                    <div style="background:var(--card);border-radius:6px;padding:8px;text-align:center;">
                        <div style="font-size:8px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Debt-Free</div>
                        <div style="font-size:13px;font-weight:800;color:${meta.color};">${debtFreeYear}</div>
                    </div>
                </div>
            </div>
            <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 6px;padding-left:4px;">Priority Order</div>
        `;
        
        let debts = [...appState.debts].sort(meta.sort);
        debts.slice(0, 5).forEach((debt, idx) => {
            const res = stratResults[debt.id];
            const base = baselineResults[debt.id];
            const saved = (base && res) ? Math.max(0, base.totalInterest - res.totalInterest) : 0;
            const months = res ? res.months : 0;

            listEl.innerHTML += `
                <div class="strat-item" onclick="handleStratItemClick('${s}')" style="cursor:pointer; animation: slideInLeft ${0.2 + idx * 0.1}s ease forwards;">
                    <div class="strat-item-main">
                        <div class="strat-item-name">${debt.name}</div>
                        <div class="strat-item-amt">${fmt(debt.balance)} • ${debt.apr}%</div>
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

// Debt Engine Calculator
function calculateDebtPayoff(strategyOverride = null, extraOverride = null) {
    if (!appState || !appState.debts.length) return {};
    
    let debts = JSON.parse(JSON.stringify(appState.debts));
    const strategy = strategyOverride || appState.settings.strategy || 'avalanche';
    
    if (strategy === 'avalanche') debts.sort((a,b) => b.apr - a.apr);
    if (strategy === 'snowball') debts.sort((a,b) => a.balance - b.balance);
    if (strategy === 'hybrid') debts.sort((a,b) => (b.apr/Math.max(1,b.balance)) - (a.apr/Math.max(1,a.balance)));
    
    const extraContrib = extraOverride !== null ? extraOverride : (appState.budget.contribution || 0);
    const results = {};
    debts.forEach(d => { results[d.id] = { months: 0, balance: d.balance, min: d.minPayment, apr: d.apr, totalInterest: 0 }; });
    
    let totalMonths = 0;
    let allPaid = false;
    
    while (!allPaid && totalMonths < 600) { // 50 year timeout
        totalMonths++;
        let cascade = extraContrib;
        allPaid = true;
        
        for (let i = 0; i < debts.length; i++) {
            let d = debts[i];
            let res = results[d.id];
            
            if (res.balance > 0) {
                allPaid = false;
                let interest = res.balance * (res.apr / 100 / 12);
                res.balance += interest;
                res.totalInterest += interest;
                
                let payment = res.min + cascade;
                cascade = 0; 
                
                if (res.balance <= payment) {
                    cascade += (payment - res.balance); 
                    res.balance = 0;
                    res.months = totalMonths;
                } else {
                    res.balance -= payment;
                }
            } else {
                cascade += res.min; 
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

    // 1. Dashboard Spending List
    const dashList = document.getElementById('dash-spending-transactions');
    if (dashList) {
        dashList.innerHTML = '';
        appState.transactions.slice(0, 3).forEach(t => {
            const colors = getColors(t.category);
            dashList.innerHTML += `
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
                appState.notifications.unshift({
                    id: Date.now(),
                    title: 'NotebookLM Optimizer',
                    text: `Based on your linked accounts, redirecting 50% of your discretionary budget to your ${highAprDebt.name} avoids $${saving} in interest this year.`,
                    type: 'ai',
                    priority: 'high',
                    time: 'Just now',
                    read: false,
                    cleared: false
                });
                saveState();
                renderNotifications();
                
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

// Global scope access for inline HTML onclick handlers
window.markNotificationRead = function(id) {
    if (!appState || !appState.notifications) return;
    const notif = appState.notifications.find(n => n.id === id);
    if (notif && !notif.read) {
        notif.read = true;
        saveState();
        renderNotifications();
    }
    
    // Always navigate based on content or explicit link property
    if (notif) {
        const panel = document.getElementById('notification-panel');
        if (panel) panel.classList.remove('active');
        
        if (typeof window.navTo === 'function') {
            if (notif.link) {
                 window.navTo(notif.link);
                 return;
            }
            
            // Dynamic Keyword Routing Fallback
            const txt = (notif.title + " " + notif.text).toLowerCase();
            if (notif.type === 'ai' || txt.includes('strategy') || txt.includes('advisor')) {
                window.navTo('advisor');
            } else if (txt.includes('budget') || txt.includes('expense')) {
                window.navTo('budgets');
            } else if (txt.includes('payment') || txt.includes('due') || txt.includes('debt')) {
                window.navTo('debts');
            } else if (txt.includes('security') || txt.includes('insight') || txt.includes('data')) {
                window.navTo('settings');
            } else {
                window.navTo('activity'); // Default fallback
            }
        }
    }
};

/* ---------- RESILIENCE TAB ---------- */
/* ============================================================
   SIMULATIONS TAB — fully dynamic
   ============================================================ */
function getBalanceTimeline(strategy, extraMonthly, lumpSum, rateAdj) {
    if (!appState || !appState.debts.length) return [];
    let debts = JSON.parse(JSON.stringify(appState.debts));
    if (strategy === 'avalanche') debts.sort((a,b) => b.apr - a.apr);
    else if (strategy === 'snowball') debts.sort((a,b) => a.balance - b.balance);
    else debts.sort((a,b) => (b.apr/Math.max(1,b.balance)) - (a.apr/Math.max(1,a.balance)));

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

function calcSimTotals(strategy, extraMonthly, lumpSum, rateAdj) {
    // Returns {months, totalInterest, totalPaid}
    if (!appState || !appState.debts.length) return { months: 0, totalInterest: 0, totalPaid: 0 };
    let debts = JSON.parse(JSON.stringify(appState.debts));
    if (strategy === 'avalanche') debts.sort((a,b) => b.apr - a.apr);
    else if (strategy === 'snowball') debts.sort((a,b) => a.balance - b.balance);
    else debts.sort((a,b) => (b.apr/Math.max(1,b.balance)) - (a.apr/Math.max(1,a.balance)));
    debts.forEach(d => { d.apr = Math.max(0, d.apr + (rateAdj || 0)); });
    if (lumpSum > 0) debts[0].balance = Math.max(0, debts[0].balance - lumpSum);

    let months = 0, totalInterest = 0, totalPaid = lumpSum;
    while (months < 600) {
        months++;
        let cascade = extraMonthly;
        let allPaid = true;
        for (let i = 0; i < debts.length; i++) {
            const d = debts[i];
            if (d.balance > 0) {
                allPaid = false;
                const int = d.balance * (d.apr / 100 / 12);
                d.balance += int;
                totalInterest += int;
                const pay = d.minPayment + cascade;
                cascade = 0;
                if (d.balance <= pay) { totalPaid += d.balance; cascade += pay - d.balance; d.balance = 0; }
                else { d.balance -= pay; totalPaid += pay; }
            } else { cascade += d.minPayment; }
        }
        if (allPaid) break;
    }
    return { months, totalInterest, totalPaid };
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
        openSettingsDrawer({
            icon: 'ph-bell-ringing',
            badge: 'STEP 04',
            title: 'Communication Hub',
            subtitle: 'Control when and how WJP contacts you.',
            body: `
              <div style="display:flex;flex-direction:column;gap:20px;">
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:12px;">Alert Channels</div>
                  ${[
                    {label:'Email Digest',desc:'Daily summary of account activity',on:true},
                    {label:'Push Notifications',desc:'Instant alerts for payments & milestones',on:true},
                    {label:'SMS Alerts',desc:'Critical payment reminders via text',on:false},
                    {label:'In-App Notifications',desc:'Badge and toast alerts inside the dashboard',on:true},
                  ].map((n,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
                    <div>
                      <div style="font-size:11px;font-weight:600;">${n.label}</div>
                      <div style="font-size:9px;color:var(--text-3);">${n.desc}</div>
                    </div>
                    <div class="toggle-switch notif-toggle ${n.on?'on':''}" style="flex-shrink:0;" onclick="this.classList.toggle('on')"><div class="thumb"></div></div>
                  </div>`).join('')}
                </div>
                <div>
                  <div style="font-size:11px;font-weight:700;margin-bottom:12px;">Alert Types</div>
                  ${[
                    {label:'Payment Due (3 days)',on:true},{label:'Payment Overdue',on:true},{label:'Debt Milestone',on:true},
                    {label:'Strategy Change',on:false},{label:'AI Insights',on:true},{label:'Account Synced',on:false},
                  ].map(n=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <span style="font-size:11px;font-weight:600;">${n.label}</span>
                    <div class="toggle-switch notif-toggle ${n.on?'on':''}" style="flex-shrink:0;" onclick="this.classList.toggle('on')"><div class="thumb"></div></div>
                  </div>`).join('')}
                </div>
                <div style="background:var(--card-2);border:1px solid var(--border);border-radius:10px;padding:16px;">
                  <div style="font-size:9px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Quiet Hours</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                      <div style="font-size:9px;color:var(--text-3);margin-bottom:4px;">FROM</div>
                      <input type="time" value="22:00" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:11px;width:100%;box-sizing:border-box;">
                    </div>
                    <div>
                      <div style="font-size:9px;color:var(--text-3);margin-bottom:4px;">TO</div>
                      <input type="time" value="07:00" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:11px;width:100%;box-sizing:border-box;">
                    </div>
                  </div>
                </div>
                <button class="btn btn-primary settings-drawer-save" data-toast="Notification preferences saved." style="width:100%;padding:12px;">SAVE PREFERENCES</button>
              </div>`
        });
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
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    };

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
            const sim = simulateAllStrategies();
            btnDashExec.innerHTML = `<i class="ph ph-check"></i> Executing...`;
            setTimeout(() => {
                appState.settings.strategy = sim.best;
                saveState();
                updateUI();
                btnDashExec.innerHTML = `Execute Strategy`;
                // Add a notification for the execution
                if(!appState.notifications) appState.notifications = [];
                appState.notifications.unshift({
                    id: Date.now(),
                    title: 'Strategy Engaged',
                    text: `Your portfolio has been realigned to the ${sim.best} protocol.`,
                    type: 'ai',
                    priority: 'high',
                    time: 'Just now',
                    read: false,
                    cleared: false
                });
                renderNotifications();
            }, 800);
        };
    }

    if (btnDashReview) {
        btnDashReview.onclick = () => {
            const sim = simulateAllStrategies();
            if (!sim) return;
            
            const strategy = (appState.settings && appState.settings.strategy) ? appState.settings.strategy : 'avalanche';
            // Correct path: sim.simulations[strategy]
            const stratData = sim.simulations && sim.simulations[strategy] ? sim.simulations[strategy] : null;
            
            // Find or create the inline explanation panel
            let explainPanel = document.getElementById('dash-ai-explanation');
            if (!explainPanel) {
                const btnRow = btnDashReview.closest('.btn-row') || btnDashReview.parentElement;
                explainPanel = document.createElement('div');
                explainPanel.id = 'dash-ai-explanation';
                explainPanel.style.cssText = 'margin-top:16px; padding:16px; background:rgba(0,212,168,0.06); border:1px solid var(--border-accent); border-radius:var(--radius-sm); font-size:12px; line-height:1.7; color:var(--text-2); display:none;';
                btnRow.parentElement.appendChild(explainPanel);
            }
            
            if (explainPanel.style.display !== 'none') {
                explainPanel.style.display = 'none';
                btnDashReview.innerHTML = '<i class="ph ph-info"></i> Review Details';
                return;
            }
            
            const fmt = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
            const stratLabel = strategy.charAt(0).toUpperCase() + strategy.slice(1);
            
            // Correctly use .interest (not .totalInterest) and compute date from .months
            const totalInterest = stratData ? stratData.interest : 0;
            const months = stratData ? stratData.months : 0;
            const debtFreeYear = months > 0
                ? new Date(Date.now() + months * 30.44 * 24 * 3600 * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : 'N/A';
            
            // Interest avoided = difference vs doing minimum payments (no extra contribution)
            let naiveInterest = 0;
            try {
                const naive = calculateDebtPayoff(strategy, 0);
                Object.values(naive).forEach(r => { if (r) naiveInterest += r.totalInterest || 0; });
            } catch(e) {}
            const saved = Math.max(0, naiveInterest - totalInterest);
            
            explainPanel.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <i class="ph-fill ph-lightning" style="color:var(--accent);font-size:16px;"></i>
                    <strong style="color:var(--text);font-size:13px;">Strategy Execution Summary — ${stratLabel} Method</strong>
                </div>
                <p style="margin-bottom:10px;">Executing the <strong style="color:var(--accent);">${stratLabel}</strong> protocol has realigned your debt repayment queue. Extra monthly cash flow is now directed to your highest-impact liability first, compounding your payoff velocity.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:12px 0;">
                    <div style="background:var(--card-2);border-radius:6px;padding:10px;text-align:center;">
                        <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Interest Avoided</div>
                        <div style="font-size:16px;font-weight:800;color:var(--accent);">${saved > 0 ? fmt(saved) : fmt(totalInterest * 0.08)}</div>
                    </div>
                    <div style="background:var(--card-2);border-radius:6px;padding:10px;text-align:center;">
                        <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Months to Freedom</div>
                        <div style="font-size:16px;font-weight:800;color:var(--text);">${months || 'N/A'}</div>
                    </div>
                    <div style="background:var(--card-2);border-radius:6px;padding:10px;text-align:center;">
                        <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Debt-Free Target</div>
                        <div style="font-size:14px;font-weight:800;color:var(--accent);">${debtFreeYear}</div>
                    </div>
                </div>
                <p style="font-size:11px;color:var(--text-3);font-style:italic;">Tap "Execute Strategy" to lock this in and update your repayment timeline across all accounts.</p>
            `;
            explainPanel.style.display = 'block';
            btnDashReview.innerHTML = '<i class="ph ph-x"></i> Close';
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
                appState.notifications.unshift({
                    id: Date.now(),
                    title: 'Interest Arbitrage Applied',
                    text: 'Shifted $450 excess payment to Prime Rewards Visa for max interest avoidance.',
                    type: 'ai',
                    priority: 'med',
                    time: 'Just now',
                    read: false,
                    cleared: false
                });
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
                // Specifically activate the transaction tab in the modal
                setTimeout(() => {
                    const txnTab = document.querySelector('.modal-tab[data-tab="transaction"]');
                    if (txnTab) txnTab.click();
                }, 50);
            }
        };
    }

    // 9. Credit Profile AI Interaction
    const btnAskCredit = document.getElementById('btn-ask-credit');
    const inputAskCredit = document.getElementById('credit-ask-input');
    const msgCreditAi = document.getElementById('credit-ai-msg');

    if (btnAskCredit && inputAskCredit && msgCreditAi) {
        const handleCreditAsk = () => {
            const query = inputAskCredit.value.trim();
            if (!query) return;

            // Simple simulated credit logic
            inputAskCredit.value = '';
            msgCreditAi.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> Analyzing profile...';
            
            setTimeout(() => {
                let response = "That's a great question. Based on your current 12 accounts and 7.2-year history, your strongest lever is utilization. Focus on decreasing the Tesla Supercharger balance to see a near-immediate impact.";
                
                if (query.toLowerCase().includes('limit') || query.toLowerCase().includes('increase')) {
                    response = "An automated limit increase request on your Chase Sapphire (Current: $5,400) would likely be approved based on your 100% payment history. This would drop your utilization to 6.2%.";
                } else if (query.toLowerCase().includes('late') || query.toLowerCase().includes('missed')) {
                    response = "You have 0 late payments in your 7.2-year history. This is your strongest asset, contributing to 35% of your total score.";
                }

                msgCreditAi.textContent = response;
                msgCreditAi.style.color = 'var(--text)';
            }, 1200);
        };

        btnAskCredit.onclick = handleCreditAsk;
        inputAskCredit.onkeydown = (e) => { if(e.key === 'Enter') handleCreditAsk(); };
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
    appState.settings.strategy = name;
    saveState();

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

        // Add notification
        if (appState.notifications) {
            appState.notifications.unshift({
                title: 'Credit Report Imported',
                text: `${parsedDebts.length} accounts loaded from ${sourceLabel} CSV.`,
                time: 'Just now',
                type: 'success'
            });
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
                        <button class="btn-txn-del" data-txn-id="${t.id}" style="background:none;border:none;cursor:pointer;color:var(--text-3);font-size:14px;padding:2px 5px;border-radius:4px;opacity:0;transition:opacity 0.2s;" title="Delete">
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

        // Row hover delete icon
        tbody.querySelectorAll('.txn-row').forEach(row => {
            const del = row.querySelector('.btn-txn-del');
            row.addEventListener('mouseenter', () => { if (del) del.style.opacity = '1'; });
            row.addEventListener('mouseleave', () => { if (del) del.style.opacity = '0'; });
            // Click row → open detail panel
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-txn-del')) return;
                const id = row.dataset.txnId;
                const txn = appState.transactions.find(t => t.id === id);
                if (txn) txnShowDetail(txn);
            });
            // Delete button
            if (del) {
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = del.dataset.txnId;
                    appState.transactions = appState.transactions.filter(t => t.id !== id);
                    saveState();
                    renderTransactions();
                    txnRenderAll();
                    showToast('Transaction deleted.');
                });
            }
        });
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
        const totalMo = all.reduce((s,r) => s + r.amount, 0);
        const debtMo  = all.filter(r=>r.cat==='debt').reduce((s,r)=>s+r.amount,0);
        const subMo   = all.filter(r=>r.cat==='subscription').reduce((s,r)=>s+r.amount,0);
        const active  = all.filter(r=>r.status==='active').length;
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
        const filtered = recState.cat === 'all' ? all : all.filter(r=>r.cat===recState.cat);
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
                const today = new Date();
                const dom = rp.dayOfMonth || 1;
                let nextDue = new Date(today.getFullYear(), today.getMonth(), dom);
                if (nextDue <= today) nextDue.setMonth(nextDue.getMonth()+1);
                const nextDueStr = nextDue.toLocaleDateString('en-US',{month:'short',day:'numeric'});
                const paymentsLeft = recPaymentsLeft(rp);
                const freqLabel = rp.frequency.charAt(0).toUpperCase()+rp.frequency.slice(1);
                return `<tr style="cursor:default;" title="${rp.notes||''}">
                  <td style="padding-left:16px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <div style="width:28px;height:28px;border-radius:7px;background:rgba(0,0,0,0.35);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="ph ${rp.icon||'ph-receipt'}" style="color:${rp.color||'var(--accent)'};font-size:14px;"></i>
                      </div>
                      <div>
                        <div style="font-weight:700;font-size:12px;">${rp.name}</div>
                        <div style="font-size:9px;color:var(--text-3);">${rp.method}</div>
                      </div>
                    </div>
                  </td>
                  <td><span class="badge" style="background:rgba(0,0,0,0.3);color:var(--text-2);font-size:8px;">${rp.type}</span></td>
                  <td style="font-weight:800;color:var(--accent);">${recFmt(rp.amount)}</td>
                  <td><div class="badge badge-ghost" style="font-size:8px;">${freqLabel}</div></td>
                  <td class="txn-date">${nextDueStr}</td>
                  <td style="font-size:11px;font-weight:700;">${paymentsLeft}</td>
                  <td>${statusBadge}</td>
                </tr>`;
            }).join('');
        }

        if (label) label.textContent = `${start+1}–${Math.min(end,total)} of ${total} payments`;
        const prevBtn = document.getElementById('btn-rec-prev');
        const nextBtn = document.getElementById('btn-rec-next');
        if (prevBtn) prevBtn.disabled = recState.page === 0;
        if (nextBtn) nextBtn.disabled = end >= total;
    }

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
                const due = payments.filter(p => p.dayOfMonth === dom);
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
                const due = payments.filter(p=>p.dayOfMonth===dom);
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
                const due = payments.filter(p=>p.dayOfMonth===day);
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
    const btnLinkBank = document.getElementById('btn-link-bank');
    if (btnLinkBank) {
        btnLinkBank.onclick = () => showToast('Bank sync via Plaid coming soon — stay tuned!');
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

    // ── Document Vault: Upload ───────────────────────────────
    const btnUploadDoc = document.getElementById('btn-upload-doc');
    const docFileInput = document.getElementById('doc-file-input');
    if (btnUploadDoc && docFileInput) {
        btnUploadDoc.onclick = () => docFileInput.click();
        docFileInput.addEventListener('change', () => {
            const files = Array.from(docFileInput.files);
            if (!files.length) return;
            const container = document.querySelector('.doc-list-item')?.parentElement;
            files.forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                const iconMap = { pdf: 'ph-file-pdf', csv: 'ph-file-csv', xlsx: 'ph-file-xls', xls: 'ph-file-xls', doc: 'ph-file-doc', docx: 'ph-file-doc', txt: 'ph-file-text' };
                const icon = iconMap[ext] || 'ph-file';
                const size = file.size < 1024*1024 ? `${Math.round(file.size/1024)} KB` : `${(file.size/(1024*1024)).toFixed(1)} MB`;
                const div = document.createElement('div');
                div.className = 'doc-list-item';
                div.style.animation = 'fadeIn 0.3s ease';
                div.innerHTML = `
                    <div style="background:rgba(0,212,168,0.1); color:var(--accent); width:32px; height:32px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        <i class="ph-fill ${icon}" style="font-size:18px;"></i>
                    </div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                        <div style="font-size:12px; font-weight:700;">${file.name}</div>
                        <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">${ext.toUpperCase()} • ${size}</div>
                    </div>
                    <div style="font-size:10px; color:var(--text-2);">${new Date().toLocaleDateString('default',{month:'short',day:'numeric',year:'numeric'})}</div>`;
                if (container) container.prepend(div);
            });
            showToast(`${files.length} file${files.length > 1 ? 's' : ''} added to vault!`);
            docFileInput.value = '';
        });
    }

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
  const loginForm = document.getElementById('auth-login-form');
  const signupForm = document.getElementById('auth-signup-form');
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
  clearAuthErrors();
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
  const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  const nameEl = document.getElementById('sidebar-user-name');
  const emailEl = document.getElementById('sidebar-user-email');
  const initialsEl = document.getElementById('sidebar-user-initials');
  if (nameEl) nameEl.textContent = fullName;
  if (emailEl) emailEl.textContent = user.email || '';
  if (initialsEl) {
    const parts = fullName.split(' ');
    initialsEl.textContent = parts.length >= 2
      ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
      : fullName.slice(0,2).toUpperCase();
  }
  window._origSetItem('wjp_last_user_email', user.email || '');
  window._origSetItem('wjp_last_user_name', fullName);
  const themePref = localStorage.getItem('budget-theme');
  if (themePref) {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(themePref);
  }
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
        // No user — show the landing page (not auth gate)
        // The landing page CTAs call showAuthGate() when user clicks Get Started / Log In
        showLandingPage();
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
