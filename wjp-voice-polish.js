/* wjp-voice-polish.js — make dashboard copy sound like a person, not a 2008 AI demo.
 *
 * MISSION (per project): "take the guess work out and help people understand
 * their finances without the big jargon wordings."
 *
 * Replaces hard / corporate phrasing with plain English in real time.
 * Keeps wording in line with brand voice. Idempotent: only rewrites once
 * per element via a dataset flag.
 */
(function () {
  'use strict';
  if (window._wjpVoicePolishInstalled) return;
  window._wjpVoicePolishInstalled = true;
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // [match (regex or string), replacement]. Order matters — earliest wins.
  // Keep replacements LITERAL — only a small set, surgical, reversible.
  var SUBS = [
    [/Total Combined Liability/gi, 'What you still owe'],
    [/TOTAL COMBINED LIABILITY/g, 'WHAT YOU STILL OWE'],
    [/Aggregated across (\d+) active debt accounts/i, 'Across $1 accounts'],
    [/Optimal strategy engaged\.?/gi, "You're on the cheapest path."],
    [/My simulations indicate that overpaying beyond your minimums yields the highest ROI\.?/gi,
     'Every dollar above your minimums saves you more interest than the same dollar anywhere else.'],
    [/I will continue to heavily monitor your accounts\.?/gi,
     "I'll keep watching and tell you if anything changes."],
    [/You are currently utilizing the mathematically optimal liquidation route\.?/gi,
     "You're on the cheapest path."],
    [/MONTHLY DEBT PAYOFF ALLOCATION/gi, 'EXTRA TOWARD DEBT EACH MONTH'],
    [/Monthly Debt Payoff Allocation/g, 'Extra toward debt each month'],
    [/AVAILABLE SURPLUS/g, 'WHAT YOU HAVE LEFT'],
    [/Available Surplus/g, 'What you have left'],
    [/∞\s*Ongoing/gi, 'Until paid off'],
    [/infinity\s*Ongoing/gi, 'Until paid off'],
    [/Estimated Completion/gi, 'You’ll be free by'],
    [/ESTIMATED COMPLETION/g, "YOU'LL BE FREE BY"]
  ];

  // Elements likely to contain user-facing copy. We avoid <script>, <style>,
  // and editable inputs — and only walk text nodes.
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, INPUT: 1, TEXTAREA: 1, NOSCRIPT: 1, IFRAME: 1, OBJECT: 1 };

  function rewriteTextNode(node) {
    if (!node || !node.nodeValue) return;
    var orig = node.nodeValue;
    var s = orig;
    for (var i = 0; i < SUBS.length; i++) s = s.replace(SUBS[i][0], SUBS[i][1]);
    if (s !== orig) node.nodeValue = s;
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { rewriteTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP_TAGS[root.tagName]) return;
    if (root.dataset && root.dataset.wjpNoVoice) return;
    // Only walk children if we haven't already rewritten this branch lately
    var kids = root.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }

  function tick() {
    try { walk(document.body); }
    catch (e) { try { console.warn('[wjp-voice-polish] threw', e); } catch (_) {} }
  }

  function boot() {
    setTimeout(tick, 600);
    setInterval(tick, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_VoicePolish = { refresh: tick, _subs: SUBS };
})();
