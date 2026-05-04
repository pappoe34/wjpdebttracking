/* ============================================================================
   Settings → AI Coach panel upgrade (P27s)
   The legacy panel is rendered by Settings v3 (in app.js, function r_aicoach).
   It still references "Llama 8B/70B" and uses incompatible length values.
   This module observes Settings DOM mounts and patches the panel to:
     • Show actual current model (Claude Haiku 4.5)
     • Show live usage stats (used/limit/tier) tied to ChatCore
     • Replace length picker with the same Short/Medium/Long control we use
       in the chat headers — wired to wjp.aiLength localStorage
     • Fix Clear history to wipe the unified ChatCore history key
   ============================================================================ */
(function () {
  'use strict';
  if (window.__WJP_SETTINGS_AICOACH_UPGRADE__) return;
  window.__WJP_SETTINGS_AICOACH_UPGRADE__ = true;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function patchPanel() {
    // The panel content is the only one with #set-ai-model on screen.
    const modelSel = document.getElementById('set-ai-model');
    if (!modelSel) return false;
    const panel = modelSel.closest('.settings-panel') || modelSel.closest('[data-section]') || modelSel.closest('section') || document;
    if (panel.dataset && panel.dataset.aicoachUpgraded === '1') return true;
    if (panel.dataset) panel.dataset.aicoachUpgraded = '1';

    // 1) Replace model dropdown row with a read-only Model card showing current model + usage.
    const modelRow = modelSel.closest('.settings-row') || modelSel.closest('[class*="row"]') || modelSel.parentElement;
    if (modelRow) {
      const replacement = document.createElement('div');
      replacement.innerHTML = renderModelInfoCard();
      modelRow.replaceWith(replacement.firstElementChild);
    }

    // 2) Patch length dropdown values from short/medium/long → brief/standard/detailed
    //    and seed from wjp.aiLength localStorage so it matches the in-chat toggle.
    const lenSel = document.getElementById('set-ai-length');
    if (lenSel) {
      const cur = (function () {
        try { return localStorage.getItem('wjp.aiLength') || 'standard'; }
        catch { return 'standard'; }
      })();
      lenSel.innerHTML = '';
      [
        { v: 'brief',    t: 'Short — 1–3 sentences' },
        { v: 'standard', t: 'Medium — 150–300 words' },
        { v: 'detailed', t: 'Long — full breakdown (~350 words)' },
      ].forEach(o => {
        const op = document.createElement('option');
        op.value = o.v; op.textContent = o.t;
        if (o.v === cur) op.selected = true;
        lenSel.appendChild(op);
      });
      lenSel.removeAttribute('data-aipref');  // avoid the legacy handler clobbering
      lenSel.addEventListener('change', () => {
        try { localStorage.setItem('wjp.aiLength', lenSel.value); } catch {}
        // Mirror to appState pref + saveState if available
        try {
          if (window.appState) {
            if (!window.appState.prefs) window.appState.prefs = {};
            window.appState.prefs.aiLength = lenSel.value;
            if (typeof window.saveState === 'function') window.saveState();
          }
        } catch {}
        // Refresh in-chat toggles immediately
        document.querySelectorAll('.wjp-length-toggle').forEach(t => {
          t.querySelectorAll('.wjp-length-opt').forEach(b => {
            const active = b.dataset.length === lenSel.value;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
          });
        });
      });
    }

    // 3) Patch tone dropdown values to match backend (direct/coach/friendly)
    const toneSel = document.getElementById('set-ai-tone');
    if (toneSel) {
      const cur = toneSel.value || 'friendly';
      toneSel.innerHTML = '';
      [
        { v: 'friendly', t: 'Friendly — warm + supportive' },
        { v: 'coach',    t: 'Coach — motivating + decisive' },
        { v: 'direct',   t: 'Direct — terse, lead with the number' },
      ].forEach(o => {
        const op = document.createElement('option');
        op.value = o.v; op.textContent = o.t;
        if (o.v === cur) op.selected = true;
        toneSel.appendChild(op);
      });
    }

    // 4) Fix Clear history button — also wipe the unified ChatCore key
    const clearBtn = document.getElementById('set-ai-clear');
    if (clearBtn && !clearBtn.dataset.upgraded) {
      clearBtn.dataset.upgraded = '1';
      const fresh = clearBtn.cloneNode(true);
      clearBtn.parentNode.replaceChild(fresh, clearBtn);
      fresh.addEventListener('click', () => {
        if (!confirm('Clear ALL AI Coach conversation history? This cannot be undone.')) return;
        try {
          if (window.WJP_ChatCore) window.WJP_ChatCore.clearHistory();
          else localStorage.removeItem('wjp.aicoach.history.v1');
        } catch {}
        try {
          if (window.appState) { window.appState.chatHistory = []; if (typeof window.saveState === 'function') window.saveState(); }
        } catch {}
        if (typeof window.showToast === 'function') window.showToast('Chat history cleared');
        // Refresh usage card on this page
        renderUsageInside();
      });
    }

    // Inject Auto-clear chat dropdown (visible to all users)
    injectAutoClearDropdown(panel);

    // Inject Admin Tier Switcher (only for actual admins)
    injectAdminTierSwitcher(panel);

    // Re-run usage render after a moment
    setTimeout(renderUsageInside, 200);
    return true;
  }

  function injectAutoClearDropdown(panel) {
    if (!window.WJP_ChatCore) return;
    if (panel.querySelector('#aicoach-autoclear-card')) return;

    const opts = [
      { v: 0,    label: 'Clear each session', hint: 'Default — fresh chat every time you load the page' },
      { v: 5,    label: '5 minutes inactive',   hint: 'Clear if no activity for 5 minutes' },
      { v: 15,   label: '15 minutes inactive',  hint: 'Clear if no activity for 15 minutes' },
      { v: 30,   label: '30 minutes inactive',  hint: 'Clear if no activity for 30 minutes' },
      { v: 60,   label: '1 hour inactive',      hint: 'Clear if no activity for 1 hour' },
      { v: 240,  label: '4 hours inactive',     hint: 'Clear if no activity for 4 hours' },
      { v: 1440, label: '24 hours inactive',    hint: 'Maximum — chat persists at most 1 day' },
    ];

    const cur = window.WJP_ChatCore.getAutoClearMinutes();

    const card = document.createElement('div');
    card.id = 'aicoach-autoclear-card';
    card.className = 'settings-card';
    card.style.cssText = 'margin-top: 16px;';
    card.innerHTML = `
      <div class="settings-card-title">Privacy: auto-clear chat</div>
      <div class="settings-card-hint" style="margin-bottom:12px;">
        For privacy and to prevent stale context, conversations are wiped after a period of inactivity.
        Default is to clear at the start of every new session.
      </div>
      <div class="settings-row">
        <div class="settings-row-label">Auto-clear after</div>
        <div class="settings-row-value">
          <select id="aicoach-autoclear-select" class="settings-input" style="min-width:230px;">
            ${opts.map(o => `<option value="${o.v}" ${o.v === cur ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="settings-row" style="border-top:none;padding-top:0;">
        <div style="font-size:11px;color:var(--text-3);font-style:italic;">
          ${opts.find(o => o.v === cur)?.hint || ''}
        </div>
      </div>
    `;

    // Insert after the model info row at the top, before the Maintenance card
    const maint = panel.querySelector('button#set-ai-clear');
    const targetCard = maint ? (maint.closest('.settings-card') || maint.closest('[class*="card"]')) : null;
    if (targetCard && targetCard.parentNode) {
      targetCard.parentNode.insertBefore(card, targetCard);
    } else {
      panel.appendChild(card);
    }

    // Wire dropdown
    const sel = card.querySelector('#aicoach-autoclear-select');
    if (sel) {
      sel.addEventListener('change', () => {
        window.WJP_ChatCore.setAutoClearMinutes(parseInt(sel.value, 10));
        // Re-render hint line
        const hint = opts.find(o => o.v === parseInt(sel.value, 10))?.hint || '';
        const hintEl = card.querySelector('.settings-row[style*="border-top:none"] div');
        if (hintEl) hintEl.textContent = hint;
        if (typeof window.showToast === 'function') {
          window.showToast(`Chat will auto-clear ${opts.find(o => o.v === parseInt(sel.value, 10))?.label.toLowerCase() || ''}`);
        }
      });
    }
  }

  function injectAdminTierSwitcher(panel) {
    if (!window.WJP_ChatCore || !window.WJP_ChatCore.isActuallyAdmin()) return;
    if (panel.querySelector('#aicoach-admin-tier-card')) return;

    const card = document.createElement('div');
    card.id = 'aicoach-admin-tier-card';
    card.className = 'settings-card';
    card.style.cssText = 'border:2px dashed rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.04); margin-top: 16px;';
    const cur = (function () { try { return localStorage.getItem('wjp.adminTierOverride') || 'auto'; } catch { return 'auto'; } })();
    const tiers = [
      { key: 'auto',     label: 'Auto (real)',  hint: 'Use your actual admin tier' },
      { key: 'free',     label: 'Free',         hint: '5 cloud requests/day' },
      { key: 'pro',      label: 'Pro',          hint: '50 cloud requests/day' },
      { key: 'trial',    label: 'Trial',        hint: 'Pro Plus during 14-day trial · unlimited' },
      { key: 'pro_plus', label: 'Pro Plus',     hint: 'Unlimited' },
      { key: 'admin',    label: 'Admin',        hint: 'Unlimited (you)' },
    ];

    card.innerHTML = `
      <div class="settings-card-title" style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(168,85,247,0.15);color:#a855f7;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;border:1px solid rgba(168,85,247,0.35);">
          <i class="ph-fill ph-shield-star"></i> Admin only
        </span>
        Test as a different tier
      </div>
      <div class="settings-card-hint" style="margin-bottom:14px;">
        Override the tier you experience in the AI Coach so you can verify limits, fallback behavior,
        and copy at each level. Regular users never see this card.
      </div>
      <div class="aicoach-tier-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
        ${tiers.map(t => `
          <button class="aicoach-tier-btn" data-tier="${t.key}" type="button"
            style="text-align:left;padding:11px 13px;border-radius:10px;border:2px solid ${cur===t.key?'var(--accent)':'var(--border)'};background:${cur===t.key?'var(--accent-dim)':'var(--card-2)'};cursor:pointer;font-family:inherit;color:var(--text);transition:all 0.15s;">
            <div style="font-size:13px;font-weight:700;margin-bottom:2px;">${t.label}${cur===t.key?' <span style=\'color:var(--accent-text,var(--accent));\'>●</span>':''}</div>
            <div style="font-size:11px;color:var(--text-3);line-height:1.4;">${t.hint}</div>
          </button>
        `).join('')}
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-3);">
        ${cur === 'auto' ? '<i class="ph ph-check-circle" style="color:#16a34a;"></i> No override active. You see your real admin tier (unlimited).' : `<i class="ph-fill ph-warning" style="color:#f59e0b;"></i> Currently testing as <strong>${cur}</strong>. Switch to <em>Auto (real)</em> to revert.`}
      </div>
    `;

    // Append after the Maintenance card if found, else at the end of panel content
    const maint = panel.querySelector('button#set-ai-clear');
    const targetCard = maint ? (maint.closest('.settings-card') || maint.closest('[class*="card"]')) : null;
    if (targetCard && targetCard.parentNode) targetCard.parentNode.insertBefore(card, targetCard.nextSibling);
    else panel.appendChild(card);

    // Wire tier buttons
    card.querySelectorAll('.aicoach-tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tier;
        if (window.WJP_ChatCore.setAdminTierOverride(t)) {
          // Toast feedback
          if (typeof window.showToast === 'function') {
            window.showToast(t === 'auto' ? 'Reverted to real admin tier' : `Now testing as ${t}`);
          }
          // Re-render this card to reflect new active state
          card.remove();
          injectAdminTierSwitcher(panel);
          // Refresh the model info row + every visible usage bar
          renderUsageInside();
          document.querySelectorAll('.wjp-usage-host').forEach(h => {
            try { window.dispatchEvent(new CustomEvent('wjp:aichat:usage')); } catch {}
          });
        }
      });
    });
  }

  function renderModelInfoCard() {
    const u = window.WJP_ChatCore ? window.WJP_ChatCore.getUsageInfo() : { unlimited: true, tier: 'free', used: 0, limit: 5 };
    const tierLabel = u.tier === 'admin' ? 'Admin' :
                      u.tier === 'trial' ? 'Trial · Pro Plus' :
                      u.tier === 'pro_plus' ? 'Pro Plus' :
                      u.tier === 'pro' ? 'Pro' : 'Free';
    const usageHtml = u.unlimited
      ? '<span style="color:var(--accent);font-weight:700;"><i class="ph-fill ph-infinity"></i> Unlimited</span>'
      : `<span><strong>${u.used}/${u.limit}</strong> used today · <span style="opacity:0.7;">${u.remaining} left</span></span>`;
    return `
      <div class="settings-row" id="aicoach-model-info-row">
        <div class="settings-row-label">Current model</div>
        <div class="settings-row-value" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--accent-dim);color:var(--accent-text,var(--accent));border:1px solid var(--border-accent);font-size:12px;font-weight:700;">
              <i class="ph-fill ph-sparkle"></i> Claude Haiku 4.5
            </span>
            <span style="font-size:11px;color:var(--text-3);">via Anthropic · auto-falls-back to Llama 3.3 70B (Groq)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-2);">
            <span style="background:var(--card-2);padding:3px 9px;border-radius:999px;border:1px solid var(--border);font-weight:600;">${tierLabel}</span>
            ${usageHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderUsageInside() {
    const row = document.getElementById('aicoach-model-info-row');
    if (!row) return;
    row.outerHTML = renderModelInfoCard();
  }

  // Watch for Settings panel mounts. The Settings page mounts its content
  // dynamically when navigating there. We poll on body for #set-ai-model.
  function wireObserver() {
    if (patchPanel()) return;
    const obs = new MutationObserver(() => { if (patchPanel()) {} });
    obs.observe(document.body, { childList: true, subtree: true });
    // Belt-and-suspenders: also try every 1.5s for the first 30s
    let polls = 0;
    const t = setInterval(() => {
      polls++;
      patchPanel();
      if (polls > 20) clearInterval(t);
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireObserver);
  else wireObserver();

  // Refresh usage display when ChatCore broadcasts usage changes
  window.addEventListener('wjp:aichat:usage', renderUsageInside);
})();
