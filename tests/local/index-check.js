'use strict';
// Checks a Firestore query against firestore.indexes.json the way Firestore does (approximation of the documented rules):
//  - equality filters only, no ordering: served by merging single-field indexes (no composite index needed);
//  - one field only (a single range or a single ordering): single-field index (automatic; collection-group scope needs a fieldOverride);
//  - anything else: a composite index with the equality fields first (any order), then the range/ordering fields in query order (same directions, or all reversed).
// Returns null when the query is fine, otherwise a message naming the missing index.
const fs = require('fs'), path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../firestore.indexes.json'), 'utf8'));
const EQ = new Set(['==', 'in', 'array-contains', 'array-contains-any']), RANGE = new Set(['>', '>=', '<', '<=', '!=', 'not-in']);
function check({ group, id, filters, order }) {
  const eq = [...new Set(filters.filter(f => EQ.has(f[1])).map(f => f[0]))], rg = [...new Set(filters.filter(f => RANGE.has(f[1])).map(f => f[0]))];
  const tail = []; rg.forEach(f => tail.push([f, 'asc'])); order.forEach(([f, d]) => { if (!tail.some(t => t[0] === f)) tail.push([f, d]); else { const t = tail.find(x => x[0] === f); if (t && order.length === 1) t[1] = d; } });
  const fields = new Set([...eq, ...tail.map(t => t[0])]);
  const need = `${id} (${group ? 'collection group' : 'collection'}): eq[${eq.join(', ')}] then [${tail.map(t => t[0] + ' ' + t[1]).join(', ')}]`;
  if (!tail.length && !group) return null;                       // equality filters only: merged single-field indexes
  if (!tail.length && eq.length === 0) return null;
  if (fields.size === 1) return group && !hasOverride(id, [...fields][0]) ? 'MISSING collection-group field override: ' + need : null;
  const ok = cfg.indexes.some(ix => {
    if (ix.collectionGroup !== id) return false; if (group && ix.queryScope !== 'COLLECTION_GROUP') return false;
    const f = ix.fields; if (f.length !== fields.size) return false;
    const head = f.slice(0, eq.length), rest = f.slice(eq.length);
    if (!eq.every(e => head.some(h => h.fieldPath === e))) return false;
    if (rest.length !== tail.length) return false;
    const dir = x => (x.order || 'ASCENDING') === 'ASCENDING' ? 'asc' : 'desc', flip = d => (d === 'asc' ? 'desc' : 'asc');
    const same = rest.every((x, i) => x.fieldPath === tail[i][0] && dir(x) === tail[i][1]), rev = rest.every((x, i) => x.fieldPath === tail[i][0] && dir(x) === flip(tail[i][1]));
    return same || rev;
  });
  return ok ? null : 'MISSING composite index: ' + need;
}
function hasOverride(id, field) { return (cfg.fieldOverrides || []).some(o => o.collectionGroup === id && o.fieldPath === field && o.indexes.some(i => i.queryScope === 'COLLECTION_GROUP')); }
module.exports = { check };
