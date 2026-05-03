// Resend API client — minimal HTTP wrapper.
// Required env: RESEND_API_KEY (rs_...)
// Optional env: EMAIL_FROM (defaults to "WJP <hello@wjpdebttracking.com>")
const FROM_DEFAULT = 'WJP <hello@wjpdebttracking.com>';

async function sendEmail({ to, subject, html, text, replyTo, tags }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('missing env var: RESEND_API_KEY');
  const from = process.env.EMAIL_FROM || FROM_DEFAULT;

  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (text)    body.text = text;
  if (replyTo) body.reply_to = replyTo;
  if (tags)    body.tags = tags; // [{name, value}]

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Resend ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  return { id: data.id, ok: true };
}

module.exports = { sendEmail };
