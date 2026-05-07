// W4 — Email cron for W3 retention templates.
// Runs weekly. Dispatches:
//   - Weekly progress email (every 7 days from signup, paid tiers only)
//   - Monthly report (1st of month, all tiers, but Pro Plus gets richer detail)
//   - Quarterly review (1st of quarter, Pro Plus only) — shipped, gated by month
//   - Annual year-in-review (Jan 1, Pro Plus only)
//
// Schedule (netlify.toml): "0 14 * * 1"  → Monday 10 AM ET
//
// State stored at users/{uid}/email_sequence/{template}_{period} = { sentAt, resendId }
//   period format:
//     weekly:   "YYYY-Www"  (ISO week)
//     monthly:  "YYYY-MM"
//     quarterly:"YYYY-Q1..4"
//     annual:   "YYYY"

const { getFirebaseAdmin, getFirestore } = require('./_shared/firebase');
const { sendEmail } = require('./_shared/resend');
const {
  weeklyProgressTemplate,
  monthlyReportTemplate,
  quarterlyReportTemplate,
  annualReportTemplate
} = require('./_shared/email-templates-w3');

const DAY = 24 * 60 * 60 * 1000;

function ageDays(creationTime) {
  if (!creationTime) return 0;
  return (Date.now() - new Date(creationTime).getTime()) / DAY;
}
function firstNameOf(displayName, email) {
  if (displayName) return displayName.split(/\s+/)[0];
  if (email) return email.split('@')[0].replace(/[._\-+]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return '';
}
function isoWeek(d) {
  d = new Date(d || Date.now());
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const year = d.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil((((d - start) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2,'0')}`;
}
function monthKey(d) {
  d = new Date(d || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function quarterKey(d) {
  d = new Date(d || Date.now());
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}`;
}
function yearKey(d) {
  d = new Date(d || Date.now());
  return String(d.getFullYear());
}

async function alreadySent(db, uid, key) {
  try {
    const snap = await db.collection('users').doc(uid).collection('email_sequence').doc(key).get();
    return snap.exists && !!snap.data().sentAt;
  } catch(_) { return false; }
}
async function markSent(db, uid, key, resendId) {
  try {
    await db.collection('users').doc(uid).collection('email_sequence').doc(key).set({
      sentAt: Date.now(), resendId
    }, { merge: true });
  } catch(_) {}
}
async function isUnsubscribed(db, uid) {
  try {
    const snap = await db.collection('users').doc(uid).collection('prefs').doc('email').get();
    return snap.exists && snap.data().unsubscribedFromProduct === true;
  } catch(_) { return false; }
}
async function userTier(db, uid) {
  try {
    const snap = await db.collection('users').doc(uid).collection('billing').doc('subscription').get();
    if (!snap.exists) return 'free';
    const d = snap.data();
    let t = String(d.tier || 'free').toLowerCase();
    if (t === 'pro-plus') t = 'plus';
    if (['plus','pro','admin','free'].indexOf(t) === -1) t = 'free';
    return t;
  } catch(_) { return 'free'; }
}
async function userStats(db, uid) {
  // Read user's app state to compute: total debt, debts list, debt-free date
  try {
    const snap = await db.collection('users').doc(uid).collection('state').doc('app').get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const debts = Array.isArray(d.debts) ? d.debts : [];
    const totalDebt = debts.reduce((s, x) => s + (Number(x.balance) || 0), 0);
    const debtCount = debts.length;
    return {
      debts,
      totalDebt,
      debtCount,
      debtFreeDate: d.debtFreeDate || d.projectedFreedom || null,
      stats: d.stats || {}
    };
  } catch(_) { return null; }
}

async function processUser(db, user, opts) {
  const uid = user.uid;
  if (!user.email) return { uid, skipped: 'no email' };
  if (await isUnsubscribed(db, uid)) return { uid, skipped: 'unsubscribed' };

  const days = ageDays(user.metadata && user.metadata.creationTime);
  if (days < 14) return { uid, skipped: 'still in welcome window' };

  const firstName = firstNameOf(user.displayName, user.email);
  const tier = await userTier(db, uid);
  const stats = await userStats(db, uid);

  const now = new Date();
  const today = now.getDate();
  const month = now.getMonth();
  const isFirstOfMonth = today === 1;
  const isQuarterStart = isFirstOfMonth && (month % 3 === 0);
  const isYearStart = today === 1 && month === 0;

  // === ANNUAL (Jan 1, Pro Plus or admin) ===
  if (isYearStart && (tier === 'plus' || tier === 'admin')) {
    const key = `annual_${yearKey(now)}`;
    if (!(await alreadySent(db, uid, key))) {
      const t = annualReportTemplate({
        firstName,
        year: yearKey(now),
        totalPaid: (stats && stats.stats && stats.stats.yearTotalPaid) || 0,
        interestPaid: (stats && stats.stats && stats.stats.yearInterestPaid) || 0,
        interestSaved: (stats && stats.stats && stats.stats.yearInterestSaved) || 0,
        debtsKilled: (stats && stats.stats && stats.stats.yearDebtsKilled) || [],
        daysCloser: (stats && stats.stats && stats.stats.yearDaysCloser) || 0,
        biggestMonth: (stats && stats.stats && stats.stats.yearBiggestMonth) || null,
        longestStreak: (stats && stats.stats && stats.stats.yearLongestStreak) || null
      });
      const r = await sendEmail({
        to: user.email, subject: t.subject, html: t.html, text: t.text,
        tags: [{ name: 'sequence', value: 'annual' }]
      });
      await markSent(db, uid, key, r.id);
      return { uid, sent: 'annual' };
    }
  }

  // === QUARTERLY (1st of Apr/Jul/Oct/Jan, Pro Plus or admin) ===
  if (isQuarterStart && (tier === 'plus' || tier === 'admin')) {
    const key = `quarterly_${quarterKey(now)}`;
    if (!(await alreadySent(db, uid, key))) {
      const suggestions = (stats && stats.stats && stats.stats.quarterSuggestions) || [
        { title: 'Look at your highest-APR card first', detail: 'The math always favors the highest interest rate. Pull next quarter\'s extra dollar there.', impact: 'Save $40-200 in interest' }
      ];
      const t = quarterlyReportTemplate({
        firstName,
        quarter: quarterKey(now),
        totalPaid: (stats && stats.stats && stats.stats.quarterTotalPaid) || 0,
        interestPaid: (stats && stats.stats && stats.stats.quarterInterestPaid) || 0,
        debtFreeDeltaDays: (stats && stats.stats && stats.stats.quarterDeltaDays) || 0,
        suggestions
      });
      const r = await sendEmail({
        to: user.email, subject: t.subject, html: t.html, text: t.text,
        tags: [{ name: 'sequence', value: 'quarterly' }]
      });
      await markSent(db, uid, key, r.id);
      return { uid, sent: 'quarterly' };
    }
  }

  // === MONTHLY (1st of month, all paid + free) ===
  if (isFirstOfMonth) {
    const key = `monthly_${monthKey(now)}`;
    // Free tier gets monthly too — keeps engagement
    if (tier === 'free' || tier === 'pro' || tier === 'plus' || tier === 'admin') {
      if (!(await alreadySent(db, uid, key))) {
        const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const t = monthlyReportTemplate({
          firstName,
          month: monthName,
          totalPaid: (stats && stats.stats && stats.stats.monthTotalPaid) || 0,
          interestPaid: (stats && stats.stats && stats.stats.monthInterestPaid) || 0,
          principalPaid: (stats && stats.stats && stats.stats.monthPrincipalPaid) || 0,
          debtsClosed: (stats && stats.stats && stats.stats.monthDebtsClosed) || [],
          debtFreeDate: stats && stats.debtFreeDate,
          biggestWin: (stats && stats.stats && stats.stats.monthBiggestWin) || null
        });
        const r = await sendEmail({
          to: user.email, subject: t.subject, html: t.html, text: t.text,
          tags: [{ name: 'sequence', value: 'monthly' }]
        });
        await markSent(db, uid, key, r.id);
        return { uid, sent: 'monthly' };
      }
    }
  }

  // === WEEKLY (every Monday, Pro/Pro Plus/admin only) ===
  // Skip free tier — they get monthly only. Limits inbox fatigue.
  if (now.getDay() === 1 && (tier === 'pro' || tier === 'plus' || tier === 'admin')) {
    const key = `weekly_${isoWeek(now)}`;
    if (!(await alreadySent(db, uid, key))) {
      const t = weeklyProgressTemplate({
        firstName,
        weekDelta: (stats && stats.stats && stats.stats.weekDelta) || 0,
        debtFreeDate: stats && stats.debtFreeDate,
        totalPaid: (stats && stats.stats && stats.stats.weekTotalPaid) || 0,
        daysCloser: (stats && stats.stats && stats.stats.weekDaysCloser) || 0,
        isAhead: (stats && stats.stats && stats.stats.weekIsAhead) || false
      });
      const r = await sendEmail({
        to: user.email, subject: t.subject, html: t.html, text: t.text,
        tags: [{ name: 'sequence', value: 'weekly' }]
      });
      await markSent(db, uid, key, r.id);
      return { uid, sent: 'weekly' };
    }
  }

  return { uid, skipped: 'no cadence email applies', tier, days: days.toFixed(1) };
}

exports.handler = async (event) => {
  const isScheduled = !!event.headers['x-netlify-scheduled'] || !!(event.body && event.body.indexOf('"scheduled"') >= 0);
  const forceSend = !!(event.queryStringParameters && event.queryStringParameters.send === '1');
  const isDryRun = (event.queryStringParameters && event.queryStringParameters.dry === '1')
                   || (!isScheduled && !forceSend);

  try {
    const admin = getFirebaseAdmin();
    const db = getFirestore();

    const allUsers = [];
    let nextPageToken;
    do {
      const res = await admin.auth().listUsers(1000, nextPageToken);
      allUsers.push(...res.users);
      nextPageToken = res.pageToken;
      if (allUsers.length >= 5000) break;
    } while (nextPageToken);

    const results = [];
    for (const u of allUsers) {
      const days = ageDays(u.metadata && u.metadata.creationTime);
      if (days < 14) continue; // welcome cron handles first 14 days
      try {
        if (isDryRun) {
          results.push({ uid: u.uid, email: u.email, days: days.toFixed(2), would: 'dry-run' });
        } else {
          const r = await processUser(db, u, {});
          results.push(r);
        }
      } catch (e) {
        results.push({ uid: u.uid, error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        scanned: allUsers.length,
        processed: results.length,
        dryRun: isDryRun,
        results: results.slice(0, 50)
      })
    };
  } catch (err) {
    console.error('[email-cron-w3] error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
