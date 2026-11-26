// Admin > Portal Settings. Switches that apply to the whole portal. Stored in Firestore: app_settings/features.
import { mountShell } from '../shared/shell.js';
import { db, doc, setDoc } from '../core/db.js';
import { CONFIG } from '../config.js';
import { attendanceEnabled, forgetFlags } from '../core/flags.js';
import { $, toast } from '../shared/ui.js';
const { content } = await mountShell({ role: 'admin', active: 'settings.html', title: 'Portal Settings' });
const mode = String(CONFIG.ATTENDANCE || 'panel').toLowerCase(), locked = mode === 'on' || mode === 'off';
let on = await attendanceEnabled();
content.innerHTML = `<section class="card" style="max-width:760px">
  <div class="card-head"><h3>Attendance</h3></div>
  <label class="switch-row"><span><b id="state">${on ? 'Attendance is ON' : 'Attendance is OFF'}</b><small id="hint"></small></span>
    <span class="switch"><input type="checkbox" id="att" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}><i></i></span></label>
  <p class="settings-note">${locked ? `Locked in <code>js/config.js</code> (<code>ATTENDANCE: "${mode}"</code>). Set it to <code>"panel"</code> to use this switch.` : ''}</p>
</section>`;
const paint = () => { $('#state').textContent = on ? 'Attendance is ON' : 'Attendance is OFF'; $('#hint').textContent = on ? '' : ''; };
paint();
$('#att').onchange = async e => {
  const next = e.target.checked; e.target.disabled = true;
  try { await setDoc(doc(db, 'app_settings', 'features'), { attendance_enabled: next, updated_at: new Date().toISOString() }, { merge: true }); forgetFlags(); on = next; paint(); toast(next ? 'Attendance switched ON.' : 'Attendance switched OFF.', 'ok'); }
  catch (err) { e.target.checked = !next; toast(err.message, 'err'); }
  e.target.disabled = false;
};
