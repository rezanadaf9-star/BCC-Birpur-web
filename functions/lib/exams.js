'use strict';
// Exams, marks, results, report cards (grade sheets), class promotion.
// All maths (totals, percentages, ranks, grades) happens HERE. Students only ever read finished results.
//   exams/{examId}                         class_no, session_id, exam_name, exam_order, is_final, result_declared, archived_at, subjects[] (embedded: id, subject_id, subject_name, full_marks)
//   exams/{examId}/marks/{studentId}       marks {subjectKey: n}, included_subject_ids (null = all), status draft|completed   (staff only)
//   exams/{examId}/marks_audit/{auto}      every correction after the fact, with reason
//   gradesheets/{sessionId}_{studentId}    finished report-card data, rebuilt whenever anything that affects it changes
//   exam_leaderboards/{sessionId}_{classNo} ranked rows for every declared exam (exam only and cumulative)
const { onCall } = require('firebase-functions/v2/https');
const { admin, db, auth, HttpsError, callOpts, nowIso, pad2, int, str, isoDate, bad, claimsFromUser, requireSession, audit, currentSession, revokeAllSessions, istToday, chunk, classAccess, hotOpts } = require('./common');

const MAX_LB_ROWS = 800;
const r2 = x => Math.round(x * 100) / 100;
const subjKey = s => String(s.subject_id || s.id);

async function canDeclare(me, classNo) {
  if (me.role === 'admin') return true;
  if (me.role !== 'teacher') return false;
  const u = await db.doc(`users/${me.uid}`).get();
  return !!((u.get('teacher.assignments') || []).find(a => a.class_no === classNo && a.can_declare_results));
}
async function loadExam(id, { allowArchived = false } = {}) {
  const s = await db.doc(`exams/${id}`).get();
  if (!s.exists || (!allowArchived && s.get('archived_at'))) throw new HttpsError('not-found', 'Exam not found.');
  return { id: s.id, ref: s.ref, ...s.data() };
}

/** Port of the old bcc_gradesheets_core(): same rules, now in code. Returns an array of sheets in roll order. */
async function computeGradesheets(classNo, sessionId) {
  const [sessSnap, exSnap, enSnap, rulesSnap] = await Promise.all([
    db.doc(`academic_sessions/${sessionId}`).get(),
    db.collection('exams').where('class_no', '==', classNo).where('session_id', '==', sessionId).get(),
    db.collectionGroup('enrollments').where('session_id', '==', sessionId).where('class_no', '==', classNo).get(),
    db.collection('grade_rules').get()]);
  if (!sessSnap.exists) throw new HttpsError('not-found', 'Session not found.');
  const sess = sessSnap.data(), rules = rulesSnap.docs.map(d => d.data());
  const exams = exSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.archived_at)
    .sort((a, b) => ((a.exam_order ?? 1e9) - (b.exam_order ?? 1e9)) || String(a.created_at).localeCompare(String(b.created_at)))
    .map((e, i) => ({ ...e, n: i + 1, att_upto: e.attendance_upto || e.exam_date || istToday() }));
  const enr = enSnap.docs.filter(d => ['active', 'promoted'].includes(d.get('status'))).map(d => ({ uid: d.ref.parent.parent.id, roll: d.get('roll_number') }));
  const uSnaps = enr.length ? await db.getAll(...enr.map(e => db.doc(`users/${e.uid}`))) : [];
  const students = enr.map((e, i) => ({ ...e, name: uSnaps[i].get('full_name'), father_name: uSnaps[i].get('student.father_name') || null, admission_no: uSnaps[i].get('student.admission_no') || null, photo_path: uSnaps[i].get('photo_path') || null }));
  const declared = exams.filter(e => e.result_declared);
  const marksByExam = {};
  await Promise.all(declared.map(async e => { marksByExam[e.id] = Object.fromEntries((await db.collection(`exams/${e.id}/marks`).get()).docs.map(d => [d.id, d.data()])); }));
  // attendance: one read per day (each day document holds the whole class)
  const maxUpto = declared.reduce((m, e) => (e.att_upto > m ? e.att_upto : m), '');
  const attDays = declared.length ? (await db.collection('attendance').where('class_no', '==', classNo).where('att_date', '>=', sess.starts_on).where('att_date', '<=', maxUpto).get()).docs.map(d => d.data()) : [];
  const conductSnaps = students.length ? await db.getAll(...students.map(s => db.doc(`conduct/${sessionId}_${s.uid}`))) : [];

  // cells -> per exam -> cumulative
  const per = {};   // uid -> { n -> {fm, om, cells[]} }
  students.forEach(s => { per[s.uid] = {}; });
  for (const e of declared) for (const s of students) {
    const m = marksByExam[e.id][s.uid]; if (!m || m.status !== 'completed') continue;
    const inc = m.included_subject_ids ? new Set(m.included_subject_ids.map(String)) : null;
    let fm = 0, om = 0; const cells = [];
    for (const sub of e.subjects) { const k = subjKey(sub); if (inc && !inc.has(k)) continue; const f = Number(sub.full_marks), o = Number((m.marks || {})[k] || 0); fm += f; om += o; cells.push({ name: sub.subject_name, n: e.n, fm: f, om: o }); }
    per[s.uid][e.n] = { fm, om, cells };
  }
  const ranked = {};  // uid -> n -> row
  students.forEach(s => { let cfm = 0, com = 0; ranked[s.uid] = {};
    Object.keys(per[s.uid]).map(Number).sort((a, b) => a - b).forEach(n => { const p = per[s.uid][n]; cfm += p.fm; com += p.om;
      ranked[s.uid][n] = { fm: p.fm, om: p.om, cum_fm: cfm, cum_om: com, pct: p.fm ? r2(p.om * 100 / p.fm) : 0, cum_pct: cfm ? r2(com * 100 / cfm) : 0, rawPct: p.fm ? p.om * 100 / p.fm : 0, rawCum: cfm ? com * 100 / cfm : 0 }; }); });
  // rank(): percentage first (fair when a subject is skipped), then marks; ties share a rank (1,1,3)
  for (const e of exams) {
    const rows = students.filter(s => ranked[s.uid][e.n]).map(s => ({ uid: s.uid, r: ranked[s.uid][e.n] }));
    const rk = (cmp, set) => { const sorted = [...rows].sort(cmp); sorted.forEach((x, i) => { x.r[set] = (i > 0 && cmp(sorted[i - 1], x) === 0) ? sorted[i - 1].r[set] : i + 1; }); };
    rk((a, b) => (b.r.rawPct - a.r.rawPct) || (b.r.om - a.r.om), 'rank');
    rk((a, b) => (b.r.rawCum - a.r.rawCum) || (b.r.cum_om - a.r.cum_om), 'cum_rank');
  }
  const gradeOf = pct => rules.find(g => pct >= g.min_pct && pct < g.max_pct);
  const subjectNames = [...new Set(exams.flatMap(e => e.subjects.map(s => s.subject_name)))].sort();
  const attFor = (uid, e) => { if (!e.result_declared) return { present: 0, absent: 0 }; let present = 0, absent = 0;
    attDays.forEach(d => { if (d.att_date > e.att_upto) return; const v = (d.marks || {})[uid]; if (v === 'present') present++; else if (v === 'absent') absent++; }); return { present, absent }; };

  const sheets = students.map((s, si) => {
    const R = ranked[s.uid], ns = Object.keys(R).map(Number).sort((a, b) => a - b), last = ns.length ? R[ns[ns.length - 1]] : null;
    const finalN = ns.find(n => exams.find(e => e.n === n).is_final);
    const c = conductSnaps[si].exists ? { ...conductSnaps[si].data() } : null; if (c) { delete c.student_id; delete c.session_id; }
    const lg = last ? gradeOf(last.cum_pct) : null;
    return { roll_sort: String(s.roll || '').padStart(6, '0'), session_id: sessionId,
      student: { id: s.uid, name: s.name, roll: s.roll, father_name: s.father_name, admission_no: s.admission_no, class_no: classNo },
      session: sess.label,
      exams: exams.map(e => { const r = R[e.n], a = attFor(s.uid, e);
        return { n: e.n, name: e.exam_name, is_final: !!e.is_final, declared: !!e.result_declared, fm: r ? r.fm : null, om: r ? r.om : null, pct: r ? r.pct : null, rank: r ? r.rank : null,
          cum_om: r ? r.cum_om : null, cum_fm: r ? r.cum_fm : null, cum_pct: r ? r.cum_pct : null, cum_rank: r ? r.cum_rank : null, present: a.present, absent: a.absent }; }),
      subjects: subjectNames.map(name => ({ name, cells: ns.flatMap(n => per[s.uid][n].cells.filter(x => x.name === name).map(x => ({ n: x.n, fm: x.fm, om: x.om }))) })),
      latest: lg ? { grade: lg.grade, remark: lg.remark } : null,
      final: finalN != null ? { total_om: R[finalN].cum_om, total_fm: R[finalN].cum_fm, pct: R[finalN].cum_pct, rank: R[finalN].cum_rank } : null,
      conduct: c, _photo: s.photo_path };
  }).sort((a, b) => a.roll_sort.localeCompare(b.roll_sort));
  return { sheets, exams };
}

/** Recompute and store everything derived from marks: student report cards + leaderboards. */
async function rebuildResults(classNo, sessionId) {
  const { sheets, exams } = await computeGradesheets(classNo, sessionId);
  const keep = new Set(sheets.map(s => `${sessionId}_${s.student.id}`));
  const old = await db.collection('gradesheets').where('session_id', '==', sessionId).where('student.class_no', '==', classNo).get();
  const writes = [];
  sheets.forEach(s => { const { roll_sort, _photo, ...doc } = s; writes.push(b => b.set(db.doc(`gradesheets/${sessionId}_${s.student.id}`), doc)); });
  old.docs.filter(d => !keep.has(d.id)).forEach(d => writes.push(b => b.delete(d.ref)));
  // leaderboards: only declared exams, only students with finished marks
  const decl = exams.filter(e => e.result_declared).map(e => ({ n: e.n, name: e.exam_name }));
  const boards = {};
  decl.forEach(({ n }) => {
    const rows = sheets.map(s => { const e = s.exams.find(x => x.n === n); return e && e.fm != null ? { s, e } : null; }).filter(Boolean);
    const mk = cum => rows.map(({ s, e }) => ({ student_id: s.student.id, name: s.student.name, roll: s.student.roll, class_no: classNo, photo_path: s._photo,
      rank: cum ? e.cum_rank : e.rank, om: cum ? e.cum_om : e.om, fm: cum ? e.cum_fm : e.fm, pct: cum ? e.cum_pct : e.pct })).sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
    boards[n] = { exam: mk(false).slice(0, MAX_LB_ROWS), cum: mk(true).slice(0, MAX_LB_ROWS) };   // keeps the document under Firestore's 1 MB limit (a class never has this many)
  });
  writes.push(b => b.set(db.doc(`exam_leaderboards/${sessionId}_${classNo}`), { class_no: classNo, session_id: sessionId, exams: decl, boards, updated_at: nowIso() }));
  for (const part of chunk(writes, 400)) { const b = db.batch(); part.forEach(w => w(b)); await b.commit(); }
  return sheets.length;
}

const examCol = db.collection('exams');

exports.createExam = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {};
  const classNo = int(b.class_no, 'Class', { min: -3, max: 12 });
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to create exams for this class.');
  const name = str(b.name, 'Exam name', { min: 1, max: 80 });
  const sess = await currentSession();
  const wanted = Array.isArray(b.subjects) ? b.subjects : [];
  if (!wanted.length || wanted.length > 30) throw bad('Add full marks for at least one subject.');
  const subs = await db.getAll(...wanted.map(w => db.doc(`subjects/${String(w.subject_id)}`)));
  const subjects = subs.map((s, i) => { if (!s.exists || s.get('class_no') !== classNo) throw bad('A subject does not belong to this class.'); const fm = Number(wanted[i].full_marks); if (!(fm > 0 && fm <= 10000)) throw bad('Full marks must be greater than zero.'); return { id: s.id, subject_id: s.id, subject_name: s.get('name'), full_marks: fm }; });
  const ref = examCol.doc();
  await db.runTransaction(async tx => {
    const cur = await tx.get(examCol.where('class_no', '==', classNo).where('session_id', '==', sess.id));
    const order = cur.docs.filter(d => !d.get('archived_at')).length + 1;
    tx.set(ref, { class_no: classNo, session_id: sess.id, exam_name: name, exam_order: order, exam_date: isoDate(b.date, 'Exam date'), attendance_upto: isoDate(b.upto, 'Attendance date'), is_final: !!b.final,
      result_declared: false, archived_at: null, subjects, subject_ids: subjects.map(s => s.subject_id), created_by: me.uid, created_at: nowIso() });
  });
  await rebuildResults(classNo, sess.id);
  await audit(me.uid, 'exam_created', ref.id, { name, classNo });
  return { id: ref.id };
});

/** Save marks for many students. The SERVER decides Draft/Completed; marks are range-checked; declared exams are locked (use correctMarks). */
exports.saveExamMarks = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const exam = await loadExam(String(b.exam_id || ''));
  if (!classAccess(me, exam.class_no)) throw new HttpsError('permission-denied', 'You are not allowed to enter marks for this class.');
  if (exam.result_declared) throw new HttpsError('failed-precondition', 'This result is declared. Use “Correct” to change a mark.');
  const rows = Array.isArray(b.rows) ? b.rows : []; if (!rows.length || rows.length > 400) throw bad('Send between 1 and 400 students.');
  const keys = new Set(exam.subjects.map(subjKey)), fmOf = Object.fromEntries(exam.subjects.map(s => [subjKey(s), Number(s.full_marks)]));
  const roster = new Set((await db.collection('users').where('role', '==', 'student').where('student.class_no', '==', exam.class_no).select().get()).docs.map(d => d.id));
  const existing = new Set((await db.collection(`exams/${exam.id}/marks`).select().get()).docs.map(d => d.id));
  const batch = db.batch(); let saved = 0;
  for (const r of rows) {
    if (!r || !roster.has(r.student_id)) continue;
    const inc = Array.isArray(r.included_subject_ids) ? [...new Set(r.included_subject_ids.map(String))] : null;
    if (inc && (!inc.length || inc.some(k => !keys.has(k)))) throw bad('Unknown subject selected.');
    const marks = {}; const m = r.marks && typeof r.marks === 'object' ? r.marks : {};
    for (const [k, v] of Object.entries(m)) { if (!keys.has(k)) throw bad('Unknown subject in marks.'); if (inc && !inc.includes(k)) continue; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > fmOf[k]) throw bad('Marks must be between 0 and the full marks.'); marks[k] = n; }
    if (!Object.keys(marks).length && !existing.has(r.student_id) && !inc) continue;
    const need = inc ? inc.length : keys.size;
    batch.set(db.doc(`exams/${exam.id}/marks/${r.student_id}`), { student_id: r.student_id, class_no: exam.class_no, marks, included_subject_ids: inc, status: Object.keys(marks).length === need ? 'completed' : 'draft', updated_at: nowIso(), updated_by: me.uid });
    saved++;
  }
  await batch.commit();
  await audit(me.uid, 'marks_saved', exam.id, { students: saved });
  return { saved };
});

/** Correct one student's marks after the result is declared (reason required, old values kept). */
exports.correctMarks = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const exam = await loadExam(String(b.exam_id || ''));
  if (!classAccess(me, exam.class_no)) throw new HttpsError('permission-denied', 'You are not allowed to correct marks for this class.');
  const reason = String(b.reason || '').trim(); if (reason.length < 3) throw bad('Please provide a correction reason.');
  const sid = String(b.student_id || '');
  const u = await db.doc(`users/${sid}`).get(); if (!u.exists || u.get('student.class_no') !== exam.class_no) throw bad('Student does not belong to the exam class.');
  const keys = exam.subjects.map(subjKey), fmOf = Object.fromEntries(exam.subjects.map(s => [subjKey(s), Number(s.full_marks)]));
  const inc = Array.isArray(b.included_subject_ids) ? [...new Set(b.included_subject_ids.map(String))] : keys;
  if (!inc.length || inc.some(k => !keys.includes(k))) throw bad('Select at least one valid subject.');
  const marks = b.marks && typeof b.marks === 'object' ? b.marks : null; if (!marks) throw bad('Invalid marks.');
  if (Object.keys(marks).length !== inc.length) throw bad('Every included subject requires a mark.');
  for (const k of inc) { if (!(k in marks)) throw bad('Missing subject marks.'); const n = Number(marks[k]); if (!Number.isFinite(n)) throw bad('Marks must be numeric.'); if (n < 0 || n > fmOf[k]) throw bad('Marks exceed the full marks.'); marks[k] = n; }
  const ref = db.doc(`exams/${exam.id}/marks/${sid}`), prev = await ref.get();
  const batch = db.batch();
  batch.set(ref, { student_id: sid, class_no: exam.class_no, marks, included_subject_ids: inc.length === keys.length ? null : inc, status: 'completed', updated_at: nowIso(), updated_by: me.uid });
  batch.set(db.collection(`exams/${exam.id}/marks_audit`).doc(), { class_no: exam.class_no, student_id: sid, actor_id: me.uid, old_marks: prev.exists ? prev.get('marks') : {}, new_marks: marks,
    old_included_subject_ids: prev.exists ? prev.get('included_subject_ids') || null : null, new_included_subject_ids: inc.length === keys.length ? null : inc, reason, created_at: nowIso() });
  await batch.commit();
  if (exam.result_declared) await rebuildResults(exam.class_no, exam.session_id);
  return { ok: true };
});

/** Publish (declare) or withdraw the result of an exam for ALL students and subjects at once. */
exports.declareResult = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const exam = await loadExam(String(b.exam_id || '')); const declared = b.declared === true;
  if (!(await canDeclare(me, exam.class_no))) throw new HttpsError('permission-denied', 'You are not authorised to declare results for this class.');
  if (declared && exam.result_declared) return { ok: true, already: true };   // publishing twice never notifies twice
  if (declared) {
    const drafts = (await db.collection(`exams/${exam.id}/marks`).where('status', '!=', 'completed').limit(1).get());
    if (!drafts.empty) throw new HttpsError('failed-precondition', 'Some students still have draft marks. Complete all marks before declaring.');
  }
  await exam.ref.update({ result_declared: declared, declared_at: declared ? nowIso() : null, declared_by: me.uid });
  await rebuildResults(exam.class_no, exam.session_id);
  if (declared) await db.collection('notifications').add({ audience: [`class_${exam.class_no}`], kind: 'result', title: `Result declared: ${exam.exam_name}`, body: 'Tap to view your result.', ref_id: exam.id, link: '/student/marks.html', created_at: nowIso() });
  await audit(me.uid, declared ? 'result_declared' : 'result_withdrawn', exam.id, { exam: exam.exam_name });
  return { ok: true };
});

exports.archiveExam = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const exam = await loadExam(String((request.data && request.data.exam_id) || ''));
  if (!classAccess(me, exam.class_no)) throw new HttpsError('permission-denied', 'You are not allowed to archive this exam.');
  await exam.ref.update({ archived_at: nowIso(), archived_by: me.uid });
  await rebuildResults(exam.class_no, exam.session_id);
  await audit(me.uid, 'exam_archived', exam.id, null);
  return { ok: true };
});

/** Admin: change the full marks (FM) of subjects in an exam. Recomputes all results if the exam is already declared. */
exports.updateExamFullMarks = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const exam = await loadExam(String(b.exam_id || ''));
  const upd = Array.isArray(b.subjects) ? b.subjects : []; if (!upd.length) throw bad('Nothing to update.');
  const subjects = exam.subjects.map(s => { const u = upd.find(x => String(x.subject_id) === subjKey(s)); if (!u) return s; const fm = Number(u.full_marks); if (!(fm > 0 && fm <= 10000)) throw bad('Full marks must be greater than zero.'); return { ...s, full_marks: fm }; });
  // existing marks must still fit inside the new full marks
  const marks = await db.collection(`exams/${exam.id}/marks`).get();
  marks.forEach(d => { const m = d.get('marks') || {}; subjects.forEach(s => { if (m[subjKey(s)] != null && Number(m[subjKey(s)]) > Number(s.full_marks)) throw new HttpsError('failed-precondition', 'A saved mark is higher than the new full marks. Correct that mark first.'); }); });
  await exam.ref.update({ subjects });
  if (exam.result_declared) await rebuildResults(exam.class_no, exam.session_id);
  await audit(me.uid, 'exam_fm_updated', exam.id, null);
  return { ok: true };
});

/** Report cards. Staff: computed live for the class (print). Student / parent: their own stored card. */
exports.getGradesheets = onCall(hotOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher', 'student', 'parent']);
  const b = request.data || {}; const classNo = b.class_no == null ? null : int(b.class_no, 'Class', { min: -3, max: 12 });
  const sessionId = b.session_id || (await currentSession()).id;
  if (me.role === 'student' || me.role === 'parent') {
    const sid = me.role === 'student' ? me.uid : String(b.student_id || '');
    if (me.role === 'parent' && !(me.token.children || []).includes(sid)) throw new HttpsError('permission-denied', 'You are not allowed to see this report card.');
    const s = await db.doc(`gradesheets/${sessionId}_${sid}`).get(); return { sheets: s.exists ? [s.data()] : [] };
  }
  if (classNo == null || !classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to view these report cards.');
  let { sheets } = await computeGradesheets(classNo, sessionId);
  if (b.student_id) sheets = sheets.filter(s => s.student.id === b.student_id);
  return { sheets: sheets.map(({ roll_sort, _photo, ...s }) => s) };
});

/** Promotion: same student, new session, roll numbers re-issued from the previous session's ACADEMIC rank. Admin only. */
exports.promoteClass = onCall({ ...callOpts, timeoutSeconds: 300, memory: '512MiB' }, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const from = int(b.from_class, 'From class', { min: -3, max: 12 }), to = int(b.to_class, 'To class', { min: -3, max: 12 });
  const fs = String(b.from_session || ''), ts = String(b.to_session || ''); if (!fs || !ts || fs === ts) throw bad('Choose a different new session.');
  const toCls = await db.doc(`classes/${to}`).get(); if (!toCls.exists || !toCls.get('is_active')) throw new HttpsError('failed-precondition', 'The destination class is not active.');
  const { sheets } = await computeGradesheets(from, fs);
  const order = sheets.map(s => ({ id: s.student.id, rk: (s.exams.length && s.exams[s.exams.length - 1].cum_rank) || 9999, name: s.student.name })).sort((a, c) => (a.rk - c.rk) || a.name.localeCompare(c.name));
  let n = 0;
  for (const part of chunk(order, 100)) {
    const batch = db.batch();
    part.forEach(x => { n++; const roll = pad2(n);
      batch.set(db.doc(`users/${x.id}/enrollments/${ts}`), { session_id: ts, class_no: to, roll_number: roll, status: 'active', created_at: nowIso() }, { merge: true });
      batch.set(db.doc(`users/${x.id}/enrollments/${fs}`), { status: 'promoted' }, { merge: true });
      batch.update(db.doc(`users/${x.id}`), { 'student.class_no': to, 'student.roll_number': roll }); });
    await batch.commit();
  }
  for (const part of chunk(order, 10)) await Promise.all(part.map(async x => { const u = await db.doc(`users/${x.id}`).get(); await auth.setCustomUserClaims(x.id, claimsFromUser(u.data())); await revokeAllSessions(x.id); }));   // new class lives in the login token: students sign in again (10 at a time)
  await audit(me.uid, 'promote_class', from, { to, students: n });
  return { promoted: n };
});

/** Student result pop-up: the latest declared exam I have not acknowledged yet. */
exports.pendingResultPopup = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student']);
  const classNo = me.token.classNo;
  const ex = await examCol.where('class_no', '==', classNo).where('result_declared', '==', true).orderBy('created_at', 'desc').limit(5).get();
  for (const d of ex.docs) { if (d.get('archived_at')) continue;
    const [m, a] = await Promise.all([db.doc(`exams/${d.id}/marks/${me.uid}`).get(), db.doc(`users/${me.uid}/result_acks/${d.id}`).get()]);
    if (m.exists && m.get('status') === 'completed' && !a.exists) return { exam: { id: d.id, exam_name: d.get('exam_name') } }; return { exam: null }; }
  return { exam: null };
});
exports.ackResultPopup = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student']);
  const id = String((request.data && request.data.exam_id) || ''); if (!id) throw bad('Exam is required.');
  await db.doc(`users/${me.uid}/result_acks/${id}`).set({ acked_at: nowIso() }); return { ok: true };
});
exports._computeGradesheets = computeGradesheets;
exports._rebuildResults = rebuildResults;
