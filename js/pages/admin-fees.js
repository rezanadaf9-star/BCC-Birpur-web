import { mountShell } from '../shared/shell.js';
import { db, doc, setDoc, rows as qrows, one, col, query, where, orderBy } from '../core/db.js';
import { pageStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { signed, compressImage, upload, removeFile } from '../core/storage.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, inr, modal, toast, empty, skeleton } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'admin', active: 'fees.html', title: 'Fees', subtitle: 'Structure, monthly dues, payments and receipts' });
const P = new URLSearchParams(location.search), classNo = P.get('class'), sess = (await fn('currentSessionId', {})).id;
let period = P.get('month') || new Date().toISOString().slice(0, 7);
const settings = await one('fee_settings', 'main');
const showQR = async () => { const u = await signed(settings?.qr_path, 3600, 'bcc-content'); const m = modal(`<h3>Scan to pay</h3>${u ? `<img src="${u}" alt="UPI QR" style="max-width:300px;margin:12px auto;border-radius:12px">` : '<p style="margin:12px 0">No QR uploaded yet. Upload one in QR settings.</p>'}<p style="text-align:center">${esc(settings?.upi_id || '')}</p><p style="text-align:center;color:var(--muted);font-size:13px">Payment is recorded only after you confirm that the money has arrived.</p><button class="btn" data-x style="margin:12px auto 0;display:flex">Close</button>`); m.querySelector('[data-x]').onclick = () => m.remove(); };

if (!classNo) {
  content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3><button class="btn ghost" id="qr"><i class="fa-solid fa-qrcode"></i>UPI QR & payment note</button></div><div id="c"></div></section>`;
  $('#c').innerHTML = classCards(await myClasses(me), c => `?class=${c.class_no}`);
  $('#qr').onclick = () => formModal({ title: 'UPI QR & payment note', fields: [{ id: 'upi', label: 'UPI ID', value: settings?.upi_id, half: true }, { id: 'note', label: 'Note shown to guardians', value: settings?.payment_note, half: true }, { id: 'f', label: 'QR image (upload to replace)', type: 'file', accept: 'image/*' }],
    onSubmit: async (v, mm) => { let path = settings?.qr_path; if (v.f) { const old = path; path = (await upload('bcc-content', new File([await compressImage(v.f, 900)], 'qr.jpg', { type: 'image/jpeg' }), 'fees')).path; if (old) removeFile('bcc-content', old); }
      await setDoc(doc(db, 'fee_settings', 'main'), { upi_id: v.upi || null, payment_note: v.note || null, qr_path: path || null }, { merge: true }); mm.remove(); toast('Saved.', 'ok'); setTimeout(() => location.reload(), 500); } });
} else {
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="fees.html">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))}</h3></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="month" class="input" id="mo" value="${period}" style="width:auto"><button class="btn ghost" id="gen">Generate dues for month</button><button class="btn ghost" id="qr">Open QR</button><a class="btn ghost" id="pr" target="_blank" href="../print/receipt.html?class=${classNo}&month=${period}"><i class="fa-solid fa-print"></i>Print receipts</a></div></div><div id="dues">${skeleton(4)}</div></section>
    <section class="card"><div class="card-head"><h3>Fee structure (${esc(label(classNo))})</h3><button class="btn y" id="addfee"><i class="fa-solid fa-plus"></i>Add fee</button></div><div id="fs"></div></section>`;
  $('#qr').onclick = showQR;
  async function dues() {
    $('#pr').href = `../print/receipt.html?class=${classNo}&month=${period}`;
    const [st, inv] = await Promise.all([pageStudents({ classNo, status: 'active', size: 400 }).then(r => r.rows), qrows(query(col('fee_invoices'), where('class_no', '==', Number(classNo)), where('period', '==', period)))]);
    const rows = (st || []).sort((a, b) => String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true })).map(s => { const mine = (inv || []).filter(i => i.student_id === s.user_id);
      const fee = mine.reduce((t, i) => t + Number(i.amount) + Number(i.adjustment), 0), paid = mine.reduce((t, i) => t + Number(i.paid || 0), 0); return { s, mine, fee, paid, due: fee - paid }; });
    $('#dues').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Roll</th><th>Student</th><th>Fee</th><th>Paid</th><th>Due</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.s.roll_number || '–')}</td><td>${esc(r.s.profiles.full_name)}</td>${r.mine.length ? `<td>${inr(r.fee)}</td><td>${inr(r.paid)}</td><td><b style="color:${r.due > 0 ? 'var(--red)' : 'var(--green)'}">${inr(r.due)}</b></td><td style="white-space:nowrap"><button class="btn sm" data-p="${r.s.user_id}" ${r.due <= 0 ? 'disabled' : ''}>Record payment</button> <button class="btn ghost sm" data-a="${r.s.user_id}">Adjust</button> <a class="btn ghost sm" target="_blank" href="../print/receipt.html?student=${r.s.user_id}&class=${classNo}&month=${period}">Receipt</a></td>` : '<td colspan="4" style="color:var(--muted)">No dues generated for this month</td>'}</tr>`).join('')}</tbody></table></div>` : empty('fa-user-graduate', 'No students.');
    $$('[data-p]').forEach(b => b.onclick = () => pay(rows.find(r => r.s.user_id === b.dataset.p)));
    $$('[data-a]').forEach(b => b.onclick = () => adjust(rows.find(r => r.s.user_id === b.dataset.a)));
  }
  function pay(r) {
    const owing = r.mine.map(i => ({ ...i, due: Math.round((Number(i.amount) + Number(i.adjustment) - Number(i.paid || 0)) * 100) / 100 })).filter(i => i.due > 0);
    formModal({ title: `Record payment: ${r.s.profiles.full_name}`, submitLabel: 'Confirm money received', intro: 'Only record a payment after you have actually received it.', fields: [
      { id: 'method', label: 'Paid via', type: 'select', half: true, options: [['cash', 'Cash'], ['upi', 'UPI']] }, { id: 'date', label: 'Date', type: 'date', half: true, value: new Date().toISOString().slice(0, 10) },
      { id: 'ref', label: 'UPI transaction reference (UPI only)', half: true }, { id: 'rem', label: 'Remarks', half: true },
      ...owing.map(i => ({ id: 'c_' + i.id, label: `${i.category} (due ${i.due})`, type: 'number', min: 0, max: i.due, half: true, value: i.due }))],
      onSubmit: async (v, mm) => { const items = owing.map(i => ({ category: i.category, amount: Number(v['c_' + i.id]) })).filter(i => i.amount > 0);
        const data = await fn('recordFeePayment', { student_id: r.s.user_id, period, method: v.method, items, upi_ref: v.ref || null, remarks: v.rem || null, paid_on: v.date });
        mm.remove(); toast(`Payment recorded. Receipt ${data.receipt_no}.`, 'ok'); dues(); } }); }
  function adjust(r) { formModal({ title: `Adjust fee: ${r.s.profiles.full_name}`, intro: 'Use a negative number for a discount or exemption.', fields: [
    { id: 'inv', label: 'Fee', type: 'select', options: r.mine.map(i => [i.id, `${i.category} (${inr(i.amount)})`]) }, { id: 'adj', label: 'Adjustment (₹)', type: 'number', required: true, half: true }, { id: 'note', label: 'Reason', half: true }],
    onSubmit: async (v, mm) => { await fn('adjustInvoice', { invoice_id: v.inv, adjustment: Number(v.adj), note: v.note || null }); mm.remove(); toast('Adjusted.', 'ok'); dues(); } }); }
  async function structure() {
    const data = (await qrows(query(col('fee_structures'), where('class_no', '==', Number(classNo)), where('session_id', '==', sess)))).sort((a, b) => a.category.localeCompare(b.category));
    $('#fs').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Fee</th><th>Amount</th><th>Repeats</th><th>Due day</th><th>Remarks</th><th></th></tr></thead><tbody>${data.map(f => `<tr><td>${esc(f.category)}</td><td>${inr(f.amount)}</td><td>${f.frequency === 'monthly' ? 'Every month' : 'Once'}</td><td>${f.due_day}</td><td>${esc(f.remarks || '')}</td><td><button class="btn red sm" data-d="${f.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : empty('fa-indian-rupee-sign', 'No fees configured. Add Tuition Fee, Admission Fee and others.');
    $$('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Remove this fee? Dues already generated are kept.')) return; try { await fn('deleteFeeStructure', { id: b.dataset.d }); } catch (e) { toast(e.message, 'err'); } structure(); });
  }
  $('#addfee').onclick = () => formModal({ title: 'Add fee', fields: [{ id: 'cat', label: 'Fee name', placeholder: 'Tuition Fee', required: true }, { id: 'amt', label: 'Amount (₹)', type: 'number', min: 0, required: true, half: true }, { id: 'fq', label: 'Repeats', type: 'select', half: true, options: [['monthly', 'Every month'], ['one_time', 'One time']] }, { id: 'dd', label: 'Due day of month', type: 'number', min: 1, max: 28, value: 10, half: true }, { id: 'rm', label: 'Remarks', value: 'Please pay within 7 days.', half: true }],
    onSubmit: async (v, mm) => { await fn('saveFeeStructure', { class_no: Number(classNo), category: v.cat, amount: Number(v.amt), frequency: v.fq, due_day: Number(v.dd), remarks: v.rm || null }); mm.remove(); structure(); } });
  $('#mo').onchange = e => { period = e.target.value || period; dues(); };
  $('#gen').onclick = async () => { try { const r = await fn('generateInvoices', { class_no: Number(classNo), period }); toast(`${r.created} new dues created. Existing ones were not duplicated.`, 'ok'); dues(); } catch (error) { toast(error.message, 'err'); } };
  dues(); structure();
}
