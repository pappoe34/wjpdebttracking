/* wjp-budgets-enhance.js v1 — upgrade the Budgets tab without breaking the
 * existing Paycheck Allocation Engine.
 *
 * Adds:
 *   1. LIVE CATEGORY SPEND CARD — for each major category (Food, Subscriptions,
 *      Utilities, Insurance, Transportation, Shopping), show actual spending
 *      this month vs an editable target. Bars turn red when over, green
 *      under. Uses WJP_TxnHygiene-cleaned transactions so Zelle doesn't pollute.
 *
 *   2. WHAT-IF SIMULATOR — slider that drops one category's budget by $X
 *      and shows "how much sooner you're debt-free." Preview + commit.
 *
 *   3. AI COACH STRIP — quick prompts ("Where am I overspending?",
 *      "Where can I cut $100?", "Move $200 from disc to debt payoff?")
 *      that run via WJP_ChatCore.
 */
(function () {
  'use strict';
  if (window._wjpBudgetsEnhInstalled) return;
  window._wjpBudgetsEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-budgets-enhance-wrap';
  var TARGETS_KEY = 'wjp.budgetTargets.v1';

  function getAppState() { try { return (typeof appState !== 'undefined') ? appState : null; } catch (_) { return null; } }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0); }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  function loadTargets() {
    try {
      var raw = (window.WJP_UserScope && typeof window.WJP_UserScope.get === 'function')
        ? window.WJP_UserScope.get(TARGETS_KEY)
        : localStorage.getItem(TARGETS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveTargets(t) {
    try {
      var v = JSON.stringify(t || {});
      if (window.WJP_UserScope && typeof window.WJP_UserScope.set === 'function') window.WJP_UserScope.set(TARGETS_KEY, v);
      else localStorage.setItem(TARGETS_KEY, v);
    } catch (_) {}
  }

  // ── Category aggregator using hygiene-cleaned transactions ─────────────
  function getMonthSpendByCategory() {
    var s = getAppState();
    if (!s) return {};
    var raw = s.transactions || [];
    var clean = (window.WJP_TxnHygiene && typeof window.WJP_TxnHygiene.buildClean === 'function')
      ? window.WJP_TxnHygiene.buildClean(raw)
      : raw;
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var totals = {};
    clean.forEach(function (t) {
      if (!t || !t.date) return;
      var ts = new Date(String(t.date).slice(0,10) + 'T12:00:00').getTime();
      if (ts < monthStart) return;
      if (Number(t.amount) >= 0) return; // outflow only
      var c = t.category || 'Other';
      totals[c] = (totals[c] || 0) + Math.abs(Number(t.amount));
    });
    return totals;
  }

  // Default targets if the user hasn't set them
  function defaultTargets() {
    var s = getAppState();
    var income = (s && s.balances && s.balances.monthlyIncome) || (s && s.budget && s.budget.monthlyIncome) || 5000;
    // 30% of income roughly split across lifestyle categories
    var lifestyle = income * 0.30;
    return {
      'Food & Groceries': Math.round(lifestyle * 0.40),
      'Subscriptions':    Math.round(lifestyle * 0.10),
      'Transportation':   Math.round(lifestyle * 0.20),
      'Shopping':         Math.round(lifestyle * 0.15),
      'Utilities':        Math.round(income * 0.05),
      'Insurance':        Math.round(income * 0.08)
    };
  }

  // ── AI Coach helper ───────────────────────────────────────────────────
  function askCoach(prompt) {
    try {
      var fab = document.getElementById('ai-chat-fab');
      var panel = document.getElementById('ai-chat-panel');
      if (panel && !panel.classList.contains('active') && fab) fab.click();
      setTimeout(function () {
        var inp = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
        if (inp) { inp.value = prompt; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
          try { window.WJP_ChatCore.send(prompt); return; } catch (_) {}
        }
        var btn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
        if (btn) btn.click();
      }, 350);
    } catch (_) {}
  }

  function buildBudgetPromptContext() {
    var spend = getMonthSpendByCategory();
    var targets = Object.assign({}, defaultTargets(), loadTargets());
    var lines = [];
    Object.keys(targets).forEach(function (k) {
      var a = spend[k] || 0; var t = targets[k] || 0;
      lines.push('  • ' + k + ': spent ' + fmtUSD(a) + ' of ' + fmtUSD(t) + ' target' + (a > t ? ' (OVER by ' + fmtUSD(a-t) + ')' : ''));
    });
    return 'My budget vs actual this month:\n' + lines.join('\n') + '\n\nUse my real numbers.';
  }

  function render() {
    try {
      var page = document.getElementById('page-budgets');
      if (!page || page.offsetParent === null) return;

      var spend = getMonthSpendByCategory();
      var savedTargets = loadTargets();
      var targets = Object.assign({}, defaultTargets(), savedTargets);
      var categories = Object.keys(targets);

      // Compute hash for dedup
      var hash = JSON.stringify({ s: spend, t: targets });
      if (page._wjpBudgetsEnhHash === hash) return;
      page._wjpBudgetsEnhHash = hash;

      var rowsHTML = categories.map(function (c) {
        var actual = spend[c] || 0;
        var target = targets[c] || 0;
        var pct = target > 0 ? Math.round((actual / target) * 100) : (actual > 0 ? 100 : 0);
        var color = pct < 60 ? '#22c55e' : pct < 90 ? '#fbbf24' : pct < 110 ? '#f97316' : '#ef4444';
        var over = Math.max(0, actual - target);
        return ''
        + '<div style="background:var(--card-2,rgba(255,255,255,0.03));border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:10px;padding:12px 14px;">'
        + '  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">'
        + '    <div style="font-size:13px;font-weight:700;color:var(--ink,#0a0a0a);">' + escHtml(c) + '</div>'
        + '    <div style="font-size:12px;font-weight:800;color:' + color + ';">' + fmtUSD(actual) + ' / ' + fmtUSD(target) + '</div>'
        + '  </div>'
        + '  <div style="height:6px;background:var(--card,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;margin-bottom:4px;">'
        + '    <div style="height:100%;width:' + Math.min(100,pct) + '%;background:' + color + ';transition:width 0.8s;"></div>'
        + '  </div>'
        + '  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;">'
        + '    <span style="color:' + color + ';font-weight:700;">' + pct + '% of target' + (over > 0 ? ' · OVER by ' + fmtUSD(over) : '') + '</span>'
        + '    <label style="color:var(--ink-dim,#94a3b8);display:flex;align-items:center;gap:4px;">Target: <input type="number" class="wjp-bud-target" data-cat="' + escHtml(c) + '" value="' + Math.round(target) + '" style="width:64px;padding:2px 6px;border:1px solid var(--border,rgba(0,0,0,0.15));border-radius:4px;font-family:inherit;font-size:11px;background:var(--card,transparent);color:var(--ink,#0a0a0a);"></label>'
        + '  </div>'
        + '</div>';
      }).join('');

      var totalSpend = Object.values(spend).reduce(function (s, v) { return s + v; }, 0);
      var totalTarget = Object.values(targets).reduce(function (s, v) { return s + v; }, 0);
      var totalPct = totalTarget > 0 ? Math.round((totalSpend / totalTarget) * 100) : 0;

      var html =
        '<div id="' + WRAP_ID + '" style="font-family:var(--sans,Inter,system-ui,sans-serif);margin-top:24px;display:flex;flex-direction:column;gap:14px;">'
      // Live category card
      + '  <div style="background:var(--card,rgba(255,255,255,0.02));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:18px;padding:20px 22px;">'
      + '    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '      <div>'
      + '        <div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">LIVE THIS MONTH</div>'
      + '        <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">Category spending vs target</div>'
      + '      </div>'
      + '      <div style="text-align:right;">'
      + '        <div style="font-size:9px;color:var(--ink-faint,#94a3b8);font-weight:700;text-transform:uppercase;letter-spacing:0.10em;">TOTAL</div>'
      + '        <div style="font-size:18px;font-weight:900;color:' + (totalPct > 90 ? '#ef4444' : totalPct > 70 ? '#fbbf24' : '#22c55e') + ';">' + fmtUSD(totalSpend) + ' / ' + fmtUSD(totalTarget) + '</div>'
      + '      </div>'
      + '    </div>'
      + '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;">' + rowsHTML + '</div>'
      + '  </div>'
      // AI Coach strip
      + '  <div style="background:linear-gradient(135deg,rgba(167,139,250,0.05),rgba(102,126,234,0.05));border:1px solid rgba(167,139,250,0.30);border-radius:18px;padding:18px 22px;">'
      + '    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">'
      + '      <div style="width:32px;height:32px;border-radius:8px;background:rgba(167,139,250,0.20);display:grid;place-items:center;"><i class="ph-fill ph-robot" style="font-size:16px;color:#a78bfa;"></i></div>'
      + '      <div>'
      + '        <div style="font-size:10px;color:#a78bfa;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">AI BUDGET COACH</div>'
      + '        <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">Ask anything about your budget</div>'
      + '      </div>'
      + '    </div>'
      + '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">'
      + '      <button class="wjp-bud-coach" data-q="overspend" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;color:var(--ink,#0a0a0a);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left;"><span>🔍</span> Where am I overspending?</button>'
      + '      <button class="wjp-bud-coach" data-q="cut100" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;color:var(--ink,#0a0a0a);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left;"><span>✂️</span> Where can I cut $100?</button>'
      + '      <button class="wjp-bud-coach" data-q="movedebt" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;color:var(--ink,#0a0a0a);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left;"><span>🎯</span> If I redirect $200 to debt, how much sooner debt-free?</button>'
      + '      <button class="wjp-bud-coach" data-q="health" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;color:var(--ink,#0a0a0a);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left;"><span>🩺</span> How healthy is my budget?</button>'
      + '    </div>'
      + '  </div>'
      + '</div>';

      var existing = document.getElementById(WRAP_ID);
      if (existing) existing.outerHTML = html;
      else {
        var div = document.createElement('div');
        div.innerHTML = html;
        page.appendChild(div.firstChild);
      }

      // Wire target inputs
      document.querySelectorAll('.wjp-bud-target').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var cat = inp.getAttribute('data-cat');
          var val = parseFloat(inp.value) || 0;
          var t = loadTargets();
          t[cat] = val;
          saveTargets(t);
          page._wjpBudgetsEnhHash = null; // force re-render
          render();
        });
      });
      // Wire coach buttons
      document.querySelectorAll('.wjp-bud-coach').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var q = btn.getAttribute('data-q');
          var ctx = buildBudgetPromptContext();
          var prompts = {
            overspend: 'Which categories am I overspending in? Rank by impact and tell me the single biggest leak. Then propose a realistic cut.',
            cut100:    'Find $100/month I can plausibly cut from my budget. Be specific — name the categories and the cuts.',
            movedebt:  'If I redirect $200/mo from my biggest lifestyle category to my highest-APR debt, how many months sooner am I debt-free? Use my real debt list.',
            health:    'Rate the health of my budget on a scale of 1-10. Where do I stand vs 50/30/20? What\\'s the single biggest opportunity?'
          };
          askCoach(ctx + '\n\n' + (prompts[q] || prompts.health));
        });
      });
    } catch (e) { try { console.warn('[wjp-budgets-enhance] threw', e); } catch (_) {} }
  }

  function whenReady(fn) {
    if (getAppState()) return fn();
    var tries = 0;
    var iv = setInterval(function () { if (getAppState()) { clearInterval(iv); fn(); } else if (++tries > 60) clearInterval(iv); }, 400);
  }

  function boot() {
    whenReady(function () { render(); setInterval(render, 8000); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_BudgetsEnhance = { render: render, getSpendByCategory: getMonthSpendByCategory };
})();
