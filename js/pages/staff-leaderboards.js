import { mountShell } from '../shared/shell.js';
import { rows as qrows, one, col, query, where, orderBy } from '../core/db.js';
import { fn } from '../shared/api.js';
import { photo } from '../core/storage.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { podium } from '../shared/podium.js';
import { $, $$, esc, empty, skeleton, initials } from '../shared/ui.js';
const role = document.documentElement.dataset.role;
const { me, content } = await mountShell({ role, active: 'leaderboards.html', title: 'Leaderboards', subtitle: 'Latest exam, cumulative academic and quiz rankings by class' });
const P = new URLSearchParams(location.search), classNo = P.get('class'); const num = v => Math.round(Number(v) * 100) / 100;
if (!classNo) content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(await myClasses(me), c => `?class=${c.class_no}`)}</section>`;
else {
  let tab = 'exam', exN = null, qid = null;
  const qz = await qrows(query(col('quizzes'), where('class_no', '==', Number(classNo)), orderBy('created_at', 'desc')));
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="leaderboards.html">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))}</h3></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn sm" data-t="exam">Latest / individual exam</button><button class="btn sm ghost" data-t="cum">Cumulative academic</button><button class="btn sm ghost" data-t="quiz">Quiz</button><select class="input" id="sel" style="width:auto;min-height:38px"></select></div></div><p id="what" style="color:var(--muted);font-size:13px;margin-bottom:6px"></p><div id="v">${skeleton(4)}</div></section>`;
  const board = async L => { await Promise.all(L.slice(0, 60).map(async x => { const u = x.photo ? await photo(x.photo) : null; x.avatar = u ? `<img src="${u}" alt="" style="width:${x.rank === 1 ? 80 : 60}px;height:${x.rank === 1 ? 80 : 60}px;border-radius:50%;object-fit:cover">` : null; x._a = u ? `<img src="${u}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover">` : `<span class="avatar" style="width:34px;height:34px;font-size:13px">${esc(initials(x.name))}</span>`; }));
    $('#v').innerHTML = L.length ? `${podium(L)}<div class="table-wrap"><table class="t"><thead><tr><th>Rank</th><th>Roll</th><th>Student</th><th>Class</th><th>Marks obtained</th><th>Full marks</th><th>%</th></tr></thead><tbody>${L.slice(0, 60).map(x => `<tr><td>#${x.rank}</td><td>${esc(x.roll || '–')}</td><td><div style="display:flex;gap:10px;align-items:center">${x._a}${esc(x.name)}</div></td><td>${esc(label(classNo))}</td><td>${esc(x.om)}</td><td>${esc(x.fm)}</td><td>${num(x.pct)}%</td></tr>`).join('')}</tbody></table></div>` : empty('fa-trophy', 'Nothing to rank yet.'); };
  async function marks(cumulative) {
    let lb = null, error = null; try { const sid = (await fn('currentSessionId', {})).id; lb = await one('exam_leaderboards', `${sid}_${classNo}`); } catch (e) { error = e; }
    const exams = lb?.exams || []; if (error || !exams.length) { $('#sel').classList.add('hidden'); $('#what').textContent = ''; return $('#v').innerHTML = empty('fa-trophy', 'The academic leaderboard appears after the first result is declared.'); }
    exN = exN && exams.some(e => e.n === exN) ? exN : exams[exams.length - 1].n;
    $('#sel').classList.remove('hidden'); $('#sel').innerHTML = exams.map(e => `<option value="${e.n}" ${e.n === exN ? 'selected' : ''}>${cumulative ? 'Up to ' : ''}${esc(e.name)}</option>`).join('');
    $('#what').textContent = cumulative ? 'Cumulative: marks of all declared exams up to the selected exam are added together.' : 'Individual exam: ranks use only the marks of the selected exam. Ranked by percentage, then marks; students with the same score share a rank.';
    const L = ((lb.boards[exN] || {})[cumulative ? 'cum' : 'exam'] || []).map(x => ({ name: x.name, roll: x.roll, photo: x.photo_path, rank: Number(x.rank), pct: x.pct, om: num(x.om), fm: num(x.fm), score: `${num(x.om)} / ${num(x.fm)}` }));
    await board(L); }
  async function quiz() {
    $('#sel').classList.remove('hidden'); $('#what').textContent = 'Quiz leaderboard (separate from academic marks).'; $('#sel').innerHTML = `<option value="">All quizzes (cumulative)</option>` + (qz || []).map(q => `<option value="${q.id}" ${q.id === qid ? 'selected' : ''}>${esc(q.title)}</option>`).join('');
    const bd = qid ? await one('quiz_boards', qid) : await one('class_boards', String(classNo)); const data = bd?.rows || [];
    await board((data || []).map(x => ({ name: x.full_name, roll: '', photo: null, rank: Number(x.rank), pct: qid ? (x.total_marks ? x.score * 100 / x.total_marks : 0) : x.percentage, om: num(qid ? x.score : x.total_score), fm: num(x.total_marks), score: '' }))); }
  const go = () => { $$('[data-t]').forEach(b => b.classList.toggle('ghost', b.dataset.t !== tab)); $('#v').innerHTML = skeleton(4); tab === 'quiz' ? quiz() : marks(tab === 'cum'); };
  $$('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; go(); }); $('#sel').onchange = e => { tab === 'quiz' ? qid = e.target.value || null : exN = Number(e.target.value); go(); }; go();
}
