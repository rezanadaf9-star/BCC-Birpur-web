import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy, limit } from '../core/db.js';
import { pageStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { activeClasses } from '../shared/api.js';
import { formModal } from '../shared/forms.js';
import { openMeeting, participantsHtml } from '../shared/meeting.js';
import { $, $$, esc, toast, empty, skeleton, modal, fmtIST, istInputToIso, isoToIstInput } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'meetings.html', title: 'PTM & Meetings', subtitle: 'Schedule or start PTM, motivational sessions and Super 15 classes' });
const classes = await activeClasses(), KINDS = { ptm: 'PTM', motivational: 'Motivational session', super15: 'Super 15 class' }; let tab = 'now';
content.innerHTML = `<section class="card"><div class="card-head"><h3>Meetings</h3><button class="btn y" id="new"><i class="fa-solid fa-plus"></i>Schedule or start a meeting</button></div>
  <div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn sm" data-t="now">Live &amp; upcoming</button><button class="btn sm ghost" data-t="old">History</button></div><div id="list">${skeleton(3)}</div></section><div id="stage"></div>`;
const audLabel = m => m.kind === 'super15' ? 'Super 15 batch' : m.audience === 'all' ? 'All classes' : m.audience === 'students' ? 'Selected students' : (m.target_classes || []).map(c => classes.find(x => x.class_no === c)?.label || c).join(', ');
async function load() {
  const data = await qrows(query(col('meetings'), where('status', 'in', tab === 'now' ? ['scheduled', 'live'] : ['ended', 'cancelled']), orderBy('created_at', 'desc'), limit(60)));
  $('#list').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Type</th><th>Title</th><th>Invited</th><th>Starts (IST)</th><th>Status</th><th></th></tr></thead><tbody>${data.map(m => { const mine = isAdmin || m.created_by === me.id;
    return `<tr><td>${KINDS[m.kind]}</td><td>${esc(m.title)}${m.speaker ? `<div style="font-size:12px;color:var(--muted)">${esc(m.speaker)}</div>` : ''}</td><td>${esc(audLabel(m))}${m.audience === 'students' ? ` (${m.invitee_count ?? 0})` : ''}</td><td>${m.start_at ? fmtIST(m.start_at) : '—'}</td><td><span class="tag ${m.status === 'live' ? 'r' : m.status === 'scheduled' ? 'o' : ''}">${m.status}</span></td>
    <td style="white-space:nowrap">${m.status === 'live' ? `<button class="btn sm" data-j="${m.id}">Join</button> ` : m.status === 'scheduled' && mine ? `<button class="btn green sm" data-l="${m.id}">Start now</button> <button class="btn ghost sm" data-rs="${m.id}">Reschedule</button> ` : ''}${mine && ['live', 'scheduled'].includes(m.status) ? `<button class="btn ghost sm" data-e="${m.id}">${m.status === 'live' ? 'End' : 'Cancel'}</button> ` : ''}<button class="btn ghost sm" data-w="${m.id}">Who joined (${m.participant_count ?? 0})</button></td></tr>`; }).join('')}</tbody></table></div>` : empty('fa-video', tab === 'now' ? 'Nothing live or scheduled.' : 'No past meetings.');
  const by = id => data.find(x => x.id === id), rpc = (name, args, ok) => fn(name, args).then(() => { toast(ok, 'ok'); load(); }).catch(error => toast(error.message, 'err'));
  $$('[data-l]').forEach(b => b.onclick = () => rpc('meetingSetStatus', { id: b.dataset.l, status: 'live' }, 'Live. Invited students were notified.'));
  $$('[data-e]').forEach(b => b.onclick = () => { const m = by(b.dataset.e); if (confirm(m.status === 'live' ? 'End this meeting for everyone?' : 'Cancel this meeting? Invited students will be told.')) rpc('meetingSetStatus', { id: m.id, status: m.status === 'live' ? 'ended' : 'cancelled' }, 'Done.'); });
  $$('[data-rs]').forEach(b => b.onclick = () => { const m = by(b.dataset.rs); formModal({ title: 'Change meeting time', intro: 'India Standard Time. Invited students are told, and the 10-minute reminder is set again.', fields: [{ id: 'w', label: 'New date and time (IST)', type: 'datetime-local', value: isoToIstInput(m.start_at), required: true }], onSubmit: async (v, mm) => { await fn('meetingReschedule', { id: m.id, when: istInputToIso(v.w) }); mm.remove(); toast('Time changed.', 'ok'); load(); } }); });
  $$('[data-w]').forEach(b => b.onclick = async () => { const m = by(b.dataset.w), md = modal(`<h3>Who joined</h3><p style="color:var(--muted);font-size:13px;margin:4px 0 10px">${esc(m.title)}</p><div id="pl">Loading…</div><button class="btn ghost" data-x style="margin-top:12px">Close</button>`); md.querySelector('[data-x]').onclick = () => md.remove(); md.querySelector('#pl').innerHTML = await participantsHtml(m.id); });
  $$('[data-j]').forEach(b => b.onclick = () => openMeeting({ id: b.dataset.j, host: $('#stage'), name: me.full_name, onClose: load }));
}
$$('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('[data-t]').forEach(x => x.classList.toggle('ghost', x !== b)); load(); });
$('#new').onclick = () => {
  const picked = new Map();   // student id -> name (kept while you switch classes)
  const m = formModal({ title: 'Schedule or start a meeting', submitLabel: 'Create', fields: [
    { id: 'kind', label: 'Type', type: 'select', half: true, options: Object.entries(KINDS).filter(([k]) => isAdmin || k !== 'super15') }, { id: 'title', label: 'Title', required: true, half: true }, { id: 'speaker', label: 'Speaker / teacher', half: true },
    { id: 'when', label: 'Starts (India time, IST)', type: 'datetime-local', half: true, hint: 'Invited students get a reminder 10 minutes before.' },
    { id: 'aud', label: 'Who is invited?', type: 'select', options: [...(isAdmin ? [['all', 'All classes']] : []), ['classes', 'Class-wise (choose classes)'], ['students', 'Individual students']] },
    { id: 'cl', label: 'Classes', type: 'multi', options: classes.map(c => [c.class_no, c.label]) }, { id: 'ccls', label: 'Choose a class to pick students from', type: 'select', options: [['', 'Select a class…'], ...classes.map(c => [c.class_no, c.label])] },
    { id: 'now', label: 'Start immediately (live now)', type: 'checkbox' }],
    onSubmit: async (v, mm) => { const aud = v.kind === 'super15' ? 'classes' : v.aud;
      if (!v.now && !v.when) throw new Error('Choose a start time, or tick “Start immediately”.');
      const iso = v.when ? istInputToIso(v.when) : null; if (iso && !v.now && new Date(iso) <= new Date()) throw new Error('Choose a start time in the future (India time).');
      await fn('createMeeting', { kind: v.kind, title: v.title, speaker: v.speaker || null, start: iso, audience: aud, classes: (v.cl || []).map(Number), students: [...picked.keys()], live: !!v.now });
      mm.remove(); toast(v.now ? 'Meeting is live. Invited students were notified.' : 'Meeting scheduled. Invited students were notified.', 'ok'); tab = 'now'; load(); } });
  const box = document.createElement('div'); box.style.cssText = 'grid-column:1/-1;display:none'; box.innerHTML = '<div id="slist" style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:8px"></div><p id="scount" style="font-size:13px;color:var(--muted);margin-top:6px">No students selected.</p>'; m.querySelector('#f_ccls').parentElement.after(box);
  const cnt = () => m.querySelector('#scount').textContent = picked.size ? `${picked.size} student${picked.size > 1 ? 's' : ''} selected.` : 'No students selected.';
  const sync = () => { const a = m.querySelector('#f_aud').value, k = m.querySelector('#f_kind').value, sp = k === 'super15', set = (id, on) => m.querySelector('#f_' + id).parentElement.style.display = on ? '' : 'none';
    m.querySelector('#f_aud').parentElement.style.display = sp ? 'none' : ''; set('cl', !sp && a === 'classes'); set('ccls', !sp && a === 'students'); box.style.display = !sp && a === 'students' ? '' : 'none'; };
  m.querySelector('#f_aud').onchange = m.querySelector('#f_kind').onchange = sync; sync();
  m.querySelector('#f_ccls').onchange = async e => { const c = e.target.value, el = m.querySelector('#slist'); if (!c) return el.innerHTML = ''; el.textContent = 'Loading…';
    const data = (await pageStudents({ classNo: c, status: 'active', size: 400 })).rows; const rows = (data || []).sort((a, b) => String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }));
    el.innerHTML = rows.length ? rows.map(s => `<label style="display:flex;gap:8px;align-items:center;padding:5px 4px"><input type="checkbox" data-s="${s.user_id}" data-n="${esc(s.profiles.full_name)}" ${picked.has(s.user_id) ? 'checked' : ''}> ${esc(s.roll_number || '–')} · ${esc(s.profiles.full_name)}</label>`).join('') : '<span style="color:var(--muted)">No students in this class.</span>';
    el.querySelectorAll('[data-s]').forEach(i => i.onchange = () => { i.checked ? picked.set(i.dataset.s, i.dataset.n) : picked.delete(i.dataset.s); cnt(); }); }; };
load();
