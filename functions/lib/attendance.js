'use strict';
// Attendance. Storage (efficient, nothing grows without bound):
//   attendance/{classNo}_{YYYY-MM-DD}        staff only. ONE document per class per day: marks {uid: present|absent|leave}. The id makes duplicates impossible.
//   users/{uid}/attendance/{YYYY-MM}         the student's own month (days {date: status}); written only by this function.
//   class_attendance_days/{classNo}_{YYYY-MM} the dates on which the class had attendance (= working days), readable by that class.
//   attendance_reports/{uid}_{YYYY-MM}       one numbered notice per student per month.
//   users/{uid}/attendance_sessions/{sessionId}   running totals {present, absent, leave} for the academic session; class_attendance_days/{classNo}_{sessionId} lists the session's working days.
//   Both are updated in the same transaction as the day itself, so the dashboard needs 2 reads instead of ~20.
const { onCall } = require('firebase-functions/v2/https');
const { admin, db, HttpsError, callOpts, nowIso, int, str, bad, requireSession, audit, currentSession, istToday, classAccess, hotOpts } = require('./common');
const FieldValue = admin.firestore.FieldValue;
const STATUSES = ['present', 'absent', 'leave'];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
const monthsBetween = (from, to) => { const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const [ey, em] = to.slice(0, 7).split('-').map(Number); while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } return out; };

let sessCache = { at: 0, list: [] };
async function sessionFor(date) {   // the academic session that contains this date (sessions are few; held 5 minutes in memory)
  if (Date.now() - sessCache.at > 300000) sessCache = { at: Date.now(), list: (await db.collection('academic_sessions').get()).docs.map(d => ({ id: d.id, ...d.data() })) };
  return sessCache.list.find(x => x.starts_on <= date && date <= x.ends_on) || null;
}
/** may this caller manage attendance / see this student's records? */
async function canSeeStudent(me, studentId) {
  if (me.uid === studentId) return { ok: true };
  const s = await db.doc(`users/${studentId}`).get();
  if (!s.exists || s.get('role') !== 'student') throw new HttpsError('not-found', 'Student not found.');
  const classNo = s.get('student.class_no');
  const ok = classAccess(me, classNo) || (me.role === 'parent' && (me.token.children || []).includes(studentId));
  if (!ok) throw new HttpsError('permission-denied', 'You are not allowed to see this attendance.');
  return { ok: true, user: s.data(), classNo };
}

/** Save a whole class for one date. rows = [{student_id, status: present|absent|leave|null}]. null removes the mark (reversible until saved). */
exports.saveClassAttendance = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {};
  const classNo = int(b.class_no, 'Class', { min: -3, max: 12 }), date = String(b.date || '');
  if (!isDate(date)) throw bad('Choose a valid date.');
  if (date > istToday()) throw new HttpsError('failed-precondition', 'Attendance cannot be marked for a future date.');
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to mark attendance for this class.');
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length || rows.length > 400) throw bad('Send between 1 and 400 students.');
  rows.forEach(r => { if (!r || typeof r.student_id !== 'string' || (r.status !== null && r.status !== undefined && !STATUSES.includes(r.status))) throw bad('Invalid attendance row.'); });

  const roster = new Set((await db.collection('users').where('role', '==', 'student').where('student.class_no', '==', classNo).select().get()).docs.map(d => d.id));
  const ym = date.slice(0, 7), dayRef = db.doc(`attendance/${classNo}_${date}`), wdRef = db.doc(`class_attendance_days/${classNo}_${ym}`);
  const sess = await currentSession().catch(() => null), dsess = await sessionFor(date);
  let n = 0;
  await db.runTransaction(async tx => {
    const cur = await tx.get(dayRef);
    const marks = { ...((cur.exists && cur.get('marks')) || {}) };
    const batchWrites = [];
    for (const r of rows) {
      if (!roster.has(r.student_id)) continue;                         // ignore students that are not in this class (same as before)
      const st = r.status || null, old = marks[r.student_id] || null;
      if (st) marks[r.student_id] = st; else delete marks[r.student_id];
      if (dsess && old !== st) { const inc = {}; if (old) inc[old] = FieldValue.increment(-1); if (st) inc[st] = FieldValue.increment(1); batchWrites.push([db.doc(`users/${r.student_id}/attendance_sessions/${dsess.id}`), inc]); }
      batchWrites.push([db.doc(`users/${r.student_id}/attendance/${ym}`), { class_no: classNo, days: { [date]: st ? st : FieldValue.delete() }, updated_at: nowIso() }]);
      n++;
    }
    const taken = Object.keys(marks).length > 0;
    if (taken) tx.set(dayRef, { class_no: classNo, att_date: date, session_id: sess ? sess.id : null, marks, marked_by: me.uid, updated_at: nowIso() });
    else if (cur.exists) tx.delete(dayRef);
    tx.set(wdRef, { class_no: classNo, month: ym, dates: taken ? FieldValue.arrayUnion(date) : FieldValue.arrayRemove(date) }, { merge: true });
    if (dsess) tx.set(db.doc(`class_attendance_days/${classNo}_${dsess.id}`), { class_no: classNo, session_id: dsess.id, dates: taken ? FieldValue.arrayUnion(date) : FieldValue.arrayRemove(date) }, { merge: true });
    batchWrites.forEach(([ref, data]) => tx.set(ref, data, { merge: true }));
  });
  await audit(me.uid, 'attendance_saved', classNo, { date, rows: n });
  return { saved: n };
});

/** One class on one day (staff). Returns { marks }. */
exports.getClassAttendance = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const classNo = int(request.data && request.data.class_no, 'Class', { min: -3, max: 12 }), date = String((request.data && request.data.date) || '');
  if (!isDate(date)) throw bad('Choose a valid date.');
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to see this class.');
  const s = await db.doc(`attendance/${classNo}_${date}`).get();
  return { marks: s.exists ? s.get('marks') : {} };
});

async function summaryFor(studentId, classNoFallback, from, to) {
  const sess = await currentSession().catch(() => null);
  if (!from && !to && sess) {        // the usual case (current session): two documents instead of one per month
    const [tot, wd] = await Promise.all([db.doc(`users/${studentId}/attendance_sessions/${sess.id}`).get(), db.doc(`class_attendance_days/${classNoFallback}_${sess.id}`).get()]);
    const present = (tot.exists && tot.get('present')) || 0, absent = (tot.exists && tot.get('absent')) || 0, leave = (tot.exists && tot.get('leave')) || 0, working = (wd.exists && (wd.get('dates') || []).length) || 0;
    return { working_days: working, present, absent, leave, percentage: working ? Math.round(present * 1000 / working) / 10 : 0 };
  }
  from = from || (sess && sess.starts_on) || '1970-01-01'; to = to || (sess && sess.ends_on) || '2999-12-31';
  const maxTo = istToday(); if (to > maxTo) to = maxTo;
  const months = monthsBetween(from, to);
  if (months.length > 60) throw bad('Range too long.');
  const stuDocs = await db.getAll(...months.map(m => db.doc(`users/${studentId}/attendance/${m}`)));
  let present = 0, absent = 0, leave = 0; const classByMonth = {};
  stuDocs.forEach((d, i) => { if (!d.exists) return; classByMonth[months[i]] = d.get('class_no'); Object.entries(d.get('days') || {}).forEach(([k, v]) => { if (k < from || k > to) return; if (v === 'present') present++; else if (v === 'absent') absent++; else if (v === 'leave') leave++; }); });
  const wdRefs = months.map(m => db.doc(`class_attendance_days/${(classByMonth[m] ?? classNoFallback)}_${m}`));
  const wdDocs = wdRefs.length ? await db.getAll(...wdRefs) : [];
  const dates = new Set(); wdDocs.forEach(d => { if (d.exists) (d.get('dates') || []).forEach(x => { if (x >= from && x <= to) dates.add(x); }); });
  const working = dates.size;
  return { working_days: working, present, absent, leave, percentage: working ? Math.round(present * 1000 / working) / 10 : 0 };
}
exports.summaryFor = summaryFor;

/** Attendance summary (default: current session). Student: own. Parent: linked child. Staff: their classes. */
exports.attendanceSummary = onCall(hotOpts, async request => {
  const me = await requireSession(request, ['student', 'parent', 'teacher', 'admin']);
  const b = request.data || {}; const sid = String(b.student_id || me.uid);
  const info = await canSeeStudent(me, sid);
  const from = b.from ? (isDate(b.from) ? b.from : (() => { throw bad('Invalid start date.'); })()) : null, to = b.to ? (isDate(b.to) ? b.to : (() => { throw bad('Invalid end date.'); })()) : null;
  const u = info.user || (await db.doc(`users/${sid}`).get()).data();
  return summaryFor(sid, u.student.class_no, from, to);
});

/** A student's records for one month (own, linked child, or staff). Returns {by_date}. */
exports.attendanceMonth = onCall(hotOpts, async request => {
  const me = await requireSession(request, ['student', 'parent', 'teacher', 'admin']);
  const sid = String((request.data && request.data.student_id) || me.uid), ym = String((request.data && request.data.month) || '');
  if (!isMonth(ym)) throw bad('Invalid month.');
  await canSeeStudent(me, sid);
  const s = await db.doc(`users/${sid}/attendance/${ym}`).get();
  return { by_date: s.exists ? s.get('days') || {} : {} };
});

/** Students below a percentage (default 75) for a class and range (default: this month). Staff. */
exports.lowAttendance = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const classNo = int(b.class_no, 'Class', { min: -3, max: 12 });
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to see this class.');
  const threshold = b.threshold == null ? 75 : Number(b.threshold);
  const today = istToday(); const from = isDate(b.from) ? b.from : today.slice(0, 7) + '-01', to = isDate(b.to) ? b.to : today;
  const months = monthsBetween(from, to);
  if (months.length > 14) throw bad('Range too long.');
  const wd = await db.getAll(...months.map(m => db.doc(`class_attendance_days/${classNo}_${m}`)));
  const dates = new Set(); wd.forEach(d => d.exists && (d.get('dates') || []).forEach(x => { if (x >= from && x <= to) dates.add(x); }));
  const working = dates.size; if (!working) return { working_days: 0, students: [] };
  const students = await db.collection('users').where('role', '==', 'student').where('student.class_no', '==', classNo).where('student.status', '==', 'active').get();
  const counts = {}; students.forEach(s => { counts[s.id] = 0; });
  // one read per day document (not per student): each holds the whole class
  const days = await db.getAll(...[...dates].map(d => db.doc(`attendance/${classNo}_${d}`)));
  days.forEach(d => { if (d.exists) Object.entries(d.get('marks') || {}).forEach(([uid, st]) => { if (st === 'present' && uid in counts) counts[uid]++; }); });
  const out = students.docs.map(s => ({ student_id: s.id, name: s.get('full_name'), roll: s.get('student.roll_number'), present: counts[s.id], percentage: Math.round(counts[s.id] * 1000 / working) / 10 }))
    .filter(r => r.percentage < threshold).sort((a, c) => a.percentage - c.percentage);
  return { working_days: working, threshold, students: out };
});

/** Monthly attendance notice for ONE student (staff). Returns the data and the (stable) report number. */
exports.attendanceNotice = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const sid = String((request.data && request.data.student) || ''), ym = String((request.data && request.data.month) || '');
  if (!sid || !isMonth(ym)) throw bad('Student and month are required.');
  const info = await canSeeStudent(me, sid); const u = info.user;
  const from = `${ym}-01`, to = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const [mDoc, hols, sess] = await Promise.all([db.doc(`users/${sid}/attendance/${ym}`).get(),
    db.collection('centre_holidays').where('hday', '>=', from).where('hday', '<=', to).get(), db.collection('academic_sessions').where('starts_on', '<=', from).get()]);
  const holidays = hols.docs.map(d => d.get('hday')).sort(), hset = new Set(holidays);
  const days = (mDoc.exists && mDoc.get('days')) || {}, cls = (mDoc.exists && mDoc.get('class_no')) ?? u.student.class_no;
  const by_date = {}; let present = 0, absent = 0, leave = 0;
  Object.entries(days).forEach(([k, v]) => { if (hset.has(k)) return; by_date[k] = v === 'present' ? 'P' : v === 'absent' ? 'A' : 'L'; if (v === 'present') present++; else if (v === 'absent') absent++; else leave++; });
  const wdDoc = await db.doc(`class_attendance_days/${cls}_${ym}`).get();
  const working = ((wdDoc.exists && wdDoc.get('dates')) || []).filter(x => !hset.has(x)).length;
  const session = sess.docs.map(d => d.data()).filter(x => x.ends_on >= from).map(x => x.label)[0] || null;
  // numbered notice: the same number is returned if it is printed again
  const ref = db.doc(`attendance_reports/${sid}_${ym}`), counter = db.doc('counters/attendance_report');
  const report_no = await db.runTransaction(async tx => {
    const [r, c] = await Promise.all([tx.get(ref), tx.get(counter)]);
    if (r.exists) return r.get('report_no');
    const n = (c.exists ? c.get('n') : 0) + 1, no = `BCC/ATT/${new Date().getUTCFullYear()}/${String(n).padStart(4, '0')}`;
    tx.set(counter, { n }); tx.set(ref, { report_no: no, student_id: sid, month: ym, issued_at: nowIso(), issued_by: me.uid }); return no;
  });
  return { report_no, student: { name: u.full_name, father_name: u.student.father_name, class_no: cls, roll: u.student.roll_number, admission_no: u.student.admission_no },
    session, month: ym, by_date, holidays, summary: { present, absent, leave, holidays: holidays.length, working_days: working } };
});

/** Today's attendance numbers for the dashboard, for the classes the caller may see. */
exports.attendanceToday = async function (me, classNos) {
  const today = istToday(); if (!classNos.length) return { present: 0, total: 0 };
  const docs = await db.getAll(...classNos.map(c => db.doc(`attendance/${c}_${today}`)));
  let present = 0, total = 0; docs.forEach(d => { if (d.exists) Object.values(d.get('marks') || {}).forEach(v => { total++; if (v === 'present') present++; }); });
  return { present, total };
};
