import { requireRole, ROOT } from '../core/auth.js';
import { fn } from '../shared/api.js';
import { rows, col, one, query, where, orderBy } from '../core/db.js';
import { roman, label } from '../core/classes.js';
export { roman, label, ROOT, fn, rows, col, one, query, where, orderBy };
/** Report-card data (staff: live for the class; student/parent: their own stored card). */
export const getSheets = async (classNo, session, student) => (await fn('getGradesheets', { class_no: classNo, session_id: session || undefined, student_id: student || undefined })).sheets;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const P = new URLSearchParams(location.search);
export const ddmmyyyy = d => { const x = new Date(d); return `${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`; };
export const monthName = ym => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
/** Shell for every print page: toolbar + pages. Any signed-in role may open it; the database decides what each role can load. */
export async function start(titleText, build) {
  document.title = titleText + ' · BCC';
  document.body.innerHTML = `<div class="toolbar"><span>${esc(titleText)}</span><button onclick="print()">Print</button></div><div id="out"><p class="msg">Preparing…</p></div>`;
  try {
    const me = await requireRole(['student', 'teacher', 'admin']);
    const html = await build(me);
    document.getElementById('out').innerHTML = html || '<p class="msg">Nothing to print for this selection.</p>';
  } catch (e) { if (!/no session|wrong role|session replaced/.test(e.message)) document.getElementById('out').innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
/** Resolve which class + student(s) the print request is for, respecting the signed-in role. */
export function scope(me) {
  if (me.role === 'student') return { classNo: me.student.class_no, student: me.id };
  return { classNo: Number(P.get('class')), student: P.get('student') || null };
}
