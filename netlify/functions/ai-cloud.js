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

  // Truncate context defensively — Groq has token limits and we don't need
  // to send a 50KB prompt for a budget question.
  const safeContext = context.slice(0, 6000);

  const systemPrompt = [
    "You are WJP's in-app debt-tracking AI advisor. Use the USER ACCOUNT DATA below to answer concretely with specific numbers from their account.",
    '',
    '=== USER ACCOUNT DATA ===',
    safeContext,
    '=== END USER DATA ===',
    '',
    'RULES:',
    '1. Always cite specific dollar amounts and debt names from the data.',
    '2. Lead with the number, then the recommendation. Bullets and short paragraphs.',
    "3. If data isn't in context, say \"I don't have X yet — add it under [tab]\".",
    '4. No "depends on your situation" hedging — the data IS the situation.',
    '5. Under 250 words unless user asks for full breakdown.'
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
        temperature: 0.3,
        max_tokens: 600,
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
