'use strict';
// Notifications (in-app list + Firebase Cloud Messaging push), announcements, and the account password.
//   notifications/{id}                 audience ['all'] | ['class_10'], kind, title, body, link   (written only by functions; id = dedupe key when one exists)
//   users/{uid}.last_notif_seen_at     "mark all as read"
//   users/{uid}/notif_reads/{id}       a single notification opened (written by the browser, own folder only)
//   users/{uid}/push_tokens/{token}    devices that receive push
//   announcements/{id}                 admin notices
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { admin, db, auth, HttpsError, REGION, callOpts, nowIso, int, str, bad, requireSession, audit, notify, revokeAllSessions } = require('./common');

exports.markNotificationsSeen = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student', 'teacher', 'admin', 'parent']);
  await db.doc(`users/${me.uid}`).update({ last_notif_seen_at: nowIso() });
  return { ok: true };
});

/** Topics a person listens to: everyone, plus their class (students) or their children's classes (parents). */
async function topicsFor(me) {
  const t = ['all'];
  if (me.role === 'student') t.push(`class_${me.token.classNo}`);
  if (me.role === 'parent') { const docs = await db.getAll(...(me.token.children || []).map(c => db.doc(`users/${c}`))); docs.forEach(d => d.exists && t.push(`class_${d.get('student.class_no')}`)); }
  if (me.role === 'teacher') (me.token.classes || []).forEach(c => t.push(`class_${c}`));
  return [...new Set(t)];
}
exports.subscribePush = onCall(callOpts, async request => {
  const me = await requireSession(request); const token = String((request.data && request.data.token) || '');
  if (token.length < 20 || token.length > 400) throw bad('Invalid device token.');
  const topics = await topicsFor(me);
  await Promise.all(topics.map(t => admin.messaging().subscribeToTopic(token, t)));
  await db.doc(`users/${me.uid}/push_tokens/${token.slice(-40)}`).set({ token, platform: String((request.data && request.data.platform) || 'web').slice(0, 10), topics, created_at: nowIso() });
  return { ok: true, topics };
});
exports.unsubscribePush = onCall(callOpts, async request => {
  const me = await requireSession(request); const token = String((request.data && request.data.token) || '');
  if (!token) return { ok: true };
  const topics = await topicsFor(me);
  await Promise.all(topics.map(t => admin.messaging().unsubscribeFromTopic(token, t).catch(() => {})));
  await db.doc(`users/${me.uid}/push_tokens/${token.slice(-40)}`).delete().catch(() => {});
  return { ok: true };
});

// ---- announcements ----------------------------------------------------------------------------
const ACCENTS = ['navy', 'yellow', 'green', 'red', 'blue', 'orange'];
exports.saveAnnouncement = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  const target = b.target_class === null || b.target_class === '' || b.target_class === undefined ? null : int(b.target_class, 'Class', { min: -3, max: 12 });
  const publish = b.publish_at ? new Date(Date.parse(b.publish_at)) : new Date(); if (Number.isNaN(publish.getTime())) throw bad('Invalid publish date.');
  const row = { title: str(b.title, 'Title', { min: 1, max: 160 }), headline: str(b.headline, 'Headline', { max: 200 }), body: str(b.body, 'Message', { min: 1, max: 4000 }), accent: ACCENTS.includes(b.accent) ? b.accent : 'navy',
    target_class: target, publish_at: publish.toISOString(), is_active: b.is_active !== false };
  let id = b.id ? String(b.id) : null;
  if (id) { const s = await db.doc(`announcements/${id}`).get(); if (!s.exists) throw new HttpsError('not-found', 'Announcement not found.'); await db.doc(`announcements/${id}`).update({ ...row, updated_at: nowIso() }); }
  else { const ref = await db.collection('announcements').add({ ...row, notified_at: null, created_by: me.uid, created_at: nowIso() }); id = ref.id; }
  await audit(me.uid, 'announcement_saved', id, null); return { id };
});
exports.setAnnouncementActive = onCall(callOpts, async request => {
  await requireSession(request, ['admin']); const b = request.data || {};
  await db.doc(`announcements/${String(b.id || '')}`).update({ is_active: b.is_active === true }); return { ok: true };
});
exports.deleteAnnouncement = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']); await db.doc(`announcements/${String((request.data && request.data.id) || '')}`).delete(); await audit(me.uid, 'announcement_deleted', request.data.id, null); return { ok: true };
});
/** Every 5 minutes: notify students of announcements whose publish time has arrived (exactly once each). */
exports.processAnnouncements = onSchedule({ schedule: 'every 5 minutes', region: REGION, timeoutSeconds: 60, retryCount: 0 }, async () => {
  const due = await db.collection('announcements').where('is_active', '==', true).where('notified_at', '==', null).where('publish_at', '<=', nowIso()).get();
  for (const d of due.docs) {
    const won = await db.runTransaction(async tx => { const s = await tx.get(d.ref); if (s.get('notified_at')) return false; tx.update(d.ref, { notified_at: nowIso() }); return true; });
    if (!won) continue; const a = d.data();
    await notify({ classNo: a.target_class, kind: 'announcement', title: a.title, body: a.headline || a.body.slice(0, 120), ref_id: d.id, link: '/student/announcements.html', dedupe: `announcement_${d.id}_pub` });
  }
});

/** Change my own password. My other devices are signed out; this one stays. */
exports.changeMyPassword = onCall(callOpts, async request => {
  const me = await requireSession(request);
  const pw = String((request.data && request.data.password) || ''); if (pw.length < 8 || pw.length > 128) throw bad('Use at least 8 characters.');
  await auth.updateUser(me.uid, { password: pw });
  const snap = await db.collection(`users/${me.uid}/sessions`).where('revoked_at', '==', null).get(); const batch = db.batch();
  snap.forEach(d => { if (d.id !== me.token.bsid) batch.update(d.ref, { revoked_at: nowIso(), revoked_reason: 'password-changed' }); });
  await batch.commit(); await audit(me.uid, 'password_changed', me.uid, null); return { ok: true };
});
