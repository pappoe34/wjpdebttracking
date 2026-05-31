// POST /.netlify/functions/debt-write
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { op: 'add' | 'update' | 'delete', debt: {...}, recurringPayment?: {...} }
//
// Server-write path for high-value debt mutations. The client calls this
// instead of relying on the optimistic localStorage → background sync flow
// for debt add/edit/delete. Result: the write is acknowledged by Firestore
// BEFORE the client sees "Saved". No more silent dropped writes.
//
// Flow:
//   1. Verify Firebase ID token → get uid
//   2. Read users/{uid}/state/main (the user's state doc)
//   3. Apply the requested mutation on the appState shape
//   4. Optionally apply a paired recurringPayment mutation (e.g. when adding
//      a debt with a min payment we also create the recurring row)
//   5. Write the updated doc back with a bumped _cloudSyncTs
//   6. Return success/fail with the new state counts so client can verify

const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

function _genId(prefix) {
  return prefix + Date.now() + Math.floor(Math.random() * 10000);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let decoded;
  try {
    const h = event.headers || {};
    decoded = await verifyIdToken(h.authorization || h.Authorization);
  } catch (err) {
    return json(401, { error: 'Unauthorized: ' + (err && err.message ? err.message : 'token verification failed') });
  }

  const uid = decoded && decoded.uid;
  if (!uid) return json(401, { error: 'Token missing uid' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const op = String(body.op || '').toLowerCase();
  const incoming = body.debt || null;
  const incomingRec = body.recurringPayment || null;

  if (!['add', 'update', 'delete'].includes(op)) {
    return json(400, { error: 'Invalid op (add|update|delete)' });
  }
  if (op !== 'delete' && (!incoming || typeof incoming !== 'object')) {
    return json(400, { error: 'Missing debt object' });
  }
  if (op === 'delete' && !incoming?.id) {
    return json(400, { error: 'Delete requires debt.id' });
  }

  const db = getFirestore();
  const mainRef = db.collection('users').doc(uid).collection('state').doc('main');

  try {
    const snap = await mainRef.get();
    const state = snap.exists ? (snap.data() || {}) : {};
    state.debts = Array.isArray(state.debts) ? state.debts : [];
    state.recurringPayments = Array.isArray(state.recurringPayments) ? state.recurringPayments : [];

    let resultDebt = null;

    if (op === 'add') {
      const newDebt = {
        ...incoming,
        id: incoming.id || _genId('d'),
        createdAt: incoming.createdAt || Date.now(),
        originalBalance: incoming.originalBalance != null
          ? incoming.originalBalance
          : Number(incoming.balance) || 0,
        lastUpdated: Date.now()
      };
      state.debts.push(newDebt);
      resultDebt = newDebt;

      // Paired recurring payment (for the "always create" pattern from FIX 102)
      if (incomingRec) {
        const newRec = {
          ...incomingRec,
          id: incomingRec.id || _genId('r'),
          linkedDebtId: newDebt.id,
          createdAt: incomingRec.createdAt || Date.now()
        };
        state.recurringPayments.push(newRec);
      }
    } else if (op === 'update') {
      const idx = state.debts.findIndex((d) => d && d.id === incoming.id);
      if (idx < 0) return json(404, { error: 'Debt not found: ' + incoming.id });
      const merged = { ...state.debts[idx], ...incoming, lastUpdated: Date.now(), userEdited: true };
      // Recompute utilization if both balance + creditLimit present
      const bal = Number(merged.balance);
      const lim = Number(merged.creditLimit || merged.limit);
      if (bal >= 0 && lim > 0) {
        merged.utilization = +((bal / lim) * 100).toFixed(2);
      }
      state.debts[idx] = merged;
      resultDebt = merged;

      // Update paired recurring payment minPayment if changed
      if (incoming.minPayment != null) {
        const rp = state.recurringPayments.find((r) => r && r.linkedDebtId === incoming.id);
        if (rp) rp.amount = Number(incoming.minPayment);
      }
    } else if (op === 'delete') {
      const before = state.debts.length;
      state.debts = state.debts.filter((d) => d && d.id !== incoming.id);
      if (state.debts.length === before) return json(404, { error: 'Debt not found: ' + incoming.id });
      // Also drop paired recurring payments
      state.recurringPayments = state.recurringPayments.filter((r) => !r || r.linkedDebtId !== incoming.id);
      resultDebt = { id: incoming.id, deleted: true };
    }

    state._cloudSyncTs = Date.now();
    state._cloudSyncFrom = 'debt-write:' + op;

    await mainRef.set(state, { merge: false });

    return json(200, {
      ok: true,
      op,
      uid,
      debt: resultDebt,
      counts: {
        debts: state.debts.length,
        recurringPayments: state.recurringPayments.length
      },
      syncTs: state._cloudSyncTs
    });
  } catch (err) {
    console.error('[debt-write]', err);
    return json(500, { error: 'Write failed: ' + (err && err.message ? err.message : 'unknown') });
  }
};
