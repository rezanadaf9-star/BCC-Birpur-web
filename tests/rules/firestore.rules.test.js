// Firestore security-rules tests. Run:  npm install && npm run test:rules      (needs Java + the Firebase emulator)
// STATUS: written, NOT yet executed (the build environment had no network access to install the emulator).
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where } = require('firebase/firestore');
const fs = require('fs');
const assert = require('assert');

let env;
const S10 = { role: 'student', classNo: 10, bsid: 's1' };
const T10 = { role: 'teacher', classes: [10], bsid: 's2' };
const ADMIN = { role: 'admin', bsid: 's3' };

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'bcc-rules-test', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/stu10a'), { role: 'student', full_name: 'A', login_id: '26BCC1001', is_active: true, student: { class_no: 10, roll_number: '01', status: 'active' } });
    await setDoc(doc(db, 'users/stu10b'), { role: 'student', full_name: 'B', login_id: '26BCC1002', is_active: true, student: { class_no: 10, roll_number: '02', status: 'active' } });
    await setDoc(doc(db, 'users/stu12'), { role: 'student', full_name: 'C', login_id: '26BCC1201', is_active: true, student: { class_no: 12, roll_number: '01', status: 'active' } });
    await setDoc(doc(db, 'users/tea1'), { role: 'teacher', full_name: 'T', login_id: 't@x.in', is_active: true, teacher: { assignments: [{ class_no: 10 }] } });
    await setDoc(doc(db, 'users/stu10a/sessions/s1'), { platform: 'web', revoked_at: null });
    await setDoc(doc(db, 'classes/10'), { class_no: 10, label: 'Class 10', is_active: true, features: { fees: true } });
    await setDoc(doc(db, 'site_faculty/f1'), { name: 'Pub', is_published: true, position: 1 });
    await setDoc(doc(db, 'site_faculty/f2'), { name: 'Hidden', is_published: false, position: 2 });
    await setDoc(doc(db, 'notifications/n1'), { audience: ['class_10'], title: 'x', created_at: '2026-11-07T00:00:00.000Z' });
    await setDoc(doc(db, 'notifications/n2'), { audience: ['class_12'], title: 'y', created_at: '2026-11-07T00:00:00.000Z' });
    await setDoc(doc(db, 'audit_log/a1'), { action: 'x' });
  });
});
const as = (uid, claims) => env.authenticatedContext(uid, claims).firestore();

describe('users', () => {
  it('student reads own profile', () => assertSucceeds(getDoc(doc(as('stu10a', S10), 'users/stu10a'))));
  it('student cannot read a classmate profile', () => assertFails(getDoc(doc(as('stu10a', S10), 'users/stu10b'))));
  it('student cannot change own class / marks fields', () => assertFails(updateDoc(doc(as('stu10a', S10), 'users/stu10a'), { 'student.class_no': 12 })));
  it('student cannot make themselves admin', () => assertFails(updateDoc(doc(as('stu10a', S10), 'users/stu10a'), { role: 'admin' })));
  it('signed-out user reads nothing', () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/stu10a'))));
  it('teacher lists students of an assigned class', () =>
    assertSucceeds(getDocs(query(collection(as('tea1', T10), 'users'), where('role', '==', 'student'), where('student.class_no', '==', 10)))));
  it('teacher cannot list students of another class', () =>
    assertFails(getDocs(query(collection(as('tea1', T10), 'users'), where('role', '==', 'student'), where('student.class_no', '==', 12)))));
  it('teacher cannot write a student', () => assertFails(updateDoc(doc(as('tea1', T10), 'users/stu10a'), { full_name: 'X' })));
  it('admin reads any profile but still cannot write from the client', async () => {
    await assertSucceeds(getDoc(doc(as('adm', ADMIN), 'users/stu12')));
    await assertFails(updateDoc(doc(as('adm', ADMIN), 'users/stu12'), { full_name: 'X' }));
  });
});
describe('sessions', () => {
  it('owner reads own session record', () => assertSucceeds(getDoc(doc(as('stu10a', S10), 'users/stu10a/sessions/s1'))));
  it('other user cannot read it', () => assertFails(getDoc(doc(as('stu10b', { role: 'student', classNo: 10, bsid: 'x' }), 'users/stu10a/sessions/s1'))));
  it('owner cannot un-revoke / edit it', () => assertFails(updateDoc(doc(as('stu10a', S10), 'users/stu10a/sessions/s1'), { revoked_at: null, platform: 'android' })));
});
describe('configuration', () => {
  it('signed-in student reads class config', () => assertSucceeds(getDoc(doc(as('stu10a', S10), 'classes/10'))));
  it('student cannot switch a feature on', () => assertFails(updateDoc(doc(as('stu10a', S10), 'classes/10'), { 'features.fees': false })));
  it('admin can edit class features', () => assertSucceeds(updateDoc(doc(as('adm', ADMIN), 'classes/10'), { 'features.fees': false })));
  it('teacher cannot edit class features', () => assertFails(updateDoc(doc(as('tea1', T10), 'classes/10'), { 'features.fees': false })));
});
describe('public website content', () => {
  it('anyone reads PUBLISHED faculty', () => assertSucceeds(getDocs(query(collection(env.unauthenticatedContext().firestore(), 'site_faculty'), where('is_published', '==', true)))));
  it('anyone cannot read hidden faculty', () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'site_faculty/f2'))));
  it('student cannot add faculty', () => assertFails(setDoc(doc(as('stu10a', S10), 'site_faculty/f9'), { name: 'x', is_published: true })));
});
describe('notifications', () => {
  it('student reads own class notification', () => assertSucceeds(getDoc(doc(as('stu10a', S10), 'notifications/n1'))));
  it('student cannot read another class notification', () => assertFails(getDoc(doc(as('stu10a', S10), 'notifications/n2'))));
  it('nobody writes notifications from the client', () => assertFails(setDoc(doc(as('adm', ADMIN), 'notifications/n9'), { audience: ['all'] })));
});
describe('server-only data', () => {
  it('audit log: admin reads, nobody writes', async () => {
    await assertSucceeds(getDoc(doc(as('adm', ADMIN), 'audit_log/a1')));
    await assertFails(getDoc(doc(as('tea1', T10), 'audit_log/a1')));
    await assertFails(setDoc(doc(as('adm', ADMIN), 'audit_log/a2'), { action: 'y' }));
  });
  it('login_ids and counters are closed', async () => {
    await assertFails(getDoc(doc(as('adm', ADMIN), 'login_ids/26BCC1001')));
    await assertFails(setDoc(doc(as('adm', ADMIN), 'counters/admission'), { n: 1 }));
  });
  it('unknown collections are denied by default', () => assertFails(getDoc(doc(as('adm', ADMIN), 'something_else/x'))));
});
