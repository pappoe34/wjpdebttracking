/* ============================================================================
   WJP Settings Collapse — HARDENED (B-1)
   Reorganizes existing 10-panel Settings sub-nav into 5 buckets.
   HARDENING:
     - Path guard: only activates when location.hash contains 'settings'
     - Scoped observer: watches the settings panel only, not document.body
     - Debounced rebuild: 250ms throttle, runs at most once per quiescence window
     - Idempotent: dataset.collapsed='1' marker prevents re-rebuilds
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSettingsCollapseInstalled) return;
  window._wjpSettingsCollapseInstalled = true;

  const BUCKETS = [
    { id: 'profile',  label: 'Profile',            members: ['profile', 'appearance'] },
    { id: 'banking',  label: 'Banking',            members: ['accounts', 'linked', 'data'] },
    { id: 'ai',       label: 'AI Coach',           members: ['ai', 'aicoach'] },
    { id: 'privsec',  label: 'Privacy & Security', members: ['privacy', 'security', 'notifications'] },
    { id: 'billing',  label: 'Billing',            members: ['billing', 'plan', 'subscription'] }
  ];

  function onSettings() {
    const h = (location.hash || '').toLowerCase();
    return h.includes('settings') || !!document.querySelector('[data-settings-content]');
  }

  function findSubNav() {
    return document.querySelector('.settings-subnav, [data-settings-subnav], #settings-subnav');
  }

  let rebuildTimer = null;
  function scheduleRebuild() {
    if (!onSettings()) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 250);
  }

  function rebuild() {
    rebuildTimer = null;
    if (!onSettings()) return;
    const sn = findSubNav();
    if (!sn || sn.dataset.collapsed === '1') return;

    const items = Array.from(sn.querySelectorAll('a, button, [data-panel]'));
    if (!items.length) return;

    const known = {};
    items.forEach(it => {
      const id = (it.dataset.panel || it.getAttribute('href') || '').replace('#', '').toLowerCase();
      if (id) known[id] = it;
    });

    sn.dataset.collapsed = '1'; // mark FIRST so any re-entry bails immediately
    sn.innerHTML = '';
    BUCKETS.forEach(b => {
      const a = document.createElement('a');
      a.href = '#settings-' + b.id;
      a.dataset.bucket = b.id;
      a.textContent = b.label;
      a.style.cssText = 'padding:10px 16px;border-radius:8px;text-decoration:none;color:var(--ink-dim,#5a6b5e);font-weight:600;font-size:14px;font-family:var(--sans,Inter,system-ui);';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        sn.querySelectorAll('a').forEach(x => {
          x.style.background = '';
          x.style.color = 'var(--ink-dim,#5a6b5e)';
        });
        a.style.background = 'rgba(31,122,74,0.08)';
        a.style.color = 'var(--ink,#0a0a0a)';
        for (const mid of b.members) {
          if (known[mid]) { known[mid].click(); return; }
        }
      });
      sn.appendChild(a);
    });

    if (known['account']) {
      const acct = document.createElement('a');
      acct.href = '#settings-account';
      acct.textContent = 'Account';
      acct.style.cssText = 'padding:10px 16px;border-radius:8px;text-decoration:none;color:#c0594a;font-weight:600;font-size:13px;margin-left:auto;font-family:var(--sans,Inter,system-ui);';
      acct.addEventListener('click', (e) => {
        e.preventDefault();
        known['account'].click();
      });
      sn.appendChild(acct);
    }
  }

  // Only attach observer to the settings subtree once it exists
  let scoped = null;
  function attachScoped() {
    if (scoped) return;
    if (!onSettings()) return;
    const root = document.querySelector('[data-settings-content], .settings-panel, main');
    if (!root) return;
    scoped = new MutationObserver(scheduleRebuild);
    scoped.observe(root, { childList: true, subtree: true });
    scheduleRebuild();
  }

  window.addEventListener('hashchange', () => {
    if (onSettings()) {
      setTimeout(attachScoped, 100);
      scheduleRebuild();
    }
  });

  window.addEventListener('wjp:settings:rendered', scheduleRebuild);

  // Polling fallback only while we wait for the settings panel to first appear
  // (capped at 20 attempts × 500ms = 10s, then gives up)
  let pollCount = 0;
  const initPoll = setInterval(() => {
    pollCount++;
    if (onSettings() && findSubNav()) {
      clearInterval(initPoll);
      attachScoped();
    } else if (pollCount > 20) {
      clearInterval(initPoll);
    }
  }, 500);
})();
