// Firestore helpers in one import. Every page uses this instead of repeating the SDK address.
export * from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
export { db, call } from './firebase-client.js';
import { getDocs, getDoc, doc, collection } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-client.js';
/** Rows of a query as plain objects with their document id as "id". */
export const rows = async q => (await getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));
export const one = async (...path) => { const s = await getDoc(doc(db, ...path)); return s.exists() ? { id: s.id, ...s.data() } : null; };
export const col = (...path) => collection(db, ...path);
