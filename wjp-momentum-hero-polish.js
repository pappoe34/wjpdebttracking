/* wjp-momentum-hero-polish.js v2 — JS-tagged class polish for Last 7 Days
 * hero tiles. Adds vibrant color, gradient backgrounds, accent borders,
 * and a subtle hover lift to each of the three stat tiles.
 *
 * Winston 2026-05-29: "put some color in those boxes, looks too plain"
 *
 * Why JS-tagged classes instead of pure CSS :has():
 *   The tile structure has zero class names and the icon depth varies, so
 *   the :has() approach didn't reliably match. Instead, on every render we
 *   walk #wjp-momentum-hero, locate each tile by its embedded Phosphor icon
 *   (ph-trending-down / ph-wallet / ph-shield-*), and add a known class to
 *   the tile container so CSS can paint it reliably.
 *
 * Safe: IIFE, idempotent, MutationObserver-driven so newly-rendered tiles
 * pick up the polish without a page reload.
 */
(function () {
  'use strict';
  if (window._wjpMomentumHeroPolishInstalled) return;
  window._wjpMomentumHeroPolishInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // Phosphor icon → tile theme class. We pick the FIRST matching icon
  // descendant; rough heuristic but unambiguous for these three tiles.
  var ICON_TO_CLASS = [
    { rx: /ph-trending-down|ph-trending-up|ph-arrow-down|ph-arrow-up/, cls: 'wjp-mh-tile-debt' },
    { rx: /ph-currency-dollar|ph-wallet|ph-piggy-bank|ph-money|ph-coins/, cls: 'wjp-mh-tile-cash' },
    { rx: /ph-shield-check|ph-shield-star|ph-shield|ph-medal|ph-target|ph-gauge/, cls: 'wjp-mh-tile-score' }
  ];

  function injectStyle() {
    if (document.getElementById('wjp-momentum-hero-polish-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-momentum-hero-polish-style';
    st.textContent = [
      '#wjp-momentum-hero .wjp-mh-tile-debt, #wjp-momentum-hero .wjp-mh-tile-cash, #wjp-momentum-hero .wjp-mh-tile-score { border-radius: 14px !important; transition: transform .18s ease, box-shadow .18s ease !important; position: relative; overflow: hidden; }',
      '#wjp-momentum-hero .wjp-mh-tile-debt:hover, #wjp-momentum-hero .wjp-mh-tile-cash:hover, #wjp-momentum-hero .wjp-mh-tile-score:hover { transform: translateY(-2px) !important; box-shadow: 0 12px 28px rgba(20,30,25,0.12) !important; }',

      // Debt — coral
      '#wjp-momentum-hero .wjp-mh-tile-debt { background: linear-gradient(135deg, rgba(255,231,224,0.95) 0%, rgba(255,245,242,0.65) 100%) !important; border: 1px solid rgba(192,89,74,0.32) !important; box-shadow: inset 4px 0 0 #c0594a, 0 4px 14px rgba(192,89,74,0.10) !important; }',
      '#wjp-momentum-hero .wjp-mh-tile-debt i[class*="ph-"] { color: #c0594a !important; font-size: 22px !important; }',

      // Cash — green
      '#wjp-momentum-hero .wjp-mh-tile-cash { background: linear-gradient(135deg, rgba(220,243,232,0.95) 0%, rgba(238,250,244,0.65) 100%) !important; border: 1px solid rgba(31,122,74,0.32) !important; box-shadow: inset 4px 0 0 #1f7a4a, 0 4px 14px rgba(31,122,74,0.10) !important; }',
      '#wjp-momentum-hero .wjp-mh-tile-cash i[class*="ph-"] { color: #1f7a4a !important; font-size: 22px !important; }',

      // Score — purple
      '#wjp-momentum-hero .wjp-mh-tile-score { background: linear-gradient(135deg, rgba(234,225,250,0.95) 0%, rgba(245,238,255,0.65) 100%) !important; border: 1px solid rgba(124,77,196,0.32) !important; box-shadow: inset 4px 0 0 #7c4dc4, 0 4px 14px rgba(124,77,196,0.10) !important; }',
      '#wjp-momentum-hero .wjp-mh-tile-score i[class*="ph-"] { color: #7c4dc4 !important; font-size: 22px !important; }',

      // Dark mode
      'body.dark #wjp-momentum-hero .wjp-mh-tile-debt { background: linear-gradient(135deg, rgba(192,89,74,0.22) 0%, rgba(192,89,74,0.06) 100%) !important; border-color: rgba(192,89,74,0.38) !important; box-shadow: inset 4px 0 0 #c0594a, 0 4px 14px rgba(0,0,0,0.30) !important; }',
      'body.dark #wjp-momentum-hero .wjp-mh-tile-cash { background: linear-gradient(135deg, rgba(31,122,74,0.22) 0%, rgba(31,122,74,0.06) 100%) !important; border-color: rgba(127,209,164,0.38) !important; box-shadow: inset 4px 0 0 #7fd1a4, 0 4px 14px rgba(0,0,0,0.30) !important; }',
      'body.dark #wjp-momentum-hero .wjp-mh-tile-score { background: linear-gradient(135deg, rgba(124,77,196,0.25) 0%, rgba(124,77,196,0.08) 100%) !important; border-color: rgba(186,160,236,0.38) !important; box-shadow: inset 4px 0 0 #baa0ec, 0 4px 14px rgba(0,0,0,0.30) !important; }',
      'body.dark #wjp-momentum-hero .wjp-mh-tile-debt i[class*="ph-"] { color: #f0a99c !important; }',
      'body.dark #wjp-momentum-hero .wjp-mh-tile-cash i[class*="ph-"] { color: #7fd1a4 !important; }',
      'body.dark #wjp-momentum-hero .wjp-mh-tile-score i[class*="ph-"] { color: #c5b0f0 !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // Walk every icon in the hero and bubble up to the first ancestor that
  // looks like a tile (a row of 3 sibling divs is the tile row). We tag
  // that ancestor with the class.
  function tagTiles() {
    var hero = document.getElementById('wjp-momentum-hero');
    if (!hero) return false;
    var icons = hero.querySelectorAll('i[class*="ph-"]');
    if (!icons.length) return false;
    var tagged = 0;
    icons.forEach(function (icon) {
      // Find the matching theme
      var iconClass = icon.className || '';
      var theme = null;
      for (var i = 0; i < ICON_TO_CLASS.length; i++) {
        if (ICON_TO_CLASS[i].rx.test(iconClass)) { theme = ICON_TO_CLASS[i]; break; }
      }
      if (!theme) return;
      // Walk up: the tile is the ancestor whose parent has at least 2 sibling
      // divs (typical 3-tile row). Limit to 6 ancestors to avoid runaway.
      var el = icon.parentElement;
      var found = null;
      for (var d = 0; d < 6 && el && el !== hero; d++) {
        var siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
        // Heuristic: a tile container's parent contains 2-4 similar sibling DIVs
        if (siblings.length >= 2 && siblings.length <= 4 && siblings.every(function (s) { return s.tagName === 'DIV'; })) {
          found = el;
          break;
        }
        el = el.parentElement;
      }
      var target = found || icon.parentElement.parentElement || icon.parentElement;
      if (target && !target.classList.contains(theme.cls)) {
        // Remove any other theme classes first (idempotency)
        target.classList.remove('wjp-mh-tile-debt', 'wjp-mh-tile-cash', 'wjp-mh-tile-score');
        target.classList.add(theme.cls);
        tagged++;
      }
    });
    return tagged > 0;
  }

  function boot() {
    injectStyle();
    var attempts = 0;
    function tick() {
      attempts++;
      tagTiles();
      setTimeout(tick, 1500);
    }
    setTimeout(tick, 400);
    window.addEventListener('wjp-data-restored', function () { setTimeout(tagTiles, 500); });
    try {
      var observe = function () {
        var hero = document.getElementById('wjp-momentum-hero');
        if (!hero) return false;
        var mo = new MutationObserver(function () { setTimeout(tagTiles, 100); });
        mo.observe(hero, { childList: true, subtree: true });
        return true;
      };
      if (!observe()) {
        var iv = setInterval(function () { if (observe()) clearInterval(iv); }, 800);
        setTimeout(function () { clearInterval(iv); }, 30000);
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_MomentumHeroPolish = { version: 2, tagTiles: tagTiles, inject: injectStyle };
})();
