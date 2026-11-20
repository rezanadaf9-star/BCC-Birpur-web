import { mountShell } from '../shared/shell.js';
import { fn } from '../shared/api.js';
import { one } from '../core/db.js';
import { photo } from '../core/storage.js';
import { $, $$, esc, empty, skeleton, initials } from '../shared/ui.js';
import { podium } from '../shared/podium.js';
const { me, content } = await mountShell({ role: 'student', active: 'marks.html', title: 'Academic Performance', subtitle: 'Declared results and class ranking' });
let tab = new URLSearchParams(location.search).get('tab') || 'results';
content.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-t="results">My results</button><button class="btn sm ghost" data-t="exam">Exam leaderboard</button><button class="btn sm ghost" data-t="cum">Cumulative leaderboard</button><a class="btn sm ghost" href="leaderboard.html">Quiz leaderboard</a></div><div id="v">${skeleton(4)}</div>`;
const num = v => Math.round(Number(v) * 100) / 100;
async function results() {
  let s, error; try { s = (await fn('getGradesheets', { class_no: me.student.class_no })).sheets[0]; } catch (e) { error = e; }
  const ex = (s?.exams || []).filter(e => e.declared);
  if (error || !ex.length) { $('#v').innerHTML = `<section class="card">${empty('fa-chart-column', 'Your results will appear here once they are declared.')}</section>`; return; }
  const last = ex[ex.length - 1];
  $('#v').innerHTML = `<section class="grid g4"><div class="card stat"><div class="ico y"><i class="fa-solid fa-percent"></i></div><div><b>${num(last.cum_pct)}%</b><span>Overall percentage</span></div></div><div class="card stat"><div class="ico b"><i class="fa-solid fa-ranking-star"></i></div><div><b>#${last.cum_rank}</b><span>Class rank</span></div></div><div class="card stat"><div class="ico"><i class="fa-solid fa-star"></i></div><div><b>${num(last.cum_om)} / ${num(last.cum_fm)}</b><span>Total marks</span></div></div><div class="card stat"><div class="ico g"><i class="fa-solid fa-calendar-check"></i></div><div><b>${last.present}</b><span>Days present (${last.absent} absent)</span></div></div></section>
  ${ex.map(e => `<section class="card"><div class="card-head"><h3>${esc(e.name)}</h3><span class="tag y">${num(e.pct)}% · Rank ${e.rank}</span></div><div class="table-wrap"><table class="t"><thead><tr><th>Subject</th><th>Full marks</th><th>Obtained</th><th>%</th></tr></thead><tbody>${s.subjects.map(sub => { const c = sub.cells.find(x => x.n === e.n); return c ? `<tr><td>${esc(sub.name)}</td><td>${num(c.fm)}</td><td>${num(c.om)}</td><td>${c.fm ? Math.round(c.om * 100 / c.fm) : 0}%</td></tr>` : ''; }).join('')}<tr style="font-weight:600"><td>Total</td><td>${num(e.fm)}</td><td>${num(e.om)}</td><td>${num(e.pct)}%</td></tr></tbody></table></div></section>`).join('')}
  <div><a class="btn ghost" target="_blank" href="../print/gradesheet.html"><i class="fa-solid fa-print"></i>Print report card</a></div>`;
}
let exN = null;
async function board(cum) {
  let data = null, error = null, L = [];
  try { const sid = (await fn('currentSessionId', {})).id; const lb = await one('exam_leaderboards', `${sid}_${me.student.class_no}`);
    if (lb && lb.exams.length) { const n = exN != null && lb.exams.some(e => e.n === exN) ? exN : lb.exams[lb.exams.length - 1].n; const rows = (lb.boards[n] || {})[cum ? 'cum' : 'exam'] || [];
      L = rows.map(r => ({ ...r, is_me: r.student_id === me.id })); data = { exams: lb.exams, n, rows: L }; } } catch (e) { error = e; }
  if (error || !L.length) { $('#v').innerHTML = `<section class="card">${empty('fa-trophy', error ? error.message : 'A leaderboard appears after the result of an exam is published.')}</section>`; return; }
  exN = data.n; const av = async (x, size) => { const u = x.photo_path ? await photo(x.photo_path) : null; return u ? `<img src="${u}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">` : `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${size / 2.6}px">${esc(initials(x.name))}</span>`; };
  const items = []; for (const x of L.slice(0, 3)) items.push({ name: x.name, pct: x.pct, score: `${num(x.om)} / ${num(x.fm)}`, me: x.is_me, avatar: await av(x, Number(x.rank) === 1 ? 80 : 60), rank: Number(x.rank) });
  const top = L.slice(0, 10), mine = L.find(x => x.is_me), below = mine && !top.includes(mine), rows = [];
  for (const x of [...top, ...(below ? [mine] : [])]) rows.push(`${x === mine && below ? '<tr><td colspan="6" style="text-align:center;color:var(--muted)">⋮</td></tr>' : ''}<tr style="${x.is_me ? 'background:var(--yellow-wash);font-weight:600' : ''}"><td>#${x.rank}</td><td><div style="display:flex;gap:10px;align-items:center">${await av(x, 34)}${esc(x.name)} ${x.is_me ? '<span class="tag y">YOU</span>' : ''}</div></td><td>Class ${x.class_no > 0 ? x.class_no : ''}</td><td>${num(x.om)}</td><td>${num(x.fm)}</td><td>${num(x.pct)}%</td></tr>`);
  $('#v').innerHTML = `<section class="card"><div class="card-head"><div><h3>${cum ? 'Cumulative academic leaderboard' : 'Exam leaderboard (this exam only)'}</h3><small>${cum ? 'All declared exams up to the selected one are added together.' : 'Only the marks of the selected exam count.'}</small></div><select class="input" id="exsel" style="width:auto;min-height:38px">${data.exams.map(e => `<option value="${e.n}" ${e.n === data.n ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>${podium(items)}
    <div class="table-wrap"><table class="t"><thead><tr><th>Rank</th><th>Student</th><th>Class</th><th>Marks obtained</th><th>Full marks</th><th>%</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`;
  $('#exsel').onchange = e => { exN = Number(e.target.value); $('#v').innerHTML = skeleton(4); board(cum); };
}
const go = t => { tab = t; $$('[data-t]').forEach(b => b.classList.toggle('ghost', b.dataset.t !== t)); $('#v').innerHTML = skeleton(4); t === 'results' ? results() : board(t === 'cum'); };
$$('[data-t]').forEach(b => b.onclick = () => go(b.dataset.t)); go(tab);
