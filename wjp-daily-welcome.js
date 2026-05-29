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
  // FIX 63 v8 (Winston 2026-05-29): "should stay till user dismisses
  // or after 8 seconds it loads the site". Splash sits put until user
  // clicks Skip, or hard 8s timeout. No data-ready auto-dismiss.
  var MIN_DISPLAY_MS = 300;
  var HARD_TIMEOUT_MS = 8000;

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
      // FIX 63 v9 (Winston 2026-05-29): preferred name (user choice) wins
      // over firstName, then falls back through normal chain.
      var nm = (s && s.profile && (s.profile.preferredName || s.profile.preferredFirstName || s.profile.firstName || s.profile.name)) || '';
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
      // FIX 63 v10 — daily brief polish
      '#' + OVERLAY_ID + ' .stat .lbl{display:flex;align-items:center;gap:5px;}',
      '#' + OVERLAY_ID + ' .help{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:rgba(0,0,0,0.06);color:#6b7280;font-size:9px;font-weight:900;cursor:help;position:relative;}',
      'body.dark #' + OVERLAY_ID + ' .help{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.55);}',
      '#' + OVERLAY_ID + ' .help:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1f1a14;color:#fff;font-size:10px;font-weight:600;padding:6px 9px;border-radius:6px;white-space:nowrap;letter-spacing:0;text-transform:none;z-index:10;max-width:220px;white-space:normal;width:max-content;text-align:left;line-height:1.4;box-shadow:0 6px 16px rgba(0,0,0,0.25);}',
      'body.dark #' + OVERLAY_ID + ' .help:hover::after{background:#f4f4f6;color:#1f1a14;}',
      '#' + OVERLAY_ID + ' .focus-section{padding:14px 16px;background:linear-gradient(135deg,rgba(192,89,74,0.07),rgba(192,89,74,0.02));border:1px solid rgba(192,89,74,0.18);border-radius:10px;margin-bottom:22px;}',
      'body.dark #' + OVERLAY_ID + ' .focus-section{background:linear-gradient(135deg,rgba(192,89,74,0.16),rgba(192,89,74,0.04));border-color:rgba(192,89,74,0.30);}',
      '#' + OVERLAY_ID + ' .focus-title{font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#c0594a;margin-bottom:8px;display:flex;align-items:center;gap:6px;}',
      '#' + OVERLAY_ID + ' .focus-list{display:flex;flex-direction:column;gap:6px;}',
      '#' + OVERLAY_ID + ' .focus-item{font-size:12px;color:#1f1a14;display:flex;align-items:flex-start;gap:8px;line-height:1.4;}',
      'body.dark #' + OVERLAY_ID + ' .focus-item{color:#f4f4f6;}',
      '#' + OVERLAY_ID + ' .focus-item::before{content:"";flex-shrink:0;width:6px;height:6px;border-radius:50%;background:#c0594a;margin-top:5px;}',
      '#' + OVERLAY_ID + ' .skip-btn{font-size:14px;padding:12px 28px;background:linear-gradient(135deg,#1f7a4a,#2b9b72);box-shadow:0 8px 24px rgba(31,122,74,0.35);}',
      '#' + OVERLAY_ID + ' .skip-btn:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(31,122,74,0.45);}',
      '#' + OVERLAY_ID + ' .skip-btn::after{content:" \u2192";margin-left:2px;}',
      // FIX 63 v9 — design polish: branded mark, motivational line, icon tiles, fade-in
      '#' + OVERLAY_ID + ' .brand{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#1f7a4a;margin-bottom:18px;}',
      '#' + OVERLAY_ID + ' .brand .dot{width:8px;height:8px;border-radius:50%;background:#1f7a4a;box-shadow:0 0 0 4px rgba(31,122,74,0.18);}',
      '#' + OVERLAY_ID + ' .name-edit-btn{background:none;border:0;color:#1f7a4a;font-size:14px;margin-left:8px;cursor:pointer;opacity:0.55;transition:opacity .15s, transform .15s;padding:4px;border-radius:6px;}',
      '#' + OVERLAY_ID + ' .name-edit-btn:hover{opacity:1;transform:translateY(-1px);background:rgba(31,122,74,0.08);}',
      '#' + OVERLAY_ID + ' .name-input{font-size:30px;font-weight:900;color:#1f1a14;line-height:1.15;border:0;background:transparent;outline:0;border-bottom:2px solid #1f7a4a;font-family:inherit;width:60%;}',
      'body.dark #' + OVERLAY_ID + ' .name-input{color:#f4f4f6;}',
      '#' + OVERLAY_ID + ' .hero-line{padding:12px 14px;border-radius:10px;background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(31,122,74,0.04));border:1px solid rgba(31,122,74,0.18);font-size:13px;font-weight:600;color:#1f1a14;margin-bottom:20px;display:flex;align-items:center;gap:10px;}',
      'body.dark #' + OVERLAY_ID + ' .hero-line{background:linear-gradient(135deg,rgba(31,122,74,0.18),rgba(31,122,74,0.06));border-color:rgba(31,122,74,0.30);color:#f4f4f6;}',
      '#' + OVERLAY_ID + ' .hero-line .ic{font-size:16px;color:#1f7a4a;}',
      '#' + OVERLAY_ID + ' .stat{position:relative;opacity:0;transform:translateY(8px);animation:wjpdwfade .55s ease-out forwards;}',
      '#' + OVERLAY_ID + ' .stat:nth-child(1){animation-delay:.05s;}',
      '#' + OVERLAY_ID + ' .stat:nth-child(2){animation-delay:.15s;}',
      '#' + OVERLAY_ID + ' .stat:nth-child(3){animation-delay:.25s;}',
      '#' + OVERLAY_ID + ' .stat:nth-child(4){animation-delay:.35s;}',
      '@keyframes wjpdwfade{to{opacity:1;transform:translateY(0);}}',
      '#' + OVERLAY_ID + ' .stat .top{display:flex;justify-content:space-between;align-items:flex-start;}',
      '#' + OVERLAY_ID + ' .stat .ic{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;background:rgba(31,122,74,0.10);color:#1f7a4a;}',
      'body.dark #' + OVERLAY_ID + ' .stat .ic{background:rgba(31,122,74,0.20);}',
      '#' + OVERLAY_ID + ' .panel{position:relative;overflow:hidden;}',
      '#' + OVERLAY_ID + ' .panel::before{content:"";position:absolute;top:-80px;right:-80px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(31,122,74,0.20),transparent 70%);pointer-events:none;}',
      '#' + OVERLAY_ID + ' .panel::after{content:"";position:absolute;bottom:-100px;left:-100px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(192,89,74,0.10),transparent 70%);pointer-events:none;}',
      '#' + OVERLAY_ID + ' .footer{display:flex;justify-content:space-between;align-items:center;gap:12px;position:relative;}',
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
      +     '<div class="brand"><span class="dot"></span><span>WJP Debt Tracking</span></div>'
      +     '<div class="greeting">' + hello + '</div>'
      +     '<div class="title">'
      +       '<span data-wjpdw-name>' + first + '</span>.'
      +       '<button type="button" class="name-edit-btn" data-wjpdw-edit title="Rename">✎</button>'
      +     '</div>'
      +     '<div class="sub" data-wjpdw-sub>Here\'s your daily snapshot.</div>'
      +     '<div class="hero-line"><span class="ic">⚡</span><span data-wjpdw-hero-text>Loading your debt-free trajectory…</span></div>'
      +     '<div class="focus-section" data-wjpdw-focus style="display:none;">'
      +       '<div class="focus-title"><span>◆</span><span>Today\'s focus</span></div>'
      +       '<div class="focus-list" data-wjpdw-focus-list></div>'
      +     '</div>'
      +     '<div class="stats">'
      +       '<div class="stat skeleton" data-wjpdw-stat="ydaySpend"><div class="top"><div><div class="lbl">Yesterday spending <span class="help" data-tip="Total non-transfer spending posted yesterday across all linked accounts.">?</span></div><div class="val">$—</div><div class="sub2" data-wjpdw-sub2>—</div></div><div class="ic">💸</div></div></div>'
      +       '<div class="stat skeleton" data-wjpdw-stat="nextDue"><div class="top"><div><div class="lbl">Next bill due <span class="help" data-tip="The recurring schedule with the earliest upcoming date. Pay early to dodge fees.">?</span></div><div class="val">—</div><div class="sub2" data-wjpdw-sub2>—</div></div><div class="ic">📅</div></div></div>'
      +       '<div class="stat skeleton" data-wjpdw-stat="netCash"><div class="top"><div><div class="lbl">Net cash (7d) <span class="help" data-tip="Income minus spending over the last 7 days. Transfers excluded.">?</span></div><div class="val">$—</div><div class="sub2" data-wjpdw-sub2>—</div></div><div class="ic">📈</div></div></div>'
      +       '<div class="stat skeleton" data-wjpdw-stat="debtFree"><div class="top"><div><div class="lbl">Debt-free target <span class="help" data-tip="Estimated payoff date assuming your current strategy (Avalanche / Snowball) + minimums + extras.">?</span></div><div class="val">—</div><div class="sub2" data-wjpdw-sub2>—</div></div><div class="ic">🎯</div></div></div>'
      +     '</div>'
      +     '<div class="footer">'
      +       '<span class="loading"><span class="spinner"></span><span>Loading your data…</span></span>'
      +       '<button type="button" class="skip-btn">Enter dashboard</button>'
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

    // FIX 63 v9: motivational hero line based on debt-free + cashflow
    try {
      var heroEl = document.querySelector('#' + OVERLAY_ID + ' [data-wjpdw-hero-text]');
      if (heroEl) {
        var msg = '';
        if (dfdText && dfdText !== '\u2014') {
          msg = 'Debt-free on ' + dfdText + '. Every payment moves the date forward.';
        } else if ((s.debts || []).length === 0) {
          msg = 'No debts tracked yet. Let\'s build your map.';
        } else {
          msg = 'You\'re tracking ' + (s.debts || []).length + ' debt' + ((s.debts || []).length === 1 ? '' : 's') + '. Keep going.';
        }
        heroEl.textContent = msg;
      }
    } catch (_) {}

    // FIX 63 v10 (Winston 2026-05-29): Today's focus actionable bullets.
    try {
      var focusEl = document.querySelector('#' + OVERLAY_ID + ' [data-wjpdw-focus]');
      var listEl  = document.querySelector('#' + OVERLAY_ID + ' [data-wjpdw-focus-list]');
      if (focusEl && listEl) {
        var bullets = [];
        // Bullet 1: bill due today/tomorrow
        if (nextDue) {
          var daysUntil = Math.max(0, Math.round((nextDue.ms - Date.now()) / 86400000));
          if (daysUntil <= 1) {
            var nm = String(nextDue.rp.name || '').slice(0, 30);
            var amt = Math.abs(Number(nextDue.rp.amount) || 0);
            bullets.push('Pay <strong>' + nm + '</strong> ' + (daysUntil === 0 ? 'today' : 'tomorrow') + ' \u2014 ' + fmtUsd(amt) + ' to avoid late fees.');
          }
        }
        // Bullet 2: cashflow alert
        if (net < 0) {
          bullets.push('You\'re <strong>' + fmtUsd(Math.abs(net)) + ' negative</strong> this week. Trim a category or pause a subscription.');
        }
        // Bullet 3: high-APR debt nudge
        try {
          var debts = (s.debts || []).filter(function (d) { return d && (Number(d.apr) || 0) > 0; });
          if (debts.length) {
            var top = debts.reduce(function (a, b) { return (Number(a.apr) || 0) > (Number(b.apr) || 0) ? a : b; });
            if (top && Number(top.apr) >= 15) {
              bullets.push('Highest APR: <strong>' + String(top.name || '').slice(0, 30) + ' (' + Number(top.apr).toFixed(2) + '%)</strong>. Extra payments here save the most interest.');
            }
          }
        } catch (_) {}
        // Bullet 4 fallback / encouragement
        if (bullets.length === 0) {
          bullets.push('No urgent action today. Stay the course \u2014 every payment compounds.');
        }
        listEl.innerHTML = bullets.map(function (b) {
          return '<div class="focus-item"><span>' + b + '</span></div>';
        }).join('');
        focusEl.style.display = '';
      }
    } catch (_) {}
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

    // FIX 63 v9: inline name rename pencil
    try {
      var editBtn = document.querySelector('#' + OVERLAY_ID + ' [data-wjpdw-edit]');
      if (editBtn) editBtn.addEventListener('click', function () {
        var nameSpan = document.querySelector('#' + OVERLAY_ID + ' [data-wjpdw-name]');
        if (!nameSpan) return;
        var current = nameSpan.textContent.trim();
        var input = document.createElement('input');
        input.type = 'text';
        input.value = current;
        input.maxLength = 40;
        input.className = 'name-input';
        nameSpan.replaceWith(input);
        editBtn.style.display = 'none';
        input.focus();
        input.select();
        function commit() {
          var v = input.value.trim().slice(0, 40);
          if (!v) v = current;
          try {
            var s = getState();
            if (s) {
              if (!s.profile) s.profile = {};
              s.profile.preferredName = v;
              try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
            }
          } catch (_) {}
          var newSpan = document.createElement('span');
          newSpan.setAttribute('data-wjpdw-name', '');
          newSpan.textContent = v;
          input.replaceWith(newSpan);
          editBtn.style.display = '';
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { input.value = current; input.blur(); }
        });
      });
    } catch (_) {}

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
    // FIX 63 v8: fill stats progressively but do NOT auto-dismiss on
    // data-ready. Splash waits for Skip click OR 8s hard timeout.
    var iv = setInterval(function () {
      if (tryPopulate()) clearInterval(iv);
    }, 350);
    window.addEventListener('wjp-data-restored', function () { setTimeout(tryPopulate, 200); });
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(tryPopulate, 200); });

    // FIX 63 v10 (Winston 2026-05-29): no auto-dismiss. User must click
    // 'Enter dashboard' to proceed. Removes the 8s safety timeout.
  }

  // Mount as early as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DailyWelcome = {
    version: 10,
    show: function () { localStorage.removeItem(lsKey()); boot(); },
    dismiss: function () { dismiss('manual'); },
    shouldShow: shouldShow
  };
})();
