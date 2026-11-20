'use strict';
/**
 * One-time setup. Run on YOUR computer (never in the browser):
 *   cd functions && npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json     (Firebase console > Project settings > Service accounts)
 *   node scripts/bootstrap.js admin@example.com "A-strong-password"
 * Creates the first admin, the classes Nursery..12, the current session, class feature switches and the default grading scale.
 * Safe to run again: existing documents are left alone.
 */
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore(); const auth = admin.auth();

const FEATURES = ['lectures', 'notes', 'homework', 'marks', 'attendance', 'quizzes', 'quiz_leaderboard', 'results', 'fees', 'timetable',
  'answer_sheets', 'announcements', 'ptm', 'ai_tutor', 'ai_study_hub', 'motivational', 'alumni', 'group_discussion'];
const JUNIOR_OFF = ['lectures', 'notes', 'quizzes', 'quiz_leaderboard', 'ai_tutor', 'group_discussion'];   // same defaults as the old SQL seed
const CLASSES = [[-3, 'Nursery'], [-2, 'LKG'], [-1, 'UKG'], ...Array.from({ length: 12 }, (_, i) => [i + 1, `Class ${i + 1}`])];
const GRADES = [[90, 100.01, 'A+', 'Outstanding performance. Keep shining!'], [80, 90, 'A', 'Excellent work. Keep up the consistency.'],
  [70, 80, 'B', 'Very good effort. A little more practice will reach the top.'], [60, 70, 'C', 'Good. Regular revision will improve results.'],
  [45, 60, 'D', 'Satisfactory. Needs more focus and practice.'], [30, 45, 'E', 'Needs serious improvement. Extra attention required.'],
  [0, 30, 'F', 'Poor result. Please meet the teachers for support.']];

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password || password.length < 8) { console.error('Usage: node scripts/bootstrap.js <admin-email> <password of 8+ characters>'); process.exit(1); }
  const now = new Date().toISOString();

  // admin account
  let rec; try { rec = await auth.getUserByEmail(email); } catch { rec = await auth.createUser({ email, password, displayName: 'Administrator', emailVerified: true }); }
  await auth.setCustomUserClaims(rec.uid, { role: 'admin' });
  await db.doc(`users/${rec.uid}`).set({ role: 'admin', full_name: 'Administrator', login_id: email.toLowerCase(), is_active: true, photo_path: null, created_at: now }, { merge: true });
  await db.doc(`login_ids/${email.toLowerCase()}`).set({ uid: rec.uid, created_at: now }, { merge: true });
  console.log('Admin ready:', email, '(sign in on the Teacher card by typing ADMIN as the ID)');

  // classes + feature switches (10 and 12 active, as before)
  for (const [no, label] of CLASSES) {
    const ref = db.doc(`classes/${no}`);
    if ((await ref.get()).exists) continue;
    const features = {}; FEATURES.forEach(k => { features[k] = !(no < 9 && JUNIOR_OFF.includes(k)); });
    await ref.set({ class_no: no, label, sort_order: CLASSES.findIndex(c => c[0] === no) + 1, is_active: no === 10 || no === 12, class_teacher_id: null, features, created_at: now });
  }
  // current academic session
  const s = await db.collection('academic_sessions').where('is_current', '==', true).limit(1).get();
  if (s.empty) await db.collection('academic_sessions').add({ label: '2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31', is_current: true });
  // grading scale
  const g = await db.collection('grade_rules').limit(1).get();
  if (g.empty) { const b = db.batch(); GRADES.forEach(([min_pct, max_pct, grade, remark]) => b.set(db.collection('grade_rules').doc(), { min_pct, max_pct, grade, remark })); await b.commit(); }
  // website faculty (same people and order as the old database seed; photos are files already in the website)
  const fac = await db.collection('site_faculty').limit(1).get();
  if (fac.empty) {
    const people = [['Mr. Rehan Quasmi', 'Rehan Sir', 'Director of BCC', 'Physics, Chemistry, Mathematics, Biology', 'Classes 9–10', 'images/rehan-sir.png'],
      ['Mr. Zaki Quasmi', 'Zaki Sir', 'Principal of BCC', 'Social Sciences', 'Classes 8–10', 'images/zaki-sir.png'],
      ['Mr. Muntazir Akram', 'Muntazir Sir', 'Teacher of BCC', 'Urdu', 'Classes 1–10', 'images/muntazir-sir.png'],
      ['Mr. Imran Quasmi', 'Imran Sir', 'Teacher of BCC', 'All Subjects', 'Classes 1–8', 'images/imran-sir.png'],
      ['Mr. Faiz Anjum', 'Faiz Sir', 'Teacher of BCC', 'All Subjects', 'Classes 1–7', 'images/faiz-sir.png'],
      ['Miss Tazalli Perween', 'Tazalli Miss', 'Teacher of BCC', 'All Subjects', 'Classes 1–7', 'images/tazalli-miss.png'],
      ['Miss Mansabi Perween', 'Mansabi Miss', 'Teacher of BCC', 'All Subjects', 'Classes 1–7', 'images/mansabi-miss.png']];
    const b = db.batch();
    people.forEach(([name, short_name, designation, subjects, classes_text, photo_path], i) => b.set(db.collection('site_faculty').doc(), { name, short_name, designation, subjects, classes_text, qualification: null, photo_path, position: i + 1, is_published: true, created_at: now }));
    await b.commit();
  }
  console.log('Classes, current session, grading scale and website faculty are in place.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
