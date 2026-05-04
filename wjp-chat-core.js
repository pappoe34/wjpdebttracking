/* ============================================================================
   WJP Chat Core (P27l)
   Single source of truth for both AI Coach surfaces:
     • Floating side-panel (#ai-chat-panel / #chat-messages-v2)
     • Full-page advisor tab (#page-advisor / #advisor-chat-scroll)
   Both surfaces share localStorage key wjp.aicoach.history.v1 and a
   "wjp:aichat:update" custom event so a message sent on one surface appears
   instantly on the other.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_ChatCore) return;

  const HISTORY_KEY = 'wjp.aicoach.history.v1';
  const EVENT_NAME = 'wjp:aichat:update';
  const MAX_TURNS = 8;  // 8 turns = 16 messages = ~6KB of conversation history

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
      if (m) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${m[2]}</li>`); }
      else { if (inList) { out.push('</ul>'); inList = false; } if (ln.trim()) out.push(`<p>${ln}</p>`); }
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveHistory(conv) {
    try {
      const trimmed = conv.slice(-MAX_TURNS * 2);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch {}
    // Cross-surface sync
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { conv: conv } })); } catch {}
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { conv: [] } })); } catch {}
  }

  /** Send a question to /ai-cloud with shared history, persist updated conv,
   *  and return the assistant reply text. Renderers subscribe via the event
   *  to display each assistant chunk. */
  async function send(question) {
    question = String(question || '').trim();
    if (!question) return null;
    const conv = loadHistory();
    conv.push({ role: 'user', content: question });
    saveHistory(conv);  // fires update event so both surfaces show user msg

    // Fire a "thinking" event so each surface can show its own typing indicator
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { conv: conv, thinking: true } })); } catch {}

    const ctx = (window.WJP_CloudAI && window.WJP_CloudAI._buildContext) ? window.WJP_CloudAI._buildContext() : '';
    const tone = (window.appState && window.appState.prefs && window.appState.prefs.aiTone) || 'friendly';
    const length = (window.appState && window.appState.prefs && window.appState.prefs.aiLength) || 'standard';
    const history = conv.slice(0, -1).slice(-MAX_TURNS * 2);

    let reply = '';
    let model = '';
    let provider = '';
    try {
      const resp = await fetch('/.netlify/functions/ai-cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: ctx, tone, length, history })
      });
      if (!resp.ok) {
        const t = await resp.text().catch(()=>'');
        throw new Error(`${resp.status}: ${t.slice(0,200)}`);
      }
      const data = await resp.json();
      reply = data.reply || '(no response)';
      model = data.model || '';
      provider = data.provider || '';
    } catch (err) {
      reply = `⚠ Couldn't reach the AI. ${String(err.message || err)}`;
    }

    conv.push({ role: 'assistant', content: reply, model, provider });
    saveHistory(conv);
    return reply;
  }

  function on(handler) {
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }

  window.WJP_ChatCore = {
    HISTORY_KEY, EVENT_NAME, MAX_TURNS,
    loadHistory, saveHistory, clearHistory, send, on,
    md, escHtml
  };
  console.log('[wjp-chat-core] ready');
})();
