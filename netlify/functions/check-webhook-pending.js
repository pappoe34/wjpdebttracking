// POST /.netlify/functions/check-webhook-pending
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    {} OR { clear: true, itemIds: [...] }
// Returns: { pending: { transactions: [itemId,...], recurring: [itemId,...] }, errors: [{itemId, code, message}] }
//
// Companion to plaid-webhook.js. The webhook sets txPendingSync /
// recurringPendingSync flags on plaid_items docs; the frontend polls this
// endpoint every ~30s, runs the appropriate sync if anything is flagged, then
// calls back with `clear: true, itemIds: [...]` to reset the flags.
//
// Why a poll instead of a Firestore listener: keeps Firestore SDK out of the
// client bundle, and our sync cadence (30s) is fast enough for autopay UX.

const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try {
      decoded = await verifyIdToken(authHeader);
    } catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const uid = decoded.uid;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch(_) {}

    const db = getFirestore();
    const admin = getFirebaseAdmin();
    const itemsRef = db.collection('users').doc(uid).collection('plaid_items');

    // Clear path: frontend just finished its sync and wants the flags reset.
    if (body.clear && Array.isArray(body.itemIds) && body.itemIds.length) {
      const which = String(body.which || 'transactions'); // 'transactions' | 'recurring' | 'both'
      const updates = {};
      if (which === 'transactions' || which === 'both') {
        updates.txPendingSync = admin.firestore.FieldValue.delete();
        updates.txPendingSyncAt = admin.firestore.FieldValue.delete();
      }
      if (which === 'recurring' || which === 'both') {
        updates.recurringPendingSync = admin.firestore.FieldValue.delete();
        updates.recurringPendingSyncAt = admin.firestore.FieldValue.delete();
      }
      await Promise.all(body.itemIds.map(id => itemsRef.doc(id).set(updates, { merge: true })));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, cleared: body.itemIds.length }) };
    }

    // Read path: snapshot all items, surface any pending flags + item errors.
    const snap = await itemsRef.get();
    const txPending = [];
    const recPending = [];
    const errors = [];
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      if (d.txPendingSync) txPending.push(doc.id);
      if (d.recurringPendingSync) recPending.push(doc.id);
      if (d.itemError) errors.push({ itemId: doc.id, code: d.itemError, message: d.itemErrorMessage || null });
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        pending: { transactions: txPending, recurring: recPending },
        errors,
        // Hint for the client. Don't poll faster than this.
        nextPollSeconds: 30
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('check-webhook-pending error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
