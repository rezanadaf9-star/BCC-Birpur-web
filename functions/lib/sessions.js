'use strict';
// Device sessions. Firebase cannot revoke ONE device's token, so every login is registered here and gets a
// custom token carrying a session id (claim "bsid"). Functions and sensitive rules reject a revoked bsid, and
// the browser/app watches its own session document and signs out the moment it is revoked.
const { onCall } = require('firebase-functions/v2/https');
const { db, auth, HttpsError, callOpts, hotOpts, SESSION_LIMITS, nowIso, claimsFromUser, requireSession, bad } = require('./common');

const PLATFORMS = ['web', 'android'];

/** Called right after email+password sign-in. Enforces the per-platform limit and returns a session token. */
exports.registerSession = onCall(hotOpts, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const uid = request.auth.uid;
  const platform = request.data && request.data.platform;
  const portal = request.data && request.data.portal;
  if (!PLATFORMS.includes(platform)) throw bad('Unsupported platform.');
  if (!['student', 'teacher'].includes(portal)) throw bad('Unsupported login portal.');
  const label = String((request.data && request.data.deviceLabel) || '').slice(0, 120);

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'BCC profile not found.');
  const u = userSnap.data();
  const portalRoleOk = portal === 'teacher'
    ? ['teacher', 'admin'].includes(u.role)
    : u.role === portal;
  if (!portalRoleOk) throw new HttpsError('permission-denied', 'This account is not registered for this login portal.');
  if (u.is_active === false) throw new HttpsError('permission-denied', 'This account is paused. Please contact the centre.');
  const limit = SESSION_LIMITS[u.role] || 2;

  const sessionsCol = db.collection(`users/${uid}/sessions`);
  const newRef = sessionsCol.doc();
  const replaced = await db.runTransaction(async tx => {
    const active = await tx.get(sessionsCol.where('revoked_at', '==', null));
    const mine = active.docs.filter(d => d.get('platform') === platform).sort((a, b) => String(a.get('created_at')).localeCompare(String(b.get('created_at'))));
    let removed = 0;
    // after adding the new one there must be at most `limit`: revoke the oldest ones
    while (mine.length + 1 - removed > limit) { tx.update(mine[removed].ref, { revoked_at: nowIso(), revoked_reason: 'replaced' }); removed++; }
    tx.set(newRef, { platform, device_label: label, created_at: nowIso(), last_seen_at: nowIso(), revoked_at: null });
    return removed;
  });

  // housekeeping: forget sessions that were closed more than 30 days ago, so the folder never grows without limit
  try { const old = await sessionsCol.where('revoked_at', '<', new Date(Date.now() - 30 * 864e5).toISOString()).limit(20).get(); if (!old.empty) { const b = db.batch(); old.forEach(d => b.delete(d.ref)); await b.commit(); } } catch (e) { console.warn('session prune skipped', e.message); }
  const customToken = await auth.createCustomToken(uid, { ...claimsFromUser(u), bsid: newRef.id });
  const profile = {
    role: u.role,
    full_name: u.full_name,
    login_id: u.login_id,
    is_active: u.is_active,
    photo_path: u.photo_path || null,
    last_notif_seen_at: u.last_notif_seen_at || null,
    student: u.student || null,
    teacher: u.teacher || null,
    parent: u.parent || null,
  };
  return { customToken, sessionId: newRef.id, replaced_sessions: replaced, allowed_sessions: limit, profile };
});

/** Sign out this device only. */
exports.logoutSession = onCall(callOpts, async request => {
  if (!request.auth || !request.auth.token.bsid) return { ok: true };
  await db.doc(`users/${request.auth.uid}/sessions/${request.auth.token.bsid}`).set({ revoked_at: nowIso(), revoked_reason: 'logout' }, { merge: true });
  return { ok: true };
});

/** Sign out another of my own devices. */
exports.revokeMySession = onCall(callOpts, async request => {
  const me = await requireSession(request);
  const id = String((request.data && request.data.sessionId) || '');
  if (!id || id === me.token.bsid) throw bad('Choose another device.');
  const ref = db.doc(`users/${me.uid}/sessions/${id}`);
  const s = await ref.get();
  if (!s.exists || s.get('revoked_at')) return { ok: false };
  await ref.update({ revoked_at: nowIso(), revoked_reason: 'user' });
  return { ok: true };
});

/** Keeps "last seen" fresh without writing on every page: the browser calls this at most every 15 minutes. */
exports.touchSession = onCall(callOpts, async request => {
  const me = await requireSession(request);
  const ref = db.doc(`users/${me.uid}/sessions/${me.token.bsid}`);
  await ref.update({ last_seen_at: nowIso() });
  return { ok: true };
});
