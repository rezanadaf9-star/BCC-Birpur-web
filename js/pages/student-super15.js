import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy, limit, onSnapshot } from '../core/db.js';
import { fn } from '../shared/api.js';
import { fileBlobUrl } from '../core/storage.js';
import { isSuper15Member } from '../core/permissions.js';
import { openMeeting } from '../shared/meeting.js';
import { $, $$, esc, empty, skeleton, toast, fmtIST } from '../shared/ui.js';
const { me, content } = await mountShell({ role: 'student', active: 'super15.html', title: 'Super 15', subtitle: 'Live classes, discussion and materials' });
const ok = await isSuper15Member();
if (!ok) { content.innerHTML = `<section class="card">${empty('fa-lock', 'This section is only for Super 15 batch students.')}</section>`; }
else {
  let tab = 'meet';
  content.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">${[['meet', 'Live classes'], ['chat', 'Group discussion'], ['mat', 'Materials'], ['ans', 'Answer sheets']].map(([k, l]) => `<button class="btn sm ${k === tab ? '' : 'ghost'}" data-t="${k}">${l}</button>`).join('')}</div><section class="card" id="v">${skeleton(3)}</section><div id="stage"></div>`;
  let ch = null;
  const views = {
    async meet() { let data = []; try { data = (await fn('myMeetings', { kind: 'super15' })).meetings; } catch {} $('#v').innerHTML = (data || []).length ? data.map(m => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border-radius:14px;background:var(--yellow-wash);margin-bottom:10px"><div><b>${esc(m.title)}</b><div style="font-size:13px;color:var(--muted)">${m.speaker ? esc(m.speaker) + ' · ' : ''}${m.start_at ? fmtIST(m.start_at) : ''}</div></div>${m.status === 'live' ? `<button class="btn red" data-j="${m.id}"><i class="fa-solid fa-video"></i>Join live</button>` : '<span class="tag o">Not started</span>'}</div>`).join('') : empty('fa-video', 'No live class scheduled.');
      $$('[data-j]').forEach(b => b.onclick = () => openMeeting({ id: b.dataset.j, host: $('#stage'), name: me.full_name })); },
    async chat() { $('#v').innerHTML = `<div id="msgs" style="max-height:55vh;overflow:auto;margin-bottom:12px"></div><div style="display:flex;gap:8px"><input class="input" id="nm" maxlength="600" placeholder="Write a message…"><button class="btn y" id="sd">Send</button></div>`;
      const draw = rows => { $('#msgs').innerHTML = rows.map(m => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b style="color:${m.user_id === me.id ? 'var(--blue)' : 'var(--navy)'}">${esc(m.author_name)}</b> ${m.author_role !== 'student' ? `<span class="tag y">${esc(m.author_role)}</span>` : ''}<small style="color:var(--muted)"> ${new Date(m.created_at).toLocaleString('en-IN')}</small><div>${esc(m.body)}</div></div>`).join('') || empty('fa-comments', 'No messages yet.'); $('#msgs').scrollTop = 1e9; };
      const send = async () => { const b = $('#nm').value.trim(); if (!b) return; $('#nm').value = ''; try { await fn('postDiscussionMessage', { scope: 'super15', body: b }); } catch (error) { toast(error.message, 'err'); } };
      $('#sd').onclick = send; $('#nm').onkeydown = e => { if (e.key === 'Enter') send(); };
      ch = onSnapshot(query(col('discussion_messages'), where('scope', '==', 'super15'), orderBy('created_at', 'desc'), limit(100)), snap => draw(snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()), () => draw([])); },
    async mat(kind = 'material') { const data = await qrows(query(col('super15_materials'), where('kind', '==', kind), orderBy('created_at', 'desc'))); $('#v').innerHTML = (data || []).length ? data.map(m => `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)"><div><b>${esc(m.title)}</b><div style="font-size:13px;color:var(--muted)">${esc(m.description || '')}</div></div><button class="btn sm" data-o="${m.id}">Open</button></div>`).join('') : empty('fa-folder-open', 'Nothing uploaded yet.');
      $$('[data-o]').forEach(b => b.onclick = async () => { const m = data.find(x => x.id === b.dataset.o); try { window.open(m.url || await fileBlobUrl(m.file_path), '_blank'); } catch { toast('Could not open.', 'err'); } }); },
    ans() { return views.mat('answer_sheet'); } };
  const go = async t => { if (ch) { ch(); ch = null; } tab = t; $$('[data-t]').forEach(b => b.classList.toggle('ghost', b.dataset.t !== t)); $('#v').innerHTML = skeleton(3); await views[t](); };
  $$('[data-t]').forEach(b => b.onclick = () => go(b.dataset.t)); go('meet');
}
