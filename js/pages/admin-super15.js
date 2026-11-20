import { mountShell } from '../shared/shell.js';
import { db, doc, setDoc, rows as qrows, col, query, orderBy } from '../core/db.js';
import { pageStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { upload, removeFile, fileBlobUrl } from '../core/storage.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, toast, empty, skeleton } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'super15.html', title: 'Super 15 Batch', subtitle: 'Members and study material' });
content.innerHTML = `<section class="card"><div class="card-head"><h3>Members</h3>${isAdmin ? '<button class="btn y" id="add"><i class="fa-solid fa-plus"></i>Add students</button>' : ''}</div><div id="mem">${skeleton(3)}</div></section>
  <section class="card"><div class="card-head"><h3>Materials & answer sheets</h3><button class="btn y" id="mat"><i class="fa-solid fa-upload"></i>Upload</button></div><div id="mats">${skeleton(2)}</div></section>`;
async function members() { const data = (await qrows(query(col('super15_members'), orderBy('added_at')))).map(m => ({ ...m, profiles: { full_name: m.name } })); const c = Object.fromEntries(data.map(x => [x.student_id, x]));
  $('#mem').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Student</th><th>Class</th><th>Status</th><th></th></tr></thead><tbody>${data.map(m => `<tr><td>${esc(m.profiles.full_name)}</td><td>${c[m.student_id]?.class_no ?? ''}</td><td><span class="tag ${m.is_active ? 'g' : 'o'}">${m.is_active ? 'Active' : 'Inactive'}</span></td><td>${isAdmin ? `<button class="btn ghost sm" data-t="${m.student_id}">${m.is_active ? 'Deactivate' : 'Reactivate'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('fa-users', 'No members yet.');
  $$('[data-t]').forEach(b => b.onclick = async () => { const m = data.find(x => x.student_id === b.dataset.t); await setDoc(doc(db, 'super15_members', m.student_id), { is_active: !m.is_active }, { merge: true }); members(); }); }
async function mats() { const data = await qrows(query(col('super15_materials'), orderBy('created_at', 'desc')));
  $('#mats').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><tbody>${data.map(m => `<tr><td><span class="tag">${m.kind === 'answer_sheet' ? 'Answer sheet' : 'Material'}</span></td><td>${esc(m.title)}</td><td><button class="btn ghost sm" data-o="${m.id}">Open</button> ${isAdmin ? `<button class="btn red sm" data-d="${m.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('fa-folder-open', 'Nothing uploaded yet.');
  $$('[data-o]').forEach(b => b.onclick = async () => { const m = data.find(x => x.id === b.dataset.o); try { window.open(m.url || await fileBlobUrl(m.file_path), '_blank'); } catch { toast('Could not open.', 'err'); } });
  $$('[data-d]').forEach(b => b.onclick = async () => { if (confirm('Delete?')) { try { await fn('deleteSuper15Material', { id: b.dataset.d }); } catch (e) { toast(e.message, 'err'); } mats(); } }); }
if (isAdmin) $('#add').onclick = async () => { const st = (await Promise.all([10, 12].map(c => pageStudents({ classNo: c, status: 'active', size: 400 })))).flatMap(r => r.rows);
  const ex = await qrows(col('super15_members')); const have = new Set(ex.map(x => x.student_id)); const list = st.filter(s => !have.has(s.user_id));
  formModal({ title: 'Add to Super 15', intro: 'Only Class 10 and Class 12 students can be added.', fields: [{ id: 'ids', label: 'Students', type: 'multi', required: true, options: list.map(s => [s.user_id, `Class ${s.class_no} · ${s.roll_number || '–'} · ${s.profiles.full_name}`]) }],
    onSubmit: async (v, mm) => { await fn('super15AddMembers', { ids: v.ids }); mm.remove(); members(); } }); };
$('#mat').onclick = () => formModal({ title: 'Upload to Super 15', fields: [{ id: 'title', label: 'Title', required: true }, { id: 'kind', label: 'Type', type: 'select', half: true, options: [['material', 'Study material'], ['answer_sheet', 'Answer sheet']] }, { id: 'f', label: 'File (PDF, JPG, PNG, Office, up to 15 MB)', type: 'file' }, { id: 'url', label: 'or a share link (Google Drive / OneDrive)', placeholder: 'https://…' }],
  onSubmit: async (v, mm) => { if (!v.f && !v.url) throw new Error('Add a file or a link.'); if (v.f && v.f.size > 15 * 1024 * 1024) throw new Error('The file is larger than 15 MB.'); const up = v.f ? await upload('bcc-content', v.f, 'super15') : null; try { await fn('saveSuper15Material', { kind: v.kind, title: v.title, file_path: up?.path, url: up ? undefined : v.url }); } catch (e) { if (up) await removeFile('bcc-content', up.path); throw e; } mm.remove(); mats(); } });
members(); mats();
