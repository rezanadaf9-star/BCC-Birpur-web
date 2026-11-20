// "Add account" / account switcher (Instagram style). Several accounts stay signed in on one device; switching never signs the others out.
// Each account has its own Firebase app "slot" (its own saved login) and its own device-session record (2 web + 2 app per person).
// Only names and slot ids are stored here. NO tokens are ever copied into localStorage.
import * as FB from './firebase-client.js';
import { clearCache } from './cache.js';
const KEY = 'bcc-accounts', MAX = 5;
export const accounts = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const store = a => localStorage.setItem(KEY, JSON.stringify(a.slice(0, MAX)));
export const currentId = () => localStorage.getItem('bcc-current');
export async function remember(me) {
  if (!FB.auth.currentUser) return;
  const a = accounts(), i = a.findIndex(x => x.id === me.id);
  const e = { id: me.id, role: me.role, name: me.full_name, loginId: me.login_id, classNo: me.student?.class_no ?? null, slot: FB.slot };
  if (i >= 0) a[i] = e; else a.push(e);
  store(a); localStorage.setItem('bcc-current', me.id);
}
export function forget(id) {
  const e = accounts().find(x => x.id === id);
  store(accounts().filter(x => x.id !== id)); if (currentId() === id) localStorage.removeItem('bcc-current');
  if (e && e.slot !== FB.slot) FB.dropSlot(e.slot);
}
/** Is the login session of the signed-in user of the CURRENT slot still active (not replaced on another device)? */
export async function sessionIsActive() {
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  const u = FB.auth.currentUser; if (!u) return false;
  const sid = (await u.getIdTokenResult()).claims.bsid; if (!sid) return false;
  try { const s = await getDoc(doc(FB.db, 'users', u.uid, 'sessions', sid)); return s.exists() && !s.data().revoked_at; }
  catch { return true; }                        // offline / temporary error: do not sign people out because of a network blip
}
export async function switchTo(id) {
  const e = accounts().find(x => x.id === id); if (!e) throw new Error('Account not found.');
  clearCache(); sessionStorage.removeItem('bcc-notice');
  FB.useSlot(e.slot);
  const user = await FB.authReady();
  if (!user) { forget(id); throw new Error('That account was signed out. Please sign in to it again.'); }
  if (!(await sessionIsActive())) { forget(id); await FB.auth.signOut(); throw new Error('That account was signed out because it was used on more devices than allowed. Please sign in again.'); }
  localStorage.setItem('bcc-current', id); return e;
}
