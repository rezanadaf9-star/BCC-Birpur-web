import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, orderBy } from '../core/db.js';
import { fn } from '../shared/api.js';
import { formModal } from '../shared/forms.js';
import { activeClasses } from '../shared/api.js';
import { $, $$, esc, toast, empty, skeleton } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'admin', active: 'announcements.html', title: 'Announcements', subtitle: 'Notices for students' });
content.innerHTML = `<section class="card"><div class="card-head"><h3>Announcements</h3><button class="btn y" id="new"><i class="fa-solid fa-plus"></i>New announcement</button></div><div id="list">${skeleton(3)}</div></section>`;
const classes = await activeClasses();
async function load() { const data = await qrows(query(col('announcements'), orderBy('publish_at', 'desc')));
  $('#list').innerHTML = (data || []).length ? data.map(a => `<div style="padding:14px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(a.title)}</b><span><span class="tag">${a.target_class == null ? 'All classes' : (classes.find(c => c.class_no === a.target_class)?.label || a.target_class)}</span> <span class="tag ${a.is_active ? 'g' : 'o'}">${a.is_active ? 'Active' : 'Hidden'}</span></span></div><div style="color:var(--muted)">${esc(a.headline || '')}</div><div style="white-space:pre-wrap;margin:6px 0">${esc(a.body)}</div>
    <button class="btn ghost sm" data-e="${a.id}">Edit</button> <button class="btn ghost sm" data-t="${a.id}">${a.is_active ? 'Hide' : 'Show'}</button> <button class="btn red sm" data-d="${a.id}">Delete</button></div>`).join('') : empty('fa-bullhorn', 'No announcements yet.');
  $$('[data-d]').forEach(b => b.onclick = async () => { if (confirm('Delete?')) { try { await fn('deleteAnnouncement', { id: b.dataset.d }); } catch (e) { toast(e.message, 'err'); } load(); } });
  $$('[data-t]').forEach(b => b.onclick = async () => { const a = data.find(x => x.id === b.dataset.t); try { await fn('setAnnouncementActive', { id: a.id, is_active: !a.is_active }); } catch (e) { toast(e.message, 'err'); } load(); });
  $$('[data-e]').forEach(b => b.onclick = () => form(data.find(x => x.id === b.dataset.e))); }
const form = (a = {}) => formModal({ title: a.id ? 'Edit announcement' : 'New announcement', fields: [{ id: 'title', label: 'Title', value: a.title, required: true }, { id: 'headline', label: 'Headline', value: a.headline }, { id: 'body', label: 'Message', type: 'textarea', value: a.body, required: true },
  { id: 'accent', label: 'Colour', type: 'select', half: true, value: a.accent || 'navy', options: [['navy', 'Navy'], ['yellow', 'Yellow'], ['green', 'Green'], ['red', 'Red'], ['blue', 'Blue'], ['orange', 'Orange']] }, { id: 'target', label: 'Send to', type: 'select', half: true, value: a.target_class ?? '', options: [['', 'All classes'], ...classes.map(c => [c.class_no, c.label])] },
  { id: 'at', label: 'Publish date', type: 'datetime-local', half: true, value: a.publish_at ? new Date(new Date(a.publish_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' }, { id: 'act', label: 'Active', type: 'checkbox', value: a.is_active ?? true }],
  onSubmit: async (v, mm) => { await fn('saveAnnouncement', { id: a.id || undefined, title: v.title, headline: v.headline || null, body: v.body, accent: v.accent, target_class: v.target === '' ? null : Number(v.target), publish_at: v.at ? new Date(v.at).toISOString() : new Date().toISOString(), is_active: !!v.act }); mm.remove(); toast('Saved.', 'ok'); load(); } });
$('#new').onclick = () => form(); load();
