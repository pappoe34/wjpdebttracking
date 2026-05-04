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
  // appState is loaded from localStorage AFTER DOMContentLoaded fires, so we
  // poll up to 10s. We also re-force cloudMode every time the user navigates
  // to advisor or sends a message — covers the case where Settings toggled
  // cloudMode off.
  function forceCloudMode() {
    let polls = 0;
    const tryForce = () => {
      polls++;
      try {
        const a = window.appState;
        if (a && a.prefs) {
          if (!a.prefs.cloudMode) {
            a.prefs.cloudMode = true;
            if (typeof window.saveState === 'function') { try { window.saveState(); } catch {} }
            console.log('[advisor-upgrade] cloudMode forced ON — chat now routes to Claude.');
          }
          if (window.WJP_CloudAI) window.WJP_CloudAI.enabled = true;
          return true;
        }
      } catch {}
      return false;
    };
    if (tryForce()) return;
    const timer = setInterval(() => {
      if (tryForce() || polls > 50) clearInterval(timer);  // 10s max
    }, 200);
    // Also re-force every 3s indefinitely so it survives any later state mutation
    setInterval(tryForce, 3000);
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
    // Replace button to drop legacy handlers
    const fresh = clearBtn.cloneNode(true);
    clearBtn.parentNode.replaceChild(fresh, clearBtn);
    fresh.addEventListener('click', () => {
      if (!confirm('Clear this conversation?')) return;
      if (window.WJP_ChatCore) window.WJP_ChatCore.clearHistory();
      // Re-render hero (event will also fire)
      setTimeout(renderHero, 60);
    });
  }


  // --------------------------------------------------------------------
  // P27l — render advisor chat from shared ChatCore history + hijack send
  // --------------------------------------------------------------------
  const POLL = (cb, max=50, ms=200) => {
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (cb()) clearInterval(t);
      else if (n > max) clearInterval(t);
    }, ms);
  };

  function renderAdvisorFromHistory() {
    const scroll = document.getElementById('advisor-chat-scroll');
    if (!scroll || !window.WJP_ChatCore) return;
    const conv = window.WJP_ChatCore.loadHistory();
    if (!conv.length) {
      renderHero();
      return;
    }
    // Render messages
    scroll.innerHTML = '';
    conv.forEach(m => renderAdvisorBubble(m.role, m.content));
    scroll.scrollTop = scroll.scrollHeight;
  }

  function renderAdvisorBubble(role, content, isStreaming) {
    const scroll = document.getElementById('advisor-chat-scroll');
    if (!scroll) return null;
    const row = document.createElement('div');
    row.className = `chat-msg ${role === 'assistant' ? 'ai' : 'user'}`;
    if (role === 'assistant') {
      row.innerHTML = `
        <div class="chat-avatar ai-avatar"><i class="ph-fill ph-sparkle"></i></div>
        <div class="chat-content">
          <div class="chat-bubble ai-bubble">${window.WJP_ChatCore.md(content)}</div>
        </div>
      `;
      // Add copy button after a tick
      setTimeout(() => {
        const bubble = row.querySelector('.ai-bubble');
        if (bubble && !row.querySelector('.advisor-copy')) {
          const copy = document.createElement('button');
          copy.className = 'advisor-copy';
          copy.title = 'Copy';
          copy.innerHTML = '<i class="ph ph-copy"></i> Copy';
          copy.addEventListener('click', () => {
            navigator.clipboard.writeText(content).then(() => {
              copy.innerHTML = '<i class="ph ph-check"></i> Copied';
              setTimeout(() => copy.innerHTML = '<i class="ph ph-copy"></i> Copy', 1500);
            });
          });
          bubble.parentElement.appendChild(copy);
        }
      }, 50);
    } else {
      row.innerHTML = `
        <div class="chat-content" style="align-items:flex-end;">
          <div class="chat-bubble user-bubble">${window.WJP_ChatCore.escHtml(content).replace(/\n/g, '<br>')}</div>
        </div>
        <div class="chat-avatar user-avatar-chat"><i class="ph-fill ph-user"></i></div>
      `;
    }
    scroll.appendChild(row);
    scroll.scrollTop = scroll.scrollHeight;
    return row;
  }

  function renderAdvisorThinking() {
    const scroll = document.getElementById('advisor-chat-scroll');
    if (!scroll) return;
    // Avoid duplicate
    if (document.getElementById('advisor-thinking')) return;
    const row = document.createElement('div');
    row.id = 'advisor-thinking';
    row.className = 'chat-msg ai';
    row.innerHTML = `
      <div class="chat-avatar ai-avatar"><i class="ph-fill ph-sparkle"></i></div>
      <div class="chat-content">
        <div class="chat-bubble ai-bubble">
          <div class="wjp-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        </div>
      </div>
    `;
    scroll.appendChild(row);
    scroll.scrollTop = scroll.scrollHeight;
  }
  function clearAdvisorThinking() {
    const t = document.getElementById('advisor-thinking');
    if (t) t.remove();
  }

  function hijackAdvisorSend() {
    const input = document.getElementById('advisor-page-input');
    const sendBtn = document.getElementById('advisor-page-send');
    if (!input || !sendBtn) return;
    if (sendBtn.dataset.hijacked === '1') return;

    // Replace the send button to discard its existing event listeners
    const newBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newBtn, sendBtn);
    newBtn.dataset.hijacked = '1';

    // Replace the textarea similarly so old keydown listeners are gone
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    const doSend = async () => {
      const txt = (newInput.value || '').trim();
      if (!txt) return;
      newInput.value = '';
      newInput.style.height = 'auto';
      // ChatCore handles persistence + event broadcast
      if (window.WJP_ChatCore) {
        try { await window.WJP_ChatCore.send(txt); } catch {}
      }
    };
    newBtn.addEventListener('click', doSend);
    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    newInput.addEventListener('input', () => {
      newInput.style.height = 'auto';
      newInput.style.height = Math.min(140, newInput.scrollHeight) + 'px';
    });
  }

  function wireAdvisorSync() {
    if (!window.WJP_ChatCore) { setTimeout(wireAdvisorSync, 200); return; }
    // Subscribe to cross-surface updates
    window.WJP_ChatCore.on((e) => {
      const detail = e.detail || {};
      const scroll = document.getElementById('advisor-chat-scroll');
      if (!scroll) return;
      // If thinking flag set, render a thinking indicator
      if (detail.thinking) {
        // First render the conv (which now includes the user message)
        renderAdvisorFromHistory();
        renderAdvisorThinking();
        return;
      }
      clearAdvisorThinking();
      renderAdvisorFromHistory();
    });
    // Also re-render on tab nav into advisor
    document.querySelectorAll('[data-page="advisor"]').forEach(el => {
      el.addEventListener('click', () => setTimeout(renderAdvisorFromHistory, 200));
    });
  }



  // -------------- Length selector (Short / Medium / Long) ---------------
  // Maps to backend length: brief / standard / detailed.
  // Persists to appState.prefs.aiLength via saveState.
  const LENGTH_OPTIONS = [
    { key: 'brief',    label: 'Short',  hint: '1-3 sentences'   },
    { key: 'standard', label: 'Medium', hint: '~250 words'      },
    { key: 'detailed', label: 'Long',   hint: 'Full breakdown'  },
  ];

  // Local fallback storage so the toggle works even before appState loads
  const LENGTH_LS_KEY = 'wjp.aiLength';

  function getCurrentLength() {
    try {
      // Prefer appState pref (canonical), fall back to localStorage, then default
      if (window.appState && window.appState.prefs && window.appState.prefs.aiLength) {
        return window.appState.prefs.aiLength;
      }
      const ls = localStorage.getItem(LENGTH_LS_KEY);
      return ls || 'standard';
    } catch { return 'standard'; }
  }

  function setCurrentLength(key) {
    // Always persist to localStorage so it survives reloads even if appState
    // hasn't loaded yet
    try { localStorage.setItem(LENGTH_LS_KEY, key); } catch {}

    // Push to appState if it exists, but DON'T abort if it doesn't
    try {
      if (window.appState) {
        if (!window.appState.prefs) window.appState.prefs = {};
        window.appState.prefs.aiLength = key;
        if (typeof window.saveState === 'function') { try { window.saveState(); } catch {} }
      }
    } catch {}

    // Always refresh the visual state of every toggle on the page
    document.querySelectorAll('.wjp-length-toggle').forEach(refreshLengthToggle);

    // Once appState shows up later, sync our preference into it
    if (!window.appState) {
      const sync = setInterval(() => {
        if (window.appState) {
          if (!window.appState.prefs) window.appState.prefs = {};
          window.appState.prefs.aiLength = key;
          if (typeof window.saveState === 'function') { try { window.saveState(); } catch {} }
          clearInterval(sync);
        }
      }, 200);
      setTimeout(() => clearInterval(sync), 10000);
    }
  }

  function refreshLengthToggle(toggle) {
    const cur = getCurrentLength();
    toggle.querySelectorAll('.wjp-length-opt').forEach(b => {
      const active = b.dataset.length === cur;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function buildLengthToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'wjp-length-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Response length');
    LENGTH_OPTIONS.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wjp-length-opt';
      btn.dataset.length = opt.key;
      btn.title = `${opt.label} — ${opt.hint}`;
      btn.textContent = opt.label;
      btn.addEventListener('click', () => setCurrentLength(opt.key));
      wrap.appendChild(btn);
    });
    refreshLengthToggle(wrap);
    return wrap;
  }

  function injectLengthToggles() {
    // Advisor page header — to the LEFT of the model badge
    const advisorHeaderRight = document.querySelector('#page-advisor .advisor-header-right');
    if (advisorHeaderRight && !advisorHeaderRight.querySelector('.wjp-length-toggle')) {
      const t = buildLengthToggle();
      advisorHeaderRight.insertBefore(t, advisorHeaderRight.firstChild);
    }
    // FAB side panel header — to the LEFT of the action buttons
    const aimHeader = document.querySelector('#ai-chat-panel .aim-header');
    if (aimHeader && !aimHeader.querySelector('.wjp-length-toggle')) {
      const actions = aimHeader.querySelector('.aim-header-actions');
      if (actions) {
        const t = buildLengthToggle();
        actions.parentNode.insertBefore(t, actions);
      }
    }
  }



  // -------------- Usage bar (P27p) -------------------------------------
  function renderUsageBar(targetEl) {
    if (!targetEl || !window.WJP_ChatCore) return;
    const u = window.WJP_ChatCore.getUsageInfo();
    let bar = targetEl.querySelector('.wjp-usage-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'wjp-usage-bar';
      targetEl.appendChild(bar);
    }

    if (u.unlimited) {
      const label = u.tier === 'trial' ? 'Trial · Unlimited' : 'Pro Plus · Unlimited';
      bar.innerHTML = `
        <div class="wjp-usage-text">
          <i class="ph-fill ph-infinity"></i>
          <span>${label}</span>
        </div>
      `;
      bar.classList.remove('over-limit');
      return;
    }

    const pct = Math.min(100, Math.round(u.used / u.limit * 100));
    const tierLabel = u.tier === 'pro' ? 'Pro' : 'Free';
    bar.classList.toggle('over-limit', u.atLimit);
    bar.innerHTML = `
      <div class="wjp-usage-text">
        <span><strong>${u.used}/${u.limit}</strong> ${tierLabel} · cloud requests today</span>
        ${u.atLimit ? '<span class="wjp-usage-badge">Local AI mode</span>' : `<span class="wjp-usage-remaining">${u.remaining} left</span>`}
      </div>
      <div class="wjp-usage-track">
        <div class="wjp-usage-fill" style="width:${pct}%"></div>
      </div>
      ${u.atLimit ? `<div class="wjp-usage-notice">⚠ Daily cloud-AI limit reached. Falling back to local AI (limited capability). <a href="#plans" class="wjp-usage-upgrade">Upgrade to Pro Plus</a> for unlimited.</div>` : ''}
    `;
  }

  function renderTierTestBanner(targetEl) {
    if (!targetEl || !window.WJP_ChatCore) return;
    const override = window.WJP_ChatCore.getAdminTierOverride && window.WJP_ChatCore.getAdminTierOverride();
    let banner = targetEl.querySelector('.wjp-tier-test-banner');
    if (!override) { if (banner) banner.remove(); return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'wjp-tier-test-banner';
      targetEl.insertBefore(banner, targetEl.firstChild);
    }
    banner.innerHTML = `
      <span class="wjp-tier-test-icon"><i class="ph-fill ph-flask"></i></span>
      <span class="wjp-tier-test-text">Admin testing as <strong>${override}</strong></span>
      <button class="wjp-tier-test-clear" type="button" title="Revert to your real admin tier">Revert</button>
    `;
    banner.querySelector('.wjp-tier-test-clear').onclick = () => {
      window.WJP_ChatCore.setAdminTierOverride('auto');
    };
  }

  function injectUsageBars() {
    if (!window.WJP_ChatCore) { setTimeout(injectUsageBars, 200); return; }
    // FAB side panel — under header, above messages
    const fabPanel = document.getElementById('ai-chat-panel');
    if (fabPanel) {
      let host = fabPanel.querySelector('.wjp-usage-host-fab');
      if (!host) {
        host = document.createElement('div');
        host.className = 'wjp-usage-host wjp-usage-host-fab';
        const header = fabPanel.querySelector('.aim-header');
        if (header && header.nextSibling) header.parentNode.insertBefore(host, header.nextSibling);
      }
      renderUsageBar(host);
      renderTierTestBanner(host);
    }
    // Advisor full-page — above the chat scroll
    const advisor = document.getElementById('page-advisor');
    if (advisor) {
      let host = advisor.querySelector('.wjp-usage-host-adv');
      if (!host) {
        host = document.createElement('div');
        host.className = 'wjp-usage-host wjp-usage-host-adv';
        const shell = advisor.querySelector('.advisor-shell');
        if (shell) shell.parentNode.insertBefore(host, shell);
      }
      renderUsageBar(host);
      renderTierTestBanner(host);
    }
  }

  function wireUsageEvents() {
    // Refresh on send response (from ChatCore custom event)
    window.addEventListener('wjp:aichat:usage', () => {
      document.querySelectorAll('.wjp-usage-host').forEach(renderUsageBar);
    });
    // Refresh once per minute so the bar reflects rollover at midnight
    setInterval(() => document.querySelectorAll('.wjp-usage-host').forEach(renderUsageBar), 60000);
    // Re-render aggressively in the first 30s — subscription + firebase.auth load asynchronously,
    // so the tier may flip from "free" to "pro_plus" or "admin" after the initial paint.
    let polls = 0;
    const t = setInterval(() => {
      polls++;
      document.querySelectorAll('.wjp-usage-host').forEach(renderUsageBar);
      if (polls > 30) clearInterval(t);
    }, 1000);
    // Also listen for firebase auth-state changes (signs in / loads user record)
    try {
      if (window.firebase && window.firebase.auth) {
        window.firebase.auth().onAuthStateChanged(() => {
          document.querySelectorAll('.wjp-usage-host').forEach(renderUsageBar);
        });
      }
    } catch {}
  }

  // -------------- Init -------------------------------------------------

  // ---------------------------------------------------------------------
  // P27g — Comprehensive context override.
  // Replaces window.WJP_CloudAI._buildContext with a fuller version that
  // includes linked bank accounts, ALL bills (no cap), upcoming paydays,
  // recent transactions, subscription/trial status, full credit profile,
  // and pending inbox items so Claude can act as a real secretary.
  // ---------------------------------------------------------------------
  function loadStateFromLocalStorage() {
    // The user-specific key takes precedence; fall back to the legacy/anon key.
    const candidates = [];
    try {
      if (window.firebase && window.firebase.auth) {
        const u = window.firebase.auth().currentUser;
        if (u && u.uid) candidates.push('wjp_budget_state_u_' + u.uid);
      }
    } catch {}
    candidates.push('wjp_budget_state');
    for (const key of candidates) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw);
          if (data && typeof data === 'object') return data;
        }
      } catch {}
    }
    return null;
  }

  function buildFullContext() {
    const lines = [];
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dom = now.getDate();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const ms = (d) => Math.ceil((new Date(d) - now) / 86400000);
    const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
    // Source: appState if populated, else fall back to localStorage state (the
    // legacy code path doesn't always rehydrate appState correctly).
    let a = window.appState || {};
    const looksEmpty = !((a.debts && a.debts.length) || (a.transactions && a.transactions.length) || (a.recurring && a.recurring.length) || (a.recurringPayments && a.recurringPayments.length));
    if (looksEmpty) {
      const ls = loadStateFromLocalStorage();
      if (ls) {
        console.log('[advisor-upgrade] appState empty in memory — falling back to localStorage state for AI context (debts:' + (ls.debts?.length || 0) + ', txns:' + (ls.transactions?.length || 0) + ')');
        a = Object.assign({}, ls);  // shallow copy so we don't mutate localStorage parse
      }
    }
    const p = a.profile || {};
    const firstName = (p.fullName || '').split(/\s+/)[0] || 'the user';

    // --- Identity & timestamps ---
    lines.push(`Today: ${today} (day ${dom} of ${dim})`);
    lines.push(`User first name: ${firstName}`);
    if (p.fullName) lines.push(`Full name: ${p.fullName}`);
    if (p.email) lines.push(`Email: ${p.email}`);

    // --- Subscription / trial ---
    const sub = a.subscription || {};
    if (sub.tier) {
      let s = `Plan tier: ${sub.tier}`;
      if (sub.status) s += ` (${sub.status})`;
      if (sub.trial_end || sub.trialEnd) {
        const te = sub.trial_end || sub.trialEnd;
        const teDate = typeof te === 'number' ? new Date(te * (te < 1e12 ? 1000 : 1)) : new Date(te);
        const daysLeft = Math.ceil((teDate - now) / 86400000);
        s += ` · trial ends ${teDate.toISOString().slice(0,10)} (in ${daysLeft}d)`;
      }
      lines.push(s);
    }

    // --- Income & cashflow ---
    const income = (a.budget && a.budget.monthlyIncome) || (a.balances && a.balances.monthlyIncome) || 0;
    if (income) lines.push(`Monthly income: ${fmt(income)}`);
    const cashOnHand = (a.balances && a.balances.cash) || 0;
    if (cashOnHand) lines.push(`Cash on hand (manual): ${fmt(cashOnHand)}`);

    // --- Linked bank accounts (via Plaid) ---
    const linkedAssets = a.linkedAssets || a.assets || [];
    if (linkedAssets.length) {
      const totalAssets = linkedAssets.reduce((sum, x) => sum + (x.balance || x.value || 0), 0);
      lines.push(`\nLinked accounts (${linkedAssets.length}, total ${fmt(totalAssets)}):`);
      linkedAssets.slice(0, 10).forEach(x => {
        const name = x.name || x.officialName || x.institutionName || 'Account';
        const type = x.subtype || x.type || '';
        const bal = x.balance || x.available || x.value || 0;
        lines.push(`- ${name}${type ? ` (${type})` : ''}: ${fmt(bal)}`);
      });
    }

    // --- Emergency fund ---
    const ef = (a.savingsGoals || []).find(g => /emergency/i.test(g.name || ''));
    if (ef) lines.push(`Emergency fund: ${fmt(ef.current||0)} of ${fmt(ef.target||0)} target (${ef.target ? Math.round((ef.current||0)/ef.target*100) : 0}%)`);

    // --- Debts (full detail) ---
    const debts = a.debts || [];
    if (debts.length) {
      lines.push(`\nDebts (${debts.length}):`);
      debts.forEach(d => {
        const dueDom = d.dueDate || d.dueDay;
        let daysUntil = '';
        if (dueDom) {
          let due = new Date(now.getFullYear(), now.getMonth(), dueDom);
          if (due < now) due = new Date(now.getFullYear(), now.getMonth() + 1, dueDom);
          daysUntil = Math.ceil((due - now) / 86400000);
        }
        const monthlyInt = ((d.balance || 0) * (d.apr || 0) / 100 / 12).toFixed(2);
        const util = (d.creditLimit && d.balance) ? Math.round(d.balance / d.creditLimit * 100) : null;
        lines.push(
          `- ${d.name}: ${fmt(d.balance||0)} balance, ${d.apr||0}% APR, ` +
          `${fmt(d.minPayment||0)}/mo min, ` +
          (dueDom ? `due ${dueDom}${daysUntil!=='' ? ` (in ${daysUntil}d)` : ''}, ` : '') +
          `interest cost $${monthlyInt}/mo` +
          (d.creditLimit ? `, limit ${fmt(d.creditLimit)}` : '') +
          (util !== null ? `, util ${util}%` : '') +
          (d.type ? `, type ${d.type}` : '') +
          (d.lastPayment ? `, last paid ${d.lastPayment}` : '')
        );
      });
      const totalDebt = debts.reduce((s, d) => s + (d.balance || 0), 0);
      const totalMin = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
      const totalInt = debts.reduce((s, d) => s + ((d.balance || 0) * (d.apr || 0) / 100 / 12), 0);
      const avgApr = debts.reduce((s, d) => s + (d.apr || 0), 0) / debts.length;
      const ccs = debts.filter(d => d.creditLimit > 0);
      const ccUtil = ccs.length
        ? Math.round(ccs.reduce((s, d) => s + (d.balance || 0), 0) / ccs.reduce((s, d) => s + (d.creditLimit || 0), 0) * 100)
        : null;
      lines.push(`Totals: ${fmt(totalDebt)} debt, ${fmt(totalMin)}/mo min, $${totalInt.toFixed(0)}/mo interest, avg ${avgApr.toFixed(1)}% APR`);
      if (ccUtil !== null) lines.push(`Aggregate credit utilization: ${ccUtil}%`);
      if (income) lines.push(`Debt-to-income (DTI): ${Math.round(totalMin / income * 100)}%`);
    }

    // --- Strategy + engine projection ---
    const strategy = (a.settings && a.settings.strategy) || 'avalanche';
    const extra = (a.budget && a.budget.contribution) || 0;
    lines.push(`\nStrategy: ${strategy}${extra ? `, extra ${fmt(extra)}/mo beyond minimums` : ''}`);
    try {
      if (typeof getProjection === 'function') {
        const proj = getProjection(strategy);
        if (proj && proj.months) {
          const debtFreeDate = new Date(now.getFullYear(), now.getMonth() + proj.months, 1).toISOString().slice(0, 7);
          lines.push(`Engine projection: debt-free in ${proj.months} months (${debtFreeDate})${proj.totalInterest ? `, ${fmt(proj.totalInterest)} total interest` : ''}`);
        }
      }
      if (typeof getStrategyOrder === 'function') {
        const order = getStrategyOrder(strategy);
        if (order && order.length) {
          const top3 = order.slice(0, 3).map(d => d.name).join(' → ');
          lines.push(`Engine target order: ${top3}`);
        }
      }
    } catch (_) {}

    // --- Recurring bills (UNCAPPED) ---
    const recurringAll = (a.recurring || []).concat(a.recurringPayments || []);  // localStorage uses recurringPayments; runtime appState uses recurring
    // Dedupe by id+name+amount
    const seen = new Set();
    const recurring = recurringAll.filter(r => {
      const k = `${r.id||''}|${r.name||r.description||''}|${r.amount||0}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    const bills = recurring.filter(r => r.category !== 'income' && !r.linkedIncome);
    const incomeStreams = recurring.filter(r => r.category === 'income' || r.linkedIncome);

    if (bills.length) {
      const totalRec = bills.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
      lines.push(`\nAll recurring bills (${bills.length}, ${fmt(totalRec)}/mo total):`);
      bills.forEach(r => {
        let daysUntil = '';
        if (r.nextDate) {
          const nd = new Date(r.nextDate);
          if (!isNaN(nd)) daysUntil = Math.ceil((nd - now) / 86400000);
        }
        const name = r.name || r.description || '?';
        const amt = Math.abs(r.amount || 0);
        lines.push(`- ${name}: ${fmt(amt)}/${r.frequency || 'mo'}${daysUntil !== '' ? ` (next in ${daysUntil}d, ${r.nextDate})` : ''}${r.category ? ` · ${r.category}` : ''}${r.merchant ? ` · ${r.merchant}` : ''}`);
      });
    }

    // --- Upcoming income / paydays ---
    if (incomeStreams.length) {
      lines.push(`\nIncome streams (${incomeStreams.length}):`);
      incomeStreams.forEach(r => {
        let daysUntil = '';
        if (r.nextDate) {
          const nd = new Date(r.nextDate);
          if (!isNaN(nd)) daysUntil = Math.ceil((nd - now) / 86400000);
        }
        lines.push(`- ${r.name || 'Income'}: ${fmt(Math.abs(r.amount || 0))}/${r.frequency || 'mo'}${daysUntil !== '' ? ` (next in ${daysUntil}d)` : ''}`);
      });
    }

    // --- Other savings goals ---
    const goals = (a.savingsGoals || []).filter(g => !/emergency/i.test(g.name || ''));
    if (goals.length) {
      lines.push(`\nSavings goals:`);
      goals.forEach(g => {
        const pct = g.target ? Math.round((g.current || 0) / g.target * 100) : 0;
        lines.push(`- ${g.name}: ${fmt(g.current||0)} of ${fmt(g.target||0)} (${pct}%)${g.deadline ? `, deadline ${g.deadline}` : ''}`);
      });
    }

    // --- Recent transactions (last 30, by date desc) ---
    const txns = (a.transactions || []).filter(t => !t.synthetic);
    const cutoff = new Date(now.getTime() - 30 * 86400000);
    const recent = txns.filter(t => new Date(t.date) >= cutoff).sort((x, y) => new Date(y.date) - new Date(x.date));
    if (recent.length) {
      const realSpend = recent.filter(t => t.amount < 0);
      const total = realSpend.reduce((s, t) => s + Math.abs(t.amount), 0);
      const byCat = {};
      realSpend.forEach(t => { const c = t.category || 'Other'; byCat[c] = (byCat[c] || 0) + Math.abs(t.amount); });
      const top = Object.entries(byCat).sort((x, y) => y[1] - x[1]).slice(0, 8);
      lines.push(`\nLast 30d spending: ${fmt(total)} across ${realSpend.length} txns. Top categories:`);
      top.forEach(([c, v]) => lines.push(`- ${c}: ${fmt(v)}`));
      lines.push(`\nRecent transactions (last ${Math.min(20, recent.length)}):`);
      recent.slice(0, 20).forEach(t => {
        const sign = t.amount < 0 ? '-' : '+';
        lines.push(`- ${t.date} · ${t.merchant || t.name || t.description || '?'} · ${sign}${fmt(Math.abs(t.amount))}${t.category ? ` · ${t.category}` : ''}`);
      });
    }

    // --- Credit profile detail ---
    const cp = a.creditProfile || {};
    if (cp.score) {
      let s = `\nCredit score: ${cp.score}`;
      if (cp.bureau) s += ` (${cp.bureau})`;
      if (cp.range) s += ` · range ${cp.range}`;
      if (cp.lastUpdated) s += ` · updated ${cp.lastUpdated}`;
      lines.push(s);
    }
    if (Array.isArray(a.creditScoreHistory) && a.creditScoreHistory.length) {
      const last = a.creditScoreHistory[a.creditScoreHistory.length - 1];
      const first = a.creditScoreHistory[0];
      if (last && first && last.score && first.score) {
        const delta = last.score - first.score;
        lines.push(`Credit score trend: ${first.score} → ${last.score} (${delta >= 0 ? '+' : ''}${delta} over ${a.creditScoreHistory.length} reports)`);
      }
    }

    // --- Pending inbox / notifications ---
    const notifs = (a.notifications || []).filter(n => !n.read && !n.dismissed).slice(0, 8);
    if (notifs.length) {
      lines.push(`\nPending action items in inbox (${notifs.length}):`);
      notifs.forEach(n => {
        const title = n.title || n.message || n.text || '?';
        lines.push(`- [${n.type || 'note'}] ${title.slice(0, 100)}`);
      });
    }

    // --- Household ---
    try {
      const hh = a.household;
      if (hh && hh.inHousehold && hh.household && hh.role === 'owner') {
        const members = (hh.household.members || []).filter(m => m.status === 'active');
        const granted = members.filter(m => m.dataAccessGranted);
        lines.push(`\nHousehold: ${hh.household.name || 'My Household'} · ${members.length} member(s) · ${granted.length} sharing data`);
      } else if (hh && hh.inHousehold) {
        lines.push(`\nHousehold member · role: ${hh.role}`);
      }
    } catch (_) {}

    return lines.join('\n');
  }

  // Override _buildContext on WJP_CloudAI
  function installContextOverride() {
    if (!window.WJP_CloudAI) {
      // Try again shortly
      setTimeout(installContextOverride, 200);
      return;
    }
    if (window.WJP_CloudAI.__contextOverridden) return;
    window.WJP_CloudAI._buildContext = buildFullContext;
    window.WJP_CloudAI.__contextOverridden = true;
    console.log('[advisor-upgrade] Context override installed — Claude now sees full account picture.');
  }

  function init() {
    installContextOverride();
    forceCloudMode();
    // One-time fix: clear any stale shareData=false / aiShare=false flags so the
    // AI gets full data context. Users who explicitly want privacy can re-toggle
    // them off in Settings → AI Coach.
    try {
      let polls = 0;
      const fix = setInterval(() => {
        polls++;
        const a = window.appState;
        if (a && a.prefs) {
          let changed = false;
          if (a.prefs.aiCoach && a.prefs.aiCoach.shareData === false) {
            a.prefs.aiCoach.shareData = true;
            changed = true;
            console.log('[advisor-upgrade] cleared stale shareData=false flag');
          }
          if (a.prefs.privacy && a.prefs.privacy.aiShare === false) {
            a.prefs.privacy.aiShare = true;
            changed = true;
            console.log('[advisor-upgrade] cleared stale aiShare=false flag');
          }
          if (changed && typeof window.saveState === 'function') { try { window.saveState(); } catch {} }
          clearInterval(fix);
        } else if (polls > 50) {
          clearInterval(fix);
        }
      }, 200);
    } catch {}
    polishHeader();
    injectLengthToggles();
    injectUsageBars();
    wireUsageEvents();
    // Re-inject after a short delay in case header DOM mounts late
    setTimeout(() => { injectLengthToggles(); injectUsageBars(); }, 500);
    setTimeout(() => { injectLengthToggles(); injectUsageBars(); }, 1500);
    // Render from shared ChatCore history if any, else hero
    POLL(() => {
      if (!window.WJP_ChatCore) return false;
      renderAdvisorFromHistory();
      hijackAdvisorSend();
      wireAdvisorSync();
      return true;
    });
    renderChips();
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

    // Poll appState until debts are loaded, then re-render hero with smart cards.
    // The chat panel mounts before the user state finishes loading, so the first
    // render hits the "no debts" branch even when the user has 14 debts.
    let polls = 0;
    const ready = setInterval(() => {
      polls++;
      const a = window.appState;
      const debtsReady = a && Array.isArray(a.debts);
      if (debtsReady) {
        renderHero();
        renderChips();
        fixIcons();
        clearInterval(ready);
      } else if (polls > 30) {
        // Give up after ~6s; the empty-state fallback will be visible.
        fixIcons();
        clearInterval(ready);
      }
    }, 200);
  }

  // Replace any ph-robot calendar icon with the sparkle icon directly on the
  // <i> element. CSS pseudo-element overrides don't work reliably for icon
  // fonts because the codepoint is set via the class itself.
  function fixIcons() {
    document.querySelectorAll('#page-advisor .chat-avatar.ai-avatar i, #ai-chat-panel .aim-avatar i').forEach(i => {
      if (!i.classList.contains('ph-sparkle')) {
        i.className = 'ph-fill ph-sparkle';
      }
    });
    // Re-run periodically so newly-added bubbles get the right icon
    setTimeout(fixIcons, 1500);
  }


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
