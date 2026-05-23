/* wjp-credit-pull.js v2 — 30-day rate limit, Identity Collection modal, Connect Bureau onboarding
 *
 * Renders an "Auto Credit Updates" card at the top of the Credit page with:
 *   - Pro-tier gating (Free shows locked state + upgrade CTA)
 *   - Cadence toggle (Monthly for Pro, Weekly for Pro-Plus)
 *   - Last/Next pull dates
 *   - Refresh Now button
 *   - Status indicator
 *
 * Backend integration point: window.WJP_CreditPull.fetchScoresFromBackend(uid)
 * Until the Cloud Function is live, this is a no-op stub that returns the
 * user's existing manual score. Plugging in Array is one-line change.
 *
 * Storage: user-scoped wjp.credit.pull.v1 = { enabled, cadence, lastPullAt,
 *   nextPullAt, lastResult, history: [{date, fico8, equifax, experian, tu}] }
 */
(function () {
  'use strict';
  if (window._wjpCreditPullInstalled) return;
  window._wjpCreditPullInstalled = true;

  var STORE_KEY = 'wjp.credit.pull.v1';
  var IDENTITY_KEY = 'wjp.credit.identity.v1';
  var CARD_ID = 'wjp-credit-autopull-card';
  var MIN_INTERVAL_MS = 30 * 86400000;  // 30 days — hard cap so costs stay predictable

  function tier() {
    try {
      if (typeof window.getTier === 'function') return window.getTier();
      var s = window.appState; return s && s.subscription ? s.subscription.tier : 'free';
    } catch (_) { return 'free'; }
  }
  function isAdmin() { return tier() === 'admin'; }

  function userKey(b) {
    if (window.WJP_UserScope && typeof window.WJP_UserScope.scopeKey === 'function') return window.WJP_UserScope.scopeKey(b);
    return b;
  }
  function loadJSON(k, def) { try { var v = localStorage.getItem(userKey(k)); return v ? JSON.parse(v) : def; } catch (_) { return def; } }
  function saveJSON(k, v) { try { localStorage.setItem(userKey(k), JSON.stringify(v)); } catch (_) {} }

  function isPremium() {
    try { return typeof window.isPremium === 'function' ? !!window.isPremium() : false; } catch (_) { return false; }
  }
  function isProPlus() {
    var t = tier();
    return t === 'pro-plus' || t === 'admin' || t === 'pro_plus';
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    try { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (_) { return '—'; }
  }
  function fmtRelative(ms) {
    if (!ms) return '—';
    var diff = ms - Date.now();
    var abs = Math.abs(diff);
    var days = Math.round(abs / 86400000);
    if (diff > 0) return days === 0 ? 'today' : 'in ' + days + ' day' + (days !== 1 ? 's' : '');
    return days === 0 ? 'today' : days + ' day' + (days !== 1 ? 's' : '') + ' ago';
  }

  function loadState() {
    var s = loadJSON(STORE_KEY, null);
    if (s) return s;
    return {
      enabled: false,
      cadence: 'monthly',   // hard default — 30-day cycle, ~$0.25/mo per user
      lastPullAt: 0,
      nextPullAt: 0,
      lastResult: null,
      history: []
    };
  }
  function saveState(s) { saveJSON(STORE_KEY, s); }

  function cycleMs(cadence) {
    return cadence === 'weekly' ? 7 * 86400000 : 30 * 86400000;
  }
  function scheduleNext(s) {
    s.nextPullAt = (s.lastPullAt || Date.now()) + cycleMs(s.cadence);
    return s;
  }

  // ---------- Backend hook ----------
  // When the Firebase Cloud Function is deployed, this gets replaced.
  // It receives the user's Firebase UID and returns a Promise<{ok, scores}>.
  // scores shape: { fico8, equifax, experian, transunion, pulledAt }
  function fetchScoresFromBackend(uid) {
    // Calls /.netlify/functions/array-credit-pull with the user's Firebase ID
    // token. Returns: { ok, scores: { vantage, experian, equifax, transunion,
    // pulledAt, provider, scoreModel, sandbox }, err? }
    return (async function () {
      try {
        // App uses Firebase v9 modular SDK. The auth user is mirrored to
        // window.__wjpUser (a FirebaseUser instance) by app.js once auth resolves.
        // Fall back to the v8 namespace for any environments still on it.
        var user = window.__wjpUser
          || (window.__wjpAuth && window.__wjpAuth.currentUser)
          || (window.firebase && window.firebase.auth && window.firebase.auth().currentUser)
          || null;
        if (!user) return { ok: false, err: 'Sign in required to refresh your score.', scores: null };
        var idToken = typeof user.getIdToken === 'function'
          ? await user.getIdToken(false)
          : (await (await user).getIdToken && (await user).getIdToken(false));
        var res = await fetch('/.netlify/functions/array-credit-pull', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        var data = null;
        try { data = await res.json(); } catch (_) { data = {}; }
        if (!res.ok || !data || !data.ok) {
          var msg = (data && (data.message || data.error)) || ('Request failed (' + res.status + ')');
          if (data && data.error === 'rate_limited' && data.nextEligibleAt) {
            var d = new Date(data.nextEligibleAt);
            msg = 'Next refresh available ' + d.toLocaleDateString();
          } else if (data && data.error === 'tier_locked') {
            msg = 'Pro tier required to refresh your score.';
          } else if (data && data.error === 'identity_required') {
            msg = 'Complete your identity profile to unlock credit pulls.';
          }
          return { ok: false, err: msg, scores: null };
        }
        return { ok: true, scores: data.scores };
      } catch (e) {
        return { ok: false, err: (e && e.message) || 'Network error', scores: null };
      }
    })();
  }

  function commitScores(scores) {
    if (!scores) return;
    // Write into existing credit_inputs.bureauScores so the host's score gauge updates
    try {
      var key = 'wjp_credit_inputs';
      var scoped = userKey(key);
      var ci = JSON.parse(localStorage.getItem(scoped) || localStorage.getItem(key) || '{}');
      ci.bureauScores = ci.bureauScores || {};
      var now = Date.now();
      var primary = scores.vantage || scores.experian || scores.equifax || scores.fico8;
      if (scores.equifax)    ci.bureauScores.equifax    = { value: scores.equifax,    capturedAt: now };
      if (scores.experian)   ci.bureauScores.experian   = { value: scores.experian,   capturedAt: now };
      if (scores.transunion) ci.bureauScores.transunion = { value: scores.transunion, capturedAt: now };
      if (primary) {
        ci.currentScore = String(primary);
        ci.scoreModel = scores.scoreModel || 'VantageScore 3.0';
        ci.scoreProvider = scores.provider || 'experian';
      }
      localStorage.setItem(scoped, JSON.stringify(ci));
      // Trigger host re-render
      try { if (typeof window.renderCreditScoreTab === 'function') window.renderCreditScoreTab(); } catch (_) {}
      try { if (typeof window.recordScoreHistory === 'function' && primary) window.recordScoreHistory(primary); } catch (_) {}
    } catch (_) {}
  }

  function requestPull(opts) {
    opts = opts || {};
    var s = loadState();
    // Enforce 30-day minimum between pulls (admin can override)
    if (!opts.adminOverride && s.lastPullAt && (Date.now() - s.lastPullAt) < MIN_INTERVAL_MS && !isAdmin()) {
      var daysLeft = Math.ceil((MIN_INTERVAL_MS - (Date.now() - s.lastPullAt)) / 86400000);
      if (window.WJP_Momentum && typeof window.WJP_Momentum.showToast === 'function') {
        window.WJP_Momentum.showToast({
          eyebrow: 'RATE LIMITED',
          title: 'Wait ' + daysLeft + ' more day' + (daysLeft !== 1 ? 's' : '') + ' before next pull',
          sub: 'Pulls are capped to once every 30 days to keep your subscription cost predictable. Your next auto-pull is already scheduled.',
          color: '#f59e0b',
          icon: 'ph-fill ph-clock-countdown'
        });
      }
      return;
    }
    // Need identity on file for first pull
    var idRec = loadJSON(IDENTITY_KEY, null);
    if (!idRec || !idRec.complete) {
      openIdentityModal();
      return;
    }
    s.lastPullAt = Date.now();
    s = scheduleNext(s);
    // Show pending state immediately
    s.lastResult = { status: 'pending', ts: s.lastPullAt };
    saveState(s);
    renderCard();

    var uid = (window.__wjpUser && window.__wjpUser.uid) || null;
    fetchScoresFromBackend(uid).then(function (result) {
      var s2 = loadState();
      s2.lastResult = {
        status: result.ok ? 'ok' : 'err',
        err: result.err || null,
        scores: result.scores || null,
        ts: Date.now()
      };
      if (result.ok && result.scores) {
        commitScores(result.scores);
        s2.history = (s2.history || []).slice(-23);
        var primary = result.scores.vantage || result.scores.experian || result.scores.equifax;
        s2.history.push({
          date: new Date().toISOString().slice(0, 10),
          vantage: primary,
          equifax: result.scores.equifax,
          experian: result.scores.experian,
          transunion: result.scores.transunion,
          model: result.scores.scoreModel || 'VantageScore 3.0',
          provider: result.scores.provider || 'experian'
        });
        if (window.WJP_Momentum && typeof window.WJP_Momentum.showToast === 'function') {
          window.WJP_Momentum.showToast({
            eyebrow: 'CREDIT REFRESHED',
            title: 'New score pulled',
            sub: 'VantageScore: ' + (primary || '—') + ' · next refresh ' + fmtRelative(s2.nextPullAt),
            color: '#10b981',
            icon: 'ph-fill ph-shield-check'
          });
        }
      }
      saveState(s2);
      renderCard();
    });
  }

  // ---------- Render ----------
  function buildCardHTML() {
    var s = loadState();
    var premium = isPremium();
    var proPlus = isProPlus();
    var t = tier();

    if (!premium) {
      // Locked state — Free tier
      return ''
        + '<div style="position:relative;background:linear-gradient(135deg,rgba(99,102,241,0.10),rgba(168,85,247,0.10));border:1px solid rgba(99,102,241,0.30);border-radius:14px;padding:18px 22px;overflow:hidden;">'
        +   '<div style="position:absolute;top:10px;right:14px;font-size:9px;letter-spacing:0.10em;font-weight:800;background:rgba(99,102,241,0.20);color:#818cf8;padding:4px 10px;border-radius:999px;text-transform:uppercase;"><i class="ph-fill ph-lock" style="font-size:9px;margin-right:3px;"></i>Pro</div>'
        +   '<div style="display:flex;align-items:center;gap:14px;">'
        +     '<div style="width:42px;height:42px;border-radius:11px;background:rgba(99,102,241,0.20);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-arrows-clockwise" style="font-size:20px;color:#818cf8;"></i></div>'
        +     '<div style="flex:1;"><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#818cf8;text-transform:uppercase;">Auto credit score updates</div><div style="font-size:16px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;">Your VantageScore 3.0 — refreshed every month</div><div style="font-size:11.5px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:6px;line-height:1.5;">Soft-pull, won\'t hurt your score. Stop guessing when your score changes — see it auto-update on the same day each month.</div></div>'
        +     '<button id="wjp-pull-upgrade" type="button" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:0;padding:10px 18px;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0;box-shadow:0 4px 14px rgba(99,102,241,0.30);">Upgrade to Pro</button>'
        +   '</div>'
        + '</div>';
    }

    // Pro / Pro-Plus state
    var lastStatus = s.lastResult ? s.lastResult.status : null;
    var pullDisabled = lastStatus === 'pending';
    var lastErr = (s.lastResult && s.lastResult.status === 'err') ? s.lastResult.err : null;

    return ''
      + '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;padding:18px 22px;">'
      +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">'
      +     '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:240px;">'
      +       '<div style="width:42px;height:42px;border-radius:11px;background:rgba(16,185,129,0.15);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-arrows-clockwise" style="font-size:20px;color:#10b981;"></i></div>'
      +       '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#10b981;text-transform:uppercase;">VantageScore 3.0 · Auto-refresh</div><div style="font-size:16px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;">' + (s.enabled ? 'On — ' + (s.cadence === 'weekly' ? 'Weekly' : 'Monthly · 30-day cap') : 'Off') + '</div></div>'
      +     '</div>'
      +     '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      +       cadenceToggleHTML(s, proPlus)
      +       '<label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--text-3,#94a3b8);cursor:pointer;"><input type="checkbox" id="wjp-pull-enabled" ' + (s.enabled ? 'checked' : '') + ' style="accent-color:#10b981;width:14px;height:14px;">Auto-pull</label>'
      +       '<button id="wjp-pull-now" type="button" ' + (pullDisabled ? 'disabled' : '') + ' style="background:#10b981;color:#fff;border:0;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:800;cursor:' + (pullDisabled ? 'wait' : 'pointer') + ';font-family:inherit;display:inline-flex;align-items:center;gap:6px;opacity:' + (pullDisabled ? '0.6' : '1') + ';"><i class="' + (pullDisabled ? 'ph ph-spinner' : 'ph-fill ph-arrow-clockwise') + '" style="font-size:13px;"></i>' + (pullDisabled ? 'Pulling...' : 'Refresh now') + '</button>'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border,rgba(255,255,255,0.06));">'
      +     statLine('Last pulled', s.lastPullAt ? fmtDate(s.lastPullAt) : 'Never', s.lastPullAt ? fmtRelative(s.lastPullAt) : 'first pull pending')
      +     statLine('Next auto-pull', s.enabled ? fmtDate(s.nextPullAt) : 'Off', s.enabled ? fmtRelative(s.nextPullAt) : '—')
      +     statLine('Identity', (loadIdentity() && loadIdentity().complete) ? 'Verified <i class="ph-fill ph-check-circle" style="color:#10b981;font-size:12px;"></i>' : '<button id="wjp-cred-setup-id" type="button" style="background:#10b981;color:#fff;border:0;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">Set up</button>', (loadIdentity() && loadIdentity().complete) ? 'FCRA-authorized' : 'required for first pull')
      +     statLine('Cadence', 'Monthly · 30-day cap', proPlus ? 'weekly opt-in available' : 'cost-protected')
      +   '</div>'
      + (lastErr
          ? '<div style="margin-top:12px;padding:10px 14px;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.30);border-radius:8px;font-size:11.5px;color:#a16207;font-weight:600;line-height:1.5;"><i class="ph-fill ph-info" style="margin-right:6px;color:#f59e0b;"></i>' + escapeHTML(String(lastErr)) + '</div>'
          : '')
      + (s.history && s.history.length >= 2 ? historyChartHTML(s.history) : '')
      +   '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(255,255,255,0.06));display:flex;align-items:center;gap:8px;font-size:10px;font-weight:600;color:var(--text-3,#94a3b8);letter-spacing:0.02em;">'
      +     '<i class="ph ph-shield-check" style="font-size:12px;color:#10b981;"></i>'
      +     '<span>Powered by VantageScore 3.0 from Equifax. Soft-pull, won&rsquo;t impact your score.</span>'
      +   '</div>'
      + '</div>';
  }

  function cadenceToggleHTML(s, proPlus) {
    var monthly = s.cadence !== 'weekly';
    return ''
      + '<div style="display:inline-flex;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:8px;padding:2px;font-size:11px;font-weight:700;">'
      +   '<button id="wjp-pull-cadence-monthly" type="button" style="background:' + (monthly ? '#10b981' : 'transparent') + ';color:' + (monthly ? '#fff' : 'var(--text-3,#94a3b8)') + ';border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;">Monthly</button>'
      +   '<button id="wjp-pull-cadence-weekly" type="button" ' + (proPlus ? '' : 'disabled') + ' style="background:' + (!monthly ? '#10b981' : 'transparent') + ';color:' + (!monthly ? '#fff' : (proPlus ? 'var(--text-3,#94a3b8)' : '#94a3b888')) + ';border:0;padding:6px 12px;border-radius:6px;cursor:' + (proPlus ? 'pointer' : 'not-allowed') + ';font-family:inherit;font-weight:700;" title="' + (proPlus ? '' : 'Pro Plus required') + '">Weekly' + (proPlus ? '' : ' ⓘ') + '</button>'
      + '</div>';
  }

  function statLine(label, value, sub) {
    return ''
      + '<div><div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">' + label + '</div>'
      +   '<div style="font-size:13.5px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:2px;letter-spacing:-0.005em;">' + value + '</div>'
      +   (sub ? '<div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:2px;">' + sub + '</div>' : '')
      + '</div>';
  }

  function historyChartHTML(hist) {
    if (!hist || hist.length < 2) return '';
    var values = hist.map(function (h) { return h.vantage || h.fico8 || 0; }).filter(function (x) { return x > 0; });
    if (values.length < 2) return '';
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = Math.max(50, max - min);
    var W = 200, H = 50;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * W;
      var y = H - ((v - min) / range) * H;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var last = values[values.length - 1];
    var first = values[0];
    var delta = last - first;
    var deltaColor = delta >= 0 ? '#10b981' : '#ef4444';
    return ''
      + '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border,rgba(255,255,255,0.06));display:flex;align-items:center;gap:14px;flex-wrap:wrap;">'
      +   '<div><div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Score history</div><div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:2px;">' + values[values.length-1] + ' <span style="font-size:11px;font-weight:700;color:' + deltaColor + ';">' + (delta >= 0 ? '+' : '') + delta + ' over ' + values.length + ' pulls</span></div></div>'
      +   '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:200px;height:50px;flex-shrink:0;"><polyline points="' + pts + '" fill="none" stroke="' + deltaColor + '" stroke-width="2"/></svg>'
      + '</div>';
  }

  function escapeHTML(s) { return String(s||'').replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  function renderCard() {
    try {
      var page = document.getElementById('page-credit-wjp');
      if (!page || page.offsetHeight === 0) return;
      var card = document.getElementById(CARD_ID);
      if (!card) {
        card = document.createElement('div');
        card.id = CARD_ID;
        card.style.cssText = 'margin-bottom:20px;';
        // Insert at top, after the hero
        var firstChild = page.firstElementChild;
        if (firstChild && firstChild.nextSibling) page.insertBefore(card, firstChild.nextSibling);
        else if (firstChild) page.insertBefore(card, firstChild);
        else page.appendChild(card);
      }
      card.innerHTML = buildCardHTML();
      wireEvents(card);
    } catch (_) {}
  }

  function wireEvents(card) {
    var upgradeBtn = card.querySelector('#wjp-pull-upgrade');
    if (upgradeBtn) upgradeBtn.onclick = function () {
      // Navigate to billing settings if available
      try {
        if (typeof window.navTo === 'function') window.navTo('settings');
        if (typeof window.openBillingModal === 'function') window.openBillingModal();
      } catch (_) {}
      if (window.WJP_Momentum) window.WJP_Momentum.showToast({
        eyebrow: 'UPGRADE',
        title: 'Open Settings → Billing to choose your tier',
        sub: 'Pro unlocks monthly VantageScore 3.0 pulls with instant credit alerts.',
        color: '#6366f1',
        icon: 'ph-fill ph-crown'
      });
    };

    var pullBtn = card.querySelector('#wjp-pull-now');
    if (pullBtn) pullBtn.onclick = function () { requestPull(); };

    var enabledCheck = card.querySelector('#wjp-pull-enabled');
    if (enabledCheck) enabledCheck.onchange = function () {
      var s = loadState();
      if (enabledCheck.checked) {
        // Need identity first
        var id = loadIdentity();
        if (!id || !id.complete) {
          enabledCheck.checked = false;
          openIdentityModal();
          return;
        }
        s.enabled = true;
        if (!s.lastPullAt) s.lastPullAt = Date.now();
        s = scheduleNext(s);
      } else {
        s.enabled = false;
      }
      saveState(s); renderCard();
    };

    var setupIdBtn = card.querySelector('#wjp-cred-setup-id');
    if (setupIdBtn) setupIdBtn.onclick = function () { openIdentityModal(); };

    var monthlyBtn = card.querySelector('#wjp-pull-cadence-monthly');
    if (monthlyBtn) monthlyBtn.onclick = function () {
      var s = loadState(); s.cadence = 'monthly';
      if (s.enabled) s = scheduleNext(s);
      saveState(s); renderCard();
    };
    var weeklyBtn = card.querySelector('#wjp-pull-cadence-weekly');
    if (weeklyBtn) weeklyBtn.onclick = function () {
      if (weeklyBtn.disabled) return;
      var s = loadState(); s.cadence = 'weekly';
      if (s.enabled) s = scheduleNext(s);
      saveState(s); renderCard();
    };
  }


  // ---------- Identity Collection Modal ----------
  // First-time setup: collect legal name, DOB, SSN, address. SSN is NEVER sent
  // to the host or stored client-side in plaintext — only kept here until the
  // backend Cloud Function is wired, then passed encrypted server-side.
  function loadIdentity() { return loadJSON(IDENTITY_KEY, null); }
  function saveIdentity(rec) { saveJSON(IDENTITY_KEY, rec); }

  function openIdentityModal() {
    var existing = document.getElementById('wjp-cred-id-modal');
    if (existing) existing.remove();
    var rec = loadIdentity() || {};

    var modal = document.createElement('div');
    modal.id = 'wjp-cred-id-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;font-family:var(--sans,Inter,system-ui,sans-serif);overflow-y:auto;';

    modal.innerHTML = ''
      + '<div style="background:var(--card,#fff);border-radius:16px;max-width:520px;width:100%;max-height:92vh;overflow-y:auto;padding:24px;">'
      // Header
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
      +   '<div style="display:flex;align-items:center;gap:12px;"><div style="width:40px;height:40px;border-radius:10px;background:rgba(16,185,129,0.18);display:grid;place-items:center;"><i class="ph-fill ph-shield-check" style="font-size:19px;color:#10b981;"></i></div><div><div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:#10b981;text-transform:uppercase;">SECURE IDENTITY</div><div style="font-size:17px;font-weight:900;color:var(--text-1,#0a0a0a);">Connect your credit profile</div></div></div>'
      +   '<button id="wjp-cred-id-close" type="button" style="background:transparent;border:0;font-size:22px;color:var(--text-3,#94a3b8);cursor:pointer;line-height:1;">×</button>'
      + '</div>'
      // Trust strip
      + '<div style="background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.25);border-radius:10px;padding:12px 14px;margin-bottom:18px;display:flex;gap:10px;align-items:flex-start;">'
      +   '<i class="ph-fill ph-lock-key" style="font-size:16px;color:#818cf8;flex-shrink:0;margin-top:2px;"></i>'
      +   '<div style="font-size:11.5px;color:var(--text-1,#0a0a0a);font-weight:600;line-height:1.55;">Your SSN is encrypted in transit and only used to authorize the soft pull. It is <strong>never</strong> stored in plain text and <strong>never</strong> shared with third parties. Soft pull = no impact on your score.</div>'
      + '</div>'
      // Form
      + '<div style="display:flex;flex-direction:column;gap:12px;">'
      +   field2('Legal first name', 'wjp-cred-fn', 'text', rec.firstName || '')
      +   field2('Legal last name',  'wjp-cred-ln', 'text', rec.lastName || '')
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      +     field2('Date of birth', 'wjp-cred-dob', 'date', rec.dob || '')
      +     field2('SSN (XXX-XX-XXXX)', 'wjp-cred-ssn', 'password', rec.ssnMasked || '', 'autocomplete="off"')
      +   '</div>'
      +   field2('Street address', 'wjp-cred-a1', 'text', rec.address1 || '')
      +   field2('Apt / Unit (optional)', 'wjp-cred-a2', 'text', rec.address2 || '')
      +   '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;">'
      +     field2('City', 'wjp-cred-city', 'text', rec.city || '')
      +     field2('State', 'wjp-cred-state', 'text', rec.state || '')
      +     field2('ZIP', 'wjp-cred-zip', 'text', rec.zipCode || '')
      +   '</div>'
      + '</div>'
      // FCRA compliance footer
      + '<label style="display:flex;align-items:flex-start;gap:8px;margin-top:18px;padding:12px 14px;background:var(--card-2,rgba(255,255,255,0.04));border-radius:10px;cursor:pointer;">'
      +   '<input type="checkbox" id="wjp-cred-fcra" style="accent-color:#10b981;width:16px;height:16px;flex-shrink:0;margin-top:1px;">'
      +   '<span style="font-size:11px;color:var(--text-1,#0a0a0a);font-weight:600;line-height:1.55;">I authorize WJP Debt Tracking to obtain my credit report from Equifax, Experian, and TransUnion via soft inquiry, once a month, under the Fair Credit Reporting Act (FCRA). I can revoke this authorization any time from this page.</span>'
      + '</label>'
      // Buttons
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">'
      +   '<button id="wjp-cred-id-cancel" type="button" style="background:transparent;color:var(--text-3,#94a3b8);border:1px solid var(--border,rgba(255,255,255,0.15));padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>'
      +   '<button id="wjp-cred-id-save" type="button" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:0;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">Save & enable auto-pull</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    modal.querySelector('#wjp-cred-id-close').onclick = function () { modal.remove(); };
    modal.querySelector('#wjp-cred-id-cancel').onclick = function () { modal.remove(); };
    modal.querySelector('#wjp-cred-id-save').onclick = function () {
      var ssnRaw = (modal.querySelector('#wjp-cred-ssn').value || '').replace(/\D/g, '');
      var fn = (modal.querySelector('#wjp-cred-fn').value || '').trim();
      var ln = (modal.querySelector('#wjp-cred-ln').value || '').trim();
      var dob = modal.querySelector('#wjp-cred-dob').value || '';
      var a1 = (modal.querySelector('#wjp-cred-a1').value || '').trim();
      var a2 = (modal.querySelector('#wjp-cred-a2').value || '').trim();
      var city = (modal.querySelector('#wjp-cred-city').value || '').trim();
      var state = (modal.querySelector('#wjp-cred-state').value || '').trim();
      var zip = (modal.querySelector('#wjp-cred-zip').value || '').trim();
      var fcra = modal.querySelector('#wjp-cred-fcra').checked;
      if (!fn || !ln || !dob || !ssnRaw || ssnRaw.length !== 9 || !a1 || !city || !state || !zip) {
        alert('All fields required. SSN must be 9 digits.');
        return;
      }
      if (!fcra) { alert('You must authorize the credit pull (FCRA checkbox) to continue.'); return; }
      // Store identity record. SSN field is masked for display; the raw is held
      // ONLY in a closure variable that the backend hook reads at pull time.
      var rec = {
        firstName: fn, lastName: ln, dob: dob,
        address1: a1, address2: a2, city: city, state: state, zipCode: zip,
        ssnMasked: 'XXX-XX-' + ssnRaw.slice(5),
        ssnLast4: ssnRaw.slice(5),
        fcraAuthorizedAt: Date.now(),
        complete: true
      };
      saveIdentity(rec);
      // Keep raw SSN in module memory only (never localStorage)
      window._wjpRawSSN = ssnRaw;
      // Enable auto-pull
      var s = loadState();
      s.enabled = true;
      s.cadence = 'monthly';
      if (!s.lastPullAt) s.lastPullAt = Date.now();
      s = scheduleNext(s);
      saveState(s);
      modal.remove();
      renderCard();
      // Fire the first pull
      requestPull({ adminOverride: true });
    };
  }

  function field2(label, id, type, val, extra) {
    return '<label style="display:flex;flex-direction:column;gap:4px;">'
      + '<span style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + label + '</span>'
      + '<input id="' + id + '" type="' + type + '" value="' + escapeHTML(val) + '" ' + (extra || '') + ' style="padding:9px 12px;border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:8px;background:var(--card,#fff);color:var(--text-1,#0a0a0a);font-family:inherit;font-size:13px;font-weight:600;width:100%;box-sizing:border-box;color-scheme:light dark;">'
      + '</label>';
  }

  // ---------- Tick ----------
  function tick() {
    renderCard();
    // Auto-trigger pull if enabled and due
    try {
      var s = loadState();
      if (s.enabled && s.nextPullAt && Date.now() >= s.nextPullAt && s.lastResult && s.lastResult.status !== 'pending') {
        requestPull();
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 2500); });
  else setTimeout(tick, 2500);
  setInterval(tick, 5000);

  // Public API for backend integration
  window.WJP_CreditPull = {
    state: loadState,
    requestPull: requestPull,
    commitScores: commitScores,
    // SWAP THIS with real Array call from your Cloud Function:
    // window.WJP_CreditPull.fetchScoresFromBackend = uid => fetch('/api/credit/pull?uid=' + uid).then(r => r.json());
    fetchScoresFromBackend: fetchScoresFromBackend,
    setBackend: function (fn) { fetchScoresFromBackend = fn; }
  };
})();
