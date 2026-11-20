import { start, esc, roman, ROOT, fn, P, ddmmyyyy, monthName } from './common.js';
const n = v => Math.round(Number(v) || 0);
await start('Fee receipts', async me => {
  const period = P.get('month') || new Date().toISOString().slice(0, 7);
  const recs = (await fn('getFeeReceipts', { period, student_id: me.role === 'student' ? undefined : (P.get('student') || undefined), class_no: P.get('class') ? Number(P.get('class')) : undefined })).receipts.filter(r => r && r.lines?.length);
  const card = r => { const t = r.lines.reduce((a, l) => ({ fee: a.fee + n(l.fee), paid: a.paid + n(l.paid), due: a.due + n(l.due) }), { fee: 0, paid: 0, due: 0 });
    return `<div class="rc"><div class="hd"><img src="${ROOT}bcc-assets/logo.png" alt=""><div><b>BRILLIANT COACHING CENTRE</b>Kairi Birpur</div></div>
      <div class="ttl">FEE RECEIPT</div>
      <div class="info"><div><b>Name :</b> ${esc(r.student.name)}</div><div><b>Receipt No :</b> ${esc(r.receipt_no || '—')}</div>
        <div><b>Father Name :</b> ${esc(r.student.father_name || '')}</div><div><b>Date :</b> ${r.paid_on ? ddmmyyyy(r.paid_on) : ''}</div>
        <div><b>Class :</b> ${esc(roman(r.student.class_no))}</div><div><b>Admission No :</b> ${esc(r.student.admission_no || '')}</div>
        <div><b>Roll No :</b> ${esc(r.student.roll || '')}</div><div><b>Month :</b> ${esc(monthName(r.period))}</div></div>
      <table><tr><th>Fee Name</th><th>Fee</th><th>Paid</th><th>Due</th></tr>
        ${r.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${n(l.fee)}</td><td>${n(l.paid)}</td><td>${n(l.due)}</td></tr>`).join('')}
        <tr class="tot"><td>TOTAL</td><td>${t.fee}</td><td>${t.paid}</td><td>${t.due}</td></tr></table></div>`; };
  let out = ''; for (let i = 0; i < recs.length; i += 4) out += `<section class="page rc-page">${recs.slice(i, i + 4).map(card).join('')}</section>`;
  return out;     // four receipts per A4 page, new page after every fourth
});
