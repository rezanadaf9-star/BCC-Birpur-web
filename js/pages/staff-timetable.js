import { mountShell } from '../shared/shell.js';
import { db, doc, addDoc, setDoc, deleteDoc, rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { teacherNames } from '../data/people.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, toast, empty, skeleton } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'timetable.html', title: 'Timetable', subtitle: 'Class schedules' });
const classNo = new URLSearchParams(location.search).get('class'), DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
if (!classNo) content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(await myClasses(me), c => `?class=${c.class_no}`)}</section>`;
else {
  const [subs, tch] = await Promise.all([qrows(query(col('subjects'), where('class_no', '==', Number(classNo)), orderBy('name'))), isAdmin ? teacherNames() : Promise.resolve([])]);
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="timetable.html">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))} · Timetable</h3></div>${isAdmin ? '<button class="btn y" id="add"><i class="fa-solid fa-plus"></i>Add period</button>' : ''}</div><div id="tt">${skeleton(4)}</div></section>`;
  const load = async () => { const data = (await qrows(query(col('class_timetable'), where('class_no', '==', Number(classNo))))).sort((a, b) => (a.day_of_week - b.day_of_week) || String(a.start_time).localeCompare(b.start_time));
    $('#tt').innerHTML = (data || []).length ? DAYS.map((d, i) => { const rows = data.filter(x => x.day_of_week === i + 1); return rows.length ? `<h4 style="margin:14px 0 6px">${d}</h4><div class="table-wrap"><table class="t"><tbody>${rows.map(r => `<tr><td>${r.start_time.slice(0, 5)} – ${r.end_time.slice(0, 5)}</td><td>${esc(r.subject_name)}</td><td>${esc(r.teacher_name || '')}</td><td>${esc(r.room || '')}</td>${isAdmin ? `<td><button class="btn ghost sm" data-e="${r.id}">Edit</button> <button class="btn red sm" data-d="${r.id}">Delete</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''; }).join('') : empty('fa-clock', 'No timetable yet.');
    $$('[data-d]').forEach(b => b.onclick = async () => { if (confirm('Delete this period?')) { await deleteDoc(doc(db, 'class_timetable', b.dataset.d)); load(); } });
    $$('[data-e]').forEach(b => b.onclick = () => form(data.find(x => x.id === b.dataset.e))); };
  const form = (r = {}) => formModal({ title: r.id ? 'Edit period' : 'Add period', fields: [{ id: 'day', label: 'Day', type: 'select', half: true, value: r.day_of_week || 1, options: DAYS.map((d, i) => [i + 1, d]) }, { id: 'sub', label: 'Subject', type: 'select', half: true, value: r.subject_name, options: (subs || []).map(s => [s.name, s.name]) },
    { id: 'st', label: 'Start', type: 'time', half: true, value: r.start_time?.slice(0, 5), required: true }, { id: 'en', label: 'End', type: 'time', half: true, value: r.end_time?.slice(0, 5), required: true }, { id: 'tc', label: 'Teacher', type: 'select', half: true, value: r.teacher_id || '', options: [['', '—'], ...(tch || []).map(t => [t.id, t.full_name])] }, { id: 'rm', label: 'Room', half: true, value: r.room }],
    onSubmit: async (v, mm) => { const row = { class_no: Number(classNo), day_of_week: Number(v.day), start_time: v.st, end_time: v.en, subject_name: v.sub, teacher_id: v.tc || null, teacher_name: (tch.find(t => t.id === v.tc) || {}).full_name || null, room: v.rm || null }; if (r.id) await setDoc(doc(db, 'class_timetable', r.id), row, { merge: true }); else await addDoc(col('class_timetable'), { ...row, created_at: new Date().toISOString() }); mm.remove(); load(); } });
  if (isAdmin) $('#add').onclick = () => form(); load();
}
