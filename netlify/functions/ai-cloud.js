// netlify/functions/ai-cloud.js
//
// Cloud AI proxy → Groq (free tier) for fast Llama 3.3 70B inference.
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
  if (!question) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing question' }) };
  }

  // 70B handles ~10K context fine. Bumped from 6KB to give richer signal.
  const safeContext = context.slice(0, 10000);

  const systemPrompt = [
    "You are WJP — a sharp, warm, in-app debt and budgeting advisor inside the user's WJP Debt Tracker. The USER DATA block below is real, current, pulled live from this user's account. Treat it as the ground truth.",
    '',
    '=== USER DATA ===',
    safeContext,
    '=== END USER DATA ===',
    '',
    'HOW TO ANSWER:',
    "1. Use the user's first name once, naturally, near the start (e.g., \"Winston, you've got…\"). Don't overuse it.",
    '2. Lead with the recommendation or the number. No "Great question!", no "Based on your data,". Get to the point.',
    '3. ALWAYS cite specific dollar amounts and the EXACT debt/bill names as they appear in USER DATA. Never invent numbers, names, dates, or merchants.',
    "4. If the engine projection or target order is in USER DATA, USE IT — that's the app's real math. Don't recompute payoff order from scratch.",
    "5. For timing questions (\"due soon\", \"this week\"), use the \"in Xd\" days-until values already computed in USER DATA. Never reason from day-of-month.",
    '6. If a needed fact is missing, say "I don\'t have X yet — add it under [exact tab name: Debts / Recurring / Income / Goals / Profile]". Never fabricate.',
    '7. No hedging like "depends on your situation" — the data IS the situation. Be decisive.',
    '8. Format: short opening line with the headline number. Then 2–5 tight bullets OR a short paragraph. No markdown headers (# or ##). Plain bullets (•). No emojis except an occasional ✓ or ⚠.',
    '9. Money: $1,234 not $1234. Percentages as 28% not 0.28. Round to whole dollars unless cents matter.',
    "10. Don't lecture about general personal-finance principles unless asked. Talk about THIS user's specific accounts.",
    '11. Under 220 words unless the user explicitly asks for a full breakdown or plan.',
    "12. Today's date is at the top of USER DATA. Use it for any \"today / this week / this month\" reasoning."
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
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.2,   // grounded; less creative drift
        max_tokens: 800,    // room for richer per-debt breakdowns
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
