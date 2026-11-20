import { start, esc, roman, getSheets, P, scope } from './common.js';
await start('Report card · covers', async me => {
  const { classNo, student } = scope(me);
  const sheets = await getSheets(classNo, P.get('session'), student);
  // Same order as the grade sheets (by roll number), so the two print runs line up page for page.
  return (sheets || []).map(s => `<section class="page cv">
    <div class="f ses">ACADEMIC SESSION ${esc(String(s.session).replace('-', '–'))}</div>
    <div class="f hand nm">${esc(s.student.name)}</div>
    <div class="f hand rl">${esc(s.student.roll || '')}</div>
    <div class="f hand cl">${esc(roman(s.student.class_no))}</div></section>`).join('');
});
