/* wjp-goals.js v6 — fix navigation properly: detect host active page, restore inline display
 *
 * New sidebar tab + page. Lets users define savings goals (emergency fund,
 * down payment, wedding, car, vacation, education, custom). Each goal has:
 *   - target amount + target date
 *   - saved so far (manual or linked)
 *   - planned monthly contribution
 *   - computed projected hit date based on current pace
 *   - status: on-track / behind / ahead / complete
 *
 * Storage: user-scoped wjp.goals.v1 — { byId: {...}, order: [ids] }
 */
(function () {
  'use strict';
  if (window._wjpGoalsInstalled) return;
  window._wjpGoalsInstalled = true;

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }
  function isDark() { try { return document.body.classList.contains('dark'); } catch (_) { return false; } }
  function userKey(b) {
    if (window.WJP_UserScope && typeof window.WJP_UserScope.scopeKey === 'function') return window.WJP_UserScope.scopeKey(b);
    return b;
  }
  function loadJSON(k, def) { try { var v = localStorage.getItem(userKey(k)); return v ? JSON.parse(v) : def; } catch (_) { return def; } }
  function saveJSON(k, v) { try { localStorage.setItem(userKey(k), JSON.stringify(v)); } catch (_) {} }

  var STORE_KEY = 'wjp.goals.v1';
  var PAGE_ID = 'page-goals';
  var NAV_ID = 'nav-goals-wjp';

  function fmtUSD(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function fmtDate(d) {
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
    catch (_) { return ''; }
  }
  function escapeHTML(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function uuid() { return 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  // ---------- Templates (categories with sensible defaults) ----------
  // v3: each template has an AI Coach hint + a default financing split.
  var TEMPLATES = [
    { key: 'emergency', label: 'Emergency Fund',     icon: 'ph-fill ph-shield-check', color: '#10b981', defaultAmt: 5000,  defaultMo: 6,  financePct: 0,
      coach: 'Aim for 3-6 months of essential expenses. Park it in a high-yield savings account (4-5% APY) so it grows while you sleep — but stays liquid.' },
    { key: 'house',     label: 'House Down Payment', icon: 'ph-fill ph-house',        color: '#3b82f6', defaultAmt: 30000, defaultMo: 36, financePct: 20,
      coach: 'Conventional loans want 20% down to skip PMI. FHA accepts 3.5%. Plan for down payment + 3% closing costs; the rest is mortgaged.' },
    { key: 'car',       label: 'Car',                icon: 'ph-fill ph-car',          color: '#f59e0b', defaultAmt: 10000, defaultMo: 18, financePct: 20,
      coach: 'Save 20% down to keep monthly payments under 10% of take-home and avoid being underwater. Higher down = lower APR offered.' },
    { key: 'wedding',   label: 'Wedding',            icon: 'ph-fill ph-heart',        color: '#ec4899', defaultAmt: 25000, defaultMo: 18, financePct: 0,
      coach: 'US median wedding is $20K. Pay cash — wedding debt is the #1 source of first-year marital stress. Venue + ring + photo are the big rocks.' },
    { key: 'vacation',  label: 'Vacation',           icon: 'ph-fill ph-airplane-tilt',color: '#06b6d4', defaultAmt: 3000,  defaultMo: 6,  financePct: 0,
      coach: 'Pay cash, never finance. Book flights 6-8 weeks out domestic, 3-5 months international. Use a travel rewards card, pay it off same week.' },
    { key: 'education', label: 'Education',          icon: 'ph-fill ph-graduation-cap',color:'#a855f7', defaultAmt: 10000, defaultMo: 12, financePct: 50,
      coach: 'Federal subsidized loans first (deferred interest), then unsubsidized, then private. Keep total loans under projected first-year salary.' },
    { key: 'baby',      label: 'New Baby',           icon: 'ph-fill ph-baby',         color: '#f472b6', defaultAmt: 8000,  defaultMo: 9,  financePct: 0,
      coach: 'Hospital + first-year baseline runs $8-15K. Build buffer BEFORE the bump because saving with a newborn is brutal.' },
    { key: 'custom',    label: 'Custom Goal',        icon: 'ph-fill ph-target',       color: '#64748b', defaultAmt: 1000,  defaultMo: 6,  financePct: 0,
      coach: 'Pick a target, a date, a monthly. The runway will tell you if you can hit it. Adjust either side as you learn.' }
  ];

  function templateByKey(k) { return TEMPLATES.find(function (t) { return t.key === k; }) || TEMPLATES[TEMPLATES.length - 1]; }

  function loadGoals() {
    var rec = loadJSON(STORE_KEY, { byId: {}, order: [] });
    if (!rec.byId) rec = { byId: {}, order: [] };
    return rec;
  }
  function saveGoals(rec) { saveJSON(STORE_KEY, rec); }

  function projectGoal(g) {
    var saved = Number(g.savedSoFar) || 0;
    var target = Number(g.targetAmount) || 0;
    var monthly = Number(g.monthlyContribution) || 0;
    var remaining = Math.max(0, target - saved);
    var pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
    var monthsToHitAtPace = (monthly > 0) ? Math.ceil(remaining / monthly) : Infinity;
    var projectedHit = null;
    if (monthlyContribIsFinite(monthly) && monthsToHitAtPace !== Infinity) {
      projectedHit = new Date();
      projectedHit.setMonth(projectedHit.getMonth() + monthsToHitAtPace);
    }
    var targetDate = g.targetDate ? new Date(g.targetDate) : null;
    var monthsToTarget = targetDate ? Math.max(1, Math.round((targetDate - new Date()) / (30 * 86400000))) : Infinity;
    var requiredMonthly = monthsToTarget !== Infinity ? Math.max(0, remaining / monthsToTarget) : remaining;
    var status;
    if (saved >= target) status = 'complete';
    else if (monthly === 0) status = 'inactive';
    else if (projectedHit && targetDate && projectedHit <= targetDate) status = 'on-track';
    else if (projectedHit && targetDate && projectedHit > targetDate) status = 'behind';
    else status = 'no-deadline';
    return {
      remaining: remaining, pct: pct, monthsToHitAtPace: monthsToHitAtPace,
      projectedHit: projectedHit, requiredMonthly: requiredMonthly,
      monthsToTarget: monthsToTarget, status: status
    };
  }
  function monthlyContribIsFinite(m) { return typeof m === 'number' && isFinite(m) && m > 0; }

  // ---------- Sidebar item injection ----------
  function ensureNavItem() {
    if (document.getElementById(NAV_ID)) return;
    // Find a host sidebar nav-item to clone its styling
    var calendarNav = document.querySelector('.nav-item[data-page="recurring"]');
    if (!calendarNav || !calendarNav.parentNode) return;
    var nav = document.createElement('div');
    nav.id = NAV_ID;
    nav.className = calendarNav.className.replace(/active/g, '').trim();
    nav.setAttribute('data-page', 'goals-wjp');
    nav.innerHTML = '<i class="ph ph-target" style="margin-right:8px;"></i>Goals';
    // Insert AFTER Calendar
    if (calendarNav.nextSibling) calendarNav.parentNode.insertBefore(nav, calendarNav.nextSibling);
    else calendarNav.parentNode.appendChild(nav);
    nav.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      showGoalsPage();
    });
  }

  function showGoalsPage() {
    // Hide all host pages
    // v5: remove .active to deactivate other pages; don't set inline display.
    // Inline display:none would beat the host's .page.active CSS rule when user
    // navigates back, leaving them stuck on a blank page.
    Array.from(document.querySelectorAll('[id^="page-"]')).forEach(function (p) {
      if (p.id !== PAGE_ID) {
        p.classList.remove('active');
        // Set inline display so they hide immediately, but our tick() clears it
        // the moment another host nav activates.
        p.style.display = 'none';
        p.dataset.wjpDeactivated = '1';
      }
    });
    // Mark our nav active, others inactive
    Array.from(document.querySelectorAll('.nav-item')).forEach(function (n) { n.classList.remove('active'); });
    var nav = document.getElementById(NAV_ID);
    if (nav) nav.classList.add('active');
    // Ensure page exists
    var page = document.getElementById(PAGE_ID);
    if (!page) {
      page = document.createElement('div');
      page.id = PAGE_ID;
      page.className = 'page active';
      page.style.cssText = 'padding:24px 24px 80px;max-width:1400px;margin:0 auto;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;';
      // Find content-area and append
      var contentArea = document.querySelector('.content-area, main, .main-area');
      if (contentArea) contentArea.appendChild(page);
      else document.body.appendChild(page);
    }
    page.style.display = 'block';
    page.classList.add('active');
    renderPage(page);
  }

  // ---------- Page render ----------
  function renderPage(page) {
    var rec = loadGoals();
    var ids = rec.order && rec.order.length ? rec.order : Object.keys(rec.byId);
    var goals = ids.map(function (id) { return rec.byId[id]; }).filter(Boolean);

    var totalSaved = goals.reduce(function (s, g) { return s + (Number(g.savedSoFar) || 0); }, 0);
    var totalTarget = goals.reduce(function (s, g) { return s + (Number(g.targetAmount) || 0); }, 0);
    var totalMonthly = goals.reduce(function (s, g) { return s + (Number(g.monthlyContribution) || 0); }, 0);

    var heroHTML = ''
      + '<div style="margin-bottom:18px;">'
      +   '<div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Plan for a Purchase</div>'
      +   '<h1 style="font-size:30px;font-weight:900;letter-spacing:-0.02em;margin:4px 0 6px;color:var(--text-1,#0a0a0a);">Goals</h1>'
      +   '<p style="font-size:13px;color:var(--text-3,#94a3b8);font-weight:500;max-width:640px;margin:0;line-height:1.5;">Set a target, pick a date, and watch the runway recalculate every time you save. Each goal flows into your Budgets allocation.</p>'
      + '</div>';

    var summaryHTML = goals.length ? ''
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px;">'
      +   summaryCard('Total saved', fmtUSD(totalSaved), 'ph-fill ph-piggy-bank', '#10b981')
      +   summaryCard('Total target', fmtUSD(totalTarget), 'ph-fill ph-target', '#3b82f6')
      +   summaryCard('Monthly going in', fmtUSD(totalMonthly), 'ph-fill ph-arrow-circle-up', '#a855f7')
      +   summaryCard('Active goals', String(goals.length), 'ph-fill ph-list-checks', '#f59e0b')
      + '</div>' : '';

    var goalCardsHTML = goals.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">' + goals.map(goalCardHTML).join('') + '</div>'
      : emptyStateHTML();

    var addBtnHTML = ''
      + '<div style="display:flex;justify-content:flex-end;margin-bottom:18px;">'
      +   '<button id="wjp-goal-add-btn" type="button" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:0;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(16,185,129,0.30);"><i class="ph-fill ph-plus-circle" style="font-size:16px;"></i>New Goal</button>'
      + '</div>';

    page.innerHTML = heroHTML + summaryHTML + addBtnHTML + goalCardsHTML;

    // Wire add button
    var addBtn = page.querySelector('#wjp-goal-add-btn');
    if (addBtn) addBtn.onclick = openTemplatePicker;

    // Wire per-goal buttons (delete, edit)
    Array.from(page.querySelectorAll('[data-goal-action]')).forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = b.getAttribute('data-goal-action');
        var id = b.getAttribute('data-goal-id');
        if (action === 'delete' && confirm('Delete this goal?')) {
          var r = loadGoals();
          delete r.byId[id];
          r.order = (r.order || []).filter(function (x) { return x !== id; });
          saveGoals(r); renderPage(page);
        } else if (action === 'edit') {
          openGoalEditor(id);
        }
      });
    });

    // Wire per-goal sliders (Save quick-update)
    Array.from(page.querySelectorAll('input[data-goal-saved]')).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var id = inp.getAttribute('data-goal-saved');
        var r = loadGoals();
        if (r.byId[id]) {
          r.byId[id].savedSoFar = parseFloat(inp.value) || 0;
          r.byId[id].updatedAt = Date.now();
          saveGoals(r); renderPage(page);
        }
      });
    });
  }

  function summaryCard(label, value, icon, color) {
    return ''
      + '<div style="padding:14px 16px;background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:12px;display:flex;align-items:center;gap:12px;">'
      +   '<div style="width:36px;height:36px;border-radius:9px;background:' + color + '22;display:grid;place-items:center;color:' + color + ';"><i class="' + icon + '" style="font-size:18px;"></i></div>'
      +   '<div><div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + label + '</div><div style="font-size:17px;font-weight:900;color:var(--text-1,#0a0a0a);letter-spacing:-0.01em;margin-top:2px;">' + value + '</div></div>'
      + '</div>';
  }

  function goalCardHTML(g) {
    var tpl = templateByKey(g.category);
    var p = projectGoal(g);
    var statusBadge = (function () {
      switch (p.status) {
        case 'complete':    return '<span style="background:#10b98122;color:#10b981;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">✓ Complete</span>';
        case 'on-track':    return '<span style="background:#10b98122;color:#10b981;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">On Track</span>';
        case 'behind':      return '<span style="background:#ef444422;color:#ef4444;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">Behind</span>';
        case 'inactive':    return '<span style="background:#94a3b822;color:#94a3b8;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">No Monthly Yet</span>';
        case 'no-deadline': return '<span style="background:#3b82f622;color:#3b82f6;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:0.08em;text-transform:uppercase;">No Deadline</span>';
        default: return '';
      }
    })();
    var pctDisplay = Math.round(p.pct);
    var projectedCopy = p.projectedHit ? 'projected hit ' + fmtDate(p.projectedHit) : 'add monthly to project';
    var requiredCopy = g.targetDate && p.requiredMonthly > 0 ? fmtUSD(p.requiredMonthly) + '/mo to make it' : '';

    return ''
      + '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;">'
      // Header
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">'
      +   '<div style="display:flex;align-items:center;gap:10px;min-width:0;">'
      +     '<div style="width:36px;height:36px;border-radius:10px;background:' + tpl.color + '22;display:grid;place-items:center;color:' + tpl.color + ';flex-shrink:0;"><i class="' + tpl.icon + '" style="font-size:17px;"></i></div>'
      +     '<div style="min-width:0;"><div style="font-size:14.5px;font-weight:800;color:var(--text-1,#0a0a0a);letter-spacing:-0.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(g.name) + '</div><div style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">' + tpl.label + (g.targetDate ? ' · by ' + fmtDate(g.targetDate) : '') + (g.purchasePrice && g.financePct ? ' · ' + g.financePct + '% down on $' + Math.round(g.purchasePrice).toLocaleString() : '') + '</div></div>'
      +   '</div>'
      +   statusBadge
      + '</div>'
      // Progress
      + '<div>'
      +   '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;font-size:11px;font-weight:700;color:var(--text-3,#94a3b8);"><span>' + fmtUSD(g.savedSoFar) + ' of ' + fmtUSD(g.targetAmount) + '</span><span style="color:' + tpl.color + ';">' + pctDisplay + '%</span></div>'
      +   '<div style="height:8px;background:var(--card-2,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;"><div style="height:100%;width:' + pctDisplay + '%;background:linear-gradient(90deg,' + tpl.color + ',' + tpl.color + 'cc);border-radius:999px;transition:width 0.4s;"></div></div>'
      + '</div>'
      // Stats row
      + '<div style="display:flex;gap:14px;font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;flex-wrap:wrap;">'
      +   '<span><i class="ph-fill ph-arrow-circle-up" style="color:' + tpl.color + ';margin-right:3px;"></i>' + fmtUSD(g.monthlyContribution || 0) + '/mo current</span>'
      +   (requiredCopy ? '<span><i class="ph ph-warning-circle" style="color:#f59e0b;margin-right:3px;"></i>' + requiredCopy + '</span>' : '')
      +   '<span><i class="ph ph-calendar-check" style="color:#94a3b8;margin-right:3px;"></i>' + projectedCopy + '</span>'
      + '</div>'
      // Update saved bar
      + '<div style="display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--border,rgba(255,255,255,0.06));">'
      +   '<label style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:700;letter-spacing:0.04em;text-transform:uppercase;flex-shrink:0;">Update saved $</label>'
      +   '<input type="number" min="0" step="50" value="' + (g.savedSoFar || 0) + '" data-goal-saved="' + g.id + '" style="flex:1;min-width:0;padding:6px 10px;border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:6px;background:var(--card,#fff);color:var(--text-1,#0a0a0a);font-family:inherit;font-size:12px;font-weight:700;">'
      +   '<button data-goal-action="edit" data-goal-id="' + g.id + '" type="button" style="background:transparent;border:1px solid var(--border,rgba(255,255,255,0.15));color:var(--text-3,#94a3b8);padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Edit</button>'
      +   '<button data-goal-action="delete" data-goal-id="' + g.id + '" type="button" style="background:transparent;border:1px solid #ef444444;color:#ef4444;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Delete</button>'
      + '</div>'
      + '</div>';
  }

  function emptyStateHTML() {
    return ''
      + '<div style="text-align:center;padding:60px 20px;border:2px dashed var(--border,rgba(255,255,255,0.15));border-radius:16px;background:var(--card-2,rgba(255,255,255,0.03));">'
      + '<i class="ph-fill ph-target" style="font-size:48px;color:#10b981;opacity:0.5;display:block;margin-bottom:14px;"></i>'
      + '<div style="font-size:17px;font-weight:800;color:var(--text-1,#0a0a0a);margin-bottom:6px;">Pick your first goal</div>'
      + '<div style="font-size:12.5px;color:var(--text-3,#94a3b8);font-weight:600;line-height:1.5;max-width:380px;margin:0 auto 18px;">Emergency fund. Down payment. Wedding. Each goal gets a target, a date, and a real-time runway that updates as you save.</div>'
      + '<button id="wjp-goal-empty-cta" type="button" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:0;padding:11px 22px;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(16,185,129,0.30);">Choose a template</button>'
      + '</div>';
  }

  // ---------- Template picker modal ----------
  function openTemplatePicker() {
    closeAnyModal();
    var modal = document.createElement('div');
    modal.id = 'wjp-goal-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = ''
      + '<div style="background:var(--card,#fff);border-radius:16px;padding:24px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto;font-family:var(--sans,Inter,system-ui,sans-serif);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">'
      +   '<div><div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:#10b981;">START A GOAL</div><div style="font-size:18px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;">Pick a template</div></div>'
      +   '<button id="wjp-goal-modal-close" type="button" style="background:transparent;border:0;font-size:22px;color:var(--text-3,#94a3b8);cursor:pointer;line-height:1;">×</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">'
      +   TEMPLATES.map(function (t) {
            return '<button data-template="' + t.key + '" type="button" style="display:flex;align-items:center;gap:10px;padding:14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;cursor:pointer;font-family:inherit;text-align:left;transition:all 0.15s;">'
              + '<div style="width:36px;height:36px;border-radius:9px;background:' + t.color + '22;display:grid;place-items:center;color:' + t.color + ';flex-shrink:0;"><i class="' + t.icon + '" style="font-size:17px;"></i></div>'
              + '<div style="min-width:0;flex:1;"><div style="font-size:13px;font-weight:800;color:var(--text-1,#0a0a0a);">' + t.label + '</div><div style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:600;">' + fmtUSD(t.defaultAmt) + ' default · ' + t.defaultMo + ' months</div></div>'
              + '</button>';
          }).join('')
      + '</div>'
      + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeAnyModal(); });
    modal.querySelector('#wjp-goal-modal-close').onclick = closeAnyModal;
    Array.from(modal.querySelectorAll('[data-template]')).forEach(function (b) {
      b.onclick = function () { var key = b.getAttribute('data-template'); closeAnyModal(); openGoalEditor(null, key); };
    });
  }

  function closeAnyModal() {
    var m = document.getElementById('wjp-goal-modal');
    if (m) m.remove();
  }

  function openGoalEditor(id, templateKey) {
    closeAnyModal();
    var rec = loadGoals();
    var existing = id ? rec.byId[id] : null;
    var tpl = templateByKey(templateKey || (existing && existing.category) || 'custom');
    var goal = existing || {
      id: uuid(),
      category: tpl.key,
      name: tpl.label,
      targetAmount: tpl.defaultAmt,
      targetDate: (function () { var d = new Date(); d.setMonth(d.getMonth() + tpl.defaultMo); return d.toISOString().slice(0, 10); })(),
      savedSoFar: 0,
      monthlyContribution: Math.ceil(tpl.defaultAmt / tpl.defaultMo),
      purchasePrice: tpl.financePct > 0 ? Math.round(tpl.defaultAmt / (tpl.financePct / 100)) : 0,
      financePct: tpl.financePct || 0,
      createdAt: Date.now()
    };
    var isNew = !existing;

    var modal = document.createElement('div');
    modal.id = 'wjp-goal-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = ''
      + '<div style="background:var(--card,#fff);border-radius:16px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;font-family:var(--sans,Inter,system-ui,sans-serif);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">'
      +   '<div style="display:flex;align-items:center;gap:12px;"><div style="width:40px;height:40px;border-radius:10px;background:' + tpl.color + '22;display:grid;place-items:center;color:' + tpl.color + ';"><i class="' + tpl.icon + '" style="font-size:19px;"></i></div><div><div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:' + tpl.color + ';">' + (isNew ? 'NEW GOAL' : 'EDIT GOAL') + '</div><div style="font-size:17px;font-weight:900;color:var(--text-1,#0a0a0a);">' + tpl.label + '</div></div></div>'
      +   '<button id="wjp-goal-modal-close" type="button" style="background:transparent;border:0;font-size:22px;color:var(--text-3,#94a3b8);cursor:pointer;line-height:1;">×</button>'
      + '</div>'
      + (tpl.coach
          ? '<div style="background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.30);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-start;">'
            + '<div style="width:32px;height:32px;border-radius:9px;background:rgba(99,102,241,0.20);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-sparkle" style="font-size:15px;color:#818cf8;"></i></div>'
            + '<div style="flex:1;min-width:0;"><div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:#818cf8;text-transform:uppercase;margin-bottom:3px;">AI Coach</div><div style="font-size:11.5px;color:var(--text-1,#0a0a0a);font-weight:600;line-height:1.5;">' + escapeHTML(tpl.coach) + '</div></div>'
          + '</div>'
          : '')
      + '<div style="display:flex;flex-direction:column;gap:12px;">'
      +   field('Name', '<input id="wjp-goal-name" type="text" value="' + escapeHTML(goal.name) + '" style="' + inputCSS() + '">')
      +   (tpl.financePct > 0
            ? '<div style="background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;padding:12px 14px;">'
              + '<label style="display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;color:var(--text-1,#0a0a0a);cursor:pointer;margin-bottom:8px;"><input type="checkbox" id="wjp-goal-finance-on" ' + ((goal.financePct||0) > 0 ? 'checked' : '') + ' style="accent-color:#10b981;width:14px;height:14px;">Plan as a down-payment (finance the rest)</label>'
              + '<div id="wjp-goal-finance-section" style="display:' + ((goal.financePct||0) > 0 ? 'block' : 'none') + ';">'
              +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px;">'
              +     field('Total purchase price $', '<input id="wjp-goal-price" type="number" min="0" step="500" value="' + (goal.purchasePrice || tpl.defaultAmt) + '" style="' + inputCSS() + '">')
              +     field('Down payment %', '<input id="wjp-goal-pct" type="number" min="0" max="100" step="5" value="' + (goal.financePct || tpl.financePct) + '" style="' + inputCSS() + '">')
              +   '</div>'
              +   '<div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;line-height:1.5;"><i class="ph ph-info" style="margin-right:4px;"></i>Target $ below auto-fills from purchase × down %.</div>'
              + '</div>'
            + '</div>'
            : '')
      +   field('Target $', '<input id="wjp-goal-target" type="number" min="0" step="100" value="' + goal.targetAmount + '" style="' + inputCSS() + '">')
      +   field('Target date', '<input id="wjp-goal-date" type="date" value="' + (goal.targetDate || '') + '" style="' + inputCSS() + 'color-scheme:light dark;">')
      +   field('Saved so far $', '<input id="wjp-goal-saved" type="number" min="0" step="50" value="' + (goal.savedSoFar || 0) + '" style="' + inputCSS() + '">')
      +   field('Monthly contribution $', '<input id="wjp-goal-monthly" type="number" min="0" step="25" value="' + (goal.monthlyContribution || 0) + '" style="' + inputCSS() + '">')
      + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">'
      +   (isNew ? '' : '<button id="wjp-goal-delete" type="button" style="background:transparent;color:#ef4444;border:1px solid #ef444444;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;margin-right:auto;">Delete</button>')
      +   '<button id="wjp-goal-cancel" type="button" style="background:transparent;color:var(--text-3,#94a3b8);border:1px solid var(--border,rgba(255,255,255,0.15));padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>'
      +   '<button id="wjp-goal-save" type="button" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:0;padding:9px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">Save Goal</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeAnyModal(); });
    modal.querySelector('#wjp-goal-modal-close').onclick = closeAnyModal;
    modal.querySelector('#wjp-goal-cancel').onclick = closeAnyModal;
    var finOn = modal.querySelector('#wjp-goal-finance-on');
    var finSection = modal.querySelector('#wjp-goal-finance-section');
    var finPrice = modal.querySelector('#wjp-goal-price');
    var finPct = modal.querySelector('#wjp-goal-pct');
    var targetInp = modal.querySelector('#wjp-goal-target');
    function recalcTarget() {
      if (finOn && finOn.checked && finPrice && finPct && targetInp) {
        var p = parseFloat(finPrice.value) || 0;
        var pct = parseFloat(finPct.value) || 0;
        targetInp.value = Math.round(p * pct / 100);
      }
    }
    if (finOn) finOn.addEventListener('change', function () {
      if (finSection) finSection.style.display = finOn.checked ? 'block' : 'none';
      if (finOn.checked) recalcTarget();
    });
    if (finPrice) finPrice.addEventListener('input', recalcTarget);
    if (finPct) finPct.addEventListener('input', recalcTarget);

    modal.querySelector('#wjp-goal-save').onclick = function () {
      goal.name = (modal.querySelector('#wjp-goal-name').value || '').trim() || tpl.label;
      goal.targetAmount = parseFloat(modal.querySelector('#wjp-goal-target').value) || 0;
      goal.targetDate = modal.querySelector('#wjp-goal-date').value || null;
      goal.savedSoFar = parseFloat(modal.querySelector('#wjp-goal-saved').value) || 0;
      goal.monthlyContribution = parseFloat(modal.querySelector('#wjp-goal-monthly').value) || 0;
      goal.purchasePrice = finOn && finOn.checked ? (parseFloat(finPrice.value) || 0) : 0;
      goal.financePct = finOn && finOn.checked ? (parseFloat(finPct.value) || 0) : 0;
      goal.updatedAt = Date.now();
      var r = loadGoals();
      r.byId[goal.id] = goal;
      if (!r.order.includes(goal.id)) r.order.push(goal.id);
      saveGoals(r);
      closeAnyModal();
      var page = document.getElementById(PAGE_ID);
      if (page) renderPage(page);
    };
    var del = modal.querySelector('#wjp-goal-delete');
    if (del) del.onclick = function () {
      if (!confirm('Delete this goal?')) return;
      var r = loadGoals();
      delete r.byId[goal.id];
      r.order = (r.order || []).filter(function (x) { return x !== goal.id; });
      saveGoals(r);
      closeAnyModal();
      var page = document.getElementById(PAGE_ID);
      if (page) renderPage(page);
    };
  }
  function field(label, html) {
    return '<label style="display:flex;flex-direction:column;gap:4px;"><span style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + label + '</span>' + html + '</label>';
  }
  function inputCSS() {
    return 'padding:9px 12px;border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:8px;background:var(--card,#fff);color:var(--text-1,#0a0a0a);font-family:inherit;font-size:13px;font-weight:600;width:100%;box-sizing:border-box;';
  }

  // ---------- Empty-state CTA wiring (delegate at body level since it can vanish) ----------
  document.body.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#wjp-goal-empty-cta');
    if (t) { e.preventDefault(); openTemplatePicker(); }
  }, true);

  // ---------- Tick: keep nav item installed, intercept page navigation ----------
  function tick() {
    try {
      ensureNavItem();
      var ourNav = document.getElementById(NAV_ID);
      var ourPage = document.getElementById(PAGE_ID);
      var ourNavActive = ourNav && ourNav.classList.contains('active');
      var hostActiveNav = Array.from(document.querySelectorAll('.nav-item.active')).find(function (n) { return n.id !== NAV_ID; });
      var hostActivePage = Array.from(document.querySelectorAll('.page.active, [id^="page-"].active')).find(function (p) { return p.id !== PAGE_ID; });

      if (hostActiveNav || hostActivePage) {
        if (ourPage) { ourPage.style.display = 'none'; ourPage.classList.remove('active'); }
        if (ourNav) ourNav.classList.remove('active');
        Array.from(document.querySelectorAll('[id^="page-"]')).forEach(function (p) {
          if (p.id !== PAGE_ID && p.dataset.wjpDeactivated) {
            p.style.display = '';
            delete p.dataset.wjpDeactivated;
          }
        });
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 1500); });
  else setTimeout(tick, 1500);
  setInterval(tick, 1500);

  window.WJP_Goals = {
    list: function () { var r = loadGoals(); return (r.order||[]).map(function(id){return r.byId[id];}).filter(Boolean); },
    add: function (g) { var r = loadGoals(); g.id = g.id || uuid(); r.byId[g.id] = g; if (!r.order.includes(g.id)) r.order.push(g.id); saveGoals(r); return g; },
    show: showGoalsPage,
    project: projectGoal
  };
})();
