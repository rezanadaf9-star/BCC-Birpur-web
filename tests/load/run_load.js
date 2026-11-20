'use strict';
// Load simulation of the project's REAL Cloud Function code on an in-memory database. Usage: node run_load.js <students>
// WHAT THIS MEASURES: CPU time and number of Firestore reads/writes each operation needs, for N students acting at the same time.
// WHAT IT DOES NOT MEASURE: real network latency, Cloud Run cold starts/autoscaling, Firestore contention or the 1 write/second-per-document limit.
const N = Number(process.argv[2] || 100);
const FB = require('../local/fake-firebase'); const F = FB.install(); F.store.indexCheck = true;
const E = require('../../functions/lib/exams'), Q = require('../../functions/lib/quizzes'), S = require('../../functions/lib/sessions'), D = require('../../functions/lib/dashboard'), A = require('../../functions/lib/attendance'), FE = require('../../functions/lib/fees'), C = require('../../functions/lib/content');
const { db } = F; const IST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const now = new Date().toISOString();
const ADM = d => ({ auth: { uid: 'adm', token: { role: 'admin', bsid: 'b' } }, data: d });
const stats = {};
async function op(name, fn, bucket = stats) { return FB.als.run({ reads: 0, writes: 0 }, async () => { const t0 = process.hrtime.bigint(); let err = null, out; try { out = await fn(); } catch (e) { err = e; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6, c = FB.als.getStore(), s = bucket[name] || (bucket[name] = { n: 0, err: 0, ms: [], reads: 0, writes: 0, errs: {} });
  s.n++; s.ms.push(ms); s.reads += c.reads; s.writes += c.writes; if (err) { s.err++; s.errs[err.message] = (s.errs[err.message] || 0) + 1; } return out; }); }
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
(async () => {
  await db.doc('academic_sessions/s1').set({ label: '2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31', is_current: true });
  await db.doc('classes/10').set({ class_no: 10, is_active: true, features: { quizzes: true } });
  for (const [id, n] of [['maths', 'Maths'], ['sci', 'Science']]) await db.doc('subjects/' + id).set({ class_no: 10, name: n });
  await db.doc('users/adm').set({ role: 'admin', full_name: 'A', is_active: true }); await db.doc('users/adm/sessions/b').set({ revoked_at: null });
  const ids = [];
  const tSeed = Date.now();
  for (let i = 0; i < N; i++) { const uid = 'u' + i; ids.push(uid); const roll = String(i + 1).padStart(3, '0');
    await db.doc('users/' + uid).set({ role: 'student', full_name: 'Student ' + i, login_id: 'L' + i, is_active: true, student: { class_no: 10, roll_number: roll, status: 'active', father_name: 'F' } });
    await db.doc(`users/${uid}/enrollments/s1`).set({ session_id: 's1', class_no: 10, roll_number: roll, status: 'active' }); }
  // content for the day: exam (2 subjects), declared; 20-question quiz; attendance for 10 days
  const ex = await E.createExam(ADM({ class_no: 10, name: 'Half Yearly', subjects: [{ subject_id: 'maths', full_marks: 100 }, { subject_id: 'sci', full_marks: 100 }] }));
  const rows = ids.map((u, i) => ({ student_id: u, marks: { maths: (i * 7) % 101, sci: (i * 13) % 101 }, included_subject_ids: null }));
  for (let i = 0; i < rows.length; i += 400) await E.saveExamMarks(ADM({ exam_id: ex.id, rows: rows.slice(i, i + 400) }));
  const tDecl = process.hrtime.bigint(); const r0 = F.store.reads, w0 = F.store.writes;
  await E.declareResult(ADM({ exam_id: ex.id, declared: true })); const declMs = Number(process.hrtime.bigint() - tDecl) / 1e6; const declReads = F.store.reads - r0, declWrites = F.store.writes - w0;
  for (let d = 1; d <= 10; d++) { const date = new Date(Date.now() + 5.5 * 3600e3 - d * 864e5).toISOString().slice(0, 10); for (let i = 0; i < ids.length; i += 400) await A.saveClassAttendance(ADM({ class_no: 10, date, rows: ids.slice(i, i + 400).map((u, k) => ({ student_id: u, status: (k + d) % 5 ? 'present' : 'absent' })) })); }
  await FE.saveFeeStructure(ADM({ class_no: 10, category: 'Tuition', amount: 1000, frequency: 'monthly' })); await FE.generateInvoices(ADM({ class_no: 10, period: IST.slice(0, 7) }));
  const qz = await Q.createQuiz(ADM({ class_no: 10, title: 'Load quiz', quiz_type: 'Weekly', duration_minutes: 30, language_mode: 'en' }));
  const imp = Array.from({ length: 20 }, (_, i) => ({ question_text: 'Q' + i, option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: 'ABCD'[i % 4], explanation: 'e' })); await Q.importQuestions(ADM({ quiz_id: qz.id, rows: imp }));
  const setupMs = Date.now() - tSeed;
  // phase 1: one student at a time (clean per-operation CPU time), on a separate quiz and separate students
  const seqStats = {}; const M = Math.min(N, 200); const qz2 = await Q.createQuiz(ADM({ class_no: 10, title: 'Seq quiz', quiz_type: 'Weekly', duration_minutes: 30, language_mode: 'en' })); await Q.importQuestions(ADM({ quiz_id: qz2.id, rows: imp }));
  const flow = async (uid, quizId, bucket) => { const reg = await op('login (registerSession)', () => S.registerSession({ auth: { uid, token: { role: 'student' } }, data: { platform: 'web', deviceLabel: 'x' } }), bucket); if (!reg) return;
    const tok = { role: 'student', classNo: 10, bsid: reg.sessionId }; const R = d => ({ auth: { uid, token: tok }, data: d || {} });
    await op('student dashboard', () => D.studentDashboard(R()), bucket); await op('attendance summary', () => A.attendanceSummary(R()), bucket); await op('own report card', () => E.getGradesheets(R({ class_no: 10 })), bucket);
    const st = await op('quiz start', () => Q.startQuiz(R({ quiz_id: quizId })), bucket); if (!st) return; const ans = Object.fromEntries(st.questions.map((q, i) => [q.id, 'ABCD'[(i + uid.length) % 4]]));
    await op('quiz submit', () => Q.submitQuiz(R({ quiz_id: quizId, answers: ans, submission_reason: 'manual' })), bucket); await op('quiz result', () => Q.getAttemptResult(R({ quiz_id: quizId })), bucket); };
  for (let i = 0; i < M; i++) { const uid = 's' + i; await db.doc('users/' + uid).set({ role: 'student', full_name: 'Sample ' + i, login_id: 'S' + i, is_active: true, student: { class_no: 10, roll_number: String(900 + i), status: 'active', father_name: 'F' } });
    await db.doc(`users/${uid}/enrollments/s1`).set({ session_id: 's1', class_no: 10, roll_number: String(900 + i), status: 'active' }); await flow(uid, qz2.id, seqStats); }
  await Q.processQuizBoards();
  for (let i = 0; i < M; i++) { await db.recursiveDelete(db.doc('users/s' + i)); await db.recursiveDelete(db.doc(`quizzes/${qz2.id}/attempts/s${i}`)); await db.doc(`quiz_totals/10_s${i}`).delete(); }
  F.store.reads = 0; F.store.writes = 0; const mem0 = process.memoryUsage().rss;
  // ---- the rush: every student does their whole flow at the same time
  const tAll = process.hrtime.bigint();
  const flows = ids.map(uid => flow(uid, qz.id, stats));
  await Promise.all(flows); const rushMs = Number(process.hrtime.bigint() - tAll) / 1e6; const rushReads = F.store.reads, rushWrites = F.store.writes;
  const tb = process.hrtime.bigint(), br0 = F.store.reads, bw0 = F.store.writes; await Q.processQuizBoards(); const boardMs = Number(process.hrtime.bigint() - tb) / 1e6, boardReads = F.store.reads - br0, boardWrites = F.store.writes - bw0;
  const dirtyLeft = (await db.collection('quiz_dirty').get()).size; const board = (await db.doc('class_boards/10').get()).data(), qb = (await db.doc('quiz_boards/' + qz.id).get()).data();
  const ops = Object.entries(stats).map(([k, s]) => { const q = seqStats[k] || { ms: [0], n: 1 }; return { op: k, calls: s.n, errors: s.err, errs: s.errs, cpu_ms_p50: +pct(q.ms, .5).toFixed(2), cpu_ms_p95: +pct(q.ms, .95).toFixed(2), cpu_ms_max: +Math.max(...q.ms).toFixed(1), reads_per_call: +(s.reads / s.n).toFixed(1), writes_per_call: +(s.writes / s.n).toFixed(1) }; });
  console.log(JSON.stringify({ students: N, setup_s: +(setupMs / 1000).toFixed(1), rush: { wall_s: +(rushMs / 1000).toFixed(2), reads: rushReads, writes: rushWrites, reads_per_student: +(rushReads / N).toFixed(1), writes_per_student: +(rushWrites / N).toFixed(1) },
    result_declare: { ms: Math.round(declMs), reads: declReads, writes: declWrites }, boards_rebuild: { ms: Math.round(boardMs), reads: boardReads, writes: boardWrites, dirty_left: dirtyLeft, class_board_rows: board.rows.length, quiz_board_rows: qb.rows.length },
    rss_mb: Math.round(process.memoryUsage().rss / 1048576), rss_growth_mb: Math.round((process.memoryUsage().rss - mem0) / 1048576), ops }));
})().catch(e => { console.error('LOAD HARNESS ERROR', e); process.exit(2); });
