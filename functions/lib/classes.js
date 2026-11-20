'use strict';
// Classes, subjects, academic sessions, public faculty list. Admin only.
const { onCall } = require('firebase-functions/v2/https');
const { db, HttpsError, callOpts, nowIso, str, int, isoDate, bad, requireSession, audit, currentSession } = require('./common');

/** New academic session; optionally the current one (the old current flag is cleared in the same batch). */
exports.createAcademicSession = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  const label = str(b.label, 'Label', { min: 1, max: 20 });
  const starts_on = isoDate(b.starts_on, 'Start date', true), ends_on = isoDate(b.ends_on, 'End date', true);
  if (ends_on <= starts_on) throw bad('The end date must be after the start date.');
  if (!(await db.collection('academic_sessions').where('label', '==', label).limit(1).get()).empty) throw new HttpsError('already-exists', 'A session with this label already exists.');
  const batch = db.batch();
  if (b.is_current) { const cur = await db.collection('academic_sessions').where('is_current', '==', true).get(); cur.forEach(d => batch.update(d.ref, { is_current: false })); }
  const ref = db.collection('academic_sessions').doc();
  batch.set(ref, { label, starts_on, ends_on, is_current: !!b.is_current });
  await batch.commit();
  await audit(me.uid, 'session_created', ref.id, { label, current: !!b.is_current });
  return { ok: true, id: ref.id };
});

/** Current academic session (id + label) for pages that need it. */
exports.currentSessionId = onCall(callOpts, async request => {
  await requireSession(request);
  const s = await currentSession(); return { id: s.id, label: s.label };
});

/** A subject can only be removed when nothing uses it (lectures, notes, homework, quizzes, exams, AI hub). */
exports.deleteSubject = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const id = String((request.data && request.data.subject_id) || '');
  if (!id) throw bad('Subject is required.');
  const used = async (c, f = 'subject_id', op = '==') => !(await db.collection(c).where(f, op, id).limit(1).get()).empty;
  const checks = await Promise.all([used('lectures'), used('notes'), used('homework'), used('quizzes'), used('notebooklm_resources'), used('exams', 'subject_ids', 'array-contains')]);
  if (checks.some(Boolean)) throw new HttpsError('failed-precondition', 'This subject is already used by lectures, notes or exams, so it cannot be removed.');
  await db.doc(`subjects/${id}`).delete();
  await audit(me.uid, 'subject_deleted', id, null);
  return { ok: true };
});

/** Public website faculty. Add or move a person to a position; everyone else shifts and the list is renumbered 1..n. */
exports.facultySave = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  const id = b.p_id ? String(b.p_id) : null;
  const rec = {
    name: str(b.p_name, 'Name', { min: 1, max: 120 }), short_name: str(b.p_short, 'Short name', { max: 60 }),
    designation: str(b.p_designation, 'Designation', { max: 120 }) || 'Faculty', subjects: str(b.p_subjects, 'Subjects', { max: 200 }),
    classes_text: str(b.p_classes, 'Classes', { max: 120 }), qualification: str(b.p_qualification, 'Qualification', { max: 200 }),
    photo_path: str(b.p_photo, 'Photo', { max: 300 }), is_published: b.p_published !== false,
  };
  const col = db.collection('site_faculty');
  const all = (await col.get()).docs.map(d => ({ id: d.id, ...d.data() }));
  if (id && !all.some(r => r.id === id)) throw new HttpsError('not-found', 'Person not found.');
  const ref = id ? col.doc(id) : col.doc();
  const others = all.filter(r => r.id !== ref.id).sort((a, c) => (a.position - c.position) || String(a.created_at).localeCompare(String(c.created_at)));
  const pos = Math.max(1, Math.min(b.p_position == null ? others.length + 1 : int(b.p_position, 'Position', { min: 1, max: 1000 }), others.length + 1));
  const order = [...others.slice(0, pos - 1).map(r => r.id), ref.id, ...others.slice(pos - 1).map(r => r.id)];
  const batch = db.batch();
  if (id) batch.update(ref, rec); else batch.set(ref, { ...rec, created_at: nowIso() });
  order.forEach((x, i) => batch.update(col.doc(x), { position: i + 1 }));
  await batch.commit();
  await audit(me.uid, 'faculty_saved', ref.id, null);
  return { id: ref.id };
});

exports.facultyDelete = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const id = String((request.data && request.data.p_id) || '');
  const col = db.collection('site_faculty');
  await col.doc(id).delete();
  const rest = (await col.get()).docs.map(d => ({ ref: d.ref, ...d.data() })).sort((a, c) => (a.position - c.position) || String(a.created_at).localeCompare(String(c.created_at)));
  const batch = db.batch(); rest.forEach((r, i) => batch.update(r.ref, { position: i + 1 })); await batch.commit();
  await audit(me.uid, 'faculty_deleted', id, null);
  return { ok: true };
});
