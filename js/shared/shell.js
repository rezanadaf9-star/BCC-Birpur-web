import { requireRole, logout, ROOT, HOME } from '../core/auth.js';
import { accounts, currentId, switchTo } from '../core/accounts.js';
import { myFeatures, isSuper15Member } from '../core/permissions.js';
import { unreadCount } from '../core/notifications.js';
import { photo } from '../core/storage.js';
import { attendanceEnabled, ATTENDANCE_PAGES } from '../core/flags.js';
import { $, esc, initials, greet, fmtDate, toast } from './ui.js';

/* One registry per role. group = sidebar heading. feature = class feature key (students). super15 = only for Super 15 members. */
const N = (href, icon, label, group, extra = {}) => ({ href, icon, label, group, ...extra });
const STUDENT_NAV = [
  N('dashboard.html', 'fa-house', 'Dashboard', 'Main'), N('profile.html', 'fa-user', 'Profile', 'Main'),
  N('lectures.html', 'fa-circle-play', 'Lectures', 'Learn', { feature: 'lectures' }), N('notes.html', 'fa-book-open', 'Notes', 'Learn', { feature: 'notes' }), N('homework.html', 'fa-pen-to-square', 'Homework', 'Learn', { feature: 'homework' }),
  N('quizzes.html', 'fa-list-check', 'Quizzes', 'Learn', { feature: 'quizzes' }), N('leaderboard.html', 'fa-trophy', 'Quiz Leaderboard', 'Learn', { feature: 'quiz_leaderboard' }), N('ai-tutor.html', 'fa-robot', 'AI Tutor', 'Learn', { feature: 'ai_tutor' }), N('ai-hub.html', 'fa-brain', 'AI Study Hub', 'Learn', { feature: 'ai_study_hub' }),
  N('marks.html', 'fa-chart-column', 'Academic Performance', 'Academics', { feature: 'marks' }), N('attendance.html', 'fa-calendar-check', 'Attendance', 'Academics', { feature: 'attendance' }), N('timetable.html', 'fa-clock', 'Class Schedule', 'Academics', { feature: 'timetable' }),
  N('answer-sheets.html', 'fa-file-pen', 'Answer Sheets', 'Academics', { feature: 'answer_sheets' }), N('fees.html', 'fa-indian-rupee-sign', 'Fees & Payments', 'Academics', { feature: 'fees' }),
  N('announcements.html', 'fa-bullhorn', 'Announcements', 'Community', { feature: 'announcements' }), N('ptm.html', 'fa-people-roof', 'PTM', 'Community', { feature: 'ptm' }), N('motivational.html', 'fa-lightbulb', 'Motivational Sessions', 'Community', { feature: 'motivational' }),
  N('discussion.html', 'fa-comments', 'Group Discussion', 'Community', { feature: 'group_discussion' }), N('super15.html', 'fa-bolt', 'Super 15', 'Community', { super15: true }),
  N('faculty.html', 'fa-people-group', 'Faculty & Mentors', 'Community'), N('alumni.html', 'fa-user-graduate', 'Alumni Network', 'Community', { feature: 'alumni' }), N('board-results.html', 'fa-award', 'Board Results', 'Community', { feature: 'results' }), N('settings.html', 'fa-gear', 'Settings', 'More'),
];
const ADMIN_NAV = [
  N('dashboard.html', 'fa-gauge', 'Dashboard', 'Overview'),
  N('admission.html', 'fa-user-plus', 'Admission', 'People'), N('students.html', 'fa-user-graduate', 'Students', 'People'), N('teachers.html', 'fa-chalkboard-user', 'Teachers', 'People'), N('classes.html', 'fa-school', 'Classes & Features', 'People'),
  N('attendance.html', 'fa-calendar-check', 'Attendance', 'Academics'), N('holidays.html', 'fa-umbrella-beach', 'Holidays', 'Academics'), N('examinations.html', 'fa-file-signature', 'Examinations', 'Academics'), N('marks.html', 'fa-chart-column', 'Marks', 'Academics'), N('leaderboards.html', 'fa-trophy', 'Leaderboards', 'Academics'), N('timetable.html', 'fa-clock', 'Timetable', 'Academics'), N('answer-sheets.html', 'fa-file-pen', 'Answer Sheets', 'Academics'), N('toppers.html', 'fa-award', 'Board Results', 'Academics'),
  N('lectures.html', 'fa-circle-play', 'Lectures', 'Content'), N('notes.html', 'fa-book-open', 'Notes', 'Content'), N('homework.html', 'fa-pen-to-square', 'Homework', 'Content'), N('quizzes.html', 'fa-list-check', 'Quizzes', 'Content'), N('ai-hub.html', 'fa-brain', 'AI Study Hub', 'Content'), N('discussions.html', 'fa-comments', 'Discussions', 'Content'),
  N('fees.html', 'fa-indian-rupee-sign', 'Fees', 'Operations'), N('announcements.html', 'fa-bullhorn', 'Announcements', 'Operations'), N('meetings.html', 'fa-video', 'PTM & Meetings', 'Operations'), N('super15.html', 'fa-bolt', 'Super 15', 'Operations'), N('alumni.html', 'fa-user-graduate', 'Alumni', 'Operations'), N('print.html', 'fa-print', 'Print Centre', 'Operations'),
  N('events.html', 'fa-images', 'Website Events', 'Website'), N('settings.html', 'fa-sliders', 'Portal Settings', 'Website'),
];
const TEACHER_ALLOWED = ['dashboard.html', 'students.html', 'attendance.html', 'examinations.html', 'marks.html', 'leaderboards.html', 'timetable.html', 'answer-sheets.html', 'lectures.html', 'notes.html', 'homework.html', 'quizzes.html', 'ai-hub.html', 'discussions.html', 'meetings.html', 'super15.html', 'print.html'];
const TEACHER_NAV = ADMIN_NAV.filter(n => TEACHER_ALLOWED.includes(n.href));
const NAVS = { student: STUDENT_NAV, admin: ADMIN_NAV, teacher: TEACHER_NAV };
const LEARN = [['lectures.html','Lectures'],['notes.html','Notes'],['homework.html','Homework'],['quizzes.html','Quizzes']];

export async function mountShell({ role, active, title, subtitle = '' }) {
  const [me, attOn] = await Promise.all([requireRole([role]), attendanceEnabled()]);
  if (!attOn && ATTENDANCE_PAGES.includes(active)) { location.replace('dashboard.html'); await new Promise(() => {}); }   // attendance is switched off
  const [feats, isS15, unread, avatarUrl] = await Promise.all([
    role === 'student' ? myFeatures() : null,
    role === 'student' ? isSuper15Member() : false,
    role === 'student' ? unreadCount() : 0,
    photo(me.student?.photo_path || me.photo_path)
  ]);
  const items = NAVS[role].filter(n => (!n.feature || !feats || feats.has(n.feature)) && (!n.super15 || isS15) && (attOn || !ATTENDANCE_PAGES.includes(n.href)));
  const learn = role === 'student' ? LEARN.filter(([h]) => items.some(i => i.href === h)) : [];
  const first = (me.full_name || '').split(' ')[0];

  const theme = localStorage.getItem('bcc-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.body.innerHTML = `
  <div class="app">
    <div class="nav-scrim" id="navScrim"></div>
    <aside class="sidebar" id="sidebar"><button class="nav-close" id="navClose" aria-label="Close menu"><i class="fa-solid fa-xmark"></i></button>
      <a class="brand" href="dashboard.html"><img src="${ROOT}bcc-assets/logo.png" alt="BCC logo"><div><b>BRILLIANT<br>COACHING CENTRE</b></div></a>
      <ul class="nav">${items.map((n, i) => `${i === 0 || n.group !== items[i - 1].group ? `<li class="nav-group">${n.group}</li>` : ''}<li><a href="${n.href}" class="${n.href === active ? 'active' : ''}"><i class="fa-solid ${n.icon}"></i>${esc(n.label)}</a></li>`).join('')}
        <li><a href="#" id="logoutBtn"><i class="fa-solid fa-right-from-bracket"></i>Logout</a></li></ul>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="top-left">
          <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>
          <h1>${role === 'student' && active === 'dashboard.html' ? `${greet()}, ${esc(first)}` : esc(title)}${role === 'student' && active === 'dashboard.html' ? `<small>${fmtDate()}</small>` : ''}</h1>
        </div>
        <div class="top-actions">
          <button class="icon-btn" id="themeBtn" aria-label="Switch light or dark mode"><i class="fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}"></i></button>
          ${role === 'student' ? `<a class="icon-btn" href="announcements.html?tab=notifications" aria-label="Notifications"><i class="fa-regular fa-bell"></i>${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</a>` : ''}
          <button class="chip" id="chipBtn" aria-haspopup="menu" aria-label="Accounts and profile">
            ${avatarUrl ? `<img class="avatar" src="${avatarUrl}" alt="">` : `<span class="avatar">${esc(initials(me.full_name))}</span>`}
            <div><b>${esc(me.full_name)}</b><small>${role === 'student' ? esc(me.student?.class_no > 0 ? 'Class ' + me.student.class_no : '') + (me.student?.roll_number ? ' · Roll ' + esc(me.student.roll_number) : '') : role[0].toUpperCase() + role.slice(1)}</small></div></button>
        </div>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>
  ${learn.length ? `<div class="scrim hidden" id="scrim"></div><div class="fab"><nav class="fab-menu closed" id="fabMenu">${learn.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</nav><button class="fab-main" id="fabBtn" aria-expanded="false"><i class="fa-solid fa-graduation-cap"></i>Learn</button></div>` : ''}`;

  $('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('bcc-theme', t);
    $('#themeBtn i').className = 'fa-solid ' + (t === 'dark' ? 'fa-sun' : 'fa-moon'); };
  const menu = document.createElement('div'); menu.className = 'acct-menu hidden'; document.body.append(menu);
  const drawMenu = () => { const list = accounts(), cur = currentId() || me.id;
    menu.innerHTML = `<div class="acct-title">Accounts on this device</div>${list.map(a => `<button class="acct-row" data-id="${a.id}"><span class="avatar">${esc(initials(a.name))}</span><span class="acct-meta"><b>${esc(a.name)}</b><small>${esc(a.role)}${a.classNo != null && a.role === 'student' ? ' · ' + (a.classNo > 0 ? 'Class ' + a.classNo : ({ '-3': 'Nursery', '-2': 'LKG', '-1': 'UKG' })[a.classNo]) : ''}</small></span>${a.id === cur ? '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i>' : ''}</button>`).join('')}
      <hr><a class="acct-link" href="${ROOT}index.html?add=1"><i class="fa-solid fa-plus"></i>Add account</a>${role === 'student' ? '<a class="acct-link" href="profile.html"><i class="fa-regular fa-user"></i>My profile</a><a class="acct-link" href="settings.html#devices"><i class="fa-solid fa-mobile-screen"></i>Active devices</a>' : ''}<button class="acct-link" id="acctOut"><i class="fa-solid fa-right-from-bracket"></i>Log out this account</button>`;
    menu.querySelectorAll('.acct-row').forEach(b => b.onclick = async () => { if (b.dataset.id === cur) return menu.classList.add('hidden'); try { const e = await switchTo(b.dataset.id); location.replace(HOME[e.role]); } catch (err) { alert(err.message); location.reload(); } });
    menu.querySelector('#acctOut').onclick = logout;
    const r = $('#chipBtn').getBoundingClientRect(); menu.style.top = (r.bottom + 8) + 'px'; menu.style.right = Math.max(8, innerWidth - r.right) + 'px'; menu.classList.remove('hidden'); };
  const chip = $('#chipBtn'); let pressTimer, long = false;
  chip.onclick = () => { if (long) { long = false; return; } menu.classList.contains('hidden') ? drawMenu() : menu.classList.add('hidden'); };
  chip.addEventListener('pointerdown', () => { long = false; pressTimer = setTimeout(() => { long = true; drawMenu(); navigator.vibrate?.(15); }, 450); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => chip.addEventListener(ev, () => clearTimeout(pressTimer)));
  chip.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('click', e => { if (!menu.contains(e.target) && !chip.contains(e.target)) menu.classList.add('hidden'); });
  const notice = sessionStorage.getItem('bcc-notice'); if (notice) { sessionStorage.removeItem('bcc-notice'); toast(notice); }
  $('#logoutBtn').onclick = e => { e.preventDefault(); logout(); };
  const nav = open => { $('#sidebar').classList.toggle('open', open); $('#navScrim').classList.toggle('show', open); };
  $('#menuBtn').onclick = () => nav(!$('#sidebar').classList.contains('open'));
  $('#navScrim').onclick = $('#navClose').onclick = () => nav(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') nav(false); });
  $('#sidebar').querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => nav(false)));
  if (learn.length) {
    const set = open => { $('#fabMenu').classList.toggle('closed', !open); $('#scrim').classList.toggle('hidden', !open); $('#fabBtn').setAttribute('aria-expanded', open); };
    $('#fabBtn').onclick = () => set($('#fabMenu').classList.contains('closed'));
    $('#scrim').onclick = () => set(false);
  }
  if (role === 'student' && feats.has('results')) import('./result-popup.js').then(m => m.maybeShowResultPopup(me)).catch(() => {});
  return { me, content: $('#content'), features: feats };
}
