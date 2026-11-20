'use strict';
// Group discussion, Super 15 batch (members, materials) and lecture-comment moderation.
//   discussion_messages/{id}   scope 'class' (class_no) | 'super15'; author name/role come from the server
//   super15_members/{uid}      Class 10/12 students chosen by the admin
//   super15_materials/{id}     study material / answer sheets: files in Storage bcc-content/super15/{uuid}.ext (members + staff only)
const { onCall } = require('firebase-functions/v2/https');
const { admin, db, HttpsError, callOpts, nowIso, int, str, bad, requireSession, audit, throttle } = require('./common');
const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt'], MAX = 15 * 1024 * 1024;
const bucket = () => admin.storage().bucket();
const isMember = async uid => { const s = await db.doc(`super15_members/${uid}`).get(); return s.exists && s.get('is_active') !== false; };

exports.postDiscussionMessage = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student', 'teacher', 'admin']); throttle(me.uid, 'chat', 12, 30000);
  const b = request.data || {}; const body = String(b.body || '').trim(); if (body.length < 1 || body.length > 600) throw bad('A message must be 1 to 600 characters.');
  const scope = String(b.scope || ''); const u = await db.doc(`users/${me.uid}`).get();
  const row = { scope, user_id: me.uid, author_name: u.get('full_name'), author_role: me.role, body, created_at: nowIso() };
  if (scope === 'class') {
    const c = int(b.class_no, 'Class', { min: -3, max: 12 });
    if (me.role === 'student') { if (c !== me.token.classNo) throw new HttpsError('permission-denied', 'You can only write in your own class.'); const cl = await db.doc(`classes/${c}`).get(); if (!cl.get('features.group_discussion')) throw new HttpsError('permission-denied', 'Group discussion is not switched on for your class.'); }
    else if (me.role === 'teacher' && !(me.token.classes || []).includes(c)) throw new HttpsError('permission-denied', 'Not your class.');
    row.class_no = c;
  } else if (scope === 'super15') { if (me.role === 'student' && !(await isMember(me.uid))) throw new HttpsError('permission-denied', 'Only Super 15 members can write here.'); row.class_no = null; }
  else throw bad('Unknown discussion.');
  const ref = await db.collection('discussion_messages').add(row); return { id: ref.id };
});

exports.deleteLectureComment = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']); const b = request.data || {};
  await db.doc(`lectures/${String(b.lecture_id || '')}/comments/${String(b.id || '')}`).delete(); await audit(me.uid, 'comment_deleted', b.id, null); return { ok: true };
});

/** Admin adds students (Class 10 and 12 only, active) to Super 15. */
exports.super15AddMembers = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const ids = [...new Set((Array.isArray(request.data && request.data.ids) ? request.data.ids : []).map(String))]; if (!ids.length || ids.length > 300) throw bad('Select students to add.');
  const docs = await db.getAll(...ids.map(i => db.doc(`users/${i}`))); const batch = db.batch();
  docs.forEach(d => { if (!d.exists || d.get('role') !== 'student' || ![10, 12].includes(d.get('student.class_no')) || d.get('student.status') !== 'active') throw bad('Only active Class 10 and Class 12 students can be added.');
    batch.set(db.doc(`super15_members/${d.id}`), { student_id: d.id, is_active: true, name: d.get('full_name'), class_no: d.get('student.class_no'), roll: d.get('student.roll_number'), added_by: me.uid, added_at: nowIso() }, { merge: true }); });
  await batch.commit(); await audit(me.uid, 'super15_added', null, { n: ids.length }); return { added: ids.length };
});

exports.saveSuper15Material = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const b = request.data || {}; const path = String(b.file_path || ''), url = String(b.url || '').trim();
  if (!['material', 'answer_sheet'].includes(b.kind)) throw bad('Choose the type.');
  const row = { kind: b.kind, title: str(b.title, 'Title', { min: 1, max: 160 }), description: str(b.description, 'Description', { max: 500 }), created_by: me.uid, created_at: nowIso() };
  if (path) {
    if (!/^super15\/[A-Za-z0-9._-]+$/.test(path)) throw bad('Invalid file.');
    const ext = path.split('.').pop().toLowerCase(); const f = bucket().file(`bcc-content/${path}`); const [exists] = await f.exists(); if (!exists) throw bad('The file was not uploaded. Please try again.');
    const [m] = await f.getMetadata(); if (!EXT.includes(ext) || Number(m.size) > MAX) { await f.delete().catch(() => {}); throw bad('That file type or size is not allowed (up to 15 MB).'); }
    Object.assign(row, { file_path: path, file_type: ext });
  } else if (url) { if (!/^https:\/\//i.test(url) || url.length > 500) throw bad('Paste a valid https link.'); row.url = url; }
  else throw bad('Add a file or a link.');
  const ref = await db.collection('super15_materials').add(row); return { id: ref.id };
});
exports.deleteSuper15Material = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']); const ref = db.doc(`super15_materials/${String((request.data && request.data.id) || '')}`); const s = await ref.get(); if (!s.exists) return { ok: true };
  await ref.delete(); if (s.get('file_path')) await bucket().file(`bcc-content/${s.get('file_path')}`).delete().catch(() => {}); await audit(me.uid, 'super15_material_deleted', ref.id, null); return { ok: true };
});
