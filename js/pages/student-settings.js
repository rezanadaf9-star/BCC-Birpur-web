import { mountShell } from '../shared/shell.js';
import { rows as qrows, col, query, where } from '../core/db.js';
import { fn } from '../shared/api.js';
import * as FB from '../core/firebase-client.js';
import { pushSupported, pushEnabled, enablePush, disablePush } from '../core/push.js';
import { logout } from '../core/auth.js';
import { $, $$, esc, toast, fmtIST } from '../shared/ui.js';
const { content } = await mountShell({ role: 'student', active: 'settings.html', title: 'Settings', subtitle: 'Appearance and password' });
content.innerHTML = `<section class="card" style="max-width:520px"><div class="card-head"><h3>Change password</h3></div><div style="display:grid;gap:12px"><input class="input" id="p1" type="password" placeholder="New password (8+ characters)" autocomplete="new-password"><input class="input" id="p2" type="password" placeholder="Repeat new password" autocomplete="new-password"><p id="m" style="color:var(--red);font-size:13px;min-height:18px"></p><button class="btn y" id="go">Update password</button></div></section>
  <section class="card" style="max-width:520px"><div class="card-head"><h3>Appearance</h3></div><p style="color:var(--muted)">Use the sun/moon button at the top of any page to switch between light and dark mode.</p></section>
  <section class="card" style="max-width:720px" id="devices"><div class="card-head"><div><h3>Active devices</h3><small>This account can be open on 2 browsers and 2 phones at the same time (for example a student and a parent).</small></div></div><div id="dv">Loading…</div></section>
  <section class="card" style="max-width:520px" id="pushc" hidden><div class="card-head"><h3>Notifications on this device</h3></div><p style="color:var(--muted);margin-bottom:10px">Get a message when a lecture is about to start, goes live, or a result is declared.</p><button class="btn y" id="pushb"></button></section>
  <section class="card" style="max-width:520px"><button class="btn red" id="lo"><i class="fa-solid fa-right-from-bracket"></i>Log out</button></section>`;
$('#go').onclick = async () => { const a = $('#p1').value; if (a.length < 8) return $('#m').textContent = 'Use at least 8 characters.'; if (a !== $('#p2').value) return $('#m').textContent = 'The passwords do not match.';
  try { await fn('changeMyPassword', { password: a }); toast('Password updated. Your other devices were signed out.', 'ok'); $('#p1').value = $('#p2').value = ''; $('#m').textContent = ''; devices(); } catch (error) { $('#m').textContent = error.message; } };
$('#lo').onclick = logout;

async function devices() { const sid = (await FB.auth.currentUser.getIdTokenResult()).claims.bsid; const data = (await qrows(query(col('users', FB.auth.currentUser.uid, 'sessions'), where('revoked_at', '==', null)))).map(d => ({ ...d, is_current: d.id === sid })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  $('#dv').innerHTML = (data || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Device</th><th>Type</th><th>Signed in</th><th></th></tr></thead><tbody>${data.map(d => `<tr><td>${esc((d.device_label || 'Device').slice(0, 48))}</td><td>${d.platform === 'web' ? 'Browser' : 'Mobile app'}</td><td>${fmtIST(d.created_at)}</td><td>${d.is_current ? '<span class="tag g">This device</span>' : `<button class="btn red sm" data-r="${d.id}">Sign out</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p style="color:var(--muted)">No active devices.</p>';
  $$('[data-r]').forEach(b => b.onclick = async () => { if (!confirm('Sign this device out?')) return; let ok = false; try { ok = (await fn('revokeMySession', { sessionId: b.dataset.r })).ok; } catch {} toast(ok ? 'Device signed out.' : 'Could not sign it out.', ok ? 'ok' : 'err'); devices(); }); }
devices();

pushSupported().then(ok => { if (!ok) return; $('#pushc').hidden = false; const b = $('#pushb'); const paint = () => { b.textContent = pushEnabled() ? 'Turn off notifications' : 'Turn on notifications'; };
  paint(); b.onclick = async () => { try { if (pushEnabled()) { await disablePush(); toast('Notifications turned off.', 'ok'); } else { await enablePush(); toast('Notifications turned on.', 'ok'); } } catch (e) { toast(e.message, 'err'); } paint(); }; });
