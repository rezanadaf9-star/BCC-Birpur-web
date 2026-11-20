import { modal, esc, toast } from './ui.js';
/** Shows login details once, with Copy / Share / WhatsApp. rows = [[label,value],...] */
export function showCredentials(title, rows) {
  const text = ['Brilliant Coaching Centre (BCC)', ...rows.map(([l, v]) => `${l}: ${v}`), 'Please keep these details private.'].join('\n');
  const m = modal(`<h3>${esc(title)}</h3><p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Save these now. The password is not shown again.</p>
    <div style="background:var(--yellow-wash);border-radius:14px;padding:14px;display:grid;gap:6px;font-size:14.5px">${rows.map(([l, v]) => `<div><span style="color:var(--muted)">${esc(l)}:</span> <b style="user-select:all">${esc(v)}</b></div>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn" data-c><i class="fa-regular fa-copy"></i>Copy</button>
    <button class="btn ghost" data-s><i class="fa-solid fa-share-nodes"></i>Share</button>
    <a class="btn green" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>
    <button class="btn ghost" data-x style="margin-left:auto">Done</button></div>`);
  m.querySelector('[data-c]').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied.', 'ok'); } catch { toast('Could not copy. Select and copy manually.', 'err'); } };
  m.querySelector('[data-s]').onclick = async () => { if (navigator.share) { try { await navigator.share({ text }); } catch {} } else toast('Sharing is not supported in this browser. Use Copy or WhatsApp.'); };
  m.querySelector('[data-x]').onclick = () => m.remove();
}
