/* wjp-planner.js v4 — centered finance-grade title + AI Coach assessment tab v1 — Consolidate Goals + Notes into a single "Planner" tab.
 *
 *   • Adds a "Planner" item to the sidebar (with a clipboard icon)
 *   • Hides the old "Goals" and "Notes" sidebar items
 *   • Creates a #page-planner section with a tabbed interface:
 *       Goals  ·  Notes  ·  To-do  ·  Reminders  ·  Weekly Review
 *   • Goals + Notes pull from existing appState (no data migration needed)
 *   • New features:
 *       - To-do list with checkboxes (saves to appState.prefs.todos)
 *       - Reminders (computed from upcoming bills + manual entries)
 *       - Weekly Review (free-text journal saved per ISO week)
 *
 * Safe IIFE + install guard. Idempotent. Persists via window.saveState().
 */
(function () {
  'use strict';
  if (window._wjpPlannerInstalled) return;
  window._wjpPlannerInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }
  function toast(msg) { try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (_) {} }

  // --- Storage helpers ---
  function getPrefs() {
    var s = getAppState();
    if (!s) return null;
    if (!s.prefs) s.prefs = {};
    if (!s.prefs.planner) s.prefs.planner = { todos: [], reminders: [], reviews: {} };
    if (!Array.isArray(s.prefs.planner.todos)) s.prefs.planner.todos = [];
    if (!Array.isArray(s.prefs.planner.reminders)) s.prefs.planner.reminders = [];
    if (!s.prefs.planner.reviews || typeof s.prefs.planner.reviews !== 'object') s.prefs.planner.reviews = {};
    return s.prefs.planner;
  }
  function isoWeekKey(d) {
    d = new Date(d || Date.now());
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return date.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Math.round(Number(n)).toLocaleString('en-US');
  }

  // --- Inject styles ---
  function injectStyle() {
    if (document.getElementById('wjp-planner-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-planner-style';
    st.textContent = [
      '#page-planner { padding: 24px 32px 80px; max-width: 1280px; margin: 0 auto; font-family: Inter, system-ui, sans-serif; }',
      '#page-planner .pl-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; flex-wrap:wrap; gap:10px; }',
      '#page-planner h1 { font-size:28px; font-weight:900; letter-spacing:-0.02em; margin:0; color:var(--ink, var(--text-1, #0a0a0a)); }',
      '#page-planner .pl-sub { font-size:12px; color:var(--ink-dim, var(--text-2, #6b7280)); margin-top:4px; }',
      '#page-planner .pl-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; border-bottom:1px solid var(--border, rgba(0,0,0,0.08)); padding-bottom:0; }',
      '#page-planner .pl-tab { padding:10px 16px; border-radius:10px 10px 0 0; cursor:pointer; font-size:13px; font-weight:700; color:var(--ink-dim, #6b7280); background:transparent; border:0; font-family:inherit; transition:color 0.15s, background 0.15s; position:relative; }',
      '#page-planner .pl-tab:hover { color:var(--ink, #0a0a0a); background:var(--bg-3, rgba(0,0,0,0.03)); }',
      '#page-planner .pl-tab.active { color:#1f7a4a; }',
      '#page-planner .pl-tab.active::after { content:""; position:absolute; left:8px; right:8px; bottom:-1px; height:3px; background:#1f7a4a; border-radius:3px 3px 0 0; }',
      '#page-planner .pl-tab .pl-count { font-size:10px; font-weight:700; background:rgba(31,122,74,0.12); color:#1f7a4a; padding:1px 7px; border-radius:99px; margin-left:6px; }',
      '#page-planner .pl-pane { display:none; animation:wjp-pl-fade 0.18s ease both; }',
      '#page-planner .pl-pane.active { display:block; }',
      '@keyframes wjp-pl-fade { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }',
      // Cards
      '#page-planner .pl-card { background:var(--card, #fff); border:1px solid var(--border, rgba(0,0,0,0.08)); border-radius:14px; padding:18px; margin-bottom:14px; }',
      '#page-planner .pl-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }',
      '#page-planner .pl-card-head h2 { font-size:16px; font-weight:800; margin:0; color:var(--ink, #0a0a0a); }',
      // Inputs
      '#page-planner .pl-input { width:100%; padding:10px 12px; border:1px solid var(--border, rgba(0,0,0,0.12)); border-radius:10px; font-size:13px; font-family:inherit; background:var(--bg-2, #fff); color:var(--ink, #0a0a0a); box-sizing:border-box; }',
      '#page-planner .pl-input:focus { outline:2px solid rgba(31,122,74,0.30); outline-offset:1px; border-color:#1f7a4a; }',
      '#page-planner textarea.pl-input { min-height:80px; resize:vertical; font-family:inherit; }',
      // Buttons
      '#page-planner .pl-btn { padding:9px 16px; border-radius:9px; font-weight:700; font-size:12px; cursor:pointer; border:1px solid; font-family:inherit; transition:transform 0.12s, box-shadow 0.12s; }',
      '#page-planner .pl-btn:active { transform:translateY(1px); }',
      '#page-planner .pl-btn-pri { background:#1f7a4a; color:#fff; border-color:#1f7a4a; }',
      '#page-planner .pl-btn-pri:hover { box-shadow:0 4px 12px rgba(31,122,74,0.25); }',
      '#page-planner .pl-btn-sec { background:var(--bg-3, rgba(0,0,0,0.04)); color:var(--ink, #0a0a0a); border-color:var(--border, rgba(0,0,0,0.10)); }',
      // List rows
      '#page-planner .pl-row { display:flex; align-items:center; gap:10px; padding:11px 12px; background:var(--bg-3, rgba(0,0,0,0.025)); border:1px solid var(--border, rgba(0,0,0,0.06)); border-radius:10px; margin-bottom:6px; }',
      '#page-planner .pl-row.done { opacity:0.55; }',
      '#page-planner .pl-row.done .pl-row-text { text-decoration:line-through; }',
      '#page-planner .pl-row input[type=checkbox] { accent-color:#1f7a4a; width:16px; height:16px; cursor:pointer; flex-shrink:0; }',
      '#page-planner .pl-row-text { flex:1; font-size:13px; color:var(--ink, #0a0a0a); font-weight:600; }',
      '#page-planner .pl-row-meta { font-size:10.5px; color:var(--ink-dim, #6b7280); font-weight:600; }',
      '#page-planner .pl-row .pl-del { background:transparent; border:0; color:var(--ink-dim, #6b7280); cursor:pointer; font-size:13px; padding:4px 6px; border-radius:5px; opacity:0.55; }',
      '#page-planner .pl-row .pl-del:hover { background:rgba(220,38,38,0.10); color:#dc2626; opacity:1; }',
      // Goal cards
      '#page-planner .pl-goal { background:linear-gradient(180deg, rgba(31,122,74,0.04), transparent); border:1px solid rgba(31,122,74,0.18); border-radius:12px; padding:14px; margin-bottom:10px; }',
      '#page-planner .pl-goal-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; }',
      '#page-planner .pl-goal-name { font-size:14px; font-weight:800; color:var(--ink, #0a0a0a); }',
      '#page-planner .pl-goal-amt { font-size:14px; font-weight:800; color:#1f7a4a; }',
      '#page-planner .pl-goal-bar { height:6px; background:rgba(0,0,0,0.06); border-radius:99px; overflow:hidden; margin:8px 0 6px; }',
      '#page-planner .pl-goal-fill { height:100%; background:linear-gradient(90deg, #1f7a4a, #16a34a); border-radius:99px; }',
      '#page-planner .pl-goal-meta { font-size:11px; color:var(--ink-dim, #6b7280); font-weight:600; }',
      // Reminders
      '#page-planner .pl-rem { display:flex; gap:10px; align-items:center; padding:11px 12px; border-radius:10px; margin-bottom:6px; background:var(--bg-3, rgba(0,0,0,0.02)); border-left:3px solid #c99a2a; }',
      '#page-planner .pl-rem.overdue { border-left-color:#dc2626; background:rgba(220,38,38,0.04); }',
      '#page-planner .pl-rem.today { border-left-color:#16a34a; background:rgba(22,163,74,0.04); }',
      '#page-planner .pl-rem-icon { font-size:18px; }',
      '#page-planner .pl-rem-body { flex:1; }',
      '#page-planner .pl-rem-title { font-size:13px; font-weight:700; color:var(--ink, #0a0a0a); }',
      '#page-planner .pl-rem-meta { font-size:11px; color:var(--ink-dim, #6b7280); font-weight:600; margin-top:1px; }',
      '#page-planner .pl-rem-when { font-size:11px; font-weight:800; color:#c99a2a; text-transform:uppercase; letter-spacing:0.04em; }',
      '#page-planner .pl-rem.overdue .pl-rem-when { color:#dc2626; }',
      '#page-planner .pl-rem.today .pl-rem-when { color:#16a34a; }',
      // Quick add bar
      '#page-planner .pl-quick { display:flex; gap:8px; align-items:center; margin-bottom:12px; }',
      '#page-planner .pl-quick .pl-input { flex:1; }',
      '#page-planner .pl-empty { text-align:center; padding:36px 16px; color:var(--ink-dim, #6b7280); font-size:13px; }',
      '#page-planner .pl-empty .pl-empty-icon { font-size:38px; opacity:0.4; display:block; margin-bottom:8px; }',
      // Overview grid (bottom of page)
      '#pl-overview { margin-top:32px; padding-top:24px; border-top:1px solid var(--border, rgba(0,0,0,0.08)); }',
      '#pl-overview .pl-overview-head { display:flex; align-items:center; gap:10px; margin-bottom:14px; }',
      '#pl-overview h2 { font-size:18px; font-weight:800; margin:0; color:var(--ink, #0a0a0a); }',
      '#pl-overview .pl-row-meta { margin-top:2px; }',
      '#pl-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; }',
      '#pl-grid .pl-ovcard { background:var(--card,#fff); border:1px solid var(--border,rgba(0,0,0,0.08)); border-radius:14px; padding:16px; cursor:pointer; transition:transform 0.15s, box-shadow 0.15s, border-color 0.15s; display:flex; flex-direction:column; gap:8px; min-height:170px; }',
      '#pl-grid .pl-ovcard:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,0.06); border-color:rgba(31,122,74,0.30); }',
      '#pl-grid .pl-ovcard-head { display:flex; align-items:center; gap:8px; }',
      '#pl-grid .pl-ovcard-emoji { font-size:18px; }',
      '#pl-grid .pl-ovcard-label { font-size:10.5px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-dim, #6b7280); }',
      '#pl-grid .pl-ovcard-big { font-size:28px; font-weight:900; letter-spacing:-0.02em; color:var(--ink,#0a0a0a); }',
      '#pl-grid .pl-ovcard-sub { font-size:11.5px; color:var(--ink-dim,#6b7280); font-weight:600; margin-top:-4px; }',
      '#pl-grid .pl-ovcard-list { display:flex; flex-direction:column; gap:4px; margin-top:6px; flex:1; }',
      '#pl-grid .pl-ovrow { display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:11.5px; padding:4px 0; border-bottom:1px dashed rgba(0,0,0,0.06); }',
      '#pl-grid .pl-ovrow:last-child { border-bottom:0; }',
      '#pl-grid .pl-ovrow.overdue .pl-ovrow-meta { color:#dc2626; font-weight:800; }',
      '#pl-grid .pl-ovrow.today .pl-ovrow-meta { color:#16a34a; font-weight:800; }',
      '#pl-grid .pl-ovrow-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; color:var(--ink,#0a0a0a); font-weight:600; }',
      '#pl-grid .pl-ovrow-meta { font-size:10.5px; color:var(--ink-dim,#6b7280); font-weight:700; flex-shrink:0; }',
      '#pl-grid .pl-ovcard-cta { font-size:11px; font-weight:800; color:#1f7a4a; margin-top:auto; padding-top:6px; }',
      // Hero (centered title block)
      '#page-planner .pl-hero { text-align:center; padding:32px 16px 28px; margin-bottom:18px; border-radius:18px; background:linear-gradient(160deg, rgba(31,122,74,0.06) 0%, rgba(124,58,237,0.05) 50%, rgba(201,154,42,0.04) 100%); border:1px solid rgba(31,122,74,0.10); position:relative; overflow:hidden; }',
      '#page-planner .pl-hero::before { content:""; position:absolute; inset:0; background:radial-gradient(circle at 50% 0%, rgba(31,122,74,0.10), transparent 60%); pointer-events:none; }',
      '#page-planner .pl-hero-eyebrow { font-size:10px; font-weight:800; letter-spacing:0.22em; color:#1f7a4a; margin-bottom:10px; position:relative; }',
      '#page-planner .pl-hero-title { font-size:clamp(28px, 4.5vw, 44px); font-weight:900; margin:0 0 10px; letter-spacing:-0.025em; line-height:1.05; color:var(--ink, #0a0a0a); position:relative; }',
      '#page-planner .pl-hero-accent { background:linear-gradient(90deg, #1f7a4a, #16a34a 40%, #c99a2a 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }',
      '#page-planner .pl-hero-sub { font-size:14px; color:var(--ink-dim, #6b7280); line-height:1.6; max-width:680px; margin:0 auto; position:relative; }',
      '#page-planner .pl-hero-sub b { color:var(--ink, #0a0a0a); font-weight:800; }',
      '#page-planner .pl-hero-stats { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:18px; position:relative; }',
      '#page-planner .pl-hs-card { min-width:84px; padding:10px 14px; background:var(--card, rgba(255,255,255,0.85)); border:1px solid var(--border, rgba(0,0,0,0.08)); border-radius:12px; text-align:center; position:relative; }',
      '#page-planner .pl-hs-card.pl-hs-warn { border-color:rgba(220,38,38,0.30); background:rgba(220,38,38,0.04); }',
      '#page-planner .pl-hs-card.pl-hs-ok { border-color:rgba(31,122,74,0.40); background:rgba(31,122,74,0.06); }',
      '#page-planner .pl-hs-num { font-size:20px; font-weight:900; color:var(--ink, #0a0a0a); letter-spacing:-0.01em; line-height:1.1; }',
      '#page-planner .pl-hs-lbl { font-size:9.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-dim, #6b7280); margin-top:2px; }',
      '#page-planner .pl-hs-flag { font-size:9px; font-weight:800; color:#dc2626; margin-top:3px; }',
      // Center the tabs row
      '#page-planner .pl-tabs { justify-content:center; }',
      // AI Coach tab — purple accent
      '#page-planner .pl-tab-coach { background:linear-gradient(135deg, rgba(124,58,237,0.08), rgba(31,122,74,0.05)) !important; }',
      '#page-planner .pl-tab-coach.active { color:#7c3aed; }',
      '#page-planner .pl-tab-coach.active::after { background:#7c3aed !important; }',
      // Coach pane
      '#page-planner .pl-coach-top { display:grid; grid-template-columns:200px 1fr; gap:20px; margin-bottom:16px; align-items:stretch; }',
      '@media (max-width: 720px) { #page-planner .pl-coach-top { grid-template-columns:1fr; } }',
      '#page-planner .pl-coach-score { background:var(--card,#fff); border:2px solid var(--ring, #1f7a4a); border-radius:18px; padding:18px; text-align:center; display:flex; flex-direction:column; justify-content:center; gap:4px; }',
      '#page-planner .pl-coach-score-num { font-size:56px; font-weight:900; line-height:1; letter-spacing:-0.04em; }',
      '#page-planner .pl-coach-score-lbl { font-size:9.5px; font-weight:800; letter-spacing:0.10em; text-transform:uppercase; color:var(--ink-dim, #6b7280); margin-top:4px; }',
      '#page-planner .pl-coach-score-band { font-size:13px; font-weight:800; letter-spacing:-0.005em; margin-top:6px; }',
      '#page-planner .pl-coach-summary { background:var(--card,#fff); border:1px solid var(--border, rgba(0,0,0,0.08)); border-radius:14px; padding:18px; }',
      '#page-planner .pl-coach-title { font-size:14px; font-weight:800; margin-bottom:10px; color:var(--ink, #0a0a0a); }',
      '#page-planner .pl-coach-checks { display:flex; flex-direction:column; gap:6px; }',
      '#page-planner .pl-coach-check { display:flex; align-items:flex-start; gap:8px; font-size:12.5px; color:var(--ink, #0a0a0a); padding:6px 0; }',
      '#page-planner .pl-coach-check.ok .pl-coach-check-icon { color:#16a34a; }',
      '#page-planner .pl-coach-check.todo .pl-coach-check-icon { color:#c99a2a; }',
      '#page-planner .pl-coach-check-icon { font-weight:900; flex-shrink:0; font-size:13px; line-height:1.4; }',
      '#page-planner .pl-coach-sug { display:flex; gap:12px; padding:14px 0; border-bottom:1px solid var(--border, rgba(0,0,0,0.06)); }',
      '#page-planner .pl-coach-sug:last-child { border-bottom:0; }',
      '#page-planner .pl-coach-sug-emoji { font-size:24px; flex-shrink:0; line-height:1.1; }',
      '#page-planner .pl-coach-sug-body { flex:1; }',
      '#page-planner .pl-coach-sug-title { font-size:14px; font-weight:800; color:var(--ink, #0a0a0a); margin-bottom:4px; }',
      '#page-planner .pl-coach-sug-text { font-size:12.5px; color:var(--ink-dim, #6b7280); line-height:1.55; margin-bottom:10px; }',
      '#page-planner .pl-coach-sug-cta { margin-top:4px; }',
      '#page-planner .pl-coach-chat { background:linear-gradient(160deg, rgba(124,58,237,0.06), rgba(31,122,74,0.04)); border:1px solid rgba(124,58,237,0.20); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // --- Sidebar Planner item (replaces Goals + Notes) ---
  function injectSidebarItem() {
    if (document.getElementById('nav-planner')) return;
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-planner';
    item.setAttribute('data-page', 'planner');
    item.innerHTML = '<div class="nav-icon"><i class="ph ph-clipboard-text"></i></div><span>Planner</span>';
    // Insert after "recurring" (Calendar) nav
    var recurringNav = nav.querySelector('[data-page="recurring"]');
    if (recurringNav && recurringNav.nextSibling) {
      nav.insertBefore(item, recurringNav.nextSibling);
    } else {
      nav.appendChild(item);
    }
    item.addEventListener('click', function () { showPlanner(); });
  }
  function hideOldNavItems() {
    var hides = ['nav-goals-wjp', 'nav-plans']; // Goals + (mis-labeled) Notes
    hides.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    // Also hide by data-page in case the IDs change
    ['goals-wjp', 'plans', 'goals', 'notes'].forEach(function (page) {
      var el = document.querySelector('.sidebar .nav-item[data-page="' + page + '"]');
      if (el && el.id !== 'nav-planner') el.style.display = 'none';
    });
  }
  function showPlanner() {
    // Hide other pages
    document.querySelectorAll('[id^="page-"], .page').forEach(function (p) {
      if (p.id === 'page-planner') return;
      p.classList.remove('active');
      if (p.style) p.style.display = 'none';
    });
    var page = document.getElementById('page-planner');
    if (!page) page = buildPage();
    page.style.display = 'block';
    page.classList.add('active');
    // Mark nav active
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    var nav = document.getElementById('nav-planner');
    if (nav) nav.classList.add('active');
    renderActivePane();
  }

  // --- Page DOM ---
  function buildPage() {
    // v3: mount INSIDE .content-area but BEFORE the .page-footer element so
    // the site footer (Terms/Privacy/Data Policy) stays below the planner.
    var main = document.querySelector('.content-area') || document.querySelector('main') || document.querySelector('.main-content') || document.body;
    var page = document.createElement('div');
    page.id = 'page-planner';
    page.className = 'page';
    page.style.display = 'none';
    page.innerHTML =
      '<div class="pl-hero">' +
        '<div class="pl-hero-eyebrow">FINANCIAL PLANNING WORKSPACE</div>' +
        '<h1 class="pl-hero-title">Your Money <span class="pl-hero-accent">Planner</span></h1>' +
        '<p class="pl-hero-sub">A single command center for the financial work you do between paydays — track <b>goals</b>, hold yourself to <b>to-dos</b>, surface <b>bill reminders</b>, capture <b>notes</b>, and run a weekly <b>review</b>. Everything you write here is part of the same plan as your debts and budget.</p>' +
        '<div class="pl-hero-stats" id="pl-hero-stats"></div>' +
      '</div>' +
      '<div class="pl-tabs" id="pl-tabs">' +
        '<button class="pl-tab active" data-pane="goals">🎯 Goals <span class="pl-count" data-count="goals">0</span></button>' +
        '<button class="pl-tab" data-pane="todos">✅ To-do <span class="pl-count" data-count="todos">0</span></button>' +
        '<button class="pl-tab" data-pane="reminders">⏰ Reminders <span class="pl-count" data-count="reminders">0</span></button>' +
        '<button class="pl-tab" data-pane="notes">📝 Notes <span class="pl-count" data-count="notes">0</span></button>' +
        '<button class="pl-tab" data-pane="review">🪞 Weekly Review</button>' +
        '<button class="pl-tab pl-tab-coach" data-pane="coach">✨ AI Coach</button>' +
      '</div>' +
      '<div class="pl-pane active" data-pane="goals" id="pl-pane-goals"></div>' +
      '<div class="pl-pane" data-pane="todos" id="pl-pane-todos"></div>' +
      '<div class="pl-pane" data-pane="reminders" id="pl-pane-reminders"></div>' +
      '<div class="pl-pane" data-pane="notes" id="pl-pane-notes"></div>' +
      '<div class="pl-pane" data-pane="review" id="pl-pane-review"></div>' +
      '<div class="pl-pane" data-pane="coach" id="pl-pane-coach"></div>';
    var footer = main.querySelector('.page-footer, footer.page-footer, footer');
    if (footer) main.insertBefore(page, footer); else main.appendChild(page);

    // Wire tabs
    page.querySelectorAll('.pl-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        page.querySelectorAll('.pl-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        page.querySelectorAll('.pl-pane').forEach(function (p) { p.classList.remove('active'); });
        var pane = page.querySelector('.pl-pane[data-pane="' + btn.dataset.pane + '"]');
        if (pane) pane.classList.add('active');
        renderActivePane();
      });
    });

    // v2 — Bottom overview grid showing all sections at-a-glance
    var bottom = document.createElement('div');
    bottom.id = 'pl-overview';
    bottom.innerHTML = '<div class="pl-overview-head">' +
      '<h2>📊 Planner at a glance</h2>' +
      '<div class="pl-row-meta">Live summary across every section</div>' +
    '</div>' +
    '<div class="pl-grid" id="pl-grid"></div>';
    page.appendChild(bottom);
    return page;
  }
  function renderOverviewGrid() {
    var grid = document.getElementById('pl-grid');
    if (!grid) return;
    var s = getAppState() || {};
    var prefs = getPrefs() || { todos: [], reminders: [], reviews: {} };
    var goals = Array.isArray(s.goals) ? s.goals : [];
    var notes = Array.isArray(s.notes) ? s.notes : [];
    var pendingTodos = prefs.todos.filter(function (t) { return !t.done; });
    var doneTodos = prefs.todos.filter(function (t) { return t.done; });
    var auto = autoReminders();
    var manualRem = prefs.reminders || [];
    var allRem = auto.concat(manualRem.map(function (r) {
      var d = r.date ? new Date(r.date + 'T00:00:00') : null;
      var diff = d ? Math.round((d - new Date()) / 86400000) : null;
      return { title: r.text, when: diff == null ? '' : diff < 0 ? Math.abs(diff)+'d ago' : diff === 0 ? 'Today' : 'In '+diff+'d', cls: diff != null && diff < 0 ? 'overdue' : diff === 0 ? 'today' : '' };
    }));
    var thisWeek = isoWeekKey(new Date());
    var review = (prefs.reviews && prefs.reviews[thisWeek]) || {};
    var hasReview = !!(review.wins || review.struggles || review.next);

    // Goals total saved + target
    var totalSaved = goals.reduce(function (a, g) { return a + (Number(g.saved || g.current) || 0); }, 0);
    var totalTarget = goals.reduce(function (a, g) { return a + (Number(g.target || g.amount) || 0); }, 0);
    var goalPct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

    var html = '';

    // Goals card
    html += '<div class="pl-ovcard" data-jump="goals">' +
      '<div class="pl-ovcard-head"><span class="pl-ovcard-emoji">🎯</span><span class="pl-ovcard-label">Goals</span></div>' +
      '<div class="pl-ovcard-big">' + goals.length + '</div>' +
      '<div class="pl-ovcard-sub">' + (goals.length === 0 ? 'No active goals yet' : fmtUsd(totalSaved) + ' / ' + fmtUsd(totalTarget) + ' (' + goalPct + '%)') + '</div>';
    if (goals.length > 0) {
      html += '<div class="pl-ovcard-list">' +
        goals.slice(0, 3).map(function (g) {
          var saved = Number(g.saved || g.current) || 0;
          var target = Number(g.target || g.amount) || 1;
          var pct = Math.min(100, Math.round(saved / target * 100));
          return '<div class="pl-ovrow"><span class="pl-ovrow-name">' + escapeHtml(g.name) + '</span><span class="pl-ovrow-meta">' + pct + '%</span></div>';
        }).join('') +
      '</div>';
    }
    html += '<div class="pl-ovcard-cta">View all →</div></div>';

    // To-do card
    html += '<div class="pl-ovcard" data-jump="todos">' +
      '<div class="pl-ovcard-head"><span class="pl-ovcard-emoji">✅</span><span class="pl-ovcard-label">To-do</span></div>' +
      '<div class="pl-ovcard-big">' + pendingTodos.length + '</div>' +
      '<div class="pl-ovcard-sub">' + (pendingTodos.length === 0 ? 'Inbox zero — nice work' : 'pending · ' + doneTodos.length + ' done') + '</div>';
    if (pendingTodos.length > 0) {
      html += '<div class="pl-ovcard-list">' +
        pendingTodos.slice(0, 3).map(function (t) {
          return '<div class="pl-ovrow"><span class="pl-ovrow-name">○ ' + escapeHtml(t.text) + '</span></div>';
        }).join('') +
      '</div>';
    }
    html += '<div class="pl-ovcard-cta">View all →</div></div>';

    // Reminders card
    var overdue = allRem.filter(function (r) { return r.cls === 'overdue'; });
    var today = allRem.filter(function (r) { return r.cls === 'today'; });
    html += '<div class="pl-ovcard" data-jump="reminders">' +
      '<div class="pl-ovcard-head"><span class="pl-ovcard-emoji">⏰</span><span class="pl-ovcard-label">Reminders</span></div>' +
      '<div class="pl-ovcard-big">' + allRem.length + '</div>' +
      '<div class="pl-ovcard-sub">' + (allRem.length === 0 ? 'Nothing scheduled' : (overdue.length ? overdue.length + ' overdue · ' : '') + (today.length ? today.length + ' today · ' : '') + 'next 14 days') + '</div>';
    if (allRem.length > 0) {
      html += '<div class="pl-ovcard-list">' +
        allRem.slice(0, 3).map(function (r) {
          return '<div class="pl-ovrow ' + (r.cls || '') + '"><span class="pl-ovrow-name">' + escapeHtml(r.title) + '</span><span class="pl-ovrow-meta">' + escapeHtml(r.when) + '</span></div>';
        }).join('') +
      '</div>';
    }
    html += '<div class="pl-ovcard-cta">View all →</div></div>';

    // Notes card
    html += '<div class="pl-ovcard" data-jump="notes">' +
      '<div class="pl-ovcard-head"><span class="pl-ovcard-emoji">📝</span><span class="pl-ovcard-label">Notes</span></div>' +
      '<div class="pl-ovcard-big">' + notes.length + '</div>' +
      '<div class="pl-ovcard-sub">' + (notes.length === 0 ? 'No notes yet' : (notes.length === 1 ? '1 note' : notes.length + ' notes')) + '</div>';
    if (notes.length > 0) {
      var sortedNotes = notes.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
      html += '<div class="pl-ovcard-list">' +
        sortedNotes.slice(0, 3).map(function (n) {
          return '<div class="pl-ovrow"><span class="pl-ovrow-name">' + escapeHtml(n.title || 'Untitled') + '</span><span class="pl-ovrow-meta">' + (n.created ? new Date(n.created).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '') + '</span></div>';
        }).join('') +
      '</div>';
    }
    html += '<div class="pl-ovcard-cta">View all →</div></div>';

    // Weekly Review card
    html += '<div class="pl-ovcard" data-jump="review">' +
      '<div class="pl-ovcard-head"><span class="pl-ovcard-emoji">🪞</span><span class="pl-ovcard-label">Weekly Review</span></div>' +
      '<div class="pl-ovcard-big" style="font-size:18px;line-height:1.3;letter-spacing:0;">' + thisWeek + '</div>' +
      '<div class="pl-ovcard-sub">' + (hasReview ? 'Saved this week ✓' : 'Not yet written') + '</div>';
    if (hasReview) {
      html += '<div class="pl-ovcard-list">' +
        (review.wins ? '<div class="pl-ovrow"><b style="color:#1f7a4a;">Wins:</b> <span class="pl-ovrow-name">' + escapeHtml(review.wins.substring(0, 70)) + (review.wins.length > 70 ? '…' : '') + '</span></div>' : '') +
        (review.next ? '<div class="pl-ovrow"><b style="color:#c99a2a;">Next:</b> <span class="pl-ovrow-name">' + escapeHtml(review.next.substring(0, 70)) + (review.next.length > 70 ? '…' : '') + '</span></div>' : '') +
      '</div>';
    }
    html += '<div class="pl-ovcard-cta">' + (hasReview ? 'Edit →' : 'Write one →') + '</div></div>';

    grid.innerHTML = html;
    // Wire jumps
    grid.querySelectorAll('.pl-ovcard').forEach(function (card) {
      card.onclick = function () {
        var target = card.dataset.jump;
        var btn = document.querySelector('#page-planner .pl-tab[data-pane="' + target + '"]');
        if (btn) btn.click();
        // Scroll to top so user sees the active pane
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    });
  }

  function renderActivePane() {
    var active = document.querySelector('#page-planner .pl-pane.active');
    if (!active) return;
    var pane = active.dataset.pane;
    if (pane === 'goals') renderGoalsPane(active);
    else if (pane === 'todos') renderTodosPane(active);
    else if (pane === 'reminders') renderRemindersPane(active);
    else if (pane === 'notes') renderNotesPane(active);
    else if (pane === 'review') renderReviewPane(active);
    else if (pane === 'coach') renderCoachPane(active);
    updateCounts();
    try { renderOverviewGrid(); } catch (_) {}
    try { renderHeroStats(); } catch (_) {}
  }

  function updateCounts() {
    var s = getAppState();
    var goalCount = (s && Array.isArray(s.goals)) ? s.goals.length : 0;
    var noteCount = (s && Array.isArray(s.notes)) ? s.notes.length : 0;
    var prefs = getPrefs() || { todos: [], reminders: [] };
    var todoCount = prefs.todos.filter(function (t) { return !t.done; }).length;
    var remCount = prefs.reminders.length + autoReminders().length;
    document.querySelectorAll('#page-planner [data-count]').forEach(function (el) {
      var key = el.dataset.count;
      var n = 0;
      if (key === 'goals') n = goalCount;
      else if (key === 'todos') n = todoCount;
      else if (key === 'reminders') n = remCount;
      else if (key === 'notes') n = noteCount;
      el.textContent = n;
    });
  }

  // ---- Goals pane ----
  function renderGoalsPane(host) {
    var s = getAppState();
    var goals = (s && Array.isArray(s.goals)) ? s.goals : [];
    var html =
      '<div class="pl-card">' +
        '<div class="pl-card-head"><h2>Your goals</h2>' +
          '<button class="pl-btn pl-btn-pri" id="pl-add-goal">＋ New goal</button>' +
        '</div>';
    if (!goals.length) {
      html += '<div class="pl-empty"><span class="pl-empty-icon">🎯</span>Set a goal — emergency fund, payoff target, big purchase. Goals show progress automatically when you save toward them.</div>';
    } else {
      html += goals.map(function (g) {
        var saved = Number(g.saved || g.current || 0);
        var target = Number(g.target || g.amount || 1);
        var pct = Math.min(100, Math.round((saved / target) * 100));
        return '<div class="pl-goal" data-goal-id="' + escapeHtml(g.id || '') + '">' +
          '<div class="pl-goal-head">' +
            '<div class="pl-goal-name">' + escapeHtml(g.name || 'Untitled goal') + '</div>' +
            '<div class="pl-goal-amt">' + fmtUsd(saved) + ' / ' + fmtUsd(target) + '</div>' +
          '</div>' +
          '<div class="pl-goal-bar"><div class="pl-goal-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="pl-goal-meta">' + pct + '% complete' + (g.deadline ? ' · target ' + escapeHtml(g.deadline) : '') + '</div>' +
        '</div>';
      }).join('');
    }
    html += '</div>';
    host.innerHTML = html;
    var btn = document.getElementById('pl-add-goal');
    if (btn) btn.onclick = openAddGoal;
  }
  function openAddGoal() {
    var name = prompt('Goal name (e.g. Emergency fund, Vacation, Down payment)');
    if (!name) return;
    var target = parseFloat(prompt('Target amount in dollars (e.g. 5000)'));
    if (!isFinite(target) || target <= 0) return;
    var saved = parseFloat(prompt('Already saved? (Enter 0 if starting fresh)')) || 0;
    var deadline = prompt('Target date (optional, e.g. 2026-12-31)') || '';
    var s = getAppState();
    if (!s) return;
    if (!Array.isArray(s.goals)) s.goals = [];
    s.goals.push({
      id: 'g' + Date.now(),
      name: name.trim(),
      target: target,
      saved: saved,
      deadline: deadline,
      createdAt: Date.now()
    });
    saveState();
    toast('Goal added.');
    renderActivePane();
  }

  // ---- To-do pane ----
  function renderTodosPane(host) {
    var prefs = getPrefs();
    if (!prefs) return;
    var html =
      '<div class="pl-card">' +
        '<div class="pl-card-head"><h2>To-do list</h2></div>' +
        '<div class="pl-quick">' +
          '<input id="pl-todo-input" type="text" class="pl-input" placeholder="What needs to get done? (e.g. Call Capital One to lower APR)" maxlength="200" />' +
          '<button id="pl-todo-add" class="pl-btn pl-btn-pri">Add</button>' +
        '</div>';
    if (!prefs.todos.length) {
      html += '<div class="pl-empty"><span class="pl-empty-icon">✅</span>Add a task to get started — anything from "Cancel old Netflix" to "Open high-yield savings".</div>';
    } else {
      // Pending first, then done
      var pending = prefs.todos.filter(function (t) { return !t.done; });
      var done = prefs.todos.filter(function (t) { return t.done; });
      html += pending.concat(done).map(function (t) {
        return '<div class="pl-row ' + (t.done ? 'done' : '') + '" data-todo-id="' + escapeHtml(t.id) + '">' +
          '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' />' +
          '<div class="pl-row-text">' + escapeHtml(t.text) + '</div>' +
          (t.created ? '<div class="pl-row-meta">' + new Date(t.created).toLocaleDateString('en-US', { month:'short', day:'numeric' }) + '</div>' : '') +
          '<button class="pl-del" title="Delete">✕</button>' +
        '</div>';
      }).join('');
    }
    html += '</div>';
    host.innerHTML = html;
    // Wire
    var input = document.getElementById('pl-todo-input');
    var addBtn = document.getElementById('pl-todo-add');
    function add() {
      var v = (input.value || '').trim();
      if (!v) return;
      prefs.todos.unshift({ id: 't' + Date.now(), text: v, done: false, created: Date.now() });
      saveState();
      renderActivePane();
    }
    if (addBtn) addBtn.onclick = add;
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
    host.querySelectorAll('.pl-row').forEach(function (row) {
      var id = row.dataset.todoId;
      var cb = row.querySelector('input[type=checkbox]');
      var del = row.querySelector('.pl-del');
      if (cb) cb.onchange = function () {
        var t = prefs.todos.find(function (x) { return x.id === id; });
        if (t) { t.done = cb.checked; if (cb.checked) t.completed = Date.now(); saveState(); renderActivePane(); }
      };
      if (del) del.onclick = function () {
        prefs.todos = prefs.todos.filter(function (x) { return x.id !== id; });
        saveState();
        renderActivePane();
      };
    });
  }

  // ---- Reminders pane ----
  function autoReminders() {
    // Derive from upcoming bills (next 14 days)
    var s = getAppState();
    if (!s || !Array.isArray(s.recurringPayments)) return [];
    var now = Date.now();
    var horizon = 14 * 86400000;
    return s.recurringPayments.filter(function (p) {
      if (!p.nextDate) return false;
      var d = new Date(p.nextDate.length >= 10 ? p.nextDate + 'T00:00:00' : p.nextDate);
      if (isNaN(d.getTime())) return false;
      var diff = d.getTime() - now;
      return diff > -86400000 && diff < horizon;
    }).map(function (p) {
      var d = new Date(p.nextDate.length >= 10 ? p.nextDate + 'T00:00:00' : p.nextDate);
      var diff = Math.round((d - new Date()) / 86400000);
      var when = diff < 0 ? Math.abs(diff) + 'd overdue' : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : 'In ' + diff + ' days';
      var cls = diff < 0 ? 'overdue' : diff === 0 ? 'today' : '';
      var icon = /credit|card/i.test(p.name) ? '💳' : /loan|sofi|aidvant|aidadvantage/i.test(p.name) ? '🏦' : /netflix|spotify/i.test(p.name) ? '🎬' : '💸';
      return {
        auto: true,
        title: p.name.replace(/\s*\(min payment\)\s*/i, ''),
        meta: 'Due ' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + fmtUsd(p.amount || 0),
        when: when,
        cls: cls,
        icon: icon
      };
    }).sort(function (a, b) {
      // Overdue first, then by closeness
      var aOv = a.cls === 'overdue' ? -1 : 0;
      var bOv = b.cls === 'overdue' ? -1 : 0;
      return aOv - bOv;
    });
  }
  function renderRemindersPane(host) {
    var prefs = getPrefs();
    if (!prefs) return;
    var auto = autoReminders();
    var manual = prefs.reminders || [];
    var html =
      '<div class="pl-card">' +
        '<div class="pl-card-head"><h2>Upcoming bill reminders</h2><div class="pl-row-meta">Next 14 days — auto from your recurring payments</div></div>';
    if (!auto.length) {
      html += '<div class="pl-empty"><span class="pl-empty-icon">⏰</span>No bills due in the next 14 days. Nice runway.</div>';
    } else {
      html += auto.map(function (r) {
        return '<div class="pl-rem ' + r.cls + '">' +
          '<div class="pl-rem-icon">' + r.icon + '</div>' +
          '<div class="pl-rem-body">' +
            '<div class="pl-rem-title">' + escapeHtml(r.title) + '</div>' +
            '<div class="pl-rem-meta">' + escapeHtml(r.meta) + '</div>' +
          '</div>' +
          '<div class="pl-rem-when">' + escapeHtml(r.when) + '</div>' +
        '</div>';
      }).join('');
    }
    html += '</div>';
    // Manual reminders
    html += '<div class="pl-card">' +
      '<div class="pl-card-head"><h2>My reminders</h2></div>' +
      '<div class="pl-quick">' +
        '<input id="pl-rem-text" type="text" class="pl-input" placeholder="Reminder (e.g. Review credit report)" />' +
        '<input id="pl-rem-date" type="date" class="pl-input" style="max-width:160px;" />' +
        '<button id="pl-rem-add" class="pl-btn pl-btn-pri">Add</button>' +
      '</div>';
    if (!manual.length) {
      html += '<div class="pl-empty"><span class="pl-empty-icon">📌</span>Add a one-off reminder. It\'ll show here until you remove it.</div>';
    } else {
      html += manual.map(function (r) {
        var d = r.date ? new Date(r.date + 'T00:00:00') : null;
        var when = d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
        return '<div class="pl-row" data-rem-id="' + escapeHtml(r.id) + '">' +
          '<div class="pl-row-text">' + escapeHtml(r.text) + '</div>' +
          '<div class="pl-row-meta">' + escapeHtml(when) + '</div>' +
          '<button class="pl-del">✕</button>' +
        '</div>';
      }).join('');
    }
    html += '</div>';
    host.innerHTML = html;
    var addBtn = document.getElementById('pl-rem-add');
    if (addBtn) addBtn.onclick = function () {
      var txt = (document.getElementById('pl-rem-text').value || '').trim();
      var date = document.getElementById('pl-rem-date').value || '';
      if (!txt) return;
      prefs.reminders.unshift({ id: 'r' + Date.now(), text: txt, date: date });
      saveState();
      renderActivePane();
    };
    host.querySelectorAll('.pl-row .pl-del').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('.pl-row');
        var id = row.dataset.remId;
        prefs.reminders = prefs.reminders.filter(function (x) { return x.id !== id; });
        saveState();
        renderActivePane();
      };
    });
  }

  // ---- Notes pane ----
  function renderNotesPane(host) {
    var s = getAppState();
    if (!s) return;
    if (!Array.isArray(s.notes)) s.notes = [];
    var notes = s.notes;
    var html =
      '<div class="pl-card">' +
        '<div class="pl-card-head"><h2>Notes</h2></div>' +
        '<div class="pl-quick">' +
          '<input id="pl-note-title" type="text" class="pl-input" placeholder="Note title" style="max-width:260px;" />' +
          '<input id="pl-note-body" type="text" class="pl-input" placeholder="What\'s on your mind?" />' +
          '<button id="pl-note-add" class="pl-btn pl-btn-pri">Add</button>' +
        '</div>';
    if (!notes.length) {
      html += '<div class="pl-empty"><span class="pl-empty-icon">📝</span>Quick notes for ideas, callbacks, journal entries — anything you want to remember.</div>';
    } else {
      html += notes.slice().reverse().map(function (n) {
        return '<div class="pl-row" data-note-id="' + escapeHtml(n.id) + '" style="flex-direction:column;align-items:stretch;gap:6px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
            '<div style="font-weight:800;font-size:13.5px;">' + escapeHtml(n.title || 'Untitled') + '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;">' +
              '<div class="pl-row-meta">' + new Date(n.created || Date.now()).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) + '</div>' +
              '<button class="pl-del">✕</button>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:12.5px;color:var(--ink-dim,#6b7280);line-height:1.5;white-space:pre-wrap;">' + escapeHtml(n.body || '') + '</div>' +
        '</div>';
      }).join('');
    }
    html += '</div>';
    host.innerHTML = html;
    var addBtn = document.getElementById('pl-note-add');
    if (addBtn) addBtn.onclick = function () {
      var title = (document.getElementById('pl-note-title').value || '').trim();
      var body = (document.getElementById('pl-note-body').value || '').trim();
      if (!title && !body) return;
      s.notes.push({ id: 'n' + Date.now(), title: title, body: body, created: Date.now() });
      saveState();
      renderActivePane();
    };
    host.querySelectorAll('.pl-row .pl-del').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('.pl-row');
        var id = row.dataset.noteId;
        s.notes = s.notes.filter(function (x) { return x.id !== id; });
        saveState();
        renderActivePane();
      };
    });
  }

  // ---- Weekly review pane ----
  function renderReviewPane(host) {
    var prefs = getPrefs();
    if (!prefs) return;
    var thisWeek = isoWeekKey(new Date());
    var current = prefs.reviews[thisWeek] || { wins: '', struggles: '', next: '' };
    var html =
      '<div class="pl-card">' +
        '<div class="pl-card-head"><h2>This week — ' + thisWeek + '</h2></div>' +
        '<div style="display:grid;grid-template-columns:1fr;gap:14px;">' +
          '<div>' +
            '<label style="font-size:11px;font-weight:800;color:#1f7a4a;letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:6px;">🎉 Wins</label>' +
            '<textarea class="pl-input" id="pl-rv-wins" placeholder="What went well? Cleared a debt? Stuck to your budget?">' + escapeHtml(current.wins) + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;font-weight:800;color:#c0594a;letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:6px;">⚠️ Struggles</label>' +
            '<textarea class="pl-input" id="pl-rv-struggles" placeholder="What tripped you up? Overspending? Missed a payment?">' + escapeHtml(current.struggles) + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;font-weight:800;color:#c99a2a;letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:6px;">🎯 One thing for next week</label>' +
            '<textarea class="pl-input" id="pl-rv-next" placeholder="One concrete action that would move the needle.">' + escapeHtml(current.next) + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px;display:flex;justify-content:flex-end;">' +
          '<button id="pl-rv-save" class="pl-btn pl-btn-pri">Save review</button>' +
        '</div>' +
      '</div>';
    // History
    var keys = Object.keys(prefs.reviews).sort().reverse().filter(function (k) { return k !== thisWeek; });
    if (keys.length) {
      html += '<div class="pl-card"><div class="pl-card-head"><h2>Past reviews</h2></div>';
      keys.slice(0, 8).forEach(function (k) {
        var r = prefs.reviews[k] || {};
        html += '<div class="pl-row" style="flex-direction:column;align-items:stretch;gap:4px;padding:14px 16px;">' +
          '<div style="font-weight:800;">' + escapeHtml(k) + '</div>' +
          (r.wins ? '<div style="font-size:12px;"><b style="color:#1f7a4a;">Wins:</b> ' + escapeHtml(r.wins) + '</div>' : '') +
          (r.struggles ? '<div style="font-size:12px;"><b style="color:#c0594a;">Struggles:</b> ' + escapeHtml(r.struggles) + '</div>' : '') +
          (r.next ? '<div style="font-size:12px;"><b style="color:#c99a2a;">Next:</b> ' + escapeHtml(r.next) + '</div>' : '') +
        '</div>';
      });
      html += '</div>';
    }
    host.innerHTML = html;
    var saveBtn = document.getElementById('pl-rv-save');
    if (saveBtn) saveBtn.onclick = function () {
      prefs.reviews[thisWeek] = {
        wins: document.getElementById('pl-rv-wins').value || '',
        struggles: document.getElementById('pl-rv-struggles').value || '',
        next: document.getElementById('pl-rv-next').value || '',
        savedAt: Date.now()
      };
      saveState();
      toast('Weekly review saved.');
    };
  }

  // v4: Hero stats — small summary metrics rendered under the title
  function renderHeroStats() {
    var host = document.getElementById('pl-hero-stats');
    if (!host) return;
    var s = getAppState() || {};
    var prefs = getPrefs() || { todos: [], reminders: [], reviews: {} };
    var goals = Array.isArray(s.goals) ? s.goals : [];
    var notes = Array.isArray(s.notes) ? s.notes : [];
    var pendingTodos = prefs.todos.filter(function (t) { return !t.done; }).length;
    var auto = autoReminders();
    var overdue = auto.filter(function (r) { return r.cls === 'overdue'; }).length;
    var hasReviewThisWeek = !!(prefs.reviews && prefs.reviews[isoWeekKey(new Date())] && (prefs.reviews[isoWeekKey(new Date())].wins || prefs.reviews[isoWeekKey(new Date())].next));
    host.innerHTML =
      '<div class="pl-hs-card"><div class="pl-hs-num">' + goals.length + '</div><div class="pl-hs-lbl">Goals</div></div>' +
      '<div class="pl-hs-card"><div class="pl-hs-num">' + pendingTodos + '</div><div class="pl-hs-lbl">Open to-dos</div></div>' +
      '<div class="pl-hs-card ' + (overdue > 0 ? 'pl-hs-warn' : '') + '"><div class="pl-hs-num">' + auto.length + '</div><div class="pl-hs-lbl">Bills · 14d</div>' + (overdue > 0 ? '<div class="pl-hs-flag">' + overdue + ' overdue</div>' : '') + '</div>' +
      '<div class="pl-hs-card"><div class="pl-hs-num">' + notes.length + '</div><div class="pl-hs-lbl">Notes</div></div>' +
      '<div class="pl-hs-card ' + (hasReviewThisWeek ? 'pl-hs-ok' : '') + '"><div class="pl-hs-num">' + (hasReviewThisWeek ? '\u2713' : '\u2014') + '</div><div class="pl-hs-lbl">Review</div></div>';
  }

  // v4: AI Coach pane — assesses the planner and gives tailored suggestions
  function renderCoachPane(host) {
    var s = getAppState() || {};
    var prefs = getPrefs() || { todos: [], reminders: [], reviews: {} };
    var goals = Array.isArray(s.goals) ? s.goals : [];
    var notes = Array.isArray(s.notes) ? s.notes : [];
    var debts = Array.isArray(s.debts) ? s.debts : [];
    var auto = autoReminders();
    var pendingTodos = prefs.todos.filter(function (t) { return !t.done; });
    var oldTodos = pendingTodos.filter(function (t) { return t.created && Date.now() - t.created > 21 * 86400000; });
    var weekKey = isoWeekKey(new Date());
    var thisReview = (prefs.reviews && prefs.reviews[weekKey]) || null;

    // Compute a planner-health score (0..100)
    var score = 0;
    var checks = [];
    if (goals.length > 0) { score += 20; checks.push({ ok: true, text: 'You\'ve set at least one financial goal' }); }
    else checks.push({ ok: false, text: 'No goals defined yet — even one anchors your plan' });
    if (pendingTodos.length > 0 && pendingTodos.length <= 10) { score += 15; checks.push({ ok: true, text: pendingTodos.length + ' active to-dos — a manageable list' }); }
    else if (pendingTodos.length === 0) checks.push({ ok: false, text: 'No to-dos — capture the financial admin work in your head' });
    else checks.push({ ok: false, text: pendingTodos.length + ' open to-dos — too many in flight; pick 3 to finish this week' });
    if (auto.filter(function (r) { return r.cls === 'overdue'; }).length === 0) { score += 20; checks.push({ ok: true, text: 'Nothing overdue right now' }); }
    else checks.push({ ok: false, text: auto.filter(function(r){return r.cls==='overdue';}).length + ' overdue bills — handle these today' });
    if (notes.length > 0) { score += 10; checks.push({ ok: true, text: notes.length + ' note' + (notes.length === 1 ? '' : 's') + ' captured' }); }
    else checks.push({ ok: false, text: 'No notes — use them to capture callbacks, vendor names, due-date changes' });
    if (thisReview && (thisReview.wins || thisReview.next)) { score += 25; checks.push({ ok: true, text: 'Weekly review written for ' + weekKey }); }
    else checks.push({ ok: false, text: 'Weekly review not started — 3 minutes on Sunday compounds over the year' });
    if (oldTodos.length === 0) { score += 10; checks.push({ ok: true, text: 'No stale to-dos (older than 3 weeks)' }); }
    else checks.push({ ok: false, text: oldTodos.length + ' to-do' + (oldTodos.length === 1 ? '' : 's') + ' older than 3 weeks — kill or commit' });

    // Generate suggestions
    var suggestions = [];
    if (goals.length === 0 && debts.length > 0) {
      var hot = debts.slice().sort(function (a, b) { return (b.apr || 0) - (a.apr || 0); })[0];
      if (hot) suggestions.push({
        emoji: '🎯',
        title: 'Set your first goal: clear ' + hot.name,
        body: 'Your highest-APR debt at ' + (hot.apr || 0) + '% costs you the most every month it sits. A target like "pay off ' + hot.name + ' by Q4" turns the dashboard from informational into directional.',
        action: 'Add goal'
      });
    }
    if (auto.filter(function (r) { return r.cls === 'overdue'; }).length > 0) {
      suggestions.push({
        emoji: '🚨',
        title: 'Clear overdue bills first',
        body: 'You have payments past their due date. Late fees and interest stack up fast — these belong at the top of your to-do list today.',
        action: 'Review reminders'
      });
    }
    if (oldTodos.length >= 3) {
      suggestions.push({
        emoji: '🧹',
        title: 'Prune stale to-dos',
        body: oldTodos.length + ' items have been pending for 3+ weeks. If they\'re still relevant, schedule a date. If not, delete them. Stale lists become invisible.',
        action: 'Open to-do'
      });
    }
    if (!thisReview || !(thisReview.wins || thisReview.next)) {
      suggestions.push({
        emoji: '🪞',
        title: 'Write your weekly review',
        body: 'A short review (Wins / Struggles / One next move) is the highest-ROI 3-minute exercise in personal finance. Patterns become impossible to miss.',
        action: 'Open review'
      });
    }
    var clusters = bigClusterDays(auto);
    if (clusters.length) {
      suggestions.push({
        emoji: '⚖️',
        title: 'Smooth your due-date cluster',
        body: 'You have ' + clusters[0].count + ' bills due on the ' + clusters[0].dom + ordinalSuffix(clusters[0].dom) + ' totaling ' + fmtUsd(clusters[0].total) + '. Call one issuer to shift their due date 7-10 days — the cash flow eases instantly.',
        action: 'See calendar'
      });
    }
    if (pendingTodos.length > 7) {
      suggestions.push({
        emoji: '🎯',
        title: 'Pick 3 wins this week',
        body: pendingTodos.length + ' open to-dos is a lot. Star three you commit to closing by Sunday. The rest can wait. Focus beats volume.',
        action: 'Open to-do'
      });
    }
    if (suggestions.length === 0) {
      suggestions.push({
        emoji: '🎉',
        title: 'You\'re in great shape',
        body: 'Goals tracked, to-dos manageable, bills current, review written. Keep momentum — your future self thanks you.',
        action: null
      });
    }

    // Build HTML
    var scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#1f7a4a' : score >= 40 ? '#c99a2a' : '#dc2626';
    var scoreLabel = score >= 80 ? 'Strong' : score >= 60 ? 'Solid' : score >= 40 ? 'Needs work' : 'Reset needed';

    var html =
      '<div class="pl-coach-top">' +
        '<div class="pl-coach-score" style="--ring:' + scoreColor + ';">' +
          '<div class="pl-coach-score-num" style="color:' + scoreColor + ';">' + score + '</div>' +
          '<div class="pl-coach-score-lbl">PLAN HEALTH</div>' +
          '<div class="pl-coach-score-band" style="color:' + scoreColor + ';">' + scoreLabel + '</div>' +
        '</div>' +
        '<div class="pl-coach-summary">' +
          '<div class="pl-coach-title">How your plan looks today</div>' +
          '<div class="pl-coach-checks">' +
            checks.map(function (c) {
              return '<div class="pl-coach-check ' + (c.ok ? 'ok' : 'todo') + '">' +
                '<span class="pl-coach-check-icon">' + (c.ok ? '\u2713' : '\u2022') + '</span>' +
                '<span>' + escapeHtml(c.text) + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="pl-card">' +
        '<div class="pl-card-head"><h2>\u2728 Suggestions to make this plan more effective</h2></div>' +
        suggestions.map(function (sug) {
          return '<div class="pl-coach-sug">' +
            '<div class="pl-coach-sug-emoji">' + sug.emoji + '</div>' +
            '<div class="pl-coach-sug-body">' +
              '<div class="pl-coach-sug-title">' + escapeHtml(sug.title) + '</div>' +
              '<div class="pl-coach-sug-text">' + escapeHtml(sug.body) + '</div>' +
              (sug.action ? '<button class="pl-btn pl-btn-pri pl-coach-sug-cta" data-action="' + sug.action + '">' + escapeHtml(sug.action) + ' \u2192</button>' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +

      '<div class="pl-card pl-coach-chat">' +
        '<div class="pl-card-head"><h2>Ask the AI Coach about your plan</h2></div>' +
        '<div class="pl-row-meta" style="margin-bottom:10px;">Pre-loaded with your goals, to-dos, reminders, notes, and this week\'s review.</div>' +
        '<button id="pl-coach-ask" class="pl-btn pl-btn-pri" style="font-size:13px;padding:11px 20px;">\u2728 Open AI Coach with planner context</button>' +
      '</div>';

    host.innerHTML = html;

    // Wire suggestion CTAs
    host.querySelectorAll('.pl-coach-sug-cta').forEach(function (btn) {
      btn.onclick = function () {
        var a = btn.dataset.action || '';
        var lower = a.toLowerCase();
        if (lower.indexOf('goal') !== -1) openAddGoal();
        else if (lower.indexOf('reminder') !== -1) jumpTo('reminders');
        else if (lower.indexOf('to-do') !== -1) jumpTo('todos');
        else if (lower.indexOf('review') !== -1) jumpTo('review');
        else if (lower.indexOf('calendar') !== -1) {
          // Send user to the recurring tab
          var rec = document.querySelector('[data-page="recurring"]');
          if (rec) rec.click();
        }
      };
    });

    var askBtn = document.getElementById('pl-coach-ask');
    if (askBtn) askBtn.onclick = function () {
      var prompt = buildCoachPrompt();
      try {
        var fab = document.getElementById('ai-chat-fab');
        var panel = document.getElementById('ai-chat-panel');
        if (panel && !panel.classList.contains('active') && fab) fab.click();
        setTimeout(function () {
          if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
            window.WJP_ChatCore.send(prompt);
            return;
          }
          var input = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
          if (input) {
            input.value = prompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            var sendBtn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
            if (sendBtn) sendBtn.click();
          }
        }, 350);
      } catch (e) { try { console.warn('[wjp-planner-coach]', e); } catch (_) {} }
    };
  }

  function jumpTo(paneName) {
    var btn = document.querySelector('#page-planner .pl-tab[data-pane="' + paneName + '"]');
    if (btn) { btn.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
  function ordinalSuffix(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    var m = n % 10;
    return m === 1 ? 'st' : m === 2 ? 'nd' : m === 3 ? 'rd' : 'th';
  }
  function bigClusterDays(reminders) {
    var byDom = {};
    reminders.forEach(function (r) {
      // r is from autoReminders — extract day-of-month from meta string
      var m = (r.meta || '').match(/(\w{3}) (\d+)/);
      if (!m) return;
      var dom = parseInt(m[2], 10);
      if (!isFinite(dom)) return;
      if (!byDom[dom]) byDom[dom] = { dom: dom, count: 0, total: 0 };
      byDom[dom].count++;
      var amtMatch = (r.meta || '').match(/\$([\d,]+)/);
      if (amtMatch) byDom[dom].total += parseFloat(amtMatch[1].replace(/,/g, '')) || 0;
    });
    return Object.values(byDom).filter(function (x) { return x.count >= 3; }).sort(function (a, b) { return b.count - a.count; });
  }
  function buildCoachPrompt() {
    var s = getAppState() || {};
    var prefs = getPrefs() || { todos: [], reminders: [], reviews: {} };
    var goals = Array.isArray(s.goals) ? s.goals : [];
    var pendingTodos = prefs.todos.filter(function (t) { return !t.done; });
    var auto = autoReminders();
    var weekKey = isoWeekKey(new Date());
    var thisReview = (prefs.reviews && prefs.reviews[weekKey]) || {};

    var parts = ['Here\'s my financial planner state. Help me make this plan more efficient. Be concrete.'];
    if (goals.length) {
      parts.push('GOALS:');
      goals.forEach(function (g) {
        parts.push('- ' + g.name + ' — ' + fmtUsd(g.saved || 0) + ' / ' + fmtUsd(g.target || 0) + (g.deadline ? ' (target ' + g.deadline + ')' : ''));
      });
    } else parts.push('GOALS: none set yet.');
    if (pendingTodos.length) {
      parts.push('OPEN TO-DOS (' + pendingTodos.length + '):');
      pendingTodos.slice(0, 10).forEach(function (t) { parts.push('- ' + t.text); });
    }
    if (auto.length) {
      parts.push('UPCOMING BILLS (next 14d):');
      auto.slice(0, 8).forEach(function (r) { parts.push('- ' + r.title + ' — ' + r.when); });
    }
    if (thisReview && (thisReview.wins || thisReview.struggles || thisReview.next)) {
      parts.push('THIS WEEK\'S REVIEW (' + weekKey + '):');
      if (thisReview.wins) parts.push('Wins: ' + thisReview.wins);
      if (thisReview.struggles) parts.push('Struggles: ' + thisReview.struggles);
      if (thisReview.next) parts.push('Next: ' + thisReview.next);
    }
    parts.push('Give me 3 specific moves I can make this week, in priority order, to improve the plan.');
    return parts.join('\n');
  }

  // --- Boot ---  // --- Boot ---
  function boot() {
    injectStyle();
    function tick() {
      try { injectSidebarItem(); } catch (_) {}
      try { hideOldNavItems(); } catch (_) {}
    }
    tick();
    setInterval(tick, 3000);
    // If URL hash points to planner, open it
    if (location.hash === '#planner') showPlanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_Planner = {
    show: showPlanner,
    version: 1
  };
})();
