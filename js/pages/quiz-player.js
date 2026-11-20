import { requireRole, ROOT } from '../core/auth.js';
import { fn } from '../shared/api.js';
import { myFeatures } from '../core/permissions.js';
import { esc } from '../shared/ui.js';
const me = await requireRole(['student']); const feats = await myFeatures();
const P = new URLSearchParams(location.search), root = document.body;
document.documentElement.dataset.theme = 'light';
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const num = v => Math.round(Number(v) * 100) / 100;
const head = (title, right = '') => `<header class="qz-head"><div class="qz-brand"><img src="${ROOT}bcc-assets/logo.png" alt="BCC"><div><small>BRILLIANT COACHING CENTRE</small><h1>${esc(title)}</h1></div></div><div class="qz-chips">${right}</div></header>`;

async function result(attemptId, local = {}) {
  const r = await fn('getAttemptResult', { quiz_id: attemptId }); const a = r.attempt, ans = Object.fromEntries(r.answers.map(x => [x.question_id, x]));
  root.innerHTML = head('Quiz result') + `<div class="res"><div class="card" style="text-align:center"><div style="font-size:44px">${a.score >= a.total_marks * .6 ? '🎉' : '📘'}</div><h2 style="margin:6px 0">${num(a.score)} / ${num(a.total_marks)}</h2><p style="color:var(--muted)">${a.correct_count} correct · ${a.wrong_count} wrong · ${a.unattempted_count} not attempted</p><div style="margin-top:14px;display:flex;gap:8px;justify-content:center"><a class="btn y" href="leaderboard.html?quiz=${a.quiz_id}">Leaderboard</a><a class="btn ghost" href="quizzes.html">Back to quizzes</a></div></div>
    <div class="card"><h3 style="margin-bottom:6px">Answers and explanations</h3>${r.questions.map(q => { const x = ans[q.id], l = local[q.id] || {}; return `<div class="rv"><b>${q.position}. ${esc(q.question_text)}</b><div style="margin:6px 0">${x?.selected_option ? `Your answer: <span class="${x.status === 'correct' ? 'ok' : 'bad'}">${x.selected_option}. ${esc(q['option_' + x.selected_option.toLowerCase()] || '')} ${x.status === 'correct' ? '✓' : '✕'}</span>` : '<span style="color:var(--muted)">Not attempted</span>'}</div>${x?.status !== 'correct' ? `<div>Correct answer: <span class="ok">${q.correct_option}. ${esc(q['option_' + q.correct_option.toLowerCase()] || '')}</span></div>` : ''}${q.explanation ? `<div style="color:var(--muted);margin-top:4px">${esc(q.explanation)}</div>` : ''}</div>`; }).join('')}</div></div>`;
}
if (P.get('attempt')) await result(P.get('attempt'));
else if (!feats.has('quizzes')) root.innerHTML = '<p style="padding:40px;text-align:center">Quizzes are not enabled for your class.</p>';
else {
  const quizId = P.get('id'); let session;
  try { session = await fn('start-quiz', { quiz_id: quizId }); } catch (e) { root.innerHTML = `${head('Quiz')}<div class="res"><div class="card" style="text-align:center"><h3>${esc(e.message)}</h3><p style="margin:12px 0"><a class="btn" href="quizzes.html">Back to quizzes</a></p></div></div>`; await new Promise(() => {}); }   // the message stays on screen; nothing else runs
  const quiz = session.quiz;
  if (!Array.isArray(session?.questions) || !session.questions.length) { root.innerHTML = `${head('Quiz')}<div class="res"><div class="card" style="text-align:center"><h3>This quiz has no questions yet.</h3><p style="margin:12px 0"><a class="btn" href="quizzes.html">Back to quizzes</a></p></div></div>`; throw new Error('empty quiz'); }
  const Q = session.questions, KEY = 'bcc-quiz-' + session.session_id; let saved = {}; try { saved = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch {}
  let asking = false, cur = 0, ans = saved.ans || {}, vis = new Set(saved.vis || [0]), lang = quiz.language_mode === 'hi' ? 'hi' : 'en', done = false;
  const expires = new Date(session.expires_at).getTime(), persist = () => sessionStorage.setItem(KEY, JSON.stringify({ ans, vis: [...vis] }));
  const canHi = quiz.language_mode !== 'en', txt = (q, k) => (lang === 'hi' && q[k + '_hi']) ? q[k + '_hi'] : q[k];
  root.innerHTML = `<div class="rot">Rotate your phone to landscape for the best quiz view.</div>` + head(quiz.title, `<div class="qz-chip" id="tm"><i class="fa-regular fa-clock" style="font-size:24px"></i><div><b id="tv">--:--</b><small>TIME</small></div></div><div class="qz-chip"><b>${Q.length}</b><small>QUESTIONS</small></div>`) + `<div class="qz-wrap"><main class="qz-main"></main><aside class="qz-side"></aside></div>`;
  const main = root.querySelector('.qz-main'), side = root.querySelector('.qz-side');
  function draw() { vis.add(cur); const q = Q[cur], opts = ['a', 'b', 'c', 'd'].filter(k => q['option_' + k]);
    main.innerHTML = `<div class="qz-top"><b>Question ${cur + 1}</b><div class="qz-tools">${canHi && quiz.language_mode === 'both' ? `<div class="lang"><button class="${lang === 'en' ? 'on' : ''}" data-l="en">English</button><button class="${lang === 'hi' ? 'on' : ''}" data-l="hi">हिंदी</button></div>` : ''}<div class="mk"><span class="p">+${num(quiz.correct_marks)}</span><span style="color:var(--grey-300)">|</span><span class="n">− ${num(quiz.wrong_marks)}</span></div></div></div>
      <div class="qz-card"><h2>${esc(txt(q, 'question_text'))}</h2>${opts.map(k => `<button class="opt ${ans[q.id] === k.toUpperCase() ? 'sel' : ''}" data-o="${k.toUpperCase()}"><span class="l">${k.toUpperCase()}</span><span>${esc(txt(q, 'option_' + k))}</span></button>`).join('')}</div>
      <div class="qz-nav"><button class="qz-btn" id="pv" ${cur === 0 ? 'disabled style="opacity:.5"' : ''}><i class="fa-solid fa-arrow-left"></i>Previous</button><button class="qz-btn pri" id="nx">${cur === Q.length - 1 ? 'Review' : 'Next'} <i class="fa-solid fa-arrow-right"></i></button></div>`;
    main.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { ans[q.id] = ans[q.id] === b.dataset.o ? undefined : b.dataset.o; if (!ans[q.id]) delete ans[q.id]; persist(); draw(); });
    main.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { lang = b.dataset.l; draw(); });
    main.querySelector('#pv').onclick = () => { if (cur > 0) { cur--; draw(); } }; main.querySelector('#nx').onclick = () => { if (cur < Q.length - 1) { cur++; draw(); } };
    side.innerHTML = `<h3>Questions <small>${Object.keys(ans).length} / ${Q.length}</small></h3><div class="grid5">${Q.map((x, i) => `<button class="qn ${ans[x.id] ? 'att' : vis.has(i) ? 'vis' : ''} ${i === cur ? 'cur' : ''}" data-i="${i}">${i + 1}</button>`).join('')}</div>
      <div class="legend"><span><i></i>Not Visited</span><span><i style="background:var(--yellow);border-color:var(--yellow)"></i>Visited</span><span><i style="background:#5fbf86;border-color:#5fbf86"></i>Attempted</span></div><button class="submit" id="sub">Submit Quiz</button>`;
    side.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { cur = Number(b.dataset.i); draw(); }); side.querySelector('#sub').onclick = () => submit('manual'); persist(); }
  async function submit(reason) { if (done) return; if (reason === 'manual') { const left = Q.length - Object.keys(ans).length; asking = true; const okc = confirm(left ? `${left} question(s) are not attempted. Submit the quiz now?` : 'Submit the quiz now?'); asking = false; if (!okc) return; }
    done = true; clearInterval(timer); window.onbeforeunload = null; root.querySelector('#sub')?.setAttribute('disabled', 'disabled');
    try { const r = await fn('submit-quiz', { quiz_id: quizId, session_id: session.session_id, answers: ans, submission_reason: reason, hidden_ms: hiddenMs, hidden_count: hiddenCount }); sessionStorage.removeItem(KEY); await result(r.attempt.id); }
    catch (e) { done = false; alert(e.message); if (/expired|already/i.test(e.message)) location.href = 'quizzes.html'; } }
  const tick = () => { const left = Math.max(0, Math.round((expires - Date.now()) / 1000)); const tv = root.querySelector('#tv'); if (tv) tv.textContent = fmt(left); root.querySelector('#tm')?.classList.toggle('low', left < 60); if (left <= 0) submit('time-up'); };
  const timer = setInterval(tick, 1000); tick();
  // Anti-cheating (your decision D5).
  // Desktop: leaving the quiz tab, switching windows or losing focus submits the quiz at once.
  // Phones: a locked screen and an app switch look the same to the browser. So the screen is kept awake during the quiz (it will not dim or lock by itself),
  // a quick glance away (20 seconds or less) is ignored, and the quiz is submitted only when the page comes back after being hidden for LONGER than 20 seconds.
  // How many times and how long the page was hidden is always recorded and shown to the teacher.
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer:coarse)').matches), GRACE = 20000;
  let hiddenMs = 0, hiddenCount = 0, hiddenAt = 0, wake = null;
  const keepAwake = async () => { try { if (phone && 'wakeLock' in navigator && !done) wake = await navigator.wakeLock.request('screen'); } catch { /* not supported: nothing else to do */ } };
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (done) return;
    if (document.hidden) { if (phone) { hiddenAt = Date.now(); hiddenCount++; } else submit('tab-switch'); }
    else if (phone) { const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0; hiddenMs += away; keepAwake(); if (away > GRACE) submit('tab-switch-phone'); } });
  if (!phone) window.addEventListener('blur', () => { if (!done && !asking) setTimeout(() => { if (!done && !asking && !document.hasFocus()) submit('tab-switch'); }, 250); });
  history.pushState({ q: 1 }, ''); window.addEventListener('popstate', () => { if (!done) { history.pushState({ q: 1 }, ''); submit('manual'); } });
  window.onbeforeunload = e => { if (!done) { e.preventDefault(); e.returnValue = ''; } };
  draw();
}
