// Portal-wide switches (new). Currently: the Attendance feature.
//
// HOW TO TURN ATTENDANCE ON / OFF
//   Option A (no code): sign in as admin > "Portal Settings" > switch "Attendance" on or off.
//   Option B (code):    change CONFIG.ATTENDANCE in js/config.js:
//        "panel" = follow the switch in the admin panel (default)
//        "off"   = attendance is hard-disabled for everyone, whatever the panel says
//        "on"    = attendance is hard-enabled for everyone, whatever the panel says
//
// When attendance is OFF no student, teacher or admin sees the Attendance page, the Holidays page,
// attendance numbers on dashboards or report cards, or the attendance notice. The backend
// (Cloud Functions, database) is untouched, so switching it back ON restores everything.
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import * as FB from './firebase-client.js';
import { CONFIG } from '../config.js';

const KEY = 'bcc:flag-attendance', TTL = 60_000;
/** Pages that exist only because of attendance. */
export const ATTENDANCE_PAGES = ['attendance.html', 'holidays.html'];

export async function attendanceEnabled() {
  const mode = String(CONFIG.ATTENDANCE || 'panel').toLowerCase();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  try { const h = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (h && Date.now() - h.t < TTL) return h.v; } catch {}
  let v = false;                                   // no setting saved yet = disabled (the centre does not use attendance)
  try { const s = await getDoc(doc(FB.db, 'app_settings', 'features')); v = s.exists() && s.data().attendance_enabled === true; } catch { v = false; }
  try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), v })); } catch {}
  return v;
}
export const forgetFlags = () => { try { sessionStorage.removeItem(KEY); } catch {} };
