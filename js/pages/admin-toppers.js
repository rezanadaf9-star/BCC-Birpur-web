import { mountShell } from '../shared/shell.js';
import { db, doc, addDoc, setDoc, deleteDoc, rows as qrows, col, query, orderBy } from '../core/db.js';
import { compressImage, upload, removeFile } from '../core/storage.js';
import { CONFIG } from '../config.js';
import { $, esc, modal, toast, empty, skeleton } from '../shared/ui.js';
const { content } = await mountShell({ role: 'admin', active: 'toppers.html', title: 'Board Results', subtitle: 'Toppers shown on the public website, ranked automatically by marks' });
const LEVELS = { matric: 'Matric (Class 10)', intermediate: 'Intermediate (Class 12)' };
const photoUrl = p => !p ? '' : /^(https?:|assets\/)/.test(p) ? '../' + p.replace(/^\.\.\//, '') : `https://firebasestorage.googleapis.com/v0/b/${CONFIG.FIREBASE.storageBucket}/o/${encodeURIComponent('site-public/' + p)}?alt=media`;
content.innerHTML = `<section class="card"><div class="card-head"><h3>Toppers</h3><button class="btn y" id="add"><i class="fa-solid fa-plus"></i>Add topper</button></div><div id="list">${skeleton(4)}</div></section>`;
async function load() {
  let data; try { data = await qrows(query(col('site_toppers'), orderBy('level'), orderBy('marks', 'desc'), orderBy('batch_year', 'desc'))); } catch (error) { $('#list').innerHTML = empty('fa-triangle-exclamation', error.message); return; }
  $('#list').innerHTML = Object.entries(LEVELS).map(([lv, name]) => { const rows = data.filter(t => t.level === lv);
    return `<h4 style="margin:12px 0 8px">${name}</h4>` + (rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Rank</th><th>Name</th><th>Marks</th><th>Roll</th><th>Batch</th><th>Shown</th><th></th></tr></thead><tbody>${rows.map((t, i) => `<tr>
      <td>${i + 1}${i < 10 ? '' : ' <span class="tag">not shown</span>'}</td><td><div style="display:flex;gap:10px;align-items:center">${t.photo_path ? `<img class="avatar" src="${esc(photoUrl(t.photo_path))}" alt="">` : '<span class="avatar">' + esc(t.name[0]) + '</span>'}${esc(t.name)}</div></td>
      <td>${t.marks} / ${t.full_marks}</td><td>${esc(t.bseb_roll || '')}</td><td>${esc(t.batch_year || '')}</td><td><span class="tag ${t.is_published ? 'g' : 'o'}">${t.is_published ? 'Yes' : 'Hidden'}</span></td>
      <td style="white-space:nowrap"><button class="btn ghost sm" data-e="${t.id}">Edit</button> <button class="btn red sm" data-d="${t.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : empty('fa-trophy', 'No toppers yet.')); }).join('');
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(data.find(t => t.id === b.dataset.e)));
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Delete this topper from the website?')) return; try { const t = data.find(x => x.id === b.dataset.d); await deleteDoc(doc(db, 'site_toppers', b.dataset.d)); if (t?.photo_path && /^toppers\//.test(t.photo_path)) removeFile('site-public', t.photo_path); toast('Deleted.', 'ok'); load(); } catch (error) { toast(error.message, 'err'); } });
}
function form(t = {}) {
  const m = modal(`<h3 style="margin-bottom:14px">${t.id ? 'Edit' : 'Add'} topper</h3><div style="display:grid;gap:12px">
    <div><label class="f">Name</label><input class="input" id="n" value="${esc(t.name || '')}"></div>
    <div class="grid g2"><div><label class="f">Board</label><select class="input" id="lv">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${t.level === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="f">Marks</label><input class="input" id="mk" type="number" min="0" value="${t.marks ?? ''}"></div></div>
    <div class="grid g2"><div><label class="f">Board roll no.</label><input class="input" id="rl" value="${esc(t.bseb_roll || '')}"></div><div><label class="f">Batch year</label><input class="input" id="by" value="${esc(t.batch_year || '')}" placeholder="2026"></div></div>
    <div><label class="f">School note (optional)</label><input class="input" id="sn" value="${esc(t.school_note || '')}"></div>
    <div><label class="f">Photo</label><input class="input" id="ph" type="file" accept="image/*" style="padding-top:10px"></div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pub" ${t.is_published === false ? '' : 'checked'}> Show on website</label>
    <p id="err" style="color:var(--red);font-size:13px"></p><button class="btn y" id="ok">Save</button></div>`);
  $('#ok', m).onclick = async () => {
    const v = id => $('#' + id, m).value.trim(), err = x => $('#err', m).textContent = x;
    if (!v('n') || v('mk') === '') return err('Name and marks are required.');
    const btn = $('#ok', m); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      let path = t.photo_path || null; const f = $('#ph', m).files[0];
      if (f) { const blob = await compressImage(f, 600); const old = path; path = (await upload('site-public', new File([blob], 'p.jpg', { type: 'image/jpeg' }), 'toppers')).path; if (old && /^toppers\//.test(old)) removeFile('site-public', old); }
      const row = { name: v('n'), level: v('lv'), marks: Number(v('mk')), bseb_roll: v('rl') || null, batch_year: v('by') || null, school_note: v('sn') || null, photo_path: path, is_published: $('#pub', m).checked, full_marks: t.full_marks || 500 };
      if (t.id) await setDoc(doc(db, 'site_toppers', t.id), row, { merge: true }); else await addDoc(col('site_toppers'), { ...row, created_at: new Date().toISOString() }); m.remove(); toast('Saved. The website updates automatically.', 'ok'); load();
    } catch (e) { err(e.message); btn.disabled = false; btn.textContent = 'Save'; }
  };
}
$('#add').onclick = () => form(); load();
