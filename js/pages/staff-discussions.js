import { mountShell } from '../shared/shell.js';
import { db, doc, getDoc, getDocs, collectionGroup, query, where, orderBy, limit } from '../core/db.js';
import { fn } from '../shared/api.js';
import { $, $$, esc, modal, toast, empty, skeleton } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const { me, content } = await mountShell({ role, active: 'discussions.html', title: 'Discussions' });
content.innerHTML = `<section class="card"><div class="card-head"><h3>Lecture discussions</h3></div><div id="list">${skeleton(4)}</div></section>`;
async function load() {
  const cq = me.role === 'admin' ? query(collectionGroup(db, 'comments'), orderBy('created_at', 'desc'), limit(300)) : query(collectionGroup(db, 'comments'), where('class_no', 'in', (me.teacher?.assignments || []).map(a => a.class_no).slice(0, 30)), orderBy('created_at', 'desc'), limit(300));
  const com = (await getDocs(cq)).docs.map(d => ({ id: d.id, ...d.data() })).reverse();
  const ids = [...new Set(com.map(c => c.lecture_id))]; const lec = (await Promise.all(ids.map(async i => { const s = await getDoc(doc(db, 'lectures', i)); return s.exists() ? { id: s.id, ...s.data() } : null; }))).filter(Boolean);
  const by = {}; (com || []).forEach(c => (by[c.lecture_id] ||= []).push(c));
  const rows = (lec || []).filter(l => by[l.id]).map(l => { const cs = by[l.id], unanswered = cs.filter(c => c.author_role === 'student' && !c.parent_id && !cs.some(r => r.parent_id === c.id && r.author_role !== 'student')).length; return { l, cs, unanswered }; }).sort((a, b) => b.unanswered - a.unanswered);
  $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Lecture</th><th>Class</th><th>Comments</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.l.title)}</td><td>${r.l.class_no}</td><td>${r.cs.length} ${r.unanswered ? `<span class="badge" title="Unanswered doubts">${r.unanswered}</span>` : ''}</td><td><button class="btn ghost sm" data-o="${r.l.id}">Open</button></td></tr>`).join('')}</tbody></table></div>` : empty('fa-comments', 'No discussions yet.');
  $$('[data-o]').forEach(b => b.onclick = () => open(rows.find(r => r.l.id === b.dataset.o)));
}
function open(r) { const m = modal(`<h3>${esc(r.l.title)}</h3><div style="margin:12px 0;max-height:50vh;overflow:auto">${r.cs.map(c => `<div style="padding:8px 0 8px ${c.parent_id ? 24 : 0}px;border-bottom:1px solid var(--line)"><b>${esc(c.author_name)}</b> <span class="tag">${esc(c.author_role)}</span><div>${esc(c.body)}</div><a href="#" data-r="${c.id}" style="font-size:12.5px">Reply</a>${isAdmin ? ` · <a href="#" data-x="${c.id}" style="font-size:12.5px;color:var(--red)">Delete</a>` : ''}</div>`).join('')}</div>
  <textarea class="input" id="rb" placeholder="Write a reply…"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-c>Close</button><button class="btn y" data-s>Send</button></div>`);
  let parent = null; m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelectorAll('[data-r]').forEach(a => a.onclick = e => { e.preventDefault(); parent = a.dataset.r; m.querySelector('#rb').focus(); m.querySelector('#rb').placeholder = 'Replying to a comment…'; });
  m.querySelectorAll('[data-x]').forEach(a => a.onclick = async e => { e.preventDefault(); if (confirm('Delete this comment?')) { try { await fn('deleteLectureComment', { lecture_id: r.l.id, id: a.dataset.x }); } catch (er) { toast(er.message, 'err'); } m.remove(); load(); } });
  m.querySelector('[data-s]').onclick = async () => { const body = m.querySelector('#rb').value.trim(); if (!body) return; try { await fn('postLectureComment', { lecture_id: r.l.id, body, parent_id: parent }); m.remove(); toast('Sent.', 'ok'); load(); } catch (error) { toast(error.message, 'err'); } }; }
load();
