import { mountShell } from '../shared/shell.js';
import { db, doc, deleteDoc, setDoc, writeBatch, rows, col, query, orderBy } from '../core/db.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, toast, empty, skeleton } from '../shared/ui.js';
const { content } = await mountShell({ role: 'admin', active: 'holidays.html', title: 'Holidays', subtitle: 'Days the centre is closed. They show as H on attendance notices.' });
content.innerHTML = `<section class="card"><div class="card-head"><h3>Holidays</h3><button class="btn y" id="add"><i class="fa-solid fa-plus"></i>Add holiday</button></div><div id="v">${skeleton(3)}</div></section>`;
async function load() { const data = await rows(query(col('centre_holidays'), orderBy('hday', 'desc')));
  $('#v').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Occasion</th><th></th></tr></thead><tbody>${data.map(h => `<tr><td>${new Date(h.hday + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td><td>${esc(h.title)}</td><td><button class="btn red sm" data-d="${h.hday}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : empty('fa-umbrella-beach', 'No holidays added. Sundays are shown as “—” automatically.');
  $$('[data-d]').forEach(b => b.onclick = async () => { await deleteDoc(doc(db, 'centre_holidays', b.dataset.d)); load(); }); }
$('#add').onclick = () => formModal({ title: 'Add holiday', fields: [{ id: 'd', label: 'Date', type: 'date', required: true, half: true }, { id: 'e', label: 'Last date (optional, for several days)', type: 'date', half: true }, { id: 't', label: 'Occasion', value: 'Holiday', required: true }],
  onSubmit: async (v, mm) => { const out = []; const end = new Date((v.e || v.d) + 'T00:00:00'); for (let d = new Date(v.d + 'T00:00:00'); d <= end && out.length < 60; d.setDate(d.getDate() + 1)) out.push({ hday: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, title: v.t }); const wb = writeBatch(db); out.forEach(h => wb.set(doc(db, 'centre_holidays', h.hday), h)); await wb.commit(); mm.remove(); load(); } });
load();
