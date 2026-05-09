/* wjp-cs-limits-pull.js v1 — adds "Pull from my debts" button to the
 * Credit Card Limits section. On click, scans appState.debts for credit
 * cards with a `limit` field and populates each empty `.cs-card-limit`
 * input — matched by data-card-id.
 */
(function () {
  'use strict';
  if (window._wjpCsLimitsPullInstalled) return;
  window._wjpCsLimitsPullInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function getDebts() {
    try { return (typeof appState !== 'undefined' && appState && appState.debts) || []; }
    catch (_) { return []; }
  }
  function showToast(msg, kind) {
    try { if (typeof window.showToast === 'function') return window.showToast(msg); } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + (kind === 'err' ? '#ef4444' : '#1f7a4a') + ';color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;z-index:99999;';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 3000);
  }

  function findLimitsSection() {
    // Anchor on the heading "Credit card limits" near the form
    var headings = document.querySelectorAll('#credit-score-tab-content div, #credit-score-tab-content span');
    for (var i = 0; i < headings.length; i++) {
      var t = (headings[i].textContent || '').trim().toLowerCase();
      if (t === 'credit card limits (for utilization)' || t.indexOf('credit card limits') === 0) {
        // Walk up to find the parent that contains all cs-card-limit inputs
        var p = headings[i].parentNode;
        while (p && !p.querySelector('.cs-card-limit')) p = p.parentNode;
        return { heading: headings[i], container: p };
      }
    }
    return null;
  }

  function injectButton() {
    var hit = findLimitsSection();
    if (!hit || !hit.heading) return;
    if (hit.heading.querySelector('.wjp-cs-pull-btn')) return; // already injected
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wjp-cs-pull-btn';
    btn.innerHTML = '<i class="ph ph-database" style="margin-right:5px;"></i>Pull from my debts';
    btn.style.cssText = 'margin-left:10px;background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid #22c55e;padding:5px 10px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.05em;text-transform:uppercase;font-family:inherit;';
    hit.heading.appendChild(btn);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var debts = getDebts();
      var inputs = document.querySelectorAll('.cs-card-limit');
      var filled = 0, skipped = 0, notFound = 0;
      inputs.forEach(function (inp) {
        var cardId = inp.getAttribute('data-card-id');
        var debt = debts.find(function (d) { return d.id === cardId; });
        if (!debt) { notFound++; return; }
        var lim = parseFloat(debt.limit);
        if (!isFinite(lim) || lim <= 0) { skipped++; return; }
        var current = parseFloat(inp.value) || 0;
        if (current === lim) { skipped++; return; }
        inp.value = lim;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        var prev = inp.style.boxShadow;
        inp.style.transition = 'box-shadow 0.4s';
        inp.style.boxShadow = '0 0 0 3px #22c55e';
        setTimeout(function () { inp.style.boxShadow = prev || ''; }, 1500);
        filled++;
      });
      if (filled > 0) showToast('Filled ' + filled + ' card limit' + (filled === 1 ? '' : 's') + ' from your debt data.', 'ok');
      else if (skipped > 0) showToast('No new limits to pull — already up to date.', 'ok');
      else showToast('No card limits found on your debt entries. Add limits when you create/edit a debt.', 'err');
    });
  }

  function boot() {
    // Poll for the limits section to appear (rendered when user opens the credit score subtab)
    setInterval(injectButton, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  } else {
    setTimeout(boot, 800);
  }
})();
