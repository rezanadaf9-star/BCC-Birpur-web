import { fileBlobUrl } from '../core/storage.js';
import { esc, toast } from './ui.js';
/* ---------- what is this item? ----------
   item = { title, source_type, youtube_url, link_url, file_path, file_type, downloadable }  ->  { kind, url, ... } */
const ytId = u => (String(u || '').match(/(?:youtu\.be\/|v=|embed\/|live\/|shorts\/)([A-Za-z0-9_-]{11})/) || [])[1];
const driveId = u => (String(u || '').match(/\/d\/([A-Za-z0-9_-]{10,})|[?&]id=([A-Za-z0-9_-]{10,})/) || []).slice(1).find(Boolean);
export const sourceLabel = { youtube: 'YouTube', upload: 'Uploaded', gdrive: 'Google Drive', onedrive: 'OneDrive', link: 'Link' };
export async function classify(it) {
  if (it.youtube_url && ytId(it.youtube_url)) return { kind: 'youtube', url: `https://www.youtube-nocookie.com/embed/${ytId(it.youtube_url)}?rel=0&autoplay=1&playsinline=1`, open: it.youtube_url };
  const l = it.link_url || '';
  if (l) {
    if (/drive\.google\.com|docs\.google\.com/.test(l) && !/\/folders\//.test(l)) { const id = driveId(l);
      if (/docs\.google\.com\/(document|spreadsheets|presentation)/.test(l)) return { kind: 'embed', url: l.replace(/\/(edit|view)[^]*$/, '/preview'), open: l };
      if (id) return { kind: 'embed', url: `https://drive.google.com/file/d/${id}/preview`, open: l, dl: `https://drive.google.com/uc?export=download&id=${id}` }; }
    if (/embed|action=embedview/.test(l)) return { kind: 'embed', url: l, open: l };
    return { kind: 'external', url: l, open: l, note: /1drv\.ms|onedrive|sharepoint/.test(l) ? 'OneDrive does not allow its files to be shown inside other websites, so this opens in OneDrive.' : 'This link opens in a new tab.' };
  }
  if (it.file_path) { const ext = String(it.file_type || it.file_path.split('.').pop()).toLowerCase(); let url;
    try { url = await fileBlobUrl(it.file_path); } catch { return { kind: 'none' }; }
    const name = (it.title || 'file').replace(/[^\w\- ]+/g, '').trim() + '.' + ext;
    const kind = ext === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? 'image' : 'file'; return { kind, url, dl: url, open: url, name }; }
  return { kind: 'none' };
}
let pdfjs;
const loadPdf = () => pdfjs ||= new Promise((res, rej) => { if (window.pdfjsLib) return res(window.pdfjsLib); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); }; s.onerror = () => rej(new Error('pdf')); document.head.append(s); });

/** Full-screen viewer for lectures, notes and homework. Esc or the Back button closes it. */
export async function openViewer(item, { allowDownload = true } = {}) {
  const info = await classify(item); if (info.kind === 'none') return toast('Nothing to open here yet.', 'err');
  if (info.kind === 'external') { window.open(info.open, '_blank', 'noopener'); return; }
  const el = document.createElement('div'); el.className = 'vw'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  const dl = allowDownload && (info.dl || ['pdf', 'image', 'video', 'file'].includes(info.kind) && info.url);
  el.innerHTML = `<div class="vw-bar"><b class="vw-title">${esc(item.title || '')}</b><div class="vw-tools">
    ${info.kind === 'image' ? '<button data-z="-" aria-label="Zoom out"><i class="fa-solid fa-magnifying-glass-minus"></i></button><button data-z="+" aria-label="Zoom in"><i class="fa-solid fa-magnifying-glass-plus"></i></button>' : ''}${info.kind === 'pdf' ? '<button data-p="-" aria-label="Zoom out"><i class="fa-solid fa-magnifying-glass-minus"></i></button><span class="vw-pg" id="vwpg"></span><button data-p="+" aria-label="Zoom in"><i class="fa-solid fa-magnifying-glass-plus"></i></button>' : ''}
    ${dl ? `<a href="${esc(info.dl || info.url)}" download="${esc(info.name || '')}" target="_blank" rel="noopener" aria-label="Download"><i class="fa-solid fa-download"></i></a>` : ''}${navigator.share && info.open ? '<button data-sh aria-label="Share"><i class="fa-solid fa-share-nodes"></i></button>' : ''}
    <a href="${esc(info.open || info.url)}" target="_blank" rel="noopener" aria-label="Open in new tab"><i class="fa-solid fa-arrow-up-right-from-square"></i></a><button data-fs aria-label="Full screen"><i class="fa-solid fa-expand"></i></button><button data-x aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div></div><div class="vw-body" id="vwb"></div>`;
  document.body.append(el); document.body.style.overflow = 'hidden'; const body = el.querySelector('#vwb');
  const close = () => { el.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', key); window.removeEventListener('popstate', close); if (document.fullscreenElement) document.exitFullscreen?.(); };
  const key = e => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', key); history.pushState({ vw: 1 }, ''); window.addEventListener('popstate', close, { once: true });
  el.querySelector('[data-x]').onclick = () => { window.removeEventListener('popstate', close); history.back(); close(); };
  el.querySelector('[data-fs]').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.());
  el.querySelector('[data-sh]')?.addEventListener('click', () => navigator.share({ title: item.title, url: info.open }).catch(() => {}));
  if (info.kind === 'youtube' || info.kind === 'embed') body.innerHTML = `<iframe src="${esc(info.url)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
  else if (info.kind === 'video') body.innerHTML = `<video src="${esc(info.url)}" controls autoplay playsinline ${item.downloadable === false ? 'controlsList="nodownload"' : ''}></video>`;
  else if (info.kind === 'image') { let z = 1; body.innerHTML = `<div class="vw-img"><img src="${esc(info.url)}" alt="${esc(item.title || '')}"></div>`; const img = body.querySelector('img'); const set = v => { z = Math.min(5, Math.max(.5, v)); img.style.maxWidth = z === 1 ? '100%' : 'none'; img.style.maxHeight = z === 1 ? '100%' : 'none'; img.style.width = z === 1 ? 'auto' : (z * 100) + '%'; };
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => set(z + (b.dataset.z === '+' ? .5 : -.5))); img.ondblclick = () => set(z === 1 ? 2 : 1); body.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); set(z + (e.deltaY < 0 ? .25 : -.25)); } }, { passive: false }); }
  else if (info.kind === 'pdf') {
    body.innerHTML = '<div class="vw-pdf" id="vwp"><p class="vw-load">Loading document…</p></div>'; const wrap = body.querySelector('#vwp'); let scale = 1, pdf, rendered = 0;
    try { const lib = await loadPdf(); pdf = await lib.getDocument({ url: info.url }).promise; el.querySelector('#vwpg').textContent = `${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}`;
      const draw = async () => { wrap.innerHTML = ''; const w = Math.min(wrap.clientWidth - 24, 1100) * scale, dpr = Math.min(devicePixelRatio || 1, 2);
        for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i), vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: w / vp0.width }); const c = document.createElement('canvas'); c.width = vp.width * dpr; c.height = vp.height * dpr; c.style.width = vp.width + 'px'; c.style.height = vp.height + 'px'; wrap.append(c);
          await page.render({ canvasContext: c.getContext('2d'), viewport: page.getViewport({ scale: vp.scale * dpr }) }).promise; } };
      el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { scale = Math.min(3, Math.max(.5, scale + (b.dataset.p === '+' ? .25 : -.25))); draw(); }); await draw();
    } catch { body.innerHTML = `<iframe src="${esc(info.url)}"></iframe>`; }   // fallback: the browser's own PDF viewer
  } else body.innerHTML = `<div class="vw-msg"><p>This file type cannot be previewed.</p><a class="btn y" href="${esc(info.dl || info.url)}" target="_blank" rel="noopener">Download / open</a></div>`;
  return { close };
}
