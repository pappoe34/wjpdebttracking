// netlify/functions/ai-cloud.js
//
// Cloud AI proxy → Groq. Routes between Llama 3.1 8B (fast/cheap, simple Qs)
// and Llama 3.3 70B (deep/accurate, complex analysis). Client picks via {model}.
// The browser POSTs { question, context } here; we relay to Groq with the
// API key (kept server-side, never exposed to the client). Streams back to
// the browser as SSE.
//
// Setup (one-time):
// 1. Get a free API key at https://console.groq.com/keys
// 2. In Netlify dashboard → Site settings → Environment variables,
//    add GROQ_API_KEY = <your-key>
// 3. Deploy. The function reads process.env.GROQ_API_KEY at runtime.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Cloud AI not configured. Add GROQ_API_KEY in Netlify env vars to enable.'
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const question = String(payload.question || '').trim();
  const context = String(payload.context || '').trim();
  const tone   = String(payload.tone   || 'friendly').toLowerCase();
  const length = String(payload.length || 'standard').toLowerCase();
  // P17h: tier-aware model routing. Client passes 'fast' or 'deep' or 'auto'.
  // 'fast' -> Llama 3.1 8B instant (cheap, simple lookups).
  // 'deep' or omitted -> Llama 3.3 70B versatile (default — accurate analysis).
  const modelPref = String(payload.model || 'deep').toLowerCase();
  const groqModel = (modelPref === 'fast') ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
  if (!question) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing question' }) };
  }

  // 70B handles ~10K context fine. Bumped from 6KB to give richer signal.
  const safeContext = context.slice(0, 10000);

  // === Tone directive ===
  const toneDirective = {
    direct:   "TONE: Direct and terse. Lead with the number/decision, no warmth, no preamble. Surgical sentences.",
    coach:    "TONE: Motivating, decisive, like a financial coach. Frame numbers as wins or actionable challenges. Use the user's name occasionally for accountability.",
    friendly: "TONE: Warm and supportive. Address the user by first name once. Acknowledge effort when there's progress, but stay focused on real numbers."
  }[tone] || "TONE: Warm and supportive. Address the user by first name once.";

  // === Length directive + token cap ===
  const lengthDirective = {
    brief:    "LENGTH: 1–3 sentences total. Lead with the headline number, end with one concrete next move. No bullets unless absolutely needed.",
    detailed: "LENGTH: Full breakdown. Up to 350 words. Use bullets and short paragraphs. Walk through the per-debt or per-category numbers explicitly.",
    standard: "LENGTH: Under 200 words. Short opening line with the headline, 2–4 tight bullets, optional one-line action tail."
  }[length] || "LENGTH: Under 200 words.";

  const maxTokens = length === 'brief' ? 250 : length === 'detailed' ? 1200 : 700;

  const systemPrompt = [
    "You are WJP — an in-app debt and budgeting advisor inside the user's WJP Debt Tracker. The USER DATA block below is real, current, pulled live from this user's account. Treat it as the ground truth.",
    '',
    '=== USER DATA ===',
    safeContext,
    '=== END USER DATA ===',
    '',
    toneDirective,
    lengthDirective,
    '',
    'HARD RULES:',
    '1. ALWAYS cite specific dollar amounts and the EXACT debt/bill names as they appear in USER DATA. Never invent numbers, names, dates, or merchants.',
    "2. If the engine projection or target order is in USER DATA, USE IT — that's the app's real math. Don't recompute payoff order from scratch.",
    "3. For timing questions (\"due soon\", \"this week\"), use the \"in Xd\" days-until values already computed in USER DATA. Never reason from day-of-month.",
    '4. If a needed fact is missing, say "I don\'t have X yet — add it under [exact tab name: Debts / Recurring / Income / Goals / Profile]". Never fabricate.',
    '5. No hedging like "depends on your situation" — the data IS the situation.',
    "6. Today's date is at the top of USER DATA. Use it for any \"today / this week / this month\" reasoning.",
    '7. Money: $1,234 not $1234. Percentages as 28% not 0.28. Whole dollars unless cents matter.',
    '8. No markdown headers (# or ##). Plain bullets (•). No emojis except occasional ✓ or ⚠.',
    "9. No \"Great question!\", \"Based on your data,\", or other filler openings. Get to the point.",
    "10. Don't lecture about general personal-finance principles unless asked."
  ].join('\n');

  // Groq's OpenAI-compatible chat completions endpoint
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Llama 3.3 70B Versatile — strong reasoning, sub-1s typical responses
        model: groqModel,  // P17h routed: 8B-instant or 70B-versatile
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.2,        // grounded; less creative drift
        max_tokens: maxTokens,   // user-configurable via length pref
        top_p: 0.9,
        stream: false   // SSE streaming requires more plumbing; start non-streaming
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: 'Groq error', detail: errText.slice(0, 500) })
      };
    }

    const data = await resp.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: reply || '(empty response)',
        model: data.model,
        usage: data.usage
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Cloud AI request failed', detail: String(err && err.message || err) })
    };
  }
};
