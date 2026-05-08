/* ============================================================================
   WJP Goal Tracker (W3) — Savings buckets, treats savings as inverse-debt.
   Renders a simple goals UI on a /goals route (or in-app section).
   Goals stored in localStorage (Firestore sync handled by app's main saveState).
   Each goal: { id, name, target, current, deadline, linkedAccountId? }
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpGoalsInstalled) return;
  window._wjpGoalsInstalled = true;

  const KEY = 'wjp.goals.v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(_) { return []; } }
  function save(g) { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch(_) {} }

  function add(goal) {
    const goals = load();
    const g = Object.assign({ id: 'g_' + Date.now(), createdAt: Date.now(), current: 0 }, goal);
    goals.push(g);
    save(goals);
    return g;
  }
  function update(id, patch) {
    const goals = load();
    const i = goals.findIndex(x => x.id === id);
    if (i === -1) return false;
    goals[i] = Object.assign(goals[i], patch);
    save(goals);
    return goals[i];
  }
  function remove(id) {
    save(load().filter(g => g.id !== id));
  }

  function pctOf(g) {
    if (!g.target || g.target <= 0) return 0;
    return Math.min(100, Math.round((g.current / g.target) * 100));
  }

  function renderInto(el) {
    if (!el) return;
    const goals = load();
    if (!goals.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--ink-dim,#6b7280);">
          <div style="font-size:48px;margin-bottom:12px;">🎯</div>
          <h3 style="font-family:var(--sans,Inter,system-ui,sans-serif);font-size:22px;margin:0 0 8px;color:var(--ink,#0a0a0a);">No goals yet.</h3>
          <p style="font-size:14px;line-height:1.55;max-width:420px;margin:0 auto 18px;">Track savings goals alongside your debts. Emergency fund, vacation, down payment, anything you're saving toward.</p>
          <button id="wjp-goal-new" style="background:#1f7a4a;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;">+ New goal</button>
        </div>`;
      const btn = document.getElementById('wjp-goal-new');
      if (btn) btn.addEventListener('click', promptNew);
      return;
    }
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h2 style="font-family:var(--sans,Inter,system-ui,sans-serif);font-size:24px;margin:0;letter-spacing:-0.02em;">Your goals</h2>
        <button id="wjp-goal-new" style="background:#1f7a4a;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">+ New goal</button>
      </div>
      <div style="display:grid;gap:12px;">
        ${goals.map(g => {
          const p = pctOf(g);
          return `<div style="background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:18px;">
            <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;">
              <div style="font-weight:700;font-size:15px;color:var(--ink,#0a0a0a);">${escapeHtml(g.name)}</div>
              <div style="font-size:13px;color:var(--ink-dim,#6b7280);">$${(g.current||0).toLocaleString()} / $${(g.target||0).toLocaleString()}</div>
            </div>
            <div style="height:8px;border-radius:4px;background:var(--bg,#fafaf7);overflow:hidden;">
              <div style="height:100%;width:${p}%;background:linear-gradient(90deg,#1f7a4a,#2b9b72);transition:width 0.3s;"></div>
            </div>
            <div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-top:8px;">${p}% — ${g.deadline ? 'by ' + new Date(g.deadline).toLocaleDateString() : 'no deadline'}</div>
          </div>`;
        }).join('')}
      </div>`;
    const btn = document.getElementById('wjp-goal-new');
    if (btn) btn.addEventListener('click', promptNew);
  }

  function promptNew() {
    const name = prompt('Goal name (e.g. Emergency fund)');
    if (!name) return;
    const target = parseFloat(prompt('Target amount ($)', '1000'));
    if (!target || isNaN(target)) return;
    add({ name: name.trim(), target, current: 0, deadline: null });
    const el = document.querySelector('[data-wjp-goals]');
    if (el) renderInto(el);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  window.WJP_Goals = { load, add, update, remove, render: renderInto, pctOf };

  // Auto-render if a goals container exists on page
  function tryRender() {
    const el = document.querySelector('[data-wjp-goals]');
    if (el) renderInto(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryRender);
  else tryRender();
})();
