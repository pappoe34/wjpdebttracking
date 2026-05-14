// netlify/functions/ai-cloud.js — P27 rewrite + P28 server-side rate limiting
//
// Routes AI chat to Anthropic Claude Haiku 4.5 (preferred) or Groq Llama 3.3 70B (fallback).
// Streams responses back to browser as SSE so tokens render as they arrive.
//
// Env vars (Netlify):
//   ANTHROPIC_API_KEY — preferred. Get one at console.anthropic.com/settings/keys
//   GROQ_API_KEY      — fallback if Anthropic key not set or Anthropic call fails
//   FIREBASE_SERVICE_ACCOUNT_JSON — used to verify Firebase ID tokens for rate limiting
//
// P28 — SERVER-SIDE RATE LIMITING (abuse backstop; client still enforces product tiers):
//   Authenticated users: 120 AI calls / day  (way above any honest use — client caps at 5/50/∞)
//   Anonymous / no-token: 8 AI calls / day, tracked by client IP
//   Admin (ADMIN_EMAILS): unlimited
//   Counters live in Firestore: _ai_usage/{uid}_{YYYY-MM-DD} and _ai_anon_usage/{ipKey}_{YYYY-MM-DD}
//   On exceed: 429 with a friendly message. Failure to verify token => treated as anonymous.

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const GROQ_MODEL_DEEP = 'llama-3.3-70b-versatile';
const GROQ_MODEL_FAST = 'llama-3.1-8b-instant';

// P28 — rate-limit config
const AUTHED_DAILY_CAP = 120;   // abuse ceiling for signed-in users
const ANON_DAILY_CAP   = 8;     // strict cap for no-token / cached-old-client requests
const ADMIN_EMAILS     = ['pappoe34@gmail.com'];

// Lazily required so a missing Firebase env var never hard-crashes the AI feature.
let _fb = null;
function fb() {
  if (_fb) return _fb;
  try { _fb = require('./_shared/firebase'); } catch (_) { _fb = false; }
  return _fb;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function sanitize(s) {
  return String(s || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
}

// Returns { allowed, used, cap, identity, decoded } — never throws.
async function checkRateLimit(event) {
  const F = fb();
  // If Firebase isn't wired, we can't track counters — fail OPEN (don't break the
  // feature) but this should never happen in prod since other functions need it.
  if (!F || !F.verifyIdToken || !F.getFirestore) {
    return { allowed: true, used: 0, cap: Infinity, identity: 'no-firebase', decoded: null };
  }

  let decoded = null;
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (authHeader) decoded = await F.verifyIdToken(authHeader);
  } catch (_) { decoded = null; } // invalid/expired token => treat as anonymous

  const db = F.getFirestore();
  const date = todayKey();
  let docRef, cap, identity;

  if (decoded && decoded.uid) {
    // Admin bypass
    if (decoded.email && ADMIN_EMAILS.indexOf(String(decoded.email).toLowerCase()) !== -1) {
      return { allowed: true, used: 0, cap: Infinity, identity: 'admin:' + decoded.uid, decoded };
    }
    cap = AUTHED_DAILY_CAP;
    identity = 'uid:' + decoded.uid;
    docRef = db.collection('_ai_usage').doc(sanitize(decoded.uid) + '_' + date);
  } else {
    cap = ANON_DAILY_CAP;
    var ip = event.headers['x-nf-client-connection-ip']
          || event.headers['client-ip']
          || event.headers['x-forwarded-for']
          || 'unknown-ip';
    ip = String(ip).split(',')[0].trim();
    identity = 'ip:' + ip;
    docRef = db.collection('_ai_anon_usage').doc(sanitize(ip) + '_' + date);
  }

  let used = 0;
  try {
    const snap = await docRef.get();
    used = (snap.exists && snap.data() && Number(snap.data().count)) || 0;
  } catch (_) { used = 0; }

  return { allowed: used < cap, used, cap, identity, decoded, _docRef: docRef };
}

async function bumpUsage(rl) {
  if (!rl || !rl._docRef) return;
  const F = fb();
  if (!F) return;
  try {
    const admin = require('firebase-admin');
    await rl._docRef.set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
      identity: rl.identity
    }, { merge: true });
  } catch (_) { /* counter bump is best-effort — never block the response */ }
}

function buildSystemPrompt(context, tone, length) {
  const toneDirective = {
    direct:   "Tone: direct and terse. Lead with the number or decision. No warmth, no preamble. Surgical sentences.",
    coach:    "Tone: motivating, decisive, like a financial coach. Frame numbers as wins or actionable challenges. Use the user's first name occasionally for accountability.",
    friendly: "Tone: warm and supportive. Address the user by first name once. Acknowledge effort when there's progress, but stay focused on real numbers."
  }[tone] || "Tone: warm and supportive. Address the user by first name once.";

  const lengthDirective = {
    brief:    "Length: 1-3 sentences total. Lead with the headline number, end with one concrete next move. No bullets unless absolutely needed.",
    detailed: "Length: full breakdown, up to 350 words. Use bullets and short paragraphs. Walk through the per-debt or per-category numbers explicitly.",
    standard: "Length: aim for 150-300 words. Short opening line with the headline, then 3-5 tight bullets covering the key points, end with one concrete next action. If the user asked for multiple items (top 3, audit, list of bills), include all requested items even if it pushes toward 350 words."
  }[length] || "Length: aim for 150-300 words. Cover all parts of the question.";

  return [
    "You are WJP — the user's personal financial secretary AND a knowledgeable financial educator, embedded inside their WJP Debt Tracker. You answer two kinds of questions: (1) data-specific questions about THIS user (their debts, bills, score, etc.) using the USER DATA block as absolute ground truth, and (2) general financial education questions (what is avalanche/snowball/hybrid, what is APR, how does credit utilization work, what is DTI, etc.) using your knowledge. When a question has both — like asking about a strategy AND how it applies to them — explain the concept AND apply it to their specific numbers from USER DATA.",
    "",
    "=== USER DATA ===",
    context,
    "=== END USER DATA ===",
    "",
    toneDirective,
    lengthDirective,
    "",
    "Your job (be proactive, not just reactive):",
    "• Answer the asked question directly with specifics from USER DATA.",
    "• Then, when relevant, VOLUNTEER one concrete suggestion the user did not ask for but would benefit from — a card to focus on, a bill to cut, a payment to time differently, a quick win they are missing. Quantify it in dollars or days saved.",
    "• Spot red flags automatically: APRs above 25%, credit utilization above 30%, bills due in <3 days larger than cash on hand, missed payment patterns, savings goals trending behind, subscription bills the user may have forgotten. Surface these even if not asked.",
    "• Recommend specific timing (e.g. pay $X on your Chase card by day 23 to drop utilization before the statement closes), not vague advice.",
    "",
    "Hard rules:",
    "1. Cite specific dollar amounts and EXACT debt/bill names as they appear in USER DATA. Never invent numbers, names, dates, or merchants.",
    "2. For due-soon / this-week / next-payment questions, use the (in Xd) days-until values already in USER DATA. Never reason from raw day-of-month.",
    "3. For DATA-specific questions where a needed fact is missing from USER DATA (e.g., \"what's my credit score?\" but no score loaded), say `I do not have X yet — add it under [exact tab: Debts / Recurring / Income / Goals / Profile]`. Never fabricate user-specific numbers. For GENERAL education questions (what is avalanche, how does APR work, etc.), answer fully from your knowledge — those are not user-specific.",
    "4. If asked about ONE specific debt or bill, focus the answer on THAT one. Do not dump the whole portfolio. Then add ONE optional follow-up suggestion.",
    "5. No hedging like depends-on-your-situation — the data IS the situation. Pick a side.",
    "6. Today date is at the top of USER DATA. Use it for any time-relative reasoning.",
    "7. Money: $1,234 not $1234. Percentages as 28% not 0.28. Whole dollars unless cents matter.",
    "8. No markdown headers (# or ##). Use plain bullets (•) and short paragraphs. Bold key numbers with **markdown**.",
    "9. No Great-question or Based-on-your-data filler openings. Get to the point.",
    "10. End most responses with a single clear next action when one is appropriate — phrased as a recommendation, not a question.",
    "11. When suggesting actions, quantify the impact in real numbers from USER DATA: Save $X over Y months, or Drop utilization from A% to B%.",
    "12. If the user has subscription bills that look forgotten or overlapping (multiple streaming services, gym they may not use — flag from transaction data), call them out by name with the dollar saved per year.",
    "13. EDUCATION questions (definitions, strategy comparisons, how concepts work) get full explanatory answers from your training. When the user has matching data in USER DATA, follow the explanation with a tight \"For your situation:\" paragraph showing how it applies to their actual numbers. Example: explain avalanche, then show that for THEIR top 3 highest-APR debts (from USER DATA) avalanche would target X first, saving roughly $Y over Z months vs minimums."
  ].join('\n');
}

// ============================================================
// Anthropic Claude (preferred) — supports streaming via SSE
// ============================================================
async function streamAnthropic({ apiKey, system, messages, maxTokens, signal }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: system,
      messages: messages,
      stream: true
    }),
    signal
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return resp.body;  // ReadableStream of SSE bytes
}

// ============================================================
// Groq fallback (also streaming, OpenAI-compat)
// ============================================================
async function streamGroq({ apiKey, system, messages, maxTokens, model, signal }) {
  const groqMessages = [{ role: 'system', content: system }, ...messages];
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: groqMessages,
      temperature: 0.2,
      max_tokens: maxTokens,
      top_p: 0.9,
      stream: true
    }),
    signal
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Groq ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return resp.body;
}

// ============================================================
// SSE adapters: convert provider-specific stream → unified text frames
// ============================================================
async function* iterateAnthropicSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = event.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      const json = dataLine.slice(6).trim();
      if (!json) continue;
      try {
        const parsed = JSON.parse(json);
        if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
          yield parsed.delta.text;
        } else if (parsed.type === 'message_stop') {
          return;
        }
      } catch (_) { /* skip bad frames */ }
    }
  }
}

async function* iterateGroqSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = event.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
        if (delta) yield delta;
      } catch (_) { /* skip */ }
    }
  }
}

// ============================================================
// Netlify handler
// ============================================================
exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // OPTIONS -> CORS preflight + admin-page health pinger
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const groqKey      = process.env.GROQ_API_KEY;
  if (!anthropicKey && !groqKey) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ error: 'AI not configured. Add ANTHROPIC_API_KEY (preferred) or GROQ_API_KEY in Netlify env vars.' })
    };
  }

  // ---- P28: server-side rate limiting (abuse backstop) ----
  let rl;
  try {
    rl = await checkRateLimit(event);
  } catch (_) {
    rl = { allowed: true, used: 0, cap: Infinity, identity: 'rl-error', decoded: null };
  }
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': '3600' },
      body: JSON.stringify({
        error: 'rate_limited',
        message: "You've reached today's AI usage limit. It resets at midnight UTC. If you hit this often, reach out at legal@wjpdebttracking.com.",
        used: rl.used,
        cap: rl.cap
      })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const question = String(payload.question || '').trim();
  const context  = String(payload.context  || '').slice(0, 12000);
  const tone     = String(payload.tone     || 'friendly').toLowerCase();
  const length   = String(payload.length   || 'standard').toLowerCase();
  const history  = Array.isArray(payload.history) ? payload.history.slice(-10) : [];
  if (!question) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing question' }) };

  const maxTokens = length === 'brief' ? 350 : length === 'detailed' ? 1500 : 1100;
  const system = buildSystemPrompt(context, tone, length);

  const messages = [...history.map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })), { role: 'user', content: question }];

  const useAnthropic = !!anthropicKey;
  const provider = useAnthropic ? 'anthropic' : 'groq';

  let text = '';
  try {
    if (useAnthropic) {
      const stream = await streamAnthropic({ apiKey: anthropicKey, system, messages, maxTokens });
      for await (const chunk of iterateAnthropicSSE(stream)) text += chunk;
    } else {
      const stream = await streamGroq({ apiKey: groqKey, system, messages, maxTokens, model: GROQ_MODEL_DEEP });
      for await (const chunk of iterateGroqSSE(stream)) text += chunk;
    }
  } catch (err) {
    // If Anthropic failed and we have a Groq key, retry with Groq
    if (useAnthropic && groqKey) {
      try {
        text = '';
        const stream = await streamGroq({ apiKey: groqKey, system, messages, maxTokens, model: GROQ_MODEL_DEEP });
        for await (const chunk of iterateGroqSSE(stream)) text += chunk;
        await bumpUsage(rl);
        return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: text || '(empty)', model: GROQ_MODEL_DEEP, provider: 'groq-fallback', warning: String(err.message || err).slice(0, 200) }) };
      } catch (err2) {
        return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Both providers failed', anthropic: String(err.message||err).slice(0,200), groq: String(err2.message||err2).slice(0,200) }) };
      }
    }
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: `${provider} failed`, detail: String(err.message || err).slice(0, 300) }) };
  }

  // Successful response — count it against the daily limit
  await bumpUsage(rl);

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply: text || '(empty)', model: useAnthropic ? ANTHROPIC_MODEL : GROQ_MODEL_DEEP, provider })
  };
};
