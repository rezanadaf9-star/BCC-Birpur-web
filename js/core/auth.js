import * as FB from './firebase-client.js';
import { signInWithEmailAndPassword, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { CONFIG } from '../config.js';
import { clearCache } from './cache.js';
import { remember, forget, accounts, switchTo, sessionIsActive } from './accounts.js';
export const ROOT = new URL('../../', import.meta.url).href;   // site root, works under /repo-name/ too
export const HOME = { student: ROOT+'student/dashboard.html', teacher: ROOT+'teacher/dashboard.html', admin: ROOT+'admin/dashboard.html' };
/** Student: Student ID (26BCC1001) -> internal email.  Teacher: their own email.  Admin: type the ID ADMIN. */
export const loginEmail = (portal, id) => { const x = String(id).trim();
  if (x.toUpperCase() === 'ADMIN') return CONFIG.ADMIN_EMAIL;
  if (portal === 'teacher') { if (!x.includes('@')) throw new Error('Teachers sign in with their email address.'); return x.toLowerCase(); }
  return `${x.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@${CONFIG.AUTH_EMAIL_DOMAIN}`; };

/** Shape of the profile the pages already expect: { id, role, full_name, login_id, is_active, photo_path, student:{...} }. */
const shape = (id, d) => { const me = { id, role: d.role, full_name: d.full_name, login_id: d.login_id, is_active: d.is_active, photo_path: d.photo_path || null, last_notif_seen_at: d.last_notif_seen_at || null };
  if (d.role === 'student') me.student = { ...d.student, user_id: id, photo_path: d.photo_path || null };
  if (d.role === 'teacher') me.teacher = d.teacher; if (d.role === 'parent') me.parent = d.parent; return me; };

/** Sign in, then confirm the account really belongs to the portal the person used. */
export async function login(portal, identifier, password) {
  const email = loginEmail(portal, identifier);
  clearCache();
  const oldSlot = FB.slot; FB.useSlot(FB.newSlotName(), false);         // a fresh slot: other accounts on this device stay untouched
  const abort = async () => { const s = FB.slot; try { await FB.auth.signOut(); } catch {} await FB.dropSlot(s); FB.useSlot(oldSlot, false); };
  try { await signInWithEmailAndPassword(FB.auth, email, password); }
  catch (e) { await abort(); throw new Error(e.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes and try again.' : 'Incorrect ID or password.'); }
  let me;
  try { const s = await getDoc(doc(FB.db, 'users', FB.auth.currentUser.uid)); me = s.exists() ? shape(s.id, s.data()) : null; } catch { me = null; }
  const okRole = me && (portal === 'teacher' ? ['teacher', 'admin'].includes(me.role) : me.role === portal);   // admins use the Teacher card
  if (!me || !okRole) { await abort(); throw new Error(`This account is not a ${portal} account. Use the correct login.`); }
  if (me.is_active === false) { await abort(); throw new Error('This account is paused. Please contact the centre.'); }
  // register this device (server enforces 2 web + 2 app sessions) and continue with the session token
  let reg;
  try { reg = await FB.call('registerSession', { platform: 'web', deviceLabel: navigator.userAgent.slice(0, 80) }); await signInWithCustomToken(FB.auth, reg.customToken); }
  catch (e) { await abort(); throw new Error(e.message); }
  // the same person signing in again on this device replaces their old slot
  const dup = accounts().find(a => a.id === me.id); if (dup && dup.slot !== FB.slot) { FB.dropSlot(dup.slot); }
  localStorage.setItem('bcc-slot', FB.slot);
  if (reg.replaced_sessions > 0) sessionStorage.setItem('bcc-notice', `You are signed in. This account can be open on ${reg.allowed_sessions} browsers at a time, so the oldest browser was signed out.`);
  await remember(me);
  cacheMe(me); return me;
}
let _me = null, _unwatch = null;
const ME_KEY = 'bcc:me', ME_TTL = 10 * 60_000;
const cacheMe = me => { try { sessionStorage.setItem(ME_KEY, JSON.stringify({ t: Date.now(), slot: FB.slot, v: me })); } catch {} };
export async function getMe(force = false) {
  if (_me && !force) return _me;
  const user = await FB.authReady(); if (!user) return null;
  if (!force) { try { const c = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null'); if (c && c.slot === FB.slot && c.v.id === user.uid && Date.now() - c.t < ME_TTL) return (_me = c.v); } catch {} }
  const s = await getDoc(doc(FB.db, 'users', user.uid)); if (!s.exists()) return null;
  _me = shape(s.id, s.data()); cacheMe(_me); return _me;
}
/** Signs this browser out the moment the server marks its login session as replaced / revoked. */
async function watchSession() {
  if (_unwatch) return; const u = FB.auth.currentUser; const sid = (await u.getIdTokenResult()).claims.bsid; if (!sid) return;
  _unwatch = onSnapshot(doc(FB.db, 'users', u.uid, 'sessions', sid), async snap => {
    if (snap.metadata.fromCache && !snap.exists()) return;
    if (!snap.exists() || snap.data().revoked_at) { forget(u.uid); try { await FB.auth.signOut(); } catch {} clearCache(); location.replace(ROOT + 'index.html#session-ended'); }
  }, () => {});
  // keep "last seen" fresh: at most once every 15 minutes
  const last = Number(sessionStorage.getItem('bcc-touch') || 0); if (Date.now() - last > 15 * 60_000) { sessionStorage.setItem('bcc-touch', String(Date.now())); FB.call('touchSession').catch(() => {}); }
}
/** Call at the top of every protected page. Redirects if not signed in or wrong role. */
export async function requireRole(roles) {
  const me = await getMe();
  if (!me) { location.replace(ROOT+'index.html#login'); await new Promise(() => {}); }
  if (!roles.includes(me.role)) { location.replace(HOME[me.role]); await new Promise(() => {}); }
  if (!(await sessionIsActive())) { forget(me.id); await FB.auth.signOut(); location.replace(ROOT+'index.html#session-ended'); await new Promise(() => {}); }
  watchSession(); return me;
}
export async function logout() {
  const me = _me; try { const { disablePush } = await import('./push.js'); await disablePush(); } catch {} try { await FB.call('logoutSession'); } catch {}
  if (_unwatch) { _unwatch(); _unwatch = null; }
  try { await FB.auth.signOut(); } catch {} clearCache(); _me = null;
  if (me) forget(me.id);
  const next = accounts()[0];                                    // another account is still signed in on this device: switch to it
  if (next) { try { const e = await switchTo(next.id); location.replace(HOME[e.role]); return; } catch {} }
  location.replace(ROOT + 'index.html');
}
/** Used by the guest page: is anybody signed in on this device? */
export const hasSavedLogin = () => accounts().length > 0;
