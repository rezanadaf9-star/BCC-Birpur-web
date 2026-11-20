import { mountShell } from '../shared/shell.js';
import { db, doc, setDoc, rows as qrows, col, query, where, orderBy, limit, onSnapshot } from '../core/db.js';
import { fn } from '../shared/api.js';
import { audienceFor } from '../core/notifications.js';
import { $, $$, esc, empty, skeleton, toast } from '../shared/ui.js';
import { ROOT } from '../core/auth.js';
const { me, content } = await mountShell({ role: 'student', active: 'announcements.html', title: 'Announcements', subtitle: 'Notices and notifications' });
let tab = 'ann';
content.innerHTML = `<div style="display:flex;gap:8px"><button class="btn sm" data-t="ann">Announcements</button><button class="btn sm ghost" data-t="not">Notifications</button></div><section class="card" id="v">${skeleton(4)}</section>`;
const COL = { navy: 'var(--navy)', yellow: 'var(--yellow)', green: 'var(--green)', red: 'var(--red)', blue: 'var(--blue)', orange: 'var(--orange)' };
const ICON = { lecture: 'fa-circle-play', note: 'fa-book-open', homework: 'fa-pen-to-square', quiz: 'fa-list-check', result: 'fa-chart-column', announcement: 'fa-bullhorn', ptm: 'fa-video', live: 'fa-tower-broadcast', general: 'fa-bell', meeting: 'fa-video' };
async function ann() { const nowIso = new Date().toISOString(); const parts = await Promise.all([null, me.student.class_no].map(t => qrows(query(col('announcements'), where('is_active', '==', true), where('target_class', '==', t), orderBy('publish_at', 'desc'), limit(30)))));
  const data = parts.flat().filter(a => a.publish_at <= nowIso).sort((a, b) => b.publish_at.localeCompare(a.publish_at));
  $('#v').innerHTML = (data || []).length ? data.map(a => `<div style="padding:14px 16px;margin-bottom:12px;border-radius:14px;border-left:6px solid ${COL[a.accent] || COL.navy};background:var(--yellow-wash)"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(a.title)}</b><small style="color:var(--muted)">${new Date(a.publish_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>${a.headline ? `<div style="font-weight:500;margin-top:2px">${esc(a.headline)}</div>` : ''}<div style="white-space:pre-wrap;margin-top:6px">${esc(a.body)}</div></div>`).join('') : empty('fa-bullhorn', 'No announcements right now.'); }
async function notes() {
  const seen = me.last_notif_seen_at || '1970-01-01T00:00:00.000Z';
  const [n, rd] = await Promise.all([qrows(query(col('notifications'), where('audience', 'array-contains-any', audienceFor(me)), orderBy('created_at', 'desc'), limit(60))), qrows(query(col('users', me.id, 'notif_reads'), where('notif_created_at', '>', seen)))]);
  const read = new Set(rd.map(x => x.id)); n.forEach(x => { if (x.created_at <= seen) read.add(x.id); });
  const unread = (n || []).filter(x => !read.has(x.id)).length;
  $('#v').innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>${unread} unread</b><button class="btn ghost sm" id="all" ${unread ? '' : 'disabled'}>Mark all as read</button></div>` + ((n || []).length ? n.map(x => `<a href="#" data-i="${x.id}" style="display:flex;gap:12px;padding:12px;border-radius:12px;margin-bottom:6px;background:${read.has(x.id) ? 'transparent' : 'var(--yellow-wash)'}"><span class="stat"><span class="ico ${read.has(x.id) ? '' : 'y'}" style="width:38px;height:38px;font-size:15px"><i class="fa-solid ${ICON[x.kind] || 'fa-bell'}"></i></span></span><div><b style="font-weight:${read.has(x.id) ? 500 : 600}">${esc(x.title)}</b><div style="font-size:13px;color:var(--muted)">${esc(x.body || '')}</div><small style="color:var(--muted)">${new Date(x.created_at).toLocaleString('en-IN')}</small></div></a>`).join('') : empty('fa-bell', 'No notifications yet.'));
  const mark = async ids => { if (!ids.length) return; sessionStorage.removeItem(`bcc:${me.id}:unread`); await Promise.all(ids.map(id => { const x = n.find(y => y.id === id); return setDoc(doc(db, 'users', me.id, 'notif_reads', id), { notif_created_at: x.created_at, read_at: new Date().toISOString() }); })); };
  $('#all')?.addEventListener('click', async () => { sessionStorage.removeItem(`bcc:${me.id}:unread`); await fn('markNotificationsSeen', {}); me.last_notif_seen_at = new Date().toISOString(); sessionStorage.removeItem('bcc:me'); notes(); toast('All marked as read.', 'ok'); });
  $$('[data-i]').forEach(a => a.onclick = async e => { e.preventDefault(); const x = n.find(y => y.id === a.dataset.i); await mark([x.id]); if (x.link) location.href = ROOT.replace(/\/$/, '') + x.link; else notes(); }); }
const go = t => { tab = t; $$('[data-t]').forEach(b => b.classList.toggle('ghost', b.dataset.t !== t)); $('#v').innerHTML = skeleton(3); t === 'ann' ? ann() : notes(); };
$$('[data-t]').forEach(b => b.onclick = () => go(b.dataset.t)); go(new URLSearchParams(location.search).get('tab') === 'notifications' ? 'not' : 'ann');
let first = true; onSnapshot(query(col('notifications'), where('audience', 'array-contains-any', audienceFor(me)), orderBy('created_at', 'desc'), limit(1)), () => { if (first) { first = false; return; } if (tab === 'not') notes(); }, () => {});
