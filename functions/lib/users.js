'use strict';
// Admin-only account management. Same request shapes as the previous version of this function, so the
// admin pages keep working: { type:'student'|'teacher'|'parent', ... } or { action:'set-status'|... }.
const { onCall } = require('firebase-functions/v2/https');
const { db, auth, HttpsError, callOpts, nowIso, pad2, authEmail, genPassword, str, int, isoDate, bad,
  claimsFromUser, requireSession, audit, revokeAllSessions, currentSession } = require('./common');

const classCode = c => (c > 0 ? pad2(c) : ({ '-3': 'NU', '-2': 'LK', '-1': 'UK' })[String(c)]);
const ALREADY_EXISTS = 6;

/** Reserve a login id. Fails if someone already has it (login_ids/{id} is created, never overwritten). */
async function reserveLoginId(loginId) {
  try { await db.doc(`login_ids/${loginId}`).create({ uid: null, created_at: nowIso() }); return true; }
  catch (e) { if (e.code === ALREADY_EXISTS) return false; throw e; }
}

async function verifyAdminPassword(email, password) {
  const key = process.env.WEB_API_KEY;
  if (!key) throw new HttpsError('failed-precondition', 'The server is missing WEB_API_KEY (see docs/SETUP.md).');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.ALLOWED_ORIGINS ? { Referer: process.env.ALLOWED_ORIGINS.split(',')[0].trim() + '/' } : {}) }, body: JSON.stringify({ email, password, returnSecureToken: false }) });   // Referer lets this work even if the web key is restricted to your websites
  return r.ok;
}

async function nextAdmissionNo() {
  const ref = db.doc('counters/admission');
  const n = await db.runTransaction(async tx => { const s = await tx.get(ref); const v = (s.exists ? s.get('n') : 0) + 1; tx.set(ref, { n: v }); return v; });
  return `BCC/${pad2(new Date().getUTCFullYear() % 100)}/${String(n).padStart(4, '0')}`;
}

async function createStudent(actor, b) {
  const full_name = str(b.full_name, 'Name', { min: 1, max: 120 });
  const class_no = int(b.class_no, 'Class', { min: -3, max: 12 });
  const password = String(b.password || '');
  if (!classCode(class_no) || password.length < 8) throw bad('Name, class and an 8+ character password are required.');
  const cls = await db.doc(`classes/${class_no}`).get();
  if (!cls.exists || !cls.get('is_active')) throw new HttpsError('failed-precondition', 'This class is not active yet. Create/activate it under Classes first.');
  const sess = await currentSession();
  const yy = String(sess.starts_on).slice(2, 4);

  let roll = String(b.roll_number || '').trim();
  if (roll && !/^\d{1,3}$/.test(roll)) throw bad('Roll number must be a number.');
  if (!roll) {
    const rows = await db.collection('users').where('role', '==', 'student').where('student.class_no', '==', class_no).select('student.roll_number').get();
    roll = pad2(Math.max(0, ...rows.docs.map(d => parseInt(d.get('student.roll_number'), 10) || 0)) + 1);
  }
  let login_id = '';
  for (let i = 0; i < 200 && !login_id; i++) {
    const c = `${yy}BCC${classCode(class_no)}${pad2(roll)}`;
    if (await reserveLoginId(c)) login_id = c; else if (b.roll_number) break; else roll = pad2(parseInt(roll, 10) + 1);
  }
  if (!login_id) throw new HttpsError('already-exists', 'Could not allocate a unique Student ID. Try again.');

  let uid = null;
  try {
    const admission_no = await nextAdmissionNo();
    const rec = await auth.createUser({ email: authEmail(login_id), password, displayName: full_name, emailVerified: true });
    uid = rec.uid;
    const user = {
      role: 'student', full_name, login_id, is_active: true, photo_path: null, created_at: nowIso(),
      student: {
        class_no, roll_number: pad2(roll), batch: yy, admission_no, status: 'active', admitted_on: nowIso().slice(0, 10), left_on: null,
        phone: str(b.phone, 'Phone', { max: 20 }), father_name: str(b.father_name, 'Father name', { max: 120 }), mother_name: str(b.mother_name, 'Mother name', { max: 120 }),
        dob: isoDate(b.dob, 'Date of birth'), gender: ['Male', 'Female'].includes(b.gender) ? b.gender : null, address: str(b.address, 'Address', { max: 300 }), goal_message: null,
      },
    };
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}`), user);
    batch.set(db.doc(`users/${uid}/enrollments/${sess.id}`), { session_id: sess.id, class_no, roll_number: pad2(roll), batch: yy, status: 'active', created_at: nowIso() });
    batch.set(db.doc(`login_ids/${login_id}`), { uid, created_at: nowIso() });
    await batch.commit();
    await auth.setCustomUserClaims(uid, claimsFromUser(user));
    await audit(actor, 'student_created', uid, { login_id, class_no });
    return { ok: true, user_id: uid, login_id, password, admission_no, roll_number: pad2(roll), full_name };
  } catch (e) {
    if (uid) { await auth.deleteUser(uid).catch(() => {}); await db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => {}); }
    await db.doc(`login_ids/${login_id}`).delete().catch(() => {});
    throw e;
  }
}

function cleanAssignments(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(a => ({ class_no: int(a.class_no, 'Class', { min: -3, max: 12 }), is_class_teacher: !!a.is_class_teacher, can_declare_results: !!a.can_declare_results }))
    .filter(a => (seen.has(a.class_no) ? false : seen.add(a.class_no)));
}

async function createTeacher(actor, b) {
  const full_name = str(b.full_name, 'Teacher name', { min: 1, max: 120 });
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || genPassword());
  const assignments = cleanAssignments(b.assignments);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Teacher name and a valid email address are required.');
  if (!assignments.length || password.length < 8) throw bad('Select at least one class and use a password of 8+ characters.');
  if (!(await reserveLoginId(email))) throw new HttpsError('already-exists', 'A teacher with this email already exists.');
  let uid = null;
  try {
    const rec = await auth.createUser({ email, password, displayName: full_name, emailVerified: true });
    uid = rec.uid;
    const user = { role: 'teacher', full_name, login_id: email, is_active: true, photo_path: null, created_at: nowIso(),
      teacher: { phone: str(b.phone, 'Phone', { max: 20 }), qualification: str(b.qualification, 'Qualification', { max: 200 }), subjects: str(b.subjects, 'Subjects', { max: 200 }), address: str(b.address, 'Address', { max: 300 }), assignments } };
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}`), user);
    batch.set(db.doc(`login_ids/${email}`), { uid, created_at: nowIso() });
    await batch.commit();
    await auth.setCustomUserClaims(uid, claimsFromUser(user));
    await audit(actor, 'teacher_created', uid, { email, classes: assignments.map(a => a.class_no) });
    return { ok: true, user_id: uid, login_id: email, email, password, full_name };
  } catch (e) {
    if (uid) { await auth.deleteUser(uid).catch(() => {}); await db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => {}); }
    await db.doc(`login_ids/${email}`).delete().catch(() => {});
    throw e;
  }
}

/** Parent: a separate login linked to one or more students. Body: { type:'parent', full_name, email, password, children:[studentUid] } */
async function createParent(actor, b) {
  const full_name = str(b.full_name, 'Parent name', { min: 1, max: 120 });
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || genPassword());
  const children = [...new Set(Array.isArray(b.children) ? b.children.map(String) : [])].slice(0, 10);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8 || !children.length) throw bad('Parent name, a valid email, an 8+ character password and at least one child are required.');
  for (const c of children) { const s = await db.doc(`users/${c}`).get(); if (!s.exists || s.get('role') !== 'student') throw bad('One of the linked students was not found.'); }
  if (!(await reserveLoginId(email))) throw new HttpsError('already-exists', 'An account with this email already exists.');
  let uid = null;
  try {
    const rec = await auth.createUser({ email, password, displayName: full_name, emailVerified: true });
    uid = rec.uid;
    const user = { role: 'parent', full_name, login_id: email, is_active: true, photo_path: null, created_at: nowIso(), parent: { children } };
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}`), user);
    batch.set(db.doc(`login_ids/${email}`), { uid, created_at: nowIso() });
    await batch.commit();
    await auth.setCustomUserClaims(uid, claimsFromUser(user));
    await audit(actor, 'parent_created', uid, { email, children });
    return { ok: true, user_id: uid, login_id: email, email, password, full_name };
  } catch (e) {
    if (uid) { await auth.deleteUser(uid).catch(() => {}); await db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => {}); }
    await db.doc(`login_ids/${email}`).delete().catch(() => {});
    throw e;
  }
}

async function setStatus(actor, b) {
  const id = String(b.user_id || '');
  if (!id || typeof b.is_active !== 'boolean') throw bad('User and status are required.');
  const ref = db.doc(`users/${id}`); const s = await ref.get();
  if (!s.exists || s.get('role') === 'admin') throw new HttpsError('not-found', 'Account not found.');
  const status = b.is_active ? 'active' : (b.status === 'left' ? 'left' : 'paused');
  const patch = { is_active: b.is_active };
  if (s.get('role') === 'student') { patch['student.status'] = status; patch['student.left_on'] = b.is_active ? null : nowIso().slice(0, 10); }
  await ref.update(patch);
  if (s.get('role') === 'student') {
    const en = await db.collection(`users/${id}/enrollments`).where('status', '==', b.is_active ? 'paused' : 'active').get();
    const batch = db.batch(); en.forEach(d => batch.update(d.ref, { status })); if (!en.empty) await batch.commit();
  }
  await auth.updateUser(id, { disabled: !b.is_active });
  if (!b.is_active) await revokeAllSessions(id);        // paused = signed out everywhere, history kept
  await audit(actor, b.is_active ? 'account_reactivated' : 'account_paused', id, { status });
  return { ok: true, is_active: b.is_active };
}

async function resetPassword(actor, adminUid, b, kind) {
  const id = String(b.user_id || '');
  const password = String(b.password || genPassword());
  if (!id || password.length < 8) throw bad(kind === 'student' ? 'Student, a new password (8+ characters) and admin verification are required.' : 'Teacher and a password of 8+ characters are required.');
  if (kind === 'student') {
    const adminPassword = String(b.admin_password || '');
    if (!adminPassword) throw bad('Student, a new password (8+ characters) and admin verification are required.');
    const adminRec = await auth.getUser(adminUid);
    if (!(await verifyAdminPassword(adminRec.email, adminPassword))) throw new HttpsError('permission-denied', 'Administrator password verification failed.');
  }
  const s = await db.doc(`users/${id}`).get();
  if (!s.exists || s.get('role') !== kind) throw new HttpsError('not-found', kind === 'student' ? 'Student account not found.' : 'Teacher account not found.');
  await auth.updateUser(id, { password });
  await revokeAllSessions(id);                          // old devices must sign in again with the new password
  await audit(actor, kind === 'student' ? 'student_password_reset' : 'teacher_password_reset', id, null);
  return { ok: true, login_id: s.get('login_id'), password };
}

async function setTeacherClasses(actor, b) {
  const id = String(b.user_id || '');
  const assignments = cleanAssignments(b.assignments);
  const ref = db.doc(`users/${id}`); const s = await ref.get();
  if (!s.exists || s.get('role') !== 'teacher') throw new HttpsError('not-found', 'Teacher account not found.');
  await ref.update({ 'teacher.assignments': assignments });
  const u = { ...s.data(), teacher: { ...s.get('teacher'), assignments } };
  await auth.setCustomUserClaims(id, claimsFromUser(u));
  await revokeAllSessions(id);                          // new class list lives in the token: teacher signs in again
  await audit(actor, 'teacher_classes_set', id, { classes: assignments.map(a => a.class_no) });
  return { ok: true, relogin: true };
}

exports.adminUsers = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  if (b.action === 'set-status') return setStatus(me.uid, b);
  if (b.action === 'reset-student-password') return resetPassword(me.uid, me.uid, b, 'student');
  if (b.action === 'reset-password') return resetPassword(me.uid, me.uid, b, 'teacher');
  if (b.action === 'set-teacher-classes') return setTeacherClasses(me.uid, b);
  if (b.type === 'teacher') return createTeacher(me.uid, b);
  if (b.type === 'student') return createStudent(me.uid, b);
  if (b.type === 'parent') return createParent(me.uid, b);
  throw bad('Unsupported request.');
});

/** Admin edits a student's details. */
exports.updateStudent = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const id = String(b.user_id || '');
  const ref = db.doc(`users/${id}`); const s = await ref.get();
  if (!s.exists || s.get('role') !== 'student') throw new HttpsError('not-found', 'Student not found.');
  const full_name = str(b.full_name, 'Name', { min: 1, max: 120 });
  const roll = b.roll_number ? String(b.roll_number).trim() : null;
  if (roll && !/^\d{1,3}$/.test(roll)) throw bad('Roll number must be a number.');
  await ref.update({
    full_name, 'student.roll_number': roll, 'student.phone': str(b.phone, 'Phone', { max: 20 }), 'student.father_name': str(b.father_name, 'Father name', { max: 120 }),
    'student.mother_name': str(b.mother_name, 'Mother name', { max: 120 }), 'student.dob': isoDate(b.dob, 'Date of birth'),
    'student.gender': ['Male', 'Female'].includes(b.gender) ? b.gender : null, 'student.address': str(b.address, 'Address', { max: 300 }) });
  await auth.updateUser(id, { displayName: full_name });
  const en = await db.collection(`users/${id}/enrollments`).where('status', '==', 'active').get();
  const batch = db.batch(); en.forEach(d => batch.update(d.ref, { roll_number: roll })); if (!en.empty) await batch.commit();
  await audit(me.uid, 'student_updated', id, null);
  return { ok: true };
});

/** Admin edits a teacher's details (name, phone, qualification, subjects, address). */
exports.updateTeacher = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const id = String(b.user_id || '');
  const ref = db.doc(`users/${id}`); const s = await ref.get();
  if (!s.exists || s.get('role') !== 'teacher') throw new HttpsError('not-found', 'Teacher not found.');
  const full_name = str(b.full_name, 'Name', { min: 1, max: 120 });
  await ref.update({ full_name, 'teacher.phone': str(b.phone, 'Phone', { max: 20 }), 'teacher.qualification': str(b.qualification, 'Qualification', { max: 200 }),
    'teacher.subjects': str(b.subjects, 'Subjects', { max: 200 }), 'teacher.address': str(b.address, 'Address', { max: 300 }) });
  await auth.updateUser(id, { displayName: full_name });
  await audit(me.uid, 'teacher_updated', id, null);
  return { ok: true };
});

/** Profile photo. A person may set their own; admin may set anyone's. The path is fixed to "<uid>.jpg" so nobody can point at another file. */
exports.setProfilePhoto = onCall(callOpts, async request => {
  const me = await requireSession(request);
  const b = request.data || {};
  const target = b.user_id ? String(b.user_id) : me.uid;
  if (target !== me.uid && me.role !== 'admin') throw new HttpsError('permission-denied', 'You cannot change this photo.');
  const ref = db.doc(`users/${target}`); const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Account not found.');
  const path = `${target}.jpg`;
  await ref.update({ photo_path: path, photo_version: Date.now() });
  return { ok: true, photo_path: path };
});

/** Student's own goal & dedication message (max 300 characters). */
exports.setMyGoal = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student']);
  const text = String((request.data && request.data.text) || '').slice(0, 300);
  await db.doc(`users/${me.uid}`).update({ 'student.goal_message': text });
  return { ok: true };
});
