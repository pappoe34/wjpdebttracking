/* ============================================================================
   WJP Settings Extensions W3 — HARDENED (B-2)
   Language picker + Joint Accounts toggle UI.
   HARDENING: same as collapse module — path guard, scoped observer,
   debounced render, idempotent.
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSettingsExtInstalled) return;
  window._wjpSettingsExtInstalled = true;

  function onSettings() {
    const h = (location.hash || '').toLowerCase();
    return h.includes('settings') || !!document.querySelector('[data-settings-content]');
  }

  let renderTimer = null;
  function scheduleRender() {
    if (!onSettings()) return;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(renderControls, 250);
  }

  function renderControls() {
    renderTimer = null;
    if (!onSettings()) return;
    if (document.getElementById('wjp-lang-picker')) return; // idempotent
    const settingsArea = document.querySelector('[data-settings-content], #settings-content, .settings-panel');
    if (!settingsArea) return;

    const lang = document.createElement('div');
    lang.id = 'wjp-lang-picker';
    lang.style.cssText = 'background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:18px;margin:16px 0;font-family:var(--sans,Inter,system-ui);';
    const cur = (window.WJP_i18n && window.WJP_i18n.get()) || 'en';
    lang.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:4px;">Language</div>
          <div style="font-size:12px;color:var(--ink-dim,#6b7280);">Interface language. More languages coming soon.</div>
        </div>
        <select id="wjp-lang-select" style="padding:9px 12px;border-radius:8px;border:1px solid var(--border,#d8d3c4);background:var(--card,#fff);font-size:13px;font-family:inherit;color:var(--ink,#0a0a0a);min-width:140px;">
          <option value="en"${cur==='en'?' selected':''}>English</option>
          <option value="es"${cur==='es'?' selected':''}>Español</option>
        </select>
      </div>
    `;
    settingsArea.appendChild(lang);
    const sel = document.getElementById('wjp-lang-select');
    if (sel) sel.addEventListener('change', e => { if (window.WJP_i18n) window.WJP_i18n.set(e.target.value); });

    const isAuth = window.WJP_Joint && window.WJP_Joint.isAuthorized();
    if (isAuth) {
      const enabled = window.WJP_Joint.isEnabled();
      const ja = document.createElement('div');
      ja.id = 'wjp-joint-panel';
      ja.style.cssText = 'background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:18px;margin:16px 0;font-family:var(--sans,Inter,system-ui);';
      ja.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-size:14px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:4px;">Joint Accounts <span style="font-size:10px;background:#1f7a4a;color:#fff;padding:2px 8px;border-radius:999px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin-left:6px;">Pro Plus</span></div>
            <div style="font-size:12px;color:var(--ink-dim,#6b7280);line-height:1.5;">Track debt with a partner. When enabled, a top toggle lets you switch between your individual view and the shared joint view.</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;color:var(--ink,#0a0a0a);">
            <input type="checkbox" id="wjp-joint-enable" ${enabled?'checked':''} style="width:18px;height:18px;accent-color:#1f7a4a;cursor:pointer;" />
            <span>${enabled?'Enabled':'Disabled'}</span>
          </label>
        </div>
      `;
      settingsArea.appendChild(ja);
      const t = document.getElementById('wjp-joint-enable');
      if (t) t.addEventListener('change', e => {
        if (e.target.checked) window.WJP_Joint.enable(); else window.WJP_Joint.disable();
        e.target.parentElement.querySelector('span').textContent = e.target.checked ? 'Enabled' : 'Disabled';
      });
    }
  }

  let scoped = null;
  function attachScoped() {
    if (scoped) return;
    if (!onSettings()) return;
    const root = document.querySelector('[data-settings-content], .settings-panel, main');
    if (!root) return;
    scoped = new MutationObserver(scheduleRender);
    scoped.observe(root, { childList: true, subtree: false });
    scheduleRender();
  }

  window.addEventListener('hashchange', () => { if (onSettings()) { setTimeout(attachScoped, 100); scheduleRender(); } });
  window.addEventListener('wjp:settings:rendered', scheduleRender);

  let pollCount = 0;
  const initPoll = setInterval(() => {
    pollCount++;
    if (onSettings() && document.querySelector('[data-settings-content], .settings-panel')) {
      clearInterval(initPoll);
      attachScoped();
    } else if (pollCount > 20) clearInterval(initPoll);
  }, 500);
})();
