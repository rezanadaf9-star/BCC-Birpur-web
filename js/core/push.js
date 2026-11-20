// Push notifications on this device (Firebase Cloud Messaging). Asked for only when the student taps the switch in Settings.
import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import * as FB from './firebase-client.js';
import { CONFIG } from '../config.js';
const KEY = () => 'bcc-push-token:' + (FB.auth.currentUser ? FB.auth.currentUser.uid : 'none');
export const pushSupported = async () => { try { return !!(await isSupported()) && 'Notification' in window && !!CONFIG.VAPID_KEY; } catch { return false; } };
export const pushEnabled = () => !!localStorage.getItem(KEY()) && Notification.permission === 'granted';
export async function enablePush() {
  if (!(await pushSupported())) throw new Error('Push notifications are not available on this browser.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.register(new URL('../../firebase-messaging-sw.js', import.meta.url).href);
  const token = await getToken(getMessaging(FB.app), { vapidKey: CONFIG.VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not enable notifications.');
  await FB.call('subscribePush', { token, platform: 'web' }); localStorage.setItem(KEY(), token); return true;
}
export async function disablePush() {
  const token = localStorage.getItem(KEY()); if (!token) return;
  try { await FB.call('unsubscribePush', { token }); await deleteToken(getMessaging(FB.app)); } catch {} localStorage.removeItem(KEY());
}
