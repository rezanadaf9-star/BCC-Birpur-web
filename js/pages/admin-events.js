// Admin > Website Events. Each event (Sports, Cultural, Craft...) becomes a card on the public welcome page.
// The card shows its first image; visitors swipe / slide to see the next ones. Images are stored in Firebase Storage (site-public/events).
import { mountShell } from '../shared/shell.js';
import { db, doc, addDoc, setDoc, deleteDoc, rows as qrows, col, query, orderBy } from '../core/db.js';
import { compressImage, upload, removeFile } from '../core/storage.js';
import { CONFIG } from '../config.js';
import { $, esc, modal, toast, empty, skeleton } from '../shared/ui.js';
const { content } = await mountShell({ role: 'admin', active: 'events.html', title: 'Website Events' });
const img = p => !p ? '' : /^(https?:|assets\/|images\/)/.test(p) ? '../' + p : `https://firebasestorage.googleapis.com/v0/b/${CONFIG.FIREBASE.storageBucket}/o/${encodeURIComponent('site-public/' + p)}?alt=media`;
const SUGGEST = ['Sports', 'Cultural Events', 'Extracurricular', 'Crafting', 'Cooking', 'Annual Function'];
content.innerHTML = `<section class="card"><div class="card-head"><h3>Events</h3><button class="btn y" id="add"><i class="fa-solid fa-plus"></i>Add event</button></div><div id="list">${skeleton(4)}</div></section>`;

async function load() {
  let data; try { data = await qrows(query(col('site_events'), orderBy('position'))); } catch (e) { $('#list').innerHTML = empty('fa-triangle-exclamation', e.message); return; }
  $('#list').innerHTML = data.length ? `<div class="grid ev-admin-grid">${data.map(e => `<article class="ev-admin-card">
      <div class="ev-admin-cover">${(e.images || [])[0] ? `<img src="${esc(img(e.images[0]))}" alt="">` : '<i class="fa-regular fa-image"></i>'}<span class="tag ${e.is_published === false ? 'o' : 'g'}">${e.is_published === false ? 'Hidden' : 'Live'}</span></div>
      <div class="ev-admin-body"><b>${esc(e.title)}</b><small>${(e.images || []).length} photo${(e.images || []).length === 1 ? '' : 's'} · position ${e.position ?? '–'}</small>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost sm" data-e="${e.id}">Edit</button><button class="btn red sm" data-d="${e.id}">Delete</button></div></div></article>`).join('')}</div>`
    : empty('fa-images', 'No events yet.');
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(data.find(x => x.id === b.dataset.e), data.length));
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this event and all its photos from the website?')) return;
    try { const ev = data.find(x => x.id === b.dataset.d); await deleteDoc(doc(db, 'site_events', b.dataset.d)); (ev.images || []).forEach(p => { if (/^events\//.test(p)) removeFile('site-public', p); }); toast('Deleted.', 'ok'); load(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

function form(ev = {}, total = 0) {
  let imgs = [...(ev.images || [])];                // stored paths (existing photos)
  const removedStored = [];                          // stored paths to delete from Storage after saving
  const m = modal(`<h3 style="margin-bottom:14px">${ev.id ? 'Edit' : 'Add'} event</h3><div style="display:grid;gap:12px">
    <div><label class="f">Event name</label><input class="input" id="t" list="sug" value="${esc(ev.title || '')}" placeholder="Sports"><datalist id="sug">${SUGGEST.map(s => `<option value="${s}">`).join('')}</datalist></div>
    <div><label class="f">Short line (optional)</label><input class="input" id="d" value="${esc(ev.description || '')}" placeholder="Annual sports day, 2026"></div>
    <div class="grid g2"><div><label class="f">Position</label><input class="input" id="p" type="number" min="1" value="${ev.position ?? total + 1}"></div>
    <label style="display:flex;gap:8px;align-items:center;padding-top:26px"><input type="checkbox" id="pub" ${ev.is_published === false ? '' : 'checked'}> Show on website</label></div>
    <div><label class="f">Photos (first is the cover)</label><div id="thumbs" class="ev-thumbs"></div>
    <input class="input" id="ph" type="file" accept="image/*" multiple style="padding-top:10px;margin-top:8px"></div>
    <p id="err" style="color:var(--red);font-size:13px"></p><button class="btn y" id="ok">Save</button></div>`);
  let added = [];                                    // new files chosen in this dialog: {file, url}
  const draw = () => {
    const items = [...imgs.map(p => ({ kind: 's', key: p, url: img(p) })), ...added.map((a, i) => ({ kind: 'n', key: i, url: a.url }))];
    $('#thumbs', m).innerHTML = items.length ? items.map((it, i) => `<div class="ev-thumb"><img src="${esc(it.url)}" alt=""><button type="button" data-x="${i}" aria-label="Remove photo"><i class="fa-solid fa-xmark"></i></button>${i === 0 ? '<span>Cover</span>' : `<button type="button" class="mv" data-l="${i}" aria-label="Move earlier"><i class="fa-solid fa-arrow-left"></i></button>`}</div>`).join('') : '<small style="color:var(--muted)">No photos yet.</small>';
    $('#thumbs', m).querySelectorAll('[data-x]').forEach(b => b.onclick = () => { const i = +b.dataset.x; if (i < imgs.length) { removedStored.push(imgs[i]); imgs.splice(i, 1); } else added.splice(i - imgs.length, 1); draw(); });
    $('#thumbs', m).querySelectorAll('[data-l]').forEach(b => b.onclick = () => { const i = +b.dataset.l; const all = [...imgs.map(p => ({ s: p })), ...added.map(a => ({ n: a }))]; [all[i - 1], all[i]] = [all[i], all[i - 1]]; imgs = all.filter(x => x.s).map(x => x.s); added = all.filter(x => x.n).map(x => x.n); /* order of stored vs new is kept as stored first, then new */ draw(); });
  };
  $('#ph', m).onchange = e => { [...e.target.files].forEach(f => added.push({ file: f, url: URL.createObjectURL(f) })); e.target.value = ''; draw(); };
  draw();
  $('#ok', m).onclick = async () => {
    const err = x => $('#err', m).textContent = x, title = $('#t', m).value.trim();
    if (!title) return err('Please enter the event name.');
    const btn = $('#ok', m); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const paths = [...imgs];
      for (let i = 0; i < added.length; i++) {
        btn.textContent = `Uploading photo ${i + 1} of ${added.length}…`;
        let blob = await compressImage(added[i].file, 1280, .78); if (blob.size > 900 * 1024) blob = await compressImage(added[i].file, 900, .7);
        paths.push((await upload('site-public', new File([blob], 'e.jpg', { type: 'image/jpeg' }), 'events')).path);
      }
      const row = { title, description: $('#d', m).value.trim() || null, position: Number($('#p', m).value) || total + 1, is_published: $('#pub', m).checked, images: paths };
      if (ev.id) await setDoc(doc(db, 'site_events', ev.id), row, { merge: true }); else await addDoc(col('site_events'), { ...row, created_at: new Date().toISOString() });
      removedStored.forEach(p => { if (/^events\//.test(p)) removeFile('site-public', p); });
      m.remove(); toast('Saved. The website updates automatically.', 'ok'); load();
    } catch (e) { err(e.message); btn.disabled = false; btn.textContent = 'Save'; }
  };
}
$('#add').onclick = () => form({}, 0);
load();
