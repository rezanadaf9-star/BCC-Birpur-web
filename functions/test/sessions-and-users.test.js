// Integration tests for sessions and account management against the emulators. Run:  npm run test:functions
// STATUS: written, NOT yet executed (no network in the build environment to install the emulator).
// Needs env: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099  GCLOUD_PROJECT=demo-bcc
const assert = require('assert');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-bcc';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), auth = admin.auth();
const PROJECT = process.env.GCLOUD_PROJECT, REGION = 'asia-south1';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1`;
const FN = n => `http://127.0.0.1:5001/${PROJECT}/${REGION}/${n}`;

const idTokenFor = async (email, password) => (await (await fetch(`${AUTH}/accounts:signInWithPassword?key=x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json()).idToken;
const exchange = async customToken => (await (await fetch(`${AUTH}/accounts:signInWithCustomToken?key=x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) })).json()).idToken;
async function call(name, data, idToken) {
  const r = await fetch(FN(name), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify({ data }) });
  return { status: r.status, body: await r.json() };
}
async function makeUser(role, email, extra = {}) {
  const rec = await auth.createUser({ email, password: 'Passw0rd!' });
  const user = { role, full_name: email, login_id: email, is_active: true, ...extra };
  await db.doc(`users/${rec.uid}`).set(user);
  const claims = role === 'student' ? { role, classNo: user.student.class_no } : { role };
  await auth.setCustomUserClaims(rec.uid, claims);
  return rec.uid;
}
/** sign in + register a device session; returns the session id token */
async function login(email, platform = 'web') {
  const first = await idTokenFor(email, 'Passw0rd!');
  const r = await call('registerSession', { platform, deviceLabel: 'test' }, first);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: await exchange(r.body.result.customToken), reg: r.body.result };
}

describe('device sessions', () => {
  let uid;
  before(async () => { uid = await makeUser('student', 'stu1@students.test', { student: { class_no: 10, roll_number: '01', status: 'active' } }); });
  it('allows two web sessions, the third replaces the oldest', async () => {
    const a = await login('stu1@students.test'); const b = await login('stu1@students.test'); const c = await login('stu1@students.test');
    assert.equal(a.reg.replaced_sessions, 0); assert.equal(b.reg.replaced_sessions, 0); assert.equal(c.reg.replaced_sessions, 1);
    const active = (await db.collection(`users/${uid}/sessions`).where('revoked_at', '==', null).get()).docs.filter(d => d.get('platform') === 'web');
    assert.equal(active.length, 2);
    const first = await db.doc(`users/${uid}/sessions/${a.reg.sessionId}`).get();
    assert.ok(first.get('revoked_at'), 'oldest session must be revoked');
  });
  it('counts the app separately from the web', async () => {
    const x = await login('stu1@students.test', 'android'); const y = await login('stu1@students.test', 'android');
    assert.equal(x.reg.replaced_sessions + y.reg.replaced_sessions, 0);
  });
  it('a paused account cannot register a session', async () => {
    await db.doc(`users/${uid}`).update({ is_active: false });
    const t = await idTokenFor('stu1@students.test', 'Passw0rd!');
    const r = await call('registerSession', { platform: 'web' }, t); assert.notEqual(r.status, 200);
    await db.doc(`users/${uid}`).update({ is_active: true });
  });
  it('rejects an unknown platform', async () => {
    const t = await idTokenFor('stu1@students.test', 'Passw0rd!'); const r = await call('registerSession', { platform: 'tv' }, t); assert.notEqual(r.status, 200);
  });
});

describe('account management', () => {
  let adminTok, studentTok;
  before(async () => {
    await makeUser('admin', 'adm@bcc.test'); await makeUser('student', 'stu2@students.test', { student: { class_no: 10, roll_number: '02', status: 'active' } });
    adminTok = (await login('adm@bcc.test')).token; studentTok = (await login('stu2@students.test')).token;
    await db.doc('classes/10').set({ class_no: 10, label: 'Class 10', is_active: true }); await db.collection('academic_sessions').add({ label: '2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31', is_current: true });
  });
  it('a student cannot create accounts', async () => { const r = await call('adminUsers', { type: 'student', full_name: 'X', class_no: 10, password: 'abcdefgh' }, studentTok); assert.equal(r.status, 403); });
  it('a call without a session is rejected', async () => { const r = await call('adminUsers', { type: 'student' }, null); assert.equal(r.status, 401); });
  it('admin creates a student: id format, claims, enrollment', async () => {
    const r = await call('adminUsers', { type: 'student', full_name: 'New Student', class_no: 10, password: 'abcdefgh' }, adminTok);
    assert.equal(r.status, 200, JSON.stringify(r.body)); const out = r.body.result;
    assert.match(out.login_id, /^26BCC10\d\d$/); assert.match(out.admission_no, /^BCC\/\d\d\/0001$/);
    const rec = await auth.getUser(out.user_id); assert.equal(rec.customClaims.role, 'student'); assert.equal(rec.customClaims.classNo, 10);
    assert.equal((await db.collection(`users/${out.user_id}/enrollments`).get()).size, 1);
  });
  it('rejects a short password and an inactive class', async () => {
    assert.notEqual((await call('adminUsers', { type: 'student', full_name: 'X', class_no: 10, password: 'short' }, adminTok)).status, 200);
    assert.notEqual((await call('adminUsers', { type: 'student', full_name: 'X', class_no: 9, password: 'abcdefgh' }, adminTok)).status, 200);
  });
  it('pausing a student signs them out everywhere', async () => {
    const s = await login('stu2@students.test'); const uid = (await auth.getUserByEmail('stu2@students.test')).uid;
    const r = await call('adminUsers', { action: 'set-status', user_id: uid, is_active: false }, adminTok); assert.equal(r.status, 200);
    const left = (await db.collection(`users/${uid}/sessions`).where('revoked_at', '==', null).get()).size; assert.equal(left, 0);
    assert.ok((await auth.getUser(uid)).disabled);
  });
});

describe('attendance', () => {
  let adminTok, teacherTok, otherTeacherTok, studentTok, parentTok;
  let studentUid, otherStudentUid;

  before(async () => {
    await db.collection('academic_sessions').get().then(async snap => {
      const batch = db.batch();
      snap.docs.forEach(d => batch.update(d.ref, { is_current: false }));
      await batch.commit();
    });

    await db.doc('academic_sessions/attendance-test').set({
      label: '2026-27',
      starts_on: '2026-04-01',
      ends_on: '2027-03-31',
      is_current: true
    });

    await db.doc('classes/10').set({
      class_no: 10, label: 'Class 10', is_active: true
    });

    studentUid = await makeUser('student', 'att-student@students.test', {
      student: { class_no: 10, roll_number: 'AT01', status: 'active' }
    });

    otherStudentUid = await makeUser('student', 'att-other@students.test', {
      student: { class_no: 10, roll_number: 'AT02', status: 'active' }
    });

    await makeUser('admin', 'att-admin@bcc.test');

    await makeUser('teacher', 'att-teacher@bcc.test', {
      teacher: { assignments: [{ class_no: 10 }] }
    });

    await makeUser('teacher', 'att-other-teacher@bcc.test', {
      teacher: { assignments: [{ class_no: 9 }] }
    });

    await makeUser('parent', 'att-parent@bcc.test', {
      parent: { children: [studentUid] }
    });

    adminTok = (await login('att-admin@bcc.test')).token;
    teacherTok = (await login('att-teacher@bcc.test')).token;
    otherTeacherTok = (await login('att-other-teacher@bcc.test')).token;
    studentTok = (await login('att-student@students.test')).token;
    parentTok = (await login('att-parent@bcc.test')).token;
  });

  it('allows assigned teacher to save class attendance and student to view own month', async () => {
    const date = '2026-11-19';

    const saved = await call('saveClassAttendance', {
      class_no: 10,
      date,
      rows: [
        { student_id: studentUid, status: 'present' },
        { student_id: otherStudentUid, status: 'absent' }
      ]
    }, teacherTok);

    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.result.saved, 2);

    const month = await call('attendanceMonth', {
      month: '2026-11'
    }, studentTok);

    assert.equal(month.status, 200, JSON.stringify(month.body));
    assert.equal(month.body.result.by_date[date], 'present');

    const summary = await call('attendanceSummary', { from: date, to: date }, studentTok);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.result.present, 1);
    assert.equal(summary.body.result.working_days, 1);
  });

  it('allows a parent to view their linked child but not an unrelated student', async () => {
    const allowed = await call('attendanceMonth', {
      student_id: studentUid, month: '2026-11'
    }, parentTok);

    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));

    const denied = await call('attendanceMonth', {
      student_id: otherStudentUid, month: '2026-11'
    }, parentTok);

    assert.equal(denied.status, 403);
  });

  it('denies a teacher access to a class outside their assignments', async () => {
    const result = await call('getClassAttendance', {
      class_no: 10, date: '2026-11-19'
    }, otherTeacherTok);

    assert.equal(result.status, 403);
  });

  it('denies a student from reading another student attendance', async () => {
    const result = await call('attendanceMonth', {
      student_id: otherStudentUid, month: '2026-11'
    }, studentTok);

    assert.equal(result.status, 403);
  });

  it('rejects impossible calendar dates', async () => {
    const result = await call('getClassAttendance', {
      class_no: 10, date: '2026-02-31'
    }, adminTok);

    assert.notEqual(result.status, 200);
  });

  it('rejects invalid attendance months', async () => {
    const result = await call('attendanceMonth', {
      month: '2026-13'
    }, studentTok);

    assert.notEqual(result.status, 200);
  });

  it('rejects attendance thresholds outside 0 to 100', async () => {
    const result = await call('lowAttendance', {
      class_no: 10, threshold: 150
    }, teacherTok);

    assert.notEqual(result.status, 200);
  });

  it('rejects a reversed attendance date range', async () => {
    const result = await call('lowAttendance', {
      class_no: 10,
      from: '2026-11-20',
      to: '2026-11-19'
    }, teacherTok);

    assert.notEqual(result.status, 200);
  });
});
