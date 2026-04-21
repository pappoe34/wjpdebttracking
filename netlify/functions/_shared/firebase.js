// Firebase Admin singleton + ID-token verification helper.
// Requires env var: FIREBASE_SERVICE_ACCOUNT_JSON (the full service account JSON
// serialized as a single string).
const admin = require('firebase-admin');

let _initialized = false;

function getFirebaseAdmin() {
  if (_initialized) return admin;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('missing env var: FIREBASE_SERVICE_ACCOUNT_JSON');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(parsed)
    });
  }
  _initialized = true;
  return admin;
}

async function verifyIdToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    throw new Error('missing Authorization header');
  }
  const prefix = 'Bearer ';
  const token = authHeader.startsWith(prefix)
    ? authHeader.slice(prefix.length).trim()
    : authHeader.trim();
  if (!token) {
    throw new Error('missing bearer token');
  }
  const a = getFirebaseAdmin();
  const decoded = await a.auth().verifyIdToken(token);
  return decoded; // { uid, email, ... }
}

function getFirestore() {
  const a = getFirebaseAdmin();
  return a.firestore();
}

module.exports = {
  getFirebaseAdmin,
  verifyIdToken,
  getFirestore
};
