'use strict';
// Scanned answer sheets: private per student. Files: Storage  answer-sheets/{studentId}/{uuid}.{pdf|jpg|jpeg|png}. Metadata: answer_sheets/{id}.
const { onCall } = require('firebase-functions/v2/https');
const { admin, db, HttpsError, callOpts, nowIso, int, str, bad, requireSession, audit } = require('./common');
const EXT = ['pdf', 'jpg', 'jpeg', 'png'], MAX = 15 * 1024 * 1024;
const bucket = () => admin.storage().bucket();

exports.saveAnswerSheet = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const sid = String(b.student_id || ''), path = String(b.file_path || '');
  const u = await db.doc(`users/${sid}`).get(); if (!u.exists || u.get('role') !== 'student') throw new HttpsError('not-found', 'Student not found.');
  const classNo = u.get('student.class_no');
  if (!(me.role === 'admin' || (me.token.classes || []).includes(classNo))) throw new HttpsError('permission-denied', 'You are not allowed to upload for this class.');
  if (!path.startsWith(`${sid}/`) || path.includes('..')) throw bad('Invalid file.');
  const ext = path.split('.').pop().toLowerCase(); const f = bucket().file(`answer-sheets/${path}`);
  const [exists] = await f.exists(); if (!exists) throw bad('The file was not uploaded. Please try again.');
  const [m] = await f.getMetadata();
  if (!EXT.includes(ext) || Number(m.size) > MAX) { await f.delete().catch(() => {}); throw bad('Only PDF, JPG and PNG files up to 15 MB are allowed.'); }
  const ref = await db.collection('answer_sheets').add({ student_id: sid, class_no: classNo, exam_id: b.exam_id ? String(b.exam_id) : null, exam_name: str(b.exam_name, 'Exam', { max: 80 }), subject_name: str(b.subject_name, 'Subject', { min: 1, max: 80 }),
    file_path: path, file_type: ext, uploaded_by: me.uid, created_at: nowIso() });
  await audit(me.uid, 'answer_sheet_added', sid, null); return { id: ref.id };
});
exports.deleteAnswerSheet = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const ref = db.doc(`answer_sheets/${String((request.data && request.data.id) || '')}`), s = await ref.get(); if (!s.exists) return { ok: true };
  await ref.delete(); await bucket().file(`answer-sheets/${s.get('file_path')}`).delete().catch(() => {});
  await audit(me.uid, 'answer_sheet_deleted', s.get('student_id'), null); return { ok: true };
});
