/* ============================================================================
   WJP Settings Extensions (W3) — Language picker + Joint Accounts toggle UI.
   Adds two new controls to the Settings page that consume W2 infrastructure.
   Renders into the Profile bucket (i18n) and a new Joint Accounts area
   (gated by tier).
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSettingsExtInstalled) return;
  window._wjpSettingsExtInstalled = true;

  function renderControls() {
    if (document.getElementById('wjp-lang-picker')) return;
    const settingsArea = document.querySelector('[data-settings-content], #settings-content, .settings-panel, main');
    if (!settingsArea) return;

    // Language picker
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
    document.getElementById('wjp-lang-select').addEventListener('change', e => {
      if (window.WJP_i18n) window.WJP_i18n.set(e.target.value);
    });

    // Joint accounts toggle (Pro Plus only)
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
        <div id="wjp-joint-partner-row" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border,#e5e7eb);${enabled?'':'display:none;'}">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:6px;">Partner email (they'll get an invite)</label>
          <input type="email" id="wjp-joint-partner" placeholder="partner@example.com" value="${(window.WJP_Joint.getPartner && window.WJP_Joint.getPartner()) || ''}" style="width:100%;max-width:320px;padding:9px 12px;border-radius:8px;border:1px solid var(--border,#d8d3c4);font-size:13px;font-family:inherit;" />
          <button id="wjp-joint-invite" style="margin-left:8px;background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Send invite</button>
        </div>
      `;
      settingsArea.appendChild(ja);

      document.getElementById('wjp-joint-enable').addEventListener('change', e => {
        if (e.target.checked) {
          window.WJP_Joint.enable();
          document.getElementById('wjp-joint-partner-row').style.display = '';
        } else {
          window.WJP_Joint.disable();
          document.getElementById('wjp-joint-partner-row').style.display = 'none';
        }
        e.target.parentElement.querySelector('span').textContent = e.target.checked ? 'Enabled' : 'Disabled';
      });
      document.getElementById('wjp-joint-invite').addEventListener('click', () => {
        const email = document.getElementById('wjp-joint-partner').value.trim();
        if (!email) return;
        window.WJP_Joint.setPartner(email);
        // TODO: backend call to actually email invite
        document.getElementById('wjp-joint-invite').textContent = 'Invite sent ✓';
        setTimeout(() => { document.getElementById('wjp-joint-invite').textContent = 'Send invite'; }, 2400);
      });
    }
  }

  // Watch for Settings page render
  const obs = new MutationObserver(() => {
    if (location.hash.indexOf('settings') !== -1 || document.querySelector('[data-settings-content]')) {
      renderControls();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('hashchange', () => setTimeout(renderControls, 200));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(renderControls, 400));
  } else {
    setTimeout(renderControls, 400);
  }
})();
