'use strict';
// Fees. Money is only ever changed in a transaction, on the server, by the admin.
//   fee_structures/{session}_{class}_{slug}   what each class pays (one document per fee name: no duplicates)
//   fee_invoices/{uid}_{YYYY-MM}_{slug}        one due per student per month per fee name; `paid` is kept in step with payments in the same transaction
//   fee_payments/{id}                          a recorded payment (receipt number R-1001...), items embedded
//   fee_once/{session}_{uid}_{slug}            marks that a one-time fee was already billed this session
//   stats/fees                                 billed / paid totals and money collected per month, for the dashboard (no scanning)
//   fee_settings/main                          UPI id, note, QR path
const { onCall } = require('firebase-functions/v2/https');
const { admin, db, FieldValue, HttpsError, callOpts, nowIso, pad2, int, str, isoDate, bad, requireSession, audit, currentSession, istToday } = require('./common');
const cents = x => Math.round(Number(x) * 100) / 100;
const slug = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fee';
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
const statsRef = db.doc('stats/fees');

exports.saveFeeStructure = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const classNo = int(b.class_no, 'Class', { min: -3, max: 12 }); const sess = await currentSession();
  const category = str(b.category, 'Fee name', { min: 1, max: 60 }), amount = Number(b.amount), due_day = int(b.due_day == null ? 10 : b.due_day, 'Due day', { min: 1, max: 28 });
  if (!(amount >= 0 && amount < 10000000)) throw bad('Enter a valid amount.');
  if (!['monthly', 'one_time'].includes(b.frequency)) throw bad('Choose how often this fee repeats.');
  const ref = db.doc(`fee_structures/${sess.id}_${classNo}_${slug(category)}`);
  try { await ref.create({ class_no: classNo, session_id: sess.id, category, amount: cents(amount), frequency: b.frequency, due_day, remarks: str(b.remarks, 'Remarks', { max: 200 }), created_at: nowIso() }); }
  catch (e) { if (e.code === 6) throw new HttpsError('already-exists', 'This fee already exists for the class.'); throw e; }
  await audit(me.uid, 'fee_structure_added', ref.id, { amount }); return { id: ref.id };
});
exports.deleteFeeStructure = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const id = String((request.data && request.data.id) || ''); if (!id) throw bad('Fee is required.');
  await db.doc(`fee_structures/${id}`).delete(); await audit(me.uid, 'fee_structure_removed', id, null); return { ok: true };   // dues already generated are kept
});

/** Create the month's dues for a class. Running it twice never duplicates anything. Returns how many NEW dues were created. */
exports.generateInvoices = onCall({ ...callOpts, timeoutSeconds: 120 }, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const classNo = int(b.class_no, 'Class', { min: -3, max: 12 }), period = String(b.period || '');
  if (!isMonth(period)) throw bad('Choose a valid month.');
  const sess = await currentSession();
  const [structs, enr] = await Promise.all([db.collection('fee_structures').where('class_no', '==', classNo).where('session_id', '==', sess.id).get(),
    db.collectionGroup('enrollments').where('session_id', '==', sess.id).where('class_no', '==', classNo).get()]);
  const students = enr.docs.filter(d => d.get('status') === 'active').map(d => d.ref.parent.parent.id);
  const fees = structs.docs.map(d => d.data()); if (!fees.length || !students.length) return { created: 0 };
  const jobs = []; students.forEach(uid => fees.forEach(f => jobs.push({ uid, f })));
  let created = 0, billed = 0;
  for (let i = 0; i < jobs.length; i += 120) {
    const part = jobs.slice(i, i + 120);
    await db.runTransaction(async tx => {
      const invRefs = part.map(j => db.doc(`fee_invoices/${j.uid}_${period}_${slug(j.f.category)}`));
      const onceRefs = part.map(j => (j.f.frequency === 'one_time' ? db.doc(`fee_once/${sess.id}_${j.uid}_${slug(j.f.category)}`) : null));
      const [invs, onces] = await Promise.all([tx.getAll(...invRefs), Promise.all(onceRefs.map(r => (r ? tx.get(r) : null)))]);
      let c = 0, sum = 0;
      part.forEach((j, k) => {
        if (invs[k].exists) return; if (onces[k] && onces[k].exists) return;
        tx.create(invRefs[k], { student_id: j.uid, session_id: sess.id, class_no: classNo, period, category: j.f.category, amount: j.f.amount, adjustment: 0, adjustment_note: null, paid: 0,
          due_date: `${period}-${pad2(j.f.due_day)}`, remarks: j.f.remarks || null, created_at: nowIso() });
        if (onceRefs[k]) tx.set(onceRefs[k], { at: nowIso() });
        c++; sum += j.f.amount; });
      if (c) tx.set(statsRef, { billed: FieldValue.increment(sum) }, { merge: true });
      created += c; billed += sum;
    });
  }
  await audit(me.uid, 'invoices_generated', classNo, { period, created, billed }); return { created };
});

/** Admin: discount / exemption on one due. The new total may never fall below what was already paid. */
exports.adjustInvoice = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const ref = db.doc(`fee_invoices/${String(b.invoice_id || '')}`); const adj = Number(b.adjustment);
  if (!Number.isFinite(adj) || Math.abs(adj) > 10000000) throw bad('Enter a valid adjustment.');
  await db.runTransaction(async tx => {
    const s = await tx.get(ref); if (!s.exists) throw new HttpsError('not-found', 'Due not found.');
    const total = cents(s.get('amount') + adj);
    if (total < 0 || total < cents(s.get('paid') || 0)) throw new HttpsError('failed-precondition', 'The new total cannot be lower than the amount already paid.');
    tx.update(ref, { adjustment: cents(adj), adjustment_note: str(b.note, 'Reason', { max: 200 }) });
    tx.set(statsRef, { billed: FieldValue.increment(cents(adj - (s.get('adjustment') || 0))) }, { merge: true });
  });
  await audit(me.uid, 'fee_adjusted', b.invoice_id, { adjustment: adj }); return { ok: true };
});

/** Record money received. All-or-nothing: every line is checked against what is still due. */
exports.recordFeePayment = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const sid = String(b.student_id || ''), period = String(b.period || '');
  if (!sid || !isMonth(period)) throw bad('Student and month are required.');
  if (!['cash', 'upi'].includes(b.method)) throw bad('Invalid payment method.');
  const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ category: String(i.category || ''), amount: cents(i.amount) })).filter(i => i.amount > 0);
  if (!items.length) throw bad('Enter an amount to record.');
  const paid_on = isoDate(b.paid_on, 'Date') || istToday();
  const u = await db.doc(`users/${sid}`).get(); if (!u.exists || u.get('role') !== 'student') throw new HttpsError('not-found', 'Student not found.');
  const payRef = db.collection('fee_payments').doc(), counter = db.doc('counters/receipt');
  const out = await db.runTransaction(async tx => {
    const refs = items.map(i => db.doc(`fee_invoices/${sid}_${period}_${slug(i.category)}`));
    const [invs, c] = await Promise.all([tx.getAll(...refs), tx.get(counter)]);
    let total = 0; const lines = [];
    invs.forEach((s, k) => {
      if (!s.exists) throw new HttpsError('failed-precondition', `No invoice for ${items[k].category} in ${period}.`);
      const due = cents(s.get('amount') + s.get('adjustment') - (s.get('paid') || 0));
      if (items[k].amount > due) throw new HttpsError('failed-precondition', `${items[k].category} exceeds due amount (${due}).`);
      tx.update(refs[k], { paid: cents((s.get('paid') || 0) + items[k].amount) }); total = cents(total + items[k].amount); lines.push({ invoice_id: s.id, category: items[k].category, amount: items[k].amount }); });
    const n = (c.exists ? c.get('n') : 1000) + 1, receipt_no = `R-${n}`;
    tx.set(counter, { n });
    const pay = { receipt_no, student_id: sid, class_no: u.get('student.class_no'), period, method: b.method, upi_ref: str(b.upi_ref, 'UPI reference', { max: 60 }), remarks: str(b.remarks, 'Remarks', { max: 200 }), paid_on, total_amount: total, items: lines, recorded_by: me.uid, created_at: nowIso() };
    tx.set(payRef, pay);
    tx.set(statsRef, { paid: FieldValue.increment(total), collected: { [paid_on.slice(0, 7)]: FieldValue.increment(total) } }, { merge: true });
    return pay;
  });
  await audit(me.uid, 'fee_payment', sid, { payment: payRef.id, total: out.total_amount, method: b.method });
  return { id: payRef.id, ...out };
});

async function receiptFor(sid, period, userDoc) {
  const [inv, pay] = await Promise.all([db.collection('fee_invoices').where('student_id', '==', sid).where('period', '==', period).get(),
    db.collection('fee_payments').where('student_id', '==', sid).where('period', '==', period).orderBy('created_at', 'desc').limit(1).get()]);
  const by = {}; inv.docs.forEach(d => { const x = d.data(); const e = by[x.category] || (by[x.category] = { name: x.category, fee: 0, paid: 0 }); e.fee += x.amount + x.adjustment; e.paid += x.paid || 0; });
  const lines = Object.values(by).sort((a, c) => a.name.localeCompare(c.name)).map(l => ({ ...l, due: cents(l.fee - l.paid) }));
  const lp = pay.empty ? null : pay.docs[0].data(); const u = userDoc.data();
  return { student: { name: u.full_name, father_name: u.student.father_name, class_no: u.student.class_no, roll: u.student.roll_number, admission_no: u.student.admission_no },
    period, receipt_no: lp ? lp.receipt_no : null, paid_on: lp ? lp.paid_on : null, method: lp ? lp.method : null, lines };
}
/** Receipt data for one student (self, linked parent or admin) or a whole class (admin, in roll order). */
exports.getFeeReceipts = onCall({ ...callOpts, timeoutSeconds: 120 }, async request => {
  const me = await requireSession(request, ['admin', 'student', 'parent']);
  const b = request.data || {}; const period = String(b.period || ''); if (!isMonth(period)) throw bad('Choose a valid month.');
  let ids;
  if (me.role === 'student') ids = [me.uid];
  else if (me.role === 'parent') { const sid = String(b.student_id || ''); if (!(me.token.children || []).includes(sid)) throw new HttpsError('permission-denied', 'You are not allowed to see this receipt.'); ids = [sid]; }
  else if (b.student_id) ids = [String(b.student_id)];
  else { const classNo = int(b.class_no, 'Class', { min: -3, max: 12 });
    const st = await db.collection('users').where('role', '==', 'student').where('student.class_no', '==', classNo).where('student.status', '==', 'active').orderBy('student.roll_number').get(); ids = st.docs.map(d => d.id); }
  const docs = ids.length ? await db.getAll(...ids.map(i => db.doc(`users/${i}`))) : [];
  const out = []; for (const d of docs) { if (d.exists && d.get('role') === 'student') out.push(await receiptFor(d.id, period, d)); }
  return { receipts: out };
});

/** Dashboard money numbers, straight from the running totals (admin). */
exports.feeTotals = async function () {
  const s = await statsRef.get(); const d = s.exists ? s.data() : {};
  return { billed: d.billed || 0, paid: d.paid || 0, collected: d.collected || {} };
};
