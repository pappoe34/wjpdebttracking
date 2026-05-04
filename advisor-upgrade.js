/* ============================================================================
   AI Coach (advisor) page premium upgrade (P27f)
   - Theme-aware, light + dark mode
   - Hero empty state with sample question cards (replaces the bland welcome bubble)
   - Markdown rendering in bubbles via DOM observer
   - Copy button on AI messages
   - Live "Claude Haiku 4.5" badge
   - Smart, data-aware question cards using user's actual debts
   - Cleaner header microcopy
   ============================================================================ */
(function () {
  'use strict';
  if (window.__WJP_ADVISOR_UPGRADE__) return;
  window.__WJP_ADVISOR_UPGRADE__ = true;

  // -------------- markdown subset (same as ai-coach-v2) ----------------
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

  // -------------- Force Cloud Mode (route to Claude) -------------------
  function forceCloudMode() {
    try {
      if (window.appState && window.appState.prefs) {
        if (!window.appState.prefs.cloudMode) {
          window.appState.prefs.cloudMode = true;
          if (typeof window.saveState === 'function') { try { window.saveState(); } catch {} }
        }
      }
      if (window.WJP_CloudAI) window.WJP_CloudAI.enabled = true;
    } catch {}
  }

  // -------------- Header polish ----------------------------------------
  function polishHeader() {
    const badge = document.getElementById('advisor-mode-badge');
    if (badge) {
      badge.innerHTML = '<i class="ph-fill ph-sparkle" style="font-size:11px;"></i> Claude Haiku 4.5';
    }
    const hint  = document.getElementById('advisor-mode-hint');
    if (hint) hint.textContent = "Powered by Anthropic Claude · uses only your live in-app data.";
    const title = document.querySelector('.advisor-title');
    if (title && title.textContent === 'Ask anything about your money') {
      title.textContent = 'How can I help with your money today?';
    }
    const sub = document.querySelector('.advisor-sub');
    if (sub) sub.textContent = 'Specific answers tied to your real numbers. Stays private.';
    // Side-panel badge sync
    const sideBadge = document.getElementById('aim-model-badge');
    if (sideBadge) sideBadge.textContent = 'Haiku 4.5';
  }

  // -------------- Hero empty state with question cards ------------------
  function smartCards() {
    const cards = [];
    try {
      const debts = (window.appState && window.appState.debts) || [];
      const recurring = (window.appState && window.appState.recurring || []).filter(r => r.category !== 'income');
      const sortedByApr = debts.slice().sort((a,b)=>(b.apr||0)-(a.apr||0));
      const highest = sortedByApr[0];

      if (debts.length) {
        if (highest && highest.name) {
          cards.push({
            icon: '🎯',
            title: `Smartest move on my ${highest.name}?`,
            sub: `Highest APR — ${(highest.apr||0).toFixed(2)}%`,
            q: `What's the smartest next move on my ${highest.name}?`
          });
        }
        cards.push({
          icon: '📅',
          title: 'Which bills are due this week?',
          sub: 'Show me dates + amounts',
          q: 'Which bills are due in the next 7 days? Give me a list with the amount and exact day each one is due.'
        });
        cards.push({
          icon: '⏱',
          title: "When am I debt-free?",
          sub: 'At my current pace',
          q: "At my current pace, when will I be debt-free? Walk me through the calculation."
        });
      }
      if (recurring.length) {
        cards.push({
          icon: '✂',
          title: 'Where can I cut $50/mo?',
          sub: 'From my recurring bills',
          q: 'Looking at my recurring bills, where could I realistically cut about $50/month? Suggest 2-3 candidates and explain why.'
        });
      } else {
        cards.push({
          icon: '💳',
          title: "What's my credit utilization?",
          sub: 'And how to improve it',
          q: "What's my current credit utilization? Tell me which cards are highest and what to pay down first to improve my score."
        });
      }
      cards.push({
        icon: '💡',
        title: 'What if I add $200/mo extra?',
        sub: 'Show me the timeline diff',
        q: "What if I added an extra $200/month toward debt? Show me how much sooner I'd be debt-free and how much interest I'd save."
      });
      cards.push({
        icon: '📊',
        title: 'Audit my whole financial picture',
        sub: 'Top 3 things to fix',
        q: "Look at my whole financial picture — debts, bills, savings, spending — and tell me the top 3 things to fix in priority order."
      });
    } catch {}

    if (!cards.length) {
      // No debts yet — fallback educational cards
      cards.push(
        { icon: '🎓', title: "How does the avalanche strategy work?", sub: "Explain it like I'm new", q: "How does the avalanche strategy work? Explain it simply with an example." },
        { icon: '⚔', title: "Snowball vs avalanche?", sub: "Which should I pick", q: "What's the difference between snowball and avalanche, and which one is better for me?" },
        { icon: '🚀', title: "Help me get started", sub: "What do I add first", q: "I'm new here. What should I add first to start getting useful answers from you?" },
        { icon: '🔒', title: "What data do you read?", sub: "And what stays private", q: "What data do you actually have access to, and what stays private?" }
      );
    }
    return cards.slice(0, 6);
  }

  function renderHero() {
    const scroll = document.getElementById('advisor-chat-scroll');
    if (!scroll) return;

    // If there are existing chat messages (other than the legacy welcome),
    // skip rendering the hero — user has been chatting.
    const existingMsgs = scroll.querySelectorAll('.chat-msg');
    if (existingMsgs.length > 1) return;

    // Wipe legacy welcome + render hero
    scroll.innerHTML = '';
    const hero = document.createElement('div');
    hero.className = 'advisor-hero';
    const debts = (window.appState && window.appState.debts) || [];
    const firstName = (window.appState && window.appState.profile && (window.appState.profile.firstName || (window.appState.profile.fullName || '').split(/\s+/)[0])) || '';
    hero.innerHTML = `
      <div class="advisor-hero-icon"><i class="ph-fill ph-sparkle"></i></div>
      <div class="advisor-hero-title">${firstName ? `Hi ${escHtml(firstName)} — what's on your mind?` : "What can I help you with today?"}</div>
      <div class="advisor-hero-sub">${debts.length
        ? "I've got your live numbers. Try one of these or ask anything specific about your debts, bills, or strategy."
        : "Add some debts and bills first, then ask me anything specific. For now, here are a few things I can explain."}</div>
      <div class="advisor-hero-grid" id="advisor-hero-grid"></div>
    `;
    scroll.appendChild(hero);

    const grid = hero.querySelector('#advisor-hero-grid');
    smartCards().forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'advisor-hero-card';
      btn.type = 'button';
      btn.innerHTML = `
        <span class="advisor-hero-card-icon">${c.icon}</span>
        <span class="advisor-hero-card-text">
          <span class="advisor-hero-card-title">${escHtml(c.title)}</span>
          <span class="advisor-hero-card-sub">${escHtml(c.sub)}</span>
        </span>
      `;
      btn.addEventListener('click', () => {
        const input = document.getElementById('advisor-page-input');
        const sendBtn = document.getElementById('advisor-page-send');
        if (!input || !sendBtn) return;
        input.value = c.q;
        sendBtn.click();
      });
      grid.appendChild(btn);
    });
  }

  // -------------- Chip rail (tighter, smarter) -------------------------
  function renderChips() {
    const rail = document.getElementById('advisor-quick-rail');
    if (!rail) return;
    let prompts = [];
    try {
      const debts = (window.appState && window.appState.debts) || [];
      const highest = debts.slice().sort((a,b)=>(b.apr||0)-(a.apr||0))[0];
      if (highest && highest.name) prompts.push({ label: `🎯 ${highest.name}`, q: `What should I do about my ${highest.name}?` });
      prompts.push({ label: '📅 Due this week', q: 'Which bills are due in the next 7 days?' });
      prompts.push({ label: '⏱ Debt-free date', q: "When will I be debt-free at my current pace?" });
      prompts.push({ label: '✂ Cut $50', q: 'Where can I cut $50/mo from recurring bills?' });
      prompts.push({ label: '💡 +$200/mo', q: 'What if I added $200 extra per month toward debt?' });
      prompts.push({ label: '📊 Audit me', q: 'Audit my whole financial picture and tell me the top 3 things to fix.' });
    } catch {}
    if (!prompts.length) return;
    rail.innerHTML = '';
    prompts.slice(0, 6).forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'advisor-chip';
      btn.dataset.q = p.q;
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        const input = document.getElementById('advisor-page-input');
        const sendBtn = document.getElementById('advisor-page-send');
        if (!input || !sendBtn) return;
        input.value = p.q;
        sendBtn.click();
      });
      rail.appendChild(btn);
    });
  }

  // -------------- MutationObserver: render markdown + copy btn ----------
  function startBubbleObserver() {
    const target = document.getElementById('advisor-chat-scroll');
    if (!target) return;
    const obs = new MutationObserver(() => {
      target.querySelectorAll('.ai-bubble:not([data-md-rendered])').forEach(b => {
        if (b.querySelector('.wjp-thinking') || b.querySelector('.typing-cursor')) return;
        const txt = b.textContent.trim();
        if (!txt) return;
        b.setAttribute('data-md-rendered', '1');
        b.innerHTML = md(txt);
        b.style.lineHeight = '1.55';
        if (!b.parentElement.querySelector('.advisor-copy')) {
          const copy = document.createElement('button');
          copy.className = 'advisor-copy';
          copy.title = 'Copy';
          copy.innerHTML = '<i class="ph ph-copy"></i> Copy';
          copy.addEventListener('click', () => {
            navigator.clipboard.writeText(txt).then(() => {
              copy.innerHTML = '<i class="ph ph-check"></i> Copied';
              setTimeout(() => copy.innerHTML = '<i class="ph ph-copy"></i> Copy', 1500);
            });
          });
          b.parentElement.appendChild(copy);
        }
      });
    });
    obs.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // -------------- Wire clear button to re-render hero ------------------
  function wireClear() {
    const clearBtn = document.getElementById('advisor-clear-btn');
    if (!clearBtn) return;
    clearBtn.addEventListener('click', () => {
      // Existing handler clears + adds a placeholder bubble. We override: re-render hero.
      setTimeout(() => renderHero(), 50);
    }, true);
  }

  // -------------- Init -------------------------------------------------
  function init() {
    forceCloudMode();
    polishHeader();
    renderHero();
    renderChips();
    startBubbleObserver();
    wireClear();

    // Re-apply when navigating to the advisor page
    document.querySelectorAll('[data-page="advisor"]').forEach(el => {
      el.addEventListener('click', () => setTimeout(() => {
        polishHeader();
        renderHero();
        renderChips();
      }, 150));
    });

    // Also keep badge fresh
    setInterval(polishHeader, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
