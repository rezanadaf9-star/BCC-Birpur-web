import { mountShell } from '../shared/shell.js';
import { db, doc, addDoc, setDoc, deleteDoc, rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, toast, empty, skeleton } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'ai-hub.html', title: 'AI Study Hub', subtitle: 'Study guides, NotebookLM / Gemini links for each class' });
const classNo = new URLSearchParams(location.search).get('class'), TYPES = { notes: 'Notes & summaries', lecture: 'Lecture companions', doubt: 'Doubt solving', ai: 'AI study assistant' };
if (!classNo) content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(await myClasses(me), c => `?class=${c.class_no}`)}</section>`;
else {
  const subs = await qrows(query(col('subjects'), where('class_no', '==', Number(classNo)), orderBy('name')));
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="ai-hub.html">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))} · AI Study Hub</h3></div><button class="btn y" id="add"><i class="fa-solid fa-plus"></i>Add resource</button></div><div id="v">${skeleton(3)}</div></section>`;
  const load = async () => { const data = await qrows(query(col('notebooklm_resources'), where('class_no', '==', Number(classNo)), orderBy('created_at', 'desc')));
    $('#v').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Title</th><th>Type</th><th>Subject</th><th>Shown</th><th></th></tr></thead><tbody>${data.map(r => `<tr><td>${esc(r.title)}<div style="font-size:12px;color:var(--muted)">${esc(r.url)}</div></td><td>${TYPES[r.resource_type]}</td><td>${esc(subs?.find(s => s.id === r.subject_id)?.name || 'All')}</td><td><span class="tag ${r.is_active ? 'g' : 'o'}">${r.is_active ? 'Yes' : 'Hidden'}</span></td><td style="white-space:nowrap"><a class="btn ghost sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>${isAdmin ? ` <button class="btn ghost sm" data-e="${r.id}">Edit</button> <button class="btn red sm" data-d="${r.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('fa-robot', 'No resources yet.');
    $$('[data-d]').forEach(b => b.onclick = async () => { if (confirm('Delete this resource?')) { await deleteDoc(doc(db, 'notebooklm_resources', b.dataset.d)); load(); } }); $$('[data-e]').forEach(b => b.onclick = () => form(data.find(x => x.id === b.dataset.e))); };
  const form = (r = {}) => formModal({ title: r.id ? 'Edit resource' : 'Add resource', fields: [{ id: 'title', label: 'Title', value: r.title, required: true }, { id: 'type', label: 'Type', type: 'select', half: true, value: r.resource_type, options: Object.entries(TYPES) }, { id: 'sub', label: 'Subject', type: 'select', half: true, value: r.subject_id || '', options: [['', 'All subjects'], ...(subs || []).map(s => [s.id, s.name])] },
    { id: 'url', label: 'Link (NotebookLM, Gemini, Google Drive…)', value: r.url, required: true }, { id: 'desc', label: 'Short description', type: 'textarea', value: r.description }, { id: 'act', label: 'Show to students', type: 'checkbox', value: r.is_active ?? true }],
    onSubmit: async (v, mm) => { if (!/^https?:\/\//i.test(v.url)) throw new Error('Enter a full link starting with https://'); const row = { class_no: Number(classNo), resource_type: v.type, subject_id: v.sub || null, title: v.title, url: v.url, description: v.desc || null, is_active: v.act };
      if (r.id) await setDoc(doc(db, 'notebooklm_resources', r.id), row, { merge: true }); else await addDoc(col('notebooklm_resources'), { ...row, created_by: me.id, created_at: new Date().toISOString() }); mm.remove(); load(); } });
  $('#add').onclick = () => form(); load();
}
