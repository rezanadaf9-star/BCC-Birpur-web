import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import * as FB from './firebase-client.js';
import { getMe } from './auth.js';
import { attendanceEnabled } from './flags.js';
/** Features the admin can switch on/off per class. Keys match the "features" map on classes/{classNo}. */
export const FEATURES = {
  lectures:'Lectures', notes:'Notes', homework:'Homework', marks:'Marks', attendance:'Attendance',
  quizzes:'Quizzes', quiz_leaderboard:'Quiz Leaderboard', results:'Results', fees:'Fees', timetable:'Timetable',
  answer_sheets:'Answer Sheets', announcements:'Announcements', ptm:'PTM', ai_tutor:'AI Tutor', ai_study_hub:'AI Study Hub',
  motivational:'Motivational Sessions', alumni:'Alumni', group_discussion:'Group Discussion',
};
/** Returns a Set of enabled feature keys for the signed-in student (cached 5 minutes: one read per class per visit). */
export async function myFeatures() { const set = await classFeatures(); if (!(await attendanceEnabled())) set.delete('attendance'); return set; }
async function classFeatures() {
  const me = await getMe(); const c = me?.student?.class_no; if (c == null) return new Set();
  const k = `bcc:${me.id}:feat:${c}`; try { const h = JSON.parse(sessionStorage.getItem(k) || 'null'); if (h && Date.now() - h.t < 300_000) return new Set(h.v); } catch {}
  try { const s = await getDoc(doc(FB.db, 'classes', String(c))); const f = (s.exists() && s.data().features) || {};
    const v = Object.keys(f).filter(x => f[x]); sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); return new Set(v); } catch { return new Set(); }
}
/** Is the signed-in student a Super 15 member? (cached 10 minutes) */
export async function isSuper15Member() {
  const me = await getMe(); if (!me || me.role !== 'student') return false;
  const k = `bcc:${me.id}:s15`; try { const h = JSON.parse(sessionStorage.getItem(k) || 'null'); if (h && Date.now() - h.t < 600_000) return h.v; } catch {}
  try { const s = await getDoc(doc(FB.db, 'super15_members', me.id)); const v = s.exists() && s.data().is_active !== false; sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); return v; } catch { return false; }
}
