import { mountShell } from '../shared/shell.js';
import { rows as qrows, one, col, query, where, orderBy } from '../core/db.js';
import { pageStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { upload, fileBlobUrl, removeFile } from '../core/storage.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, toast, empty, skeleton, initials } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'answer-sheets.html', title: 'Answer Sheets' });
const P = new URLSearchParams(location.search), classNo = P.get('class'), stuId = P.get('student');
if (!classNo) content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(await myClasses(me), c => `?class=${c.class_no}`)}</section>`;
else if (!stuId) {
  const data = (await pageStudents({ classNo, status: 'active', size: 400 })).rows;
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="answer-sheets.html">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))}: choose a student</h3></div></div>${(data || []).length ? `<div class="table-wrap"><table class="t"><tbody>${data.sort((a, b) => String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true })).map(s => `<tr><td>${esc(s.roll_number || '–')}</td><td>${esc(s.profiles.full_name)}</td><td><a class="btn ghost sm" href="?class=${classNo}&student=${s.user_id}">Open</a></td></tr>`).join('')}</tbody></table></div>` : empty('fa-user-graduate', 'No students.')}</section>`;
} else {
  const [su, subs, exams] = await Promise.all([one('users', stuId), qrows(query(col('subjects'), where('class_no', '==', Number(classNo)), orderBy('name'))), qrows(query(col('exams'), where('class_no', '==', Number(classNo))))]); const st = { profiles: { full_name: su?.full_name || 'Student' } };
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="?class=${classNo}">← Students</a> <h3 style="display:inline;margin-left:8px">${esc(st.profiles.full_name)}</h3></div><button class="btn y" id="up"><i class="fa-solid fa-upload"></i>Upload pages</button></div><div id="list">${skeleton(3)}</div></section>`;
  const load = async () => { const data = await qrows(query(col('answer_sheets'), where('student_id', '==', stuId), orderBy('created_at', 'desc')));
    $('#list').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Exam</th><th>Subject</th><th>File</th><th></th></tr></thead><tbody>${data.map(a => `<tr><td>${esc(a.exam_name || '—')}</td><td>${esc(a.subject_name)}</td><td>${esc(a.file_type.toUpperCase())}</td><td><button class="btn ghost sm" data-o="${a.id}">View</button> ${isAdmin ? `<button class="btn red sm" data-d="${a.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('fa-file-pen', 'No answer sheets yet.');
    $$('[data-o]').forEach(b => b.onclick = async () => { const a = data.find(x => x.id === b.dataset.o); try { window.open(await fileBlobUrl(a.file_path, 'answer-sheets'), '_blank'); } catch { toast('Could not open.', 'err'); } });
    $$('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Delete this file?')) return; const a = data.find(x => x.id === b.dataset.d); try { await fn('deleteAnswerSheet', { id: a.id }); } catch (e) { toast(e.message, 'err'); } load(); }); };
  $('#up').onclick = () => formModal({ title: 'Upload answer sheet', fields: [{ id: 'exam', label: 'Exam', type: 'select', half: true, options: (exams || []).map(e => [e.id + '|' + e.exam_name, e.exam_name]) }, { id: 'sub', label: 'Subject', type: 'select', half: true, options: (subs || []).map(s => [s.name, s.name]) }, { id: 'f', label: 'Pages (PDF, JPG, PNG: select one or many)', type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png', required: true }],
    onSubmit: async (v, mm) => { const [eid, ename] = (v.exam || '|').split('|'); for (const f of v.f) { const ext = (f.name.split('.').pop() || '').toLowerCase(); if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) throw new Error('Only PDF, JPG and PNG are allowed.'); if (f.size > 15 * 1024 * 1024) throw new Error('A file is larger than 15 MB.');
        const { path } = await upload('answer-sheets', f, stuId); try { await fn('saveAnswerSheet', { student_id: stuId, exam_id: eid || null, exam_name: ename || null, subject_name: v.sub, file_path: path }); } catch (e) { await removeFile('answer-sheets', path); throw e; } }
      mm.remove(); toast('Uploaded.', 'ok'); load(); } });
  load();
}
