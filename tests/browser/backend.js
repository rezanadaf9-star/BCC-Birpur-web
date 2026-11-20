'use strict';
// Local test backend: the project's REAL Cloud Function code running on an in-memory database (no Firebase, no rules). Used by the browser tests.
const path = require('path');
const F = require('../local/fake-firebase').install();
F.store.indexCheck = true;                                    // every query from pages AND functions must be covered by firestore.indexes.json
const fns = require('../../functions/index.js');
const { db, authApi, users } = F;
const IST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const tokens = new Map(); let tn = 0;
const mint = (uid, extra) => { const t = 'T' + (++tn) + '.' + Math.random().toString(36).slice(2); tokens.set(t, { uid, claims: { ...(users.get(uid).customClaims || {}), ...(extra || {}) } }); return t; };
const reqOf = (token, data) => { const t = tokens.get(token); return { auth: t ? { uid: t.uid, token: t.claims } : null, data }; };
async function session(uid, bsid) { await db.doc(`users/${uid}/sessions/${bsid}`).set({ platform: 'web', created_at: new Date().toISOString(), revoked_at: null }); }
async function asAdmin(name, data) { return fns[name]({ auth: { uid: SEED.admin, token: { role: 'admin', bsid: 'seed' } }, data }); }
const SEED = {};
async function seed() {
  const now = new Date().toISOString();
  await db.doc('academic_sessions/s1').set({ label: '2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31', is_current: true });
  const FEAT = ['lectures', 'notes', 'homework', 'marks', 'attendance', 'quizzes', 'quiz_leaderboard', 'results', 'fees', 'timetable', 'answer_sheets', 'announcements', 'ptm', 'ai_tutor', 'ai_study_hub', 'motivational', 'alumni', 'group_discussion'];
  for (const [no, label] of [[-3, 'Nursery'], [-2, 'LKG'], [-1, 'UKG'], ...Array.from({ length: 12 }, (_, i) => [i + 1, 'Class ' + (i + 1)])]) { const features = {}; FEAT.forEach(k => { features[k] = true; }); await db.doc(`classes/${no}`).set({ class_no: no, label, sort_order: no + 4, is_active: no === 10 || no === 12, features, created_at: now }); }
  [[90, 100.01, 'A+'], [80, 90, 'A'], [60, 80, 'B'], [45, 60, 'D'], [0, 45, 'F']].forEach(([a, b, g], i) => db.doc('grade_rules/g' + i).set({ min_pct: a, max_pct: b, grade: g, remark: 'Remark ' + g }));
  const adm = await authApi.createUser({ email: 'admin@bcc.test', password: 'AdminPass1', displayName: 'Administrator' }); SEED.admin = adm.uid;
  await authApi.setCustomUserClaims(adm.uid, { role: 'admin' }); await db.doc('users/' + adm.uid).set({ role: 'admin', full_name: 'Administrator', login_id: 'admin@bcc.test', is_active: true, photo_path: null, created_at: now }); await session(adm.uid, 'seed');
  for (const [id, n] of [['maths', 'Mathematics'], ['sci', 'Science']]) await db.doc('subjects/' + id).set({ class_no: 10, name: n, created_at: now });
  await db.doc('subjects/s12').set({ class_no: 12, name: 'Physics', created_at: now });
  const T = await asAdmin('adminUsers', { type: 'teacher', full_name: 'Teacher One', email: 'teacher@bcc.test', password: 'TeacherPass1', assignments: [{ class_no: 10, is_class_teacher: true, can_declare_results: true }] }); SEED.teacher = T.user_id;
  SEED.students = [];
  for (const n of ['Asha Kumari', 'Bilal Ahmad', 'Chandni Parveen']) { const r = await asAdmin('adminUsers', { type: 'student', full_name: n, class_no: 10, password: 'StudentPass1', father_name: 'Father of ' + n, phone: '9000000000' }); SEED.students.push(r); }
  const r12 = await asAdmin('adminUsers', { type: 'student', full_name: 'Twelfth Student', class_no: 12, password: 'StudentPass1' }); SEED.student12 = r12;
  SEED.ids = SEED.students.map(s => s.user_id);
  const ex = await asAdmin('createExam', { class_no: 10, name: 'Half Yearly', date: IST, upto: IST, subjects: [{ subject_id: 'maths', full_marks: 100 }, { subject_id: 'sci', full_marks: 100 }] }); SEED.exam = ex.id;
  await asAdmin('saveExamMarks', { exam_id: ex.id, rows: SEED.ids.map((id, i) => ({ student_id: id, marks: { maths: 90 - i * 10, sci: 80 - i * 5 }, included_subject_ids: null })) });
  await asAdmin('declareResult', { exam_id: ex.id, declared: true });
  await asAdmin('saveClassAttendance', { class_no: 10, date: IST, rows: SEED.ids.map((id, i) => ({ student_id: id, status: i === 2 ? 'absent' : 'present' })) });
  await asAdmin('saveFeeStructure', { class_no: 10, category: 'Tuition', amount: 1000, frequency: 'monthly', due_day: 10 });
  await asAdmin('generateInvoices', { class_no: 10, period: IST.slice(0, 7) });
  await asAdmin('recordFeePayment', { student_id: SEED.ids[0], period: IST.slice(0, 7), method: 'cash', items: [{ category: 'Tuition', amount: 400 }] });
  await asAdmin('saveContent', { type: 'lectures', class_no: 10, subject_id: 'maths', title: 'Algebra Basics', source: 'youtube', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  await asAdmin('saveContent', { type: 'lectures', class_no: 10, subject_id: 'sci', title: 'Live Physics Doubt Class', source: 'live', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', scheduled_at: new Date(Date.now() + 3600e3).toISOString() });
  await asAdmin('saveContent', { type: 'notes', class_no: 10, subject_id: 'maths', title: 'Algebra Notes (Drive)', source: 'gdrive', link_url: 'https://drive.google.com/file/d/ABCDEFGHIJK12/view' });
  await asAdmin('saveContent', { type: 'homework', class_no: 10, subject_id: 'maths', title: 'Exercise 4.1', source: 'onedrive', link_url: 'https://1drv.ms/b/s!abc', instructions: 'Do all questions', due_date: IST });
  const q = await asAdmin('createQuiz', { class_no: 10, title: 'Weekly Quiz 1', quiz_type: 'Weekly', duration_minutes: 30, language_mode: 'en', subject_id: 'maths' }); SEED.quiz = q.id;
  for (const [t, c] of [['2+2 = ?', 'B'], ['3x3 = ?', 'C'], ['10-5 = ?', 'A']]) await asAdmin('saveQuestion', { quiz_id: q.id, question_text: t, option_a: '5', option_b: '4', option_c: '9', option_d: '0', correct_option: c, explanation: 'Because maths.' });
  await asAdmin('saveAnnouncement', { title: 'Welcome back', headline: 'New session', body: 'Classes start Monday.', accent: 'navy', target_class: null });
  await fns.processAnnouncements();
  await db.doc('class_timetable/t1').set({ class_no: 10, day_of_week: 1, start_time: '09:00', end_time: '10:00', subject_name: 'Mathematics', teacher_name: 'Teacher One', room: '1' });
  await db.doc('alumni/a1').set({ name: 'Old Boy', batch_year: 2020, current_status: 'Engineer', message: 'Hello', is_published: true, created_at: now });
  await db.doc('site_toppers/tp1').set({ name: 'Topper', level: 'matric', marks: 480, full_marks: 500, batch_year: 2025, is_published: true, created_at: now });
  await db.doc('notebooklm_resources/n1').set({ class_no: 10, title: 'Study Link', url: 'https://notebooklm.google.com/x', resource_type: 'notes', is_active: true, created_by: SEED.admin, created_at: now });
  await db.doc(`super15_members/${SEED.ids[0]}`).set({ student_id: SEED.ids[0], is_active: true, name: 'Asha Kumari', class_no: 10, roll: '01', added_at: now });
  await db.doc('super15_materials/m1').set({ kind: 'material', title: 'Super notes', url: 'https://example.com/x', created_at: now });
  await asAdmin('postDiscussionMessage', { scope: 'class', class_no: 10, body: 'Welcome to the class chat' });
  await asAdmin('createMeeting', { kind: 'ptm', title: 'PTM Class 10', audience: 'classes', classes: [10], live: false, start: new Date(Date.now() + 86400e3).toISOString() });
  await db.doc(`centre_holidays/${IST}`).set({ hday: IST, title: 'Test holiday' });
  await fns.processQuizBoards();
  const faculty = [['Mr. A', 'A Sir', 'Director', 'Physics']]; for (const [name, short_name, designation, subjects] of faculty) await db.doc('site_faculty/f1').set({ name, short_name, designation, subjects, classes_text: 'Classes 9-10', photo_path: 'images/rehan-sir.png', position: 1, is_published: true, created_at: now });
  SEED.ready = true;
}
module.exports = { F, fns, tokens, mint, reqOf, seed, SEED, db, authApi, users };
