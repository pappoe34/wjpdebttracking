/* ============================================================================
   Admin Global Tier Switcher (P27v)
   --------------------------------------------------------------------------
   For admin accounts only. Renders a small widget at the bottom of the left
   sidebar. Clicking opens a popover with all tier options. When a tier is
   selected, the override is applied GLOBALLY by mutating
   appState.subscription.tier so every tier-gated feature in the app
   experiences the chosen tier (Plaid limits, Plans page, Privacy Mode,
   Premium-only sections, AI Coach, etc.).
   --------------------------------------------------------------------------
   Persistence: localStorage key 'wjp.adminTierOverride' (same key used by
   ChatCore). When set to anything other than null/auto, the override re-
   applies on every page load and on every Firestore subscription sync.
   --------------------------------------------------------------------------
   Strict gating: requires isActuallyAdmin() === true. Regular users see
   nothing — both the widget rendering and the override application short-
   circuit.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__WJP_ADMIN_TIER_SWITCHER__) return;
  window.__WJP_ADMIN_TIER_SWITCHER__ = true;

  const TIERS = [
    { key: 'auto',     label: 'Auto (real)',  hint: 'Use your actual admin tier',     pill: 'Real' },
    { key: 'free',     label: 'Free',         hint: '5 cloud chats/day · no Plaid',   pill: 'F'    },
    { key: 'pro',      label: 'Pro',          hint: '50 cloud chats/day · 1 bank',    pill: 'Pro'  },
    { key: 'trial',    label: 'Trial',        hint: '14-day Pro Plus · unlimited',    pill: 'T'    },
    { key: 'pro_plus', label: 'Pro Plus',     hint: 'Unlimited · 3 banks',            pill: 'P+'   },
    { key: 'admin',    label: 'Admin',        hint: 'Unlimited (you, normally)',      pill: '⚙'   },
  ];

  function isAdmin() {
    return !!(window.WJP_ChatCore && window.WJP_ChatCore.isActuallyAdmin && window.WJP_ChatCore.isActuallyAdmin());
  }
  function getOverride() {
    try { const v = localStorage.getItem('wjp.adminTierOverride'); return (v && v !== 'auto') ? v : null; }
    catch { return null; }
  }
  function setOverride(tier) {
    try {
      if (!tier || tier === 'auto') localStorage.removeItem('wjp.adminTierOverride');
      else localStorage.setItem('wjp.adminTierOverride', tier);
    } catch {}
    applyOverrideToAppState();
    refreshWidget();
    // Force a soft re-render of pages affected by tier
    try { window.dispatchEvent(new CustomEvent('wjp:aichat:usage')); } catch {}
    try { window.dispatchEvent(new CustomEvent('wjp:tier:changed', { detail: { tier } })); } catch {}
    if (typeof window.showToast === 'function') {
      window.showToast(tier === 'auto' || !tier ? 'Reverted to real admin tier' : `Now testing app as ${tier.replace('_', ' ')}`);
    }
  }

  function tierToSubFormat(tier) {
    if (tier === 'pro_plus' || tier === 'admin' || tier === 'trial') return 'pro-plus';
    if (tier === 'pro') return 'pro';
    if (tier === 'free') return 'free';
    return tier;
  }

  // Mutate appState.subscription.tier to match the override so app.js gating works
  function applyOverrideToAppState() {
    if (!isAdmin()) return;
    const override = getOverride();
    if (!window.appState) return;
    if (!window.appState.subscription) window.appState.subscription = {};
    const sub = window.appState.subscription;
    // Cache real tier once
    if (sub._realTier === undefined && sub.tier !== undefined) {
      sub._realTier = sub.tier;
      sub._realIsAdmin = !!sub.isAdmin;
    }
    if (override) {
      sub.tier = tierToSubFormat(override);
      sub.isAdmin = (override === 'admin');
      // Trial state
      if (override === 'trial') {
        sub.status = 'trialing';
        sub.trial_end = Math.floor(Date.now() / 1000) + 14 * 86400;
      } else {
        sub.status = (override === 'free' ? 'inactive' : 'active');
        sub.trial_end = null;
      }
    } else if (sub._realTier !== undefined) {
      // Restore real values
      sub.tier = sub._realTier;
      sub.isAdmin = !!sub._realIsAdmin;
    }
  }

  function refreshWidget() {
    const w = document.getElementById('wjp-admin-tier-widget');
    if (!w) return;
    const override = getOverride();
    const cur = override ? TIERS.find(t => t.key === override) : null;
    const pill = cur ? cur.pill : '⚙';
    const labelEl = w.querySelector('.wats-current-pill');
    if (labelEl) labelEl.textContent = pill;
    w.classList.toggle('wats-active', !!override);
  }

  function buildWidget() {
    if (document.getElementById('wjp-admin-tier-widget')) return;
    const wrap = document.createElement('div');
    wrap.id = 'wjp-admin-tier-widget';
    wrap.className = 'wats';
    wrap.innerHTML = `
      <button class="wats-toggle" type="button" title="Admin: switch testing tier">
        <i class="ph-fill ph-flask wats-icon"></i>
        <span class="wats-label">Admin tier</span>
        <span class="wats-current-pill">⚙</span>
      </button>
      <div class="wats-popover" role="menu">
        <div class="wats-popover-header">
          <i class="ph-fill ph-shield-star"></i>
          <strong>Admin · Test as tier</strong>
        </div>
        <div class="wats-popover-hint">Override the entire app's tier experience. Regular users never see this.</div>
        <div class="wats-options"></div>
      </div>
    `;

    // Mount in sidebar — find it via several common selectors
    const sidebar = document.querySelector('.sidebar') ||
                    document.querySelector('aside.sidebar') ||
                    document.querySelector('.nav-sidebar') ||
                    document.querySelector('[class*="sidebar"]') ||
                    document.body;
    // Try to put it just above the Settings/Support footer in the sidebar
    const settingsLink = document.querySelector('.sidebar [data-page="settings"], .sidebar #nav-settings');
    if (settingsLink && settingsLink.parentNode) {
      settingsLink.parentNode.insertBefore(wrap, settingsLink);
    } else if (sidebar) {
      sidebar.appendChild(wrap);
    } else {
      document.body.appendChild(wrap);
    }

    // Wire popover toggle
    const toggle = wrap.querySelector('.wats-toggle');
    const popover = wrap.querySelector('.wats-popover');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.toggle('wats-open');
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) popover.classList.remove('wats-open');
    });

    // Wire options
    const opts = wrap.querySelector('.wats-options');
    const renderOptions = () => {
      const cur = getOverride() || 'auto';
      opts.innerHTML = TIERS.map(t => `
        <button class="wats-opt ${t.key === cur ? 'active' : ''}" data-tier="${t.key}" type="button">
          <span class="wats-opt-pill">${t.pill}</span>
          <span class="wats-opt-text">
            <span class="wats-opt-label">${t.label}</span>
            <span class="wats-opt-hint">${t.hint}</span>
          </span>
        </button>
      `).join('');
      opts.querySelectorAll('.wats-opt').forEach(b => {
        b.addEventListener('click', () => {
          setOverride(b.dataset.tier);
          renderOptions();
          popover.classList.remove('wats-open');
        });
      });
    };
    renderOptions();
    refreshWidget();
  }

  // SECURITY: aggressively scrub any admin artifacts off non-admin accounts.
  // If a session was opened with this localStorage set, clear it.
  function purgeIfNotAdmin() {
    try {
      if (isAdmin()) return false;  // legit admin — leave alone
      let purged = false;
      if (localStorage.getItem('wjp.adminTierOverride')) {
        localStorage.removeItem('wjp.adminTierOverride');
        purged = true;
      }
      if (localStorage.getItem('wjp.adminOverride')) {
        localStorage.removeItem('wjp.adminOverride');
        purged = true;
      }
      // Remove the sidebar widget if it ever rendered
      const w = document.getElementById('wjp-admin-tier-widget');
      if (w) { w.remove(); purged = true; }
      // Restore any test-tier mutation back to the real subscription tier
      try {
        const sub = window.appState && window.appState.subscription;
        if (sub && sub._realTier !== undefined) {
          sub.tier = sub._realTier;
          sub.isAdmin = !!sub._realIsAdmin;
        }
      } catch {}
      if (purged) console.log('[admin-tier-switcher] non-admin session — purged stale admin artifacts');
    } catch {}
    return true;
  }

  function init() {
    // Wait for ChatCore (which loads admin detection) before deciding whether to render
    let polls = 0;
    const t = setInterval(() => {
      polls++;
      if (window.WJP_ChatCore) {
        purgeIfNotAdmin();
        if (isAdmin()) {
          buildWidget();
          applyOverrideToAppState();
          // Re-apply override every 2s so Firestore subscription sync can't undo it
          setInterval(applyOverrideToAppState, 2000);
        }
        clearInterval(t);
      } else if (polls > 50) {
        clearInterval(t);
      }
    }, 200);

    // If sidebar gets re-rendered, re-mount the widget — but ONLY for real admins
    const obs = new MutationObserver(() => {
      if (isAdmin() && !document.getElementById('wjp-admin-tier-widget')) {
        buildWidget();
        applyOverrideToAppState();
      } else if (!isAdmin()) {
        purgeIfNotAdmin();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // SECURITY: on any auth change, re-evaluate admin status and purge if needed
    function setupAuthGuard() {
      if (!window.firebase || !window.firebase.auth) return false;
      try {
        window.firebase.auth().onAuthStateChanged(() => {
          if (!isAdmin()) {
            purgeIfNotAdmin();
          } else if (!document.getElementById('wjp-admin-tier-widget')) {
            buildWidget();
            applyOverrideToAppState();
          }
        });
        return true;
      } catch { return false; }
    }
    if (!setupAuthGuard()) {
      let p = 0;
      const t2 = setInterval(() => { p++; if (setupAuthGuard() || p > 50) clearInterval(t2); }, 200);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose for other modules + console
  window.WJP_AdminTier = { setOverride, getOverride, isAdmin, applyOverrideToAppState, TIERS };
})();
