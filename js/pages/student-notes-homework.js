import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { openViewer, sourceLabel } from '../shared/viewer.js';
import { $, $$, esc, toast, empty, skeleton, fmtDate } from '../shared/ui.js';
const type = document.documentElement.dataset.type, isNotes = type === 'notes';
const { me, content } = await mountShell({ role: 'student', active: type + '.html', title: isNotes ? 'Notes' : 'Homework' });
const subs = await qrows(query(col('subjects'), where('class_no', '==', me.student.class_no), orderBy('name')));
const sel = new URLSearchParams(location.search).get('subject') || subs?.[0]?.id;
content.innerHTML = `<section class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${(subs || []).map(s => `<a class="btn sm ${s.id === sel ? '' : 'ghost'}" href="?subject=${s.id}">${esc(s.name)}</a>`).join('') || '<span style="color:var(--muted)">No subjects yet.</span>'}</div><div id="l">${skeleton(3)}</div></section>`;
if (sel) { const data = await qrows(query(col(type), where('class_no', '==', me.student.class_no), where('subject_id', '==', sel), orderBy('created_at', 'desc'))); const today = new Date().toISOString().slice(0, 10);
  $('#l').innerHTML = (data || []).length ? data.map((n, i) => `<div style="padding:14px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div>${isNotes && i === 0 ? '<span class="tag y">Latest</span> ' : ''}<b>${esc(n.title)}</b><div style="color:var(--muted);font-size:13px">${fmtDate(n.created_at)}${!isNotes && n.due_date ? ` · Due ${esc(n.due_date)} ${n.due_date < today ? '<span class="tag r">Past due</span>' : '<span class="tag g">Open</span>'}` : ''}</div>${!isNotes && n.instructions ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(n.instructions)}</div>` : ''}</div>
    <div style="display:flex;gap:6px;align-items:center">${n.file_path || n.link_url ? `<span class="tag">${esc(sourceLabel[n.source_type] || '')}</span><button class="btn sm" data-o="${n.id}"><i class="fa-regular fa-eye"></i>Open</button>` : ''}</div></div>`).join('') : empty('fa-folder-open', 'Nothing here yet.');
  $$('[data-o]').forEach(b => b.onclick = () => openViewer(data.find(x => x.id === b.dataset.o))); }
else $('#l').innerHTML = '';
