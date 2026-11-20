// Browser-side stand-in for the Firebase web SDK, used ONLY by the browser tests (served instead of gstatic.com).
// It forwards every call to the local test server, which runs the project's real Cloud Function code on an in-memory database.
// It does NOT enforce Firestore/Storage security rules (use the emulator for that).
const B = '/__fb';
const post = async (p, body, token) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': token || '' }, body: JSON.stringify(body || {}) }); return r.json(); };
const apps = new Map(), auths = new Map();
export const initializeApp = (cfg, name = '[default]') => { const a = { name, options: cfg }; apps.set(name, a); return a; };
export const getApps = () => [...apps.values()]; export const getApp = n => apps.get(n || '[default]'); export const deleteApp = async a => { apps.delete(a.name); };
export const initializeAppCheck = () => ({}); export class ReCaptchaV3Provider { constructor(k) { this.k = k; } }
// ---- auth
const listeners = new Map();
export function getAuth(app) {
  if (auths.has(app.name)) return auths.get(app.name);
  const key = 'shimAuth:' + app.name; const saved = JSON.parse(localStorage.getItem(key) || 'null');
  const auth = { app, currentUser: null, signOut: async () => { auth.currentUser = null; localStorage.removeItem(key); (listeners.get(app.name) || []).forEach(f => f(null)); } };
  const mk = (uid, token) => ({ uid, getIdToken: async () => token, getIdTokenResult: async () => ({ claims: (await post('/auth/claims', {}, token)).claims || {} }), __token: token });
  auth.__set = (uid, token) => { auth.currentUser = mk(uid, token); localStorage.setItem(key, JSON.stringify({ uid, token })); };
  if (saved) auth.currentUser = mk(saved.uid, saved.token);
  auths.set(app.name, auth); return auth;
}
export const onAuthStateChanged = (auth, cb) => { const l = listeners.get(auth.app.name) || []; l.push(cb); listeners.set(auth.app.name, l); Promise.resolve().then(() => cb(auth.currentUser)); return () => {}; };
export async function signInWithEmailAndPassword(auth, email, pw) { const r = await post('/auth/signin', { email, password: pw }); if (r.error) { const e = new Error(r.error); e.code = 'auth/invalid-credential'; throw e; } auth.__set(r.uid, r.token); return { user: auth.currentUser }; }
export async function signInWithCustomToken(auth, tok) { const r = await post('/auth/custom', { token: tok }); if (r.error) { const e = new Error(r.error); e.code = 'auth/invalid-custom-token'; throw e; } auth.__set(r.uid, r.token); return { user: auth.currentUser }; }
// ---- functions
export const getFunctions = (app, region) => ({ app, region });
export const httpsCallable = (fns, name) => async data => {
  const auth = auths.get(fns.app.name); const token = auth && auth.currentUser ? auth.currentUser.__token : '';
  const r = await post('/call', { name, data }, token);
  if (r.error) { const e = new Error(r.error.message); e.code = 'functions/' + String(r.error.status || 'internal').toLowerCase().replace(/_/g, '-'); throw e; }
  return { data: r.result };
};
// ---- firestore
const parentOf = path => { const s = path.split('/'); return s.length > 1 ? mkRef(s.slice(0, -1).join('/')) : null; };
const mkRef = path => ({ path, id: path.split('/').pop(), get parent() { return parentOf(path); } });
export const getFirestore = app => ({ app });
export const collection = (db, ...seg) => ({ __col: true, db, path: seg.join('/'), id: seg[seg.length - 1] });
export const collectionGroup = (db, name) => ({ __col: true, __group: true, db, path: name, id: name });
export const doc = (db, ...seg) => ({ __doc: true, db, ...mkRef(seg.join('/')), path: seg.join('/') });
export const where = (f, op, v) => ({ k: 'where', f, op, v }); export const orderBy = (f, d = 'asc') => ({ k: 'order', f, d }); export const limit = n => ({ k: 'limit', n }); export const startAfter = s => ({ k: 'after', path: s.ref.path });
export const query = (base, ...c) => ({ __q: true, base, c });
export const serverTimestamp = () => new Date().toISOString();
const spec = q => { const base = q.__q ? q.base : q, c = q.__q ? q.c : []; return { group: !!base.__group, path: base.path, filters: c.filter(x => x.k === 'where').map(x => [x.f, x.op, x.v]), order: c.filter(x => x.k === 'order').map(x => [x.f, x.d]), limit: (c.find(x => x.k === 'limit') || {}).n || null, after: (c.find(x => x.k === 'after') || {}).path || null }; };
const dbOf = q => (q.__q ? q.base : q).db;
const tokenOf = db => { const a = auths.get(db.app.name); return a && a.currentUser ? a.currentUser.__token : ''; };
const snap = d => ({ id: d.path.split('/').pop(), ref: mkRef(d.path), exists: () => d.data !== undefined && d.data !== null, data: () => (d.data == null ? undefined : JSON.parse(JSON.stringify(d.data))), get: p => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), d.data), metadata: { fromCache: false } });
const qsnap = docs => { const ds = docs.map(snap); return { docs: ds, size: ds.length, empty: !ds.length, forEach: f => ds.forEach(f), metadata: { fromCache: false } }; };
const fsq = async (db, body) => { const r = await post('/fs/query', body, tokenOf(db)); if (r.error) { const e = new Error(r.error); e.code = 'failed-precondition'; throw e; } return r; };
export const getDocs = async q => qsnap((await fsq(dbOf(q), spec(q))).docs);
export const getDoc = async ref => { const r = await post('/fs/get', { path: ref.path }, tokenOf(ref.db)); return snap({ path: ref.path, data: r.data }); };
export const getCountFromServer = async q => { const r = await fsq(dbOf(q), spec(q)); return { data: () => ({ count: r.docs.length }) }; };
export const addDoc = async (c, data) => { const r = await post('/fs/add', { path: c.path, data }, tokenOf(c.db)); return mkRef(r.path); };
export const setDoc = async (ref, data, opts) => { await post('/fs/set', { path: ref.path, data, merge: !!(opts && opts.merge) }, tokenOf(ref.db)); };
export const updateDoc = async (ref, data) => { const r = await post('/fs/update', { path: ref.path, data }, tokenOf(ref.db)); if (r.error) throw new Error(r.error); };
export const deleteDoc = async ref => { await post('/fs/delete', { path: ref.path }, tokenOf(ref.db)); };
export const writeBatch = db => { const ops = []; return { set: (r, d, o) => ops.push(() => setDoc(r, d, o)), update: (r, d) => ops.push(() => updateDoc(r, d)), delete: r => ops.push(() => deleteDoc(r)), commit: async () => { for (const f of ops) await f(); } }; };
export const onSnapshot = (q, next, err) => {
  let stop = false, first = true;
  const run = async () => { try { if (q.__doc) next(await getDoc(q)); else next(await getDocs(q)); } catch (e) { err && err(e); } };
  run(); const t = setInterval(() => { if (!stop && !document.hidden) run(); }, 2500); return () => { stop = true; clearInterval(t); };
};
// ---- storage
export const getStorage = app => ({ app }); export const ref = (st, path) => ({ st, path });
const buf = async b => (b instanceof Blob ? b : new Blob([b]));
export const uploadBytes = async (r, blob, meta) => { const b = await buf(blob); await fetch(B + '/storage/put?path=' + encodeURIComponent(r.path) + '&type=' + encodeURIComponent((meta && meta.contentType) || b.type || ''), { method: 'POST', body: b }); return { ref: r }; };
export const uploadBytesResumable = (r, blob, meta) => ({ on: (ev, prog, err, done) => { buf(blob).then(b => { prog && prog({ bytesTransferred: b.size, totalBytes: b.size }); return uploadBytes(r, b, meta); }).then(() => done && done()).catch(e => err && err(e)); } });
export const getBlob = async r => { const x = await fetch(B + '/storage/get?path=' + encodeURIComponent(r.path)); if (!x.ok) throw new Error('storage/object-not-found'); return x.blob(); };
export const getDownloadURL = async r => { const x = await fetch(B + '/storage/get?path=' + encodeURIComponent(r.path)); if (!x.ok) throw new Error('storage/object-not-found'); return B + '/storage/get?path=' + encodeURIComponent(r.path); };
export const deleteObject = async r => { await fetch(B + '/storage/del?path=' + encodeURIComponent(r.path), { method: 'POST' }); };
// ---- messaging
export const isSupported = async () => false; export const getMessaging = () => ({}); export const getToken = async () => null; export const deleteToken = async () => true;
