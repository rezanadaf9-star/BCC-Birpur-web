export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function toast(msg, type = '') {
  let h = $('.toast-host'); if (!h) { h = document.createElement('div'); h.className = 'toast-host'; document.body.append(h); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; h.append(t); setTimeout(() => t.remove(), 3800);
}
export function modal(html) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); }); document.body.append(bg); return bg;
}
export const initials = n => (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export const fmtDate = (d = new Date()) => new Date(d).toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
export const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton" style="height:44px;margin:8px 0"></div>').join('');
export const empty = (icon, msg) => `<div class="empty"><i class="fa-solid ${icon}"></i>${esc(msg)}</div>`;
/** Retry with backoff for flaky networks. */
export async function retry(fn, tries = 3) { let d = 400; for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, d)); d *= 2; } } }

// ---- India Standard Time (Asia/Kolkata, UTC+05:30, no daylight saving). Times are stored in UTC and always shown/entered in IST.
export const IST = 'Asia/Kolkata';
export const fmtIST = iso => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST' : '';
export const istInputToIso = v => v ? new Date(v + ':00+05:30').toISOString() : null;            // value of <input type="datetime-local"> read as IST
export const isoToIstInput = iso => iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 16) : '';
