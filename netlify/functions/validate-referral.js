// W5 — Referral validation + tracking backend.
//
// Endpoints (POST /.netlify/functions/validate-referral with action):
//   action=record    → Record a new referral (called from signup flow)
//   action=activate  → Mark a referral as paid-activated (called from stripe-webhook on subscription.created with non-null trial_end conversion)
//   action=clawback  → Mark a referral clawed back (cancel within 30 days)
//   action=stats     → Get referrer's stats (count, paid, pending, claimed)
//
// Firestore schema:
//   referrals/{referralId}
//     referrerUid: string
//     referredUid: string
//     code: string
//     status: 'pending' | 'paid' | 'clawback' | 'rewarded'
//     createdAt: number
//     activatedAt: number | null
//     reward: 'plus_year' | null
//
//   users/{uid}/referralReward: { earnedAt, redeemedUntil, count }
//
// Security: requires Firebase ID token in Authorization: Bearer header.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

const REWARD_THRESHOLD = 5;       // 5 paid referrals = 1 year free
const CLAWBACK_DAYS = 30;

async function recordReferral(db, referrerUid, referredUid, code) {
  // Anti-fraud: same UID can't refer themselves
  if (referrerUid === referredUid) {
    return { ok: false, reason: 'self-referral' };
  }
  // Check if this referred user is already attributed
  const existing = await db.collection('referrals')
    .where('referredUid', '==', referredUid).limit(1).get();
  if (!existing.empty) {
    return { ok: false, reason: 'already-attributed' };
  }
  const id = `${referrerUid}__${referredUid}`;
  await db.collection('referrals').doc(id).set({
    referrerUid, referredUid, code,
    status: 'pending',
    createdAt: Date.now(),
    activatedAt: null,
    reward: null
  }, { merge: true });
  return { ok: true, referralId: id };
}

async function activateReferral(db, referredUid) {
  // Find pending referral for this referred user
  const snap = await db.collection('referrals')
    .where('referredUid', '==', referredUid)
    .where('status', '==', 'pending').limit(1).get();
  if (snap.empty) return { ok: false, reason: 'not-found' };

  const doc = snap.docs[0];
  await doc.ref.update({ status: 'paid', activatedAt: Date.now() });

  // Check if referrer crossed the 5 threshold
  const referrerUid = doc.data().referrerUid;
  const paidCount = await db.collection('referrals')
    .where('referrerUid', '==', referrerUid)
    .where('status', '==', 'paid').get();
  const count = paidCount.size;

  if (count >= REWARD_THRESHOLD) {
    // Grant reward — flag the referrer
    await db.collection('users').doc(referrerUid).collection('referralReward').doc('current').set({
      earnedAt: Date.now(),
      redeemedUntil: Date.now() + 365 * 86400000,
      count
    }, { merge: true });
    // Mark the qualifying referrals as rewarded
    const all = await db.collection('referrals')
      .where('referrerUid', '==', referrerUid)
      .where('status', '==', 'paid').get();
    const batch = db.batch();
    all.docs.slice(0, REWARD_THRESHOLD).forEach(d => {
      batch.update(d.ref, { status: 'rewarded', reward: 'plus_year' });
    });
    await batch.commit();
    return { ok: true, rewardGranted: true, count };
  }
  return { ok: true, count };
}

async function clawbackReferral(db, referredUid) {
  const snap = await db.collection('referrals')
    .where('referredUid', '==', referredUid)
    .where('status', 'in', ['paid', 'rewarded']).limit(1).get();
  if (snap.empty) return { ok: false, reason: 'not-found' };
  const doc = snap.docs[0];
  const ageDays = (Date.now() - doc.data().activatedAt) / 86400000;
  if (ageDays > CLAWBACK_DAYS) return { ok: false, reason: 'past-clawback-window' };
  await doc.ref.update({ status: 'clawback', clawbackAt: Date.now() });
  return { ok: true };
}

async function statsFor(db, uid) {
  const all = await db.collection('referrals').where('referrerUid', '==', uid).get();
  const pending = all.docs.filter(d => d.data().status === 'pending').length;
  const paid = all.docs.filter(d => d.data().status === 'paid').length;
  const rewarded = all.docs.filter(d => d.data().status === 'rewarded').length;
  const clawback = all.docs.filter(d => d.data().status === 'clawback').length;

  // Reward record
  const rwd = await db.collection('users').doc(uid).collection('referralReward').doc('current').get();
  return {
    pending, paid, rewarded, clawback,
    paidCount: paid + rewarded,
    threshold: REWARD_THRESHOLD,
    needed: Math.max(0, REWARD_THRESHOLD - (paid + rewarded)),
    activeReward: rwd.exists ? rwd.data() : null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let user;
  try {
    user = await verifyIdToken(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return json(401, { error: 'unauthorized' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(_) { return json(400, { error: 'bad json' }); }

  const action = String(body.action || '').toLowerCase();
  const db = getFirestore();

  try {
    switch (action) {
      case 'record': {
        const { referrerUid, code } = body;
        if (!referrerUid || !code) return json(400, { error: 'missing referrerUid or code' });
        const result = await recordReferral(db, referrerUid, user.uid, code);
        return json(200, result);
      }
      case 'activate': {
        // Self-activate (called from Stripe webhook context — but here user-initiated)
        const result = await activateReferral(db, user.uid);
        return json(200, result);
      }
      case 'clawback': {
        // Same self-context
        const result = await clawbackReferral(db, user.uid);
        return json(200, result);
      }
      case 'stats': {
        const result = await statsFor(db, user.uid);
        return json(200, result);
      }
      default:
        return json(400, { error: 'unknown action' });
    }
  } catch (e) {
    return json(500, { error: e.message });
  }
};
