import { collection, query, where, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import * as FB from './firebase-client.js';
import { getMe } from './auth.js';
/** Notifications are addressed with an "audience" list: ['all'] or ['class_10']. Unread = newer than my last-seen time. */
export const audienceFor = me => ['all', `class_${me.student?.class_no}`, `user_${me.id}`];
/** Number of unread notifications for the signed-in student (one cheap count query, cached for a minute). */
export async function unreadCount() {
  const me = await getMe(); if (!me || me.role !== 'student') return 0;
  const k = `bcc:${me.id}:unread`; try { const h = JSON.parse(sessionStorage.getItem(k) || 'null'); if (h && Date.now() - h.t < 60_000) return h.v; } catch {}
  try { const seen = me.last_notif_seen_at || '1970-01-01T00:00:00.000Z';
    const [s, r] = await Promise.all([getCountFromServer(query(collection(FB.db, 'notifications'), where('audience', 'array-contains-any', audienceFor(me)), where('created_at', '>', seen))),
      getCountFromServer(query(collection(FB.db, 'users', me.id, 'notif_reads'), where('notif_created_at', '>', seen)))]);
    const v = Math.max(0, s.data().count - r.data().count); sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); return v; } catch { return 0; }
}
export const markAllSeen = async () => { sessionStorage.removeItem(`bcc:${(await getMe()).id}:unread`); return FB.call('markNotificationsSeen'); };
