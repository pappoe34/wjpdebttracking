/* ============================================================================
   AI Advisor Page Upgrade (P27d) — extends ai-coach-v2 to the full-page
   #page-advisor surface. Forces all chat through Claude (ai-cloud.js).
   Renders markdown, modernizes bubble look via attribute hook, and replaces
   the "Standard / Deep Mode" badge with the live Claude model name.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__WJP_ADVISOR_UPGRADE__) return;
  window.__WJP_ADVISOR_UPGRADE__ = true;

  // -------- markdown helpers (same subset as ai-coach-v2) --------
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function md(text) {
    if (!text) return '';
    let s = escHtml(text);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    const lines = s.split('\n');
    const out = []; let inList = false;
    for (const ln of lines) {
      const m = ln.match(/^\s*([•\-\*])\s+(.+)$/);
      if (m) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${m[2]}</li>`);
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        if (ln.trim()) out.push(`<p>${ln}</p>`);
      }
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  // -------- Force Cloud Mode (so all chat goes through Claude) --------
  function forceCloudMode() {
    try {
      if (window.appState && window.appState.prefs) {
        if (!window.appState.prefs.cloudMode) {
          window.appState.prefs.cloudMode = true;
          if (typeof window.saveState === 'function') {
            try { window.saveState(); } catch {}
          }
          console.log('[advisor-upgrade] Cloud Mode enabled — routing through Claude');
        }
      }
      if (window.WJP_CloudAI) window.WJP_CloudAI.enabled = true;
    } catch {}
  }

  // -------- Badge override: show Claude model --------
  function overrideBadge() {
    const badge = document.getElementById('advisor-mode-badge');
    const hint  = document.getElementById('advisor-mode-hint');
    if (badge) {
      badge.textContent = '✨ Claude Haiku 4.5';
      badge.style.cssText = `
        background: linear-gradient(135deg, rgba(0,212,168,0.18), rgba(102,126,234,0.18));
        color: #5fe6c3;
        border: 1px solid rgba(0,212,168,0.35);
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.01em;
        text-transform: none;
      `;
    }
    if (hint) {
      hint.textContent = "Powered by Anthropic Claude · works only with your live in-app data.";
    }
    // Also tag side-panel badge if present
    const sideBadge = document.getElementById('aim-model-badge');
    if (sideBadge) sideBadge.textContent = 'Haiku 4.5';
  }

  // -------- MutationObserver: render markdown in any new advisor bubble --------
  // The legacy setupChatInstance writes plain text to .ai-bubble. We watch for
  // new .ai-bubble elements and convert their text content to rendered HTML.
  function startBubbleObserver() {
    const target = document.getElementById('advisor-chat-scroll');
    if (!target) return;
    const obs = new MutationObserver(() => {
      target.querySelectorAll('.ai-bubble:not([data-md-rendered])').forEach(b => {
        // Skip "thinking" placeholders
        if (b.querySelector('.wjp-thinking') || b.querySelector('.typing-cursor')) return;
        const txt = b.textContent.trim();
        if (!txt) return;
        // Only render once content is final (not while streaming)
        b.setAttribute('data-md-rendered', '1');
        b.innerHTML = md(txt);
        b.style.lineHeight = '1.55';
        // Add copy button
        if (!b.parentElement.querySelector('.advisor-copy')) {
          const copy = document.createElement('button');
          copy.className = 'advisor-copy';
          copy.title = 'Copy';
          copy.innerHTML = '<i class="ph ph-copy"></i>';
          copy.addEventListener('click', () => {
            navigator.clipboard.writeText(txt).then(() => {
              copy.innerHTML = '<i class="ph ph-check"></i>';
              setTimeout(() => copy.innerHTML = '<i class="ph ph-copy"></i>', 1500);
            });
          });
          b.parentElement.appendChild(copy);
        }
      });
    });
    obs.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // -------- Personalized chip suggestions (data-aware) --------
  function refreshAdvisorChips() {
    const rail = document.getElementById('advisor-quick-rail');
    if (!rail) return;
    let prompts = [];
    try {
      const debts = (window.appState && window.appState.debts) || [];
      const recurring = (window.appState && window.appState.recurring || []).filter(r => r.category !== 'income');
      if (debts.length) {
        const highest = debts.slice().sort((a,b)=>(b.apr||0)-(a.apr||0))[0];
        if (highest && highest.name) prompts.push({ icon: '🎯', q: `What's the smartest move on my ${highest.name}?`, label: `Focus: ${highest.name}` });
        prompts.push({ icon: '📅', q: 'Which bills are due in the next 7 days?', label: 'Due this week' });
        prompts.push({ icon: '⏱', q: "How long until I'm debt-free at this pace?", label: 'Debt-free date' });
      }
      if (recurring.length) {
        prompts.push({ icon: '✂', q: 'Where can I cut $50 from recurring bills?', label: 'Cut $50' });
      }
      prompts.push({ icon: '💡', q: "If I add an extra $200/mo, when am I debt-free?", label: 'What-if $200' });
      prompts.push({ icon: '📊', q: "What's my credit utilization right now?", label: 'Credit util' });
    } catch {}
    if (!prompts.length) return;
    rail.innerHTML = '';
    prompts.slice(0, 6).forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'advisor-chip';
      btn.dataset.q = p.q;
      btn.textContent = `${p.icon} ${p.label}`;
      rail.appendChild(btn);
    });
    // Re-wire chips to send via existing #advisor-page-input/#advisor-page-send
    const input = document.getElementById('advisor-page-input');
    const sendBtn = document.getElementById('advisor-page-send');
    rail.querySelectorAll('.advisor-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (!input || !sendBtn) return;
        input.value = chip.dataset.q || chip.textContent;
        sendBtn.click();
      });
    });
  }

  // -------- Welcome message override --------
  function refreshWelcome() {
    const scroll = document.getElementById('advisor-chat-scroll');
    if (!scroll) return;
    const firstAi = scroll.querySelector('.chat-msg.ai .ai-bubble');
    if (!firstAi) return;
    const hasDebts = !!(window.appState && window.appState.debts && window.appState.debts.length);
    if (firstAi.textContent.trim().startsWith('Hi — ready when you are.')) {
      firstAi.textContent = hasDebts
        ? "Hi — I read your live debts, bills, and spending. Try asking specific things: which bill is due next, smartest move on a particular card, or what-if scenarios."
        : "Hi — once you add some debts I can give you specific answers tied to your numbers. For now I can explain payoff strategies and how the math works.";
      firstAi.setAttribute('data-md-rendered', '1');
    }
  }

  // -------- Init --------
  function init() {
    forceCloudMode();
    overrideBadge();
    refreshWelcome();
    refreshAdvisorChips();
    startBubbleObserver();

    // Re-apply when navigating into the advisor page (re-renders DOM in some flows)
    document.querySelectorAll('[data-page="advisor"]').forEach(el => {
      el.addEventListener('click', () => setTimeout(() => {
        overrideBadge();
        refreshWelcome();
        refreshAdvisorChips();
      }, 150));
    });

    // Re-tag side-panel badge whenever it's swapped
    setInterval(overrideBadge, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
