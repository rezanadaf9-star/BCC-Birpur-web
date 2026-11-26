import { mountShell } from '../shared/shell.js';
import { ROOT } from '../core/auth.js';
import { pageStudents } from '../data/people.js';
import { $, esc } from '../shared/ui.js';
import { myClasses } from '../shared/classes-ui.js';
import { attendanceEnabled } from '../core/flags.js';
const ATT = await attendanceEnabled();
const role = document.documentElement.dataset.role;
const P = new URLSearchParams(location.search);
// Links such as print.html?doc=attendance&class=10 go straight to the document.
if (P.get('doc')) { const d = P.get('doc'); P.delete('doc'); location.replace(`${ROOT}print/${d}.html?${P}`); await new Promise(() => {}); }

const { me, content } = await mountShell({ role, active: 'print.html', title: 'Print Centre' });
const DOCS = [
  ['gradesheet', 'Report card: grade sheets', 'Colour. Print this first for the whole class, then flip the pages and print the covers.', true],
  ['cover', 'Report card: covers', 'Colour. Same student order as the grade sheets, so front and back line up.', true],
  ['receipt', 'Fee receipts', 'Black and white, four per A4 page.', role === 'admin'],
  ['attendance', 'Attendance notice (one student)', 'For parents of students with poor attendance. Printed for one student at a time.', ATT],
].filter(d => d[3]);
const cls = await myClasses(me);
content.innerHTML = `<section class="card" style="max-width:720px"><div class="card-head"><h3>What do you want to print?</h3></div>
  <div style="display:grid;gap:14px">
    <div><label class="f">Document</label><select class="input" id="doc">${DOCS.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select><p id="hint" style="font-size:13px;color:var(--muted);margin-top:6px"></p></div>
    <div><label class="f">Class</label><select class="input" id="cls">${cls.map(c => `<option value="${c.class_no}">${esc(c.label)}</option>`).join('')}</select></div>
    <div><label class="f">Student</label><select class="input" id="stu"><option value="">Whole class (in roll order)</option></select></div>
    <div id="mrow"><label class="f">Month</label><input class="input" type="month" id="month" value="${new Date().toISOString().slice(0, 7)}"></div>
    <button class="btn y" id="go"><i class="fa-solid fa-print"></i>Open print preview</button></div></section>`;
const hint = () => { $('#hint').textContent = DOCS.find(d => d[0] === $('#doc').value)[2]; $('#mrow').classList.toggle('hidden', ['gradesheet', 'cover'].includes($('#doc').value)); };
async function students() {
  const data = (await pageStudents({ classNo: $('#cls').value, status: 'active', size: 400 })).rows;
  const list = (data || []).sort((a, b) => String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }));
  $('#stu').innerHTML = '<option value="">Whole class (in roll order)</option>' + list.map(s => `<option value="${s.user_id}">${esc(s.roll_number || '–')} · ${esc(s.profiles.full_name)}</option>`).join('');
}
$('#doc').onchange = hint; $('#cls').onchange = students; hint(); students();
$('#go').onclick = () => { if ($('#doc').value === 'attendance' && !$('#stu').value) return alert('Choose the student. The attendance notice is printed for one student only.'); const q = new URLSearchParams({ class: $('#cls').value }); if ($('#stu').value) q.set('student', $('#stu').value); if (!$('#mrow').classList.contains('hidden')) q.set('month', $('#month').value); window.open(`${ROOT}print/${$('#doc').value}.html?${q}`, '_blank'); };
