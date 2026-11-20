import { mountShell } from '../shared/shell.js';
import { db, doc, updateDoc, addDoc, rows, col, query, where, orderBy, serverTimestamp } from '../core/db.js';
import { listTeachers, countStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { FEATURES } from '../core/permissions.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, modal, toast, skeleton } from '../shared/ui.js';
const { content } = await mountShell({ role: 'admin', active: 'classes.html', title: 'Classes & Features', subtitle: 'Create classes, subjects, feature access and promotion' });
content.innerHTML = `<section class="card"><div class="card-head"><h3>Classes</h3></div><div id="cls">${skeleton(3)}</div></section><section class="card"><div class="card-head"><h3>Academic session & promotion</h3></div><div id="sess"></div></section>`;
async function load() {
  const [cls, teachers] = await Promise.all([rows(query(col('classes'), orderBy('sort_order'))), listTeachers()]);
  const n = {}; await Promise.all(cls.filter(c => c.is_active).map(async c => { n[c.class_no] = await countStudents({ classNo: c.class_no, status: 'active' }); }));
  const tch = teachers.flatMap(t => (t.teacher?.assignments || []).filter(a => a.is_class_teacher).map(a => ({ class_no: a.class_no, profiles: { full_name: t.full_name } })));
  $('#cls').innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${cls.map(c => `<div class="class-card" style="${c.is_active ? '' : 'opacity:.6;border-bottom-color:var(--grey-300)'}"><b>${esc(c.label)}</b><span>${c.is_active ? `${n[c.class_no] || 0} students` : 'Not active'}</span>
    <span>${esc((tch || []).find(t => t.class_no === c.class_no)?.profiles.full_name || (c.is_active ? 'No class teacher' : ''))}</span>
    <div style="display:flex;gap:6px;margin-top:6px"><button class="btn ghost sm" data-m="${c.class_no}">Manage</button><button class="btn sm ${c.is_active ? 'red' : 'green'}" data-t="${c.class_no}">${c.is_active ? 'Archive' : 'Activate'}</button></div></div>`).join('')}</div>`;
  $$('[data-t]').forEach(b => b.onclick = async () => { const c = cls.find(x => x.class_no == b.dataset.t); if (c.is_active && !confirm(`Archive ${c.label}? It will disappear from class lists. Records are kept.`)) return;
    try { await updateDoc(doc(db, 'classes', String(c.class_no)), { is_active: !c.is_active }); toast('Updated.', 'ok'); load(); } catch (error) { toast(error.message, 'err'); } });
  $$('[data-m]').forEach(b => b.onclick = () => manage(cls.find(x => x.class_no == b.dataset.m)));
}
async function manage(c) {
  const subs = await rows(query(col('subjects'), where('class_no', '==', c.class_no), orderBy('name'))), fmap = c.features || {};
  const m = modal(`<h3>${esc(c.label)}</h3><h4 style="margin:14px 0 6px">Subjects</h4><div id="subs" style="display:flex;flex-wrap:wrap;gap:8px">${(subs || []).map(s => `<span class="tag">${esc(s.name)} <a href="#" data-ds="${s.id}" style="color:var(--red)">✕</a></span>`).join('') || '<span style="color:var(--muted)">No subjects yet.</span>'}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><input class="input" id="ns" placeholder="Add subject (e.g. Mathematics)"><button class="btn" id="as">Add</button></div>
    <h4 style="margin:18px 0 6px">What students of this class can see</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${Object.entries(FEATURES).map(([k, l]) => { return `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-f="${k}" ${fmap[k] ? 'checked' : ''}> ${esc(l)}</label>`; }).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-x>Close</button><button class="btn y" data-sv>Save features</button></div>`);
  m.querySelector('[data-x]').onclick = () => m.remove();
  m.querySelector('#as').onclick = async () => { const name = m.querySelector('#ns').value.trim(); if (!name) return; try { await addDoc(col('subjects'), { class_no: c.class_no, name, created_at: new Date().toISOString() }); m.remove(); manage(c); } catch (error) { toast(error.message, 'err'); } };
  m.querySelectorAll('[data-ds]').forEach(a => a.onclick = async e => { e.preventDefault(); if (!confirm('Remove this subject?')) return; try { await fn('deleteSubject', { subject_id: a.dataset.ds }); m.remove(); manage(c); } catch (error) { toast(error.message, 'err'); } });
  m.querySelector('[data-sv]').onclick = async () => { const features = {}; m.querySelectorAll('[data-f]').forEach(i => { features[i.dataset.f] = i.checked; });
    try { await updateDoc(doc(db, 'classes', String(c.class_no)), { features, features_updated_at: new Date().toISOString() }); c.features = features; toast('Saved. Students of this class see the change next time they open the app.', 'ok'); } catch (error) { toast(error.message, 'err'); } };
}
async function sessions() {
  const [s, cls] = await Promise.all([rows(query(col('academic_sessions'), orderBy('starts_on', 'desc'))), rows(query(col('classes'), where('is_active', '==', true), orderBy('sort_order')))]);
  const cur = (s || []).find(x => x.is_current);
  $('#sess').innerHTML = `<p>Current session: <b>${esc(cur?.label || 'not set')}</b></p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn ghost" id="ns">New session</button><button class="btn y" id="pr">Promote a class</button></div>`;
  $('#ns').onclick = () => formModal({ title: 'New academic session', fields: [{ id: 'label', label: 'Label', placeholder: '2027-28', required: true }, { id: 's', label: 'Starts on', type: 'date', half: true, required: true }, { id: 'e', label: 'Ends on', type: 'date', half: true, required: true }, { id: 'cur', label: 'Make this the current session', type: 'checkbox' }],
    onSubmit: async (v, mm) => { await fn('createAcademicSession', { label: v.label, starts_on: v.s, ends_on: v.e, is_current: !!v.cur }); mm.remove(); sessions(); } });
  $('#pr').onclick = () => { const opts = (cls || []).map(c => [c.class_no, c.label]), so = (s || []).map(x => [x.id, x.label]); formModal({ title: 'Promote a class', submitLabel: 'Promote', intro: 'Students keep their identity and all old records. New roll numbers follow the previous session\'s academic rank (not quiz rank).', fields: [
    { id: 'from', label: 'From class', type: 'select', options: opts, half: true }, { id: 'to', label: 'To class', type: 'select', options: opts, half: true },
    { id: 'fs', label: 'From session', type: 'select', options: so, half: true, value: cur?.id }, { id: 'ts', label: 'To session', type: 'select', options: so, half: true }],
    onSubmit: async (v, mm) => { if (v.fs === v.ts) throw new Error('Choose a different new session.'); if (!confirm('Promote this whole class now?')) return; const r = await fn('promoteClass', { from_class: Number(v.from), to_class: Number(v.to), from_session: v.fs, to_session: v.ts }); mm.remove(); toast(`${r.promoted} students promoted.`, 'ok'); load(); } }); };
}
load(); sessions();
