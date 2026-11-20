'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), { URL } = require('url');
const be = require('./backend'); const { F, fns, tokens, mint, reqOf, db, authApi, users } = be;
const ROOT = path.resolve(__dirname, '../..'), PORT = Number(process.env.PORT || 8123);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const files = new Map(); const stats = { calls: 0, reads: 0, writes: 0, byFn: {} };
const readBody = req => new Promise(r => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => r(Buffer.concat(c))); });
const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
function runQuery(b) {
  let q = b.group ? db.collectionGroup(b.path) : db.collection(b.path);
  (b.filters || []).forEach(([f, op, v]) => { q = q.where(f, op, v); }); (b.order || []).forEach(([f, d]) => { q = q.orderBy(f, d); });
  return q;
}
async function fs_(url, body, res, token) {
  try {
    if (url === '/fs/query') { const q = runQuery(body); const rows = q._run(); let list = rows; if (body.after) { const i = list.findIndex(r => r.p === body.after); list = i >= 0 ? list.slice(i + 1) : list; } if (body.limit) list = list.slice(0, body.limit);
      return json(res, { docs: list.map(r => ({ path: r.p, data: r.d })) }); }
    if (url === '/fs/get') { const s = await db.doc(body.path).get(); return json(res, { data: s.exists ? s.data() : null }); }
    if (url === '/fs/set') { await db.doc(body.path).set(body.data, { merge: body.merge }); return json(res, {}); }
    if (url === '/fs/add') { const r = await db.collection(body.path).add(body.data); return json(res, { path: r.path }); }
    if (url === '/fs/update') { await db.doc(body.path).update(body.data); return json(res, {}); }
    if (url === '/fs/delete') { await db.doc(body.path).delete(); return json(res, {}); }
  } catch (e) { return json(res, { error: e.message }); }
  json(res, { error: 'unknown ' + url }, 404);
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  if (p.startsWith('/__fb/')) {
    const sub = p.slice(5), token = req.headers['x-token'] || '';
    if (sub === '/storage/put') { const buf = await readBody(req); const k = u.searchParams.get('path'); files.set(k, { buf, type: u.searchParams.get('type') }); F.files.set(k, { size: buf.length, contentType: u.searchParams.get('type') }); return json(res, {}); }
    if (sub === '/storage/get') { const f = files.get(u.searchParams.get('path')); if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.type || 'application/octet-stream' }); return res.end(f.buf); }
    if (sub === '/storage/del') { files.delete(u.searchParams.get('path')); F.files.delete(u.searchParams.get('path')); return json(res, {}); }
    if (sub === '/stats') return json(res, { reads: F.store.reads, writes: F.store.writes, ...stats });
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    if (sub === '/auth/signin') { const us = [...users.values()].find(x => x.email === body.email && x.password === body.password); if (!us || us.disabled) return json(res, { error: 'invalid' }); return json(res, { uid: us.uid, token: mint(us.uid) }); }
    if (sub === '/auth/custom') { try { const c = JSON.parse(body.token.slice(6)); return json(res, { uid: c.uid, token: mint(c.uid, c.claims) }); } catch { return json(res, { error: 'bad token' }); } }
    if (sub === '/auth/claims') { const t = tokens.get(token); return json(res, { claims: t ? t.claims : null }); }
    if (sub === '/call') {
      const h = fns[body.name]; if (typeof h !== 'function') return json(res, { error: { status: 'NOT_FOUND', message: 'No such function ' + body.name } }, 404);
      const t0 = process.hrtime.bigint(), r0 = F.store.reads, w0 = F.store.writes;
      try { const out = await h(reqOf(token, body.data)); stats.calls++; const s = stats.byFn[body.name] || (stats.byFn[body.name] = { n: 0, reads: 0, writes: 0, ms: 0 }); s.n++; s.reads += F.store.reads - r0; s.writes += F.store.writes - w0; s.ms += Number(process.hrtime.bigint() - t0) / 1e6; return json(res, { result: out }); }
      catch (e) { const status = ({ 'permission-denied': 'PERMISSION_DENIED', unauthenticated: 'UNAUTHENTICATED', 'invalid-argument': 'INVALID_ARGUMENT', 'failed-precondition': 'FAILED_PRECONDITION', 'not-found': 'NOT_FOUND', 'already-exists': 'ALREADY_EXISTS', 'resource-exhausted': 'RESOURCE_EXHAUSTED' })[e.code] || 'INTERNAL'; if (status === 'INTERNAL') console.error('FUNCTION ERROR', body.name, e.stack); return json(res, { error: { status, message: e.message } }, status === 'UNAUTHENTICATED' ? 401 : 400); }
    }
    if (sub === '/run') { await fns[body.name](); return json(res, { ok: true }); }
    if (sub.startsWith('/fs/')) return fs_(sub, body, res, token);
    return json(res, { error: 'unknown' }, 404);
  }
  if (p === '/__shim/core.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' }); return res.end(fs.readFileSync(path.join(__dirname, 'shim-core.js'))); }
  if (p.endsWith('/')) p += 'index.html'; const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(fp));
}).listen(PORT, async () => { try { await be.seed(); console.log('READY', JSON.stringify({ ids: be.SEED.ids, quiz: be.SEED.quiz, exam: be.SEED.exam, students: be.SEED.students.map(s => s.login_id) })); } catch (e) { console.error('SEED FAILED', e.stack); process.exit(1); } });
