'use strict';

// BCC central attendance calendar.
// Precedence: class date > centre date > legacy holiday >
// class weekly > centre weekly > default Sunday holiday.

const { db } = require('./common');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function weekdayOf(date) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function validWeeklyRule(data) {
  return !!data && Number.isInteger(data.weekday) && data.weekday >= 0 && data.weekday <= 6;
}

function normaliseOverride(data, source) {
  if (!data || !['holiday', 'working'].includes(data.type)) return null;
  return {
    type: data.type,
    status: data.type === 'holiday' ? 'holiday' : 'working',
    title: typeof data.title === 'string' ? data.title : '',
    source
  };
}

function makeStatus(date, type, title, source) {
  const weekday = weekdayOf(date);
  return {
    date,
    weekday,
    weekday_name: DAY_NAMES[weekday],
    type,
    status: type,
    title: title || '',
    source
  };
}

function datesBetween(from, to) {
  if (!validDate(from) || !validDate(to) || from > to) {
    throw new Error('Invalid calendar date range.');
  }

  const out = [];
  for (let d = new Date(`${from}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > 2000) throw new Error('Calendar range is too long.');
  }
  return out;
}

async function getEffectiveCalendarRange(classNo, from, to, options = {}) {
  const dates = datesBetween(from, to);
  const sessionId = options.sessionId || null;

  const refs = [];
  for (const date of dates) {
    refs.push(
      db.doc(`attendance_calendar/${date}`),
      db.doc(`attendance_calendar/${date}/classes/${classNo}`),
      db.doc(`centre_holidays/${date}`)
    );
  }

  if (sessionId) {
    refs.push(
      db.doc(`attendance_weekly_rules/${sessionId}`),
      db.doc(`attendance_weekly_rules/${sessionId}/classes/${classNo}`)
    );
  }

  // Keep each Firestore getAll request to a manageable size.
  const docs = [];
  for (let i = 0; i < refs.length; i += 400) {
    docs.push(...await db.getAll(...refs.slice(i, i + 400)));
  }

  const weeklyOffset = dates.length * 3;
  const centreWeekly = sessionId ? docs[weeklyOffset].data() : null;
  const classWeekly = sessionId ? docs[weeklyOffset + 1].data() : null;

  // An invalid class rule must not suppress a valid centre rule.
  const weekly = validWeeklyRule(classWeekly)
    ? { rule: classWeekly, source: 'class_weekly' }
    : validWeeklyRule(centreWeekly)
      ? { rule: centreWeekly, source: 'centre_weekly' }
      : null;

  const result = {};

  dates.forEach((date, i) => {
    const centreDate = normaliseOverride(docs[i * 3].data(), 'centre_date');
    const classDate = normaliseOverride(docs[i * 3 + 1].data(), 'class_date');
    const legacy = docs[i * 3 + 2];

    if (classDate) {
      result[date] = makeStatus(date, classDate.type, classDate.title, classDate.source);
      return;
    }

    if (centreDate) {
      result[date] = makeStatus(date, centreDate.type, centreDate.title, centreDate.source);
      return;
    }

    if (legacy.exists) {
      result[date] = makeStatus(date, 'holiday', legacy.get('title') || 'Holiday', 'legacy');
      return;
    }

    if (weekly) {
      const holiday = weekdayOf(date) === weekly.rule.weekday;
      result[date] = makeStatus(
        date,
        holiday ? 'holiday' : 'working',
        holiday ? `${DAY_NAMES[weekly.rule.weekday]} Holiday` : '',
        weekly.source
      );
      return;
    }

    const holiday = weekdayOf(date) === 0;
    result[date] = makeStatus(
      date,
      holiday ? 'holiday' : 'working',
      holiday ? 'Sunday Holiday' : '',
      'default'
    );
  });

  return result;
}

async function getEffectiveDayStatus(classNo, date, options = {}) {
  const result = await getEffectiveCalendarRange(classNo, date, date, options);
  return result[date];
}

module.exports = {
  DAY_NAMES,
  validDate,
  weekdayOf,
  getEffectiveDayStatus,
  getEffectiveCalendarRange
};
