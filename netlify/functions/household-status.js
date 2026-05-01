// GET /.netlify/functions/household-status
// Headers: Authorization: Bearer <Firebase ID token>
// Returns the caller's household state:
//   { inHousehold, role, householdId, household, pendingInvites:[], dataRequests:[] }
const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const uid = decoded.uid;
    const email = (decoded.email || '').toLowerCase();
    const db = getFirestore();

    // Find household(s) the user is in. We store a reverse index for speed:
    // user_household/{uid} → { householdId }. If absent, user is in no household.
    let householdId = null;
    try {
      const idx = await db.collection('user_household').doc(uid).get();
      if (idx.exists) householdId = idx.data().householdId;
    } catch(_) {}

    let household = null;
    let role = null;
    if (householdId) {
      const hSnap = await db.collection('households').doc(householdId).get();
      if (hSnap.exists) {
        household = hSnap.data();
        // Strip raw uids from members for privacy — only return what UI needs
        household.id = householdId;
        const me = (household.members || []).find(m => m.uid === uid);
        role = me ? me.role : null;
      } else {
        // Stale index — clear it
        try { await db.collection('user_household').doc(uid).delete(); } catch(_){}
        householdId = null;
      }
    }

    // Pending invites for this user (matched by email)
    const invitesSnap = await db.collection('household_invites')
      .where('inviteeEmail', '==', email)
      .where('status', '==', 'pending')
      .limit(20).get();
    const pendingInvites = invitesSnap.docs.map(d => {
      const v = d.data() || {};
      return {
        token: d.id,
        householdId: v.householdId,
        householdName: v.householdName || null,
        inviterEmail: v.inviterEmail,
        role: v.role,
        createdAt: v.createdAt,
        expiresAt: v.expiresAt
      };
    });

    // Data-access requests targeting this user
    const reqSnap = await db.collection('household_data_requests')
      .where('targetUid', '==', uid)
      .where('status', '==', 'pending')
      .limit(20).get();
    const dataRequests = reqSnap.docs.map(d => {
      const v = d.data() || {};
      return {
        id: d.id,
        householdId: v.householdId,
        ownerUid: v.ownerUid,
        ownerEmail: v.ownerEmail,
        createdAt: v.createdAt
      };
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        inHousehold: !!householdId,
        householdId,
        role,
        household,
        pendingInvites,
        dataRequests,
        uid,
        email
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('household-status error:', msg);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
