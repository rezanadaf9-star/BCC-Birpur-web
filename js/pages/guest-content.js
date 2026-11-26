// Guest page (index.html) glue. This file only
//  1) connects the login card to Firebase,  2) loads toppers + hero images + events from the database,
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
// ---- events: cards with swipeable photo albums (added by the admin in Website Events). First row 2 cards (centered), then rows of 3.
const DEFAULT_EVENTS = [['Sports', 'fa-futbol'], ['Cultural Events', 'fa-masks-theater'], ['Extracurricular', 'fa-puzzle-piece'], ['Crafting', 'fa-scissors'], ['Cooking', 'fa-utensils'], ['Annual Function', 'fa-award']];
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function eventCard(ev) {
  const imgs = (ev.images || []).filter(Boolean);
  const slides = imgs.length
    ? imgs.map((p, i) => `<div class="event-slide"><img src="${esc(pub(p))}" alt="${esc(ev.title)} photo ${i + 1}" ${i ? 'loading="lazy"' : ''} draggable="false"></div>`).join('')
    : `<div class="event-slide placeholder"><i class="fa-solid ${esc(ev.icon || 'fa-images')}" aria-hidden="true"></i></div>`;
  const sub = esc(ev.description || (imgs.length ? '' : 'Photos coming soon'));
  return `<article class="event-card reveal" aria-label="${esc(ev.title)}">
    <div class="event-slider" tabindex="0">${slides}</div>
    ${imgs.length > 1 ? `<div class="ev-dots">${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    <button class="ev-nav prev" type="button" aria-label="Previous photo" disabled><i class="fa-solid fa-chevron-left"></i></button>
    <button class="ev-nav next" type="button" aria-label="Next photo"><i class="fa-solid fa-chevron-right"></i></button>` : ''}
    <div class="event-cap"><div><h3>${esc(ev.title)}</h3>${sub ? `<small>${sub}</small>` : ''}</div>${imgs.length > 1 ? `<span class="event-count">1 / ${imgs.length}</span>` : ''}</div>
  </article>`;
}
function wireSlider(card) {
  const sl = card.querySelector('.event-slider'), n = card.querySelectorAll('.event-slide').length; if (!sl || n < 2) return;
  const dots = [...card.querySelectorAll('.ev-dots i')], prev = card.querySelector('.ev-nav.prev'), next = card.querySelector('.ev-nav.next'), count = card.querySelector('.event-count');
  const idx = () => Math.max(0, Math.min(n - 1, Math.round(sl.scrollLeft / sl.clientWidth)));
  const sync = () => { const i = idx(); dots.forEach((d, k) => d.classList.toggle('on', k === i)); prev.disabled = i === 0; next.disabled = i === n - 1; if (count) count.textContent = `${i + 1} / ${n}`; };
  const go = i => sl.scrollTo({ left: i * sl.clientWidth, behavior: 'smooth' });
  sl.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  prev.addEventListener('click', () => go(idx() - 1)); next.addEventListener('click', () => go(idx() + 1));
  sl.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(idx() + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx() - 1); } });
  // mouse drag (touch screens already swipe natively)
  let down = null;
  sl.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0) return; down = { x: e.clientX, left: sl.scrollLeft }; sl.classList.add('grabbing'); sl.setPointerCapture(e.pointerId); });
  sl.addEventListener('pointermove', e => { if (down) sl.scrollLeft = down.left - (e.clientX - down.x); });
  const end = () => { if (!down) return; down = null; sl.classList.remove('grabbing'); go(idx()); };
  sl.addEventListener('pointerup', end); sl.addEventListener('pointercancel', end);
}
async function events() {
  const host = document.getElementById('eventRows'); if (!host) return;
  let rows = []; try { rows = await run('site_events', [eq('is_published', true)], null, 60); } catch { /* shows the placeholder cards below */ }
  rows.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  const list = rows.length ? rows : DEFAULT_EVENTS.map(([title, icon]) => ({ title, icon, images: [] }));
  const chunks = [list.slice(0, 2)]; for (let i = 2; i < list.length; i += 3) chunks.push(list.slice(i, i + 3));
  host.innerHTML = chunks.filter(c => c.length).map(c => `<div class="event-row">${c.map(eventCard).join('')}</div>`).join('');
  host.querySelectorAll('.event-card').forEach(wireSlider);
  if (!('IntersectionObserver' in window)) host.querySelectorAll('.reveal').forEach(x => x.classList.add('in'));
  else { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08 }); host.querySelectorAll('.reveal').forEach(x => io.observe(x)); }
}
toppers(); hero(); events();

// ---- 3. already signed in? go straight to the dashboard (same behaviour as the original page)
if (!location.search.includes('add=1') && localStorage.getItem('bcc-current')) {
  import('../core/auth.js').then(async a => { const me = await a.getMe(); if (me && me.is_active !== false) location.replace(a.HOME[me.role]); }).catch(() => {});
}
