// Email templates for WJP welcome sequence.
// Each template returns { subject, html, text } given { firstName, daysLeft }.
// Plain HTML — no CSS frameworks, max email-client compatibility.

const BRAND_GREEN  = '#1f7a4a';
const BRAND_GOLD   = '#c99a2a';
const TEXT         = '#0a0a0a';
const TEXT_DIM     = '#6b7280';
const BG           = '#fafaf7';
const CARD         = '#ffffff';

const SHELL = (innerHTML, preheader) => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BG};opacity:0;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${CARD};border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td><span style="display:inline-block;background:linear-gradient(135deg,${BRAND_GREEN},#2b9b72);color:#fff;padding:6px 12px;border-radius:8px;font-weight:800;font-size:13px;letter-spacing:0.04em;">WJP</span></td>
              <td align="right" style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${TEXT_DIM};font-weight:700;">Debt-free, by design</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          ${innerHTML}
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="font-size:12px;color:${TEXT_DIM};line-height:1.5;">
                <a href="https://wjpdebttracking.com/index.html" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">Open WJP</a>
                &nbsp;&middot;&nbsp;
                <a href="https://wjpdebttracking.com/pricing" style="color:${TEXT_DIM};text-decoration:none;">Pricing</a>
                &nbsp;&middot;&nbsp;
                <a href="https://wjpdebttracking.com/faq" style="color:${TEXT_DIM};text-decoration:none;">FAQ</a>
              </td>
              <td align="right" style="font-size:11px;color:${TEXT_DIM};">
                Pappoe Venture LLC
              </td>
            </tr>
          </table>
          <p style="font-size:11px;color:${TEXT_DIM};margin:14px 0 0;line-height:1.5;">
            You're getting this because you signed up for WJP at wjpdebttracking.com.
            <a href="{{UNSUB}}" style="color:${TEXT_DIM};text-decoration:underline;">Unsubscribe from product emails</a> &middot;
            Keep getting trial &amp; billing notifications.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

function welcomeTemplate({ firstName }) {
  const greet = firstName ? `Welcome to WJP, ${firstName}.` : `Welcome to WJP.`;
  const inner = `
    <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;color:${TEXT};margin:0 0 12px;line-height:1.2;">${greet}</h1>
    <p style="font-size:15px;color:${TEXT};line-height:1.55;margin:0 0 20px;">
      Your <b>14-day Pro Plus trial</b> is active. Bank sync, AI Coach Cloud Mode,
      Hybrid strategy, household mode &mdash; all unlocked.
    </p>
    <p style="font-size:14px;color:${TEXT};line-height:1.6;margin:0 0 18px;">
      Three things to do in your first session, in this order:
    </p>
    <ol style="padding-left:24px;margin:0 0 24px;font-size:14px;line-height:1.7;color:${TEXT};">
      <li><b>Add your debts.</b> Easiest path: snap a statement. OCR pulls balance, APR, minimum.</li>
      <li><b>Pick a strategy.</b> Snowball, Avalanche, or Hybrid &mdash; we show side-by-side.</li>
      <li><b>See your debt-free date.</b> Updates live every time you log a payment.</li>
    </ol>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td>
        <a href="https://wjpdebttracking.com/index.html" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;">
          Open my dashboard &rarr;
        </a>
      </td></tr>
    </table>
    <p style="font-size:13px;color:${TEXT_DIM};margin:18px 0 0;line-height:1.55;">
      Heads up: on day 14 your trial converts to <b>Pro at $11.99/month</b> unless you cancel.
      You'll get reminder emails 7 days and 1 day before — no surprise charge.
    </p>`;
  return {
    subject: `Welcome to WJP${firstName ? `, ${firstName}` : ''} — your 14-day Pro Plus trial is active`,
    html: SHELL(inner, 'Three things to do in your first session.'),
    text: `${greet}\n\nYour 14-day Pro Plus trial is active. Bank sync, AI Coach Cloud Mode, Hybrid strategy, household mode — all unlocked.\n\nThree things to do in your first session:\n1. Add your debts (snap a statement; OCR pulls balance + APR + minimum).\n2. Pick a strategy (Snowball, Avalanche, or Hybrid).\n3. See your debt-free date.\n\nOpen WJP: https://wjpdebttracking.com/index.html\n\nOn day 14 your trial converts to Pro at $11.99/month unless you cancel. Reminder emails go out 7 days + 1 day before — no surprise charge.`
  };
}

function nudgeTemplate({ firstName }) {
  const greet = firstName ? `${firstName} — getting started?` : `Getting started?`;
  const inner = `
    <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;color:${TEXT};margin:0 0 12px;line-height:1.2;">${greet}</h1>
    <p style="font-size:15px;color:${TEXT};line-height:1.55;margin:0 0 18px;">
      You signed up 3 days ago and haven't added a debt yet. The fastest path is one minute:
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f0f1f4;border-radius:10px;margin-bottom:22px;">
      <tr><td style="padding:18px 22px;">
        <h3 style="font-size:16px;font-weight:800;color:${TEXT};margin:0 0 10px;">Snap a statement, we read everything.</h3>
        <p style="font-size:13.5px;color:${TEXT};line-height:1.6;margin:0;">
          Hit <b>+ Add</b> at the top right &rarr; <b>Scan a statement</b>. Pick a PDF or photo. Our OCR pulls balance, APR, minimum payment, due date, credit limit. Review the values, click apply. Done.
        </p>
        <p style="font-size:12px;color:${TEXT_DIM};line-height:1.55;margin:12px 0 0;">
          Works for credit cards, auto, student, mortgage, even paper bills. Runs in your browser &mdash; the file never leaves your phone.
        </p>
      </td></tr>
    </table>
    <p style="font-size:14px;color:${TEXT};line-height:1.55;margin:0 0 18px;">
      Don't have a statement handy? Type one in instead &mdash; same form, ~60 seconds:
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td>
          <a href="https://wjpdebttracking.com/index.html#debts" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;margin-right:8px;">
            Add my first debt &rarr;
          </a>
        </td>
        <td>
          <a href="https://wjpdebttracking.com/how" style="display:inline-block;background:transparent;color:${TEXT};text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px;font-size:13.5px;border:1px solid #e5e7eb;">
            How it works
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:${TEXT_DIM};margin:24px 0 0;line-height:1.55;">
      Stuck on something specific? Reply to this email &mdash; it goes straight to the founder, not a queue.
    </p>`;
  return {
    subject: `Want to skip the typing? Snap a statement instead`,
    html: SHELL(inner, 'Snap a credit card statement and OCR fills the form.'),
    text: `${greet}\n\nYou signed up 3 days ago and haven't added a debt yet. Fastest path is one minute:\n\nSnap a statement, we read everything.\n+ Add at the top right → Scan a statement → pick a PDF or photo. OCR pulls balance, APR, minimum, due date, credit limit. Review and apply.\n\nWorks for credit cards, auto, student, mortgage, even paper bills. Runs in-browser, file never leaves your phone.\n\nDon't have a statement? Type one in:\nhttps://wjpdebttracking.com/index.html#debts\n\nStuck? Reply to this email — goes to the founder.`
  };
}

function midTrialTemplate({ firstName, debtCount, debtFreeYears }) {
  const greet = firstName ? `${firstName}, halfway through your trial.` : `Halfway through your trial.`;
  const wins = [];
  if (debtCount > 0) wins.push(`<b>${debtCount}</b> debt${debtCount === 1 ? '' : 's'} tracked`);
  if (debtFreeYears) wins.push(`debt-free target: <b>${debtFreeYears}</b>`);
  const winsHTML = wins.length
    ? `<p style="font-size:14px;color:${TEXT};line-height:1.6;margin:0 0 16px;"><b>Where you are:</b> ${wins.join(' &middot; ')}.</p>`
    : `<p style="font-size:14px;color:${TEXT};line-height:1.6;margin:0 0 16px;"><b>Heads up:</b> you haven't added a debt yet. There's still time &mdash; trial doesn't pause.</p>`;

  const inner = `
    <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;color:${TEXT};margin:0 0 12px;line-height:1.2;">${greet}</h1>
    <p style="font-size:15px;color:${TEXT};line-height:1.55;margin:0 0 16px;">
      You have <b>7 days left</b> of full Pro Plus access. Then your trial converts to <b>Pro at $11.99/month</b> &mdash; unless you cancel.
    </p>
    ${winsHTML}
    <p style="font-size:14px;color:${TEXT};line-height:1.55;margin:20px 0 14px;font-weight:700;">Three Pro Plus things worth trying before day 14:</p>
    <ol style="padding-left:24px;margin:0 0 22px;font-size:14px;line-height:1.7;color:${TEXT};">
      <li><b>Ask the AI Coach a real question</b> &mdash; e.g., "Should I switch to Avalanche?" It reads your live debts and answers with your actual numbers.</li>
      <li><b>Run a what-if simulation</b> &mdash; throw an extra $200 at the highest APR and watch your debt-free date jump.</li>
      <li><b>Set up bill alerts</b> &mdash; Settings &rarr; Notifications. 1 to 7 days before due, your choice.</li>
    </ol>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td>
          <a href="https://wjpdebttracking.com/index.html" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;margin-right:8px;">
            Open dashboard &rarr;
          </a>
        </td>
        <td>
          <a href="https://wjpdebttracking.com/index.html#plans" style="display:inline-block;background:transparent;color:${TEXT};text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px;font-size:13.5px;border:1px solid #e5e7eb;">
            Manage plan / cancel
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:${TEXT_DIM};margin:24px 0 0;line-height:1.55;">
      What worked? What didn't? Reply with one line &mdash; I read every response.
    </p>`;

  return {
    subject: `7 days left in your Pro Plus trial — quick wins to try`,
    html: SHELL(inner, '7 days left, 3 Pro Plus things worth trying.'),
    text: `${greet}\n\nYou have 7 days left of full Pro Plus access. Then it converts to Pro at $11.99/month on day 14 unless you cancel.\n\n${wins.length ? 'Where you are: ' + wins.join(' · ').replace(/<[^>]+>/g,'') + '.' : 'Heads up: you have not added a debt yet. Trial does not pause.'}\n\nThree Pro Plus things to try before day 14:\n1. Ask the AI Coach a real question (\"Should I switch to Avalanche?\"). Reads your live debts.\n2. Run a what-if simulation — extra $200/mo and watch your debt-free date jump.\n3. Set up bill alerts (Settings → Notifications).\n\nOpen WJP: https://wjpdebttracking.com/index.html\nManage plan: https://wjpdebttracking.com/index.html#plans\n\nReply with one line about what's working / not. I read every response.`
  };
}

module.exports = {
  welcomeTemplate,
  nudgeTemplate,
  midTrialTemplate
};
