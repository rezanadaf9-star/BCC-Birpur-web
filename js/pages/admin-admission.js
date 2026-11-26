import { mountShell } from '../shared/shell.js';
import { pageStudents, countStudents } from '../data/people.js';
import { photo, compressImage, uploadProfilePhoto } from '../core/storage.js';
import { admin, genPassword, activeClasses } from '../shared/api.js';
import { formModal } from '../shared/forms.js';
import { showCredentials } from '../shared/credentials.js';
import { label } from '../core/classes.js';
import { $, $$, esc, initials, toast, empty, skeleton } from '../shared/ui.js';
const { content } = await mountShell({ role: 'admin', active: 'admission.html', title: 'Admission' });
const classes = await activeClasses();
content.innerHTML = `<section class="grid g4" id="sum"></section>
  <section class="card"><div class="card-head"><h3>Admission register</h3><button class="btn y" id="go"><i class="fa-solid fa-user-plus"></i>Admit new student</button></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px"><input class="input" id="q" placeholder="Search name, Student ID, admission no., father…" style="flex:1;min-width:220px">
      <select class="input" id="cl" style="width:auto"><option value="">All classes</option>${classes.map(c => `<option value="${c.class_no}">${esc(c.label)}</option>`).join('')}</select>
      <select class="input" id="st" style="width:auto"><option value="">All status</option><option value="active">Active</option><option value="paused">Paused</option><option value="left">Left</option></select></div>
    <div id="list">${skeleton(5)}</div><div style="text-align:center;margin-top:12px"><button class="btn ghost hidden" id="more">Load more</button></div></section>`;
let rows = [], cursor = null; const SIZE = 30;
const searchCache = new Map();      // filter -> up to 600 records, so typing in the search box does not read the database again
async function summary() { const [a, b, c] = await Promise.all(['active', 'paused', 'left'].map(st => countStudents({ status: st })));
  const t = a + b + c, card = (i, k, v, l) => `<div class="card stat"><div class="ico ${k}"><i class="fa-solid ${i}"></i></div><div><b>${v}</b><span>${l}</span></div></div>`;
  $('#sum').innerHTML = card('fa-id-card', '', t, 'Total admitted') + card('fa-user-check', 'g', a, 'Active') + card('fa-user-clock', 'y', b, 'Paused') + card('fa-user-minus', 'r', c, 'Left'); }
async function load(reset) {
  const q = $('#q').value.trim().toLowerCase(), search = !!q, f = { classNo: $('#cl').value || undefined, status: $('#st').value || undefined, orderBy: 'admitted' };
  if (reset) { cursor = null; rows = []; $('#list').innerHTML = skeleton(5); }
  try {
    if (search) {                                                  // searching looks through up to 600 records (read once per filter)
      const key = `${f.classNo || ''}|${f.status || ''}`; if (!searchCache.has(key)) searchCache.set(key, (await pageStudents({ ...f, size: 600 })).rows);
      rows = searchCache.get(key).filter(s => [s.profiles.full_name, s.profiles.login_id, s.admission_no, s.father_name, s.phone].join(' ').toLowerCase().includes(q)); $('#more').classList.add('hidden');
    } else { const r = await pageStudents({ ...f, after: cursor, size: SIZE }); cursor = r.last; rows = rows.concat(r.rows); $('#more').classList.toggle('hidden', !r.last); }
  } catch (error) { $('#list').innerHTML = empty('fa-triangle-exclamation', error.message); return; }
  draw();
}
function draw() {
  $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Admission no.</th><th>Student</th><th>Student ID</th><th>Class</th><th>Roll</th><th>Father</th><th>Phone</th><th>Admitted</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(s => `<tr>
    <td style="white-space:nowrap"><b>${esc(s.admission_no || '—')}</b></td><td><div style="display:flex;gap:10px;align-items:center"><span class="avatar" data-p="${esc(s.photo_path || '')}">${esc(initials(s.profiles.full_name))}</span><span style="white-space:nowrap">${esc(s.profiles.full_name)}</span></div></td>
    <td>${esc(s.profiles.login_id)}</td><td style="white-space:nowrap">${esc(label(s.class_no))}</td><td>${esc(s.roll_number || '–')}</td><td>${esc(s.father_name || '—')}</td><td>${esc(s.phone || '—')}</td><td style="white-space:nowrap">${esc(s.admitted_on || '—')}</td>
    <td><span class="tag ${s.status === 'active' ? 'g' : s.status === 'paused' ? 'o' : 'r'}">${esc(s.status)}</span>${s.left_on ? `<div style="font-size:11px;color:var(--muted)">${esc(s.left_on)}</div>` : ''}</td><td><a class="btn ghost sm" href="students.html?class=${s.class_no}">Open</a></td></tr>`).join('')}</tbody></table></div>` : empty('fa-id-card', 'No admissions match.');
  $$('.avatar[data-p]').forEach(async el => { if (el.dataset.p) { const u = await photo(el.dataset.p); if (u) el.innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover">`; } });
}
let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(() => load(true), 350); }; $('#cl').onchange = $('#st').onchange = () => load(true); $('#more').onclick = () => load(false);
$('#go').onclick = () => { if (!classes.length) return toast('No active class yet. Activate a class under Classes & Features first.', 'err');
  formModal({ title: 'Admit student', submitLabel: 'Create account', fields: [
    { id: 'full_name', label: 'Student full name', required: true },
    { id: 'class_no', label: 'Class', type: 'select', required: true, half: true, options: classes.map(c => [c.class_no, c.label]) }, { id: 'roll_number', label: 'Roll number', half: true, hint: 'Leave empty for the next free number' },
    { id: 'father_name', label: 'Father name', half: true }, { id: 'mother_name', label: 'Mother name', half: true },
    { id: 'dob', label: 'Date of birth', type: 'date', half: true }, { id: 'gender', label: 'Gender', type: 'select', half: true, options: [['', 'Select'], ['Male', 'Male'], ['Female', 'Female']] },
    { id: 'phone', label: 'Guardian phone', half: true }, { id: 'password', label: 'Password', half: true, value: genPassword(), required: true, hint: 'At least 8 characters' },
    { id: 'address', label: 'Address', type: 'textarea' }, { id: 'photo', label: 'Photo (optional)', type: 'file', accept: 'image/*' }],
    onSubmit: async (v, m) => { const r = await admin({ type: 'student', ...v, class_no: Number(v.class_no), photo: undefined });
      if (v.photo) { try { await uploadProfilePhoto(r.user_id, await compressImage(v.photo), r.user_id); } catch { toast('Account created, but the photo could not be uploaded.', 'err'); } }
      m.remove(); searchCache.clear(); load(true); summary(); showCredentials('Student admitted', [['Name', r.full_name], ['Student ID', r.login_id], ['Password', r.password], ['Admission No', r.admission_no], ['Roll No', r.roll_number]]); } }); };
summary(); load(true);
