// Guest page (index.html) glue. The page itself is the ORIGINAL design; this file only
//  1) connects the original login card to Firebase,  2) loads toppers + hero images + faculty from the database,
//  3) sends an already-signed-in user to their dashboard. Public content uses the plain Firestore REST API (no SDK, no CDN),
//  so the guest page never depends on a script host. The security rules only allow published public documents to be read.
import { CONFIG } from '../config.js';
const FB = CONFIG.FIREBASE;
const DOCS = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents`;
const dec = v => { if (v == null) return null; const [k, x] = Object.entries(v)[0];
  if (k === 'nullValue') return null; if (k === 'integerValue') return Number(x); if (k === 'doubleValue') return x; if (k === 'arrayValue') return (x.values || []).map(dec);
  if (k === 'mapValue') return Object.fromEntries(Object.entries(x.fields || {}).map(([a, b]) => [a, dec(b)])); return x; };
const plain = d => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)]));
const pub = p => !p ? '' : /^(https?:|assets\/|images\/)/.test(p) ? p : `https://firebasestorage.googleapis.com/v0/b/${FB.storageBucket}/o/${encodeURIComponent('site-public/' + p)}?alt=media`;
/** Run a structured query: only published rows, as the rules require. */
const run = async (collectionId, filters, order, limit) => {
  const sq = { from: [{ collectionId }], where: filters.length > 1 ? { compositeFilter: { op: 'AND', filters } } : filters[0], limit };
  if (order) sq.orderBy = order.map(([f, d]) => ({ field: { fieldPath: f }, direction: d }));
  const r = await fetch(`${DOCS}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: sq }) });
  if (!r.ok) throw new Error(r.status); return (await r.json()).filter(x => x.document).map(x => plain(x.document));
};
const eq = (f, v) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: typeof v === 'boolean' ? { booleanValue: v } : { stringValue: v } } });
const get = async path => { const r = await fetch(`${DOCS}/${path}`); if (!r.ok) throw new Error(r.status); return (await r.json()).documents?.map(plain) || []; };

// ---- 1. login (auth code is loaded on demand; a CDN or network failure shows a normal error in the card)
window.bccDoLogin = async (portal, id, password) => {
  let auth; try { auth = await import('../core/auth.js'); } catch { throw new Error('Could not reach the login service. Check your internet connection and try again.'); }
  const me = await auth.login(portal, id, password);
  location.replace(auth.HOME[me.role]);
};
if (location.hash === '#session-ended') setTimeout(() => alert('You were signed out because your account was used on another device.'), 300);

// ---- 2a. toppers: rank = marks (highest first); ties broken by newer batch
async function toppers() {
  try {
    const rows = await Promise.all(['matric', 'intermediate'].map(l => run('site_toppers', [eq('level', l), eq('is_published', true)], [['marks', 'DESCENDING'], ['batch_year', 'DESCENDING']], 10)));
    clearTimeout(window.bccToppersTimer);
    const shape = r => r.map(t => [t.name, Number(t.marks), t.bseb_roll || '—', t.batch_year || '', pub(t.photo_path), t.school_note || '']);
    window.renderToppers('matricToppers', shape(rows[0])); window.renderToppers('interToppers', shape(rows[1]));
  } catch { clearTimeout(window.bccToppersTimer); window.bccToppersFallback?.(); }   // the lists are empty if the database cannot be reached
}
// ---- 2b. hero images: slots 1-4 replace the matching slide; missing slots keep the default image
async function hero() {
  try { const rows = (await get('site_hero')).filter(r => r.is_active !== false).sort((a, b) => a.slot - b.slot);
    rows.forEach(r => { const img = document.querySelectorAll('.hero-slide img')[r.slot - 1]; if (img) img.src = pub(r.image_path); });
  } catch { /* keep default images */ }
}
// ---- faculty: first four in the first row, the rest behind the original "More Faculty" card. Order = the position set by the admin.
async function faculty() {
  try {
    const rows = await run('site_faculty', [eq('is_published', true)], [['position', 'ASCENDING']], 100);
    const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const card = r => `<article class="faculty-card"><img alt="${e(r.name)}" src="${e(pub(r.photo_path) || 'images/more-faculty.png')}" /><strong>${e(r.short_name || r.name)}</strong><small>${e(r.designation || 'Faculty')}</small></article>`;
    const grid = document.getElementById('faculty-public-grid');   // the detailed "Our Faculty" section: same order, same cards
    if (grid) grid.innerHTML = rows.map((r, i) => `<article class="faculty-public-card${i === 0 && /director/i.test(r.designation) ? ' director-faculty-card' : ''}"><div class="faculty-photo"><img src="${e(pub(r.photo_path) || 'images/more-faculty.png')}" alt="${e(r.name)}"></div><div class="faculty-body"><h3>${e(r.name)}</h3><small>${e(r.designation || 'Faculty')}</small>${r.subjects ? `<span><i class="fa-solid fa-book"></i> ${e(r.subjects)}</span>` : ''}${r.classes_text ? `<span><i class="fa-solid fa-school"></i> ${e(r.classes_text)}</span>` : ''}</div></article>`).join('');
    const main = document.getElementById('home-faculty-row'), more = document.getElementById('more-faculty-list'); if (!main) return;
    const first = rows.slice(0, 4), rest = rows.slice(4);
    main.innerHTML = first.map(card).join('') + (rest.length ? `<article class="faculty-card" id="more-faculty-btn" role="button" tabindex="0" aria-expanded="false" style="cursor:pointer"><img alt="More Faculty" src="images/more-faculty.png" /><strong>More Faculty</strong><small>Tap to view</small></article>` : '');
    more.innerHTML = rest.map(card).join('');
    const btn = document.getElementById('more-faculty-btn'), toggle = () => { const open = btn.getAttribute('aria-expanded') === 'true'; btn.setAttribute('aria-expanded', String(!open)); more.hidden = open; btn.querySelector('small').textContent = open ? 'Tap to view' : 'Tap to hide'; };
    btn?.addEventListener('click', toggle); btn?.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
  } catch { /* leave the section empty */ }
}
toppers(); hero(); faculty();

// ---- 3. already signed in? go straight to the dashboard (same behaviour as the original page)
if (!location.search.includes('add=1') && localStorage.getItem('bcc-current')) {
  import('../core/auth.js').then(async a => { const me = await a.getMe(); if (me && me.is_active !== false) location.replace(a.HOME[me.role]); }).catch(() => {});
}
