/* wjp-settings-linked-subtitles.js — UX clarity fix for Settings → Linked Accounts.
 *
 * The existing page has two section headers:
 *   "BANKS (PLAID)"          — auto-synced via Plaid
 *   "OTHER LINKED ASSETS"    — manually-tracked (real estate, vehicles, etc.)
 * No explanatory subtitle. Users misread this as "two duplicate lists."
 * This overlay finds each header on the Linked Accounts panel and prepends
 * a clarifying subtitle.
 *
 * Safe: pure read + insert; no listeners on Sync Bank or Plaid Link.
 */
(function () {
  'use strict';
  if (window._wjpLinkedSubtitlesInstalled) return;
  window._wjpLinkedSubtitlesInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var SUBTITLES = {
    'BANKS (PLAID)':
      'Auto-synced bank, credit, and investment accounts.',
    'OTHER LINKED ASSETS':
      'Manually tracked: real estate, vehicles you own, private equity, crypto, art — anything Plaid can’t auto-sync.'
  };
  var MARK = 'data-wjp-subtitle-added';

  function isOnLinkedAccounts() {
    try {
      var h = (location.hash || '').toLowerCase();
      return h.indexOf('settings/linked') !== -1 || h.indexOf('linked-accounts') !== -1;
    } catch (_) { return false; }
  }

  function injectSubtitles() {
    if (!isOnLinkedAccounts()) return;
    // Find labels matching our subtitle keys
    var els = document.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length > 0) continue;
      var txt = (el.textContent || '').trim();
      if (!SUBTITLES[txt]) continue;
      // Already added? Skip
      var nextSib = el.parentElement && el.parentElement.querySelector('[' + MARK + ']');
      if (nextSib) continue;
      // Insert as sibling right after the label
      var sub = document.createElement('div');
      sub.setAttribute(MARK, '1');
      sub.style.cssText = 'font-size:11.5px;color:var(--ink-dim,var(--text-2,#6b7280));' +
        'font-family:inherit;font-weight:500;letter-spacing:0.01em;line-height:1.4;' +
        'margin:4px 0 0 0;text-transform:none;';
      sub.textContent = SUBTITLES[txt];
      try {
        if (el.nextSibling) el.parentElement.insertBefore(sub, el.nextSibling);
        else el.parentElement.appendChild(sub);
      } catch (_) {}
    }
  }

  function start() {
    setInterval(injectSubtitles, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
