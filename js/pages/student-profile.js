import { mountShell } from '../shared/shell.js';
import { fn } from '../shared/api.js';
import { photo } from '../core/storage.js';
import { label } from '../core/classes.js';
import { $, esc, initials, toast } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'student', active: 'profile.html', title: 'Profile' });
const s = me.student, u = await photo(s.photo_path);
const row = ([l, v]) => `<div style="background:var(--yellow-wash);padding:10px 14px;border-radius:12px"><small style="color:var(--muted);text-transform:uppercase;letter-spacing:.4px">${l}</small><div style="font-weight:600">${esc(v || '—')}</div></div>`;
content.innerHTML = `<section class="card" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">${u ? `<img src="${u}" alt="" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:4px solid var(--yellow)">` : `<span class="avatar" style="width:120px;height:120px;font-size:40px;border:4px solid var(--yellow)">${esc(initials(me.full_name))}</span>`}<div><h2>${esc(me.full_name)}</h2><div style="color:var(--muted)">${esc(label(s.class_no))} · Roll ${esc(s.roll_number || '–')}</div><span class="tag y" style="margin-top:6px">Student ID ${esc(me.login_id)}</span></div></section>
  <section class="card"><div class="card-head"><h3>Personal information</h3></div><div class="grid g3">${[['Admission no.', s.admission_no], ['Date of birth', s.dob], ['Gender', s.gender], ['Guardian phone', s.phone], ['Address', s.address]].map(row).join('')}</div></section>
  <section class="card"><div class="card-head"><h3>Parent information</h3></div><div class="grid g3">${[['Father', s.father_name], ['Mother', s.mother_name]].map(row).join('')}</div></section>
  <section class="card"><div class="card-head"><h3>Academic information</h3></div><div class="grid g3">${[['Class', label(s.class_no)], ['Roll number', s.roll_number], ['Batch', s.batch], ['Admitted on', s.admitted_on], ['Status', s.status]].map(row).join('')}</div></section>
  <section class="card"><div class="card-head"><h3>My goal & dedication</h3></div><textarea class="input" id="g" maxlength="300" placeholder="Write a short, positive message about your goal. Classmates may see it.">${esc(s.goal_message || '')}</textarea><div style="margin-top:10px"><button class="btn" id="sv">Save message</button></div></section>`;
$('#sv').onclick = async () => { try { await fn('setMyGoal', { text: $('#g').value }); sessionStorage.removeItem('bcc:me'); toast('Saved.', 'ok'); } catch (error) { toast(error.message, 'err'); } };
