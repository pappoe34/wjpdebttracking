// W3 Retention email templates — appended to existing email-templates.js.
// New templates: weeklyProgressTemplate, monthlyReportTemplate, quarterlyReportTemplate, annualReportTemplate.
// Tier-gated at the cron level: free tier gets monthly only; Pro+ gets weekly + monthly; Pro Plus gets all 4.

const BRAND_GREEN  = '#1f7a4a';
const BRAND_GOLD   = '#c99a2a';
const TEXT         = '#0a0a0a';
const TEXT_DIM     = '#6b7280';
const BG           = '#fafaf7';
const CARD         = '#ffffff';

// Reuse SHELL from main email-templates.js. We require it at runtime.
const { SHELL: PARENT_SHELL } = (() => {
  try { return require('./email-templates'); } catch(_) { return { SHELL: null }; }
})();

// Inline fallback shell if the parent isn't available
function SHELL(inner, pre) {
  if (PARENT_SHELL) return PARENT_SHELL(inner, pre);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:${BG};font-family:system-ui,sans-serif;">${pre?`<div style="display:none">${pre}</div>`:''}<div style="max-width:560px;margin:0 auto;background:${CARD};border-radius:14px;padding:24px;">${inner}</div></body></html>`;
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$—';
  const v = Math.abs(Number(n));
  const sign = Number(n) < 0 ? '-' : '';
  return sign + '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPct(n, digits = 0) {
  if (n == null || isNaN(n)) return '—%';
  return Number(n).toFixed(digits) + '%';
}

// ===========================================================================
// 1. WEEKLY PROGRESS — Pro/Pro Plus only
// Args: { firstName, weekDelta, debtFreeDate, totalPaid, daysCloser, isAhead }
//   weekDelta: how many days ahead/behind plan you moved this week (positive = ahead)
//   debtFreeDate: ISO date string of current projected freedom day
//   totalPaid: $ paid toward debt this week
//   daysCloser: days closer to free vs. last week
//   isAhead: bool, true if user is ahead of original plan
// ===========================================================================
function weeklyProgressTemplate({ firstName, weekDelta, debtFreeDate, totalPaid, daysCloser, isAhead }) {
  const greet = firstName ? `Quick check-in, ${firstName}.` : `Quick check-in.`;
  const moveLabel = (weekDelta || 0) >= 0 ? `${weekDelta} days closer` : `${Math.abs(weekDelta)} days behind`;
  const moveColor = (weekDelta || 0) >= 0 ? BRAND_GREEN : '#c0594a';
  const dateStr = debtFreeDate ? new Date(debtFreeDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'TBD';

  const inner = `
    <p style="font-size:15px;line-height:1.6;color:${TEXT};margin:0 0 20px;font-weight:600;">${greet}</p>
    <p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 18px;">Here's how this week moved your debt-free date:</p>
    <div style="background:${BG};border-radius:12px;padding:22px;margin:0 0 18px;border:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${TEXT_DIM};font-weight:700;margin-bottom:6px;">Debt-free on</div>
      <div style="font-size:28px;font-weight:800;color:${TEXT};letter-spacing:-0.02em;margin-bottom:14px;">${dateStr}</div>
      <div style="font-size:14px;font-weight:700;color:${moveColor};">${moveLabel} this week</div>
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
      <tr>
        <td style="padding:12px 14px;background:${BG};border-radius:10px;width:48%;font-size:12px;color:${TEXT_DIM};">
          Paid this week<br><strong style="font-size:18px;color:${TEXT};">${fmtMoney(totalPaid)}</strong>
        </td>
        <td style="width:4%;"></td>
        <td style="padding:12px 14px;background:${BG};border-radius:10px;width:48%;font-size:12px;color:${TEXT_DIM};">
          vs. last week<br><strong style="font-size:18px;color:${moveColor};">${(daysCloser||0) >= 0 ? '+' : ''}${daysCloser||0} days</strong>
        </td>
      </tr>
    </table>
    ${isAhead
      ? `<p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 14px;">You're ahead of the original plan. Want to push further? Open the <a href="https://wjpdebttracking.com/index.html#advisor" style="color:${BRAND_GREEN};text-decoration:none;font-weight:700;">AI Coach</a> for a what-if simulation — even $50 extra this month can move your date a week.</p>`
      : `<p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 14px;">A small dip is normal. <a href="https://wjpdebttracking.com/index.html#advisor" style="color:${BRAND_GREEN};text-decoration:none;font-weight:700;">Ask your AI Coach</a> what one move would put you back on track.</p>`}
    <a href="https://wjpdebttracking.com/index.html" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px;">Open dashboard &rarr;</a>
  `;
  return {
    subject: `${(weekDelta||0) >= 0 ? '✓' : '↻'} Week in review${firstName ? ', ' + firstName : ''}: ${moveLabel}`,
    html: SHELL(inner, `${moveLabel} toward debt-free this week.`),
    text: `${greet}\n\nThis week: ${moveLabel} toward debt-free.\nProjected free date: ${dateStr}\nPaid this week: ${fmtMoney(totalPaid)}\nDelta vs last week: ${(daysCloser||0) >= 0 ? '+' : ''}${daysCloser||0} days\n\n${isAhead ? "You're ahead of plan — want to push further?" : "Small dip is normal — ask your AI Coach what move would help."}\n\nOpen WJP: https://wjpdebttracking.com/index.html`
  };
}

// ===========================================================================
// 2. MONTHLY REPORT — All paid tiers, capped summary for Free
// Args: { firstName, month, totalPaid, interestPaid, principalPaid, debtsClosed, debtFreeDate, biggestWin }
// ===========================================================================
function monthlyReportTemplate({ firstName, month, totalPaid, interestPaid, principalPaid, debtsClosed, debtFreeDate, biggestWin }) {
  const dateStr = debtFreeDate ? new Date(debtFreeDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'TBD';
  const interestPct = totalPaid > 0 ? Math.round(interestPaid / totalPaid * 100) : 0;

  const inner = `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${TEXT_DIM};font-weight:700;margin:0 0 6px;">Monthly report &middot; ${month || 'This month'}</p>
    <h1 style="font-size:24px;font-weight:800;color:${TEXT};letter-spacing:-0.02em;margin:0 0 8px;">${firstName ? firstName + ', ' : ''}you paid <span style="color:${BRAND_GREEN}">${fmtMoney(totalPaid)}</span> toward debt</h1>
    <p style="font-size:14px;line-height:1.55;color:${TEXT_DIM};margin:0 0 22px;">Here's where it went, and where you stand:</p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
      <tr>
        <td style="padding:14px;background:${BG};border-radius:10px;width:48%;">
          <div style="font-size:11px;color:${TEXT_DIM};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">Principal</div>
          <div style="font-size:20px;font-weight:800;color:${BRAND_GREEN};">${fmtMoney(principalPaid)}</div>
          <div style="font-size:11px;color:${TEXT_DIM};">balance reduction</div>
        </td>
        <td style="width:4%;"></td>
        <td style="padding:14px;background:${BG};border-radius:10px;width:48%;">
          <div style="font-size:11px;color:${TEXT_DIM};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">Interest</div>
          <div style="font-size:20px;font-weight:800;color:#c0594a;">${fmtMoney(interestPaid)}</div>
          <div style="font-size:11px;color:${TEXT_DIM};">${interestPct}% of paid</div>
        </td>
      </tr>
    </table>

    ${debtsClosed && debtsClosed.length ? `
    <div style="background:linear-gradient(135deg,rgba(31,122,74,0.08),rgba(201,154,42,0.04));border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin:0 0 18px;">
      <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_GREEN};font-weight:800;margin-bottom:8px;">🎉 Debts closed this month</div>
      <ul style="margin:0;padding-left:18px;color:${TEXT};font-size:14px;line-height:1.6;">
        ${debtsClosed.map(d => `<li>${d}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${biggestWin ? `<p style="background:${BG};padding:14px;border-radius:10px;font-size:13px;line-height:1.55;color:${TEXT};margin:0 0 18px;border-left:3px solid ${BRAND_GREEN};"><strong>Biggest win:</strong> ${biggestWin}</p>` : ''}

    <p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 14px;">At your current pace you'll be debt-free in <strong>${dateStr}</strong>.</p>

    <a href="https://wjpdebttracking.com/index.html" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px;">Open dashboard &rarr;</a>
    <a href="https://wjpdebttracking.com/index.html#advisor" style="display:inline-block;color:${BRAND_GREEN};text-decoration:none;padding:12px 14px;font-weight:700;font-size:14px;">Ask the AI Coach &rarr;</a>
  `;
  return {
    subject: `${month || 'Monthly'} report: ${fmtMoney(totalPaid)} toward debt-free${debtsClosed && debtsClosed.length ? ' · ' + debtsClosed.length + ' debt' + (debtsClosed.length>1?'s':'') + ' closed' : ''}`,
    html: SHELL(inner, `${fmtMoney(totalPaid)} paid this month — ${fmtMoney(principalPaid)} principal, ${fmtMoney(interestPaid)} interest.`),
    text: `${firstName ? firstName + ',' : ''} you paid ${fmtMoney(totalPaid)} toward debt this month.\n\nPrincipal: ${fmtMoney(principalPaid)}\nInterest: ${fmtMoney(interestPaid)} (${interestPct}% of paid)\n${debtsClosed && debtsClosed.length ? 'Debts closed: ' + debtsClosed.join(', ') + '\n' : ''}${biggestWin ? '\nBiggest win: ' + biggestWin + '\n' : ''}\nDebt-free projection: ${dateStr}\n\nOpen WJP: https://wjpdebttracking.com/index.html`
  };
}

// ===========================================================================
// 3. QUARTERLY REPORT — Pro Plus only (extensive with suggestions)
// Args: { firstName, quarter, totalPaid, interestPaid, debtFreeDeltaDays, suggestions }
// suggestions: [{ title, detail, impact }]  — 3-5 actionable AI suggestions
// ===========================================================================
function quarterlyReportTemplate({ firstName, quarter, totalPaid, interestPaid, debtFreeDeltaDays, suggestions }) {
  const sugList = (suggestions || []).slice(0, 5).map((s, i) => `
    <div style="background:${BG};border-radius:10px;padding:16px;margin:0 0 10px;border-left:3px solid ${BRAND_GREEN};">
      <div style="font-size:11px;color:${TEXT_DIM};font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Suggestion ${i+1}</div>
      <div style="font-size:15px;font-weight:700;color:${TEXT};margin-bottom:6px;">${s.title}</div>
      <div style="font-size:13px;color:${TEXT_DIM};line-height:1.55;margin-bottom:8px;">${s.detail}</div>
      ${s.impact ? `<div style="font-size:12px;color:${BRAND_GREEN};font-weight:700;">→ ${s.impact}</div>` : ''}
    </div>`).join('');

  const inner = `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${TEXT_DIM};font-weight:700;margin:0 0 6px;">Quarterly review &middot; ${quarter || 'This quarter'}</p>
    <h1 style="font-size:26px;font-weight:800;color:${TEXT};letter-spacing:-0.02em;margin:0 0 12px;">90 days of progress${firstName ? ', ' + firstName : ''}.</h1>
    <p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 22px;">You moved <strong>${(debtFreeDeltaDays||0) >= 0 ? debtFreeDeltaDays : Math.abs(debtFreeDeltaDays)} days ${(debtFreeDeltaDays||0) >= 0 ? 'closer to' : 'farther from'}</strong> debt-free this quarter, paying ${fmtMoney(totalPaid)} total (${fmtMoney(interestPaid)} of which was interest).</p>

    <h2 style="font-size:18px;font-weight:800;color:${TEXT};letter-spacing:-0.01em;margin:24px 0 14px;">Your AI Coach's top suggestions for next quarter:</h2>
    ${sugList}

    <p style="font-size:13px;line-height:1.55;color:${TEXT_DIM};margin:18px 0 14px;">These are based on your current debts, APRs, payment history, and cash flow. Open the AI Coach in-app to ask follow-ups.</p>

    <a href="https://wjpdebttracking.com/index.html#advisor" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px;">Open AI Coach &rarr;</a>
  `;
  return {
    subject: `Q-end review: ${(debtFreeDeltaDays||0) >= 0 ? '+' : ''}${debtFreeDeltaDays||0} days, ${fmtMoney(totalPaid)} paid, ${(suggestions||[]).length} suggestions`,
    html: SHELL(inner, `${(debtFreeDeltaDays||0) >= 0 ? '+' : ''}${debtFreeDeltaDays||0} days closer to debt-free this quarter.`),
    text: `${firstName ? firstName + ',' : ''} 90-day review.\n\nMoved ${debtFreeDeltaDays||0} days ${(debtFreeDeltaDays||0)>=0?'closer to':'farther from'} debt-free.\nPaid: ${fmtMoney(totalPaid)} (${fmtMoney(interestPaid)} interest)\n\nTop suggestions:\n${(suggestions||[]).map((s,i)=>`${i+1}. ${s.title} — ${s.detail}${s.impact?' ('+s.impact+')':''}`).join('\n')}\n\nOpen WJP: https://wjpdebttracking.com/index.html#advisor`
  };
}

// ===========================================================================
// 4. ANNUAL YEAR-IN-REVIEW — Pro Plus only (shareable)
// Args: { firstName, year, totalPaid, interestPaid, interestSaved, debtsKilled, daysCloser, biggestMonth, longestStreak }
// ===========================================================================
function annualReportTemplate({ firstName, year, totalPaid, interestPaid, interestSaved, debtsKilled, daysCloser, biggestMonth, longestStreak }) {
  const inner = `
    <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${TEXT_DIM};font-weight:700;margin:0 0 6px;">${year || ''} Year in Review</p>
    <h1 style="font-size:32px;font-weight:800;color:${TEXT};letter-spacing:-0.03em;margin:0 0 18px;line-height:1.1;">${firstName ? firstName + ',' : ''} you paid <span style="color:${BRAND_GREEN}">${fmtMoney(totalPaid)}</span> toward freedom this year.</h1>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
      <tr>
        <td style="padding:18px 14px;background:${BG};border-radius:12px;width:48%;text-align:center;">
          <div style="font-size:11px;color:${TEXT_DIM};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Days closer</div>
          <div style="font-size:32px;font-weight:800;color:${BRAND_GREEN};">${(daysCloser||0) >= 0 ? '+' : ''}${daysCloser||0}</div>
          <div style="font-size:11px;color:${TEXT_DIM};">to debt-free</div>
        </td>
        <td style="width:4%;"></td>
        <td style="padding:18px 14px;background:${BG};border-radius:12px;width:48%;text-align:center;">
          <div style="font-size:11px;color:${TEXT_DIM};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Debts killed</div>
          <div style="font-size:32px;font-weight:800;color:${BRAND_GREEN};">${(debtsKilled || []).length}</div>
          <div style="font-size:11px;color:${TEXT_DIM};">${(debtsKilled || []).slice(0,3).join(', ') || '—'}</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
      <tr>
        <td style="padding:14px;background:${BG};border-radius:10px;width:48%;">
          <div style="font-size:11px;color:${TEXT_DIM};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;margin-bottom:4px;">Interest you paid</div>
          <div style="font-size:18px;font-weight:800;color:#c0594a;">${fmtMoney(interestPaid)}</div>
        </td>
        <td style="width:4%;"></td>
        <td style="padding:14px;background:${BG};border-radius:10px;width:48%;">
          <div style="font-size:11px;color:${TEXT_DIM};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;margin-bottom:4px;">Interest you avoided</div>
          <div style="font-size:18px;font-weight:800;color:${BRAND_GREEN};">${fmtMoney(interestSaved)}</div>
        </td>
      </tr>
    </table>

    ${biggestMonth ? `<p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 12px;"><strong>Biggest month:</strong> ${biggestMonth}.</p>` : ''}
    ${longestStreak ? `<p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 18px;"><strong>Longest streak of on-time payments:</strong> ${longestStreak} weeks.</p>` : ''}

    <div style="background:linear-gradient(135deg,rgba(31,122,74,0.10),rgba(201,154,42,0.05));border-radius:14px;padding:22px;text-align:center;margin:24px 0;">
      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND_GREEN};font-weight:800;margin-bottom:8px;">Worth sharing?</div>
      <div style="font-size:15px;line-height:1.55;color:${TEXT};margin-bottom:12px;">If WJP helped you this year, the people you know struggling with debt deserve to know about it too.</div>
      <a href="https://wjpdebttracking.com/index.html#settings" style="display:inline-block;background:${BRAND_GREEN};color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:700;font-size:13px;">Refer a friend &rarr;</a>
    </div>

    <p style="font-size:14px;line-height:1.55;color:${TEXT_DIM};margin:14px 0;">Here's to next year, and the year after that — until the last balance hits zero.</p>
    <p style="font-size:14px;line-height:1.55;color:${TEXT};margin:0 0 14px;">— Winston, WJP</p>
  `;
  return {
    subject: `Your ${year || ''} debt year in review — ${(daysCloser||0) >= 0 ? '+' : ''}${daysCloser||0} days closer, ${(debtsKilled||[]).length} debts killed`,
    html: SHELL(inner, `${fmtMoney(totalPaid)} paid this year. ${(daysCloser||0) >= 0 ? '+' : ''}${daysCloser||0} days closer to debt-free.`),
    text: `${firstName ? firstName + ',' : ''} you paid ${fmtMoney(totalPaid)} toward freedom in ${year}.\n\n+${daysCloser||0} days closer to debt-free.\nDebts killed: ${(debtsKilled||[]).join(', ') || '—'}\nInterest paid: ${fmtMoney(interestPaid)}\nInterest avoided: ${fmtMoney(interestSaved)}\n${biggestMonth ? 'Biggest month: ' + biggestMonth + '\n' : ''}${longestStreak ? 'Longest streak: ' + longestStreak + ' weeks\n' : ''}\nHere's to next year — until the last balance hits zero.\n\n— Winston`
  };
}

module.exports = {
  weeklyProgressTemplate,
  monthlyReportTemplate,
  quarterlyReportTemplate,
  annualReportTemplate
};
