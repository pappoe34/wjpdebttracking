/* wjp-credit-hero-premium.js v1 — Premium Credit Health hero.
 *
 * Replaces the top of the Credit Health page with a unified, animated,
 * tier-gated hero. Hides the duplicate "Score 616 / Equifax 656" header
 * and the dominant auto-refresh card, replicating their controls inside
 * a thin status strip.
 *
 * Sections rendered (top to bottom):
 *   1. Status Strip  — VantageScore 3.0 · Updated · Next refresh · Refresh · Identity
 *   2. Hero Card     — animated gauge / band pill / change indicator / sparkline / bureau strip
 *
 * Visual standard: finance-grade trust meets tech-startup polish.
 * Wealthfront/Robinhood territory. Light + dark mode via design tokens.
 *
 * Public API:
 *   WJP_CreditHero.render()  -> idempotent render into #page-credit-wjp
 *   WJP_CreditHero.refresh() -> triggers a credit pull via WJP_CreditPull
 */
(function () {
  'use strict';
  if (window._wjpCreditHeroInstalled) return;
  window._wjpCreditHeroInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-cs-hero-premium';

  // ── helpers ─────────────────────────────────────────────────────────────
  function tier() {
    try { return (window.WJP_CreditTier && WJP_CreditTier.effective()) || 'free'; }
    catch (_) { return 'free'; }
  }
  function hasAccess(min) {
    try { return window.WJP_CreditTier && WJP_CreditTier.hasAccess(min); }
    catch (_) { return false; }
  }
  function mock() { return window.WJP_CreditMock || {}; }

  function currentScore() {
    var focused = focusedBureau();
    // Try real per-bureau score first
    try {
      if (typeof appState !== 'undefined' && appState && appState.creditScores) {
        var cs = appState.creditScores;
        var v = cs[focused] || cs.vantage || cs.equifax || cs.experian || cs.transunion;
        if (v >= 300 && v <= 850) return v;
      }
    } catch (_) {}
    // Fall back to mock per-bureau
    if (mock().bureauScores) {
      var bs = mock().bureauScores(mock().getCurrentScore ? mock().getCurrentScore() : 616);
      if (bs && bs[focused] >= 300 && bs[focused] <= 850) return bs[focused];
    }
    return mock().getCurrentScore ? mock().getCurrentScore() : 616;
  }

  function focusedBureau() {
    try {
      var b = window.WJP_CreditHistoryChart && WJP_CreditHistoryChart.getBureau && WJP_CreditHistoryChart.getBureau();
      if (b === 'compare' || !b) return 'equifax'; // default & compare-mode show Equifax in hero
      if (['equifax','experian','transunion'].indexOf(b) >= 0) return b;
    } catch (_) {}
    return 'equifax';
  }

  function scoreBand(score) {
    if (!score) return { name: 'No score', short: '—', color: '#9ca3af', from: 300, to: 850, next: null };
    if (score >= 800) return { name: 'Exceptional', short: 'EXCEPTIONAL', color: '#22c55e', from: 800, to: 850, next: null };
    if (score >= 740) return { name: 'Very good',   short: 'VERY GOOD',   color: '#22c55e', from: 740, to: 799, next: { label: 'Exceptional', threshold: 800 } };
    if (score >= 670) return { name: 'Good',        short: 'GOOD',        color: '#84cc16', from: 670, to: 739, next: { label: 'Very good',   threshold: 740 } };
    if (score >= 580) return { name: 'Fair',        short: 'FAIR',        color: '#fbbf24', from: 580, to: 669, next: { label: 'Good',        threshold: 670 } };
    return                    { name: 'Poor',        short: 'POOR',        color: '#ef4444', from: 300, to: 579, next: { label: 'Fair',        threshold: 580 } };
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    try { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (_) { return '—'; }
  }
  function fmtRel(ms) {
    if (!ms) return '—';
    var diff = ms - Date.now();
    var days = Math.round(Math.abs(diff) / 86400000);
    if (diff > 0) return days === 0 ? 'today' : 'in ' + days + 'd';
    return days === 0 ? 'today' : days + 'd ago';
  }

  // ── 1. Status Strip ─────────────────────────────────────────────────────
  function statusStripHTML(pullState) {
    var last = pullState.lastPullAt || 0;
    var next = pullState.nextPullAt || 0;
    var enabled = !!pullState.enabled;
    var identityVerified = !!(pullState.identity && pullState.identity.complete);
    var refreshDisabled = pullState.lastResult && pullState.lastResult.status === 'pending';

    var dot = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + (enabled ? '#10b981' : 'var(--text-3,#94a3b8)') + ';box-shadow:0 0 0 3px ' + (enabled ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.18)') + ';"></span>';

    return ''
      + '<div class="wjp-cs-status-strip" style="'
      +   'display:flex;align-items:center;flex-wrap:wrap;gap:14px 22px;'
      +   'padding:10px 16px;margin-bottom:14px;'
      +   'background:var(--card-2, rgba(255,255,255,0.04));'
      +   'border:1px solid var(--border, rgba(0,0,0,0.06));'
      +   'border-radius:10px;'
      +   'font-size:11px;font-weight:600;color:var(--text-3,#94a3b8);'
      + '">'
         // Eyebrow: VantageScore 3.0
      +   '<span style="display:inline-flex;align-items:center;gap:6px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:var(--accent,#10b981);font-size:10px;">'
      +     '<i class="ph-fill ph-shield-check" style="font-size:12px;"></i>VantageScore 3.0'
      +   '</span>'
      +   '<span style="opacity:0.4;">·</span>'
         // Last pulled
      +   '<span>Updated <strong style="color:var(--text-1,#0a0a0a);font-weight:700;">' + (last ? fmtDate(last) : 'Never') + '</strong></span>'
      +   '<span style="opacity:0.4;">·</span>'
         // Next refresh
      +   '<span>Next refresh <strong style="color:var(--text-1,#0a0a0a);font-weight:700;">' + (next ? fmtRel(next) : '—') + '</strong></span>'
      +   '<span style="opacity:0.4;">·</span>'
         // Auto-refresh status
      +   '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;" title="Auto-refresh">'
      +     dot
      +     '<span>Auto-refresh <strong style="color:var(--text-1,#0a0a0a);font-weight:700;">' + (enabled ? 'ON' : 'OFF') + '</strong></span>'
      +     '<input type="checkbox" id="wjp-cs-autopull-toggle" ' + (enabled ? 'checked' : '') + ' style="display:none;">'
      +   '</label>'
      +   '<span style="opacity:0.4;">·</span>'
         // Identity
      +   '<span style="display:inline-flex;align-items:center;gap:6px;">'
      +     '<i class="ph' + (identityVerified ? '-fill ph-check-circle' : ' ph-warning-circle') + '" style="font-size:13px;color:' + (identityVerified ? '#10b981' : '#f59e0b') + ';"></i>'
      +     'Identity <strong style="color:var(--text-1,#0a0a0a);font-weight:700;">' + (identityVerified ? 'Verified' : 'Set up') + '</strong>'
      +   '</span>'
         // Spacer + Refresh button (right-aligned)
      +   '<span style="flex:1;"></span>'
      +   '<button type="button" id="wjp-cs-refresh-btn" ' + (refreshDisabled ? 'disabled' : '') + ' style="'
      +     'display:inline-flex;align-items:center;gap:6px;'
      +     'background:linear-gradient(135deg, #10b981, #059669);'
      +     'color:#fff;border:0;padding:7px 14px;border-radius:8px;'
      +     'font-size:11px;font-weight:800;cursor:' + (refreshDisabled ? 'wait' : 'pointer') + ';'
      +     'font-family:inherit;letter-spacing:0.02em;'
      +     'opacity:' + (refreshDisabled ? '0.65' : '1') + ';'
      +     'box-shadow:0 3px 10px rgba(16,185,129,0.30);'
      +   '">'
      +     '<i class="' + (refreshDisabled ? 'ph ph-spinner' : 'ph-fill ph-arrow-clockwise') + '" style="font-size:12px;"></i>'
      +     (refreshDisabled ? 'Refreshing…' : 'Refresh score')
      +   '</button>'
      + '</div>';
  }

  // ── 2. Animated gauge SVG ───────────────────────────────────────────────
  // Half-circle gauge, score in the middle, current position dot. The arc
  // animates in from 0 to current value on mount.
  function gaugeSVG(score, band) {
    var size = 240;
    var stroke = 14;
    var r = (size - stroke) / 2;
    var cx = size / 2;
    var cy = size / 2 + 30; // shift down so half-circle sits high in the box
    var pct = Math.max(0, Math.min(1, (score - 300) / (850 - 300)));

    // Half-circle from 180deg → 360deg (left to right across the top)
    var startAngle = Math.PI;          // 180 deg
    var endAngle   = Math.PI * 2;      // 360 deg (= 0)
    var totalAngle = endAngle - startAngle;
    var currentAngle = startAngle + totalAngle * pct;
    var dotX = cx + r * Math.cos(currentAngle);
    var dotY = cy + r * Math.sin(currentAngle);

    // Arc path generator (large-arc-flag depends on whether we're > 180°)
    function arc(angleFrom, angleTo) {
      var x0 = cx + r * Math.cos(angleFrom);
      var y0 = cy + r * Math.sin(angleFrom);
      var x1 = cx + r * Math.cos(angleTo);
      var y1 = cy + r * Math.sin(angleTo);
      var large = (angleTo - angleFrom) > Math.PI ? 1 : 0;
      return 'M ' + x0 + ' ' + y0 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1;
    }

    var bgPath = arc(startAngle, endAngle);
    var fgPath = arc(startAngle, currentAngle);
    var arcLen = Math.PI * r;          // length of half circle

    return ''
      + '<svg viewBox="0 0 ' + size + ' ' + size + '" style="width:100%;max-width:280px;height:auto;overflow:visible;" aria-hidden="true">'
      +   '<defs>'
      +     '<linearGradient id="wjp-cs-grad" x1="0" y1="0" x2="1" y2="0">'
      +       '<stop offset="0%"  stop-color="#ef4444"/>'
      +       '<stop offset="22%" stop-color="#f97316"/>'
      +       '<stop offset="42%" stop-color="#fbbf24"/>'
      +       '<stop offset="65%" stop-color="#84cc16"/>'
      +       '<stop offset="85%" stop-color="#22c55e"/>'
      +     '</linearGradient>'
      +   '</defs>'
         // Faint background arc
      +   '<path d="' + bgPath + '" fill="none" stroke="var(--border, rgba(0,0,0,0.08))" stroke-width="' + stroke + '" stroke-linecap="round"/>'
         // Foreground gradient arc, with animated stroke-dashoffset
      +   '<path d="' + bgPath + '" fill="none" stroke="url(#wjp-cs-grad)" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + arcLen + ' ' + arcLen + '" stroke-dashoffset="' + (arcLen * (1 - pct)) + '" style="transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1);"/>'
         // Current-position dot
      +   '<circle cx="' + dotX.toFixed(2) + '" cy="' + dotY.toFixed(2) + '" r="' + (stroke / 2 + 3) + '" fill="' + band.color + '" stroke="var(--card, #fff)" stroke-width="3"/>'
         // End-of-scale labels
      +   '<text x="' + (cx - r) + '" y="' + (cy + 24) + '" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text-3, #94a3b8)" font-family="inherit">300</text>'
      +   '<text x="' + (cx + r) + '" y="' + (cy + 24) + '" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text-3, #94a3b8)" font-family="inherit">850</text>'
      + '</svg>';
  }

  // ── Sparkline of recent score history ───────────────────────────────────
  function sparklineHTML(history) {
    if (!history || history.length < 2) return '';
    var W = 220, H = 40, pad = 4;
    var values = history.map(function (h) { return h.score; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = Math.max(20, max - min);
    var pts = values.map(function (v, i) {
      var x = pad + (i / (values.length - 1)) * (W - pad * 2);
      var y = H - pad - ((v - min) / range) * (H - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var line = 'M ' + pts.join(' L ');
    var fill = line + ' L ' + (W - pad) + ',' + (H - pad) + ' L ' + pad + ',' + (H - pad) + ' Z';
    var delta = values[values.length - 1] - values[0];
    var color = delta >= 0 ? '#22c55e' : '#ef4444';
    var sparkId = 'wjp-cs-spark-grad';

    return ''
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:220px;height:40px;display:block;" aria-hidden="true">'
      +   '<defs>'
      +     '<linearGradient id="' + sparkId + '" x1="0" y1="0" x2="0" y2="1">'
      +       '<stop offset="0%"   stop-color="' + color + '" stop-opacity="0.32"/>'
      +       '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.00"/>'
      +     '</linearGradient>'
      +   '</defs>'
      +   '<path d="' + fill + '" fill="url(#' + sparkId + ')" stroke="none"/>'
      +   '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      +   '<circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="3" fill="' + color + '"/>'
      + '</svg>';
  }

  // ── Bureau strip ────────────────────────────────────────────────────────
  function bureauChipHTML(name, value, opts) {
    opts = opts || {};
    var locked = !!opts.locked;
    var primary = !!opts.primary;
    var bureauId = name.toLowerCase();
    var label = name.toUpperCase();
    var color = value && !locked ? scoreBand(value).color : '#9ca3af';
    var bg = primary ? 'rgba(16,185,129,0.10)' : 'var(--card-2, rgba(255,255,255,0.04))';
    var border = primary ? 'rgba(16,185,129,0.30)' : 'var(--border, rgba(0,0,0,0.06))';

    var inner;
    if (locked) {
      inner = ''
        + '<div style="display:flex;align-items:center;gap:8px;">'
        +   '<i class="ph-fill ph-lock-key" style="font-size:14px;color:var(--text-3,#94a3b8);"></i>'
        +   '<span style="font-size:11px;font-weight:700;color:var(--text-3,#94a3b8);">Upgrade to unlock</span>'
        + '</div>';
    } else if (value) {
      inner = ''
        + '<div style="display:flex;align-items:baseline;gap:8px;">'
        +   '<span style="font-size:22px;font-weight:900;color:var(--text-1,#0a0a0a);letter-spacing:-0.01em;line-height:1;">' + value + '</span>'
        +   '<span style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:' + color + ';">' + scoreBand(value).short + '</span>'
        + '</div>';
    } else {
      inner = '<span style="font-size:11px;color:var(--text-3,#94a3b8);font-weight:600;">Not pulled yet</span>';
    }

    var clickable = !locked && value;
    return ''
      + '<div ' + (clickable ? 'data-cs-focus-bureau="' + bureauId + '" ' : '') + 'style="flex:1;min-width:155px;padding:12px 14px;border-radius:11px;background:' + bg + ';border:1px solid ' + border + ';' + (clickable ? 'cursor:pointer;transition:transform 0.15s ease, box-shadow 0.15s ease;' : '') + '">'
      +   '<div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);margin-bottom:6px;">' + label + '</div>'
      +   inner
      + '</div>';
  }

  // ── Hero card composition ───────────────────────────────────────────────
  function heroHTML(score, band, history, bureaus) {
    // Track which bureau the chart is currently focusing on so chip highlight matches.
    var focused = focusedBureau();

    var ptsToNext = band.next ? (band.next.threshold - score) : 0;
    var deltaPts = history && history.length >= 2 ? (history[history.length - 1].score - history[history.length - 2].score) : 0;
    var deltaColor = deltaPts > 0 ? '#22c55e' : deltaPts < 0 ? '#ef4444' : '#94a3b8';
    var deltaSymbol = deltaPts > 0 ? '▲' : deltaPts < 0 ? '▼' : '—';
    var isMock = (mock().isMockMode && mock().isMockMode()) || false;

    // Precompute conditional pieces so the template stays clean
    var bandPillHTML = band.next
      ? '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:rgba(132,204,22,0.14);color:#65a30d;font-size:11px;font-weight:800;letter-spacing:0.02em;">'
        + '<i class="ph-fill ph-arrow-up-right" style="font-size:11px;"></i>'
        + ptsToNext + ' pts to ' + band.next.label + '</span>'
      : '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:rgba(34,197,94,0.14);color:#15803d;font-size:11px;font-weight:800;letter-spacing:0.02em;">'
        + '<i class="ph-fill ph-trophy" style="font-size:11px;"></i>Top band</span>';

    var deltaPillHTML = deltaPts !== 0
      ? '<span style="font-size:11.5px;font-weight:700;color:' + deltaColor + ';">'
        + deltaSymbol + ' ' + Math.abs(deltaPts) + ' pts vs last pull</span>'
      : '';

    var sandboxBadgeHTML = isMock && mock().badge ? '<div style="position:absolute;top:14px;right:14px;">' + mock().badge() + '</div>' : '';

    return ''
      + '<div style="'
      +   'position:relative;'
      +   'background:linear-gradient(135deg, var(--card, #fff) 0%, var(--card-2, rgba(255,255,255,0.6)) 100%);'
      +   'border:1px solid var(--border, rgba(0,0,0,0.06));'
      +   'border-radius:16px;'
      +   'padding:24px 26px;'
      +   'box-shadow:0 4px 20px rgba(0,0,0,0.06);'
      + '">'
      +   sandboxBadgeHTML
      +   '<div style="display:flex;gap:28px;align-items:center;flex-wrap:wrap;">'
           // Left: gauge with score in the middle
      +     '<div style="position:relative;flex-shrink:0;width:280px;max-width:100%;">'
      +       gaugeSVG(score, band)
      +       '<div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-18%);display:flex;flex-direction:column;align-items:center;pointer-events:none;">'
      +         '<div style="font-size:9.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-3,#94a3b8);margin-bottom:2px;">' + focused.toUpperCase() + ' · VantageScore</div>'
      +         '<div style="font-size:64px;font-weight:900;color:' + band.color + ';line-height:1;letter-spacing:-0.03em;">' + (score || '—') + '</div>'
      +         '<div style="font-size:11px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:' + band.color + ';margin-top:6px;">' + band.short + '</div>'
      +       '</div>'
      +     '</div>'
           // Right: meta column
      +     '<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:14px;">'
             // Band pill + delta
      +       '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +         bandPillHTML
      +         deltaPillHTML
      +       '</div>'
             // Sparkline + caption
      +       '<div>'
      +         '<div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;margin-bottom:4px;">Score history · last 12 pulls</div>'
      +         sparklineHTML(history)
      +       '</div>'
             // Bureau strip
      +       '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">'
      +         bureauChipHTML('Equifax',    bureaus.equifax,    { primary: focused === 'equifax' })
      +         bureauChipHTML('Experian',   bureaus.experian,   { primary: focused === 'experian',   locked: !hasAccess('plus') })
      +         bureauChipHTML('TransUnion', bureaus.transunion, { primary: focused === 'transunion', locked: !hasAccess('plus') })
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // ── Pull-state reader ──────────────────────────────────────────────────
  function readPullState() {
    var pullState = {};
    try {
      var key = window.WJP_UserScope && WJP_UserScope.scopeKey ? WJP_UserScope.scopeKey('wjp.credit.pull.v1') : 'wjp.credit.pull.v1';
      var raw = localStorage.getItem(key);
      if (raw) pullState = JSON.parse(raw);
    } catch (_) {}
    try {
      var idKey = window.WJP_UserScope && WJP_UserScope.scopeKey ? WJP_UserScope.scopeKey('wjp.credit.identity.v1') : 'wjp.credit.identity.v1';
      var rawId = localStorage.getItem(idKey);
      if (rawId) pullState.identity = JSON.parse(rawId);
    } catch (_) {}
    return pullState;
  }

  // ── Render orchestration ────────────────────────────────────────────────
  function render() {
    try {
      var page = document.getElementById('page-credit-wjp');
      if (!page || page.offsetHeight === 0) return;

      var score = currentScore();
      var band = scoreBand(score);
      var history = (mock().scoreHistory && mock().scoreHistory()) || [];
      var bureaus = (mock().bureauScores && mock().bureauScores(score)) || {};
      var pullState = readPullState();

      var wrap = document.getElementById(WRAP_ID);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.style.cssText = 'margin-bottom:24px;';
        // Insert as the FIRST child of the credit page, ahead of everything else
        page.insertBefore(wrap, page.firstChild);
      }
      wrap.innerHTML = statusStripHTML(pullState) + heroHTML(score, band, history, bureaus);

      // Hide the duplicate "Score 616 / Equifax 656" header (rendered by
      // wjp-credit-actions). The header contains a "Score NNN" pattern and
      // a small Equifax/Experian/TransUnion stat line — kill it entirely.
      try {
        var olderTop = page.querySelectorAll('h1, h2, div');
        olderTop.forEach(function (el) {
          if (el === wrap || wrap.contains(el)) return;
          var txt = (el.textContent || '').trim();
          // Match the original header pattern only (short, starts with "Credit Health" or "Score NNN")
          if (/^Credit Health$/i.test(txt) || /^Score\s+\d{3}\b/i.test(txt)) {
            var parent = el.parentElement;
            if (parent && page.contains(parent) && parent !== page) {
              parent.style.display = 'none';
            } else {
              el.style.display = 'none';
            }
          }
        });
      } catch (_) {}

      // Hide the dominant auto-refresh card (its functions are now in our Status Strip)
      try {
        var legacy = document.getElementById('wjp-credit-autopull-card');
        if (legacy) legacy.style.display = 'none';
      } catch (_) {}

      // Hide the entire legacy Score Detail / giant gauge / per-bureau cards
      // block rendered by wjp-credit-score-overhaul.js — our new hero replaces it.
      try {
        var overhaulWrap = document.getElementById('wjp-cs-overhaul');
        if (overhaulWrap) overhaulWrap.style.display = 'none';
      } catch (_) {}

      // Hide any block that contains the legacy "VantageScore 3.0 · 300 to 850"
      // label OR shows "experian / not pulled yet" cards (rendered by older modules).
      try {
        var legacyBlocks = page.querySelectorAll('div');
        legacyBlocks.forEach(function (el) {
          if (el === wrap || wrap.contains(el) || el.contains(wrap)) return;
          var txt = (el.textContent || '').slice(0, 400);
          // Only target small wrappers — avoid hiding the whole page accidentally
          if (el.childElementCount > 30) return;
          if (/Score Detail\s*VantageScore 3\.0/i.test(txt)
              || /VantageScore 3\.0\s*·\s*300 to 850/i.test(txt)
              || /not pulled yet/i.test(txt) && /Score Detail/i.test(txt)) {
            el.style.display = 'none';
          }
        });
      } catch (_) {}

      // Hide the legacy "Score Detail · VantageScore 3.0 · 300 to 850" header inside
      // wjp-credit-actions — now redundant since our hero owns the score display.
      try {
        document.querySelectorAll('[data-cs-section="score-detail-header"]').forEach(function (el) { el.style.display = 'none'; });
      } catch (_) {}

      wireEvents();
      try { window.dispatchEvent(new CustomEvent('wjp:credit-hero-rendered')); } catch (_) {}
    } catch (_) {}
  }

  function wireEvents() {
    // Bureau strip chips clickable -> focus chart
    document.querySelectorAll('[data-cs-focus-bureau]').forEach(function (chip) {
      if (chip.__wjpWired) return;
      chip.__wjpWired = true;
      chip.addEventListener('click', function () {
        var b = chip.getAttribute('data-cs-focus-bureau');
        if (window.WJP_CreditHistoryChart && WJP_CreditHistoryChart.setBureau) {
          WJP_CreditHistoryChart.setBureau(b);
          // Scroll chart into view
          var chart = document.getElementById('wjp-cs-history-chart');
          if (chart) chart.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    var refresh = document.getElementById('wjp-cs-refresh-btn');
    if (refresh && !refresh.__wjpWired) {
      refresh.__wjpWired = true;
      refresh.addEventListener('click', function () {
        try {
          if (window.WJP_CreditPull && typeof WJP_CreditPull.commitScores === 'function') {
            // Trigger the existing requestPull path through the legacy module
            var legacyBtn = document.getElementById('wjp-pull-now');
            if (legacyBtn) { legacyBtn.click(); return; }
          }
          // Fallback: direct fetch
          (async function () {
            var user = window.__wjpUser;
            if (!user) return;
            var idToken = await user.getIdToken(false);
            await fetch('/.netlify/functions/array-credit-pull', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sandbox: true })
            });
            render();
          })();
        } catch (_) {}
      });
    }

    var toggle = document.getElementById('wjp-cs-autopull-toggle');
    if (toggle && !toggle.__wjpWired) {
      toggle.__wjpWired = true;
      toggle.addEventListener('change', function () {
        // Mirror to the legacy autopull module's checkbox
        try {
          var legacy = document.getElementById('wjp-pull-enabled');
          if (legacy) {
            legacy.checked = toggle.checked;
            legacy.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch (_) {}
        render();
      });
    }
  }

  // Initial mount + re-render hooks
  function init() {
    render();
    // Re-render when the user navigates to the credit page
    if (window.addEventListener) {
      window.addEventListener('hashchange', function () { setTimeout(render, 50); });
      window.addEventListener('wjp:page-change', function () { setTimeout(render, 50); });
      window.addEventListener('wjp:credit-bureau-changed', function () { setTimeout(render, 30); });
    }
    // Idempotent retry — wait for #page-credit-wjp to mount if not present yet
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      var page = document.getElementById('page-credit-wjp');
      if (page && page.offsetHeight > 0) { render(); }
      if (attempts > 40) clearInterval(iv);
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.WJP_CreditHero = {
    render: render,
    refresh: function () {
      var btn = document.getElementById('wjp-cs-refresh-btn');
      if (btn) btn.click();
    }
  };
})();
