// Extended Firestore/Storage security-rule tests for the audit fixes and the later collections.
// STATUS: written, NOT executed (the Firebase Emulator could not be installed without network access). Run: npm run test:rules
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where } = require('firebase/firestore');
const { ref, getBytes, uploadBytes } = require('firebase/storage');
const fs = require('fs');
let env;
const S10 = { role: 'student', classNo: 10, bsid: 's' }, S12 = { role: 'student', classNo: 12, bsid: 's' }, T10 = { role: 'teacher', classes: [10], bsid: 's' }, ADM = { role: 'admin', bsid: 's' }, PAR = { role: 'parent', children: ['kid'], bsid: 's' };
const NOSESS = { role: 'student', classNo: 10 };       // a token that has no registered device session
before(async () => { env = await initializeTestEnvironment({ projectId: 'bcc-rules-ext', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }, storage: { rules: fs.readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 } }); });
after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await env.withSecurityRulesDisabled(async c => { const db = c.firestore();
  await setDoc(doc(db, 'classes/10'), { class_no: 10, features: { quizzes: true, fees: true, alumni: true, notes: true, announcements: true, group_discussion: true } });
  await setDoc(doc(db, 'users/s10/sessions/s'), { revoked_at: null }); await setDoc(doc(db, 'users/s11/sessions/s'), { revoked_at: 'x' }); await setDoc(doc(db, 'users/kid/sessions/s'), { revoked_at: null }); await setDoc(doc(db, 'users/par/sessions/s'), { revoked_at: null }); await setDoc(doc(db, 'users/adm/sessions/s'), { revoked_at: null });
  await setDoc(doc(db, 'super15_members/active1'), { is_active: true }); await setDoc(doc(db, 'super15_members/paused1'), { is_active: false });
  await setDoc(doc(db, 'super15_materials/m1'), { kind: 'material', title: 'x' });
  await setDoc(doc(db, 'discussion_messages/d1'), { scope: 'super15', body: 'hi' }); await setDoc(doc(db, 'discussion_messages/d2'), { scope: 'class', class_no: 10, body: 'hi' }); await setDoc(doc(db, 'discussion_messages/d3'), { scope: 'class', class_no: 12, body: 'hi' });
  await setDoc(doc(db, 'fee_invoices/i1'), { student_id: 's10', amount: 100 }); await setDoc(doc(db, 'fee_invoices/i2'), { student_id: 'other', amount: 100 }); await setDoc(doc(db, 'fee_invoices/i3'), { student_id: 'kid', amount: 100 });
  await setDoc(doc(db, 'exams/e1'), { class_no: 10 }); await setDoc(doc(db, 'exams/e1/marks/s10'), { class_no: 10, marks: { a: 1 } });
  await setDoc(doc(db, 'gradesheets/x_s10'), { student: { id: 's10', class_no: 10 } }); await setDoc(doc(db, 'gradesheets/x_other'), { student: { id: 'other', class_no: 10 } });
  await setDoc(doc(db, 'quizzes/q1'), { class_no: 10, is_active: true }); await setDoc(doc(db, 'quizzes/q1/questions/a'), { correct_option: 'A' }); await setDoc(doc(db, 'quizzes/q1/attempts/s10'), { student_id: 's10', class_no: 10, score: 5 }); await setDoc(doc(db, 'quizzes/q1/attempts/other'), { student_id: 'other', class_no: 10, score: 9 });
  await setDoc(doc(db, 'quiz_packs/q1'), { full: [] }); await setDoc(doc(db, 'quiz_sessions/q1_s10'), {}); await setDoc(doc(db, 'meeting_rooms/m1'), { room: 'secret' });
  await setDoc(doc(db, 'meetings/m1'), { kind: 'ptm', audience: 'all' }); await setDoc(doc(db, 'notifications/n_user'), { audience: ['user_s10'] }); await setDoc(doc(db, 'notifications/n_all'), { audience: ['all'] });
  await setDoc(doc(db, 'alumni/a1'), { is_published: true }); await setDoc(doc(db, 'alumni/a2'), { is_published: false }); await setDoc(doc(db, 'answer_sheets/as1'), { student_id: 's10', class_no: 10 }); await setDoc(doc(db, 'answer_sheets/as2'), { student_id: 'other', class_no: 10 });
}); });
const as = (uid, c) => env.authenticatedContext(uid, c).firestore();
describe('Super 15 needs ACTIVE membership', () => {
  it('active member reads materials', () => assertSucceeds(getDoc(doc(as('active1', { ...S10 }), 'super15_materials/m1'))));
  it('paused member (document exists, is_active false) cannot', () => assertFails(getDoc(doc(as('paused1', { ...S10 }), 'super15_materials/m1'))));
  it('non-member cannot', () => assertFails(getDoc(doc(as('s10', S10), 'super15_materials/m1'))));
  it('paused member cannot read the Super 15 chat', () => assertFails(getDocs(query(collection(as('paused1', S10), 'discussion_messages'), where('scope', '==', 'super15')))));
  it('active member reads the Super 15 chat', () => assertSucceeds(getDocs(query(collection(as('active1', S10), 'discussion_messages'), where('scope', '==', 'super15')))));
  it('admin can pause a member but not change anything else', async () => { await assertSucceeds(updateDoc(doc(as('adm', ADM), 'super15_members/active1'), { is_active: false })); await assertFails(updateDoc(doc(as('adm', ADM), 'super15_members/active1'), { name: 'x' })); });
  it('a student cannot make themselves a member', () => assertFails(setDoc(doc(as('s10', S10), 'super15_members/s10'), { is_active: true })));
});
describe('fees, marks, results, quizzes: own data only', () => {
  it('student reads own invoice, not another student\'s', async () => { await assertSucceeds(getDoc(doc(as('s10', S10), 'fee_invoices/i1'))); await assertFails(getDoc(doc(as('s10', S10), 'fee_invoices/i2'))); });
  it('a replaced device (revoked session) cannot read fees', () => assertFails(getDoc(doc(as('s11', S10), 'fee_invoices/i1'))));
  it('a token without any session cannot read fees', () => assertFails(getDoc(doc(as('s10', NOSESS), 'fee_invoices/i1'))));
  it('parent reads only the linked child', async () => { await assertSucceeds(getDoc(doc(as('par', PAR), 'fee_invoices/i3'))); await assertFails(getDoc(doc(as('par', PAR), 'fee_invoices/i1'))); });
  it('no one writes an invoice from the browser', () => assertFails(updateDoc(doc(as('adm', ADM), 'fee_invoices/i1'), { amount: 0 })));
  it('student cannot read raw marks; teacher of the class can', async () => { await assertFails(getDoc(doc(as('s10', S10), 'exams/e1/marks/s10'))); await assertSucceeds(getDoc(doc(as('t', T10), 'exams/e1/marks/s10'))); });
  it('student reads own report card only', async () => { await assertSucceeds(getDoc(doc(as('s10', S10), 'gradesheets/x_s10'))); await assertFails(getDoc(doc(as('s10', S10), 'gradesheets/x_other'))); });
  it('student cannot read quiz answers, packs or sessions', async () => { await assertFails(getDoc(doc(as('s10', S10), 'quizzes/q1/questions/a'))); await assertFails(getDoc(doc(as('s10', S10), 'quiz_packs/q1'))); await assertFails(getDoc(doc(as('s10', S10), 'quiz_sessions/q1_s10'))); });
  it('student reads own attempt but not a classmate\'s', async () => { await assertSucceeds(getDoc(doc(as('s10', S10), 'quizzes/q1/attempts/s10'))); await assertFails(getDoc(doc(as('s10', S10), 'quizzes/q1/attempts/other'))); });
  it('class 12 student cannot read the class 10 quiz', () => assertFails(getDoc(doc(as('s12', S12), 'quizzes/q1'))));
  it('student cannot write an attempt (cannot set own score)', () => assertFails(setDoc(doc(as('s10', S10), 'quizzes/q1/attempts/s10'), { student_id: 's10', score: 999 })));
});
describe('other collections', () => {
  it('meeting room names are never readable', () => assertFails(getDoc(doc(as('adm', ADM), 'meeting_rooms/m1'))));
  it('students cannot list meetings', () => assertFails(getDoc(doc(as('s10', S10), 'meetings/m1'))));
  it('a personal notification is private; teachers cannot read it, the owner can', async () => { await assertSucceeds(getDoc(doc(as('s10', S10), 'notifications/n_user'))); await assertFails(getDoc(doc(as('t', T10), 'notifications/n_user'))); await assertSucceeds(getDoc(doc(as('t', T10), 'notifications/n_all'))); });
  it('students see published alumni only', async () => { await assertSucceeds(getDoc(doc(as('s10', S10), 'alumni/a1'))); await assertFails(getDoc(doc(as('s10', S10), 'alumni/a2'))); });
  it('answer sheets: own only', async () => { await assertSucceeds(getDoc(doc(as('s10', S10), 'answer_sheets/as1'))); await assertFails(getDoc(doc(as('s10', S10), 'answer_sheets/as2'))); });
  it('class chat: own class only', async () => { await assertSucceeds(getDocs(query(collection(as('s10', S10), 'discussion_messages'), where('scope', '==', 'class'), where('class_no', '==', 10)))); await assertFails(getDocs(query(collection(as('s10', S10), 'discussion_messages'), where('scope', '==', 'class'), where('class_no', '==', 12)))); });
});
describe('storage', () => {
  const st = (uid, c) => env.authenticatedContext(uid, c).storage();
  it('a student cannot read another class\'s notes file', async () => { await env.withSecurityRulesDisabled(async c => uploadBytes(ref(c.storage(), 'bcc-content/notes/10/a.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' })); await assertSucceeds(getBytes(ref(st('s10', S10), 'bcc-content/notes/10/a.pdf'))); await assertFails(getBytes(ref(st('s12', S12), 'bcc-content/notes/10/a.pdf'))); });
  it('a student cannot upload notes', () => assertFails(uploadBytes(ref(st('s10', S10), 'bcc-content/notes/10/b.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' })));
  it('a teacher of the class can upload a PDF; wrong type is refused', async () => { await assertSucceeds(uploadBytes(ref(st('t', T10), 'bcc-content/notes/10/c.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' })); await assertFails(uploadBytes(ref(st('t', T10), 'bcc-content/notes/10/c.exe'), new Uint8Array([1]), { contentType: 'application/x-msdownload' })); });
  it('Super 15 files: paused member refused', async () => { await env.withSecurityRulesDisabled(async c => uploadBytes(ref(c.storage(), 'bcc-content/super15/x.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' })); await assertFails(getBytes(ref(st('paused1', S10), 'bcc-content/super15/x.pdf'))); });
  it('a student can upload only their own profile photo', async () => { await assertSucceeds(uploadBytes(ref(st('s10', S10), 'student-photos/s10.jpg'), new Uint8Array([1]), { contentType: 'image/jpeg' })); await assertFails(uploadBytes(ref(st('s10', S10), 'student-photos/other.jpg'), new Uint8Array([1]), { contentType: 'image/jpeg' })); });
});
