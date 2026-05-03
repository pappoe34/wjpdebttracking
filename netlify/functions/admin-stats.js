// GET /.netlify/functions/admin-stats
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: JSON with KPI counts + recent signups + subscription rows.
// Auth-gates via admins/list (seed: pappoe34@gmail.com).

const { verifyIdToken, getFirebaseAdmin, getFirestore } = require('./_shared/firebase');

const SEED_ADMIN_EMAIL = 'pappoe34@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

async function isAdminUser(decoded, db) {
  const email = (decoded.email || '').toLowerCase();
  if (email === SEED_ADMIN_EMAIL) return true;
  try {
    const snap = await db.collection('admins').doc('list').get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    return Array.isArray(data.uids) && data.uids.includes(decoded.uid);
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) { return json(401, { error: 'unauthorized: ' + e.message }); }

    const db = getFirestore();
    if (!(await isAdminUser(decoded, db))) {
      return json(403, { error: 'forbidden: admin only' });
    }

    const admin = getFirebaseAdmin();

    // ---- All Firebase Auth users (paginated, max 1000 per page) ----
    const allUsers = [];
    let nextPageToken;
    let pages = 0;
    do {
      const res = await admin.auth().listUsers(1000, nextPageToken);
      allUsers.push(...res.users);
      nextPageToken = res.pageToken;
      pages++;
      if (pages >= 10) break; // safety: cap at 10k users for MVP
    } while (nextPageToken);

    // ---- Pull every billing/subscription doc via collectionGroup ----
    // Schema: users/{uid}/billing/subscription
    const subSnap = await db.collectionGroup('billing').get();
    const subsByUid = {};
    subSnap.forEach(doc => {
      // path: users/{uid}/billing/{anything}; we only care about doc id 'subscription'
      if (doc.id !== 'subscription') return;
      const path = doc.ref.path; // users/<uid>/billing/subscription
      const parts = path.split('/');
      const uid = parts[1];
      if (!uid) return;
      subsByUid[uid] = doc.data() || {};
    });

    // ---- Time windows ----
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const day7  = now - 7 * DAY;
    const day30 = now - 30 * DAY;

    // ---- Aggregate KPIs ----
    const kpis = {
      totalUsers: allUsers.length,
      signups7d: 0,
      signups30d: 0,
      verifiedEmail: 0,
      withSubscription: Object.keys(subsByUid).length,
      trialing: 0,
      active: 0,
      canceled: 0,
      pastDue: 0,
      tierFree: 0,
      tierPro: 0,
      tierPlus: 0,
      tierAdmin: 0,
      cancelAtPeriodEnd: 0,
      mrrEstimate: 0  // computed below from active subs
    };

    // Tier price lookup for MRR estimate (matches stripe-client PRICE_CONFIG)
    const PRICE = {
      pro_monthly: 11.99, pro_yearly: 99 / 12,
      plus_monthly: 24.99, plus_yearly: 199 / 12
    };

    // Count signups per window
    allUsers.forEach(u => {
      const created = u.metadata && u.metadata.creationTime ? new Date(u.metadata.creationTime).getTime() : null;
      if (created && created >= day7)  kpis.signups7d++;
      if (created && created >= day30) kpis.signups30d++;
      if (u.emailVerified) kpis.verifiedEmail++;
    });

    Object.values(subsByUid).forEach(sub => {
      const status = (sub.status || '').toLowerCase();
      const tier = (sub.tier || 'free').toLowerCase();
      if (sub.isAdmin) { kpis.tierAdmin++; return; }
      if (status === 'trialing') kpis.trialing++;
      else if (status === 'active') kpis.active++;
      else if (status === 'canceled') kpis.canceled++;
      else if (status === 'past_due') kpis.pastDue++;
      if (sub.cancelAtPeriodEnd) kpis.cancelAtPeriodEnd++;

      if (tier === 'free' || !tier) kpis.tierFree++;
      else if (tier === 'pro') kpis.tierPro++;
      else if (tier === 'plus' || tier === 'pro-plus') kpis.tierPlus++;

      // MRR: only count active (paid) subs, not trialing
      if (status === 'active') {
        const lk = sub.currentPriceLookupKey;
        if (lk && PRICE[lk]) kpis.mrrEstimate += PRICE[lk];
      }
    });
    kpis.mrrEstimate = +kpis.mrrEstimate.toFixed(2);

    // Tier free = users with no sub doc (signed up, never opened Stripe Checkout)
    kpis.tierFree += (kpis.totalUsers - kpis.withSubscription);

    // ---- Daily signup buckets (last 30 days, oldest -> newest) ----
    const dailySignups = new Array(30).fill(0);
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    allUsers.forEach(u => {
      const created = u.metadata && u.metadata.creationTime ? new Date(u.metadata.creationTime).getTime() : null;
      if (!created) return;
      const daysAgo = Math.floor((todayStart.getTime() - created) / DAY);
      if (daysAgo >= 0 && daysAgo < 30) {
        dailySignups[29 - daysAgo]++;  // bucket 29 = today
      }
    });

    // ---- Recent signups (last 30 days, max 50) ----
    const recent = allUsers
      .map(u => ({
        uid: u.uid,
        email: u.email || '(no email)',
        displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Anonymous'),
        provider: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'password',
        created: u.metadata && u.metadata.creationTime ? new Date(u.metadata.creationTime).getTime() : 0,
        lastSignIn: u.metadata && u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).getTime() : 0,
        emailVerified: !!u.emailVerified,
        sub: subsByUid[u.uid] || null
      }))
      .filter(u => u.created >= day30)
      .sort((a, b) => b.created - a.created)
      .slice(0, 50);

    // ---- All subscriptions for the table (excluding admin override) ----
    const subs = allUsers
      .filter(u => subsByUid[u.uid])
      .map(u => {
        const s = subsByUid[u.uid];
        return {
          uid: u.uid,
          email: u.email || '(no email)',
          displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Anonymous'),
          tier: s.tier || 'free',
          status: s.status || '?',
          trialEnd: s.trialEnd || null,
          currentPeriodEnd: s.currentPeriodEnd || null,
          cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
          priceLookupKey: s.currentPriceLookupKey || null,
          isAdmin: !!s.isAdmin
        };
      })
      .sort((a, b) => {
        // Order: trialing first, then active, then past_due, then canceled
        const order = { trialing: 1, active: 2, past_due: 3, canceled: 4 };
        return (order[a.status] || 9) - (order[b.status] || 9);
      });

    return json(200, {
      generatedAt: now,
      kpis,
      recent,
      subs,
      dailySignups  // [n0, n1, ..., n29] oldest -> today
    });
  } catch (e) {
    console.error('[admin-stats] error:', e.message);
    return json(500, { error: e.message });
  }
};
