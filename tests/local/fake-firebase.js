'use strict';
// A small in-memory stand-in for Firestore + Auth + Messaging + Storage, used ONLY to execute the Cloud Functions' business logic
// without a network or the emulator. It supports exactly what the functions use. It is NOT a substitute for the emulator tests.
const { AsyncLocalStorage } = require('async_hooks'); const als = new AsyncLocalStorage();
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const SENT = { inc: Symbol('inc'), del: Symbol('del'), union: Symbol('union'), remove: Symbol('remove') };
const FieldValue = { increment: n => ({ [SENT.inc]: n }), delete: () => ({ [SENT.del]: true }), arrayUnion: (...a) => ({ [SENT.union]: a }), arrayRemove: (...a) => ({ [SENT.remove]: a }), serverTimestamp: () => new Date().toISOString() };
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !Object.getOwnPropertySymbols(v).length;
function applyValue(cur, v) {
  if (v && typeof v === 'object') {
    if (v[SENT.inc] !== undefined) return (cur || 0) + v[SENT.inc];
    if (v[SENT.union]) return [...new Set([...(cur || []), ...v[SENT.union]])];
    if (v[SENT.remove]) return (cur || []).filter(x => !v[SENT.remove].includes(x));
  } return v;
}
function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && v[SENT.del]) { delete target[k]; continue; }
    if (isPlain(v)) { target[k] = target[k] && typeof target[k] === 'object' && !Array.isArray(target[k]) ? target[k] : {}; mergeInto(target[k], v); }
    else target[k] = applyValue(target[k], v);
  } return target;
}
function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => { o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; o = o[k]; }); const last = ks[ks.length - 1]; if (v && v[SENT.del]) delete o[last]; else o[last] = applyValue(o[last], v); }

class Store {
  constructor() { this.docs = new Map(); this.writes = 0; this.reads = 0; this.byCol = new Map(); this.byGroup = new Map(); }
  _idx(path, add) { const s = path.split('/'); if (s.length % 2) return; const col = s.slice(0, -1).join('/'), name = s[s.length - 2];
    for (const [m, k] of [[this.byCol, col], [this.byGroup, name]]) { let set = m.get(k); if (!set) { set = new Set(); m.set(k, set); } add ? set.add(path) : set.delete(path); } }
  addRead(n) { this.reads += n; const c = als.getStore(); if (c) c.reads += n; }
  addWrite(n) { this.writes += n; const c = als.getStore(); if (c) c.writes += n; }
  put(path, d) { if (!this.docs.has(path)) this._idx(path, true); this.docs.set(path, d); }
  del(path) { if (this.docs.delete(path)) this._idx(path, false); }
  ref(path) { return new DocRef(this, path); }
}
class Snap { constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._d = data; } data() { return clone(this._d); } get(p) { return get(this._d, p); } }
class DocRef {
  constructor(store, path) { this.store = store; this.path = path; this.id = path.split('/').pop(); }
  get parent() { const p = this.path.split('/'); return new ColRef(this.store, p.slice(0, -1).join('/'), p.length > 2 ? new DocRef(this.store, p.slice(0, -2).join('/')) : null); }
  async get() { this.store.addRead(1); return new Snap(this, this.store.docs.get(this.path)); }
  _set(data, merge) { this.store.addWrite(1); const cur = this.store.docs.get(this.path); const next = merge && cur ? mergeInto(clone(cur), data) : mergeInto({}, data); this.store.put(this.path, next); }
  async set(d, o) { this._set(d, o && o.merge); }
  async create(d) { if (this.store.docs.has(this.path)) { const e = new Error('exists'); e.code = 6; throw e; } this._set(d, false); }
  async update(d) { if (!this.store.docs.has(this.path)) { const e = new Error('not found'); e.code = 5; throw e; } this.store.addWrite(1); const cur = clone(this.store.docs.get(this.path)); Object.entries(d).forEach(([k, v]) => setPath(cur, k, v)); this.store.put(this.path, cur); }
  async delete() { this.store.addWrite(1); this.store.del(this.path); }
  collection(n) { return new ColRef(this.store, `${this.path}/${n}`, this); }
}
class Query {
  constructor(store, match, filters = [], order = [], lim = null, sel = null, meta = {}) { this.store = store; this.match = match; this.filters = filters; this.order = order; this.lim = lim; this.sel = sel; this.meta = meta; }
  where(f, op, v) { return new Query(this.store, this.match, [...this.filters, [f, op, v]], this.order, this.lim, this.sel, this.meta); }
  orderBy(f, d = 'asc') { return new Query(this.store, this.match, this.filters, [...this.order, [f, d]], this.lim, this.sel, this.meta); }
  limit(n) { return new Query(this.store, this.match, this.filters, this.order, n, this.sel, this.meta); }
  select() { return this; }
  _run() {
    if (this.store.indexCheck && this.meta.id) { const m = require('./index-check').check({ group: !!this.meta.group, id: this.meta.id, filters: this.filters, order: this.order }); if (m) { const e = new Error('9 FAILED_PRECONDITION: The query requires an index. ' + m); e.code = 9; throw e; } }
    const src = this.meta.group ? this.store.byGroup.get(this.meta.id) : this.store.byCol.get(this.meta.colPath);
    let rows = src ? [...src].map(p => ({ p, d: this.store.docs.get(p) })) : [];
    for (const [f, op, v] of this.filters) rows = rows.filter(({ d }) => { const x = get(d, f);
      switch (op) { case '==': return v === null ? x === null : x === v; case '!=': return x !== undefined && x !== v; case 'in': return v.includes(x); case 'not-in': return !v.includes(x);
        case '>': return x !== undefined && x > v; case '>=': return x !== undefined && x >= v; case '<': return x !== undefined && x < v; case '<=': return x !== undefined && x <= v;
        case 'array-contains': return Array.isArray(x) && x.includes(v); case 'array-contains-any': return Array.isArray(x) && x.some(y => v.includes(y)); default: throw new Error('op ' + op); } });
    for (const [f, dir] of [...this.order].reverse()) rows.sort((a, b) => { const x = get(a.d, f), y = get(b.d, f); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
    if (this.lim != null) rows = rows.slice(0, this.lim); return rows;
  }
  async get() { const rows = this._run(); this.store.addRead(Math.max(1, rows.length)); const docs = rows.map(({ p, d }) => new Snap(new DocRef(this.store, p), d)); return { docs, empty: !docs.length, size: docs.length, forEach: f => docs.forEach(f) }; }
  count() { return { get: async () => ({ data: () => ({ count: this._run().length }) }) }; }
}
class ColRef extends Query {
  constructor(store, path, parent) { const depth = path.split('/').length; super(store, p => p.startsWith(path + '/') && p.split('/').length === depth + 1, [], [], null, null, { id: path.split('/').pop(), colPath: path }); this.path = path; this.parent = parent; this.id = path.split('/').pop(); }
  doc(id) { return new DocRef(this.store, `${this.path}/${id || 'auto' + Math.random().toString(36).slice(2, 10) + (this.store.n = (this.store.n || 0) + 1)}`); }
  async add(d) { const r = this.doc(); await r.set(d); return r; }
}
function makeDb(store) {
  const db = {
    store, doc: p => store.ref(p), collection: p => new ColRef(store, p, null),
    collectionGroup: name => new Query(store, p => { const s = p.split('/'); return s.length % 2 === 0 && s[s.length - 2] === name; }, [], [], null, null, { id: name, group: true }),
    getAll: async (...refs) => Promise.all(refs.map(r => r.get())),
    batch: () => { const ops = []; return { set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), delete: r => ops.push(() => r.delete()), commit: async () => { for (const f of ops) await f(); } }; },
    runTransaction: async fn => { const ops = []; const tx = { get: async x => (Array.isArray(x) ? Promise.all(x.map(r => r.get())) : x.get()), getAll: async (...r) => Promise.all(r.map(x => x.get())),
      set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), delete: r => ops.push(() => r.delete()), create: (r, d) => ops.push(() => r.create(d)) };
      const out = await fn(tx); for (const f of ops) await f(); return out; },
    recursiveDelete: async ref => { const pre = ref.path; [...store.docs.keys()].filter(p => p === pre || p.startsWith(pre + '/')).forEach(p => store.del(p)); },
  }; return db;
}
function install() {
  const store = new Store(), db = makeDb(store);
  const users = new Map(), tokens = []; let uidn = 0;
  const authApi = {
    createUser: async o => { const uid = 'uid' + (++uidn); users.set(uid, { uid, ...o, customClaims: {}, disabled: false }); return users.get(uid); },
    getUser: async uid => { const u = users.get(uid); if (!u) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; } return u; },
    getUserByEmail: async em => { const u = [...users.values()].find(x => x.email === em); if (!u) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; } return u; },
    setCustomUserClaims: async (uid, c) => { users.get(uid).customClaims = c; }, updateUser: async (uid, o) => Object.assign(users.get(uid), o), deleteUser: async uid => users.delete(uid),
    revokeRefreshTokens: async uid => { users.get(uid).revoked = (users.get(uid).revoked || 0) + 1; }, createCustomToken: async (uid, claims) => 'TOKEN:' + JSON.stringify({ uid, claims }),
  };
  const pushed = []; const messaging = () => ({ send: async m => pushed.push(m), sendEachForMulticast: async m => pushed.push(m), subscribeToTopic: async () => {}, unsubscribeFromTopic: async () => {} });
  const files = new Map(); const bucket = () => ({ file: p => ({ exists: async () => [files.has(p)], getMetadata: async () => [files.get(p) || {}], delete: async () => files.delete(p) }) });
  const adminMod = { apps: [1], initializeApp() {}, firestore: Object.assign(() => db, { FieldValue, Timestamp: {} }), auth: () => authApi, messaging, storage: () => ({ bucket }) };
  const Module = require('module'); const orig = Module._load;
  class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  Module._load = function (req, ...a) {
    if (req === 'firebase-admin') return adminMod;
    if (req === 'firebase-functions/v2/https') return { onCall: (o, h) => (h ? h : o), HttpsError };
    if (req === 'firebase-functions/v2/scheduler') return { onSchedule: (o, h) => h };
    return orig.call(this, req, ...a);
  };
  return { store, db, authApi, users, pushed, files, FieldValue };
}
module.exports = { install, als };
