'use strict';
// Dashboards. Numbers are precomputed where possible and cached for a few minutes so that opening the app never scans collections.
//   stats_cache/{key}                       { at, data }   server-only cache of the staff dashboard (5 min)
//   users/{uid}/cache/dashboard             { at, data }   a student's own dashboard (10 min)
const { onCall } = require('firebase-functions/v2/https');
const { db, callOpts, nowIso, requireSession, currentSession, hotOpts } = require('./common');
const { attendanceToday, summaryFor } = require('./attendance');
const { feeTotals } = require('./fees');
const istNow = () => new Date(Date.now() + 5.5 * 3600e3).toISOString();
const count = async q => (await q.count().get()).data().count;

/** Admin: whole centre. Teacher: only their classes. */
exports.dashboardStats = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']); const key = me.role === 'admin' ? 'admin' : `teacher_${me.uid}`;
  const cref = db.doc(`stats_cache/${key}`), c = await cref.get();
  if (c.exists && Date.now() - Date.parse(c.get('at')) < 5 * 60e3) return c.get('data');
  const classes = me.role === 'admin' ? null : (me.token.classes || []);
  const stuQ = () => db.collection('users').where('role', '==', 'student');
  let active, other;
  if (!classes) { [active, other] = await Promise.all([count(stuQ().where('student.status', '==', 'active')), count(stuQ().where('student.status', 'in', ['paused', 'left']))]); }
  else { const r = await Promise.all(classes.map(cl => Promise.all([count(stuQ().where('student.class_no', '==', cl).where('student.status', '==', 'active')), count(stuQ().where('student.class_no', '==', cl).where('student.status', 'in', ['paused', 'left']))]))); active = r.reduce((t, x) => t + x[0], 0); other = r.reduce((t, x) => t + x[1], 0); }
  const classNos = classes || (await db.collection('classes').where('is_active', '==', true).get()).docs.map(d => d.get('class_no'));
  const [teachers, att, quizzes, fees] = await Promise.all([me.role === 'admin' ? count(db.collection('users').where('role', '==', 'teacher')) : null, attendanceToday(me, classNos),
    classes ? Promise.all(classes.map(cl => count(db.collection('quizzes').where('class_no', '==', cl).where('is_active', '==', true)))).then(a => a.reduce((t, x) => t + x, 0)) : count(db.collection('quizzes').where('is_active', '==', true)),
    me.role === 'admin' ? feeTotals() : null]);
  const types = [['lectures', 'Lecture', 'lectures.html'], ['notes', 'Notes', 'notes.html'], ['homework', 'Homework', 'homework.html'], ['quizzes', 'Quiz', 'quizzes.html']];
  const recent = (await Promise.all(types.map(async ([t, kind, href]) => { let q = db.collection(t); if (classes) { if (!classes.length) return []; q = q.where('class_no', 'in', classes.slice(0, 30)); }
    return (await q.orderBy('created_at', 'desc').limit(5).get()).docs.map(d => ({ id: d.id, title: d.get('title'), class_no: d.get('class_no'), created_at: d.get('created_at'), kind, href })); }))).flat()
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  const month = istNow().slice(0, 7);
  const data = { active, other, teachers, present: att.present, marked: att.total, quizzes, collected_month: fees ? (fees.collected[month] || 0) : null, pending: fees ? Math.max(0, fees.billed - fees.paid) : null, recent };
  await cref.set({ at: nowIso(), data }); return data;
});

/** Everything the student dashboard shows, in one call. */
exports.studentDashboard = onCall(hotOpts, async request => {
  const me = await requireSession(request, ['student']); const cref = db.doc(`users/${me.uid}/cache/dashboard`), c = await cref.get();
  if (c.exists && Date.now() - Date.parse(c.get('at')) < 10 * 60e3) return c.get('data');
  const sess = await currentSession(); const classNo = me.token.classNo; const today = istNow().slice(0, 10), ym = today.slice(0, 7);
  const [sheet, lb, att, month, ann] = await Promise.all([db.doc(`gradesheets/${sess.id}_${me.uid}`).get(), db.doc(`exam_leaderboards/${sess.id}_${classNo}`).get(), summaryFor(me.uid, classNo).catch(() => null),
    db.doc(`users/${me.uid}/attendance/${ym}`).get(),
    Promise.all([null, classNo].map(t => db.collection('announcements').where('is_active', '==', true).where('target_class', '==', t).orderBy('publish_at', 'desc').limit(3).get()))]);
  let marks = null, subjects = [], top = [];
  if (sheet.exists) { const s = sheet.data(); const decl = (s.exams || []).filter(e => e.declared && e.fm != null); const last = decl[decl.length - 1];
    if (last) { marks = { pct: last.cum_pct, rank: last.cum_rank, total_om: last.cum_om, total_fm: last.cum_fm, exam_name: last.name };
      subjects = (s.subjects || []).map(sub => { const cell = sub.cells.find(x => x.n === last.n); return cell ? { name: sub.name, fm: cell.fm, om: cell.om } : null; }).filter(Boolean); } }
  if (lb.exists && lb.get('exams').length) { const n = lb.get('exams')[lb.get('exams').length - 1].n; top = ((lb.get('boards')[n] || {}).cum || []).slice(0, 3).map(r => ({ name: r.name, pct: r.pct })); }
  const nowIso_ = new Date().toISOString();
  const notices = ann.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).filter(a => a.publish_at <= nowIso_).sort((a, b) => b.publish_at.localeCompare(a.publish_at)).slice(0, 3).map(a => ({ title: a.title, headline: a.headline, accent: a.accent, publish_at: a.publish_at }));
  const data = { marks, subjects, top, attendance: att, today: month.exists ? (month.get('days') || {})[today] || null : null, notices };
  await cref.set({ at: nowIso(), data }); return data;
});
