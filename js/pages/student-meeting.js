import { mountShell } from '../shared/shell.js';
import { fn } from '../shared/api.js';
import { openMeeting } from '../shared/meeting.js';
import { $, $$, esc, empty, skeleton, fmtIST } from '../shared/ui.js';
const kind = document.documentElement.dataset.kind, T = kind === 'ptm' ? ['Parent-Teacher Meeting', 'ptm.html', 'fa-people-roof'] : ['Motivational Sessions', 'motivational.html', 'fa-lightbulb'];
const { me, content } = await mountShell({ role: 'student', active: T[1], title: T[0] });
content.innerHTML = `<section class="card"><div class="card-head"><h3>Sessions for your class</h3></div><div id="v">${skeleton(2)}</div></section><div id="stage"></div>`;
async function load() { let data = []; try { data = (await fn('myMeetings', { kind })).meetings; } catch {}
  $('#v').innerHTML = (data || []).length ? data.map(m => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border-radius:14px;background:var(--yellow-wash);margin-bottom:10px;flex-wrap:wrap"><div style="display:flex;gap:14px;align-items:center"><span class="stat"><span class="ico y"><i class="fa-solid ${T[2]}"></i></span></span><div><b>${esc(m.title)}</b><div style="font-size:13px;color:var(--muted)">${m.speaker ? esc(m.speaker) + ' · ' : ''}${m.start_at ? fmtIST(m.start_at) : ''}</div></div></div>${m.status === 'live' ? `<button class="btn red" data-j="${m.id}"><i class="fa-solid fa-video"></i>Join live</button>` : '<span class="tag o">Not started</span>'}</div>`).join('') : empty(T[2], 'No sessions are scheduled for your class right now.');
  $$('[data-j]').forEach(b => b.onclick = () => openMeeting({ id: b.dataset.j, host: $('#stage'), name: me.full_name, onClose: load })); }
load(); setInterval(() => { if (!document.hidden && !document.querySelector('#jitsi')) load(); }, 60000);   // checks once a minute whether a session went live
