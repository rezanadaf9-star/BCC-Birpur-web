'use strict';
// Executes the Cloud Functions' business logic against an in-memory fake (no network). Run:  node tests/local/run.js
// Covers sessions, account creation, marks/ranks/results, attendance, fees, quizzes, reminders. Prints a result per scenario.
const assert = require('assert');
const F = require('./fake-firebase').install();
const path = '../../functions/lib/';
const S = require(path + 'sessions'), U = require(path + 'users'), E = require(path + 'exams'), A = require(path + 'attendance'), FE = require(path + 'fees'), Q = require(path + 'quizzes'), C = require(path + 'content'), CL = require(path + 'classes'), M = require(path + 'meetings'), AN = require(path + 'notifications');
const { db } = F;
F.store.indexCheck = true;     // every query made by the functions must be covered by firestore.indexes.json
const results = [];
async function t(feature, scenario, expected, fn) { let actual = 'ok', pass = true; try { const r = await fn(); if (typeof r === 'string') actual = r; } catch (e) { pass = false; actual = 'FAILED: ' + e.message; } results.push({ feature, scenario, expected, actual, pass }); }
const rejects = async (p, code) => { try { await p; } catch (e) { if (code && e.code !== code) throw new Error(`expected ${code}, got ${e.code}: ${e.message}`); return e.message; } throw new Error('expected an error but the call succeeded'); };
const req = (uid, role, data, extra = {}) => ({ auth: { uid, token: { role, bsid: 'b-' + uid, ...extra } }, data });
const session = async uid => db.doc(`users/${uid}/sessions/b-${uid}`).set({ platform: 'web', revoked_at: null });
const IST_TODAY = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

(async () => {
  // ---------- base data ----------
  await db.doc('academic_sessions/s1').set({ label: '2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31', is_current: true });
  await db.doc('classes/10').set({ class_no: 10, label: 'Class 10', is_active: true, features: { quizzes: true } });
  await db.doc('classes/12').set({ class_no: 12, label: 'Class 12', is_active: true, features: { quizzes: true } });
  [[90, 100.01, 'A+'], [80, 90, 'A'], [60, 80, 'B'], [45, 60, 'D'], [0, 45, 'F']].forEach(([min_pct, max_pct, grade], i) => db.doc('grade_rules/g' + i).set({ min_pct, max_pct, grade, remark: grade }));
  await db.doc('users/adm').set({ role: 'admin', full_name: 'Admin', login_id: 'a@b.c', is_active: true }); await session('adm');
  const ADM = (d) => req('adm', 'admin', d);
  await db.doc('users/tea').set({ role: 'teacher', full_name: 'Teacher', is_active: true, teacher: { assignments: [{ class_no: 10, can_declare_results: false }] } }); await session('tea');
  const TEA = d => req('tea', 'teacher', d, { classes: [10] });
  const stu = async (uid, name, cls, roll) => { await db.doc('users/' + uid).set({ role: 'student', full_name: name, login_id: 'L' + uid, is_active: true, student: { class_no: cls, roll_number: roll, status: 'active', father_name: 'F' + name } });
    await db.doc(`users/${uid}/enrollments/s1`).set({ session_id: 's1', class_no: cls, roll_number: roll, status: 'active' }); await session(uid); };
  for (const [u, n, r] of [['sA', 'Asha', '01'], ['sB', 'Bilal', '02'], ['sC', 'Chandni', '03'], ['sD', 'Deepak', '04']]) await stu(u, n, 10, r);
  await stu('s12', 'TwelfthStudent', 12, '01');
  const STU = (u, cls = 10) => req(u, 'student', {}, { classNo: cls });
  const withData = (r, d) => ({ ...r, data: d });
  for (const [id, name] of [['maths', 'Maths'], ['sci', 'Science'], ['urdu', 'Urdu']]) await db.doc('subjects/' + id).set({ class_no: 10, name });

  // ---------- sessions ----------
  await db.doc('users/su').set({ role: 'student', full_name: 'S', is_active: true, student: { class_no: 10 } });
  const reg = async (plat) => S.registerSession({ auth: { uid: 'su', token: { role: 'student' } }, data: { platform: plat, deviceLabel: 'x' } });
  const r1 = await reg('web'), r2 = await reg('web'), r3 = await reg('web');
  await t('Device sessions', 'Three web logins by one student', 'first two allowed, third replaces the oldest', async () => { assert.deepEqual([r1.replaced_sessions, r2.replaced_sessions, r3.replaced_sessions], [0, 0, 1]);
    const act = (await db.collection('users/su/sessions').where('revoked_at', '==', null).get()).docs; assert.equal(act.length, 2); assert.ok((await db.doc(`users/su/sessions/${r1.sessionId}`).get()).get('revoked_at')); return 'oldest revoked, 2 active'; });
  await t('Device sessions', 'App logins counted separately from web', 'two app logins add no replacement', async () => { const a = await reg('android'), b = await reg('android'); assert.equal(a.replaced_sessions + b.replaced_sessions, 0); });
  await t('Device sessions', 'Session token carries role + session id', 'custom token includes bsid and role', async () => { const c = JSON.parse(r3.customToken.slice(6)).claims; assert.equal(c.role, 'student'); assert.ok(c.bsid); });
  await t('Device sessions', 'Paused account / unknown platform', 'both refused', async () => { await db.doc('users/su').update({ is_active: false }); await rejects(reg('web'), 'permission-denied'); await db.doc('users/su').update({ is_active: true }); await rejects(reg('tv'), 'invalid-argument'); });
  await t('Device sessions', 'Privileged call without a registered session', 'unauthenticated', () => rejects(U.adminUsers({ auth: { uid: 'adm', token: { role: 'admin' } }, data: {} }), 'unauthenticated'));
  await t('Device sessions', 'Revoked session cannot call functions', 'unauthenticated', async () => { await db.doc('users/adm/sessions/b-adm').update({ revoked_at: 'x' }); await rejects(U.adminUsers(ADM({ type: 'student' })), 'unauthenticated'); await db.doc('users/adm/sessions/b-adm').update({ revoked_at: null }); });

  // ---------- accounts ----------
  let created;
  await t('Accounts', 'Admin creates a student', 'next free roll (05 after 01-04): ID 26BCC1005, claims set, enrollment created', async () => { created = await U.adminUsers(ADM({ type: 'student', full_name: 'New Kid', class_no: 10, password: 'abcdefgh' }));
    assert.equal(created.login_id, '26BCC1005'); assert.match(created.admission_no, /^BCC\/\d\d\/0001$/); const c = (await F.authApi.getUser(created.user_id)).customClaims; assert.deepEqual([c.role, c.classNo], ['student', 10]); assert.equal((await db.collection(`users/${created.user_id}/enrollments`).get()).size, 1); });
  await t('Accounts', 'Student tries to create an account', 'permission-denied', () => rejects(U.adminUsers(req('sA', 'student', { type: 'student', full_name: 'X', class_no: 10, password: 'abcdefgh' })), 'permission-denied'));
  await t('Accounts', 'Short password / inactive class', 'both refused', async () => { await rejects(U.adminUsers(ADM({ type: 'student', full_name: 'X', class_no: 10, password: 'short' }))); await db.doc('classes/9').set({ class_no: 9, is_active: false }); await rejects(U.adminUsers(ADM({ type: 'student', full_name: 'X', class_no: 9, password: 'abcdefgh' })), 'failed-precondition'); });
  await t('Accounts', 'Same roll number twice in one class and year', 'second attempt already-exists (Student ID is unique)', async () => { await U.adminUsers(ADM({ type: 'student', full_name: 'Seven', class_no: 10, roll_number: '07', password: 'abcdefgh' })); await rejects(U.adminUsers(ADM({ type: 'student', full_name: 'Dup', class_no: 10, roll_number: '07', password: 'abcdefgh' })), 'already-exists'); });
  await t('Accounts', 'Pause a student', 'disabled in Auth, sessions revoked, status paused', async () => { await session(created.user_id); await U.adminUsers(ADM({ action: 'set-status', user_id: created.user_id, is_active: false }));
    assert.equal((await F.authApi.getUser(created.user_id)).disabled, true); assert.equal((await db.doc('users/' + created.user_id).get()).get('student.status'), 'paused'); });
  await t('Accounts', 'Teacher class change forces new sign-in', 'claims updated, sessions revoked', async () => { const tr = await U.adminUsers(ADM({ type: 'teacher', full_name: 'T2', email: 't2@x.in', password: 'abcdefgh', assignments: [{ class_no: 10 }] }));
    const r = await U.adminUsers(ADM({ action: 'set-teacher-classes', user_id: tr.user_id, assignments: [{ class_no: 10 }, { class_no: 12 }] })); assert.equal(r.relogin, true); assert.deepEqual((await F.authApi.getUser(tr.user_id)).customClaims.classes, [10, 12]); });

  // ---------- exams / marks / results ----------
  const ex = await E.createExam(ADM({ class_no: 10, name: 'Half Yearly', subjects: [{ subject_id: 'maths', full_marks: 100 }, { subject_id: 'sci', full_marks: 100 }, { subject_id: 'urdu', full_marks: 50 }] }));
  const mk = (sid, m, u, inc) => ({ student_id: sid, marks: { maths: m[0], sci: m[1], ...(u != null ? { urdu: u } : {}) }, included_subject_ids: inc || null });
  await t('Marks', 'Teacher of the class enters marks', 'saved; status decided by server', async () => { const r = await E.saveExamMarks(TEA({ exam_id: ex.id, rows: [mk('sA', [90, 80], 40), mk('sB', [90, 80], 40), mk('sC', [70, 60], null, ['maths', 'sci']), mk('sD', [50, 50], 20)] })); assert.equal(r.saved, 4);
    assert.equal((await db.doc(`exams/${ex.id}/marks/sC`).get()).get('status'), 'completed'); });
  await t('Marks', 'Marks above full marks / unknown subject', 'rejected', async () => { await rejects(E.saveExamMarks(ADM({ exam_id: ex.id, rows: [mk('sA', [101, 80], 40)] }))); await rejects(E.saveExamMarks(ADM({ exam_id: ex.id, rows: [{ student_id: 'sA', marks: { nope: 5 } }] }))); });
  await t('Marks', 'Draft marks block declaring', 'failed-precondition', async () => { await E.saveExamMarks(ADM({ exam_id: ex.id, rows: [{ student_id: 'sA', marks: { maths: 90 }, included_subject_ids: null }] })); await rejects(E.declareResult(ADM({ exam_id: ex.id, declared: true })), 'failed-precondition'); await E.saveExamMarks(ADM({ exam_id: ex.id, rows: [mk('sA', [90, 80], 40)] })); });
  await t('Results', 'Teacher without declare right', 'permission-denied', () => rejects(E.declareResult(TEA({ exam_id: ex.id, declared: true })), 'permission-denied'));
  await t('Results', 'Admin declares: totals, %, ranks (ties share a rank), Urdu skip', 'A,B rank 1 (84%); C rank 3 on FM 200 (65%); D rank 4', async () => {
    await E.declareResult(ADM({ exam_id: ex.id, declared: true })); const g = async u => (await db.doc('gradesheets/s1_' + u).get()).data().exams[0];
    const [a, b, c, d] = [await g('sA'), await g('sB'), await g('sC'), await g('sD')];
    assert.deepEqual([a.om, a.fm, a.pct, a.rank], [210, 250, 84, 1]); assert.equal(b.rank, 1); assert.deepEqual([c.om, c.fm, c.pct, c.rank], [130, 200, 65, 3]); assert.deepEqual([d.pct, d.rank], [48, 4]);
    return `A ${a.pct}% r${a.rank}, B r${b.rank}, C ${c.pct}% (FM ${c.fm}) r${c.rank}, D ${d.pct}% r${d.rank}`; });
  await t('Results', 'Grade from grading scale', 'A=A, C=B, D=D', async () => { const l = async u => (await db.doc('gradesheets/s1_' + u).get()).get('latest.grade'); assert.deepEqual([await l('sA'), await l('sC'), await l('sD')], ['A', 'B', 'D']); });
  await t('Results', 'Declaring twice does not notify twice', 'one notification', async () => { await E.declareResult(ADM({ exam_id: ex.id, declared: true })); const n = (await db.collection('notifications').where('kind', '==', 'result').get()).docs; assert.equal(n.length, 1); });
  await t('Results', 'Leaderboard document built', 'rows for the declared exam', async () => { const lb = (await db.doc('exam_leaderboards/s1_10').get()).data(); assert.equal(lb.boards[1].exam.length, 4); assert.equal(lb.boards[1].exam[0].rank, 1); });
  await t('Marks', 'Marks locked after declaring', 'failed-precondition', () => rejects(E.saveExamMarks(ADM({ exam_id: ex.id, rows: [mk('sA', [95, 80], 40)] })), 'failed-precondition'));
  await t('Marks', 'Correction needs a reason; recalculates ranks', 'A moves alone to rank 1, B rank 2', async () => { await rejects(E.correctMarks(ADM({ exam_id: ex.id, student_id: 'sA', marks: { maths: 100, sci: 80, urdu: 40 }, reason: '' })));
    await E.correctMarks(ADM({ exam_id: ex.id, student_id: 'sA', marks: { maths: 100, sci: 80, urdu: 40 }, reason: 'recheck' })); const g = async u => (await db.doc('gradesheets/s1_' + u).get()).data().exams[0]; assert.equal((await g('sA')).rank, 1); assert.equal((await g('sB')).rank, 2);
    assert.equal((await db.collection(`exams/${ex.id}/marks_audit`).get()).size, 1); });
  await t('Results', 'Student reads only own report card through the function', 'own card returned', async () => { const r = await E.getGradesheets(req('sB', 'student', {}, { classNo: 10 })); assert.equal(r.sheets.length, 1); assert.equal(r.sheets[0].student.id, 'sB'); });
  await t('Results', 'Teacher of another class cannot print this class', 'permission-denied', () => rejects(E.getGradesheets(req('tea', 'teacher', { class_no: 12 }, { classes: [10] })), 'permission-denied'));

  // ---------- attendance ----------
  const att = (c, d, rows, who = ADM) => A.saveClassAttendance(who({ class_no: c, date: d, rows }));
  await t('Attendance', 'Future date', 'failed-precondition', () => rejects(att(10, '2999-01-01', [{ student_id: 'sA', status: 'present' }]), 'failed-precondition'));
  await t('Attendance', 'Mark a day, then save the same day again', 'one record per class per day; second save replaces', async () => { await att(10, IST_TODAY, [{ student_id: 'sA', status: 'present' }, { student_id: 'sB', status: 'absent' }]);
    await att(10, IST_TODAY, [{ student_id: 'sB', status: 'present' }, { student_id: 'sA', status: null }]); const d = (await db.doc(`attendance/10_${IST_TODAY}`).get()).get('marks'); assert.deepEqual(d, { sB: 'present' });
    assert.equal((await db.collection('attendance').where('class_no', '==', 10).get()).size, 1); });
  await t('Attendance', 'Percentage and low-attendance list', 'B 100%, others 0%; threshold works', async () => { const s = await A.attendanceSummary(req('sB', 'student', {}, { classNo: 10 })); assert.deepEqual([s.working_days, s.present, s.percentage], [1, 1, 100]);
    const low = await A.lowAttendance(ADM({ class_no: 10, threshold: 75 })); assert.ok(low.students.some(x => x.student_id === 'sA')); assert.ok(!low.students.some(x => x.student_id === 'sB')); });
  await t('Attendance', 'Session totals equal the month-by-month count', 'both methods agree, also after an edit', async () => { await att(10, IST_TODAY, [{ student_id: 'sB', status: 'absent' }, { student_id: 'sA', status: 'leave' }]); await att(10, IST_TODAY, [{ student_id: 'sB', status: 'present' }]);
    for (const u of ['sA', 'sB', 'sC']) { const fast = await A.attendanceSummary(req(u, 'student', {}, { classNo: 10 })); const slow = await A.attendanceSummary(req(u, 'student', { from: '2026-04-01', to: IST_TODAY }, { classNo: 10 })); assert.deepEqual(fast, slow, u + ' ' + JSON.stringify([fast, slow])); } });
  await t('Attendance', 'Teacher of another class', 'permission-denied', () => rejects(att(12, IST_TODAY, [{ student_id: 's12', status: 'present' }], TEA), 'permission-denied'));
  await t('Attendance', 'Student cannot see another student\'s attendance', 'permission-denied', () => rejects(A.attendanceSummary(req('sA', 'student', { student_id: 'sB' }, { classNo: 10 })), 'permission-denied'));
  await t('Attendance', 'Notice number is stable', 'same number when printed again', async () => { const ym = IST_TODAY.slice(0, 7); const a = await A.attendanceNotice(ADM({ student: 'sB', month: ym })), b = await A.attendanceNotice(ADM({ student: 'sB', month: ym })); assert.equal(a.report_no, b.report_no); assert.equal(a.summary.present, 1); });

  // ---------- fees ----------
  await FE.saveFeeStructure(ADM({ class_no: 10, category: 'Tuition', amount: 1000, frequency: 'monthly', due_day: 10 })); await FE.saveFeeStructure(ADM({ class_no: 10, category: 'Admission', amount: 500, frequency: 'one_time', due_day: 10 }));
  await t('Fees', 'Duplicate fee name for the class', 'already-exists', () => rejects(FE.saveFeeStructure(ADM({ class_no: 10, category: 'Tuition', amount: 1, frequency: 'monthly' })), 'already-exists'));
  let n1, n2;
  await t('Fees', 'Generate month twice', 'first creates dues, second creates none', async () => { n1 = (await FE.generateInvoices(ADM({ class_no: 10, period: '2026-11' }))).created; n2 = (await FE.generateInvoices(ADM({ class_no: 10, period: '2026-11' }))).created; assert.equal(n2, 0); assert.ok(n1 >= 8); return `${n1} then ${n2}`; });
  await t('Fees', 'One-time fee is not billed again next month', 'no second Admission fee', async () => { await FE.generateInvoices(ADM({ class_no: 10, period: '2026-12' })); const adm = (await db.collection('fee_invoices').where('student_id', '==', 'sA').where('category', '==', 'Admission').get()).size; assert.equal(adm, 1); });
  await t('Fees', 'Partial payment', 'balance reduces, receipt R-1001', async () => { const p = await FE.recordFeePayment(ADM({ student_id: 'sA', period: '2026-11', method: 'cash', items: [{ category: 'Tuition', amount: 400 }] })); assert.equal(p.receipt_no, 'R-1001');
    assert.equal((await db.doc('fee_invoices/sA_2026-11_tuition').get()).get('paid'), 400); });
  await t('Fees', 'Payment above what is due', 'failed-precondition, nothing changed', async () => { await rejects(FE.recordFeePayment(ADM({ student_id: 'sA', period: '2026-11', method: 'cash', items: [{ category: 'Tuition', amount: 700 }] })), 'failed-precondition'); assert.equal((await db.doc('fee_invoices/sA_2026-11_tuition').get()).get('paid'), 400); });
  await t('Fees', 'All-or-nothing: one bad line cancels the whole payment', 'no partial write', async () => { await rejects(FE.recordFeePayment(ADM({ student_id: 'sA', period: '2026-11', method: 'upi', items: [{ category: 'Tuition', amount: 100 }, { category: 'Admission', amount: 99999 }] }))); assert.equal((await db.doc('fee_invoices/sA_2026-11_tuition').get()).get('paid'), 400); assert.equal((await db.doc('counters/receipt').get()).get('n'), 1001); });
  await t('Fees', 'Second payment gets the next receipt number', 'R-1002', async () => { const p = await FE.recordFeePayment(ADM({ student_id: 'sA', period: '2026-11', method: 'upi', items: [{ category: 'Tuition', amount: 600 }] })); assert.equal(p.receipt_no, 'R-1002'); });
  await t('Fees', 'Discount lower than what was paid', 'failed-precondition', () => rejects(FE.adjustInvoice(ADM({ invoice_id: 'sA_2026-11_tuition', adjustment: -100 })), 'failed-precondition'));
  await t('Fees', 'Running totals', 'billed and paid totals match the ledger', async () => { const s = (await db.doc('stats/fees').get()).data(); assert.equal(s.paid, 1000); assert.ok(s.billed > 0); });
  await t('Fees', 'Receipt lines', 'tuition fully paid, due 0', async () => { const r = await FE.getFeeReceipts(req('sA', 'student', { period: '2026-11' }, { classNo: 10 })); const l = r.receipts[0].lines.find(x => x.name === 'Tuition'); assert.deepEqual([l.fee, l.paid, l.due], [1000, 1000, 0]); });
  await t('Fees', 'Student cannot record a payment', 'permission-denied', () => rejects(FE.recordFeePayment(req('sA', 'student', { student_id: 'sA', period: '2026-11', method: 'cash', items: [{ category: 'Tuition', amount: 1 }] }, { classNo: 10 })), 'permission-denied'));

  // ---------- quizzes ----------
  const qz = await Q.createQuiz(ADM({ class_no: 10, title: 'Weekly 1', quiz_type: 'Weekly', duration_minutes: 30, language_mode: 'en' }));
  for (const [k, c] of [['q1', 'A'], ['q2', 'B'], ['q3', 'C']]) await Q.saveQuestion(ADM({ quiz_id: qz.id, question_text: k, option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: c }));
  await Q.updateQuiz(ADM({ id: qz.id, title: 'Weekly 1', quiz_type: 'Weekly', duration_minutes: 30, language_mode: 'en', correct_marks: 4, wrong_marks: 1 }));
  let st;
  await t('Quizzes', 'Total marks follow questions and marking scheme', '3 questions x 4 = 12', async () => assert.equal((await db.doc('quizzes/' + qz.id).get()).get('total_marks'), 12));
  await t('Quizzes', 'Start returns questions WITHOUT answers', 'no correct_option / explanation', async () => { st = await Q.startQuiz(req('sA', 'student', { quiz_id: qz.id }, { classNo: 10 })); assert.equal(st.questions.length, 3); assert.ok(st.questions.every(q => !('correct_option' in q) && !('explanation' in q))); });
  await t('Quizzes', 'Class 10 quiz is closed to class 12', 'permission-denied', () => rejects(Q.startQuiz(req('s12', 'student', { quiz_id: qz.id }, { classNo: 12 })), 'permission-denied'));
  const qids = st.questions.map(q => q.id);
  await t('Quizzes', 'Server scores: 2 right, 1 wrong with −1', 'score 7 (2×4 − 1)', async () => { const [a, b, c] = (await db.collection(`quizzes/${qz.id}/questions`).orderBy('position').get()).docs.map(d => d.id);
    const r = await Q.submitQuiz(req('sA', 'student', { quiz_id: qz.id, answers: { [a]: 'A', [b]: 'B', [c]: 'D' }, submission_reason: 'manual' }, { classNo: 10 })); assert.equal(r.attempt.score, 7); assert.deepEqual([r.attempt.correct_count, r.attempt.wrong_count], [2, 1]); });
  await t('Quizzes', 'Second submission / restart', 'both refused', async () => { await rejects(Q.submitQuiz(req('sA', 'student', { quiz_id: qz.id, answers: {} }, { classNo: 10 })), 'failed-precondition'); await rejects(Q.startQuiz(req('sA', 'student', { quiz_id: qz.id }, { classNo: 10 })), 'failed-precondition'); });
  await t('Quizzes', 'Browser cannot choose its own score', 'extra fields ignored; score comes from answers', async () => { await Q.startQuiz(req('sB', 'student', { quiz_id: qz.id }, { classNo: 10 })); const r = await Q.submitQuiz(req('sB', 'student', { quiz_id: qz.id, answers: {}, score: 999, total_marks: 999 }, { classNo: 10 })); assert.equal(r.attempt.score, 0); });
  await t('Quizzes', 'Late manual submission (after expiry + grace)', 'failed-precondition', async () => { await Q.startQuiz(req('sC', 'student', { quiz_id: qz.id }, { classNo: 10 })); await db.doc(`quiz_sessions/${qz.id}_sC`).update({ expires_at: new Date(Date.now() - 60000).toISOString() }); await rejects(Q.submitQuiz(req('sC', 'student', { quiz_id: qz.id, answers: {} }, { classNo: 10 })), 'failed-precondition'); });
  await t('Quizzes', 'Tab-switch submission is recorded with its reason', 'submission_reason tab-switch', async () => { await Q.startQuiz(req('sD', 'student', { quiz_id: qz.id }, { classNo: 10 })); await Q.submitQuiz(req('sD', 'student', { quiz_id: qz.id, answers: {}, submission_reason: 'tab-switch' }, { classNo: 10 })); assert.equal((await db.doc(`quizzes/${qz.id}/attempts/sD`).get()).get('submission_reason'), 'tab-switch'); });
  await t('Leaderboards', 'Quiz + cumulative boards built once from markers', 'A first (7), ranks shared on equal score', async () => { await Q.processQuizBoards(); const qb = (await db.doc('quiz_boards/' + qz.id).get()).data(); assert.equal(qb.rows[0].student_id, 'sA'); assert.equal(qb.rows[1].rank, 2); assert.equal(qb.rows[1].rank, qb.rows[2].rank);
    const cb = (await db.doc('class_boards/10').get()).data(); assert.equal(cb.rows[0].student_id, 'sA'); assert.equal((await db.collection('quiz_dirty').get()).size, 0); });
  await t('Quizzes', 'Student result with explanations after submission', 'correct answers revealed only now', async () => { const r = await Q.getAttemptResult(req('sA', 'student', { quiz_id: qz.id }, { classNo: 10 })); assert.ok(r.questions.every(q => q.correct_option)); });

  // ---------- lectures / reminders / meetings ----------
  await db.doc('lectures/L1').set({ class_no: 10, subject_id: 'maths', title: 'Live Algebra', live_status: 'scheduled', reminder_10_sent_at: null, scheduled_at: new Date(Date.now() + 5 * 60e3).toISOString() });
  await t('Notifications', '10-minute reminder runs twice', 'exactly ONE notification', async () => { await C.processLectureReminders(); await C.processLectureReminders(); const n = (await db.collection('notifications').where('ref_id', '==', 'L1').get()).docs.filter(d => /starts in 10/.test(d.get('title'))); assert.equal(n.length, 1); });
  await t('Notifications', '"Go live" pressed twice', 'exactly ONE live notification, push sent once', async () => { const before = F.pushed.length; await C.lectureSetStatus(ADM({ id: 'L1', status: 'live' })); await C.lectureSetStatus(ADM({ id: 'L1', status: 'live' })); const n = (await db.collection('notifications').where('kind', '==', 'live').get()).docs.length; assert.equal(n, 1); assert.equal(F.pushed.length - before, 1); });
  await t('Content', 'Drive / OneDrive share links accepted; wrong site rejected; video upload not offered', 'links saved, bad link refused, lecture upload refused', async () => {
    const lec = await C.saveContent(ADM({ type: 'lectures', class_no: 10, subject_id: 'maths', title: 'Drive lecture', source: 'gdrive', link_url: 'https://drive.google.com/file/d/ABCDEFGHIJK12/view', downloadable: true })); assert.equal((await db.doc('lectures/' + lec.id).get()).get('source_type'), 'gdrive');
    const nt = await C.saveContent(TEA({ type: 'notes', class_no: 10, subject_id: 'maths', title: 'OD note', source: 'onedrive', link_url: 'https://1drv.ms/b/s!abc' })); assert.equal((await db.doc('notes/' + nt.id).get()).get('file_type'), 'link');
    await rejects(C.saveContent(ADM({ type: 'notes', class_no: 10, subject_id: 'maths', title: 'bad', source: 'gdrive', link_url: 'https://example.com/x.pdf' })), 'invalid-argument');
    await rejects(C.saveContent(ADM({ type: 'lectures', class_no: 10, subject_id: 'maths', title: 'vid', source: 'upload', file_path: 'lectures/10/x.mp4' })), 'invalid-argument'); });
  await t('Meetings', 'Create for selected students; room name hidden', 'room stored apart; only invited student can join when live', async () => { const m = await M.createMeeting(ADM({ kind: 'ptm', title: 'PTM', audience: 'students', students: ['sA'], live: true }));
    assert.ok(!('room_name' in (await db.doc('meetings/' + m.id).get()).data())); const j = await M.joinMeeting(req('sA', 'student', { id: m.id }, { classNo: 10 })); assert.match(j.room, /^BCC-/); await rejects(M.joinMeeting(req('sB', 'student', { id: m.id }, { classNo: 10 })), 'permission-denied'); });
  await t('Super 15', 'Paused member cannot post, join or list; active member can', 'refused for paused, allowed for active', async () => {
    const CO = require(path + 'community'); await db.doc('super15_members/sA').set({ is_active: true }); await db.doc('super15_members/sB').set({ is_active: false });
    await CO.postDiscussionMessage(req('sA', 'student', { scope: 'super15', body: 'hello' }, { classNo: 10 })); await rejects(CO.postDiscussionMessage(req('sB', 'student', { scope: 'super15', body: 'hello' }, { classNo: 10 })), 'permission-denied');
    const m = await M.createMeeting(ADM({ kind: 'super15', title: 'S15 live', audience: 'classes', live: true }));
    await M.joinMeeting(req('sA', 'student', { id: m.id }, { classNo: 10 })); await rejects(M.joinMeeting(req('sB', 'student', { id: m.id }, { classNo: 10 })), 'permission-denied');
    assert.equal((await M.myMeetings(req('sB', 'student', { kind: 'super15' }, { classNo: 10 }))).meetings.length, 0); assert.equal((await M.myMeetings(req('sA', 'student', { kind: 'super15' }, { classNo: 10 }))).meetings.length, 1); });
  await t('Quizzes', 'Quiz with more than 150 questions refused; edits refresh what students receive', 'cap enforced; edited question served', async () => {
    const q3 = await Q.createQuiz(ADM({ class_no: 10, title: 'Cap', quiz_type: 'Weekly', duration_minutes: 5, language_mode: 'en' })); const mk = n => Array.from({ length: n }, (_, i) => ({ question_text: 'q' + i, option_a: 'a', option_b: 'b', correct_option: 'A' }));
    await Q.importQuestions(ADM({ quiz_id: q3.id, rows: mk(150) })); await rejects(Q.saveQuestion(ADM({ quiz_id: q3.id, question_text: 'x', option_a: 'a', option_b: 'b', correct_option: 'A' })), 'failed-precondition');
    const first = (await db.collection(`quizzes/${q3.id}/questions`).orderBy('position').limit(1).get()).docs[0]; await Q._rebuildPack(q3.id); await Q.saveQuestion(ADM({ quiz_id: q3.id, id: first.id, question_text: 'EDITED', option_a: 'a', option_b: 'b', correct_option: 'B' }));
    const st = await Q.startQuiz(req('sA', 'student', { quiz_id: q3.id }, { classNo: 10 })); assert.equal(st.questions[0].question_text, 'EDITED'); assert.ok(!('correct_option' in st.questions[0])); });
  await t('Notifications', 'Mark all as read stores one timestamp', 'last_notif_seen_at set', async () => { await AN.markNotificationsSeen(req('sA', 'student', {}, { classNo: 10 })); assert.ok((await db.doc('users/sA').get()).get('last_notif_seen_at')); });

  // ---------- report ----------
  const pass = results.filter(r => r.pass).length;
  console.log(`\nLOCAL LOGIC TESTS: ${pass}/${results.length} passed\n`);
  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.feature} | ${r.scenario} | expected: ${r.expected} | actual: ${r.actual}`));
  require('fs').writeFileSync(__dirname + '/results.json', JSON.stringify(results, null, 1));
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
