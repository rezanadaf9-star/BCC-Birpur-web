import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { fn } from '../shared/api.js';
import { uploadWithProgress, removeFile } from '../core/storage.js';
import { openViewer, sourceLabel } from '../shared/viewer.js';
import { myClasses, classCards, label } from '../shared/classes-ui.js';
import { formModal } from '../shared/forms.js';
import { $, $$, esc, toast, empty, skeleton, fmtDate, fmtIST, istInputToIso, isoToIstInput } from '../shared/ui.js';
const role = document.documentElement.dataset.role, type = document.documentElement.dataset.type;   // lectures | notes | homework
const T = { lectures: ['Lectures', 'lectures.html'], notes: ['Notes', 'notes.html'], homework: ['Homework', 'homework.html'] }[type];
const LINK_OK = { gdrive: /(drive|docs)\.google\.com/i, onedrive: /(onedrive\.live\.com|1drv\.ms|sharepoint\.com|onedrive\.com)/i };
const { me, content } = await mountShell({ role, active: T[1], title: T[0] });
const P = new URLSearchParams(location.search), classNo = P.get('class'), subjectId = P.get('subject'), isAdmin = role === 'admin';
if (!classNo) content.innerHTML = `<section class="card"><div class="card-head"><h3>Select a class</h3></div>${classCards(await myClasses(me), c => `?class=${c.class_no}`)}</section>`;
else {
  const subs = await qrows(query(col('subjects'), where('class_no', '==', Number(classNo)), orderBy('name')));
  const cur = subs?.find(s => s.id === subjectId);
  content.innerHTML = `<section class="card"><div class="card-head"><div><a class="tag" href="${T[1]}">← Classes</a> <h3 style="display:inline;margin-left:8px">${esc(label(classNo))} · ${T[0]}</h3></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${(subs || []).map(s => `<a class="btn sm ${s.id === subjectId ? '' : 'ghost'}" href="?class=${classNo}&subject=${s.id}">${esc(s.name)}</a>`).join('') || '<span style="color:var(--muted)">No subjects. Ask the admin to add subjects to this class.</span>'}</div>
    <div id="body">${cur ? skeleton(3) : empty('fa-hand-pointer', 'Choose a subject above.')}</div></section>`;
  if (cur) {
    const statusTag = r => r.live_status === 'live' ? '<span class="tag r">LIVE NOW</span>' : r.live_status === 'scheduled' ? `<span class="tag y">Scheduled</span><div style="font-size:12px;color:var(--muted)">${fmtIST(r.scheduled_at)}</div>` : r.live_status === 'cancelled' ? '<span class="tag">Cancelled</span>' : r.live_status === 'ended' ? '<span class="tag">Live ended</span>' : '<span class="tag g">Recorded</span>';
    const load = async () => { let data, error; try { data = await qrows(query(col(type), where('class_no', '==', Number(classNo)), where('subject_id', '==', subjectId), orderBy('created_at', 'desc'))); } catch (e) { error = e; }
      $('#body').innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>${esc(cur.name)}</b><button class="btn y sm" id="add"><i class="fa-solid fa-plus"></i>Add</button></div>` + (error ? empty('fa-triangle-exclamation', error.message) : (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Title</th><th>${type === 'lectures' ? 'Status' : type === 'homework' ? 'Due' : 'Added'}</th><th>Source</th><th></th></tr></thead><tbody>${data.map(r => `<tr><td>${esc(r.title)}<div style="font-size:12px;color:var(--muted)">${fmtDate(r.created_at)}</div></td>
        <td>${type === 'lectures' ? statusTag(r) : type === 'homework' ? esc(r.due_date || '—') : fmtDate(r.created_at)}</td><td>${esc(sourceLabel[r.source_type] || '')}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-o="${r.id}">Open</button>${type === 'lectures' && r.live_status !== 'live' && r.live_status !== 'cancelled' && r.live_status !== 'recorded' ? ` <button class="btn red sm" data-live="${r.id}">Go live</button>` : ''}${type === 'lectures' && r.live_status === 'live' ? ` <button class="btn sm" data-end="${r.id}">End live</button>` : ''}
        ${isAdmin && type === 'lectures' && ['scheduled', 'cancelled'].includes(r.live_status) ? ` <button class="btn ghost sm" data-rs="${r.id}">Reschedule</button>` : ''}${isAdmin && type === 'lectures' && r.live_status === 'scheduled' ? ` <button class="btn ghost sm" data-cx="${r.id}">Cancel class</button>` : ''}${isAdmin ? ` <button class="btn ghost sm" data-e="${r.id}">Edit</button> <button class="btn red sm" data-d="${r.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('fa-folder-open', 'Nothing here yet.'));
      $('#add').onclick = () => form();
      $$('[data-o]').forEach(b => b.onclick = () => { const r = data.find(x => x.id === b.dataset.o); openViewer(r); });
      $$('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Delete this permanently?')) return; try { await fn('deleteContent', { type, id: b.dataset.d }); load(); } catch (error) { toast(error.message, 'err'); } });
      const rpcStatus = (id, st) => fn('lectureSetStatus', { id, status: st }).then(() => { toast(st === 'live' ? 'Live. Students were notified.' : st === 'cancelled' ? 'Class cancelled. Students were notified.' : 'Done.', 'ok'); load(); }).catch(error => toast(error.message, 'err'));
      $$('[data-live]').forEach(b => b.onclick = () => rpcStatus(b.dataset.live, 'live')); $$('[data-end]').forEach(b => b.onclick = () => rpcStatus(b.dataset.end, 'ended'));
      $$('[data-cx]').forEach(b => b.onclick = () => { if (confirm('Cancel this live class? Students will be told and reminders will stop.')) rpcStatus(b.dataset.cx, 'cancelled'); });
      $$('[data-rs]').forEach(b => b.onclick = () => { const r = data.find(x => x.id === b.dataset.rs); formModal({ title: 'Change class time', fields: [{ id: 'w', label: 'New date and time (IST)', type: 'datetime-local', value: isoToIstInput(r.scheduled_at), required: true }],
        onSubmit: async (v, mm) => { await fn('lectureReschedule', { id: r.id, when: istInputToIso(v.w) }); mm.remove(); toast('Time updated.', 'ok'); load(); } }); });
      $$('[data-e]').forEach(b => b.onclick = () => edit(data.find(x => x.id === b.dataset.e))); };

    const edit = r => formModal({ title: 'Edit', fields: [{ id: 'title', label: 'Title', value: r.title, required: true }, ...(type === 'lectures' ? [{ id: 'description', label: 'Description', type: 'textarea', value: r.description }, ...(r.youtube_url ? [{ id: 'yt', label: 'YouTube link', value: r.youtube_url }] : [])] : []), ...(r.link_url ? [{ id: 'lk', label: 'Share link', value: r.link_url }] : []), ...(type === 'homework' ? [{ id: 'instr', label: 'Instructions', type: 'textarea', value: r.instructions }, { id: 'due', label: 'Due date', type: 'date', value: r.due_date }] : []),
      ...(type !== 'lectures' && !r.link_url ? [{ id: 'file', label: 'Replace the file (optional)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png' }] : [])],
      onSubmit: async (v, mm) => { const body = { type, id: r.id, title: v.title, description: v.description || null, instructions: v.instr || null, due_date: v.due || null, youtube_url: v.yt, link_url: v.lk };
        if (v.file) { const err = mm.querySelector('.ferr'); err.style.color = 'var(--navy)'; const up = await uploadWithProgress('bcc-content', v.file, `${type}/${classNo}`, p => err.textContent = `Uploading… ${p}%`); err.style.color = ''; body.file_path = up.path; try { await fn('updateContent', body); } catch (e) { await removeFile('bcc-content', up.path); throw e; } }
        else await fn('updateContent', body);
        mm.remove(); toast('Saved.', 'ok'); load(); } });

    const form = () => {
      const srcOpts = type === 'lectures' ? [['youtube', 'YouTube link (recorded lecture)'], ['live', 'Scheduled YouTube live class'], ['gdrive', 'Google Drive link'], ['onedrive', 'OneDrive link']] : [['upload', 'Upload a file (PDF, JPG, PNG)'], ['gdrive', 'Google Drive link'], ['onedrive', 'OneDrive link']];
      const fields = [{ id: 'title', label: 'Title', required: true }, ...(type === 'lectures' ? [{ id: 'description', label: 'Description (optional)', type: 'textarea' }] : []), ...(type === 'homework' ? [{ id: 'instr', label: 'Instructions', type: 'textarea' }, { id: 'due', label: 'Due date', type: 'date', half: true }] : []),
        { id: 'src', label: 'Where is the file?', type: 'select', options: srcOpts },
        { id: 'yt', label: 'YouTube link', placeholder: 'https://www.youtube.com/watch?v=… or a live link' }, { id: 'when', label: 'Live class starts (India time, IST)', type: 'datetime-local', hint: 'Students get a reminder 10 minutes before, and a notification when you press Go live.' },
        { id: 'lk', label: 'Share link', placeholder: 'Paste the Google Drive / OneDrive share link', hint: 'Set the file to “Anyone with the link can view”. Note: anyone who has the link can open it.' }, { id: 'file', label: 'File (PDF, JPG or PNG, up to 15 MB)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png' },
        ...(type === 'lectures' ? [{ id: 'dl', label: 'Students may download', type: 'checkbox' }] : [])];
      const m = formModal({ title: `Add ${T[0].toLowerCase().replace(/s$/, '')}`, submitLabel: 'Publish', fields, onSubmit: async (v, mm) => {
        const s = v.src, body = { type, class_no: Number(classNo), subject_id: subjectId, title: v.title, source: s, description: v.description || null, instructions: v.instr || null, due_date: v.due || null };
        if (s === 'youtube' || s === 'live') { if (!/youtu/.test(v.yt)) throw new Error('Paste a valid YouTube link.'); body.youtube_url = v.yt; }
        if (s === 'gdrive' || s === 'onedrive') { if (!LINK_OK[s].test(v.lk)) throw new Error(`That does not look like a ${sourceLabel[s]} link.`); body.link_url = v.lk; body.downloadable = !!v.dl; }
        let up = null;
        if (s === 'upload') { if (!v.file) throw new Error('Choose a file to upload.'); const ext = (v.file.name.split('.').pop() || '').toLowerCase(); if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) throw new Error('Files must be PDF, JPG or PNG.'); if (v.file.size > 15 * 1024 * 1024) throw new Error('The file is larger than 15 MB.');
          const err = mm.querySelector('.ferr'); err.style.color = 'var(--navy)'; up = await uploadWithProgress('bcc-content', v.file, `${type}/${classNo}`, p => err.textContent = `Uploading… ${p}%`); err.style.color = ''; body.file_path = up.path; }
        if (s === 'live') { const iso = istInputToIso(v.when); if (!iso || new Date(iso) <= new Date()) throw new Error('Choose a start time in the future (India time).'); body.scheduled_at = iso; }
        try { await fn('saveContent', body); } catch (e) { if (up) await removeFile('bcc-content', up.path); throw e; }
        mm.remove(); toast(s === 'live' ? 'Live class scheduled. Students are notified.' : 'Published. Students are notified.', 'ok'); load(); } });
      const sync = () => { const s = m.querySelector('#f_src').value, show = (id, on) => { const el = m.querySelector('#f_' + id); if (el) el.closest('label, div').style.display = on ? '' : 'none'; };
        show('yt', s === 'youtube' || s === 'live'); show('when', s === 'live'); show('lk', s === 'gdrive' || s === 'onedrive'); show('file', s === 'upload'); show('dl', s === 'gdrive' || s === 'onedrive'); };
      m.querySelector('#f_src').onchange = sync; sync(); };
    load();
  }
}
