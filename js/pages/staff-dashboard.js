import { mountShell } from '../shared/shell.js';
import { fn } from '../shared/api.js';
import { $, esc, inr, empty } from '../shared/ui.js';
import { myClasses, classCards } from '../shared/classes-ui.js';
import { attendanceEnabled } from '../core/flags.js';
const ATT = await attendanceEnabled();
const role = document.documentElement.dataset.role;
const { me, content } = await mountShell({ role, active: 'dashboard.html', title: 'Dashboard' });
const QUICK = role === 'admin' ? [['admission.html', 'fa-user-plus', 'Admit student'], ['attendance.html', 'fa-calendar-check', 'Attendance'], ['fees.html', 'fa-indian-rupee-sign', 'Fees'], ['examinations.html', 'fa-file-signature', 'Examinations'], ['marks.html', 'fa-chart-column', 'Marks'], ['leaderboards.html', 'fa-trophy', 'Leaderboards'], ['announcements.html', 'fa-bullhorn', 'Announcements'], ['print.html', 'fa-print', 'Print']]
  : [['attendance.html', 'fa-calendar-check', 'Attendance'], ['marks.html', 'fa-chart-column', 'Marks'], ['lectures.html', 'fa-circle-play', 'Lectures'], ['notes.html', 'fa-book-open', 'Notes'], ['homework.html', 'fa-pen-to-square', 'Homework'], ['quizzes.html', 'fa-list-check', 'Quizzes'], ['answer-sheets.html', 'fa-file-pen', 'Answer sheets'], ['students.html', 'fa-user-graduate', 'Students']];
const QUICK_SHOWN = QUICK.filter(q => ATT || q[0] !== 'attendance.html');
content.innerHTML = `<section class="grid g4" id="stats"></section><section class="card"><div class="card-head"><h3>Quick actions</h3></div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${QUICK_SHOWN.map(([h, i, l]) => `<a class="btn ghost" href="${h}" style="justify-content:flex-start;min-height:52px"><i class="fa-solid ${i}"></i>${l}</a>`).join('')}</div></section><section class="card"><div class="card-head"><h3>${role === 'admin' ? 'Classes' : 'Your classes'}</h3></div><div id="cls"></div></section><section class="card"><div class="card-head"><h3>Recent uploads</h3></div><div id="recent">Loading…</div></section>`;
const [cls, d] = await Promise.all([myClasses(me), fn('dashboardStats', {}).catch(() => null)]);
const card = (i, c, v, l) => `<div class="card stat"><div class="ico ${c}"><i class="fa-solid ${i}"></i></div><div><b>${esc(v)}</b><span>${esc(l)}</span></div></div>`;
$('#stats').innerHTML = d ? [
  card('fa-user-graduate', 'y', d.active, 'Active students'),
  card('fa-user-slash', 'r', d.other, 'Paused or left'),
  role === 'admin' ? card('fa-chalkboard-user', 'b', d.teachers ?? 0, 'Teachers') : '',
  ATT ? card('fa-calendar-check', 'g', d.marked ? `${d.present}/${d.marked}` : '—', 'Present today') : '',
  card('fa-list-check', '', d.quizzes ?? 0, 'Active quizzes'),
  role === 'admin' ? card('fa-indian-rupee-sign', 'g', inr(d.collected_month || 0), 'Collected this month') : '',
  role === 'admin' ? card('fa-hourglass-half', 'r', inr(d.pending || 0), 'Pending fees') : '',
].join('') : empty('fa-wifi', 'The numbers could not be loaded. Please refresh.');
$('#cls').innerHTML = classCards(cls, c => `${ATT ? 'attendance.html' : 'students.html'}?class=${c.class_no}`);

{ const all = d?.recent || [];
  $('#recent').innerHTML = all.length ? `<div class="table-wrap"><table class="t"><tbody>${all.map(x => `<tr><td><span class="tag">${x.kind}</span></td><td>${esc(x.title)}</td><td>${x.class_no > 0 ? 'Class ' + x.class_no : ({ '-3': 'Nursery', '-2': 'LKG', '-1': 'UKG' })[x.class_no]}</td><td>${new Date(x.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</td><td><a class="btn ghost sm" href="${x.href}?class=${x.class_no}">Open</a></td></tr>`).join('')}</tbody></table></div>` : empty('fa-cloud-arrow-up', 'Nothing uploaded yet.'); }
