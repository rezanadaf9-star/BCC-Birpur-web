// Stale-while-revalidate: show cached data instantly, refresh quietly in the background.
// Every saved entry belongs to ONE signed-in person (their uid is part of the key), so one student can never be shown another student's
// cached data after an account switch on the same device. Nothing is persisted before the person is known.
import * as FB from './firebase-client.js';
const mem = new Map();
const who = () => (FB.auth && FB.auth.currentUser && FB.auth.currentUser.uid) || null;
export async function swr(key, fetcher, onData, ttl = 60_000) {
  const id = who(), k = id ? `bcc:${id}:${key}` : null;
  if (k) { const raw = sessionStorage.getItem(k); if (raw) { try { const c = JSON.parse(raw); onData(c.v, true); if (Date.now() - c.t < ttl) return c.v; } catch {} } }
  const mk = (id || 'anon') + ':' + key; if (mem.has(mk)) return mem.get(mk);
  const p = fetcher().then(v => { if (k && who() === id) { try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch {} } onData(v, false); return v; }).finally(() => mem.delete(mk));
  mem.set(mk, p); return p;
}
/** Remove every cached entry of every person from this tab (logout, account switch, sign-in). */
export const clearCache = () => { Object.keys(sessionStorage).filter(k => k.startsWith('bcc:')).forEach(k => sessionStorage.removeItem(k)); mem.clear(); };
