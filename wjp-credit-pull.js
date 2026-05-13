/* wjp-credit-pull.js v1 — Path A: Pro-tier auto credit score pull scaffolding
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
  var CARD_ID = 'wjp-credit-autopull-card';

  function userKey(b) {
    if (window.WJP_UserScope && typeof window.WJP_UserScope.scopeKey === 'function') return window.WJP_UserScope.scopeKey(b);
    return b;
  }
  function loadJSON(k, def) { try { var v = localStorage.getItem(userKey(k)); return v ? JSON.parse(v) : def; } catch (_) { return def; } }
  function saveJSON(k, v) { try { localStorage.setItem(userKey(k), JSON.stringify(v)); } catch (_) {} }

  function tier() {
    try {
      if (typeof window.getTier === 'function') return window.getTier();
      var s = window.appState; return s && s.subscription ? s.subscription.tier : 'free';
    } catch (_) { return 'free'; }
  }
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
      cadence: 'monthly',
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
    // Placeholder — returns null so UI shows "Backend not connected yet" message.
    return Promise.resolve({
      ok: false,
      err: 'Array backend not yet deployed — see /docs/credit-array-setup.md',
      scores: null
    });
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
      if (scores.equifax)    ci.bureauScores.equifax   = { value: scores.equifax,    capturedAt: now };
      if (scores.experian)   ci.bureauScores.experian  = { value: scores.experian,   capturedAt: now };
      if (scores.transunion) ci.bureauScores.transunion= { value: scores.transunion, capturedAt: now };
      if (scores.fico8) ci.currentScore = String(scores.fico8);
      localStorage.setItem(scoped, JSON.stringify(ci));
      // Trigger host re-render
      try { if (typeof window.renderCreditScoreTab === 'function') window.renderCreditScoreTab(); } catch (_) {}
      try { if (typeof window.recordScoreHistory === 'function' && scores.fico8) window.recordScoreHistory(scores.fico8); } catch (_) {}
    } catch (_) {}
  }

  function requestPull() {
    var s = loadState();
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
        s2.history.push({
          date: new Date().toISOString().slice(0, 10),
          fico8: result.scores.fico8,
          equifax: result.scores.equifax,
          experian: result.scores.experian,
          transunion: result.scores.transunion
        });
        if (window.WJP_Momentum && typeof window.WJP_Momentum.showToast === 'function') {
          window.WJP_Momentum.showToast({
            eyebrow: 'CREDIT REFRESHED',
            title: 'New scores pulled',
            sub: 'FICO 8: ' + (result.scores.fico8 || '—') + ' · next auto-update ' + fmtRelative(s2.nextPullAt),
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
        +     '<div style="flex:1;"><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#818cf8;text-transform:uppercase;">Auto credit score updates</div><div style="font-size:16px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;">Get your FICO 8 from all 3 bureaus, every month</div><div style="font-size:11.5px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:6px;line-height:1.5;">Soft-pull, won\'t hurt your score. Stop guessing when your score changes — see it auto-update on the same day each month.</div></div>'
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
      +       '<div><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#10b981;text-transform:uppercase;">Auto credit score updates</div><div style="font-size:16px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;">' + (s.enabled ? 'On — ' + (s.cadence === 'weekly' ? 'Weekly' : 'Monthly') : 'Off') + '</div></div>'
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
      +     statLine('Bureaus', 'Equifax · Experian · TransUnion', 'soft pull, no score impact')
      +     statLine('Tier', proPlus ? 'Pro Plus' : 'Pro', proPlus ? 'weekly available' : 'monthly cadence')
      +   '</div>'
      + (lastErr
          ? '<div style="margin-top:12px;padding:10px 14px;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.30);border-radius:8px;font-size:11.5px;color:#a16207;font-weight:600;line-height:1.5;"><i class="ph-fill ph-info" style="margin-right:6px;color:#f59e0b;"></i>' + escapeHTML(String(lastErr)) + '</div>'
          : '')
      + (s.history && s.history.length >= 2 ? historyChartHTML(s.history) : '')
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
    var values = hist.map(function (h) { return h.fico8 || 0; }).filter(function (x) { return x > 0; });
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
        sub: 'Pro unlocks monthly FICO pulls from Equifax, Experian, and TransUnion.',
        color: '#6366f1',
        icon: 'ph-fill ph-crown'
      });
    };

    var pullBtn = card.querySelector('#wjp-pull-now');
    if (pullBtn) pullBtn.onclick = function () { requestPull(); };

    var enabledCheck = card.querySelector('#wjp-pull-enabled');
    if (enabledCheck) enabledCheck.onchange = function () {
      var s = loadState();
      s.enabled = enabledCheck.checked;
      if (s.enabled) {
        if (!s.lastPullAt) s.lastPullAt = Date.now();
        s = scheduleNext(s);
      }
      saveState(s); renderCard();
    };

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
