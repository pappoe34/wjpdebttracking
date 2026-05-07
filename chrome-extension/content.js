// WJP Chrome Extension — content script
// Detects credit card sign-up confirmation screens on common bank sites.
// Conservative: only fires on pages with strong "you're approved / welcome" signals.

(function () {
  'use strict';

  function detect() {
    const text = document.body.innerText.toLowerCase();
    const indicators = [
      "you've been approved",
      "you have been approved",
      "your account has been approved",
      "welcome to your new",
      "your new credit card",
      "approved for credit"
    ];
    if (!indicators.some(i => text.includes(i))) return;

    // Try to extract: card name, credit limit, APR if visible
    const out = {
      cardName: detectCardName(),
      creditLimit: detectCreditLimit(text),
      apr: detectApr(text),
      pageTitle: document.title
    };
    if (out.cardName || out.creditLimit) {
      chrome.runtime.sendMessage({ type: 'wjp:detected-card', data: out });
      showBadge(out);
    }
  }

  function detectCardName() {
    const t = document.title;
    // Heuristic: "[Card Name] — [Bank Name]" or "Welcome to [Card]"
    const m = t.match(/(?:welcome to your |my )?([A-Z][A-Za-z® ]{4,40}(?:Card|Visa|Mastercard))/i);
    return m ? m[1].trim() : null;
  }

  function detectCreditLimit(text) {
    const m = text.match(/credit limit[:\s]+\$?([\d,]+)/i);
    return m ? '$' + m[1] : null;
  }

  function detectApr(text) {
    const m = text.match(/(\d{1,2}\.\d{1,2})%\s*(?:variable|fixed)?\s*apr/i);
    return m ? m[1] + '%' : null;
  }

  function showBadge(data) {
    if (document.getElementById('wjp-ext-badge')) return;
    const b = document.createElement('div');
    b.id = 'wjp-ext-badge';
    b.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #1f7a4a; color: #fff; border-radius: 12px;
      padding: 14px 18px; max-width: 320px; font-family: system-ui, sans-serif;
      font-size: 13px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);
    `;
    b.innerHTML = `
      <strong>WJP detected a new card</strong><br>
      <span style="opacity:0.9;font-size:12px;">${data.cardName || 'Card'}${data.creditLimit ? ' · Limit: ' + data.creditLimit : ''}</span><br>
      <a href="https://wjpdebttracking.com/index.html?import_from_ext=1" target="_blank"
         style="display:inline-block;margin-top:10px;background:#fff;color:#1f7a4a;text-decoration:none;padding:6px 12px;border-radius:6px;font-weight:700;font-size:12px;">Add to WJP →</a>
      <button id="wjp-ext-close" style="position:absolute;top:8px;right:8px;background:transparent;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">×</button>
    `;
    document.body.appendChild(b);
    const c = document.getElementById('wjp-ext-close');
    if (c) c.addEventListener('click', () => b.remove());
    setTimeout(() => { if (b.parentNode) b.remove(); }, 30000);
  }

  // Run after page load
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(detect, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(detect, 1500));
  }
})();
