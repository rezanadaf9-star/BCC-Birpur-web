/** Read a CSV / Excel (.xlsx, .xls) file into rows of cells. Empty rows are ignored. */
export function parseCSV(t) { const rows = []; let r = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i];
  if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); f = ''; if (r.some(x => x.trim())) rows.push(r); r = []; } else f += c; }
  r.push(f); if (r.some(x => x.trim())) rows.push(r); return rows; }
let xl; const loadXlsx = () => xl ||= new Promise((res, rej) => { if (window.XLSX) return res(window.XLSX); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('The Excel reader could not be loaded. Save the file as CSV and try again.')); document.head.append(s); });
export async function readSheet(file) {
  if (/\.csv$/i.test(file.name)) return parseCSV(await file.text()).map(r => r.map(c => String(c).trim()));
  const X = await loadXlsx(), wb = X.read(await file.arrayBuffer(), { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }).map(r => r.map(c => String(c).trim())).filter(r => r.some(Boolean));
}
