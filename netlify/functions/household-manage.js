// POST /.netlify/functions/household-manage
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { action, ...params }
// Actions:
//   create               { name }                  → creates household, caller = owner
//   invite               { email, role }           → owner sends invite (creates token)
//   accept-invite        { token }                 → invitee accepts → joins household
//   decline-invite       { token }                 → invitee declines
//   leave                { }                       → member leaves household
//   remove-member        { memberUid }             → owner removes a member
//   request-data-access  { memberUid }             → owner asks member to share aggregated data
//   approve-data-access  { requestId }             → member approves
//   deny-data-access     { requestId }             → member denies
//   disband              { }                       → owner deletes household
const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function rand(n) {
  return [...Array(n)].map(() => Math.random().toString(36).slice(2, 4)).join('').slice(0, n);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const callerUid = decoded.uid;
    const callerEmail = (decoded.email || '').toLowerCase();
    const db = getFirestore();

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid JSON' }) }; }
    const action = String(body.action || '').toLowerCase();

    // === Helper: load caller's current household ===
    async function loadHousehold() {
      const idx = await db.collection('user_household').doc(callerUid).get();
      if (!idx.exists) return null;
      const householdId = idx.data().householdId;
      const hSnap = await db.collection('households').doc(householdId).get();
      if (!hSnap.exists) return null;
      return { id: householdId, ...hSnap.data(), ref: hSnap.ref };
    }

    if (action === 'create') {
      // Already in a household?
      const existing = await loadHousehold();
      if (existing) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'already in a household' }) };
      }
      const name = String(body.name || 'My Household').trim().slice(0, 60);
      const newDoc = {
        ownerUid: callerUid,
        ownerEmail: callerEmail,
        name,
        createdAt: Date.now(),
        members: [{
          uid: callerUid,
          email: callerEmail,
          role: 'owner',
          status: 'active',
          joinedAt: Date.now(),
          dataAccessGranted: true // owner's own data is always available
        }],
        settings: { sharedBillsVisible: true, hideBalancesByDefault: false }
      };
      const ref = await db.collection('households').add(newDoc);
      await db.collection('user_household').doc(callerUid).set({ householdId: ref.id });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, householdId: ref.id, household: { id: ref.id, ...newDoc } }) };
    }

    if (action === 'invite') {
      const inviteeEmail = String(body.email || '').trim().toLowerCase();
      const role = ['member','viewer'].indexOf(body.role) !== -1 ? body.role : 'member';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid email' }) };
      }
      if (inviteeEmail === callerEmail) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "can't invite yourself" }) };
      }
      let household = await loadHousehold();
      if (!household) {
        // Auto-create household on first invite
        const newDoc = {
          ownerUid: callerUid,
          ownerEmail: callerEmail,
          name: 'My Household',
          createdAt: Date.now(),
          members: [{
            uid: callerUid, email: callerEmail, role: 'owner', status: 'active',
            joinedAt: Date.now(), dataAccessGranted: true
          }],
          settings: { sharedBillsVisible: true, hideBalancesByDefault: false }
        };
        const ref = await db.collection('households').add(newDoc);
        await db.collection('user_household').doc(callerUid).set({ householdId: ref.id });
        household = { id: ref.id, ...newDoc, ref };
      }
      // Authorize: only owner can invite
      const me = (household.members || []).find(m => m.uid === callerUid);
      if (!me || me.role !== 'owner') {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'only owner can invite' }) };
      }
      // Already a member?
      if ((household.members || []).some(m => m.email === inviteeEmail && m.status === 'active')) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'already a member' }) };
      }
      // Cap at 6 (1 owner + 5 members)
      if ((household.members || []).filter(m => m.status === 'active').length >= 6) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'household full (max 6)' }) };
      }
      // Create invite token
      const token = `${Date.now().toString(36)}_${rand(16)}`;
      const inviteDoc = {
        householdId: household.id,
        householdName: household.name,
        inviterUid: callerUid,
        inviterEmail: callerEmail,
        inviteeEmail,
        role,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS
      };
      await db.collection('household_invites').doc(token).set(inviteDoc);
      const acceptUrl = `https://wjpdebttracking.com/accept-invite.html?token=${token}`;
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ ok: true, token, acceptUrl, invite: inviteDoc })
      };
    }

    if (action === 'accept-invite') {
      const token = String(body.token || '');
      if (!token) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'token required' }) };
      const inviteRef = db.collection('household_invites').doc(token);
      const inviteSnap = await inviteRef.get();
      if (!inviteSnap.exists) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'invite not found' }) };
      const invite = inviteSnap.data();
      if (invite.status !== 'pending') return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invite already ' + invite.status }) };
      if (Date.now() > invite.expiresAt) {
        await inviteRef.update({ status: 'expired' });
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invite expired' }) };
      }
      if (invite.inviteeEmail !== callerEmail) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'invite not for this email' }) };
      }
      // Accept: add to household, mark invite accepted
      const hRef = db.collection('households').doc(invite.householdId);
      const hSnap = await hRef.get();
      if (!hSnap.exists) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'household no longer exists' }) };
      const h = hSnap.data();
      // Already a member?
      const existing = (h.members || []).find(m => m.uid === callerUid);
      if (existing) {
        if (existing.status === 'active') {
          await inviteRef.update({ status: 'accepted', acceptedAt: Date.now() });
          return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, message: 'already a member' }) };
        }
        existing.status = 'active';
        existing.joinedAt = Date.now();
      } else {
        h.members = [...(h.members || []), {
          uid: callerUid, email: callerEmail, role: invite.role, status: 'active',
          joinedAt: Date.now(), dataAccessGranted: false
        }];
      }
      await hRef.set(h);
      await db.collection('user_household').doc(callerUid).set({ householdId: invite.householdId });
      await inviteRef.update({ status: 'accepted', acceptedAt: Date.now() });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, householdId: invite.householdId }) };
    }

    if (action === 'decline-invite') {
      const token = String(body.token || '');
      if (!token) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'token required' }) };
      const inviteRef = db.collection('household_invites').doc(token);
      const inviteSnap = await inviteRef.get();
      if (!inviteSnap.exists) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'invite not found' }) };
      const invite = inviteSnap.data();
      if (invite.inviteeEmail !== callerEmail) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'not your invite' }) };
      }
      await inviteRef.update({ status: 'declined', declinedAt: Date.now() });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'leave') {
      const household = await loadHousehold();
      if (!household) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'not in a household' }) };
      if (household.ownerUid === callerUid) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'owner cannot leave; use disband or transfer ownership' }) };
      }
      const newMembers = (household.members || []).filter(m => m.uid !== callerUid);
      await household.ref.update({ members: newMembers });
      await db.collection('user_household').doc(callerUid).delete();
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'remove-member') {
      const targetUid = String(body.memberUid || '');
      const household = await loadHousehold();
      if (!household) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'not in a household' }) };
      if (household.ownerUid !== callerUid) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'only owner can remove' }) };
      }
      if (targetUid === callerUid) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'use disband instead' }) };
      }
      const newMembers = (household.members || []).filter(m => m.uid !== targetUid);
      await household.ref.update({ members: newMembers });
      await db.collection('user_household').doc(targetUid).delete().catch(() => {});
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'request-data-access') {
      const targetUid = String(body.memberUid || '');
      const household = await loadHousehold();
      if (!household) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'not in a household' }) };
      if (household.ownerUid !== callerUid) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'only owner can request data access' }) };
      }
      const target = (household.members || []).find(m => m.uid === targetUid);
      if (!target) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'member not found' }) };
      if (target.dataAccessGranted) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, message: 'already granted' }) };
      }
      const reqRef = await db.collection('household_data_requests').add({
        householdId: household.id,
        ownerUid: callerUid,
        ownerEmail: callerEmail,
        targetUid,
        targetEmail: target.email,
        status: 'pending',
        createdAt: Date.now()
      });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, requestId: reqRef.id }) };
    }

    if (action === 'approve-data-access' || action === 'deny-data-access') {
      const reqId = String(body.requestId || '');
      const reqRef = db.collection('household_data_requests').doc(reqId);
      const reqSnap = await reqRef.get();
      if (!reqSnap.exists) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'request not found' }) };
      const r = reqSnap.data();
      if (r.targetUid !== callerUid) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'request not for you' }) };
      }
      if (action === 'deny-data-access') {
        await reqRef.update({ status: 'denied', resolvedAt: Date.now() });
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }
      // Approve — flip the dataAccessGranted flag on the household member entry
      const hRef = db.collection('households').doc(r.householdId);
      const hSnap = await hRef.get();
      if (!hSnap.exists) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'household not found' }) };
      const h = hSnap.data();
      const me = (h.members || []).find(m => m.uid === callerUid);
      if (me) me.dataAccessGranted = true;
      await hRef.update({ members: h.members });
      await reqRef.update({ status: 'approved', resolvedAt: Date.now() });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'disband') {
      const household = await loadHousehold();
      if (!household) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'not in a household' }) };
      if (household.ownerUid !== callerUid) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'only owner can disband' }) };
      }
      // Clear member indices
      for (const m of (household.members || [])) {
        try { await db.collection('user_household').doc(m.uid).delete(); } catch(_){}
      }
      await household.ref.delete();
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'unknown action: ' + action }) };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('household-manage error:', msg, err && err.stack);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
