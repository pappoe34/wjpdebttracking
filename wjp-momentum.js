/* wjp-momentum.js v4 — Exec Summary first, then momentum (consistent sage palette)
 *
 * Original:  v3 — refined streak design + per-debt payoff milestones (5/15/30/50/75/100%)
 *
 * Three surfaces that make progress feel real:
 *   1. Weekly Progress hero strip on dashboard — 3 chips with deltas vs 7d ago
 *   2. Streak pill in header — Duolingo-style daily-visit counter
 *   3. Milestone toasts — celebration when round-number thresholds cross
 *
 * Depends on wjp-snapshots.js for historical data.
 */
(function () {
  'use strict';
  if (window._wjpMomentumInstalled) return;
  window._wjpMomentumInstalled = true;

  function isDark() { try { return document.body.classList.contains('dark'); } catch (_) { return false; } }
  function fmtUSD(n) {
    var v = Math.abs(Math.round(Number(n) || 0));
    return '$' + v.toLocaleString('en-US');
  }
  function fmtSigned(n, prefix) {
    n = Number(n) || 0;
    var sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return sign + (prefix || '') + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  // ===== 1. Weekly Progress hero strip =====
  var HERO_ID = 'wjp-momentum-hero';
  var STREAK_ID = 'wjp-momentum-streak';

  function buildHeroHTML() {
    if (!window.WJP_Snapshots) return '';
    var d = window.WJP_Snapshots.delta(7);
    if (!d) {
      // No history yet — show a friendly "starting fresh" state
      return ''
        + '<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(135deg,rgba(16,185,129,0.10),rgba(16,185,129,0.04));border:1px solid rgba(16,185,129,0.25);border-radius:14px;margin:14px 0;">'
        +   '<div style="width:36px;height:36px;border-radius:10px;background:rgba(16,185,129,0.18);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-rocket-launch" style="font-size:18px;color:#10b981;"></i></div>'
        +   '<div style="flex:1;"><div style="font-size:13px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">Day one — let\'s build your momentum.</div><div style="font-size:11px;color:var(--text-3, rgba(255,255,255,0.65));font-weight:600;margin-top:2px;">Check in tomorrow to see your first 24-hour delta.</div></div>'
        + '</div>';
    }

    // Three chips
    function chip(label, value, good, sub, icon) {
      var color = (value === 0) ? '#94a3b8' : (good ? '#10b981' : '#ef4444');
      var bg = (value === 0) ? 'rgba(148,163,184,0.10)' : (good ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)');
      var arrow = value === 0 ? '' : (good ? '↑' : '↓');
      var sign = good && value > 0 ? '+' : (good && value < 0 ? '−' : (value > 0 ? '+' : (value < 0 ? '−' : '')));
      var absV = Math.abs(Math.round(value));
      return ''
        + '<div style="flex:1;min-width:0;padding:10px 14px;background:' + bg + ';border:1px solid ' + color + '33;border-radius:10px;display:flex;align-items:center;gap:10px;">'
        + '<div style="width:30px;height:30px;border-radius:8px;background:' + color + '22;display:grid;place-items:center;flex-shrink:0;color:' + color + ';"><i class="' + icon + '" style="font-size:14px;"></i></div>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + label + '</div>'
        +   '<div style="font-size:14.5px;font-weight:900;color:' + color + ';letter-spacing:-0.005em;">' + arrow + ' ' + sign + (label === 'Score' ? absV : '$' + absV.toLocaleString('en-US')) + '</div>'
        +   (sub ? '<div style="font-size:9.5px;color:var(--text-3,#94a3b8);font-weight:600;">' + sub + '</div>' : '')
        + '</div>'
        + '</div>';
    }

    // Debt: down is good
    var debtChip = chip(
      'Debt this week',
      -d.totalDebt,                   // flip sign so "paid down" displays positive
      d.totalDebt <= 0,               // good if totalDebt didn't grow
      d.totalDebt < 0 ? fmtUSD(d.totalDebt) + ' paid down' : (d.totalDebt > 0 ? 'crept up' : 'no change'),
      'ph-fill ph-trending-down'
    );
    // Liquid cash: up is good
    var cashChip = chip(
      'Cash on hand',
      d.liquidCash,
      d.liquidCash >= 0,
      d.liquidCash > 0 ? 'saved' : (d.liquidCash < 0 ? 'drawn down' : 'no change'),
      'ph-fill ph-piggy-bank'
    );
    // Score: up is good
    var scoreChip = chip(
      'Score',
      d.score,
      d.score >= 0,
      d.score > 0 ? 'gain' : (d.score < 0 ? 'loss' : 'steady'),
      'ph-fill ph-shield-check'
    );

    return ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
      +   '<div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Last 7 days</div>'
      +   '<div style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:600;">vs ' + d.daysCovered + ' days ago</div>'
      + '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + debtChip + cashChip + scoreChip + '</div>';
  }

  function mountHero() {
    try {
      var page = document.getElementById('page-dashboard');
      if (!page || page.offsetHeight === 0) return;
      var card = document.getElementById(HERO_ID);
      if (!card) {
        card = document.createElement('div');
        card.id = HERO_ID;
        card.className = 'card reveal';
        card.style.cssText = 'padding:14px 16px;margin-top:10px;';
        // v4: Insert AFTER the Executive Summary (#dfd-hero) so it doesn't push the
        // headline below. Fall back to after greeting if exec summary not present yet.
        var anchor = document.getElementById('dfd-hero') || document.getElementById('dash-greeting');
        if (anchor && anchor.parentNode) {
          if (anchor.nextSibling) anchor.parentNode.insertBefore(card, anchor.nextSibling);
          else anchor.parentNode.appendChild(card);
        } else {
          page.insertBefore(card, page.firstChild);
        }
      }
      var html = buildHeroHTML();
      if (html) card.innerHTML = html;
    } catch (e) { try { console.warn('[wjp-momentum] hero mount', e); } catch (_) {} }
  }

  // ===== 2. Streak pill in header =====
  function mountStreak() {
    try {
      if (!window.WJP_Snapshots) return;
      var s = window.WJP_Snapshots.streak();
      if (!s || !s.current) return;

      // Place inside the topbar — find the nearest "topbar" container
      var pill = document.getElementById(STREAK_ID);
      var topbar = document.querySelector('.topbar, [class*="topbar"], .header-right, .top-right, .nav-actions');
      if (!topbar) {
        // Fallback: find Privacy Mode / Sync Bank buttons area
        var pmBtn = Array.from(document.querySelectorAll('button')).find(function (b) { return /privacy mode/i.test(b.textContent || ''); });
        if (pmBtn) topbar = pmBtn.parentElement;
      }
      if (!topbar) return;
      if (!pill) {
        pill = document.createElement('div');
        pill.id = STREAK_ID;
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 9px;background:rgba(245,158,11,0.10);color:#f59e0b;border:1px solid rgba(245,158,11,0.35);border-radius:999px;font-size:11.5px;font-weight:800;font-family:inherit;cursor:default;user-select:none;margin-right:6px;';
        pill.title = 'Days in a row using WJP — longest: ' + s.longest;
        topbar.insertBefore(pill, topbar.firstChild);
      }
      pill.innerHTML = '<i class="ph-fill ph-flame" style="font-size:12px;color:#f59e0b;"></i><span style="font-weight:800;">' + s.current + '</span><span style="font-weight:600;opacity:0.75;letter-spacing:0.04em;">DAY</span>';
    } catch (e) { try { console.warn('[wjp-momentum] streak mount', e); } catch (_) {} }
  }

  // ===== 3. Milestone toasts =====
  var DEBT_PAID_THRESHOLDS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 75000];
  var SCORE_THRESHOLDS = [40, 55, 75, 90];
  var CASH_THRESHOLDS = [500, 1000, 2500, 5000, 10000];

  function showToast(opts) {
    // opts: { title, sub, color, icon }
    var existing = document.getElementById('wjp-momentum-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'wjp-momentum-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:var(--card,#fff);border:1px solid ' + opts.color + ';border-left:6px solid ' + opts.color + ';border-radius:12px;padding:14px 18px;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,0.25);font-family:var(--sans,Inter,system-ui,sans-serif);transform:translateY(20px);opacity:0;transition:all 0.4s cubic-bezier(0.16,1,0.3,1);';
    toast.innerHTML = ''
      + '<div style="display:flex;align-items:center;gap:12px;">'
      +   '<div style="width:42px;height:42px;border-radius:11px;background:' + opts.color + '22;display:grid;place-items:center;flex-shrink:0;"><i class="' + opts.icon + '" style="font-size:22px;color:' + opts.color + ';"></i></div>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:' + opts.color + ';">' + (opts.eyebrow || 'MILESTONE') + '</div>'
      +     '<div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:2px;line-height:1.3;">' + opts.title + '</div>'
      +     (opts.sub ? '<div style="font-size:11px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:4px;line-height:1.4;">' + opts.sub + '</div>' : '')
      +   '</div>'
      +   '<button id="wjp-mom-toast-close" type="button" style="background:transparent;border:0;color:var(--text-3,#94a3b8);cursor:pointer;font-size:20px;line-height:1;padding:0;flex-shrink:0;">×</button>'
      + '</div>';
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
    toast.querySelector('#wjp-mom-toast-close').onclick = function () { toast.remove(); };
    // Auto-dismiss in 8s
    setTimeout(function () {
      if (document.getElementById('wjp-momentum-toast') === toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(function () { try { toast.remove(); } catch (_) {} }, 400);
      }
    }, 8000);
  }

  var PER_DEBT_PCT_TIERS = [5, 15, 30, 50, 75, 100];

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }

  function fireMilestones() {
    if (!window.WJP_Snapshots) return;
    var today = window.WJP_Snapshots.today();
    if (!today) return;

    // Total paid crossings
    DEBT_PAID_THRESHOLDS.forEach(function (t) {
      var id = 'paid-' + t;
      if (today.totalPaid >= t && !window.WJP_Snapshots.hasFired(id)) {
        window.WJP_Snapshots.markFired(id);
        showToast({
          eyebrow: 'PAID OFF MILESTONE',
          title: 'You\'ve paid off $' + t.toLocaleString() + '!',
          sub: 'Every dollar gone is interest you\'ll never pay. Keep stacking.',
          color: '#10b981',
          icon: 'ph-fill ph-trophy'
        });
      }
    });

    // Score crossings
    SCORE_THRESHOLDS.forEach(function (t) {
      var id = 'score-' + t;
      if (today.score >= t && !window.WJP_Snapshots.hasFired(id)) {
        window.WJP_Snapshots.markFired(id);
        var label = t >= 75 ? 'Strong' : t >= 55 ? 'Stable' : 'Fragile';
        showToast({
          eyebrow: 'RESILIENCE LEVEL UP',
          title: 'You crossed ' + t + ' — Resilience is ' + label,
          sub: 'Your runway + DTI just moved you up a tier.',
          color: '#10b981',
          icon: 'ph-fill ph-shield-check'
        });
      }
    });

    // Cash crossings
    CASH_THRESHOLDS.forEach(function (t) {
      var id = 'cash-' + t;
      if (today.liquidCash >= t && !window.WJP_Snapshots.hasFired(id)) {
        window.WJP_Snapshots.markFired(id);
        showToast({
          eyebrow: 'SAVINGS MILESTONE',
          title: 'Liquid cash hit $' + t.toLocaleString(),
          sub: 'This is your buffer — it shortens the runway clock.',
          color: '#3b82f6',
          icon: 'ph-fill ph-piggy-bank'
        });
      }
    });

    // Per-debt payoff milestones (5/15/30/50/75/100%)
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return;
    s.debts.forEach(function (d) {
      if (!d || !d.id) return;
      var start = Number(d.startingBalance || d.originalBalance || 0);
      var bal = Number(d.balance || 0);
      if (!start || start <= 0) return;
      var paid = Math.max(0, start - bal);
      var pct = (paid / start) * 100;
      PER_DEBT_PCT_TIERS.forEach(function (tier) {
        if (pct < tier) return;
        var id = 'debt-' + d.id + '-' + tier;
        if (window.WJP_Snapshots.hasFired(id)) return;
        window.WJP_Snapshots.markFired(id);
        var emoji = tier === 100 ? '🏆' : tier >= 75 ? '🚀' : tier >= 50 ? '⚡' : tier >= 30 ? '🎯' : tier >= 15 ? '💪' : '✨';
        var name = String(d.name || 'this debt').slice(0, 36);
        showToast({
          eyebrow: tier === 100 ? 'DEBT ELIMINATED' : 'PAYOFF MILESTONE',
          title: tier === 100
            ? name + ' — PAID OFF ' + emoji
            : tier + '% paid on ' + name + ' ' + emoji,
          sub: tier === 100
            ? 'That\'s one debt off the list. Roll its minimum into the next priority.'
            : 'Paid $' + Math.round(paid).toLocaleString() + ' of $' + Math.round(start).toLocaleString() + '. Stay on it.',
          color: tier === 100 ? '#10b981' : tier >= 50 ? '#a855f7' : '#3b82f6',
          icon: tier === 100 ? 'ph-fill ph-confetti' : 'ph-fill ph-flag-checkered'
        });
      });
    });
  }

  // ===== Tick =====
  function tick() {
    mountHero();
    mountStreak();
    fireMilestones();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 2500); });
  else setTimeout(tick, 2500);
  setInterval(tick, 5000);

  window.WJP_Momentum = { tick: tick, showToast: showToast };
})();
