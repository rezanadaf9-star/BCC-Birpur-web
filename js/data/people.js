// People data (students, teachers, classes, sessions). Documents keep the SAME field names the old tables had,
// so the pages render exactly as before. Student details live inside users/{uid}.student.
import { db, rows, one, col, doc, getDoc, getDocs, getCountFromServer, query, where, orderBy, limit, startAfter, collectionGroup } from '../core/db.js';

/** users/{uid} -> the old "student_profiles row with profiles" shape. */
export const studentRow = (id, d) => ({ ...d.student, user_id: id, photo_path: d.photo_path || null, profiles: { full_name: d.full_name, login_id: d.login_id, is_active: d.is_active } });

const sessionCache = new Map();
export async function sessionLabels() {
  if (!sessionCache.size) (await rows(query(col('academic_sessions')))).forEach(s => sessionCache.set(s.id, s));
  return sessionCache;
}

/** Students of one class, 30 at a time (cursor paging: no skipped reads). */
export async function pageStudents({ classNo, status, after, size = 30, orderBy: ord = 'roll' } = {}) {
  const f = [where('role', '==', 'student')];
  if (classNo != null && classNo !== '') f.push(where('student.class_no', '==', Number(classNo)));
  if (status) f.push(where('student.status', '==', status));
  const sort = ord === 'roll' ? [orderBy('student.roll_number')] : [orderBy('student.admitted_on', 'desc'), orderBy('student.admission_no', 'desc')];
  const q = query(col('users'), ...f, ...sort, ...(after ? [startAfter(after)] : []), limit(size));
  const snap = await getDocs(q);
  return { rows: snap.docs.map(d => studentRow(d.id, d.data())), last: snap.docs.length === size ? snap.docs[snap.docs.length - 1] : null };
}
export async function countStudents({ classNo, status } = {}) {
  const f = [where('role', '==', 'student')];
  if (classNo != null) f.push(where('student.class_no', '==', Number(classNo)));
  if (status) f.push(where('student.status', '==', status));
  return (await getCountFromServer(query(col('users'), ...f))).data().count;
}
/** Enrollment history of one student, newest first, with the session label. */
export async function enrollmentHistory(uid) {
  const [en, ses] = await Promise.all([rows(query(col('users', uid, 'enrollments'), orderBy('created_at'))), sessionLabels()]);
  return en.map(e => ({ ...e, academic_sessions: { label: ses.get(e.session_id)?.label || '' } }));
}

/** Classes this person may manage: admin = all active classes, teacher = assigned classes only (with student counts). */
export async function myClassesData(me) {
  let cls = await rows(query(col('classes'), where('is_active', '==', true), orderBy('sort_order')));
  if (me.role === 'teacher') { const mine = new Set((me.teacher?.assignments || []).map(a => a.class_no)); cls = cls.filter(c => mine.has(c.class_no)); }
  const counts = await Promise.all(cls.map(c => countStudents({ classNo: c.class_no, status: 'active' })));
  return cls.map((c, i) => ({ class_no: c.class_no, label: c.label, sort_order: c.sort_order, students: counts[i] }));
}
/** All teachers (admin). */
export const listTeachers = () => rows(query(col('users'), where('role', '==', 'teacher'), orderBy('full_name')));
/** Teacher list for pickers (id + name). Staff only. */
export const teacherNames = async () => (await listTeachers()).map(t => ({ id: t.id, full_name: t.full_name }));
export const teacherCount = async () => (await getCountFromServer(query(col('users'), where('role', '==', 'teacher')))).data().count;
export { one, rows };
