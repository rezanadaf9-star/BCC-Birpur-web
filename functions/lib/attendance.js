'use strict';
// Attendance. Storage (efficient, nothing grows without bound):
//   attendance/{classNo}_{YYYY-MM-DD}        staff only. ONE document per class per day: marks {uid: present|absent|leave}. The id makes duplicates impossible.
//   users/{uid}/attendance/{YYYY-MM}         the student's own month (days {date: status}); written only by this function.
//   class_attendance_days/{classNo}_{YYYY-MM} the dates on which the class had attendance (= working days), readable by that class.
//   attendance_reports/{uid}_{YYYY-MM}       one numbered notice per student per month.
//   users/{uid}/attendance_sessions/{sessionId}   running totals {present, absent, leave} for the academic session; class_attendance_days/{classNo}_{sessionId} lists the session's working days.
//   Both are updated in the same transaction as the day itself, so the dashboard needs 2 reads instead of ~20.
const { onCall } = require('firebase-functions/v2/https');
const { admin, db, FieldValue, HttpsError, callOpts, nowIso, int, str, bad, requireSession, audit, currentSession, istToday, classAccess, hotOpts } = require('./common');
const { getEffectiveDayStatus, getEffectiveCalendarRange } = require('./calendar');

const STATUSES = ['present', 'absent', 'leave'];
const isDate = s => {

  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
};
const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthsBetween = (from, to) => { const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const [ey, em] = to.slice(0, 7).split('-').map(Number); while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } return out; };

let sessCache = { at: 0, list: [] };
async function sessionFor(date) {   // the academic session that contains this date (sessions are few; held 5 minutes in memory)
  if (Date.now() - sessCache.at > 300000) sessCache = { at: Date.now(), list: (await db.collection('academic_sessions').get()).docs.map(d => ({ id: d.id, ...d.data() })) };
  return sessCache.list.find(x => x.starts_on <= date && date <= x.ends_on) || null;
}
/** may this caller manage attendance / see this student's records? */

async function effectiveCalendarForRange(classNo, from, to) {
  const dates = [];
  for (let d = new Date(`${from}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const result = {};
  let start = null, previous = null, sessionId = null;

  async function flush() {
    if (start) {
      Object.assign(result, await getEffectiveCalendarRange(classNo, start, previous, { sessionId }));
    }
  }

  for (const date of dates) {
    const session = await sessionFor(date);
    const nextSessionId = session ? session.id : null;

    if (start && nextSessionId !== sessionId) {
      await flush();
      start = null;
    }

    if (!start) {
      start = date;
      sessionId = nextSessionId;
    }
    previous = date;
  }

  await flush();
  return result;
}

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
  const dayCalendar = await getEffectiveDayStatus(classNo, date, { sessionId: (await sessionFor(date))?.id });
  if (dayCalendar.status === 'holiday') throw new HttpsError('failed-precondition', dayCalendar.title || 'This date is a holiday. Attendance cannot be marked.');

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
  const dayCalendar = await getEffectiveDayStatus(classNo, date, { sessionId: (await sessionFor(date))?.id });
  return { marks: s.exists ? s.get('marks') : {}, calendar: dayCalendar };
});

async function summaryFor(studentId, classNoFallback, from, to) {
  const sess = await currentSession().catch(() => null);
  from = from || (sess && sess.starts_on) || '1970-01-01';
  to = to || (sess && sess.ends_on) || '2999-12-31';

  const maxTo = istToday();
  if (to > maxTo) to = maxTo;
  if (from > to) return { working_days: 0, present: 0, absent: 0, leave: 0, percentage: 0 };

  const months = monthsBetween(from, to);
  if (months.length > 60) throw bad('Range too long.');

  const stuDocs = await db.getAll(...months.map(m => db.doc(`users/${studentId}/attendance/${m}`)));
  const classByMonth = {};
  const marksByDate = {};

  stuDocs.forEach((doc, i) => {
    if (!doc.exists) return;
    classByMonth[months[i]] = doc.get('class_no');
    Object.entries(doc.get('days') || {}).forEach(([date, status]) => {
      if (date >= from && date <= to) marksByDate[date] = status;
    });
  });

  const calendarByDate = {};
  for (const month of months) {
    const classNo = classByMonth[month] ?? classNoFallback;
    if (classNo === undefined || classNo === null) continue;

    const monthFrom = `${month}-01` < from ? from : `${month}-01`;
    const [year, monthNo] = month.split('-').map(Number);
    const monthLast = new Date(Date.UTC(year, monthNo, 0)).toISOString().slice(0, 10);
    const monthTo = monthLast > to ? to : monthLast;

    Object.assign(calendarByDate, await effectiveCalendarForRange(classNo, monthFrom, monthTo));
  }

  let working = 0, present = 0, absent = 0, leave = 0;

  Object.entries(calendarByDate).forEach(([date, day]) => {
    if (day.status !== 'working') return;
    working++;
    const status = marksByDate[date];
    if (status === 'present') present++;
    else if (status === 'absent') absent++;
    else if (status === 'leave') leave++;
  });

  return {
    working_days: working,
    present,
    absent,
    leave,
    percentage: working ? Math.round(present * 1000 / working) / 10 : 0
  };
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
  const studentDoc = await db.doc(`users/${sid}`).get();
  const classNo = (s.exists && s.get('class_no') !== undefined)
    ? s.get('class_no')
    : studentDoc.get('student.class_no');

  const [year, monthNo] = ym.split('-').map(Number);
  const monthFrom = `${ym}-01`;
  const monthTo = new Date(Date.UTC(year, monthNo, 0)).toISOString().slice(0, 10);
  const calendar = classNo === undefined || classNo === null
    ? {}
    : await effectiveCalendarForRange(classNo, monthFrom, monthTo);

  return { by_date: s.exists ? s.get('days') || {} : {}, calendar };
});

/** Students below a percentage (default 75) for a class and range (default: this month). Staff. */
exports.lowAttendance = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {};
  const classNo = int(b.class_no, 'Class', { min: -3, max: 12 });
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to see this class.');

  const threshold = b.threshold == null ? 75 : Number(b.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw bad('Threshold must be between 0 and 100.');

  const today = istToday();
  const from = b.from == null || b.from === '' ? today.slice(0, 7) + '-01' : b.from;
  const to = b.to == null || b.to === '' ? today : b.to;
  if (!isDate(from) || !isDate(to)) throw bad('Invalid attendance date range.');
  if (from > to) throw bad('Start date cannot be after end date.');

  const months = monthsBetween(from, to);
  if (months.length > 14) throw bad('Range too long.');

  const calendar = await effectiveCalendarForRange(classNo, from, to);
  const dates = Object.keys(calendar).filter(date => calendar[date].status === 'working');
  const working = dates.length;
  if (!working) return { working_days: 0, threshold, students: [] };

  const students = await db.collection('users').where('role', '==', 'student').where('student.class_no', '==', classNo).where('student.status', '==', 'active').get();
  const counts = {};
  students.forEach(student => { counts[student.id] = 0; });

  const days = await db.getAll(...dates.map(date => db.doc(`attendance/${classNo}_${date}`)));
  days.forEach(day => {
    if (day.exists) Object.entries(day.get('marks') || {}).forEach(([uid, status]) => {
      if (status === 'present' && uid in counts) counts[uid]++;
    });
  });

  const out = students.docs.map(student => ({
    student_id: student.id,
    name: student.get('full_name'),
    roll: student.get('student.roll_number'),
    present: counts[student.id],
    percentage: Math.round(counts[student.id] * 1000 / working) / 10
  })).filter(row => row.percentage < threshold).sort((a, b) => a.percentage - b.percentage);

  return { working_days: working, threshold, students: out };
});

/** Monthly attendance notice for ONE student (staff). Returns the data and the (stable) report number. */
exports.attendanceNotice = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const sid = String((request.data && request.data.student) || ''), ym = String((request.data && request.data.month) || '');
  if (!sid || !isMonth(ym)) throw bad('Student and month are required.');
  const info = await canSeeStudent(me, sid); const u = info.user;
  const from = `${ym}-01`, to = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const [mDoc, sess] = await Promise.all([
    db.doc(`users/${sid}/attendance/${ym}`).get(),
    db.collection('academic_sessions').where('starts_on', '<=', from).get()
  ]);

  const days = (mDoc.exists && mDoc.get('days')) || {};
  const cls = (mDoc.exists && mDoc.get('class_no')) ?? u.student.class_no;

  const calendar = await effectiveCalendarForRange(cls, from, to);
  const holidays = Object.keys(calendar).filter(date => calendar[date].status === 'holiday').sort();
  const workingDates = new Set(Object.keys(calendar).filter(date => calendar[date].status === 'working'));

  const by_date = {};
  let present = 0, absent = 0, leave = 0;

  Object.entries(days).forEach(([date, status]) => {
    if (!workingDates.has(date)) return;
    by_date[date] = status === 'present' ? 'P' : status === 'absent' ? 'A' : 'L';
    if (status === 'present') present++;
    else if (status === 'absent') absent++;
    else if (status === 'leave') leave++;
  });

  const working = workingDates.size;
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
  const today = istToday();
  if (!Array.isArray(classNos) || !classNos.length) return { present: 0, total: 0 };

  const session = await sessionFor(today);
  const sessionId = session ? session.id : null;

  const results = await Promise.all(classNos.map(async classNo => {
    const calendar = await getEffectiveDayStatus(classNo, today, { sessionId });
    if (calendar.status === 'holiday') return null;
    return db.doc(`attendance/${classNo}_${today}`).get();
  }));

  let present = 0, total = 0;

  results.forEach(doc => {
    if (!doc || !doc.exists) return;
    Object.values(doc.get('marks') || {}).forEach(status => {
      total++;
      if (status === 'present') present++;
    });
  });

  return { present, total };
};
