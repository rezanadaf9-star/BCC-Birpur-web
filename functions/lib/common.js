'use strict';
// Shared helpers. Nothing here trusts the client: role, class and session are read from the verified token
// and re-checked against Firestore where an action is sensitive.
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const REGION = 'asia-south1';                     // Mumbai: closest to Bihar
const AUTH_EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN || 'students.bcc-portal.invalid';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

/** Options for every callable function. App Check is switched on with ENFORCE_APP_CHECK=true once configured. */
// Scaling: 1 vCPU lets one instance serve many requests at the same time (concurrency), so a class-wide rush (everyone opens the app or submits a quiz
// within seconds) needs few instances instead of thousands. Tune with MAX_INSTANCES / MAX_INSTANCES_HOT / MIN_INSTANCES_HOT in functions/.env.
const callOpts = {
  region: REGION,
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
  cors: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
  maxInstances: Number(process.env.MAX_INSTANCES || 100),
  memory: '512MiB', cpu: 1, concurrency: 40, timeoutSeconds: 60,
};
/** The few functions every student hits at once (login, dashboard, quiz start/submit, results). Set MIN_INSTANCES_HOT=1 or 2 before exams to avoid cold starts. */
const hotOpts = { ...callOpts, maxInstances: Number(process.env.MAX_INSTANCES_HOT || 200), minInstances: Number(process.env.MIN_INSTANCES_HOT || 0), concurrency: 80 };

const ROLES = ['student', 'teacher', 'admin', 'parent'];
/** Active logins allowed at the same time, per platform (web and android counted separately). */
const SESSION_LIMITS = { student: 2, teacher: 2, admin: 2, parent: 2 };

const nowIso = () => new Date().toISOString();
/** Today in India (IST), as YYYY-MM-DD. */
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
/** Admin, or a teacher assigned to this class (read from the verified token). */
const classAccess = (me, c) => me.role === 'admin' || (me.role === 'teacher' && (me.token.classes || []).includes(c));
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
/** Per-instance flood guard for chat-like endpoints: at most `max` calls per `ms` per person. (A second line of defence next to App Check.) */
const hits = new Map();
function throttle(uid, bucket, max = 10, ms = 30000) {
  const k = bucket + ':' + uid, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < ms);
  if (a.length >= max) throw new HttpsError('resource-exhausted', 'You are sending too fast. Please wait a moment.');
  a.push(now); hits.set(k, a); if (hits.size > 5000) for (const [x, v] of hits) if (!v.length || now - v[v.length - 1] > ms) hits.delete(x);
}
const pad2 = n => String(n).padStart(2, '0');
const authEmail = loginId => `${String(loginId).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')}@${AUTH_EMAIL_DOMAIN}`;
const genPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = require('crypto').randomBytes(10);
  return Array.from(bytes, b => a[b % a.length]).join('');
};

// ---- validation -------------------------------------------------------------------------------
const bad = msg => new HttpsError('invalid-argument', msg);
function str(v, label, { min = 0, max = 500, required = false } = {}) {
  if (v === undefined || v === null || v === '') { if (required || min > 0) throw bad(`${label} is required.`); return null; }
  const s = String(v).trim();
  if (s.length < min) throw bad(`${label} is required.`);
  if (s.length > max) throw bad(`${label} is too long.`);
  return s;
}
function int(v, label, { min = -1e9, max = 1e9, required = true } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${label} is required.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} is not valid.`);
  return n;
}
function isoDate(v, label, required = false) {
  if (!v) { if (required) throw bad(`${label} is required.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw bad(`${label} must be a date.`);
  return String(v);
}

// ---- who is calling ---------------------------------------------------------------------------
/** Claims that go into the ID token. Rules read these, so most reads need no extra lookup (1000 byte limit). */
function claimsFromUser(u) {
  const c = { role: u.role };
  if (u.role === 'student') c.classNo = Number(u.student && u.student.class_no);
  if (u.role === 'teacher') c.classes = ((u.teacher && u.teacher.assignments) || []).map(a => Number(a.class_no));
  if (u.role === 'parent') c.children = ((u.parent && u.parent.children) || []).slice(0, 10);
  return c;
}

/**
 * Verifies: signed in, role allowed, and the login session (bsid claim) has not been revoked.
 * Returns { uid, role, token }. Costs one document read.
 */
async function requireSession(request, roles) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const t = request.auth.token;
  if (roles && !roles.includes(t.role)) throw new HttpsError('permission-denied', 'You do not have permission for this action.');
  if (!t.bsid) throw new HttpsError('unauthenticated', 'Session not registered. Please sign in again.');
  const s = await db.doc(`users/${request.auth.uid}/sessions/${t.bsid}`).get();
  if (!s.exists || s.get('revoked_at')) throw new HttpsError('unauthenticated', 'This login session was replaced. Please sign in again.');
  return { uid: request.auth.uid, role: t.role, token: t };
}

async function audit(actor, action, target, details) {
  await db.collection('audit_log').add({ actor, action, target: target == null ? null : String(target), details: details || null, created_at: nowIso() });
}

/** Marks every login session of a user as revoked and invalidates refresh tokens (used on pause / password reset / role change). */
async function revokeAllSessions(uid) {
  const snap = await db.collection(`users/${uid}/sessions`).where('revoked_at', '==', null).get();
  const batch = db.batch(); const at = nowIso();
  snap.forEach(d => batch.update(d.ref, { revoked_at: at, revoked_reason: 'account-change' }));
  if (!snap.empty) await batch.commit();
  await auth.revokeRefreshTokens(uid);
}

async function currentSession() {
  const q = await db.collection('academic_sessions').where('is_current', '==', true).limit(1).get();
  if (q.empty) throw new HttpsError('failed-precondition', 'No current academic session is set.');
  return { id: q.docs[0].id, ...q.docs[0].data() };
}

/** One notification for a class (or everyone). `dedupe` makes the document id fixed, so the same event can never notify twice.
 *  A push (FCM) is sent to the topic too; a failed push never breaks the caller. */
async function notify({ classNo = null, userId = null, kind = 'general', title, body = null, ref_id = null, ref_subject_id = null, link = null, dedupe = null, created_by = null }) {
  const audience = userId ? [`user_${userId}`] : classNo == null ? ['all'] : [`class_${classNo}`];
  const doc = { audience, class_no: classNo, kind, title, body, ref_id, ref_subject_id, link, created_by, created_at: nowIso() };
  const ref = dedupe ? db.doc(`notifications/${String(dedupe).replace(/[^A-Za-z0-9_-]/g, '_')}`) : db.collection('notifications').doc();
  try { await ref.create(doc); } catch (e) { if (e.code === 6) return false; throw e; }   // already sent: stop here, no second push
  if (userId) {   // personal notification: push to that person's own devices
    try { const t = (await db.collection(`users/${userId}/push_tokens`).get()).docs.map(d => d.get('token')); if (t.length) await admin.messaging().sendEachForMulticast({ tokens: t, notification: { title, body: body || '' }, data: { kind, link: link || '', id: ref.id } }); } catch (e) { console.warn('push failed', e.code || e.message); }
    return true;
  }
  try { await admin.messaging().send({ topic: classNo == null ? 'all' : `class_${classNo}`, notification: { title, body: body || '' }, data: { kind, link: link || '', id: ref.id },
    webpush: { fcmOptions: link ? { link } : undefined }, android: { priority: 'high' } }); } catch (e) { console.warn('push failed', e.code || e.message); }
  return true;
}

module.exports = { admin, db, auth, notify, istToday, classAccess, chunk, throttle, hotOpts, HttpsError, REGION, callOpts, ROLES, SESSION_LIMITS, AUTH_EMAIL_DOMAIN,
  nowIso, pad2, authEmail, genPassword, str, int, isoDate, bad, claimsFromUser, requireSession, audit, revokeAllSessions, currentSession };
