import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { fileBlobUrl } from '../core/storage.js';
import { $, $$, esc, empty, skeleton, toast } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'student', active: 'answer-sheets.html', title: 'Answer Sheets', subtitle: 'Your checked exam copies' });
content.innerHTML = `<section class="card" id="v">${skeleton(3)}</section>`;
const data = await qrows(query(col('answer_sheets'), where('student_id', '==', me.id), orderBy('created_at', 'desc')));
$('#v').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Exam</th><th>Subject</th><th>File</th><th></th></tr></thead><tbody>${data.map(a => `<tr><td>${esc(a.exam_name || '—')}</td><td>${esc(a.subject_name)}</td><td>${a.file_type.toUpperCase()}</td><td><button class="btn sm" data-o="${a.id}">View</button></td></tr>`).join('')}</tbody></table></div>` : empty('fa-file-pen', 'No answer sheets have been uploaded for you yet.');
$$('[data-o]').forEach(b => b.onclick = async () => { const a = data.find(x => x.id === b.dataset.o); try { window.open(await fileBlobUrl(a.file_path, 'answer-sheets'), '_blank'); } catch { toast('Could not open.', 'err'); } });
