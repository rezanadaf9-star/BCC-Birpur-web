'use strict';
// Lectures (YouTube links, scheduled live classes, Google Drive / OneDrive share links), notes and homework (PDF/JPG/PNG files in Firebase Storage, or Drive / OneDrive share links). Share links are NOT private (anyone with the link can open them): that was your decision D2(b).
//   lectures|notes|homework/{id}   class_no, subject_id, title, ..., created_by, created_at
//   files live in Storage at  bcc-content/{type}/{classNo}/{uuid}.{pdf|jpg|jpeg|png}  (file_path stores everything after "bcc-content/"; storage rules: only that class and its staff can read them)
//   lectures/{id}/comments/{id}    discussion under a lecture
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { admin, db, HttpsError, REGION, callOpts, throttle, nowIso, int, str, isoDate, bad, requireSession, audit, notify, classAccess } = require('./common');

const TYPES = ['lectures', 'notes', 'homework'];
const FILE_EXT = ['pdf', 'jpg', 'jpeg', 'png'], MAX_BYTES = 15 * 1024 * 1024;
const LINK_OK = { gdrive: /(drive|docs)\.google\.com/i, onedrive: /(onedrive\.live\.com|1drv\.ms|sharepoint\.com|onedrive\.com)/i };
const YT = /(?:youtu\.be\/|v=|embed\/|live\/|shorts\/)([A-Za-z0-9_-]{11})/;
const istText = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const istTime = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

const bucket = () => admin.storage().bucket();
/** The file must exist, be inside this class's folder, and be a PDF/JPG/PNG under 15 MB. Anything else is deleted. */
async function checkFile(path, type, classNo) {
  const prefix = `${type}/${classNo}/`;
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) throw bad('Invalid file.');
  const ext = path.split('.').pop().toLowerCase();
  const f = bucket().file(`bcc-content/${path}`); const [exists] = await f.exists();
  if (!exists) throw bad('The file was not uploaded. Please try again.');
  const [m] = await f.getMetadata();
  if (!FILE_EXT.includes(ext) || Number(m.size) > MAX_BYTES) { await f.delete().catch(() => {}); throw bad('Files must be PDF, JPG or PNG, up to 15 MB.'); }
  return { ext, size: Number(m.size) };
}
const dropFile = p => (p ? bucket().file(`bcc-content/${p}`).delete().catch(() => {}) : null);
const typeOf = v => { if (!TYPES.includes(v)) throw bad('Unknown content type.'); return v; };

exports.saveContent = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const b = request.data || {}; const type = typeOf(b.type), classNo = int(b.class_no, 'Class', { min: -3, max: 12 });
  if (!classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to add content for this class.');
  const sub = await db.doc(`subjects/${String(b.subject_id || '')}`).get();
  if (!sub.exists || sub.get('class_no') !== classNo) throw bad('Choose a subject of this class.');
  const row = { class_no: classNo, subject_id: sub.id, title: str(b.title, 'Title', { min: 1, max: 160 }), created_by: me.uid, created_at: nowIso() };
  const src = String(b.source || '');
  if (type === 'lectures') {
    if (!['youtube', 'live', 'gdrive', 'onedrive'].includes(src)) throw bad('Lectures use a YouTube link (recorded or live) or a Google Drive / OneDrive share link.');
    Object.assign(row, { description: str(b.description, 'Description', { max: 2000 }), source_type: src === 'live' ? 'youtube' : src, live_status: 'recorded', scheduled_at: null, downloadable: b.downloadable === true });
    if (src === 'youtube' || src === 'live') { if (!YT.test(String(b.youtube_url || ''))) throw bad('Paste a valid YouTube link.'); row.youtube_url = String(b.youtube_url).trim(); }
    else { const l = String(b.link_url || '').trim(); if (!/^https:\/\//i.test(l) || !LINK_OK[src].test(l)) throw bad(`That does not look like a ${src === 'gdrive' ? 'Google Drive' : 'OneDrive'} link.`); row.link_url = l; }
    if (src === 'live') { const t = Date.parse(b.scheduled_at); if (!t || t <= Date.now()) throw bad('Choose a start time in the future (India time).'); row.live_status = 'scheduled'; row.scheduled_at = new Date(t).toISOString(); }
  } else {
    if (!['upload', 'gdrive', 'onedrive'].includes(src)) throw bad('Upload a PDF, JPG or PNG file, or paste a Google Drive / OneDrive share link.');
    if (src === 'upload') { const f = await checkFile(b.file_path, type, classNo); Object.assign(row, { file_path: b.file_path, file_type: f.ext, file_size: f.size, source_type: 'upload' }); }
    else { const l = String(b.link_url || '').trim(); if (!/^https:\/\//i.test(l) || !LINK_OK[src].test(l)) throw bad(`That does not look like a ${src === 'gdrive' ? 'Google Drive' : 'OneDrive'} link.`); Object.assign(row, { link_url: l, source_type: src }); if (type === 'notes') row.file_type = 'link'; }
    if (type === 'homework') Object.assign(row, { instructions: str(b.instructions, 'Instructions', { max: 4000 }), due_date: isoDate(b.due_date, 'Due date') });
  }
  const ref = db.collection(type).doc(); await ref.set(row);
  const base = { classNo, ref_id: ref.id, ref_subject_id: sub.id, created_by: me.uid };
  if (type === 'lectures') await notify({ ...base, kind: row.live_status === 'scheduled' ? 'lecture' : 'lecture', title: row.live_status === 'scheduled' ? `Live class scheduled: ${row.title}` : `New lecture: ${row.title}`,
    body: row.live_status === 'scheduled' ? `Starts ${istText(row.scheduled_at)} IST` : null, link: `/student/lectures.html?lecture=${ref.id}`, dedupe: `${type}_${ref.id}_new` });
  else await notify({ ...base, kind: type === 'notes' ? 'note' : 'homework', title: `${type === 'notes' ? 'New notes' : 'New homework'}: ${row.title}`, link: `/student/${type}.html`, dedupe: `${type}_${ref.id}_new` });
  await audit(me.uid, `${type}_added`, ref.id, { classNo });
  return { id: ref.id };
});

/** Admin edits title/description/instructions/due date/YouTube link, and may replace the file (the old file is deleted). */
exports.updateContent = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const type = typeOf(b.type); const ref = db.doc(`${type}/${String(b.id || '')}`); const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Item not found.');
  const patch = { title: str(b.title, 'Title', { min: 1, max: 160 }), updated_at: nowIso() };
  if (type === 'lectures') { patch.description = str(b.description, 'Description', { max: 2000 }); if (b.youtube_url !== undefined && b.youtube_url !== '') { if (!YT.test(String(b.youtube_url))) throw bad('Paste a valid YouTube link.'); patch.youtube_url = String(b.youtube_url).trim(); } }
  if (b.link_url !== undefined && b.link_url !== '') { const k = s.get('source_type'); const l = String(b.link_url).trim(); if (!LINK_OK[k] || !/^https:\/\//i.test(l) || !LINK_OK[k].test(l)) throw bad('That does not look like a valid share link for this item.'); patch.link_url = l; }
  if (type === 'homework') { patch.instructions = str(b.instructions, 'Instructions', { max: 4000 }); patch.due_date = isoDate(b.due_date, 'Due date'); }
  let oldPath = null;
  if (b.file_path && type !== 'lectures') { const f = await checkFile(b.file_path, type, s.get('class_no')); oldPath = s.get('file_path'); Object.assign(patch, { file_path: b.file_path, file_type: f.ext, file_size: f.size }); }
  await ref.update(patch); if (oldPath && oldPath !== b.file_path) await dropFile(oldPath);
  await audit(me.uid, `${type}_edited`, ref.id, null); return { ok: true };
});

exports.deleteContent = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const b = request.data || {}; const type = typeOf(b.type); const ref = db.doc(`${type}/${String(b.id || '')}`); const s = await ref.get();
  if (!s.exists) return { ok: true };
  const path = s.get('file_path'); await db.recursiveDelete(ref); await dropFile(path);   // no orphan files, no orphan comments
  await audit(me.uid, `${type}_deleted`, ref.id, null); return { ok: true };
});

async function lectureFor(me, id) {
  const ref = db.doc(`lectures/${String(id || '')}`), s = await ref.get(); if (!s.exists) throw new HttpsError('not-found', 'Lecture not found.');
  if (!classAccess(me, s.get('class_no'))) throw new HttpsError('permission-denied', 'You are not allowed to manage this class.');
  return { ref, ...s.data(), id: s.id };
}
/** Go live / end live / cancel. Each notification is sent once, no matter how often the button is pressed. */
exports.lectureSetStatus = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin', 'teacher']);
  const st = String((request.data && request.data.status) || ''); if (!['live', 'ended', 'cancelled'].includes(st)) throw bad('Invalid status.');
  const l = await lectureFor(me, request.data.id);
  if (st === 'cancelled' && me.role !== 'admin') throw new HttpsError('permission-denied', 'Only the admin can cancel a class.');
  if (l.live_status === 'recorded') throw new HttpsError('failed-precondition', 'This is a recorded lecture.');
  await l.ref.update({ live_status: st, ...(st === 'live' ? { live_notified_at: nowIso() } : {}) });
  const base = { classNo: l.class_no, ref_id: l.id, ref_subject_id: l.subject_id };
  if (st === 'live') await notify({ ...base, kind: 'live', title: `Live now: ${l.title}`, body: 'Tap to join the live class.', link: `/student/lectures.html?lecture=${l.id}`, dedupe: `lecture_${l.id}_live` });
  if (st === 'cancelled') await notify({ ...base, kind: 'lecture', title: `Class cancelled: ${l.title}`, body: 'This live class has been cancelled.', link: '/student/lectures.html', dedupe: `lecture_${l.id}_cancel` });
  return { ok: true };
});
exports.lectureReschedule = onCall(callOpts, async request => {
  const me = await requireSession(request, ['admin']);
  const l = await lectureFor(me, request.data && request.data.id); const t = Date.parse(request.data.when);
  if (!t || t <= Date.now()) throw bad('Choose a start time in the future (India time).');
  const iso = new Date(t).toISOString();
  await l.ref.update({ scheduled_at: iso, live_status: 'scheduled', reminder_10_sent_at: null, live_notified_at: null });   // reminder is armed again
  await notify({ classNo: l.class_no, kind: 'lecture', title: `Class rescheduled: ${l.title}`, body: `New time: ${istText(iso)} IST`, ref_id: l.id, ref_subject_id: l.subject_id, link: `/student/lectures.html?lecture=${l.id}`, dedupe: `lecture_${l.id}_resched_${Math.floor(t / 1000)}` });
  return { ok: true };
});

/** A comment or reply under a lecture. Name and role come from the server, never from the browser. */
exports.postLectureComment = onCall(callOpts, async request => {
  const me = await requireSession(request, ['student', 'teacher', 'admin']); throttle(me.uid, 'comment', 8, 30000);
  const b = request.data || {}; const body = String(b.body || '').trim(); if (body.length < 1 || body.length > 500) throw bad('A comment must be 1 to 500 characters.');
  const l = await db.doc(`lectures/${String(b.lecture_id || '')}`).get(); if (!l.exists) throw new HttpsError('not-found', 'Lecture not found.');
  const classNo = l.get('class_no');
  if (me.role === 'student' ? me.token.classNo !== classNo : !classAccess(me, classNo)) throw new HttpsError('permission-denied', 'You are not allowed to comment here.');
  const u = await db.doc(`users/${me.uid}`).get();
  const ref = await db.collection(`lectures/${l.id}/comments`).add({ lecture_id: l.id, class_no: classNo, user_id: me.uid, author_name: u.get('full_name'), author_role: me.role, body, parent_id: b.parent_id ? String(b.parent_id) : null, created_at: nowIso() });
  return { id: ref.id };
});

/** Every minute: "starts in 10 minutes" for live classes. The flag is set in a transaction BEFORE sending, so a repeat run cannot send it twice. */
exports.processLectureReminders = onSchedule({ schedule: 'every 1 minutes', region: REGION, timeoutSeconds: 60, retryCount: 0 }, async () => {
  const now = Date.now();
  const due = await db.collection('lectures').where('live_status', '==', 'scheduled').where('reminder_10_sent_at', '==', null)
    .where('scheduled_at', '>', new Date(now).toISOString()).where('scheduled_at', '<=', new Date(now + 10 * 60e3).toISOString()).get();
  for (const d of due.docs) {
    const won = await db.runTransaction(async tx => { const s = await tx.get(d.ref); if (s.get('reminder_10_sent_at') || s.get('live_status') !== 'scheduled') return false; tx.update(d.ref, { reminder_10_sent_at: nowIso() }); return true; });
    if (!won) continue;
    const l = d.data();
    await notify({ classNo: l.class_no, kind: 'lecture', title: `Class starts in 10 minutes: ${l.title}`, body: `Starts at ${istTime(l.scheduled_at)} IST`, ref_id: d.id, ref_subject_id: l.subject_id, link: `/student/lectures.html?lecture=${d.id}`, dedupe: `lecture_${d.id}_r10_${Math.floor(Date.parse(l.scheduled_at) / 1000)}` });
  }
});
