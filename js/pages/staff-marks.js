import { mountShell } from '../shared/shell.js';
import { attendanceEnabled } from '../core/flags.js';
const ATT = await attendanceEnabled();
import { rows as qrows, col, query, where, orderBy, limit, one } from '../core/db.js';
import { pageStudents } from '../data/people.js';
import { fn } from '../shared/api.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { formModal } from '../shared/forms.js';
import { readSheet } from '../shared/sheet.js';
import { $, $$, esc, toast, empty, skeleton, modal, fmtIST } from '../shared/ui.js';
const role = document.documentElement.dataset.role, isAdmin = role === 'admin';
const mode = document.documentElement.dataset.mode || 'marks';   // 'exams' = Examinations page, 'marks' = Marks entry page
const PAGE = mode === 'exams' ? 'examinations.html' : 'marks.html';
const { me, content } = await mountShell({ role, active: PAGE, title: mode === 'exams' ? 'Examinations' : 'Marks' });
const P = new URLSearchParams(location.search), classNo = P.get('class'), examId = P.get('exam');
const sess = (await qrows(query(col('academic_sessions'), where('is_current', '==', true))))[0]?.id;
const num = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

if (!classNo) { content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(await myClasses(me), c => `?class=${c.class_no}`)}</section>`; }
else if (!examId) {
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="${PAGE}">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))} · Exams</h3></div>${mode === 'exams' ? '<button class="btn y" id="new"><i class="fa-solid fa-plus"></i>Create exam</button>' : ''}</div><div id="list">${skeleton(3)}</div></section>`;
  const subs = await qrows(query(col('subjects'), where('class_no', '==', Number(classNo)), orderBy('name')));
  async function load() {
    const data = (await qrows(query(col('exams'), where('class_no', '==', Number(classNo)), where('session_id', '==', sess)))).filter(e => !e.archived_at).sort((a, b) => (a.exam_order ?? 1e9) - (b.exam_order ?? 1e9));
    $('#list').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Exam</th><th>Date</th><th>Final exam</th><th>Result</th><th></th></tr></thead><tbody>${data.map(e => `<tr><td>${e.exam_order}</td><td>${esc(e.exam_name)}</td><td>${esc(e.exam_date || '—')}</td><td>${e.is_final ? '<span class="tag y">Final</span>' : ''}</td><td><span class="tag ${e.result_declared ? 'g' : 'o'}">${e.result_declared ? 'Declared' : 'Not declared'}</span></td><td><a class="btn ${mode === 'marks' ? 'y' : 'ghost'} sm" href="?class=${classNo}&exam=${e.id}">${mode === 'marks' ? 'Enter marks' : 'Open'}</a></td></tr>`).join('')}</tbody></table></div>` : empty('fa-file-pen', mode === 'exams' ? 'No exams yet. Create the first exam of this session.' : 'No exams yet. Create one under Examinations first.');
  }
  if (mode === 'exams') $('#new').onclick = () => { if (!subs?.length) return toast('Add subjects to this class first (Classes & Features).', 'err');
    formModal({ title: 'Create exam', fields: [
      { id: 'name', label: 'Exam name', placeholder: 'First Term', required: true }, { id: 'date', label: 'Exam date', type: 'date', half: true }, ...(ATT ? [{ id: 'upto', label: 'Count attendance up to', type: 'date', half: true }] : []),
      { id: 'final', label: 'This is the final exam of the session (shows the yearly result)', type: 'checkbox' },
      ...subs.map(s => ({ id: 's_' + s.id, label: `${s.name}: full marks`, type: 'number', min: 1, half: true, value: 100 }))],
      onSubmit: async (v, mm) => { await fn('createExam', { class_no: Number(classNo), name: v.name, date: v.date || null, upto: v.upto || null, final: !!v.final, subjects: subs.filter(s => v['s_' + s.id]).map(s => ({ subject_id: s.id, full_marks: Number(v['s_' + s.id]) })) }); mm.remove(); toast('Exam created.', 'ok'); load(); } }); };
  load();
} else {
  const [ex, st, mk] = await Promise.all([one('exams', examId), pageStudents({ classNo, status: 'active', size: 400 }).then(r => r.rows), qrows(col('exams', examId, 'marks'))]);
  const es = [...(ex.subjects || [])].sort((a, b) => String(a.subject_name).localeCompare(b.subject_name));
  const students = (st || []).sort((a, b) => num(a.roll_number, b.roll_number)), key = s => String(s.subject_id || s.id), byStu = Object.fromEntries((mk || []).map(m => [m.student_id, m]));
  const fullOf = inc => es.filter(x => !inc || inc.has(key(x))).reduce((t, x) => t + Number(x.full_marks), 0);
  const stat = (i, k, v, l) => `<div class="card stat" style="box-shadow:none;background:var(--yellow-wash)"><div class="ico ${k}"><i class="fa-solid ${i}"></i></div><div><b>${v}</b><span>${l}</span></div></div>`;
  const declare = async () => { if (!confirm(ex.result_declared ? 'Withdraw this result? Students will stop seeing it.' : 'Declare this result? Students will be notified.')) return;
    try { await fn('declareResult', { exam_id: examId, declared: !ex.result_declared }); toast('Done.', 'ok'); setTimeout(() => location.reload(), 600); } catch (error) { toast(error.message, 'err'); } };
  if (mode === 'exams') {
    const done = (mk || []).filter(m => m.status === 'completed').length, draft = (mk || []).filter(m => m.status === 'draft').length;
    content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="?class=${classNo}">← Exams</a> <h3 style="display:inline;margin-left:8px">${esc(ex.exam_name)}</h3> <span class="tag ${ex.result_declared ? 'g' : 'o'}">${ex.result_declared ? 'Declared' : 'Not declared'}</span> ${ex.is_final ? '<span class="tag y">Final exam</span>' : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn y" href="marks.html?class=${classNo}&exam=${examId}">Enter marks</a><button class="btn ${ex.result_declared ? 'red' : 'green'}" id="decl">${ex.result_declared ? 'Withdraw result' : 'Declare result'}</button><a class="btn ghost" href="../print/gradesheet.html?class=${classNo}" target="_blank"><i class="fa-solid fa-print"></i>Report cards</a>${isAdmin ? '<button class="btn ghost" id="arch"><i class="fa-solid fa-box-archive"></i>Archive exam</button>' : ''}</div></div>
      <section class="grid g4" style="margin-bottom:14px">${stat('fa-users', '', students.length, 'Students')}${stat('fa-check', 'g', done, 'Marks complete')}${stat('fa-pen', 'y', draft, 'Draft')}${stat('fa-hourglass-half', 'r', students.length - done - draft, 'Not entered')}</section>
      <h4 style="margin-bottom:8px">Subjects and full marks (total ${fullOf(null)})</h4><div class="table-wrap"><table class="t"><thead><tr><th>Subject</th><th>Full marks</th></tr></thead><tbody>${es.map(x => `<tr><td>${esc(x.subject_name)}</td><td>${x.full_marks}</td></tr>`).join('')}</tbody></table></div></section>`;
    $('#decl').onclick = declare;
    $('#arch')?.addEventListener('click', () => formModal({ title: 'Archive exam', submitLabel: 'Archive', intro: `Archiving hides <b>${esc(ex.exam_name)}</b> from students and report cards. Marks are kept and nothing is lost. Type the exam name to confirm.`, fields: [{ id: 'n', label: 'Exam name', required: true }],
      onSubmit: async (v, mm) => { if (v.n.trim().toLowerCase() !== ex.exam_name.trim().toLowerCase()) throw new Error('The name does not match.'); await fn('archiveExam', { exam_id: examId }); mm.remove(); location.href = `?class=${classNo}`; } }));
  } else {
    const locked = !!ex.result_declared, inc = {};                       // inc[student] = Set of subject keys the student takes (null = all)
    students.forEach(s => { const ids = byStu[s.user_id]?.included_subject_ids; inc[s.user_id] = ids ? new Set(ids.map(String)) : null; });
    content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="?class=${classNo}">← Exams</a> <h3 style="display:inline;margin-left:8px">${esc(ex.exam_name)}</h3> <span class="tag ${locked ? 'g' : 'o'}">${locked ? 'Declared (locked)' : 'Not declared'}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${locked ? '' : '<button class="btn y" id="save">Save marks</button><button class="btn ghost" id="imp"><i class="fa-solid fa-file-excel"></i>Import spreadsheet</button>'}<button class="btn ghost" id="hist"><i class="fa-solid fa-clock-rotate-left"></i>Correction history</button></div></div>
      <input class="input" id="q" placeholder="Search by roll number or name…" style="max-width:340px;margin-bottom:10px">
      <p style="color:var(--muted);font-size:13px;margin-bottom:10px">${locked ? 'Result declared. Use “Correct” to change a mark.' : ''}</p>
      <div class="table-wrap"><table class="t" id="tb"><thead><tr><th>Roll</th><th>Student</th>${es.map(s => `<th>${esc(s.subject_name)}<br><small>/ ${s.full_marks}</small></th>`).join('')}<th>Total</th><th>%</th><th>Status</th><th></th></tr></thead><tbody>${students.map(s => { const m = byStu[s.user_id]?.marks || {};
        return `<tr data-s="${s.user_id}" data-name="${esc((s.roll_number || '') + ' ' + s.profiles.full_name).toLowerCase()}"><td>${esc(s.roll_number || '–')}</td><td>${esc(s.profiles.full_name)}</td>${es.map(x => `<td><input class="input" style="min-width:70px;min-height:38px" type="number" min="0" max="${x.full_marks}" step="0.5" data-k="${key(x)}" data-max="${x.full_marks}" value="${m[key(x)] ?? ''}" ${locked ? 'disabled' : ''}></td>`).join('')}<td data-t></td><td data-p></td><td data-st></td><td style="white-space:nowrap">${locked ? '<button class="btn ghost sm" data-c>Correct</button>' : '<button class="btn ghost sm" data-sub>Subjects</button>'}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    const calc = tr => { const set = inc[tr.dataset.s], ins = [...tr.querySelectorAll('input')]; ins.forEach(i => { const off = set && !set.has(i.dataset.k); i.disabled = locked || off; if (off) i.value = ''; i.style.opacity = off ? .35 : 1; });
      const act = ins.filter(i => !i.disabled || (locked && !(set && !set.has(i.dataset.k)))); const filled = act.filter(i => i.value !== ''), tot = filled.reduce((t, i) => t + Number(i.value), 0), full = fullOf(set);
      tr.querySelector('[data-t]').textContent = filled.length ? tot : ''; tr.querySelector('[data-p]').textContent = filled.length && full ? (tot * 100 / full).toFixed(1) + '%' : '';
      const bad = act.some(i => i.value !== '' && (Number(i.value) < 0 || Number(i.value) > Number(i.dataset.max)));
      tr.querySelector('[data-st]').innerHTML = bad ? '<span class="tag r">Invalid</span>' : act.length && filled.length === act.length ? '<span class="tag g">Complete</span>' : filled.length ? '<span class="tag o">Draft</span>' : '<span class="tag">Empty</span>'; return bad; };
    $$('#tb tbody tr').forEach(tr => { calc(tr); tr.oninput = () => calc(tr); });
    $('#q').oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('#tb tbody tr').forEach(tr => tr.style.display = !q || tr.dataset.name.includes(q) ? '' : 'none'); };
    $$('[data-sub]').forEach(b => b.onclick = () => { const tr = b.closest('tr'), id = tr.dataset.s, cur = inc[id]; const md = modal(`<h3>Subjects this student takes</h3><div style="display:grid;gap:8px;margin:12px 0">${es.map(x => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-k="${key(x)}" ${!cur || cur.has(key(x)) ? 'checked' : ''}> ${esc(x.subject_name)} <small style="color:var(--muted)">/ ${x.full_marks}</small></label>`).join('')}</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" data-x>Cancel</button><button class="btn y" data-ok>Apply</button></div>`);
      md.querySelector('[data-x]').onclick = () => md.remove(); md.querySelector('[data-ok]').onclick = () => { const s = new Set([...md.querySelectorAll('[data-k]:checked')].map(i => i.dataset.k)); if (!s.size) return toast('Select at least one subject.', 'err'); inc[id] = s.size === es.length ? null : s; md.remove(); calc(tr); }; });
    if (!locked) {
      $('#save').onclick = async () => { let bad = false; const rows = $$('#tb tbody tr').map(tr => { bad = calc(tr) || bad; const set = inc[tr.dataset.s], marks = {}; tr.querySelectorAll('input').forEach(i => { if (!i.disabled && i.value !== '') marks[i.dataset.k] = Number(i.value); });
          const need = es.filter(x => !set || set.has(key(x))).length; return { exam_id: examId, student_id: tr.dataset.s, marks, included_subject_ids: set ? [...set] : null, status: Object.keys(marks).length === need ? 'completed' : 'draft', updated_at: new Date().toISOString() }; });
        if (bad) return toast('Some marks are above the full marks or negative.', 'err');
        try { await fn('saveExamMarks', { exam_id: examId, rows: rows.filter(r => Object.keys(r.marks).length || byStu[r.student_id] || r.included_subject_ids).map(r => ({ student_id: r.student_id, marks: r.marks, included_subject_ids: r.included_subject_ids })) }); toast('Marks saved.', 'ok'); } catch (error) { toast(error.message, 'err'); } };
      $('#imp').onclick = () => formModal({ title: 'Import marks from a spreadsheet', fields: [{ id: 'f', label: 'File (.csv, .xlsx)', type: 'file', accept: '.csv,.xlsx,.xls', required: true }],
        onSubmit: async (v, mm) => { const rows = await readSheet(v.f); const head = rows.shift().map(h => h.toLowerCase()); const rc = head.findIndex(h => /^(roll|roll no|roll number|roll_number)$/.test(h)), nc = head.findIndex(h => h === 'name' || h === 'student name' || h === 'student');
          if (rc < 0 && nc < 0) throw new Error('The first row needs a Roll or Name column.'); const cols = es.map(x => ({ k: key(x), c: head.indexOf(x.subject_name.toLowerCase()) })).filter(x => x.c >= 0); if (!cols.length) throw new Error('No subject column matches this exam’s subjects.');
          let hit = 0; rows.forEach(r => { const tr = $$('#tb tbody tr').find(t => { const s = students.find(x => x.user_id === t.dataset.s); return (rc >= 0 && String(s.roll_number).replace(/^0+/, '') === String(r[rc]).replace(/^0+/, '') && r[rc] !== '') || (rc < 0 && s.profiles.full_name.toLowerCase() === String(r[nc]).toLowerCase()); }); if (!tr) return; hit++;
            cols.forEach(({ k, c }) => { const i = tr.querySelector(`input[data-k="${k}"]`); if (i && !i.disabled && r[c] !== '' && !isNaN(Number(r[c]))) i.value = r[c]; }); calc(tr); });
          mm.remove(); toast(`${hit} student row(s) filled. Check them, then press Save marks.`, hit ? 'ok' : 'err'); } });
    } else {
      $$('[data-c]').forEach(b => b.onclick = () => { const tr = b.closest('tr'), id = tr.dataset.s, s = students.find(x => x.user_id === id), set = inc[id], m = byStu[id]?.marks || {};
        formModal({ title: `Correct marks: ${s.profiles.full_name}`, submitLabel: 'Save correction', fields: [...es.map(x => ({ id: 'm_' + key(x), label: `${x.subject_name} (/ ${x.full_marks})`, type: 'number', min: 0, max: x.full_marks, half: true, value: m[key(x)] ?? '' })), { id: 'why', label: 'Reason for correction', required: true, hint: 'For example: wrong total on the answer sheet' }],
          onSubmit: async (v, mm) => { const marks = {}; es.forEach(x => { if (v['m_' + key(x)] !== '' && (!set || set.has(key(x)))) marks[key(x)] = Number(v['m_' + key(x)]); });
            await fn('correctMarks', { exam_id: examId, student_id: id, marks, included_subject_ids: set ? [...set] : null, reason: v.why }); mm.remove(); toast('Correction saved.', 'ok'); setTimeout(() => location.reload(), 700); } }); });
    }
    $('#hist').onclick = async () => { const data = await qrows(query(col('exams', examId, 'marks_audit'), orderBy('created_at', 'desc'), limit(100))); const name = id => students.find(s => s.user_id === id)?.profiles.full_name || 'Student';
      const md = modal(`<h3>Correction history</h3><div style="max-height:60vh;overflow:auto;margin:10px 0">${(data || []).length ? data.map(a => `<div style="padding:10px 0;border-bottom:1px solid var(--line);font-size:13.5px"><b>${esc(name(a.student_id))}</b> <small style="color:var(--muted)">${fmtIST(a.created_at)}</small><div>Reason: ${esc(a.reason)}</div><div style="color:var(--muted)">Before: ${esc(JSON.stringify(a.old_marks))}<br>After: ${esc(JSON.stringify(a.new_marks))}</div></div>`).join('') : empty('fa-clock-rotate-left', 'No corrections have been made.')}</div><button class="btn ghost" data-x>Close</button>`); md.querySelector('[data-x]').onclick = () => md.remove(); };
  }
}
