import { fn } from './api.js';
import { modal, esc } from './ui.js';
/** One celebration per declared exam per student (stored in result_popup_acks). */
export async function maybeShowResultPopup(me) {
  let data; try { data = (await fn('pendingResultPopup', {})).exam; } catch { return; } if (!data || !data.id) return;
  const ack = () => fn('ackResultPopup', { exam_id: data.id }).catch(() => {});
  const m = modal(`<div style="text-align:center"><div style="font-size:54px">🎉</div><h2 style="margin:8px 0">Your result is out!</h2><p style="color:var(--muted);margin-bottom:16px">${esc(data.exam_name)}</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn y" href="marks.html" id="vr">View My Result</a><button class="btn ghost" id="ml">Maybe Later</button></div></div>`);
  m.querySelector('#vr').onclick = () => ack(); m.querySelector('#ml').onclick = async () => { await ack(); m.remove(); };
}
