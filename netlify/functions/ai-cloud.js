// netlify/functions/ai-cloud.js — P27 rewrite
//
// Routes AI chat to Anthropic Claude Haiku 4.5 (preferred) or Groq Llama 3.3 70B (fallback).
// Streams responses back to browser as SSE so tokens render as they arrive.
//
// Env vars (Netlify):
//   ANTHROPIC_API_KEY — preferred. Get one at console.anthropic.com/settings/keys
//   GROQ_API_KEY      — fallback if Anthropic key not set or Anthropic call fails

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const GROQ_MODEL_DEEP = 'llama-3.3-70b-versatile';
const GROQ_MODEL_FAST = 'llama-3.1-8b-instant';

function buildSystemPrompt(context, tone, length) {
  const toneDirective = {
    direct:   "Tone: direct and terse. Lead with the number or decision. No warmth, no preamble. Surgical sentences.",
    coach:    "Tone: motivating, decisive, like a financial coach. Frame numbers as wins or actionable challenges. Use the user's first name occasionally for accountability.",
    friendly: "Tone: warm and supportive. Address the user by first name once. Acknowledge effort when there's progress, but stay focused on real numbers."
  }[tone] || "Tone: warm and supportive. Address the user by first name once.";

  const lengthDirective = {
    brief:    "Length: 1-3 sentences total. Lead with the headline number, end with one concrete next move. No bullets unless absolutely needed.",
    detailed: "Length: full breakdown, up to 350 words. Use bullets and short paragraphs. Walk through the per-debt or per-category numbers explicitly.",
    standard: "Length: under 200 words. Short opening line with the headline, 2-4 tight bullets, optional one-line action tail."
  }[length] || "Length: under 200 words.";

  return [
    "You are WJP — the user's personal financial secretary, embedded inside their WJP Debt Tracker. The USER DATA block below is live, real, pulled from this exact user's account. Treat it as absolute ground truth and act on it.",
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
    "3. If a needed fact is missing, say `I do not have X yet — add it under [exact tab: Debts / Recurring / Income / Goals / Profile]`. Never fabricate.",
    "4. If asked about ONE specific debt or bill, focus the answer on THAT one. Do not dump the whole portfolio. Then add ONE optional follow-up suggestion.",
    "5. No hedging like depends-on-your-situation — the data IS the situation. Pick a side.",
    "6. Today date is at the top of USER DATA. Use it for any time-relative reasoning.",
    "7. Money: $1,234 not $1234. Percentages as 28% not 0.28. Whole dollars unless cents matter.",
    "8. No markdown headers (# or ##). Use plain bullets (•) and short paragraphs. Bold key numbers with **markdown**.",
    "9. No Great-question or Based-on-your-data filler openings. Get to the point.",
    "10. End most responses with a single clear next action when one is appropriate — phrased as a recommendation, not a question.",
    "11. When suggesting actions, quantify the impact in real numbers from USER DATA: Save $X over Y months, or Drop utilization from A% to B%.",
    "12. If the user has subscription bills that look forgotten or overlapping (multiple streaming services, gym they may not use — flag from transaction data), call them out by name with the dollar saved per year."
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
// We re-emit as our own SSE: `data: {"text": "...", "done": false}\n\n`
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
// Netlify handler — STREAMING via the response body iterator
// We use Netlify's "stream" handler form: return ReadableStream.
// ============================================================
exports.handler = async (event) => {
  // OPTIONS -> CORS preflight + admin-page health pinger
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const groqKey      = process.env.GROQ_API_KEY;
  if (!anthropicKey && !groqKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'AI not configured. Add ANTHROPIC_API_KEY (preferred) or GROQ_API_KEY in Netlify env vars.' })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const question = String(payload.question || '').trim();
  const context  = String(payload.context  || '').slice(0, 12000);
  const tone     = String(payload.tone     || 'friendly').toLowerCase();
  const length   = String(payload.length   || 'standard').toLowerCase();
  const history  = Array.isArray(payload.history) ? payload.history.slice(-10) : [];
  if (!question) return { statusCode: 400, body: JSON.stringify({ error: 'Missing question' }) };

  const maxTokens = length === 'brief' ? 250 : length === 'detailed' ? 1200 : 700;
  const system = buildSystemPrompt(context, tone, length);

  // Build conversation messages: [...history, current question]
  const messages = [...history.map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })), { role: 'user', content: question }];

  // Pick provider
  const useAnthropic = !!anthropicKey;
  const provider = useAnthropic ? 'anthropic' : 'groq';

  // === NON-STREAMING fallback path ===
  // Netlify's standard handler doesn't easily support streaming response bodies
  // through `exports.handler`. Easier: collect the stream server-side then
  // return as one JSON response. UI can simulate typing animation.
  // (For true SSE we'd need handler.builder + ResponseStream, which Netlify
  // exposes via @netlify/functions/stream — adds dependency. Skipping.)
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
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: text || '(empty)', model: GROQ_MODEL_DEEP, provider: 'groq-fallback', warning: String(err.message || err).slice(0, 200) }) };
      } catch (err2) {
        return { statusCode: 502, body: JSON.stringify({ error: 'Both providers failed', anthropic: String(err.message||err).slice(0,200), groq: String(err2.message||err2).slice(0,200) }) };
      }
    }
    return { statusCode: 502, body: JSON.stringify({ error: `${provider} failed`, detail: String(err.message || err).slice(0, 300) }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ reply: text || '(empty)', model: useAnthropic ? ANTHROPIC_MODEL : GROQ_MODEL_DEEP, provider })
  };
};
