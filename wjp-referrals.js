/* ============================================================================
   WJP Referrals (W3) — referral code generation, tracking, attribution.
   5 PAID referrals = 1 year free top-tier. Tracked in Firestore via backend.
   Code format: WJP-{first3letters firstName upper}-{4 random chars}
   Referrer gets credit only when referred user activates a paid subscription.
   30-day clawback if referred cancels.
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpReferralsInstalled) return;
  window._wjpReferralsInstalled = true;

  const REF_PARAM = 'ref';
  const REF_KEY = 'wjp.referral.attributedTo';

  // Capture inbound referral on landing page
  function captureInbound() {
    try {
      const url = new URL(location.href);
      const code = url.searchParams.get(REF_PARAM);
      if (code) {
        // Persist for 30 days — submitted to backend at signup
        sessionStorage.setItem(REF_KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
        try { localStorage.setItem(REF_KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() })); } catch(_) {}
      }
    } catch(_) {}
  }

  function attribution() {
    try {
      const raw = sessionStorage.getItem(REF_KEY) || localStorage.getItem(REF_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (Date.now() - v.at > 30 * 86400000) return null;
      return v.code || null;
    } catch(_) { return null; }
  }

  function generateCode(firstName, uid) {
    const stem = String(firstName || 'WJP').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3) || 'WJP';
    const rand = (uid ? uid.slice(-4) : Math.random().toString(36).slice(2,6)).toUpperCase().replace(/[^A-Z0-9]/g,'X').slice(0,4);
    return `WJP-${stem}-${rand}`;
  }

  function shareUrl(code) {
    return `https://wjpdebttracking.com/intro.html?ref=${encodeURIComponent(code)}`;
  }

  // Render referral card into a settings/referrals area
  function renderInto(el, opts) {
    if (!el) return;
    opts = opts || {};
    const firstName = opts.firstName || (window.appState && window.appState.user && window.appState.user.firstName) || '';
    const uid = opts.uid || (window.appState && window.appState.user && window.appState.user.uid) || '';
    const code = generateCode(firstName, uid);
    const url = shareUrl(code);
    const paidRefs = opts.paidReferrals || 0;
    const needed = Math.max(0, 5 - paidRefs);

    el.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(31,122,74,0.08),rgba(201,154,42,0.05));border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:22px;font-family:var(--sans,Inter,system-ui);">
        <h3 style="font-family:var(--sans,Inter,system-ui,sans-serif);font-size:22px;margin:0 0 8px;letter-spacing:-0.02em;color:var(--ink,#0a0a0a);">Refer 5 paid friends → 1 year free Pro Plus.</h3>
        <p style="font-size:13.5px;line-height:1.55;color:var(--ink-dim,#6b7280);margin:0 0 18px;">Share your code. When 5 people use it AND activate a paid subscription, we comp you a full year of Pro Plus ($299 value). 30-day clawback if a referred user cancels.</p>
        <div style="background:#fff;border:1px solid var(--border,#d8d3c4);border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <code style="font-size:15px;font-weight:800;color:#1f7a4a;letter-spacing:0.04em;">${code}</code>
          <div style="display:flex;gap:6px;">
            <button id="wjp-ref-copy" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Copy code</button>
            <button id="wjp-ref-copyurl" style="background:#fff;color:#1f7a4a;border:1px solid #1f7a4a;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Copy link</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink-dim,#6b7280);">
          <span><strong style="color:#1f7a4a;font-size:15px;">${paidRefs}</strong> / 5 paid referrals</span>
          <span>${needed > 0 ? needed + ' more for free year' : '🎉 Year unlocked!'}</span>
        </div>
        <div style="height:6px;background:var(--bg,#fafaf7);border-radius:3px;margin-top:6px;overflow:hidden;">
          <div style="height:100%;width:${(paidRefs/5)*100}%;background:linear-gradient(90deg,#1f7a4a,#2b9b72);transition:width 0.3s;"></div>
        </div>
        <p style="font-size:11px;color:var(--ink-dim,#6b7280);margin:14px 0 0;line-height:1.5;"><strong>Fine print:</strong> Referrals only count when the referred user activates a paid subscription (not just signs up). 30-day clawback if they cancel. Self-referrals and same-IP signups do not count.</p>
      </div>
    `;
    const cb = document.getElementById('wjp-ref-copy');
    const cu = document.getElementById('wjp-ref-copyurl');
    if (cb) cb.addEventListener('click', () => { navigator.clipboard.writeText(code); cb.textContent = 'Copied ✓'; setTimeout(()=>cb.textContent='Copy code', 1800); });
    if (cu) cu.addEventListener('click', () => { navigator.clipboard.writeText(url); cu.textContent = 'Copied ✓'; setTimeout(()=>cu.textContent='Copy link', 1800); });
  }

  captureInbound();

  // Auto-render if a referrals container exists
  function tryRender() {
    const el = document.querySelector('[data-wjp-referrals]');
    if (el) renderInto(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryRender);
  else tryRender();

  window.WJP_Referrals = {
    capture: captureInbound,
    attribution,
    generateCode,
    shareUrl,
    render: renderInto
  };
})();
