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

  // ---- Usage tracking (per-day cloud-AI quota) ----------------------------
  const USAGE_PREFIX = 'wjp.aiUsage.';
  const TIER_LIMITS = {
    'free':         5,
    'trial':        Infinity,
    'pro':          50,
    'pro-plus':     Infinity,
    'pro_plus':     Infinity,
    'proPlus':      Infinity,
    'admin':        Infinity,
  };

  function todayKey() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${USAGE_PREFIX}${d.getFullYear()}-${m}-${day}`;
  }

  function getCurrentTier() {
    try {
      const sub = window.appState && window.appState.subscription;
      if (sub) {
        // Trial state takes precedence — full access during trial
        const te = sub.trial_end || sub.trialEnd;
        if (te) {
          const teMs = typeof te === 'number' ? (te < 1e12 ? te * 1000 : te) : new Date(te).getTime();
          if (teMs > Date.now()) return 'trial';
        }
        if (sub.tier) return String(sub.tier).toLowerCase().replace(/-/g, '_');
        if (sub.isAdmin) return 'admin';
      }
    } catch {}
    return 'free';
  }

  function getLimit() {
    const tier = getCurrentTier();
    return TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : 5;
  }

  function getUsedToday() {
    try { return parseInt(localStorage.getItem(todayKey()) || '0', 10); }
    catch { return 0; }
  }

  function incrementUsage() {
    try { localStorage.setItem(todayKey(), String(getUsedToday() + 1)); } catch {}
  }

  function getUsageInfo() {
    const used = getUsedToday();
    const limit = getLimit();
    return {
      used,
      limit,
      remaining: limit === Infinity ? Infinity : Math.max(0, limit - used),
      tier: getCurrentTier(),
      unlimited: limit === Infinity,
      atLimit: limit !== Infinity && used >= limit,
      msUntilReset: (() => {
        const t = new Date(); t.setHours(24, 0, 0, 0);
        return t.getTime() - Date.now();
      })()
    };
  }

  /** Send a question to /ai-cloud with shared history, persist updated conv,
   *  and return the assistant reply text. Renderers subscribe via the event
   *  to display each assistant chunk. When the daily cloud limit is reached
   *  for the user's tier, falls back to the local rule-based generator. */
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
    // Length: localStorage is canonical (set by the toggle), fall back to appState pref, then default.
    let length = 'standard';
    try {
      const ls = localStorage.getItem('wjp.aiLength');
      if (ls && (ls === 'brief' || ls === 'standard' || ls === 'detailed')) length = ls;
      else if (window.appState && window.appState.prefs && window.appState.prefs.aiLength) length = window.appState.prefs.aiLength;
    } catch {}
    const history = conv.slice(0, -1).slice(-MAX_TURNS * 2);
    console.log('[wjp-chat-core] sending with length=' + length);

    let reply = '';
    let model = '';
    let provider = '';
    const usage = getUsageInfo();

    if (usage.atLimit) {
      // Over the daily cloud limit — fall back to local rule-based generator
      try {
        if (typeof window.generateAiResponse === 'function') {
          reply = window.generateAiResponse(question);
        } else {
          reply = "You've hit today's AI limit on the free tier. Upgrade to Pro Plus for unlimited access, or come back tomorrow when your limit resets.";
        }
      } catch (err) {
        reply = "Couldn't reach the AI: " + String(err.message || err);
      }
      provider = 'local';
      model = 'local-rules';
    } else {
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
        // Increment counter on successful cloud response
        incrementUsage();
      } catch (err) {
        reply = `⚠ Couldn't reach the AI. ${String(err.message || err)}`;
        provider = 'error';
      }
    }

    conv.push({ role: 'assistant', content: reply, model, provider });
    saveHistory(conv);
    // Broadcast usage update so the bar can refresh
    try { window.dispatchEvent(new CustomEvent('wjp:aichat:usage', { detail: getUsageInfo() })); } catch {}
    return reply;
  }

  function on(handler) {
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }

  window.WJP_ChatCore = {
    HISTORY_KEY, EVENT_NAME, MAX_TURNS,
    loadHistory, saveHistory, clearHistory, send, on,
    md, escHtml,
    // Usage tracking
    getUsageInfo, getCurrentTier, getLimit, getUsedToday, TIER_LIMITS,
  };
  console.log('[wjp-chat-core] ready');
})();
