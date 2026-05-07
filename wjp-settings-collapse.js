/* ============================================================================
   WJP Settings Collapse (W2)
   Reorganizes the existing 10-panel Settings sub-nav into 5 buckets.
   Runtime DOM override — does NOT modify the underlying app.js logic.
   The original 10 panels remain accessible internally; we just relabel and
   regroup the sub-nav links.

   Mapping (10 → 5):
     Profile       ← Profile + Appearance
     Banking       ← Linked Accounts + Data
     AI            ← AI Coach (unchanged)
     Privacy & Security ← Privacy + Security + Notifications
     Billing       ← Billing (unchanged)
     [Account stays as a separate destructive footer link]
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpSettingsCollapseInstalled) return;
  window._wjpSettingsCollapseInstalled = true;

  // 10-panel → 5-bucket map. Format: [bucket id, bucket label, [member panel ids in order]]
  const BUCKETS = [
    { id: 'profile',  label: 'Profile',            members: ['profile', 'appearance'] },
    { id: 'banking',  label: 'Banking',            members: ['accounts', 'linked', 'data'] },
    { id: 'ai',       label: 'AI Coach',           members: ['ai', 'aicoach'] },
    { id: 'privsec',  label: 'Privacy & Security', members: ['privacy', 'security', 'notifications'] },
    { id: 'billing',  label: 'Billing',            members: ['billing', 'plan', 'subscription'] }
  ];

  function findSubNav() {
    return document.querySelector('.settings-subnav, [data-settings-subnav], #settings-subnav');
  }

  function rebuild() {
    const sn = findSubNav();
    if (!sn || sn.dataset.collapsed === '1') return;

    const items = Array.from(sn.querySelectorAll('a, button, [data-panel]'));
    if (!items.length) return;

    // Discover existing panel ids
    const known = {};
    items.forEach(it => {
      const id = (it.dataset.panel || it.getAttribute('href') || '').replace('#', '').toLowerCase();
      if (id) known[id] = it;
    });

    // Build collapsed sub-nav
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
        // Click the first available original panel in this bucket
        for (const mid of b.members) {
          if (known[mid]) {
            known[mid].click();
            return;
          }
        }
      });
      sn.appendChild(a);
    });

    // Account stays as footer link (separate, destructive)
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

    sn.dataset.collapsed = '1';
  }

  // Watch for sub-nav appearing in DOM (Settings page renders dynamically)
  const obs = new MutationObserver(() => rebuild());
  obs.observe(document.body, { childList: true, subtree: true });

  // Also try on page change events
  window.addEventListener('hashchange', () => setTimeout(rebuild, 100));
  window.addEventListener('wjp:settings:rendered', rebuild);

  // Initial attempt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(rebuild, 200));
  } else {
    setTimeout(rebuild, 200);
  }
})();
