/* ============================================================================
   WJP Custom Strategy Override (W5)
   Lets user override the auto strategy with manual per-debt allocation.
   "Pay $X to debt Y this month — ignore the math."
   Stored in localStorage. Strategy engine (in app.js) checks for an override
   flag before running; if set, uses the user's allocation map instead.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_CustomStrategy) return;

  const KEY = 'wjp.strategy.custom';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch(_) { return null; }
  }
  function save(allocation) {
    try { localStorage.setItem(KEY, JSON.stringify(allocation)); } catch(_) {}
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch(_) {}
    fireChange();
  }

  function isActive() {
    const cur = load();
    return cur && cur.active === true;
  }
  function getAllocation() {
    const cur = load();
    return (cur && cur.allocations) || {};
  }
  function setAllocation(debtId, monthlyAmount) {
    const cur = load() || { active: true, allocations: {}, createdAt: Date.now() };
    cur.allocations[debtId] = Number(monthlyAmount) || 0;
    cur.active = true;
    save(cur);
    fireChange();
  }
  function activate() {
    const cur = load() || { active: true, allocations: {}, createdAt: Date.now() };
    cur.active = true;
    save(cur);
    fireChange();
  }
  function deactivate() {
    const cur = load();
    if (cur) { cur.active = false; save(cur); }
    fireChange();
  }

  function fireChange() {
    window.dispatchEvent(new CustomEvent('wjp:strategy:custom-changed', {
      detail: { active: isActive(), allocation: getAllocation() }
    }));
  }

  // Render UI panel into a target element
  function renderInto(el) {
    if (!el) return;
    const debts = (window.WJP_JointData ? window.WJP_JointData.mergedDebts() : (window.appState && window.appState.debts)) || [];
    const cur = load() || { active: false, allocations: {} };
    const totalAllocated = Object.values(cur.allocations || {}).reduce((s, v) => s + (Number(v) || 0), 0);

    el.innerHTML = `
      <div style="background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:22px;font-family:var(--sans,Inter,system-ui);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;">
          <div>
            <h3 style="font-family:var(--serif,Fraunces,serif);font-size:20px;margin:0 0 4px;letter-spacing:-0.02em;">Custom strategy</h3>
            <p style="font-size:13px;color:var(--ink-dim,#6b7280);margin:0;">Override the auto strategy. Allocate any monthly amount to any debt. Math will follow what you pick.</p>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:var(--ink,#0a0a0a);flex-shrink:0;">
            <input type="checkbox" id="wjp-custom-toggle" ${cur.active ? 'checked' : ''} style="width:16px;height:16px;accent-color:#1f7a4a;" />
            <span>${cur.active ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div id="wjp-custom-allocation" style="${cur.active ? '' : 'opacity:0.4;pointer-events:none;'}">
          ${debts.length === 0 ? '<p style="color:var(--ink-dim);font-size:13px;">No debts to allocate to. Add debts first.</p>' : `
          <div style="display:grid;gap:8px;">
            ${debts.map(d => `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;background:var(--bg,#fafaf7);border-radius:8px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.name || 'Debt')}</div>
                  <div style="font-size:11px;color:var(--ink-dim);">$${(Number(d.balance)||0).toLocaleString()} · ${(Number(d.apr)||0)}% APR</div>
                </div>
                <input type="number" data-debt-id="${escapeHtml(String(d.id))}" value="${cur.allocations[d.id] || 0}" min="0" step="10"
                  style="width:90px;padding:7px 10px;border-radius:7px;border:1px solid var(--border,#d8d3c4);font-size:13px;font-family:inherit;text-align:right;" />
              </div>
            `).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:14px;padding-top:14px;border-top:1px solid var(--border,#e5e7eb);font-size:13px;font-weight:700;">
            <span>Total monthly allocation:</span>
            <span style="color:#1f7a4a;" id="wjp-custom-total">$${totalAllocated.toLocaleString()}</span>
          </div>`}
        </div>
        <p style="margin-top:14px;font-size:11px;color:var(--ink-dim,#6b7280);line-height:1.5;">When custom strategy is on, the auto-allocator (Snowball/Avalanche/Hybrid) is disabled. Your debt-free date and savings projections still calculate using your custom amounts.</p>
      </div>
    `;
    const tog = document.getElementById('wjp-custom-toggle');
    if (tog) {
      tog.addEventListener('change', (e) => {
        e.target.checked ? activate() : deactivate();
        renderInto(el);
      });
    }
    el.querySelectorAll('input[data-debt-id]').forEach(inp => {
      inp.addEventListener('change', () => {
        setAllocation(inp.dataset.debtId, parseFloat(inp.value) || 0);
        const total = el.querySelectorAll('input[data-debt-id]');
        const sum = Array.from(total).reduce((s, x) => s + (parseFloat(x.value) || 0), 0);
        const tEl = document.getElementById('wjp-custom-total');
        if (tEl) tEl.textContent = '$' + sum.toLocaleString();
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Auto-render if a target element exists
  function tryRender() {
    const el = document.querySelector('[data-wjp-custom-strategy]');
    if (el) renderInto(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryRender);
  else tryRender();

  window.WJP_CustomStrategy = {
    load, save, clear,
    isActive, getAllocation,
    setAllocation, activate, deactivate,
    render: renderInto
  };
})();
