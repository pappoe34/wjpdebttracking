/* wjp-milestone-celebration.js — full-screen confetti when a debt clears.
 *
 * Watches the cached debt list (window.calculateDebtPayoff result) for any
 * debt whose balance just hit 0. Triggers a one-time celebration overlay
 * with the debt name + total interest avoided + share-screenshot CTA.
 *
 * Idempotent: each celebrated debt is recorded in localStorage so it never
 * fires twice.
 */
(function () {
  'use strict';
  if (window._wjpMilestoneInstalled) return;
  window._wjpMilestoneInstalled = true;
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var LS_KEY = 'wjp.milestone.celebrated.v1';
  function loadCelebrated() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function recordCelebrated(id) {
    var s = loadCelebrated();
    s[id] = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  // Snapshot last-seen balances so we can detect a drop to 0
  var lastBalances = {};

  function fmtUSD(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function getDebtName(id) {
    var node = document.querySelector('[data-debt-id="' + id + '"]');
    if (node) {
      var nameEl = node.querySelector('h3, h4, .debt-name, .obligation-name');
      if (nameEl && nameEl.textContent.trim()) return nameEl.textContent.trim();
      var t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      var m = t.replace(/^(Priority|Autopay|\d+)\s+/i, '').match(/^(.+?)\s+(Managed Liability|\d+(?:\.\d+)?%\s+APR)/i);
      if (m) return m[1].trim();
    }
    return 'A debt';
  }

  function spawnConfetti(host) {
    var colors = ['#1f7a4a', '#2b9b72', '#c99a2a', '#dc2626', '#7c3aed', '#0284c7'];
    for (var i = 0; i < 60; i++) {
      var c = document.createElement('div');
      var size = 6 + Math.random() * 8;
      c.style.cssText = ''
        + 'position:absolute;'
        + 'left:' + (40 + Math.random() * 20) + '%;'
        + 'top:' + (30 + Math.random() * 20) + '%;'
        + 'width:' + size + 'px;height:' + (size * 0.6) + 'px;'
        + 'background:' + colors[i % colors.length] + ';'
        + 'border-radius:2px;'
        + 'opacity:' + (0.7 + Math.random() * 0.3) + ';'
        + 'transform:rotate(' + (Math.random() * 360) + 'deg);'
        + 'animation:wjp-confetti-fall ' + (1.6 + Math.random() * 1.4) + 's '
        + (Math.random() * 0.4) + 's cubic-bezier(.2,.6,.4,1) forwards;'
        + 'pointer-events:none;';
      host.appendChild(c);
    }
  }

  function ensureKeyframes() {
    if (document.getElementById('wjp-milestone-keyframes')) return;
    var style = document.createElement('style');
    style.id = 'wjp-milestone-keyframes';
    style.textContent = ''
      + '@keyframes wjp-confetti-fall {'
      +   '0% { transform: translateY(0) rotate(0deg); opacity: 1; }'
      +   '100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }'
      + '}'
      + '@keyframes wjp-milestone-pop {'
      +   '0% { opacity: 0; transform: scale(0.6) translateY(20px); }'
      +   '100% { opacity: 1; transform: scale(1) translateY(0); }'
      + '}';
    document.head.appendChild(style);
  }

  function celebrate(id, info) {
    if (loadCelebrated()[id]) return;
    recordCelebrated(id);
    ensureKeyframes();
    var name = getDebtName(id);
    var totalInterest = info && info.totalInterest;
    var overlay = document.createElement('div');
    overlay.id = 'wjp-milestone-overlay';
    overlay.style.cssText = ''
      + 'position:fixed;inset:0;z-index:99999;'
      + 'background:radial-gradient(circle at 50% 40%,rgba(31,122,74,0.18),rgba(0,0,0,0.65));'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'font-family:var(--sans,Inter,system-ui,sans-serif);';
    var card = document.createElement('div');
    card.style.cssText = ''
      + 'background:#fff;color:#0a0a0a;'
      + 'max-width:480px;width:90%;'
      + 'border-radius:24px;padding:40px 32px 28px;'
      + 'box-shadow:0 40px 100px rgba(0,0,0,0.40);'
      + 'text-align:center;'
      + 'animation:wjp-milestone-pop .6s cubic-bezier(.2,1.2,.4,1) both;'
      + 'position:relative;';
    var interestLine = (typeof totalInterest === 'number' && totalInterest > 0)
      ? '<div style="font-size:13.5px;color:#6b7280;margin-bottom:18px;">You avoided <b style="color:#1f7a4a;">' + fmtUSD(totalInterest) + '</b> in interest by paying it off.</div>'
      : '<div style="font-size:13.5px;color:#6b7280;margin-bottom:18px;">One down, the rest of the path is clearer now.</div>';
    card.innerHTML = ''
      + '<div style="font-size:48px;line-height:1;margin-bottom:14px;" aria-hidden="true">🎉</div>'
      + '<div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:8px;">Debt cleared</div>'
      + '<div style="font-size:26px;font-weight:700;letter-spacing:-0.02em;margin-bottom:8px;">' + name + ' is paid off.</div>'
      + interestLine
      + '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">'
      +   '<button type="button" data-wjp-mile-action="screenshot" style="background:#1f7a4a;color:#fff;border:0;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Save the moment</button>'
      +   '<button type="button" data-wjp-mile-action="close" style="background:transparent;color:#6b7280;border:1px solid rgba(0,0,0,0.15);padding:10px 18px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Keep going</button>'
      + '</div>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    spawnConfetti(overlay);

    function close() { try { overlay.remove(); } catch (_) {} }
    overlay.addEventListener('click', function (e) {
      var act = e.target && e.target.dataset && e.target.dataset.wjpMileAction;
      if (!act) {
        if (e.target === overlay) close();
        return;
      }
      if (act === 'close') close();
      if (act === 'screenshot') {
        // Best we can do without a real screenshot API: prompt user to use OS shortcut
        alert('Press ' + (navigator.platform.indexOf('Mac') !== -1 ? 'Cmd+Shift+4' : 'Win+Shift+S') + ' to capture this screen, then share it anywhere.');
      }
    });
    setTimeout(close, 12000);
  }

  function tick() {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return;
      var calc; try { calc = window.calculateDebtPayoff('avalanche'); } catch (_) { return; }
      if (!calc) return;
      Object.keys(calc).forEach(function (id) {
        var entry = calc[id] || {};
        // The calc returns post-simulation balances (always 0). We can't
        // detect a clear from this. So we rely on the DOM "$X left" reading.
      });
      // Detect via DOM "$X left" → 0 transition
      document.querySelectorAll('[data-debt-id]').forEach(function (n) {
        var id = n.dataset.debtId; if (!id) return;
        var text = (n.textContent || '').replace(/\s+/g, ' ');
        var leftM = text.match(/\$([\d,]+(?:\.\d+)?)\s*left/i);
        var balanceM = text.match(/Balance\s*\$([\d,]+(?:\.\d+)?)/i);
        var bal = null;
        if (leftM) bal = parseFloat(leftM[1].replace(/,/g, ''));
        else if (balanceM) bal = parseFloat(balanceM[1].replace(/,/g, ''));
        if (bal == null || !isFinite(bal)) return;
        var prev = lastBalances[id];
        lastBalances[id] = bal;
        // First sighting: just record
        if (prev == null) return;
        // Just hit zero (and was non-zero before)
        if (prev > 0 && bal === 0) {
          var info = (calc && calc[id]) || {};
          celebrate(id, info);
        }
      });
    } catch (e) {
      try { console.warn('[wjp-milestone] threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 1500);
    setInterval(tick, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_Milestone = {
    refresh: tick,
    celebrate: celebrate,
    _reset: function () { try { localStorage.removeItem(LS_KEY); } catch (_) {} }
  };
})();
