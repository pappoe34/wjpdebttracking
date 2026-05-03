// Scheduled function: runs daily, decides which welcome-sequence email to send to each user.
//
// Schedule: configured in netlify.toml [functions."email-cron".schedule] = "0 13 * * *" (9 AM ET).
// Auth model: caller is Netlify scheduler — no caller auth, but only Netlify can hit scheduled functions.
//
// Logic per user:
//   - Day 0 (account < 24h old)   AND welcome not sent  -> welcome
//   - Day 3 (account 2-4 days)    AND debts.length === 0 AND nudge not sent -> nudge
//   - Day 7 (account 6-8 days)    AND mid_trial not sent -> mid_trial
//
// State stored at users/{uid}/email_sequence/{template} = { sentAt, resendId }

const { getFirebaseAdmin, getFirestore } = require('./_shared/firebase');
const { sendEmail } = require('./_shared/resend');
const { welcomeTemplate, nudgeTemplate, midTrialTemplate } = require('./_shared/email-templates');

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

async function alreadySent(db, uid, template) {
  try {
    const snap = await db.collection('users').doc(uid).collection('email_sequence').doc(template).get();
    return snap.exists && !!snap.data().sentAt;
  } catch (_) { return false; }
}

async function markSent(db, uid, template, resendId) {
  try {
    await db.collection('users').doc(uid).collection('email_sequence').doc(template).set({
      sentAt: Date.now(),
      resendId
    }, { merge: true });
  } catch (_) {}
}

async function debtCountFor(db, uid) {
  try {
    const stateSnap = await db.collection('users').doc(uid).collection('state').doc('app').get();
    if (!stateSnap.exists) return 0;
    const d = stateSnap.data();
    if (Array.isArray(d.debts)) return d.debts.length;
  } catch (_) {}
  return 0;
}

async function isUnsubscribed(db, uid) {
  try {
    const snap = await db.collection('users').doc(uid).collection('prefs').doc('email').get();
    return snap.exists && snap.data().unsubscribedFromProduct === true;
  } catch (_) { return false; }
}

async function processUser(db, user) {
  const uid = user.uid;
  if (!user.email) return { uid, skipped: 'no email' };
  if (await isUnsubscribed(db, uid)) return { uid, skipped: 'unsubscribed' };

  const days = ageDays(user.metadata && user.metadata.creationTime);
  const firstName = firstNameOf(user.displayName, user.email);

  // Day 0 — account < 24h, send welcome
  if (days < 1.0 && !(await alreadySent(db, uid, 'welcome'))) {
    const t = welcomeTemplate({ firstName });
    const result = await sendEmail({
      to: user.email,
      subject: t.subject,
      html: t.html,
      text: t.text,
      tags: [{ name: 'sequence', value: 'welcome' }]
    });
    await markSent(db, uid, 'welcome', result.id);
    return { uid, sent: 'welcome', resendId: result.id };
  }

  // Day 3 nudge (only if user hasn't added a debt)
  if (days >= 2.5 && days <= 4.5 && !(await alreadySent(db, uid, 'nudge'))) {
    const debts = await debtCountFor(db, uid);
    if (debts === 0) {
      const t = nudgeTemplate({ firstName });
      const result = await sendEmail({
        to: user.email,
        subject: t.subject,
        html: t.html,
        text: t.text,
        tags: [{ name: 'sequence', value: 'nudge' }]
      });
      await markSent(db, uid, 'nudge', result.id);
      return { uid, sent: 'nudge', resendId: result.id };
    } else {
      // Mark as skipped so we don't keep checking
      await markSent(db, uid, 'nudge', 'skipped:user-already-active');
      return { uid, skipped: 'has debts already' };
    }
  }

  // Day 7 mid-trial check-in
  if (days >= 6.5 && days <= 8.5 && !(await alreadySent(db, uid, 'mid_trial'))) {
    const debts = await debtCountFor(db, uid);
    const t = midTrialTemplate({ firstName, debtCount: debts, debtFreeYears: null });
    const result = await sendEmail({
      to: user.email,
      subject: t.subject,
      html: t.html,
      text: t.text,
      tags: [{ name: 'sequence', value: 'mid_trial' }]
    });
    await markSent(db, uid, 'mid_trial', result.id);
    return { uid, sent: 'mid_trial', resendId: result.id };
  }

  return { uid, skipped: 'no template applies' };
}

exports.handler = async (event) => {
  // Allow manual invocation via GET for testing — but require ?dry=1 if not Netlify scheduler
  const isScheduled = !!event.headers['x-netlify-scheduled'] || !!(event.body && event.body.indexOf('"scheduled"') >= 0);
  const forceSend = !!(event.queryStringParameters && event.queryStringParameters.send === '1');
  const isDryRun = (event.queryStringParameters && event.queryStringParameters.dry === '1')
                   || (!isScheduled && !forceSend);

  try {
    const admin = getFirebaseAdmin();
    const db = getFirestore();

    // List all auth users (cap at 1000 for v1)
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
      // Filter to users created within the last 14 days only — saves Firestore reads
      const days = ageDays(u.metadata && u.metadata.creationTime);
      if (days < 0 || days > 14) continue;
      try {
        if (isDryRun) {
          results.push({ uid: u.uid, email: u.email, days: days.toFixed(2), would: 'dry-run' });
        } else {
          const r = await processUser(db, u);
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
        results: results.slice(0, 50) // truncate response
      })
    };
  } catch (err) {
    console.error('[email-cron] error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
