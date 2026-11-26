import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { $, $$, esc, empty, skeleton } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'student', active: 'ai-hub.html', title: 'AI Study Hub' });
const TYPES = { notes: ['Notes & summaries', 'fa-file-lines'], lecture: ['Lecture companions', 'fa-circle-play'], doubt: ['Doubt solving', 'fa-circle-question'], ai: ['AI study assistant', 'fa-robot'] };
let type = 'notes', sub = '';
const [res, subs] = await Promise.all([qrows(query(col('notebooklm_resources'), where('class_no', '==', me.student.class_no), where('is_active', '==', true), orderBy('created_at', 'desc'))), qrows(query(col('subjects'), where('class_no', '==', me.student.class_no), orderBy('name')))]);
content.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(TYPES).map(([k, [l, i]]) => `<button class="btn sm ${k === type ? '' : 'ghost'}" data-t="${k}"><i class="fa-solid ${i}"></i>${l}</button>`).join('')}</div>
  <section class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn sm" data-s="">All subjects</button>${(subs || []).map(s => `<button class="btn sm ghost" data-s="${s.id}">${esc(s.name)}</button>`).join('')}</div><div id="v"></div></section>`;
const draw = () => { $$('[data-t]').forEach(b => b.classList.toggle('ghost', b.dataset.t !== type)); $$('[data-s]').forEach(b => b.classList.toggle('ghost', b.dataset.s !== sub));
  const L = (res || []).filter(r => r.resource_type === type && (!sub || r.subject_id === sub)); const name = id => subs?.find(s => s.id === id)?.name;
  $('#v').innerHTML = L.length ? `<div class="grid g3">${L.map(r => `<a class="card" href="${esc(r.url)}" target="_blank" rel="noopener" style="box-shadow:none;background:var(--yellow-wash)">${name(r.subject_id) ? `<span class="tag y">${esc(name(r.subject_id))}</span>` : ''}<h4 style="margin:8px 0 4px">${esc(r.title)}</h4><div style="font-size:13px;color:var(--muted)">${esc(r.description || '')}</div><div style="margin-top:8px;color:var(--navy);font-weight:600;font-size:13px">Open <i class="fa-solid fa-arrow-up-right-from-square"></i></div></a>`).join('')}</div>` : empty(TYPES[type][1], 'Nothing added here yet.'); };
$$('[data-t]').forEach(b => b.onclick = () => { type = b.dataset.t; draw(); }); $$('[data-s]').forEach(b => b.onclick = () => { sub = b.dataset.s; draw(); }); draw();
