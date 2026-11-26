'use strict';
// Meetings (PTM, motivational sessions, Super 15 classes) in Jitsi, with invitations and who-joined.
//   meetings/{id}                    meta (staff read). The Jitsi room name is NOT here:
//   meeting_rooms/{id}               { room } server-only: handed out by joinMeeting to invited, signed-in people while the meeting is live
//   meetings/{id}/invitees/{uid}     individual invitations
//   meetings/{id}/participants/{id}  who joined / left
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { admin, db, FieldValue, HttpsError, REGION, callOpts, nowIso, int, str, bad, requireSession, audit, notify } = require('./common');
const KINDS = ['ptm', 'motivational', 'super15'];
const LINK = { ptm: '/student/ptm.html', motivational: '/student/motivational.html', super15: '/student/super15.html' };
const istText = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const istTime = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
const teaches = (me, c) => (me.token.classes || []).includes(c);

async function featureOn(classNo, key) { const c = await db.doc(`classes/${classNo}`).get(); return !!(c.exists && c.get(`features.${key}`)); }
async function isSuper15(uid) { const s = await db.doc(`super15_members/${uid}`).get(); return s.exists && s.get('is_active') !== false; }
/** Can this person see/join the meeting? (staff always; students/parents by invitation, class or Super 15 membership) */
async function eligible(me, id, m) {
  if (me.role === 'admin' || me.role === 'teacher') return true;
  if (me.role !== 'student') return false;
  if (m.kind === 'super15') return isSuper15(me.uid);
  if (m.audience === 'students') return (await db.doc(`meetings/${id}/invitees/${me.uid}`).get()).exists;
  const u = await db.doc(`users/${me.uid}`).get(); if (u.get('student.status') !== 'active') return false;
  if (m.audience === 'all') return featureOn(me.token.classNo, m.kind);
  return (m.target_classes || []).includes(me.token.classNo) && featureOn(me.token.classNo, m.kind);
}
/** Notify everyone invited. Each notification has a fixed key, so repeating an event never notifies twice. */
async function notifyMeeting(id, m, title, body, key) {
  const base = { kind: 'meeting', title, body, ref_id: id, link: LINK[m.kind] };
  if (m.kind === 'super15') { const mem = await db.collection('super15_members').where('is_active', '==', true).get(); for (const d of mem.docs) await notify({ ...base, userId: d.id, dedupe: `${key}_u${d.id}` }); }
  else if (m.audience === 'students') { const inv = await db.collection(`meetings/${id}/invitees`).get(); for (const d of inv.docs) await notify({ ...base, userId: d.id, dedupe: `${key}_u${d.id}` }); }
  else if (m.audience === 'all') await notify({ ...base, dedupe: `${key}_all` });
  else for (const c of m.target_classes || []) await notify({ ...base, classNo: c, dedupe: `${key}_c${c}` });
}
async function load(id) { const ref = db.doc(`meetings/${String(id || '')}`), s = await ref.get(); if (!s.exists) throw new HttpsError('not-found', 'Meeting not found.'); return { ref, id: s.id, ...s.data() }; }
const owner = (me, m) => me.role === 'admin' || m.created_by === me.uid;

exports.createMeeting = onCall({ ...callOpts, timeoutSeconds: 120 }, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const kind = String(b.kind || ''), aud = String(b.audience || ''); const admin_ = me.role === 'admin';
  if (!KINDS.includes(kind)) throw bad('Unknown meeting type.');
  if (!admin_ && (kind === 'super15' || aud === 'all')) throw new HttpsError('permission-denied', 'Only the admin can invite all classes or the Super 15 batch.');
  if (!['all', 'classes', 'students'].includes(aud)) throw bad('Choose who to invite.');
  const classes = (Array.isArray(b.classes) ? b.classes : []).map(Number).filter(Number.isInteger), students = [...new Set((Array.isArray(b.students) ? b.students : []).map(String))];
  if (aud === 'classes' && kind !== 'super15') { if (!classes.length) throw bad('Select at least one class.'); if (!admin_ && classes.some(c => !teaches(me, c))) throw new HttpsError('permission-denied', 'You can only invite your own classes.'); }
  let invitees = [];
  if (aud === 'students' && kind !== 'super15') {
    if (!students.length || students.length > 400) throw bad('Select at least one student.');
    const docs = await db.getAll(...students.map(s => db.doc(`users/${s}`)));
    docs.forEach(d => { if (!d.exists || d.get('role') !== 'student') throw bad('A selected student was not found.'); if (!admin_ && !teaches(me, d.get('student.class_no'))) throw new HttpsError('permission-denied', 'You can only invite students of your own classes.'); });
    invitees = students;
  }
  let start = null; if (b.start) { const t = Date.parse(b.start); if (!t) throw bad('Invalid start time.'); start = new Date(t).toISOString(); }
  const live = b.live === true;
  const ref = db.collection('meetings').doc();
  const m = { kind, title: str(b.title, 'Title', { min: 1, max: 160 }), speaker: str(b.speaker, 'Speaker', { max: 120 }), target_classes: aud === 'classes' ? classes : [], audience: kind === 'super15' ? 'classes' : aud,
    start_at: start, status: live ? 'live' : 'scheduled', created_by: me.uid, created_at: nowIso(), live_notified_at: live ? nowIso() : null, reminder_10_sent_at: null, cancelled_at: null, invitee_count: invitees.length, participant_count: 0 };
  const batch = db.batch(); batch.set(ref, m); batch.set(db.doc(`meeting_rooms/${ref.id}`), { room: 'BCC-' + require('crypto').randomBytes(16).toString('hex') });
  invitees.forEach(s => batch.set(db.doc(`meetings/${ref.id}/invitees/${s}`), { student_id: s, created_at: nowIso() })); await batch.commit();
  if (live) await notifyMeeting(ref.id, m, `Meeting is live: ${m.title}`, 'Tap to join now.', `meet_${ref.id}_live`);
  else if (start) await notifyMeeting(ref.id, m, `Meeting scheduled: ${m.title}`, `Starts ${istText(start)} IST`, `meet_${ref.id}_sched`);
  await audit(me.uid, 'meeting_created', ref.id, { kind, audience: m.audience }); return { id: ref.id };
});

exports.meetingSetStatus = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const m = await load(request.data && request.data.id); const st = String(request.data.status || '');
  if (!owner(me, m)) throw new HttpsError('permission-denied', 'Only the admin or the person who created the meeting can change it.');
  if (!['live', 'ended', 'cancelled'].includes(st)) throw bad('Unsupported status.');
  await m.ref.update({ status: st, cancelled_at: st === 'cancelled' ? nowIso() : m.cancelled_at || null, ...(st === 'live' && !m.live_notified_at ? { live_notified_at: nowIso() } : {}) });
  if (st === 'live' && !m.live_notified_at) await notifyMeeting(m.id, m, `Meeting is live: ${m.title}`, 'Tap to join now.', `meet_${m.id}_live`);
  if (st === 'cancelled') await notifyMeeting(m.id, m, `Meeting cancelled: ${m.title}`, 'This meeting has been cancelled.', `meet_${m.id}_cancel`);
  return { ok: true };
});
exports.meetingReschedule = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const m = await load(request.data && request.data.id);
  if (!owner(me, m)) throw new HttpsError('permission-denied', 'Not allowed.');
  const t = Date.parse(request.data.when); if (!t || t <= Date.now()) throw bad('Choose a future time.'); const iso = new Date(t).toISOString();
  await m.ref.update({ start_at: iso, status: 'scheduled', reminder_10_sent_at: null, cancelled_at: null });
  await notifyMeeting(m.id, m, `Meeting rescheduled: ${m.title}`, `New time: ${istText(iso)} IST`, `meet_${m.id}_resched_${Math.floor(t / 1000)}`); return { ok: true };
});

/** Student list: only sessions I am invited to, scheduled or live. */
exports.myMeetings = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student', 'teacher', 'admin']); const kind = String((request.data && request.data.kind) || '');
  if (!KINDS.includes(kind)) throw bad('Unknown meeting type.');
  const q = await db.collection('meetings').where('kind', '==', kind).where('status', 'in', ['scheduled', 'live']).get(); const out = [];
  for (const d of q.docs) if (await eligible(me, d.id, d.data())) { const m = d.data(); out.push({ id: d.id, kind: m.kind, title: m.title, speaker: m.speaker, start_at: m.start_at, status: m.status }); }
  out.sort((a, c) => ((c.status === 'live') - (a.status === 'live')) || String(a.start_at || '9').localeCompare(String(c.start_at || '9')));
  return { meetings: out };
});
/** The room name is given only to an invited, signed-in person, and only while the meeting is live. */
exports.joinMeeting = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student', 'teacher', 'admin']); const m = await load(request.data && request.data.id);
  if (!(await eligible(me, m.id, m))) throw new HttpsError('permission-denied', 'You are not invited to this meeting.');
  if (m.status !== 'live') throw new HttpsError('failed-precondition', 'This meeting has not started yet.');
  const u = await db.doc(`users/${me.uid}`).get();
  const open = await db.collection(`meetings/${m.id}/participants`).where('user_id', '==', me.uid).where('left_at', '==', null).limit(1).get();
  if (open.empty) { await db.collection(`meetings/${m.id}/participants`).add({ user_id: me.uid, name: u.get('full_name'), role: me.role, joined_at: nowIso(), left_at: null }); await m.ref.update({ participant_count: FieldValue.increment(1) }); }
  return { room: (await db.doc(`meeting_rooms/${m.id}`).get()).get('room') };
});
exports.leaveMeeting = onCall(callOpts, async request => {
  const me = await requireSession(request); const id = String((request.data && request.data.id) || '');
  const open = await db.collection(`meetings/${id}/participants`).where('user_id', '==', me.uid).where('left_at', '==', null).get();
  const batch = db.batch(); open.forEach(d => batch.update(d.ref, { left_at: nowIso() })); await batch.commit(); return { ok: true };
});

/** Every minute: "starts in 10 minutes", once per meeting time. */
exports.processMeetingReminders = onSchedule({ schedule: 'every 1 minutes', region: REGION, timeoutSeconds: 60, retryCount: 0 }, async () => {
  const now = Date.now();
  const due = await db.collection('meetings').where('status', '==', 'scheduled').where('reminder_10_sent_at', '==', null).where('start_at', '>', new Date(now).toISOString()).where('start_at', '<=', new Date(now + 10 * 60e3).toISOString()).get();
  for (const d of due.docs) {
    const won = await db.runTransaction(async tx => { const s = await tx.get(d.ref); if (s.get('reminder_10_sent_at') || s.get('status') !== 'scheduled') return false; tx.update(d.ref, { reminder_10_sent_at: nowIso() }); return true; });
    if (!won) continue; const m = d.data();
    await notifyMeeting(d.id, m, `Meeting starts in 10 minutes: ${m.title}`, `Starts at ${istTime(m.start_at)} IST`, `meet_${d.id}_10min_${Math.floor(Date.parse(m.start_at) / 1000)}`);
  }
});
