import { mountShell } from '../shared/shell.js';
import { pageStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { photo } from '../core/storage.js';
import { $, $$, esc, initials, toast, empty, skeleton, modal } from '../shared/ui.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
const role = document.documentElement.dataset.role;
const { me, content } = await mountShell({ role, active: 'attendance.html', title: 'Attendance' });
const params = new URLSearchParams(location.search), classNo = params.get('class');

if (!classNo) {
  const cls = await myClasses(me);
  content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(cls, c => `?class=${c.class_no}`)}</section>`;
} else {
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  let date = params.get('date') || today, state = {}, roster = [], calendar = null;
  content.innerHTML = `
   <section class="card"><div class="card-head"><div><a href="attendance.html" class="tag">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))}</h3></div>
     <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><input class="input" type="date" id="date" max="${today}" value="${date}" style="width:auto"><button class="btn ghost sm" id="low"><i class="fa-solid fa-triangle-exclamation"></i> Low attendance</button>
     </div></div>
     <div id="sum" style="display:flex;gap:8px;margin-bottom:12px"></div><div id="calendar-notice"></div><div id="list">${skeleton(5)}</div>
     <div style="position:sticky;bottom:12px;margin-top:16px;text-align:center"><button class="btn y" id="save" style="min-width:260px;box-shadow:var(--shadow-2)">UPDATE ATTENDANCE</button></div></section>`;
  const mark = (id, s) => { state[id] = state[id] === s ? null : s; draw(); };   // tap again to undo; Absent replaces Present and vice versa
  function draw() {
    const p = Object.values(state).filter(v => v === 'present').length, a = Object.values(state).filter(v => v === 'absent').length;
    $('#sum').innerHTML = `<span class="tag g">Present ${p}</span><span class="tag r">Absent ${a}</span><span class="tag">Not marked ${roster.length - p - a}</span>`;
    const holiday = calendar && calendar.status === 'holiday';
    $('#calendar-notice').innerHTML = holiday ? `<div class="tag r" style="display:block;margin-bottom:12px;padding:12px">Holiday · ${esc(calendar.title || calendar.weekday_name || 'Holiday')} — Attendance cannot be marked.</div>` : '';
    $('#save').disabled = !!holiday;
    $('#save').textContent = holiday ? 'HOLIDAY' : 'UPDATE ATTENDANCE';
    $('#list').innerHTML = roster.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Roll</th><th>Student</th><th style="text-align:center">Present</th><th style="text-align:center">Absent</th><th style="text-align:center">Notice</th></tr></thead><tbody>${roster.map(s => {
      const v = state[s.user_id];
      return `<tr><td>${esc(s.roll_number || '–')}</td><td><div style="display:flex;gap:10px;align-items:center"><span class="avatar" data-photo="${esc(s.photo_path || '')}">${esc(initials(s.name))}</span>${esc(s.name)}</div></td>
      <td style="text-align:center"><button class="btn sm ${v === 'present' ? 'green' : 'ghost'}" data-id="${s.user_id}" data-s="present" aria-pressed="${v === 'present'}" aria-label="Present" ${holiday ? "disabled" : ""}>${v === 'present' ? '✓' : ''}</button></td>
      <td style="text-align:center"><button class="btn sm ${v === 'absent' ? 'red' : 'ghost'}" data-id="${s.user_id}" data-s="absent" aria-pressed="${v === 'absent'}" aria-label="Absent" ${holiday ? "disabled" : ""}>${v === 'absent' ? '✕' : ''}</button></td><td style="text-align:center"><a class="btn ghost sm" target="_blank" title="Print attendance notice for this student" href="../print/attendance.html?student=${s.user_id}&class=${classNo}&month=${date.slice(0, 7)}"><i class="fa-solid fa-print"></i></a></td></tr>`; }).join('')}</tbody></table></div>`
      : empty('fa-user-graduate', 'No active students in this class yet.');
    $$('button[data-id]').forEach(b => b.onclick = () => mark(b.dataset.id, b.dataset.s));
    $$('.avatar[data-photo]').forEach(async el => { if (el.dataset.photo) { const u = await photo(el.dataset.photo); if (u) el.innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover">`; } });
  }
  async function load() {
    $('#list').innerHTML = skeleton(5);
    let st, rec;
    try { [st, rec] = await Promise.all([pageStudents({ classNo, status: 'active', size: 400 }).then(r => r.rows), fn('getClassAttendance', { class_no: Number(classNo), date })]); }
    catch (error) { $('#list').innerHTML = empty('fa-triangle-exclamation', error.message); return; }
    roster = (st || []).map(s => ({ ...s, name: s.profiles.full_name })).sort((a, b) => String(a.roll_number || '').localeCompare(String(b.roll_number || ''), undefined, { numeric: true }));
    state = { ...rec.marks }; calendar = rec.calendar || null; draw();
  }
  $('#date').onchange = e => { date = e.target.value || today; load(); };
  $('#save').onclick = async () => {
    const btn = $('#save'); btn.disabled = true; btn.textContent = 'Saving…';
    try { await fn('saveClassAttendance', { class_no: Number(classNo), date, rows: roster.map(s => ({ student_id: s.user_id, status: state[s.user_id] ?? null })) }); toast(`Attendance updated for ${date}.`, 'ok'); }
    catch (error) { toast(error.message, 'err'); }
    btn.disabled = false; btn.textContent = 'UPDATE ATTENDANCE';
  };
  $('#low').onclick = async () => { try { const r = await fn('lowAttendance', { class_no: Number(classNo), from: date.slice(0, 7) + '-01', to: date });
      const m = modal(`<h3>Low attendance (below 75%)</h3><p style="color:var(--muted);font-size:13px">${esc(date.slice(0, 7))} · ${r.working_days} working days</p>${r.students.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Roll</th><th>Student</th><th>Present</th><th>%</th></tr></thead><tbody>${r.students.map(x => `<tr><td>${esc(x.roll || '–')}</td><td>${esc(x.name)}</td><td>${x.present}</td><td><b>${x.percentage}%</b></td></tr>`).join('')}</tbody></table></div>` : '<p>No student is below 75%.</p>'}<div style="text-align:right;margin-top:12px"><button class="btn ghost" data-x>Close</button></div>`);
      m.querySelector('[data-x]').onclick = () => m.remove(); } catch (e) { toast(e.message, 'err'); } };
  load();
}
