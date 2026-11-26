'use strict';
// Quizzes: creation, questions, secure start/submit, history and leaderboards. Scores are computed ONLY here.
//   quizzes/{id}                          meta (students of that class can read; contains no answers)
//   quizzes/{id}/questions/{qid}          question text + CORRECT OPTION (staff only; students get questions without answers from startQuiz)
//   quiz_sessions/{quizId}_{uid}          one session per student per quiz (the id makes a second one impossible); server-side expiry
//   quizzes/{id}/attempts/{uid}           ONE attempt per student per quiz (the id makes a second one impossible); answers inside; history = collection-group query
//   quiz_totals/{classNo}_{uid}           running totals per student (updated with the attempt) for the cumulative board
//   quiz_boards/{quizId}, class_boards/{classNo}   precomputed leaderboards (one read per view)
//   quiz_dirty/{quizId}_{uid}             "rebuild the boards" markers, one per submission (no shared hot document)
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { admin, db, FieldValue, HttpsError, REGION, callOpts, nowIso, int, str, bad, requireSession, audit, notify, classAccess, hotOpts, chunk } = require('./common');
const GRACE_MS = 15000;
const r2 = x => Math.round(x * 100) / 100;
const TYPES = ['Weekly', 'Monthly', 'Chapter-wise'], LANGS = ['both', 'en', 'hi'], OPTS = ['A', 'B', 'C', 'D'];
const iso = (v, label) => { if (v === null || v === undefined || v === '') return null; const t = Date.parse(v); if (Number.isNaN(t)) throw bad(`${label} is not a valid date.`); return new Date(t).toISOString(); };
// ---- quiz pack: ALL questions of a quiz in ONE server-only document, so starting or submitting costs 1 read instead of one per question.
//   quiz_packs/{quizId} = { full: [ {id, position, question_text, option_a..d, correct_option, explanation, *_hi} ], n, updated_at }
const MAX_QUESTIONS = 150, MAX_BOARD_ROWS = 2500, packCache = new Map();
async function rebuildPack(quizId) {
  const qs = (await db.collection(`quizzes/${quizId}/questions`).orderBy('position').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const pack = { full: qs, n: qs.length, updated_at: nowIso() };
  if (JSON.stringify(pack).length > 900000) throw new HttpsError('failed-precondition', 'This quiz is too large. Split it into two quizzes.');
  await db.doc(`quiz_packs/${quizId}`).set(pack); packCache.delete(quizId); return pack;
}
/** Questions of a quiz. Held in the instance's memory for 60 seconds, so 1,000 students starting together cost one read per warm instance. */
async function loadPack(quizId) {
  const hit = packCache.get(quizId); if (hit && Date.now() - hit.at < 60000) return hit.pack;
  const s = await db.doc(`quiz_packs/${quizId}`).get(); const pack = s.exists ? s.data() : await rebuildPack(quizId);
  packCache.set(quizId, { at: Date.now(), pack }); return pack;
}
async function loadQuiz(id) { const ref = db.doc(`quizzes/${String(id || '')}`), s = await ref.get(); if (!s.exists) throw new HttpsError('not-found', 'Quiz not found.'); return { ref, id: s.id, ...s.data() }; }

function cleanQuestion(o) {
  const q = { question_text: str(o.question_text, 'Question', { min: 1, max: 2000 }), option_a: str(o.option_a, 'Option A', { min: 1, max: 500 }), option_b: str(o.option_b, 'Option B', { min: 1, max: 500 }),
    option_c: str(o.option_c, 'Option C', { max: 500 }), option_d: str(o.option_d, 'Option D', { max: 500 }), correct_option: String(o.correct_option || '').toUpperCase(), explanation: str(o.explanation, 'Explanation', { max: 2000 }),
    question_text_hi: str(o.question_text_hi, 'Hindi question', { max: 2000 }), option_a_hi: str(o.option_a_hi, 'Hindi A', { max: 500 }), option_b_hi: str(o.option_b_hi, 'Hindi B', { max: 500 }), option_c_hi: str(o.option_c_hi, 'Hindi C', { max: 500 }), option_d_hi: str(o.option_d_hi, 'Hindi D', { max: 500 }) };
  if (!OPTS.includes(q.correct_option) || !q['option_' + q.correct_option.toLowerCase()]) throw bad('The correct option is empty or invalid.');
  return q;
}

exports.createQuiz = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const b = request.data || {}; const classNo = int(b.class_no, 'Class', { min: -3, max: 12 });
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to create quizzes for this class.');
  const dur = int(b.duration_minutes, 'Duration', { min: 1, max: 600 }); if (!TYPES.includes(b.quiz_type) || !LANGS.includes(b.language_mode)) throw bad('Choose the quiz type and language.');
  let subjectName = null; if (b.subject_id) { const s = await db.doc(`subjects/${String(b.subject_id)}`).get(); if (!s.exists || s.get('class_no') !== classNo) throw bad('Choose a subject of this class.'); subjectName = s.get('name'); }
  const start_at = iso(b.start_at, 'Start'), end_at = iso(b.end_at, 'End'); if (start_at && end_at && end_at <= start_at) throw bad('The end must be after the start.');
  const ref = db.collection('quizzes').doc();
  await ref.set({ class_no: classNo, subject_id: b.subject_id || null, subject_name: subjectName, title: str(b.title, 'Title', { min: 1, max: 160 }), quiz_type: b.quiz_type, duration_minutes: dur, language_mode: b.language_mode,
    start_at, end_at, is_active: b.is_active !== false, correct_marks: 1, wrong_marks: 0, total_marks: 0, question_count: 0, next_position: 1, created_by: me.uid, created_at: nowIso() });
  if (b.is_active !== false) await notify({ classNo, kind: 'quiz', title: `New quiz: ${str(b.title, 'Title', { min: 1, max: 160 })}`, ref_id: ref.id, link: '/student/quizzes.html', dedupe: `quiz_${ref.id}_new`, created_by: me.uid });
  await audit(me.uid, 'quiz_created', ref.id, { classNo }); return { id: ref.id };
});

/** Admin: edit the quiz, including marks per correct answer and the penalty (stored as a positive number; subtracted when scoring). */
exports.updateQuiz = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']); const b = request.data || {}; const q = await loadQuiz(b.id);
  const dur = int(b.duration_minutes, 'Duration', { min: 1, max: 600 }); if (!TYPES.includes(b.quiz_type) || !LANGS.includes(b.language_mode)) throw bad('Choose the quiz type and language.');
  const cm = Number(b.correct_marks), wm = Number(b.wrong_marks); if (!(cm >= 0 && cm <= 100) || !(wm >= 0 && wm <= 100)) throw bad('Marks must be between 0 and 100.');
  let subjectName = null; if (b.subject_id) { const s = await db.doc(`subjects/${String(b.subject_id)}`).get(); if (!s.exists || s.get('class_no') !== q.class_no) throw bad('Choose a subject of this class.'); subjectName = s.get('name'); }
  const start_at = iso(b.start_at, 'Start'), end_at = iso(b.end_at, 'End'); if (start_at && end_at && end_at <= start_at) throw bad('The end must be after the start.');
  await q.ref.update({ title: str(b.title, 'Title', { min: 1, max: 160 }), quiz_type: b.quiz_type, subject_id: b.subject_id || null, subject_name: subjectName, duration_minutes: dur, language_mode: b.language_mode, start_at, end_at,
    correct_marks: cm, wrong_marks: wm, total_marks: r2(cm * (q.question_count || 0)) });
  await audit(me.uid, 'quiz_updated', q.id, null); return { ok: true };
});
exports.setQuizActive = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const q = await loadQuiz(request.data && request.data.id);
  if (!classAccess(me, q.class_no)) throw new HttpsError('permission-denied', 'Not your class.'); await q.ref.update({ is_active: request.data.is_active === true }); return { ok: true };
});
exports.deleteQuiz = onCall({ ...callOpts, timeoutSeconds: 120 }, async request => {
  const me = await requireSession(request, ['admin']); const q = await loadQuiz(request.data && request.data.id);
  const att = await db.collection(`quizzes/${q.id}/attempts`).get(); const batch = db.batch();   // take the scores back out of the running totals
  att.forEach(a => batch.set(db.doc(`quiz_totals/${q.class_no}_${a.id}`), { score_sum: FieldValue.increment(-a.get('score')), total_sum: FieldValue.increment(-a.get('total_marks')), count: FieldValue.increment(-1) }, { merge: true }));
  batch.set(db.doc(`quiz_dirty/${q.id}_class`), { quiz_id: q.id, class_no: q.class_no, class_only: true, at: nowIso() });
  await batch.commit();
  await db.recursiveDelete(q.ref); await db.doc(`quiz_boards/${q.id}`).delete().catch(() => {}); await db.doc(`quiz_packs/${q.id}`).delete().catch(() => {}); packCache.delete(q.id);
  const ses = await db.collection('quiz_sessions').where('quiz_id', '==', q.id).get(); const b2 = db.batch(); ses.forEach(s => b2.delete(s.ref)); await b2.commit();
  await audit(me.uid, 'quiz_deleted', q.id, null); return { ok: true };
});

/** Add / edit a question. Everyone on staff can add (their classes); editing is admin only. total_marks follows automatically. */
exports.saveQuestion = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const b = request.data || {}; const q = await loadQuiz(b.quiz_id);
  if (!classAccess(me, q.class_no)) throw new HttpsError('permission-denied', 'Not your class.');
  const data = cleanQuestion(b); const col = db.collection(`quizzes/${q.id}/questions`);
  if (b.id) { if (me.role !== 'admin') throw new HttpsError('permission-denied', 'Only the admin can edit questions.'); await col.doc(String(b.id)).update(data); await rebuildPack(q.id); return { id: b.id }; }
  if ((q.question_count || 0) >= MAX_QUESTIONS) throw new HttpsError('failed-precondition', `A quiz can have at most ${MAX_QUESTIONS} questions.`);
  const ref = col.doc();
  await db.runTransaction(async tx => { const s = await tx.get(q.ref); const pos = s.get('next_position') || 1, n = (s.get('question_count') || 0) + 1;
    tx.set(ref, { position: pos, ...data }); tx.update(q.ref, { next_position: pos + 1, question_count: n, total_marks: r2(n * s.get('correct_marks')) }); });
  await rebuildPack(q.id); return { id: ref.id };
});
exports.deleteQuestion = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']); const q = await loadQuiz(request.data && request.data.quiz_id); const ref = db.doc(`quizzes/${q.id}/questions/${String(request.data.id || '')}`);
  await db.runTransaction(async tx => { const [s, qq] = await Promise.all([tx.get(ref), tx.get(q.ref)]); if (!s.exists) return; const n = Math.max(0, (qq.get('question_count') || 0) - 1); tx.delete(ref); tx.update(q.ref, { question_count: n, total_marks: r2(n * qq.get('correct_marks')) }); });
  await rebuildPack(q.id); await audit(me.uid, 'question_deleted', q.id, null); return { ok: true };
});
exports.importQuestions = onCall({ ...callOpts, timeoutSeconds: 120 }, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const q = await loadQuiz(request.data && request.data.quiz_id);
  if (!classAccess(me, q.class_no)) throw new HttpsError('permission-denied', 'Not your class.');
  const rows = Array.isArray(request.data.rows) ? request.data.rows : []; if (!rows.length || rows.length > MAX_QUESTIONS) throw bad(`Send between 1 and ${MAX_QUESTIONS} questions.`); if ((q.question_count || 0) + rows.length > MAX_QUESTIONS) throw new HttpsError('failed-precondition', `A quiz can have at most ${MAX_QUESTIONS} questions.`);
  const clean = rows.map((r, i) => { try { return cleanQuestion(r); } catch (e) { throw bad(`Row ${i + 2}: ${e.message}`); } });
  await db.runTransaction(async tx => { const s = await tx.get(q.ref); let pos = s.get('next_position') || 1; const n = (s.get('question_count') || 0) + clean.length;
    clean.forEach(c => tx.set(db.collection(`quizzes/${q.id}/questions`).doc(), { position: pos++, ...c })); tx.update(q.ref, { next_position: pos, question_count: n, total_marks: r2(n * s.get('correct_marks')) }); });
  await rebuildPack(q.id); return { imported: clean.length };
});

/** Start (or resume) a quiz. Returns the questions WITHOUT the correct answers. The server decides when it expires. */
exports.startQuiz = onCall(hotOpts, async request => {
  const me = await requireSession(request, ['student']); const q = await loadQuiz(request.data && request.data.quiz_id);
  if (q.class_no !== me.token.classNo) throw new HttpsError('permission-denied', 'This quiz is not for your class.');
  const cl = await db.doc(`classes/${q.class_no}`).get(); if (!cl.get('features.quizzes')) throw new HttpsError('permission-denied', 'Quizzes are not enabled for your class.');
  if (!q.is_active) throw new HttpsError('failed-precondition', 'This quiz is not active.');
  const now = Date.now(); if (q.start_at && Date.parse(q.start_at) > now) throw new HttpsError('failed-precondition', 'This quiz has not started yet.'); if (q.end_at && Date.parse(q.end_at) < now) throw new HttpsError('failed-precondition', 'This quiz has ended.');
  if ((await db.doc(`quizzes/${q.id}/attempts/${me.uid}`).get()).exists) throw new HttpsError('failed-precondition', 'You have already submitted this quiz.');
  const sRef = db.doc(`quiz_sessions/${q.id}_${me.uid}`);
  const session = await db.runTransaction(async tx => {
    const s = await tx.get(sRef);
    if (s.exists) { const d = s.data();
      if (d.status !== 'in_progress') throw new HttpsError('failed-precondition', 'This quiz session has already been closed.');
      if (Date.parse(d.expires_at) <= now) { tx.update(sRef, { status: 'expired', submitted_at: nowIso(), submission_reason: 'expired' }); return { expired: true }; }
      return d; }
    const durEnd = now + q.duration_minutes * 60e3, exp = q.end_at && Date.parse(q.end_at) < durEnd ? Date.parse(q.end_at) : durEnd;
    const d = { quiz_id: q.id, student_id: me.uid, class_no: q.class_no, started_at: new Date(now).toISOString(), expires_at: new Date(exp).toISOString(), status: 'in_progress', hidden_ms: 0, hidden_count: 0 };
    tx.set(sRef, d); return d; });
  if (session.expired) throw new HttpsError('failed-precondition', 'The quiz time has expired.');
  const qs = (await loadPack(q.id)).full.map(({ correct_option, explanation, ...x }) => ({ quiz_id: q.id, ...x }));
  if (!qs.length) throw new HttpsError('failed-precondition', 'Quiz has no questions.');
  return { ok: true, session_id: `${q.id}_${me.uid}`, started_at: session.started_at, expires_at: session.expires_at, quiz: { title: q.title, language_mode: q.language_mode, correct_marks: q.correct_marks, wrong_marks: q.wrong_marks, total_marks: q.total_marks }, questions: qs };
});

function shapeResult(quizId, attempt, qs) {
  const answers = qs.map(q => { const a = (attempt.answers || {})[q.id] || {}; return { question_id: q.id, selected_option: a.selected_option || null, status: a.status || 'unattempted', marks_awarded: a.marks_awarded || 0 }; });
  return { ok: true, attempt: { id: quizId, quiz_id: quizId, score: attempt.score, total_marks: attempt.total_marks, correct_count: attempt.correct_count, wrong_count: attempt.wrong_count, unattempted_count: attempt.unattempted_count, submitted_at: attempt.submitted_at },
    answers, questions: qs.map(q => ({ id: q.id, position: q.position, question_text: q.question_text, option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d, correct_option: q.correct_option, explanation: q.explanation })) };
}
/** Submit. The browser sends only the chosen options; the server grades them. Late manual submissions are refused (15 s grace for the automatic one). */
exports.submitQuiz = onCall({ ...hotOpts, timeoutSeconds: 60 }, async request => {
  const me = await requireSession(request, ['student']); const b = request.data || {}; const q = await loadQuiz(b.quiz_id);
  if (q.class_no !== me.token.classNo) throw new HttpsError('permission-denied', 'This quiz is not for your class.');
  const sRef = db.doc(`quiz_sessions/${q.id}_${me.uid}`), aRef = db.doc(`quizzes/${q.id}/attempts/${me.uid}`);
  const reason = String(b.submission_reason || 'manual').slice(0, 40); const submitted = b.answers && typeof b.answers === 'object' ? b.answers : {};
  const flags = { hidden_ms: Math.max(0, Math.min(Number(b.hidden_ms) || 0, 6 * 3600e3)), hidden_count: Math.max(0, Math.min(Number(b.hidden_count) || 0, 1000)) };
  const qs = (await loadPack(q.id)).full; if (!qs.length) throw new HttpsError('failed-precondition', 'Quiz has no questions.');
  const stu = await db.doc(`users/${me.uid}`).get();
  const result = await db.runTransaction(async tx => {
    const [s, ex] = await Promise.all([tx.get(sRef), tx.get(aRef)]);
    if (!s.exists) throw new HttpsError('not-found', 'Quiz session not found.');
    if (ex.exists) { tx.update(sRef, { status: 'submitted', submitted_at: nowIso(), submission_reason: reason }); throw new HttpsError('failed-precondition', 'You have already submitted this quiz.'); }
    if (s.get('status') !== 'in_progress') throw new HttpsError('failed-precondition', 'This quiz session has already been submitted.');
    if (Date.now() > Date.parse(s.get('expires_at')) + GRACE_MS) { tx.update(sRef, { status: 'expired', submission_reason: 'expired' }); return { expired: true }; }
    let score = 0, correct = 0, wrong = 0, un = 0; const answers = {};
    for (const x of qs) { const sel = OPTS.includes(String(submitted[x.id] || '').toUpperCase()) ? String(submitted[x.id]).toUpperCase() : null;
      if (!sel) { un++; answers[x.id] = { selected_option: null, status: 'unattempted', marks_awarded: 0 }; }
      else if (sel === x.correct_option) { correct++; score += q.correct_marks; answers[x.id] = { selected_option: sel, status: 'correct', marks_awarded: q.correct_marks }; }
      else { wrong++; score -= q.wrong_marks; answers[x.id] = { selected_option: sel, status: 'wrong', marks_awarded: -q.wrong_marks }; } }
    score = r2(score);
    const attempt = { student_id: me.uid, class_no: q.class_no, quiz_id: q.id, quiz_title: q.title, student_name: stu.get('full_name'), login_id: stu.get('login_id'), photo_path: stu.get('photo_path') || null,
      score, total_marks: q.total_marks, correct_count: correct, wrong_count: wrong, unattempted_count: un, started_at: s.get('started_at'), submitted_at: nowIso(), submission_reason: reason, ...flags, answers };
    tx.set(aRef, attempt);
    tx.update(sRef, { status: 'submitted', submitted_at: attempt.submitted_at, submission_reason: reason, ...flags });
    tx.set(db.doc(`quiz_totals/${q.class_no}_${me.uid}`), { class_no: q.class_no, student_id: me.uid, name: attempt.student_name, login_id: attempt.login_id, photo_path: attempt.photo_path, score_sum: FieldValue.increment(score), total_sum: FieldValue.increment(q.total_marks), count: FieldValue.increment(1) }, { merge: true });
    tx.set(db.doc(`quiz_dirty/${q.id}_${me.uid}`), { quiz_id: q.id, class_no: q.class_no, at: nowIso() });
    return { attempt };
  });
  if (result.expired) throw new HttpsError('failed-precondition', 'The quiz time has expired. Your session was closed.');
  return shapeResult(q.id, result.attempt, qs);
});

/** The student's own finished result with explanations. */
exports.getAttemptResult = onCall(hotOpts, async request => {
  const me = await requireSession(request, ['student', 'parent']); const quizId = String((request.data && request.data.quiz_id) || '');
  const sid = me.role === 'student' ? me.uid : String(request.data.student_id || ''); if (me.role === 'parent' && !(me.token.children || []).includes(sid)) throw new HttpsError('permission-denied', 'Not allowed.');
  const a = await db.doc(`quizzes/${quizId}/attempts/${sid}`).get(); if (!a.exists) throw new HttpsError('not-found', 'Result not found.');
  const qs = (await loadPack(quizId)).full;
  return shapeResult(quizId, a.data(), qs);
});

// ---- leaderboards -----------------------------------------------------------------------------
async function rebuildQuizBoard(quizId) {
  const qd = await db.doc(`quizzes/${quizId}`).get(); if (!qd.exists) return;
  const att = (await db.collection(`quizzes/${quizId}/attempts`).select('student_id', 'student_name', 'login_id', 'class_no', 'photo_path', 'score', 'total_marks', 'submitted_at').get()).docs.map(d => d.data()).sort((a, b) => (b.score - a.score) || String(a.submitted_at).localeCompare(b.submitted_at) || a.student_name.localeCompare(b.student_name));
  const rows = att.map((a, i) => ({ student_id: a.student_id, full_name: a.student_name, login_id: a.login_id, class_no: a.class_no, photo_path: a.photo_path || null, score: a.score, total_marks: a.total_marks, submitted_at: a.submitted_at,
    rank: i > 0 && att[i - 1].score === a.score ? null : i + 1 }));
  rows.forEach((r, i) => { if (r.rank == null) r.rank = rows[i - 1].rank; });
  await db.doc(`quiz_boards/${quizId}`).set({ quiz_id: quizId, class_no: qd.get('class_no'), title: qd.get('title'), created_at: qd.get('created_at'), rows: rows.slice(0, MAX_BOARD_ROWS), truncated: rows.length > MAX_BOARD_ROWS, updated_at: nowIso() });   // a Firestore document is limited to 1 MB
}
async function rebuildClassBoard(classNo) {
  const [roster, totals] = await Promise.all([db.collection('users').where('role', '==', 'student').where('student.class_no', '==', classNo).where('student.status', '==', 'active').get(),
    db.collection('quiz_totals').where('class_no', '==', classNo).get()]);
  const t = Object.fromEntries(totals.docs.map(d => [d.get('student_id'), d.data()]));
  const rows = roster.docs.map(d => { const x = t[d.id] || {}, ts = r2(x.score_sum || 0), tm = r2(x.total_sum || 0);
    return { student_id: d.id, full_name: d.get('full_name'), login_id: d.get('login_id'), class_no: classNo, photo_path: d.get('photo_path') || null, total_score: ts, total_marks: tm, percentage: tm > 0 ? r2(ts * 100 / tm) : 0, attempted_quizzes: x.count || 0 }; })
    .sort((a, b) => (b.percentage - a.percentage) || (b.total_score - a.total_score) || a.full_name.localeCompare(b.full_name));
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].percentage === r.percentage && rows[i - 1].total_score === r.total_score ? rows[i - 1].rank : i + 1; });
  await db.doc(`class_boards/${classNo}`).set({ class_no: classNo, rows: rows.slice(0, MAX_BOARD_ROWS), truncated: rows.length > MAX_BOARD_ROWS, updated_at: nowIso() });
}
/** Every minute: rebuild the boards that changed. Many students submitting together cause ONE rebuild, not hundreds of competing writes. */
exports.processQuizBoards = onSchedule({ schedule: 'every 2 minutes', region: REGION, timeoutSeconds: 300, memory: '1GiB', retryCount: 0 }, async () => {
  // Read ALL waiting markers first, then rebuild each quiz / class board ONCE (not once per batch of markers), then remove exactly the markers that were read.
  const dirty = await db.collection('quiz_dirty').limit(20000).get(); if (dirty.empty) return;
  const quizzes = new Set(), classes = new Set(); dirty.forEach(d => { if (!d.get('class_only')) quizzes.add(d.get('quiz_id')); classes.add(d.get('class_no')); });
  for (const id of quizzes) await rebuildQuizBoard(id);
  for (const c of classes) await rebuildClassBoard(c);
  for (const part of chunk(dirty.docs, 400)) { const batch = db.batch(); part.forEach(d => batch.delete(d.ref)); await batch.commit(); }
});

/** Staff monitoring card for one student: attendance, latest result, quiz activity. */
exports.studentMonitoring = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const sid = String((request.data && request.data.student_id) || '');
  const u = await db.doc(`users/${sid}`).get(); if (!u.exists || u.get('role') !== 'student') throw new HttpsError('not-found', 'Student not found.');
  if (!classAccess(me, u.get('student.class_no'))) throw new HttpsError('permission-denied', 'Not your class.');
  const { summaryFor } = require('./attendance'); const { currentSession } = require('./common');
  const sess = await currentSession().catch(() => null);
  const [att, sheet, qa] = await Promise.all([summaryFor(sid, u.get('student.class_no')).catch(() => null), sess ? db.doc(`gradesheets/${sess.id}_${sid}`).get() : null,
    db.collectionGroup('attempts').where('student_id', '==', sid).orderBy('submitted_at', 'desc').limit(50).get()]);
  const decl = sheet && sheet.exists ? (sheet.get('exams') || []).filter(e => e.declared && e.cum_pct != null) : [];
  const attempts = qa.docs.map(d => d.data());
  return { attendance: att, latest_result: decl.length ? { cum_pct: decl[decl.length - 1].cum_pct, cum_rank: decl[decl.length - 1].cum_rank } : null,
    quizzes: attempts.map(a => ({ score: a.score, total_marks: a.total_marks })), recent_quizzes: attempts.slice(0, 5).map(a => ({ title: a.quiz_title, score: a.score, total_marks: a.total_marks, submitted_at: a.submitted_at })) };
});

exports._rebuildPack = rebuildPack;
