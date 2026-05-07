/* ============================================================================
   WJP Settings Extensions W5 — Theme picker + Custom Strategy + Notifications
   + Referrals stats. Adds onto the W3 settings extensions module.
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSettingsExtW5Installed) return;
  window._wjpSettingsExtW5Installed = true;

  function renderControls() {
    const settingsArea = document.querySelector('[data-settings-content], #settings-content, .settings-panel, main');
    if (!settingsArea) return;
    if (document.getElementById('wjp-w5-controls')) return;

    const wrap = document.createElement('div');
    wrap.id = 'wjp-w5-controls';
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;margin:16px 0;font-family:var(--sans,Inter,system-ui);';

    // ---- Theme picker ----
    const cur = document.documentElement.getAttribute('data-theme') || 'auto';
    const themeRow = document.createElement('div');
    themeRow.style.cssText = 'background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:18px;';
    themeRow.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:4px;">Theme</div>
          <div style="font-size:12px;color:var(--ink-dim,#6b7280);">Light, dark, or follow your system.</div>
        </div>
        <div style="display:flex;gap:4px;background:var(--bg,#fafaf7);border-radius:8px;padding:3px;">
          <button data-theme-pick="light" style="padding:7px 12px;border-radius:6px;border:none;background:${cur==='light'?'#1f7a4a':'transparent'};color:${cur==='light'?'#fff':'var(--ink,#0a0a0a)'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Light</button>
          <button data-theme-pick="dark" style="padding:7px 12px;border-radius:6px;border:none;background:${cur==='dark'?'#1f7a4a':'transparent'};color:${cur==='dark'?'#fff':'var(--ink,#0a0a0a)'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Dark</button>
          <button data-theme-pick="auto" style="padding:7px 12px;border-radius:6px;border:none;background:${cur!=='light'&&cur!=='dark'?'#1f7a4a':'transparent'};color:${cur!=='light'&&cur!=='dark'?'#fff':'var(--ink,#0a0a0a)'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Auto</button>
        </div>
      </div>
    `;
    themeRow.querySelectorAll('[data-theme-pick]').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.getAttribute('data-theme-pick');
        if (v === 'auto') {
          document.documentElement.removeAttribute('data-theme');
          try { localStorage.removeItem('wjp.theme'); } catch(_) {}
        } else {
          document.documentElement.setAttribute('data-theme', v);
          try { localStorage.setItem('wjp.theme', v); } catch(_) {}
        }
        renderControls(); // re-render selection
      });
    });

    // ---- Notifications toggle ----
    const notifRow = document.createElement('div');
    notifRow.style.cssText = 'background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:18px;';
    notifRow.setAttribute('data-wjp-notifications', '');

    // ---- Custom Strategy panel ----
    const csRow = document.createElement('div');
    csRow.setAttribute('data-wjp-custom-strategy', '');

    // ---- Referrals stats card ----
    const refRow = document.createElement('div');
    refRow.setAttribute('data-wjp-referrals', '');

    wrap.appendChild(themeRow);
    wrap.appendChild(notifRow);
    wrap.appendChild(refRow);
    wrap.appendChild(csRow);

    settingsArea.appendChild(wrap);

    // Trigger renderers from other W5 modules
    if (window.WJP_Notifications && typeof window.WJP_Notifications.renderToggle === 'function') {
      window.WJP_Notifications.renderToggle(notifRow);
    }
    if (window.WJP_CustomStrategy && typeof window.WJP_CustomStrategy.render === 'function') {
      window.WJP_CustomStrategy.render(csRow);
    }
    if (window.WJP_Referrals && typeof window.WJP_Referrals.render === 'function') {
      window.WJP_Referrals.render(refRow);
    }
  }

  const obs = new MutationObserver(() => {
    if (location.hash.indexOf('settings') !== -1 || document.querySelector('[data-settings-content]')) {
      renderControls();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('hashchange', () => setTimeout(renderControls, 200));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(renderControls, 500));
  } else {
    setTimeout(renderControls, 500);
  }
})();
