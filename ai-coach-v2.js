/* ============================================================================
   AI Coach v2 — modern chat panel (P27)
   Replaces the old #ai-chat-panel handlers. Bubbles, avatars, markdown,
   streaming-style animation, multi-turn history, copy button.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__WJP_AI_COACH_V2__) return;
  window.__WJP_AI_COACH_V2__ = true;

  const HISTORY_KEY = 'wjp.aicoach.history.v1';
  const MAX_HISTORY_TURNS = 6;       // 6 turns = 12 messages sent as context
  const TYPE_SPEED_MS = 12;          // ms per character for typewriter
  let conversation = loadHistory();  // [{role: 'user'|'assistant', content: '...'}]
  let isSending = false;

  // ---------- markdown (tiny subset: **bold**, bullets, line breaks) -------
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function md(text) {
    if (!text) return '';
    let s = escHtml(text);
    // bold **x**
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // inline code `x`
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // bullets: lines starting with • or - or *
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

  // ---------- history persistence -----------------------------------------
  function loadHistory() {
    return window.WJP_ChatCore ? window.WJP_ChatCore.loadHistory() : [];
  }
  function saveHistory() { /* handled by ChatCore */ }
  function clearHistory() {
    if (window.WJP_ChatCore) window.WJP_ChatCore.clearHistory();
    conversation = [];
    renderInitial();
  }

  // ---------- DOM helpers -------------------------------------------------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function userInitial() {
    try {
      const p = window.appState && window.appState.profile;
      const name = (p && (p.fullName || p.firstName)) || (window.firebase && window.firebase.auth && window.firebase.auth().currentUser && window.firebase.auth().currentUser.displayName) || '';
      return (name.trim()[0] || 'U').toUpperCase();
    } catch { return 'U'; }
  }
  function getMessagesEl() { return document.getElementById('chat-messages-v2'); }

  // ---------- rendering ----------------------------------------------------
  function renderMessage(role, content, opts) {
    const wrap = getMessagesEl(); if (!wrap) return null;
    opts = opts || {};
    const row = el('div', { class: `aim-row aim-${role}` });
    const avatar = el('div', { class: 'aim-avatar' });
    if (role === 'assistant') {
      avatar.innerHTML = '<i class="ph-fill ph-sparkle"></i>';
    } else {
      avatar.textContent = userInitial();
    }
    const bubble = el('div', { class: 'aim-bubble' });
    const body = el('div', { class: 'aim-body' });
    body.innerHTML = role === 'assistant' ? md(content) : escHtml(content).replace(/\n/g, '<br>');
    bubble.appendChild(body);

    if (role === 'assistant' && !opts.skeleton) {
      const tools = el('div', { class: 'aim-tools' });
      const copyBtn = el('button', { class: 'aim-copy', title: 'Copy', 'aria-label': 'Copy message' });
      copyBtn.innerHTML = '<i class="ph ph-copy"></i>';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.innerHTML = '<i class="ph ph-check"></i>';
          setTimeout(() => copyBtn.innerHTML = '<i class="ph ph-copy"></i>', 1500);
        });
      });
      tools.appendChild(copyBtn);
      bubble.appendChild(tools);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
    return body;
  }

  function renderTyping() {
    const wrap = getMessagesEl(); if (!wrap) return null;
    const row = el('div', { class: 'aim-row aim-assistant aim-typing-row', id: 'aim-typing' });
    const avatar = el('div', { class: 'aim-avatar' }, '<i class="ph-fill ph-sparkle"></i>');
    const bubble = el('div', { class: 'aim-bubble' });
    bubble.innerHTML = '<div class="aim-typing"><span></span><span></span><span></span></div>';
    row.appendChild(avatar); row.appendChild(bubble);
    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
    return row;
  }
  function clearTyping() {
    const t = document.getElementById('aim-typing');
    if (t) t.remove();
  }

  function renderInitial() {
    const wrap = getMessagesEl(); if (!wrap) return;
    wrap.innerHTML = '';
    if (conversation.length === 0) {
      // Fresh empty state — personalized greeting
      const hasDebts = !!(window.appState && window.appState.debts && window.appState.debts.length);
      const greeting = hasDebts
        ? "Hi — ask me anything specific about your debts, bills, or strategy. Try asking what's due this week, or which debt to focus on next."
        : "Hi — once you add some debts I can give specific answers. For now I can explain payoff strategies or how the math works.";
      renderMessage('assistant', greeting);
    } else {
      conversation.forEach(m => renderMessage(m.role, m.content));
    }
  }

  // ---------- send flow ----------------------------------------------------
  async function send(text) {
    if (isSending) return;
    text = (text || '').trim();
    if (!text) return;
    isSending = true;
    const input = document.getElementById('chat-input-v2');
    if (input) input.value = '';
    // Delegate to shared ChatCore — both surfaces will re-render via event
    if (window.WJP_ChatCore) {
      try { await window.WJP_ChatCore.send(text); } catch {}
    }
    isSending = false;
  }

  function typewriter(bodyEl, fullText) {
    return new Promise(resolve => {
      let i = 0;
      const wrap = getMessagesEl();
      function step() {
        i = Math.min(i + 4, fullText.length);  // 4 chars per tick
        bodyEl.innerHTML = md(fullText.slice(0, i));
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
        if (i < fullText.length) setTimeout(step, TYPE_SPEED_MS);
        else resolve();
      }
      step();
    });
  }

  // ---------- prompt suggestions (data-aware) ------------------------------
  function smartPrompts() {
    const out = [];
    try {
      const debts = (window.appState && window.appState.debts) || [];
      const recurring = (window.appState && window.appState.recurring || []).filter(r => r.category !== 'income');
      if (debts.length) {
        const highest = debts.slice().sort((a,b)=>(b.apr||0)-(a.apr||0))[0];
        if (highest && highest.name) out.push(`What's the smartest move on my ${highest.name}?`);
        out.push("Which bills are due this week?");
        out.push("How long until I'm debt-free at this pace?");
      }
      if (recurring.length) {
        out.push("Where can I cut $50 from recurring bills?");
      }
      out.push("How would adding $200/mo extra change my payoff date?");
    } catch {}
    if (out.length === 0) {
      out.push("How does the avalanche strategy work?");
      out.push("Walk me through getting started.");
      out.push("What data do you need from me?");
    }
    return out.slice(0, 4);
  }

  function renderPrompts() {
    const row = document.getElementById('aim-prompts');
    if (!row) return;
    row.innerHTML = '';
    smartPrompts().forEach(p => {
      const chip = el('button', { class: 'aim-chip', type: 'button' }, escHtml(p));
      chip.addEventListener('click', () => {
        const input = document.getElementById('chat-input-v2');
        if (input) { input.value = p; input.focus(); }
        send(p);
      });
      row.appendChild(chip);
    });
  }

  // ---------- panel wiring -------------------------------------------------
  function wirePanel() {
    const sendBtn = document.getElementById('chat-send-v2');
    const input   = document.getElementById('chat-input-v2');
    const closeBtn = document.getElementById('aim-minimize-btn') || document.getElementById('ai-chat-close-v2');
    const clearBtn = document.getElementById('aim-clear-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => send(input && input.value));
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
      });
      input.addEventListener('input', () => {
        sendBtn.disabled = !input.value.trim();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', () => {
      const panel = document.getElementById('ai-chat-panel');
      if (panel) panel.classList.remove('active');
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (confirm('Clear chat history?')) clearHistory();
    });
  }

  function init() {
    if (!document.getElementById('chat-messages-v2')) return;  // panel not present yet
    renderInitial();
    renderPrompts();
    wirePanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();


  // Cross-surface sync — re-render whenever ChatCore broadcasts updates
  function wireSync() {
    if (!window.WJP_ChatCore) { setTimeout(wireSync, 200); return; }
    window.WJP_ChatCore.on((e) => {
      const detail = e.detail || {};
      conversation = detail.conv || window.WJP_ChatCore.loadHistory();
      const wrap = getMessagesEl();
      if (!wrap) return;
      // Re-render messages
      wrap.innerHTML = '';
      if (conversation.length === 0) {
        renderInitial();
        return;
      }
      conversation.forEach(m => renderMessage(m.role, m.content));
      if (detail.thinking) renderTyping();
    });
  }
  wireSync();

  // Expose for debugging
  window.WJP_AICoachV2 = { send, clearHistory, renderInitial, renderPrompts };
})();
