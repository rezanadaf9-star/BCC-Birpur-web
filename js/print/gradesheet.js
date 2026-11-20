import { start, esc, roman, label, ROOT, getSheets, rows, col, one, P, scope } from './common.js';
const COND = [['conduct','Conduct'],['public_speaking','Public Speaking'],['homework_completion','Homework Completion'],['effort','Effort for Improvement'],['art','Art Study']];
const num = v => v == null ? '' : (Math.round(v * 100) / 100).toString();
await start('Report card · grade sheets', async me => {
  const { classNo, student } = scope(me);
  const [sheets, rules, ps] = await Promise.all([getSheets(classNo, P.get('session'), student), rows(col('grade_rules')).then(r => r.sort((a, b) => b.min_pct - a.min_pct)), one('print_settings', 'main')]);
  const rule = pct => (rules || []).find(r => pct >= r.min_pct && pct < r.max_pct);
  const useSig = !!ps?.use_digital_signatures;     // only when admin switched digital signatures on
  const sig = (img, t) => `<div>${useSig ? `<img src="${ROOT}bcc-assets/${img}" alt="">` : ''}${t}</div>`;
  return (sheets || []).map(s => {
    const ex = s.exams;
    const row = (cb) => ex.map(cb).join('');
    const subjectRows = s.subjects.map(sub => `<tr><td class="lb sbj">${esc(sub.name)}</td>${row(e => {
      const c = sub.cells.find(c => c.n === e.n); return `<td class="v">${c ? num(c.fm) : ''}</td><td class="v">${c ? num(c.om) : ''}</td>`; })}</tr>`).join('');
    const d = e => e.declared;
    const gradeCell = e => { if (!d(e)) return '<td colspan="2" class="v"></td>'; const r = rule(Number(e.pct)); return `<td colspan="2" class="v"><b>${esc(r?.grade || '')}</b> – <span class="rm">${esc(r?.remark || '')}</span></td>`; };
    const cond = s.conduct || {}, fin = s.final;
    const rh = Math.max(5, Math.min(8, 122 / (s.subjects.length + 13))).toFixed(2);   // rows shrink for classes with more subjects
    return `<section class="page gs" style="--rh:${rh}mm">
      <img class="wm" src="${ROOT}bcc-assets/printable-logo.png" alt="">
      <div class="frame"></div>
      <div class="inner"><div class="title">BRILLIANT COACHING CENTRE</div>
      <div class="cols"><div>
        <table>
          <tr><th class="nv">Exams</th>${row(e => `<th class="nv exn" colspan="2">${esc(e.name)}</th>`)}</tr>
          <tr><th class="gr">Subjects</th>${row(() => '<th class="gr">F.M</th><th class="gr">O.M</th>')}</tr>
          ${subjectRows}
          <tr><td class="tt">Total</td>${row(e => `<td class="pl v">${d(e) ? num(e.fm) : ''}</td><td class="pl v">${d(e) ? num(e.om) : ''}</td>`)}</tr>
          <tr><td class="tt">Percentage</td>${row(e => `<td colspan="2" class="pl v">${d(e) ? num(e.pct) + '%' + (e.n > 1 ? `<span class="sub">Overall ${num(e.cum_pct)}%</span>` : '') : ''}</td>`)}</tr>
          <tr><td class="tt">Rank</td>${row(e => `<td colspan="2" class="pl v">${d(e) ? e.rank + (e.n > 1 ? `<span class="sub">Overall ${e.cum_rank}</span>` : '') : ''}</td>`)}</tr>
          <tr><td class="tt" rowspan="2">Attendance</td>${row(() => '<td class="gr">Present</td><td class="gr">Absent</td>')}</tr>
          <tr>${row(e => `<td class="v">${d(e) ? e.present : ''}</td><td class="v">${d(e) ? e.absent : ''}</td>`)}</tr>
          <tr><td class="lb">Grade &amp; Remarks</td>${row(gradeCell)}</tr>
          <tr><td class="lb" style="height:calc(var(--rh) * 1.8)">Guardian Signature</td>${row(() => '<td colspan="2"></td>')}</tr>
        </table>
        <div class="pol"><h4>GRADING SCALE &amp; POLICY</h4><p>Grades are awarded on the overall percentage obtained in each examination. &nbsp;F.M = Full Marks, &nbsp;O.M = Obtained Marks.</p>
          <table class="scale"><tr><td class="g" rowspan="2" style="width:17%">Grades</td><td>A+ = 90 - 100%</td><td>B = 70 - Below 80%</td><td>D = 45 - Below 60%</td><td class="g" style="background:#fff59d;color:#1b1464" rowspan="2">F = Below 30%</td></tr>
          <tr><td>A &nbsp;= 80 - Below 90%</td><td>C = 60 - Below 70%</td><td>E = 30 - Below 45%</td></tr></table></div>
        <div class="sign">${sig('director-signature.png', 'Signature of Director')}${sig('principal-signature.png', 'Signature of Principal')}</div>
      </div>
      <div class="side">
        <table><tr><th class="nv" colspan="2" style="height:9mm">Yearly Result</th></tr><tr><th class="gr" style="text-align:left">Attitude &amp; Engagement</th><th class="gr" style="width:22%">Grade</th></tr>
          ${COND.map(([k, l]) => `<tr><td class="lb" style="height:7mm">${l}</td><td class="val">${esc(cond[k] || '')}</td></tr>`).join('')}</table>
        <div class="legend"><b>Legend:</b><br>(O - Outstanding),<br>(S - Satisfactory),<br>(N - Need Improvement)</div>
        <table><tr><th class="nv" style="height:9mm">Final Result</th></tr>
          <tr><th class="gr">Final Total Marks</th></tr><tr><td class="val big">${fin ? `${num(fin.total_om)} / ${num(fin.total_fm)}` : ''}</td></tr>
          <tr><th class="gr">Final Total Percentage</th></tr><tr><td class="val big">${fin ? num(fin.pct) + '%' : ''}</td></tr>
          <tr><th class="gr">Final Rank</th></tr><tr><td class="val big">${fin ? fin.rank : ''}</td></tr></table>
      </div></div></div>
      <div class="foot">${esc(s.student.name)} · Roll ${esc(s.student.roll || '–')} · ${esc(roman(s.student.class_no))} · ${esc(s.session)}</div>
    </section>`; }).join('');
});
