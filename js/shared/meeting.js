import { rows as qrows, col, query, orderBy, onSnapshot } from '../core/db.js';
import { fn } from './api.js';
import { esc, toast } from './ui.js';
const loadApi = () => new Promise((res, rej) => { if (window.JitsiMeetExternalAPI) return res(); const s = document.createElement('script'); s.src = 'https://meet.jit.si/external_api.js'; s.onload = res; s.onerror = () => rej(new Error('The meeting service could not be loaded. Check your internet connection.')); document.head.append(s); });
/** Names of everyone who joined (live list), for students, teachers and admins alike. */
export async function participantsHtml(id) {
  const data = await qrows(query(col('meetings', id, 'participants'), orderBy('joined_at')));
  const t = d => d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  return (data || []).length ? (data || []).map(p => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13.5px"><span><i class="fa-solid fa-circle" style="font-size:8px;color:${p.left_at ? 'var(--grey-300)' : 'var(--green)'}"></i> ${esc(p.name)} <span class="tag">${esc(p.role)}</span></span><small style="color:var(--muted)">${t(p.joined_at)}${p.left_at ? ' – ' + t(p.left_at) : ''}</small></div>`).join('') : '<p style="color:var(--muted);font-size:13.5px">Nobody has joined yet.</p>';
}
/** Join a live meeting inside the page. The room name is handed out by the database only to invited, signed-in people while the session is live. */
export async function openMeeting({ id, host, name, onClose }) {
  try {
    const { room } = await fn('joinMeeting', { id }); await loadApi();
    host.innerHTML = `<section class="card" style="padding:0;overflow:hidden;margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--navy);color:#fff;gap:8px;flex-wrap:wrap"><b><i class="fa-solid fa-video"></i> Live session</b><div style="display:flex;gap:8px"><button class="btn y sm" id="mfs">Full screen</button><button class="btn red sm" id="mx">Leave</button></div></div>
      <div style="display:grid;grid-template-columns:1fr 260px"><div id="jitsi" style="height:min(75vh,720px);background:#000"></div><aside style="padding:12px 14px;overflow:auto;max-height:min(75vh,720px)"><h4 style="margin-bottom:8px">Who joined</h4><div id="who"></div></aside></div></section><style>@media(max-width:860px){#jitsi{height:60vh!important}#jitsi+aside{grid-column:1}.card>div[style*="260px"]{grid-template-columns:1fr!important}}</style>`;
    const who = async () => { const el = host.querySelector('#who'); if (el) el.innerHTML = await participantsHtml(id); }; who();
    const stop = onSnapshot(query(col('meetings', id, 'participants'), orderBy('joined_at')), () => who(), () => {});
    const api = new window.JitsiMeetExternalAPI('meet.jit.si', { roomName: room, parentNode: host.querySelector('#jitsi'), width: '100%', height: '100%', userInfo: { displayName: name },
      configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true, disableAP: true, enableWelcomePage: false },
      interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, SHOW_WATERMARK_FOR_GUESTS: false, SHOW_BRAND_WATERMARK: false, SHOW_POWERED_BY: false, SHOW_PROMOTIONAL_CLOSE_PAGE: false, MOBILE_APP_PROMO: false } });
    const leave = async () => { try { api.dispose(); } catch {} stop(); await fn('leaveMeeting', { id }).catch(() => {}); host.innerHTML = ''; onClose?.(); };
    host.querySelector('#mx').onclick = leave; api.addEventListener('readyToClose', leave); window.addEventListener('pagehide', () => { fn('leaveMeeting', { id }).catch(() => {}); }, { once: true });
    host.querySelector('#mfs').onclick = () => host.querySelector('#jitsi').requestFullscreen?.(); host.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message || 'Could not join.', 'err'); }
}
