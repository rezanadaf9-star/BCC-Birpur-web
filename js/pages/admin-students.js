import { mountShell } from '../shared/shell.js';
import { pageStudents, enrollmentHistory } from '../data/people.js';
import { photo, compressImage, uploadProfilePhoto } from '../core/storage.js';
import { admin, fn } from '../shared/api.js';
import { formModal } from '../shared/forms.js';
import { showCredentials } from '../shared/credentials.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { $, $$, esc, initials, modal, toast, empty, skeleton } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'students.html', title: 'Students', subtitle: 'Admitted students, class by class' });
const classNo = new URLSearchParams(location.search).get('class');
if (!classNo) { const cls = await myClasses(me); content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(cls, c => `?class=${c.class_no}`)}</section>`; }
else {
  let q = '', rows = []; const SIZE = 30;
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="students.html">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))}</h3></div>
    <input class="input" id="q" placeholder="Search name, ID or roll…" style="max-width:260px"></div><div id="list">${skeleton(5)}</div><div style="text-align:center;margin-top:12px"><button class="btn ghost hidden" id="more">Load more</button></div></section>`;
  let cursor = null;
  async function load(reset) {
    if (reset) { cursor = null; rows = []; $('#list').innerHTML = skeleton(5); }
    let r; try { r = await pageStudents({ classNo, after: cursor, size: SIZE }); } catch (error) { $('#list').innerHTML = empty('fa-triangle-exclamation', error.message); return; }
    cursor = r.last; rows = rows.concat(r.rows); $('#more').classList.toggle('hidden', !r.last); draw();
  }
  function draw() {
    const shown = q ? rows.filter(s => (s.profiles.full_name + s.profiles.login_id + (s.roll_number || '')).toLowerCase().includes(q.toLowerCase())) : rows;
    $('#list').innerHTML = shown.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Roll</th><th>Student</th><th>Student ID</th><th>Admission no.</th><th>Status</th><th></th></tr></thead><tbody>${shown.map(s => `<tr>
      <td>${esc(s.roll_number || '–')}</td><td><div style="display:flex;gap:10px;align-items:center"><span class="avatar" data-p="${esc(s.photo_path || '')}">${esc(initials(s.profiles.full_name))}</span>${esc(s.profiles.full_name)}</div></td>
      <td>${esc(s.profiles.login_id)}</td><td>${esc(s.admission_no || '')}</td><td><span class="tag ${s.status === 'active' ? 'g' : 'o'}">${esc(s.status)}</span></td><td><button class="btn ghost sm" data-v="${s.user_id}">Open</button></td></tr>`).join('')}</tbody></table></div>` : empty('fa-user-graduate', 'No students found.');
    $$('[data-v]').forEach(b => b.onclick = () => profile(rows.find(s => s.user_id === b.dataset.v)));
    $$('.avatar[data-p]').forEach(async el => { if (el.dataset.p) { const u = await photo(el.dataset.p); if (u) el.innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover">`; } });
  }
  async function profile(s) {
    const hist = await enrollmentHistory(s.user_id).catch(() => []);
    const url = await photo(s.photo_path); const act = s.status === 'active';
    const m = modal(`<div style="display:flex;gap:16px;align-items:center;margin-bottom:14px">${url ? `<img src="${url}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover">` : `<span class="avatar" style="width:84px;height:84px;font-size:28px">${esc(initials(s.profiles.full_name))}</span>`}
      <div><h3>${esc(s.profiles.full_name)}</h3><span class="tag ${act ? 'g' : 'o'}">${esc(s.status)}</span> <span class="tag">${esc(label(classNo))} · Roll ${esc(s.roll_number || '–')}</span></div></div>
      <div class="grid g2" style="font-size:14px;gap:8px">${[['Student ID', s.profiles.login_id], ['Admission no.', s.admission_no], ['Father', s.father_name], ['Mother', s.mother_name], ['Date of birth', s.dob], ['Gender', s.gender], ['Guardian phone', s.phone], ['Admitted on', s.admitted_on], ['Left / paused on', s.left_on], ['Address', s.address]].map(([l, v]) => `<div><span style="color:var(--muted)">${l}</span><br><b>${esc(v || '—')}</b></div>`).join('')}</div>
      <h4 style="margin:16px 0 6px">Monitoring</h4><div id="mon" style="font-size:13.5px;color:var(--muted)">Loading…</div><h4 style="margin:14px 0 6px">Quiz history</h4><div id="qh" style="font-size:13.5px">Loading…</div><div style="margin-top:10px"><a class="btn ghost sm" target="_blank" href="../print/attendance.html?student=${s.user_id}&class=${classNo}"><i class="fa-solid fa-print"></i>Attendance notice</a></div><h4 style="margin:16px 0 6px">History</h4><div style="font-size:13.5px">${(hist || []).map(h => `<div>${esc(h.academic_sessions?.label || '')}: ${esc(label(h.class_no))}, roll ${esc(h.roll_number || '–')} <span class="tag">${esc(h.status)}</span></div>`).join('') || '—'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">${isAdmin ? `<button class="btn sm" data-e>Edit</button><button class="btn ghost sm" data-ph>Change photo</button><button class="btn ghost sm" data-r>Reset password</button><button class="btn sm ${act ? 'red' : 'green'}" data-s>${act ? 'Pause / leave' : 'Reactivate'}</button>` : ''}<button class="btn ghost sm" data-x style="margin-left:auto">Close</button></div>`);
    m.querySelector('[data-x]').onclick = () => m.remove();
    fn('studentMonitoring', { student_id: s.user_id, class_no: Number(classNo) }).then(r => {
      const att = r.attendance, last = r.latest_result, qa = r.quizzes || [];
      const mon = m.querySelector('#mon'); if (mon) mon.innerHTML = `Attendance: <b>${att ? att.percentage + '%' : '—'}</b> (${att?.present ?? 0} present / ${att?.absent ?? 0} absent) · Latest result: <b>${last ? last.cum_pct + '% · rank ' + last.cum_rank : '—'}</b> · Quizzes attempted: <b>${qa.length}</b>${qa.length ? ' (average ' + Math.round(qa.reduce((t, x) => t + (x.total_marks ? x.score * 100 / x.total_marks : 0), 0) / qa.length) + '%)' : ''}`;
      const el = m.querySelector('#qh'); if (el) el.innerHTML = (r.recent_quizzes || []).length ? r.recent_quizzes.map(a => `<div>${esc(a.title || 'Quiz')}: <b>${a.score} / ${a.total_marks}</b> <small style="color:var(--muted)">${a.submitted_at ? new Date(a.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : ''}</small></div>`).join('') : '<span style="color:var(--muted)">No quizzes attempted yet.</span>';
    }).catch(() => { const mon = m.querySelector('#mon'); if (mon) mon.textContent = 'Monitoring is not available right now.'; const el = m.querySelector('#qh'); if (el) el.textContent = '—'; });
    if (isAdmin) m.querySelector('[data-e]').onclick = () => { m.remove(); formModal({ title: 'Edit student', fields: [
      { id: 'full_name', label: 'Full name', value: s.profiles.full_name, required: true }, { id: 'roll_number', label: 'Roll number', value: s.roll_number, half: true }, { id: 'phone', label: 'Guardian phone', value: s.phone, half: true },
      { id: 'father_name', label: 'Father name', value: s.father_name, half: true }, { id: 'mother_name', label: 'Mother name', value: s.mother_name, half: true },
      { id: 'dob', label: 'Date of birth', type: 'date', value: s.dob, half: true }, { id: 'gender', label: 'Gender', type: 'select', value: s.gender || '', half: true, options: [['', '—'], ['Male', 'Male'], ['Female', 'Female']] },
      { id: 'address', label: 'Address', type: 'textarea', value: s.address }],
      onSubmit: async (v, mm) => { await fn('updateStudent', { user_id: s.user_id, ...v }); mm.remove(); toast('Saved.', 'ok'); load(true); } }); };
    if (isAdmin) m.querySelector('[data-ph]').onclick = () => { m.remove(); formModal({ title: 'Change photo', fields: [{ id: 'f', label: 'New photo', type: 'file', accept: 'image/*', required: true }], onSubmit: async (v, mm) => {
      await uploadProfilePhoto(s.user_id, await compressImage(v.f), s.user_id); mm.remove(); toast('Photo updated.', 'ok'); load(true); } }); };
    if (isAdmin) m.querySelector('[data-r]').onclick = () => { m.remove(); formModal({ title: 'Reset student password', intro: 'A new password is generated. Confirm with your own admin password.', submitLabel: 'Reset', fields: [
      { id: 'admin_password', label: 'Your admin password', type: 'password', required: true }, { id: 'password', label: 'New password (leave empty to generate)', type: 'text' }],
      onSubmit: async (v, mm) => { const r = await admin({ action: 'reset-student-password', user_id: s.user_id, admin_password: v.admin_password, ...(v.password ? { password: v.password } : {}) }); mm.remove(); showCredentials('Password reset', [['Name', s.profiles.full_name], ['Student ID', r.login_id], ['New password', r.password]]); } }); };
    if (isAdmin) m.querySelector('[data-s]').onclick = async () => { if (!confirm(act ? 'Pause this student? They will not be able to sign in. All records are kept.' : 'Reactivate this student?')) return;
      try { await admin({ action: 'set-status', user_id: s.user_id, is_active: !act }); m.remove(); toast('Updated.', 'ok'); load(true); } catch (e) { toast(e.message, 'err'); } };
  }
  $('#q').oninput = e => { q = e.target.value.trim(); draw(); }; $('#more').onclick = () => load(false);
  load(true);
}
