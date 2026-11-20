// The one place that talks to the Firebase SDK. Each signed-in account on a device lives in its own named Firebase app
// ("slot"), so several accounts can stay signed in side by side without any token ever being copied into localStorage.
import { initializeApp, getApps, getApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js';
import { CONFIG } from '../config.js';

const SLOT_KEY = 'bcc-slot';
export let slot = localStorage.getItem(SLOT_KEY) || 'acct-0';
export let app, auth, db, functions, storage;

function open(name) {
  const a = getApps().find(x => x.name === name) || initializeApp(CONFIG.FIREBASE, name);
  if (CONFIG.APP_CHECK_SITE_KEY && !a.__bccAppCheck) { try { initializeAppCheck(a, { provider: new ReCaptchaV3Provider(CONFIG.APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }); a.__bccAppCheck = true; } catch { /* already initialised */ } }
  return a;
}
/** Point every export at another account slot. Pages reload after switching, so this mostly runs once per page. */
export function useSlot(name, remember = true) {
  slot = name; app = open(name); auth = getAuth(app); db = getFirestore(app); storage = getStorage(app);
  functions = getFunctions(app, CONFIG.FUNCTIONS_REGION);
  if (remember) localStorage.setItem(SLOT_KEY, name);
}
export const newSlotName = () => 'acct-' + Date.now().toString(36);
export async function dropSlot(name) { const a = getApps().find(x => x.name === name); if (a) await deleteApp(a).catch(() => {}); }
useSlot(slot, false);

/** Resolves with the signed-in user (or null) once Firebase has restored the saved login. */
export const authReady = () => new Promise(res => { const un = onAuthStateChanged(auth, u => { un(); res(u); }); });

/** Call a Cloud Function and return a readable error. */
export async function call(name, data = {}) {
  try { return (await httpsCallable(functions, name)(data)).data; }
  catch (e) { throw new Error(e && e.message && e.message !== 'internal' ? e.message : 'The server could not finish this request. Please try again.'); }
}
