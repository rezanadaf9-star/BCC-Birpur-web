'use strict';

// Secure admin operations for the BCC attendance calendar.

const { onCall } = require('firebase-functions/v2/https');
const {
  db, HttpsError, callOpts, str, int, bad,
  requireSession, audit, currentSession
} = require('./common');

const { validDate, weekdayOf } = require('./calendar');

async function getSession(sessionId) {
  const id = str(sessionId, 'Academic session', { min: 1, max: 150 });
  const snap = await db.doc(`academic_sessions/${id}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Academic session not found.');
  return { id: snap.id, ...snap.data() };
}

async function getClass(classNo) {
  const n = int(classNo, 'Class', { min: -3, max: 12 });
  const snap = await db.doc(`classes/${n}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Class not found.');
  return n;
}

function checkDateInSession(date, session) {
  if (!validDate(date)) throw bad('Invalid calendar date.');
  if (date < session.starts_on || date > session.ends_on) {
    throw bad('The date must be within the selected academic session.');
  }
}

function dateTarget(b) {
  return b.class_no === undefined || b.class_no === null || b.class_no === ''
    ? null
    : int(b.class_no, 'Class', { min: -3, max: 12 });
}

async function validateTarget(classNo) {
  if (classNo !== null) await getClass(classNo);
}

exports.getAttendanceCalendarSettings = onCall(callOpts, async request => {
  await requireSession(request, ['admin']);

  const b = request.data || {};
  const session = b.session_id
    ? await getSession(b.session_id)
    : await currentSession();

  const from = b.from || session.starts_on;
  const to = b.to || session.ends_on;

  checkDateInSession(from, session);
  checkDateInSession(to, session);
  if (from > to) throw bad('Start date cannot be after end date.');

  const dates = [];
  for (let d = new Date(`${from}T00:00:00.000Z`);
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
    if (dates.length > 62) throw bad('Choose a date range of 62 days or less.');
  }

  const refs = [
    db.doc(`attendance_weekly_rules/${session.id}`),
    ...dates.map(date => db.doc(`attendance_calendar/${date}`))
  ];

  const docs = [];
  for (let i = 0; i < refs.length; i += 400) {
    docs.push(...await db.getAll(...refs.slice(i, i + 400)));
  }

  const centreDates = [];
  const classDates = [];

  dates.forEach((date, i) => {
    const centre = docs[i + 1];
    if (centre.exists) centreDates.push({ date, ...centre.data(), target: 'centre' });
  });

  const classRefs = [];
  for (const date of dates) {
    const parent = db.doc(`attendance_calendar/${date}`);
    const children = await parent.collection('classes').get();
    children.forEach(doc => classDates.push({
      date, class_no: Number(doc.id), ...doc.data(), target: 'class'
    }));
  }

  const classWeeklySnap = await db.collection(
    `attendance_weekly_rules/${session.id}/classes`
  ).get();

  return {
    session: {
      id: session.id,
      label: session.label,
      starts_on: session.starts_on,
      ends_on: session.ends_on
    },
    weekly: docs[0].exists ? docs[0].data() : null,
    class_weekly: classWeeklySnap.docs.map(d => ({
      class_no: Number(d.id), ...d.data()
    })),
    centre_dates: centreDates,
    class_dates: classDates
  };
});

exports.saveAttendanceWeeklyRule = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  const session = await getSession(b.session_id);
  const classNo = dateTarget(b);

  if (b.weekday === null || b.weekday === '') {
    await validateTarget(classNo);
    const ref = classNo === null
      ? db.doc(`attendance_weekly_rules/${session.id}`)
      : db.doc(`attendance_weekly_rules/${session.id}/classes/${classNo}`);
    await ref.delete();
    await audit(me.uid, 'attendance_weekly_rule_removed', session.id, {
      class_no: classNo
    });
    return { ok: true };
  }

  const weekday = int(b.weekday, 'Weekday', { min: 0, max: 6 });
  await validateTarget(classNo);

  const ref = classNo === null
    ? db.doc(`attendance_weekly_rules/${session.id}`)
    : db.doc(`attendance_weekly_rules/${session.id}/classes/${classNo}`);

  await ref.set({
    weekday,
    updated_at: new Date().toISOString(),
    updated_by: me.uid
  });

  await audit(me.uid, 'attendance_weekly_rule_saved', session.id, {
    class_no: classNo, weekday
  });

  return { ok: true };
});

exports.saveAttendanceDateOverride = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  const session = await getSession(b.session_id);
  const date = str(b.date, 'Date', { min: 10, max: 10 });
  checkDateInSession(date, session);

  const classNo = dateTarget(b);
  await validateTarget(classNo);

  if (!['holiday', 'working'].includes(b.type)) {
    throw bad('Choose Holiday or Normal Day.');
  }

  const title = str(b.title, 'Occasion', { max: 100 }) || (
    b.type === 'holiday' ? 'Holiday' : 'Normal Day'
  );

  const ref = classNo === null
    ? db.doc(`attendance_calendar/${date}`)
    : db.doc(`attendance_calendar/${date}/classes/${classNo}`);

  await ref.set({
    type: b.type,
    title,
    updated_at: new Date().toISOString(),
    updated_by: me.uid
  });

  await audit(me.uid, 'attendance_date_override_saved', date, {
    class_no: classNo, type: b.type, title
  });

  return { ok: true };
});

exports.deleteAttendanceDateOverride = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {};
  const session = await getSession(b.session_id);
  const date = str(b.date, 'Date', { min: 10, max: 10 });
  checkDateInSession(date, session);

  const classNo = dateTarget(b);
  await validateTarget(classNo);

  const ref = classNo === null
    ? db.doc(`attendance_calendar/${date}`)
    : db.doc(`attendance_calendar/${date}/classes/${classNo}`);

  await ref.delete();

  await audit(me.uid, 'attendance_date_override_deleted', date, {
    class_no: classNo
  });

  return { ok: true };
});
