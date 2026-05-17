/* wjp-ai-free-gate.js v1 — Hide AI features for Free tier (zero Anthropic spend).
 *
 * Pairs with the server-side gate in ai-cloud.js (returns 403 for Free).
 * This module suppresses the entry points so Free users don't see the AI
 * UI and waste time trying to use it.
 *
 * Hidden for tier === 'free' (with trial = plus exception via WJP_TierGate):
 *   - #ai-chat-fab (floating Chat with WJP button)
 *   - Sidebar "AI Coach" nav link
 *   - "Ask AI Coach" buttons injected by other modules
 *
 * Trial users see everything (their getTier returns 'plus' via the
 * appState patch from wjp-trial-state.js).
 *
 * Safe: IIFE, idempotent, path-guarded, polled for late-mounted UI.
 */
(function () {
  'use strict';
  if (window._wjpAiFreeGateInstalled) return;
  window._wjpAiFreeGateInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-ai-free-gate-style';
  var HIDE_ATTR = 'data-wjp-ai-hidden';

  function getTier() {
    try {
      if (typeof window.getTier === 'function') return String(window.getTier()).toLowerCase();
    } catch (_) {}
    return null;
  }
  function isFree() {
    var t = getTier();
    if (!t) return false; // unknown → don't gate (avoid flicker before auth resolves)
    return t === 'free';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.wjp-ai-upgrade-mini {' +
      '  display:inline-flex; align-items:center; gap:6px;' +
      '  background:linear-gradient(135deg, rgba(31,122,74,0.10), rgba(31,122,74,0.04));' +
      '  border:1px solid var(--border, rgba(31,122,74,0.20));' +
      '  border-radius:999px; padding:5px 12px;' +
      '  font-family:Inter,system-ui,sans-serif; font-size:11px; font-weight:700;' +
      '  color:#1f7a4a; cursor:pointer; letter-spacing:0.01em;' +
      '}' +
      '.wjp-ai-upgrade-mini:hover { background:rgba(31,122,74,0.16); }' +
      'body.dark .wjp-ai-upgrade-mini {' +
      '  background:linear-gradient(135deg, rgba(31,122,74,0.18), rgba(31,122,74,0.08));' +
      '  border-color:rgba(31,122,74,0.32);' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }

  function openPlans() {
    try {
      if (typeof window.navigateSPA === 'function') return window.navigateSPA('plans');
      location.hash = '#plans';
      try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {}
    } catch (_) {
      try { location.hash = '#plans'; } catch (__) {}
    }
  }

  function findEntryPoints() {
    var sels = [
      '#ai-chat-fab',
      '.ai-chat-fab',
      '#ai-coach-fab',
      '.ai-coach-fab',
      '[class*="ask-ai"]',
      '[class*="ai-coach-btn"]',
      'a[href="#ai-coach"]',
      '[data-route="ai-coach"]',
      '[data-tab="ai-coach"]',
      '#nav-ai-coach',
      '.sidebar-item:has(> .ai-coach-icon)'
    ];
    var out = [];
    sels.forEach(function (sel) {
      try {
        var nodes = document.querySelectorAll(sel);
        Array.prototype.forEach.call(nodes, function (n) { out.push(n); });
      } catch (_) {}
    });
    // Also match by text content for sidebar "AI Coach" link
    var sidebarItems = document.querySelectorAll('nav a, nav button, .sidebar a, .sidebar button, [class*="sidebar"] a, [class*="nav-item"]');
    Array.prototype.forEach.call(sidebarItems, function (n) {
      var t = (n.textContent || '').trim();
      if (/^AI Coach$/i.test(t) && out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }

  function gate() {
    if (!isFree()) {
      restore();
      return;
    }
    var pts = findEntryPoints();
    pts.forEach(function (el) {
      if (el.getAttribute(HIDE_ATTR) === '1') return;
      el.setAttribute(HIDE_ATTR, '1');
      el.dataset.wjpAiOrigDisplay = el.style.display || '';
      el.style.display = 'none';
    });
  }

  function restore() {
    var hidden = document.querySelectorAll('[' + HIDE_ATTR + '="1"]');
    Array.prototype.forEach.call(hidden, function (el) {
      el.style.display = el.dataset.wjpAiOrigDisplay || '';
      el.removeAttribute(HIDE_ATTR);
    });
  }

  // Add canUseAI() to the shared tier-gate API
  function patchTierGate() {
    if (!window.WJP_TierGate) window.WJP_TierGate = {};
    if (typeof window.WJP_TierGate.canUseAI !== 'function') {
      window.WJP_TierGate.canUseAI = function () {
        var t = getTier();
        return t === 'pro' || t === 'plus' || t === 'admin' || t === 'pro_plus' || t === 'proplus';
      };
    }
  }

  function boot() {
    injectStyle();
    patchTierGate();
    var attempts = 0;
    function tryGate() {
      attempts++;
      if (getTier() != null) {
        gate();
        setInterval(gate, 3000);
        return;
      }
      if (attempts < 30) setTimeout(tryGate, 1000);
    }
    tryGate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_AiFreeGate = {
    gate: gate,
    restore: restore,
    version: 1
  };
})();
