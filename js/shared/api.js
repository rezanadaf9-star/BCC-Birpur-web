import { call, db } from '../core/firebase-client.js';
import { collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
/** Call a Cloud Function. Short legacy names are mapped to the deployed function names. */
const NAMES = { 'admin-create-user': 'adminUsers', 'start-quiz': 'startQuiz', 'submit-quiz': 'submitQuiz', 'attempt-result': 'getAttemptResult' };
export const fn = (name, body) => call(NAMES[name] || name, body);
export const admin = body => fn('admin-create-user', body);
export const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(10)), b => a[b % a.length]).join(''); };
export const activeClasses = async () => (await getDocs(query(collection(db, 'classes'), where('is_active', '==', true), orderBy('sort_order')))).docs.map(d => d.data());
