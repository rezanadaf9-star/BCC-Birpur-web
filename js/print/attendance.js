import { requireRole, ROOT } from '../core/auth.js';
import { fn } from '../shared/api.js';
import { roman } from '../core/classes.js';
const P = new URLSearchParams(location.search), $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = m => { $('loading').textContent = m; };
try {
  const me = await requireRole(['teacher', 'admin']);       // only staff issue attendance notices, one student at a time
  const student = P.get('student'), month = P.get('month') || new Date().toISOString().slice(0, 7);
  if (!student) { show('Open this notice for one student from Print Centre or from the Attendance page. It is not printed for a whole class.'); throw new Error('stop'); }
  let d, no; try { d = await fn('attendanceNotice', { student, month }); no = d.report_no; } catch (e) { show(e.message); throw new Error('stop'); }
  const [y, mo] = month.split('-').map(Number), days = new Date(y, mo, 0).getDate(), MON = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const s = d.student, a = d.summary, pct = a.working_days ? Math.round(a.present / a.working_days * 100) : 0, pad = n => String(n).padStart(2, '0');
  const set = (id, v) => $(id).textContent = v ?? '';
  $('logo').src = ROOT + 'bcc-assets/logo.png'; set('schoolName', 'BRILLIANT COACHING CENTRE'); set('schoolAddress', 'Kairi Birpur, Kochadhaman, Kishanganj, Bihar'); set('established', 'ESTABLISHED 2009');
  set('footerSchool', 'BRILLIANT COACHING CENTRE'); set('footerAddress', 'Kairi Birpur, Kochadhaman, Kishanganj, Bihar');
  set('session', (d.session || '').replace('-', '–')); set('reportNo', no); set('periodLabel', `(01–${pad(days)} ${MON[mo - 1]} ${y})`);
  const fields = [['Student Name', s.name], ["Father's / Guardian's Name", s.father_name], ['Class / Section', roman(s.class_no)], ['Roll Number', s.roll], ['Admission Number', s.admission_no], ['Reporting Period', `${MON[mo - 1][0]}${MON[mo - 1].slice(1).toLowerCase()} ${y}`]];
  $('studentDetails').innerHTML = fields.map(([l, v]) => `<div class="field"><label>${l}</label><b>${esc(v || '—')}</b></div>`).join('');
  $('stats').innerHTML = [[a.present, 'PRESENT'], [a.absent, 'ABSENT'], [a.leave, 'LEAVE'], [a.holidays, 'HOLIDAYS'], [a.working_days, 'WORKING DAYS']].map(([v, l]) => `<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join('');
  set('percentage', pct + '%');
  $('concernTo').innerHTML = `STUDENT: ${esc(s.name)} &nbsp; | &nbsp; PARENT / GUARDIAN: ${esc(s.father_name || '—')}`;
  // paragraphs are real line breaks (the sample file printed "\n" and "&nbsp;" literally)
  const paras = ['Dear Parent / Guardian,', 'Our attendance records indicate that your child has not been attending classes regularly during the stated reporting period. The number of absences is affecting continuity of learning and may make it difficult for the student to keep pace with classroom teaching.', 'We are issuing this notice to bring the matter to your attention and request your cooperation in improving attendance.'];
  $('directorRemark').innerHTML = paras.map(p => `<p style="margin:0 0 3px">${esc(p)}</p>`).join('');
  $('parentAction').innerHTML = '<strong>PARENT ACTION REQUESTED:</strong> Please ensure that your child attends every scheduled class regularly. If there is a medical, family or other genuine reason for the absences, kindly inform the centre and meet / contact the administration to discuss support and a plan for regular attendance.';
  const hol = new Set(d.holidays), offset = (new Date(y, mo - 1, 1).getDay() + 6) % 7, cells = Array(offset).fill(null); for (let i = 1; i <= days; i++) cells.push(i); while (cells.length % 7) cells.push(null);
  let rows = ''; for (let i = 0; i < cells.length; i += 7) rows += '<tr>' + cells.slice(i, i + 7).map(day => { if (!day) return '<td class="empty"></td>'; const key = `${y}-${pad(mo)}-${pad(day)}`, code = hol.has(key) ? 'H' : (d.by_date[key] || '—'); const cls = { P: 'present', A: 'absent', L: 'leave', H: 'holiday' }[code] || 'unmarked'; return `<td class="${cls}"><span>${day}</span><br><small>${code}</small></td>`; }).join('') + '</tr>';
  $('calendarBody').innerHTML = rows; $('loading').remove(); $('report').hidden = false; document.title = `Attendance notice · ${s.name} · ${MON[mo - 1]} ${y}`;
} catch (e) { if (!/stop|no session|wrong role|session replaced/.test(e.message)) show(e.message); }
