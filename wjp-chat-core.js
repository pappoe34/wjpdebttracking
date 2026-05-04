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
    let persist = true;
    try {
      const pref = window.appState && window.appState.prefs && window.appState.prefs.aiCoach;
      if (pref && pref.saveHistory === false) persist = false;
    } catch {}
    if (persist) {
      try {
        const trimmed = conv.slice(-MAX_TURNS * 2);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      } catch {}
    }
    // Cross-surface sync (always — so both surfaces show the message in this session)
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { conv: conv } })); } catch {}
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { conv: [] } })); } catch {}
  }

  // ---- Usage tracking (per-day cloud-AI quota) ----------------------------
  const USAGE_PREFIX = 'wjp.aiUsage.';
  const TIER_LIMITS = {
    'free':         5,                   // resets daily at local midnight
    'trial':        Infinity,
    'pro':          50,
    'pro-plus':     Infinity,
    'pro_plus':     Infinity,
    'proplus':      Infinity,
    'proPlus':      Infinity,
    'premium':      Infinity,
    'plus':         Infinity,
    'lifetime':     Infinity,
    'paid':         Infinity,
    'admin':        Infinity,
    'unlimited':    Infinity,
  };
  // Admin email fallback — these accounts always get unlimited access regardless of tier
  const ADMIN_EMAILS = ['winstonpappoe01@gmail.com', 'pappoe34@gmail.com'];

  function todayKey() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${USAGE_PREFIX}${d.getFullYear()}-${m}-${day}`;
  }

  // ----- Admin detection (without honoring any test-tier override) -----
  function isActuallyAdmin() {
    try {
      const candidates = [];
      try {
        if (window.firebase && window.firebase.auth) {
          const u = window.firebase.auth().currentUser;
          if (u && u.email) candidates.push(u.email);
        }
      } catch {}
      try {
        const a = window.appState;
        if (a) {
          if (a.profile && a.profile.email) candidates.push(a.profile.email);
          if (a.user && a.user.email) candidates.push(a.user.email);
        }
        if (window.__wjpUser && window.__wjpUser.email) candidates.push(window.__wjpUser.email);
        const cached = localStorage.getItem('wjp_user_email') || localStorage.getItem('user_email');
        if (cached) candidates.push(cached);
      } catch {}
      for (const e of candidates) {
        if (e && ADMIN_EMAILS.includes(String(e).toLowerCase().trim())) return true;
      }
      try {
        if (window.appState && window.appState.subscription && window.appState.subscription.isAdmin) return true;
      } catch {}
      try {
        if (localStorage.getItem('wjp.adminOverride') === '1' || localStorage.getItem('wjp.adminOverride') === 'true') return true;
      } catch {}
    } catch {}
    return false;
  }

  function getAdminTierOverride() {
    try {
      const v = localStorage.getItem('wjp.adminTierOverride');
      if (v && v !== 'auto' && isActuallyAdmin()) return v;
    } catch {}
    return null;
  }

  function setAdminTierOverride(tier) {
    if (!isActuallyAdmin()) return false;
    try {
      if (!tier || tier === 'auto') localStorage.removeItem('wjp.adminTierOverride');
      else localStorage.setItem('wjp.adminTierOverride', tier);
      window.dispatchEvent(new CustomEvent('wjp:aichat:usage'));
      return true;
    } catch { return false; }
  }

  function getCurrentTier() {
    // 0) Admin test-tier override (only honored if user IS an actual admin)
    const override = getAdminTierOverride();
    if (override) return override;
    try {
      // 1) Multiple email sources — admin emails always get unlimited
      const emailCandidates = [];
      try {
        if (window.firebase && window.firebase.auth) {
          const u = window.firebase.auth().currentUser;
          if (u && u.email) emailCandidates.push(u.email);
        }
      } catch {}
      try {
        const a = window.appState;
        if (a) {
          if (a.profile && a.profile.email) emailCandidates.push(a.profile.email);
          if (a.user && a.user.email) emailCandidates.push(a.user.email);
        }
      } catch {}
      try {
        // Some flows stash the user record in window.__wjpUser
        if (window.__wjpUser && window.__wjpUser.email) emailCandidates.push(window.__wjpUser.email);
      } catch {}
      try {
        const cached = localStorage.getItem('wjp_user_email') || localStorage.getItem('user_email');
        if (cached) emailCandidates.push(cached);
      } catch {}
      // Sidebar UI shows the name+email — check the DOM as last resort
      try {
        const dom = document.querySelector('[data-user-email], .user-email');
        if (dom) emailCandidates.push(dom.dataset.userEmail || dom.textContent || '');
      } catch {}

      for (const e of emailCandidates) {
        if (e && ADMIN_EMAILS.includes(String(e).toLowerCase().trim())) return 'admin';
      }

      // 2) Manual admin override via localStorage (lets us flip a single account)
      try {
        if (localStorage.getItem('wjp.adminOverride') === '1' || localStorage.getItem('wjp.adminOverride') === 'true') return 'admin';
      } catch {}

      // 3) Subscription-based detection
      const sub = window.appState && window.appState.subscription;
      if (sub) {
        if (sub.isAdmin) return 'admin';
        const te = sub.trial_end || sub.trialEnd;
        if (te) {
          const teMs = typeof te === 'number' ? (te < 1e12 ? te * 1000 : te) : new Date(te).getTime();
          if (teMs > Date.now()) return 'trial';
        }
        if (sub.tier) {
          const t = String(sub.tier).toLowerCase().replace(/[\s_-]/g, '');
          if (t === 'proplus' || t === 'premium' || t === 'plus' || t === 'lifetime' || t === 'paid' || t === 'unlimited') return 'pro_plus';
          if (t === 'pro') return 'pro';
          if (t === 'free') return 'free';
          return t;
        }
      }

      // 4) Fallback: appState.tier
      if (window.appState && window.appState.tier) {
        const t = String(window.appState.tier).toLowerCase().replace(/[\s_-]/g, '');
        if (t === 'admin' || t === 'unlimited' || t === 'premium') return 'admin';
        if (t === 'proplus' || t === 'plus' || t === 'lifetime') return 'pro_plus';
        return t;
      }

      // 5) Sidebar text fallback — looks for "Premium Tier" or "Admin" badge
      try {
        const sidebar = document.querySelector('.sidebar, .nav-sidebar, .left-sidebar, [class*="sidebar"]');
        if (sidebar) {
          const text = sidebar.textContent || '';
          if (/admin/i.test(text)) return 'admin';
          if (/premium tier|pro plus/i.test(text)) return 'pro_plus';
        }
      } catch {}
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

    // Honor 'Use my real data' toggle in Settings → AI Coach
    let shareData = true;
    try {
      const pref = window.appState && window.appState.prefs && window.appState.prefs.aiCoach;
      if (pref && pref.shareData === false) shareData = false;
    } catch {}
    const ctx = shareData && window.WJP_CloudAI && window.WJP_CloudAI._buildContext
      ? window.WJP_CloudAI._buildContext() : '';
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
    // Admin
    isActuallyAdmin, getAdminTierOverride, setAdminTierOverride,
  };
  console.log('[wjp-chat-core] ready');
})();
