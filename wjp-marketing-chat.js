/* ============================================================================
   WJP Marketing AI Coach (W2)
   Lightweight chat widget for unauthenticated users on marketing pages.
   Different from the in-app chat — answers general product/pricing/feature
   questions, and nudges signup for personalized debt-coach functionality.

   Calls /.netlify/functions/ai-cloud with a "marketing" context flag so the
   AI replies stay scoped to product info, not personal financial advice
   (which requires user data anyway).
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_MarketingChat) return;

  const SESSION_KEY = 'wjp.marketing.chat.history';
  const MAX_TURNS = 6;

  let history = [];
  let isOpen = false;

  function loadHistory() {
    try { history = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]'); }
    catch(_) { history = []; }
  }
  function saveHistory() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(history.slice(-MAX_TURNS * 2))); }
    catch(_) {}
  }

  function fab() {
    const f = document.createElement('button');
    f.id = 'wjp-mc-fab';
    f.setAttribute('aria-label', 'Open AI Coach');
    f.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9998;
      width: 56px; height: 56px; border-radius: 50%; border: none;
      background: linear-gradient(135deg, #1f7a4a, #2b9b72); color: #fff;
      box-shadow: 0 8px 24px rgba(31,122,74,0.35); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.18s, box-shadow 0.18s;
    `;
    f.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    f.addEventListener('mouseenter', () => { f.style.transform = 'scale(1.06)'; });
    f.addEventListener('mouseleave', () => { f.style.transform = 'scale(1)'; });
    f.addEventListener('click', toggle);
    return f;
  }

  function panel() {
    const p = document.createElement('div');
    p.id = 'wjp-mc-panel';
    p.style.cssText = `
      position: fixed; bottom: 88px; right: 20px; z-index: 9998;
      width: 380px; max-width: calc(100vw - 40px); height: 540px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,0.18);
      border: 1px solid #e5e7eb; display: none; flex-direction: column;
      font-family: 'Inter', system-ui, sans-serif; overflow: hidden;
    `;
    p.innerHTML = `
      <div style="padding:14px 18px;background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:800;font-size:14px;">WJP Coach</div>
          <div style="font-size:11px;opacity:0.85;">Ask about pricing, features, or how it works</div>
        </div>
        <button id="wjp-mc-close" aria-label="Close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:22px;line-height:1;padding:0 4px;">×</button>
      </div>
      <div id="wjp-mc-messages" style="flex:1;overflow-y:auto;padding:14px;background:#fafaf7;"></div>
      <form id="wjp-mc-form" style="padding:10px 12px;border-top:1px solid #e5e7eb;background:#fff;display:flex;gap:8px;">
        <input id="wjp-mc-input" type="text" placeholder="Ask about WJP..." aria-label="Message" required
          style="flex:1;border:1px solid #d8d3c4;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none;" />
        <button type="submit" style="background:#1f7a4a;color:#fff;border:none;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px;">Send</button>
      </form>
    `;
    return p;
  }

  function renderMessages() {
    const mc = document.getElementById('wjp-mc-messages');
    if (!mc) return;
    if (!history.length) {
      mc.innerHTML = `
        <div style="text-align:center;color:#5a6b5e;padding:24px 14px;font-size:13px;line-height:1.55;">
          <div style="font-size:32px;margin-bottom:8px;">👋</div>
          <div style="font-weight:700;color:#0a0a0a;margin-bottom:6px;">Hey there.</div>
          <div>Ask me anything about WJP — pricing, features, how it works, or how it compares to Mint, YNAB, Rocket Money.</div>
          <div style="margin-top:14px;display:grid;gap:6px;">
            <button class="wjp-mc-suggest" data-q="What does WJP cost?" style="text-align:left;background:#fff;border:1px solid #d8d3c4;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;font-family:inherit;">What does WJP cost?</button>
            <button class="wjp-mc-suggest" data-q="How is this different from YNAB?" style="text-align:left;background:#fff;border:1px solid #d8d3c4;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;font-family:inherit;">How is this different from YNAB?</button>
            <button class="wjp-mc-suggest" data-q="Can I use this without connecting my bank?" style="text-align:left;background:#fff;border:1px solid #d8d3c4;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;font-family:inherit;">Can I use this without connecting my bank?</button>
          </div>
        </div>`;
      mc.querySelectorAll('.wjp-mc-suggest').forEach(b => {
        b.addEventListener('click', () => send(b.getAttribute('data-q')));
      });
      return;
    }
    mc.innerHTML = history.map(m => {
      const isUser = m.role === 'user';
      return `<div style="display:flex;justify-content:${isUser?'flex-end':'flex-start'};margin-bottom:10px;">
        <div style="max-width:80%;padding:10px 14px;border-radius:14px;background:${isUser?'#1f7a4a':'#fff'};color:${isUser?'#fff':'#0a0a0a'};border:1px solid ${isUser?'#1f7a4a':'#e5e7eb'};font-size:13.5px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(m.content)}</div>
      </div>`;
    }).join('');
    mc.scrollTop = mc.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function send(text) {
    if (!text || !text.trim()) return;
    const inp = document.getElementById('wjp-mc-input');
    if (inp) inp.value = '';
    history.push({ role: 'user', content: text.trim() });
    history.push({ role: 'assistant', content: '...' });
    saveHistory();
    renderMessages();

    const ctx = `You are WJP's marketing assistant. The user is on the public marketing site (not yet signed up). Answer questions about WJP Debt Tracking — pricing, features, security, how it compares to Mint/YNAB/Rocket Money, and how the strategy engine works. Be concise, friendly, and confident. Don't make up financial advice. If asked something only the in-app coach can answer (specific debt strategy, what should I focus on with my numbers), say "Sign up for the free trial — the in-app coach reads your real debts and answers that with your actual numbers." Pricing: Free forever (manual tracking), Pro $11.99/mo (bank sync + AI Coach), Pro Plus $24.99/mo (household + unlimited). 14-day Pro Plus trial, no credit card.`;

    const messages = history.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

    fetch('/.netlify/functions/ai-cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text.trim(),
        context: ctx,
        tone: 'friendly',
        length: 'brief',
        history: messages.slice(0, -1)
      })
    })
    .then(r => r.json())
    .then(d => {
      history[history.length - 1] = { role: 'assistant', content: d.reply || 'Sorry, I had trouble — try again?' };
      saveHistory();
      renderMessages();
    })
    .catch(_ => {
      history[history.length - 1] = { role: 'assistant', content: 'Hm, I lost the connection. Try again?' };
      saveHistory();
      renderMessages();
    });
  }

  function toggle() {
    const p = document.getElementById('wjp-mc-panel');
    if (!p) return;
    isOpen = !isOpen;
    p.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      renderMessages();
      const inp = document.getElementById('wjp-mc-input');
      if (inp) setTimeout(() => inp.focus(), 60);
    }
  }

  function init() {
    if (document.getElementById('wjp-mc-fab')) return;
    loadHistory();
    document.body.appendChild(fab());
    document.body.appendChild(panel());
    document.getElementById('wjp-mc-close').addEventListener('click', toggle);
    document.getElementById('wjp-mc-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = document.getElementById('wjp-mc-input');
      if (inp) send(inp.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.WJP_MarketingChat = { open: () => { isOpen = false; toggle(); }, close: () => { isOpen = true; toggle(); } };
})();
