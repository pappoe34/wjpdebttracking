/* wjp-daily-welcome.js v1 — full-screen welcome splash shown only when
 * the user has been away >24 hours.
 *
 * Winston 2026-05-29: "when the app first loads, it takes 3 to 5 seconds
 * for everything to load on dashboard properly. i dont want the user to
 * see the initial glitches so can we have a welcome back screen with a
 * daily summary and an option for a skip button to let them access the
 * site which would be loaded in the background. this would only happen
 * when the site is first launched in the day."
 *
 * He picked: "Only after long absence (>24h since last visit)".
 *
 * Design:
 *   1. Mount IMMEDIATELY (script is loaded before app.js) so the user
 *      never catches the dashboard mid-render.
 *   2. Shell renders without data: greeting + spinner + Skip button.
 *   3. As appState hydrates (wjp-data-restored / Plaid sync), fill in
 *      yesterday's spending, bills due, next payment, streak.
 *   4. Auto-dismiss when state is ready AND min-display met (1.8s), or
 *      hard timeout at 6s so we never block the app.
 *   5. Per-user-scoped localStorage key tracks last-seen timestamp.
 *      Splash shows only if (now - lastSeen) > 24h. Skip stamps lastSeen
 *      to "now" so the 24h window restarts.
 *
 * Safe: IIFE, idempotent install, bare `appState` access, try/catch
 * wrapped. Pure UX layer — does not modify any state.
 */
(function () {
  'use strict';
  if (window._wjpDailyWelcomeInstalled) return;
  window._wjpDailyWelcomeInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var OVERLAY_ID = 'wjp-daily-welcome';
  var WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
  // FIX 63 v7 (Winston 2026-05-29): "it defeats the purpose, the site
  // should be already loaded in the background". Reverted to short min
  // display — the splash is a CURTAIN over the load, not a delay.
  // If user wants to inspect the splash design, use ?welcome=hold.
  var MIN_DISPLAY_MS = 300;
  var HARD_TIMEOUT_MS = 6000;

  // ────────── helpers ──────────
  function getUid() {
    var uid = '';
    try { if (window.firebase && window.firebase.auth && window.firebase.auth().currentUser) uid = window.firebase.auth().currentUser.uid || ''; } catch (_) {}
    try { if (!uid && window.WJP_Auth && window.WJP_Auth.uid) uid = window.WJP_Auth.uid; } catch (_) {}
    try { if (!uid) uid = (localStorage.getItem('wjp_anon_id') || '').slice(0, 40); } catch (_) {}
    return uid;
  }
  function lsKey() {
    var uid = getUid();
    return 'wjp.daily.welcome.v1.lastSeen' + (uid ? '.uid_' + uid : '');
  }
  function getLastSeen() {
    try { return parseInt(localStorage.getItem(lsKey()) || '0', 10) || 0; } catch (_) { return 0; }
  }
  function stampSeen() {
    try { localStorage.setItem(lsKey(), String(Date.now())); } catch (_) {}
  }
  // FIX 63 v4 (Winston 2026-05-29): also bypass on any page reload
  // (Ctrl-R / Ctrl-Shift-R / refresh) so the splash is testable without
  // waiting 24h. Casual navigations (typed URL, bookmark, link) still
  // respect the 24h gate.
  function isReload() {
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
      if (nav[0] && nav[0].type === 'reload') return true;
    } catch (_) {}
    try {
      if (performance.navigation && performance.navigation.type === 1) return true; // legacy API
    } catch (_) {}
    return false;
  }
  function shouldShow() {
    // ?welcome=force in URL: always bypass
    try {
      var q = (location.search || '').toLowerCase();
      if (q.indexOf('welcome=force') !== -1) return true;
    } catch (_) {}
    // ANY reload bypasses the 24h gate
    if (isReload()) return true;
    var last = getLastSeen();
    if (!last) return true;
    return (Date.now() - last) > WINDOW_MS;
  }
  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function fmtUsd(n) {
    n = Number(n) || 0;
    return '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function getFirstName() {
    try {
      var s = getState();
      var nm = (s && s.profile && (s.profile.firstName || s.profile.name)) || '';
      if (!nm) {
        var ls = localStorage.getItem('wjp_user_name') || '';
        if (ls) nm = ls;
      }
      if (!nm) {
        var email = localStorage.getItem('wjp_last_email') || '';
        if (email && email.indexOf('@') !== -1) nm = email.split('@')[0];
      }
      // FIX 63 v2 (Winston 2026-05-29): polish — strip trailing digits
      // ("pappoe34" -> "pappoe") + capitalize first letter so the splash
      // never greets someone with a raw email handle.
      var first = String(nm || 'there').split(/[\s.@_]+/)[0];
      first = first.replace(/[0-9]+$/, '').trim();
      if (!first) first = 'there';
      first = first.charAt(0).toUpperCase() + first.slice(1);
      return first;
    } catch (_) { return 'there'; }
  }
  function timeOfDayGreeting() {
    var h = new Date().getHours();
    if (h < 5)  return 'Welcome back';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Welcome back';
  }
  function isTransfer(t) {
    if (!t) return true;
    if (t.userCategoryId === 'transfer') return true;
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
        return !!window.WJP_TxSmartCategorize.isTransfer(t);
      }
    } catch (_) {}
    var f = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(f);
  }

  // ────────── overlay styles + shell ──────────
  function injectStyle() {
    if (document.getElementById('wjp-daily-welcome-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-daily-welcome-style';
    st.textContent = [
      '#' + OVERLAY_ID + '{position:fixed;top:0;left:0;right:0;bottom:0;inset:0;width:100vw;height:100vh;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(135deg,#fef7e6 0%,#f3ead0 50%,#dde7d0 100%);font-family:system-ui,-apple-system,Inter,sans-serif;opacity:1;transition:opacity .35s ease-out;box-sizing:border-box;}',
      '#' + OVERLAY_ID + '.is-hiding{opacity:0;pointer-events:none;}',
      'body.dark #' + OVERLAY_ID + '{background:linear-gradient(135deg,#0d1620 0%,#101e2c 50%,#0e2421 100%);}',
      '#' + OVERLAY_ID + ' .panel{max-width:520px;width:100%;background:rgba(255,255,255,0.78);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;padding:34px 34px 26px;box-shadow:0 30px 80px rgba(0,0,0,0.10);}',
      'body.dark #' + OVERLAY_ID + ' .panel{background:rgba(20,28,38,0.78);border-color:rgba(255,255,255,0.10);box-shadow:0 30px 80px rgba(0,0,0,0.40);color:#f4f4f6;}',
      '#' + OVERLAY_ID + ' .greeting{font-size:13px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:#1f7a4a;margin-bottom:6px;}',
      '#' + OVERLAY_ID + ' .title{font-size:30px;font-weight:900;color:#1f1a14;line-height:1.15;margin-bottom:14px;}',
      'body.dark #' + OVERLAY_ID + ' .title{color:#f4f4f6;}',
      '#' + OVERLAY_ID + ' .sub{font-size:13px;color:#6b7280;margin-bottom:24px;}',
      'body.dark #' + OVERLAY_ID + ' .sub{color:rgba(255,255,255,0.6);}',
      '#' + OVERLAY_ID + ' .stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;}',
      '#' + OVERLAY_ID + ' .stat{padding:14px 16px;border:1px solid rgba(0,0,0,0.06);border-radius:12px;background:rgba(255,255,255,0.55);}',
      'body.dark #' + OVERLAY_ID + ' .stat{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.10);}',
      '#' + OVERLAY_ID + ' .stat .lbl{font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;}',
      'body.dark #' + OVERLAY_ID + ' .stat .lbl{color:rgba(255,255,255,0.55);}',
      '#' + OVERLAY_ID + ' .stat .val{font-size:20px;font-weight:900;color:#1f1a14;margin-top:4px;}',
      'body.dark #' + OVERLAY_ID + ' .stat .val{color:#f4f4f6;}',
      '#' + OVERLAY_ID + ' .stat .sub2{font-size:11px;color:#6b7280;margin-top:2px;}',
      'body.dark #' + OVERLAY_ID + ' .stat .sub2{color:rgba(255,255,255,0.55);}',
      '#' + OVERLAY_ID + ' .footer{display:flex;justify-content:space-between;align-items:center;gap:12px;}',
      '#' + OVERLAY_ID + ' .loading{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#6b7280;}',
      'body.dark #' + OVERLAY_ID + ' .loading{color:rgba(255,255,255,0.55);}',
      '#' + OVERLAY_ID + ' .spinner{width:14px;height:14px;border:2px solid rgba(31,122,74,0.20);border-top-color:#1f7a4a;border-radius:50%;animation:wjpdwspin .9s linear infinite;}',
      '@keyframes wjpdwspin{to{transform:rotate(360deg);}}',
      '#' + OVERLAY_ID + ' .skip-btn{background:#1f7a4a;color:#fff;border:0;padding:10px 22px;border-radius:999px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 8px 22px rgba(31,122,74,0.30);transition:transform .15s, box-shadow .15s;}',
      '#' + OVERLAY_ID + ' .skip-btn:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(31,122,74,0.40);}',
      '#' + OVERLAY_ID + ' .stat.skeleton .val{display:inline-block;width:90px;height:22px;border-radius:6px;background:linear-gradient(90deg,rgba(0,0,0,0.06),rgba(0,0,0,0.12),rgba(0,0,0,0.06));background-size:200% 100%;animation:wjpdwshim 1.4s infinite;color:transparent;}',
      'body.dark #' + OVERLAY_ID + ' .stat.skeleton .val{background:linear-gradient(90deg,rgba(255,255,255,0.06),rgba(255,255,255,0.16),rgba(255,255,255,0.06));}',
      '@keyframes wjpdwshim{0%{background-position:200% 0;}100%{background-position:-200% 0;}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function buildShell() {
    var first = getFirstName();
    var hello = timeOfDayGreeting();
    var html = ''
      + '<div id="' + OVERLAY_ID + '">'
      +   '<div class="panel">'
      +     '<div class="greeting">' + hello + '</div>'
      +     '<div class="title">' + first + '.</div>'
      +     '<div class="sub" data-wjpdw-sub>Here\'s where you stand today.</div>'
      +     '<div class="stats">'
      +       '<div class="stat skeleton" data-wjpdw-stat="ydaySpend"><div class="lbl">Yesterday spending</div><div class="val">$—</div><div class="sub2" data-wjpdw-sub2>—</div></div>'
      +       '<div class="stat skeleton" data-wjpdw-stat="nextDue"><div class="lbl">Next bill due</div><div class="val">—</div><div class="sub2" data-wjpdw-sub2>—</div></div>'
      +       '<div class="stat skeleton" data-wjpdw-stat="netCash"><div class="lbl">Net cash (7d)</div><div class="val">$—</div><div class="sub2" data-wjpdw-sub2>—</div></div>'
      +       '<div class="stat skeleton" data-wjpdw-stat="debtFree"><div class="lbl">Debt-free target</div><div class="val">—</div><div class="sub2" data-wjpdw-sub2>—</div></div>'
      +     '</div>'
      +     '<div class="footer">'
      +       '<span class="loading"><span class="spinner"></span><span>Loading your data…</span></span>'
      +       '<button type="button" class="skip-btn">Skip</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var holder = document.createElement('div');
    holder.innerHTML = html;
    // FIX 63 v5 (Winston 2026-05-29): body is a flex container in this
    // app — appending to body collapses position:fixed children into a
    // flex column. Append to documentElement (<html>) so the overlay
    // anchors purely to the viewport.
    var target = document.documentElement || document.body;
    if (target) target.appendChild(holder.firstElementChild);
  }

  function fillStat(name, val, sub2) {
    var el = document.querySelector('#' + OVERLAY_ID + ' .stat[data-wjpdw-stat="' + name + '"]');
    if (!el) return;
    var valEl = el.querySelector('.val');
    var subEl = el.querySelector('[data-wjpdw-sub2]');
    if (valEl) valEl.textContent = val == null ? '—' : val;
    if (subEl && sub2 != null) subEl.textContent = sub2;
    el.classList.remove('skeleton');
  }

  function populate() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return false;

    // 1. Yesterday spending (transfers + income excluded)
    var now = new Date();
    var yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    var yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var ySpend = 0, yCount = 0;
    (s.transactions || []).forEach(function (t) {
      if (!t || t.synthetic) return;
      var ms = t.date ? new Date(String(t.date).slice(0, 10) + 'T12:00:00').getTime() : 0;
      if (!ms || ms < yStart || ms >= yEnd) return;
      if (isTransfer(t)) return;
      var amt = Number(t.amount) || 0;
      if (amt >= 0) return; // income, ignore
      ySpend += Math.abs(amt);
      yCount++;
    });
    fillStat('ydaySpend', '$' + Math.round(ySpend).toLocaleString(), yCount + (yCount === 1 ? ' transaction' : ' transactions'));

    // 2. Next bill due
    var rps = Array.isArray(s.recurringPayments) ? s.recurringPayments : [];
    var nextDue = null;
    rps.forEach(function (rp) {
      if (!rp || !rp.nextDate) return;
      var ms = new Date(String(rp.nextDate).slice(0, 10) + 'T12:00:00').getTime();
      if (!ms) return;
      var c = String(rp.category || rp.cat || '').toLowerCase();
      if (c === 'income' || rp.linkedIncome) return;
      if (!nextDue || ms < nextDue.ms) nextDue = { rp: rp, ms: ms };
    });
    if (nextDue) {
      var days = Math.max(0, Math.round((nextDue.ms - Date.now()) / 86400000));
      var when = days === 0 ? 'Today' : (days === 1 ? 'Tomorrow' : 'in ' + days + ' days');
      var nm = String(nextDue.rp.name || '').slice(0, 22);
      var amt = Math.abs(Number(nextDue.rp.amount) || 0);
      fillStat('nextDue', when, nm + ' · ' + fmtUsd(amt));
    } else {
      fillStat('nextDue', 'None', 'no scheduled bills');
    }

    // 3. Net cash last 7 days
    var cutoff = Date.now() - (7 * 86400000);
    var income = 0, spend = 0;
    (s.transactions || []).forEach(function (t) {
      if (!t || t.synthetic) return;
      if (isTransfer(t)) return;
      var ms = t.date ? new Date(String(t.date).slice(0, 10) + 'T12:00:00').getTime() : 0;
      if (!ms || ms < cutoff) return;
      var amt = Number(t.amount) || 0;
      if (amt > 0) income += amt; else spend += Math.abs(amt);
    });
    var net = income - spend;
    var netStr = (net >= 0 ? '+$' : '-$') + Math.round(Math.abs(net)).toLocaleString();
    fillStat('netCash', netStr, net >= 0 ? 'surplus this week' : 'shortfall this week');

    // 4. Debt-free target (read what the hero already has if rendered)
    var dfd = document.getElementById('dfd-date');
    var dfdText = dfd ? (dfd.textContent || '').trim() : '';
    if (dfdText && dfdText !== '—') {
      var debts = Array.isArray(s.debts) ? s.debts : [];
      var tot = debts.reduce(function (a, d) { return a + Math.abs(Number(d.balance) || 0); }, 0);
      fillStat('debtFree', dfdText, '$' + Math.round(tot).toLocaleString() + ' to clear');
    } else {
      // fallback — count debts
      var dc = (s.debts || []).length;
      fillStat('debtFree', dc + (dc === 1 ? ' debt' : ' debts'), dc ? 'tracking' : 'add debts to begin');
    }

    var subEl = document.querySelector('#' + OVERLAY_ID + ' [data-wjpdw-sub]');
    if (subEl) subEl.textContent = 'Here\'s where you stand today.';
    return true;
  }

  function dismiss(reason) {
    stampSeen();
    var el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    el.classList.add('is-hiding');
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 400);
    try { console.log('[wjp-daily-welcome] dismissed:', reason); } catch (_) {}
  }

  // ────────── boot ──────────
  function boot() {
    try { console.log('[wjp-daily-welcome] boot, shouldShow:', shouldShow(), 'isReload:', isReload(), 'readyState:', document.readyState); } catch (_) {}
    if (!shouldShow()) return; // skip if user was here within 24h
    injectStyle();
    buildShell();
    try { console.log('[wjp-daily-welcome] mounted, overlay in DOM:', !!document.getElementById(OVERLAY_ID)); } catch (_) {}
    var skipBtn = document.querySelector('#' + OVERLAY_ID + ' .skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', function () { dismiss('skip-click'); });

    // FIX 63 v7: ?welcome=hold disables auto-dismiss so the splash sits
    // there until Skip is clicked. Useful for inspecting the design.
    var holdMode = false;
    try {
      var q2 = (location.search || '').toLowerCase();
      holdMode = q2.indexOf('welcome=hold') !== -1;
    } catch (_) {}
    if (holdMode) {
      try { console.log('[wjp-daily-welcome] hold mode — auto-dismiss disabled. Click Skip to close.'); } catch (_) {}
      tryPopulateOnceWhenReady();
      return; // skip the timed-dismiss path entirely
    }
    function tryPopulateOnceWhenReady() {
      var iv = setInterval(function () {
        if (populate()) clearInterval(iv);
      }, 350);
    }

    var shownAt = Date.now();
    var done = false;
    function maybeDismiss(reason) {
      if (done) return;
      var waited = Date.now() - shownAt;
      if (waited < MIN_DISPLAY_MS) {
        setTimeout(function () { maybeDismiss(reason); }, MIN_DISPLAY_MS - waited + 50);
        return;
      }
      done = true;
      dismiss(reason);
    }

    // Try to populate progressively
    function tryPopulate() {
      if (done) return true;
      var ok = populate();
      return ok;
    }
    var iv = setInterval(function () {
      if (tryPopulate()) {
        clearInterval(iv);
        // Give the user a beat to see the populated stats
        setTimeout(function () { maybeDismiss('data-ready'); }, 250); // FIX 63 v7: dismiss as soon as data lands — no extra wait
      }
    }, 350);
    window.addEventListener('wjp-data-restored', function () { setTimeout(tryPopulate, 200); });
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(tryPopulate, 200); });

    // Hard timeout — never block the app
    setTimeout(function () { maybeDismiss('hard-timeout'); }, HARD_TIMEOUT_MS);
  }

  // Mount as early as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DailyWelcome = {
    version: 1,
    show: function () { localStorage.removeItem(lsKey()); boot(); },
    dismiss: function () { dismiss('manual'); },
    shouldShow: shouldShow
  };
})();
