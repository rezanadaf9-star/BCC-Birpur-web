import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where, orderBy } from '../core/db.js';
import { CONFIG } from '../config.js';
import { esc, empty, skeleton, initials } from '../shared/ui.js';
const { content } = await mountShell({ role: 'student', active: 'faculty.html', title: 'Faculty & Mentors', subtitle: 'The teachers who guide you' });
content.innerHTML = skeleton(4);
const data = await qrows(query(col('site_faculty'), where('is_published', '==', true), orderBy('position')));
const pub = p => !p ? '' : /^(https?:|images\/|assets\/)/.test(p) ? (/^https?:/.test(p) ? p : '../' + p) : `https://firebasestorage.googleapis.com/v0/b/${CONFIG.FIREBASE.storageBucket}/o/${encodeURIComponent('site-public/' + p)}?alt=media`;
content.innerHTML = (data || []).length ? `<section class="grid g4">${data.map(f => `<div class="card" style="text-align:center">${f.photo_path ? `<img src="${esc(pub(f.photo_path))}" alt="" style="width:110px;height:110px;border-radius:50%;object-fit:cover;margin:0 auto 10px;border:3px solid var(--yellow)">` : `<span class="avatar" style="width:110px;height:110px;font-size:34px;margin:0 auto 10px">${esc(initials(f.name))}</span>`}<h4>${esc(f.name)}</h4><div style="color:var(--muted);font-size:13.5px">${esc(f.designation)}</div>${f.subjects ? `<div class="tag y" style="margin-top:6px">${esc(f.subjects)}</div>` : ''}${f.classes_text ? `<div style="font-size:12.5px;color:var(--muted);margin-top:6px">${esc(f.classes_text)}</div>` : ''}${f.qualification ? `<div style="font-size:12.5px;color:var(--muted);margin-top:6px">${esc(f.qualification)}</div>` : ''}</div>`).join('')}</section>` : `<section class="card">${empty('fa-people-group', 'Faculty details will appear here.')}</section>`;
