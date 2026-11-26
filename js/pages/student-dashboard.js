import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy, limit, getCountFromServer } from '../core/db.js';
import { fn } from '../shared/api.js';
import { swr } from '../core/cache.js';
import { $, esc, empty, skeleton, retry, toast, fmtIST } from '../shared/ui.js';
import { ROOT } from '../core/auth.js';

const QUOTES = [
  ['You don’t have to be great to start, but you have to start to be great.', 'Your hard work today will lead to a better tomorrow.'],
  ['Small steps every day add up to big results.', 'Open one chapter today. That is enough to begin.'],
  ['Mistakes are proof that you are trying.', 'Check your wrong answers and learn from each one.'],
];
const q = QUOTES[new Date().getDate() % QUOTES.length];
const ACCENT = { navy:'tag', yellow:'tag y', green:'tag g', red:'tag r', blue:'tag', orange:'tag o' };

const { me, content, features } = await mountShell({ role: 'student', active: 'dashboard.html', title: 'Dashboard' });
const has = k => features.has(k);

content.innerHTML = `
  <section class="hero"><div><h2>${esc(q[0])}</h2></div>
    <img src="${ROOT}bcc-assets/student-illustration.png" alt=""></section>
  <section class="card" id="learn" style="display:none"><div class="card-head"><h3>Continue learning</h3></div><div class="grid g3" id="learnGrid"></div></section>
  <section class="grid g4" id="stats">${'<div class="card"><div class="skeleton" style="height:46px"></div></div>'.repeat(4)}</section>
  <section class="split">
    ${has('marks') ? `<div class="card"><div class="card-head"><h3>Subject-wise marks</h3><small id="examName"></small></div><div id="marksTbl">${skeleton(4)}</div></div>` : '<div></div>'}
    <div style="display:flex;flex-direction:column;gap:16px">
      ${has('attendance') ? `<div class="card"><div class="card-head"><h3>Today’s attendance</h3></div><div id="today">${skeleton(1)}</div></div>` : ''}
      <div class="card"><div class="card-head"><h3>Quick links</h3></div><div class="grid g2" id="quick"></div></div>
    </div></section>
  <section class="split">
    ${has('marks') ? `<div class="card"><div class="card-head"><h3>Class top performers</h3></div><div id="top">${skeleton(2)}</div></div>` : '<div></div>'}
    ${has('announcements') ? `<div class="card"><div class="card-head"><h3>Recent announcements</h3><a class="tag" href="announcements.html">View all</a></div><div id="notices">${skeleton(3)}</div></div>` : ''}
  </section>`;

const quick = [['marks.html','Marks','marks','fa-chart-column'],['timetable.html','Time table','timetable','fa-clock'],['homework.html','Homework','homework','fa-pen-to-square'],['fees.html','Fees','fees','fa-indian-rupee-sign']]
  .filter(([, , k]) => has(k));
$('#quick').innerHTML = quick.length ? quick.map(([h, l, , i]) => `<a class="btn ghost" href="${h}"><i class="fa-solid ${i}"></i>${l}</a>`).join('') : empty('fa-link', 'Nothing to show yet.');

function paint(d) {
  const m = d.marks, a = d.attendance;
  const cards = [];
  if (has('marks')) cards.push(
    ['fa-percent','y', m ? m.pct + '%' : '—', 'Overall percentage'],
    ['fa-ranking-star','b', m ? '#' + m.rank : '—', 'Class rank']);
  if (has('attendance')) cards.splice(1, 0, ['fa-calendar-check','g', a ? a.percentage + '%' : '—', a ? `${a.present} of ${a.working_days} days present` : 'Attendance']);
  if (has('marks')) cards.push(['fa-star','', m ? `${m.total_om} / ${m.total_fm}` : '—', 'Total marks']);
  $('#stats').innerHTML = cards.map(([i, c, v, l]) => `<div class="card stat"><div class="ico ${c}"><i class="fa-solid ${i}"></i></div><div><b>${esc(v)}</b><span>${esc(l)}</span></div></div>`).join('');
  if (has('marks')) {
    $('#examName').textContent = m?.exam_name || '';
    $('#marksTbl').innerHTML = d.subjects.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Subject</th><th>Full marks</th><th>Obtained</th><th>%</th></tr></thead><tbody>${d.subjects.map(s => `<tr><td>${esc(s.name)}</td><td>${s.fm}</td><td>${s.om}</td><td>${s.fm ? Math.round(s.om * 100 / s.fm) : 0}%</td></tr>`).join('')}</tbody></table></div>`
      : empty('fa-chart-column', 'Marks will appear here once a result is declared.');
    $('#top').innerHTML = d.top.length ? `<div class="grid g3">${d.top.map(t => `<div class="card" style="box-shadow:none;background:var(--yellow-wash);text-align:center"><span class="avatar" style="margin:0 auto 8px;width:48px;height:48px">${esc(t.name[0])}</span><b style="font-size:13.5px">${esc(t.name)}</b><div style="color:var(--muted);font-size:12.5px">${t.pct}%</div></div>`).join('')}</div>` : empty('fa-trophy', 'Top performers appear after the first result.');
  }
  if (has('attendance')) {
    const s = d.today;
    $('#today').innerHTML = s ? `<span class="tag ${s === 'present' ? 'g' : 'r'}" style="font-size:15px;padding:6px 16px">${s === 'present' ? '✓ Present' : '✕ Absent'}</span>` : '<span class="tag o">Not marked yet</span>';
  }
  if (has('announcements')) $('#notices').innerHTML = d.notices.length ? d.notices.map(n => `<a href="announcements.html" style="display:block;padding:10px 12px;border-radius:12px;background:var(--yellow-wash);margin-bottom:8px"><span class="${ACCENT[n.accent] || 'tag'}" style="float:right">${new Date(n.publish_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span><b style="font-size:13.5px">${esc(n.title)}</b><div style="font-size:12.5px;color:var(--muted)">${esc(n.headline || '')}</div></a>`).join('') : empty('fa-bullhorn', 'No announcements right now.');
}
try { await swr('student-dashboard', () => retry(async () => { return fn('studentDashboard', {}); }), paint); }
catch (e) { $('#stats').innerHTML = `<div class="card" style="grid-column:1/-1">${empty('fa-wifi', 'We could not load your dashboard. Check your connection and try again.')}<div style="text-align:center"><button class="btn" onclick="location.reload()">Try again</button></div></div>`; toast(e.message, 'err'); }

(async () => { const c = me.student.class_no, cards = [], now = new Date().toISOString(), cnt = async t => (await getCountFromServer(query(col(t), where('class_no', '==', c)))).data().count;
  const [lec, quiz, nl, nn, nh] = await Promise.all([has('lectures') ? qrows(query(col('lectures'), where('class_no', '==', c), orderBy('created_at', 'desc'), limit(3))).then(r => r.filter(x => x.live_status !== 'cancelled')) : [],
    has('quizzes') ? qrows(query(col('quizzes'), where('class_no', '==', c), where('is_active', '==', true), orderBy('created_at', 'desc'), limit(3))).then(r => r.filter(x => !x.end_at || x.end_at > now)) : [], has('lectures') ? cnt('lectures') : null, has('notes') ? cnt('notes') : null, has('homework') ? cnt('homework') : null]);
  const L = lec[0], Q = quiz[0];
  if (L) cards.push(`<a class="card" href="lectures.html?lecture=${L.id}" style="box-shadow:none;background:var(--yellow-wash)"><span class="tag ${L.live_status === 'live' ? 'r' : 'y'}">${L.live_status === 'live' ? 'LIVE NOW' : L.live_status === 'scheduled' ? 'Upcoming · ' + fmtIST(L.scheduled_at) : 'Latest lecture'}</span><h4 style="margin:8px 0 2px">${esc(L.title)}</h4><small style="color:var(--muted)">Tap to watch</small></a>`);
  if (Q) cards.push(`<a class="card" href="quizzes.html" style="box-shadow:none;background:var(--yellow-wash)"><span class="tag y">Next quiz</span><h4 style="margin:8px 0 2px">${esc(Q.title)}</h4><small style="color:var(--muted)">${Q.duration_minutes} minutes</small></a>`);
  const counts = [['Lectures', nl, 'lectures.html'], ['Notes', nn, 'notes.html'], ['Homework', nh, 'homework.html']].filter(x => x[1] != null);
  if (counts.length) cards.push(`<div class="card" style="box-shadow:none;background:var(--yellow-wash)"><span class="tag">Library</span><div style="display:flex;gap:16px;margin-top:10px">${counts.map(([l, n, h]) => `<a href="${h}" style="text-align:center"><b style="font-size:20px">${n}</b><br><small style="color:var(--muted)">${l}</small></a>`).join('')}</div></div>`);
  if (cards.length) { $('#learn').style.display = ''; $('#learnGrid').innerHTML = cards.join(''); } })();
