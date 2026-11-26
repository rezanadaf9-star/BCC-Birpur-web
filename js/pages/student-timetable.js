import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where } from '../core/db.js';
import { $, esc, empty, skeleton } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'student', active: 'timetable.html', title: 'Class Schedule' });
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const data = (await qrows(query(col('class_timetable'), where('class_no', '==', me.student.class_no)))).sort((a, b) => (a.day_of_week - b.day_of_week) || String(a.start_time).localeCompare(b.start_time));
const today = (new Date().getDay() + 6) % 7 + 1;
content.innerHTML = (data || []).length ? DAYS.map((d, i) => { const r = data.filter(x => x.day_of_week === i + 1); return r.length ? `<section class="card" style="${i + 1 === today ? 'border:2px solid var(--yellow)' : ''}"><div class="card-head"><h3>${d}</h3>${i + 1 === today ? '<span class="tag y">Today</span>' : ''}</div><div class="table-wrap"><table class="t"><tbody>${r.map(x => `<tr><td style="white-space:nowrap">${x.start_time.slice(0, 5)} – ${x.end_time.slice(0, 5)}</td><td><b>${esc(x.subject_name)}</b></td><td>${esc(x.teacher_name || '')}</td><td>${esc(x.room || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''; }).join('') : `<section class="card">${empty('fa-clock', 'Your class schedule has not been added yet.')}</section>`;
