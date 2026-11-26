import { mountShell } from '../shared/shell.js';
import { fn } from '../shared/api.js';
import { $, esc, empty } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'student', active: 'attendance.html', title: 'Attendance' });
let ym = new Date().toISOString().slice(0, 7);
content.innerHTML = `<section class="grid g4" id="sum"></section><section class="card"><div class="card-head"><h3>Monthly calendar</h3><input type="month" class="input" id="m" value="${ym}" style="width:auto"></div><div id="cal"></div></section>`;
async function load() {
  const [y, m] = ym.split('-').map(Number), first = `${ym}-01`, last = new Date(y, m, 0).toISOString().slice(0, 10);
  const [all, rec] = await Promise.all([fn('attendanceSummary', {}).catch(() => null), fn('attendanceMonth', { month: ym }).catch(() => ({ by_date: {} }))]);
  const s = all || { working_days: 0, present: 0, absent: 0, percentage: 0 };
  const c = (i, k, v, l) => `<div class="card stat"><div class="ico ${k}"><i class="fa-solid ${i}"></i></div><div><b>${v}</b><span>${l}</span></div></div>`;
  $('#sum').innerHTML = c('fa-calendar-days', '', s.working_days, 'Working days') + c('fa-check', 'g', s.present, 'Present') + c('fa-xmark', 'r', s.absent, 'Absent') + c('fa-percent', 'y', s.percentage + '%', 'Attendance');
  const by = rec.by_date || {}, lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<b style="text-align:center;font-size:12px;color:var(--muted)">${d}</b>`).join('') + '<i></i>'.repeat(lead);
  const calendar = rec.calendar || {};

  for (let d = 1; d <= days; d++) {
    const k = `${ym}-${String(d).padStart(2, '0')}`;
    const st = by[k], day = calendar[k];
    const holiday = day && day.status === 'holiday';

    const bg = holiday ? 'var(--yellow-soft)' : st === 'present' ? 'var(--green-soft)' : st === 'absent' ? 'var(--red-soft)' : 'var(--grey-100)';
    const color = holiday ? 'var(--yellow)' : st === 'present' ? 'var(--green)' : st === 'absent' ? 'var(--red)' : 'var(--grey-500)';
    const label = holiday ? 'H' : st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'leave' ? 'L' : d;

    cells += `<div title="${esc(day && day.title ? day.title : st || 'Not marked')}" style="aspect-ratio:1;border-radius:12px;display:grid;place-items:center;font-weight:600;background:${bg};color:${color}">${label}</div>`;
  }

  cells += '<div style="grid-column:1/-1;display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted);padding-top:8px"><span>P = Present</span><span>A = Absent</span><span>L = Leave</span><span>H = Holiday</span></div>';
  $('#cal').innerHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;max-width:560px">${cells}</div>`;
}
$('#m').onchange = e => { ym = e.target.value || ym; load(); };
load();
