# BCC Firebase architecture: audit, design and FINAL ARCHITECTURE (updated 2026-11-07)

## FINAL ARCHITECTURE (as built)
Services: Firebase Authentication (email/password; accounts created only by the admin function), Cloud Firestore `(default)` in asia-south1, Cloud Functions 2nd gen Node 20 in asia-south1 (**79 functions** in `functions/lib/*.js`, 4 scheduled), Cloud Storage for images and uploaded documents, Cloud Messaging (web push + Android topics), App Check (reCAPTCHA v3, optional until configured), Firebase Hosting or GitHub Pages for the static site. YouTube remains the host of lecture videos and live streams.

How the pieces fit: the browser reads Firestore directly only for data the rules allow (own profile, class content, own results, precomputed leaderboards). Everything that changes money, marks, attendance, quizzes, roles, sessions, file metadata or notifications goes through a Cloud Function that re-checks the caller's role, class and login session on the server. Roles live in custom claims, written only by functions. Full collection and Storage layout: `FIRESTORE_STRUCTURE.md`. Business-rule changes: `CHANGES.md`. Status, limits and tests: `STATUS.md`, `TEST_REPORT.md`.

### Cost estimate (ESTIMATE ONLY: no usage has been measured)
Assumptions: each student opens the app 10 times a day (5,000 / 10,000 / 20,000 openings a day); about 20 Firestore reads per opening (dashboard cached 10 minutes, class settings cached 5 minutes, pages read small precomputed documents); about 6 writes per student per day; 3 function calls per opening; photos 100 KB per student; about 400 notes/homework files a year of 2 MB; each student downloads about 20 MB of files a month. Unit prices assumed (verify for asia-south1 on Google's pricing pages): Firestore reads US$0.06 per 100,000 beyond the free 50,000 a day, writes US$0.18 per 100,000 beyond 20,000 a day, Storage US$0.03 per GB-month, file downloads US$0.12 per GB (conservative; part may be free), 4 scheduler jobs about US$0.30.

| | 500 students | 1,000 students | 2,000 students |
|---|---|---|---|
| Firestore reads a month (after free quota) | about 1.5 M, US$0.90 | about 4.5 M, US$2.70 | about 10.5 M, US$6.30 |
| Firestore writes | inside free quota | inside free quota | inside free quota (about 12,000 a day) |
| Cloud Functions (calls, compute) | inside free tier | inside free tier | about US$0 to 1 |
| Scheduler (4 jobs) | about US$0.30 | about US$0.30 | about US$0.30 |
| Storage (photos + documents, year 1) | about US$0.2 | about US$0.3 | about US$0.5 |
| File downloads (about 10 / 20 / 40 GB a month) | about US$1.2 | about US$2.4 | about US$4.8 |
| **Rough total a month** | **US$2 to 4** | **US$5 to 8** | **US$10 to 16** |

What can push this up: pages that read many documents, listeners left open, rules that call `get()` (each is a billed read), people re-downloading large PDFs, a bug that loops, App Check with reCAPTCHA **Enterprise** (use the free v3 provider), very large photos. Budget alerts in Google Cloud do **not** stop spending. Measure real reads in the Firebase console during the first week and update this table.

---

## Part 2. Original audit of the Supabase backend and the proposal (Phase 1 and 2)

(This section is the original Phase 1 audit and proposal, kept for the record. The built system is described in FINAL ARCHITECTURE above; where they differ, FINAL ARCHITECTURE and `CHANGES.md` win.)

---

## 0. What was inspected, and how deeply

| Area | Depth |
|---|---|
| Project layout, config, README, setup guide PDF | read fully |
| `js/core/*` (auth, accounts, storage, cache, permissions), `js/shared/api.js`, print pages and `cover.js`, `css/print.css` | read fully |
| 4 Edge Functions (`admin-create-user`, `start-quiz`, `submit-quiz`, `attempt-result`) | read fully |
| SQL files 01-30 | table list, function list, policy count extracted for all; read in detail: 18 (attendance), 19 (fees), 21 (grade-sheet engine), 26 (sessions), 27 (live-lecture reminders), 30 (content sources), 16 (security fixes) |
| 60 frontend files that call Supabase | full inventory of every table / RPC / storage / auth / realtime call (section 2.2); page-level logic read only where noted above |
| **Not yet read line by line** | SQL 01-15, 17, 20, 22-25, 28, 29 bodies (leaderboards, meetings, Super 15, alumni, promotion, dashboard RPC, quiz history). Each will be read in full during the module that migrates it. |
| **Not in the ZIP** | the **Android app** (README says "separate project"). Only the website was provided. |

## 1. Report-card cover (done)

* New design from `ReportCard1.pdf` replaces `bcc-assets/cover-bg.jpg` (rendered at 300 dpi, 3509x2484, A4 landscape, 730 KB).
* Layout is identical to the old cover, so the printed fields (session, name, roll, class in `css/print.css` `.cv .ses/.nm/.rl/.cl`) were left untouched.
* The PDF had "ACADEMIC SESSION 2026-27" baked in. The code prints each student's real session on top, so the baked text was removed from the artwork (otherwise it would print twice).
* Verified: rendered image inspected. **Not verified**: a live print from the browser, because the print pages need a signed-in Supabase/Firebase session. Please print one cover and check that name/roll/class sit on the lines.
* Files changed: `bcc-assets/cover-bg.jpg` only.

## 2. Audit of the current Supabase backend

### 2.1 Stack
Static site (HTML + ES modules, GitHub Pages), Supabase Auth + Postgres + Storage + 4 Edge Functions + pg_cron. Three portals (student, teacher, admin) plus a public home page.

### 2.2 Inventory
* **45+ tables**, **~89 SQL functions/RPCs/triggers**, **139 `create policy` statements**, 30 migration files (several are fix-on-fix: 09-13 leaderboard, 15-16 security).
* **41 tables / 37 distinct RPCs** are called from the frontend.
* **Storage buckets:** `bcc-content` (private), `student-photos` (private), `answer-sheets` (private), `site-public` (public).
* **Realtime:** 5 channels (meeting participants, notifications, meetings, Super 15 chat, class discussion).
* **Auth:** email+password. Student ID `26BCC1001` becomes `26bcc1001@students.bcc-portal.invalid`. Teacher signs in with email. Admin types `ADMIN`.
* **Multi-account switcher** (`accounts.js`): up to 5 accounts per device, switching by `setSession(access, refresh tokens)` stored in `localStorage`.

### 2.3 Business rules that must be preserved exactly
1. **Marks and ranks** (`bcc_gradesheets_core`): only declared exams count; per-exam % = obtained/full; ranks by **percentage first, then marks; ties share a rank (1,1,3)**; cumulative rank across exams; a student's "included subjects" list handles skipped subjects (Urdu); grade and remark from the editable `grade_rules` table; attendance counted up to the exam's cut-off date; conduct grades (O/S/N); archived exams excluded.
2. **Attendance:** one record per student per date, saving again replaces, `null` removes, no future dates, teacher limited to assigned classes.
3. **Fees:** structure per class/session -> monthly invoices (unique per student+period+category, so no duplicates) -> payments with sequential receipt numbers `R-1001...` -> payment items. Per-student overrides/exemptions. Admin only; teachers have no fee access. Opening a QR never marks anything paid.
4. **Quiz security (already server-side, good):** `start-quiz` creates one session per student per quiz with a server expiry (min of duration and quiz end); `submit-quiz` re-checks class, grades on the server, allows 15 s grace, rejects late manual submits, refuses a second attempt. Correct answers never reach the browser until after submission.
5. **Sessions:** 2 web + 2 app per student and admin, **1 + 1 for teachers** (file 26). A new login replaces the oldest of that platform.
6. **Live lectures:** statuses recorded/scheduled/live/ended/cancelled; notifications for scheduled, rescheduled, cancelled, live and "starts in 10 minutes", each sent once (de-duplication key).
7. Class feature switches (18 features) per class, enforced in SQL via `has_feature()`.
8. Classes Nursery(-3), LKG(-2), UKG(-1), 1-12; sessions; promotion; Student ID format `YY BCC CC RR`.

### 2.4 Gaps between the requirements and what the ZIP actually contains
| # | Requirement you listed | What the code does today | Action |
|---|---|---|---|
| G1 | Auto-submit quiz on tab switch / blur / new tab | **Not implemented.** `quiz-player.js` only prompts on leaving (`beforeunload`) and auto-submits on Back and on time-up. | New feature. Will add `visibilitychange` + `blur`-based submit, and explicitly **not** react to screen lock/inactivity. Note: on phones, switching apps and locking the screen both fire `visibilitychange`; they cannot be told apart reliably, so mobile needs a rule (see decision D5). |
| G2 | Parent accounts | **No parent role exists.** Guide says a parent simply shares the student login (2 sessions). | New feature: needs your decision (D1). |
| G3 | Teachers 2 sessions per portal | Code gives teachers **1 web + 1 app**. | Business-rule change; I will implement 2 only if you confirm (D4). |
| G4 | Files private and role-checked | Google Drive / OneDrive items are stored as **plain share links** and shown with `drive.google.com/.../preview`. Anyone with the link can open them. | Needs a backend proxy; has cost implications (D2). |
| G5 | Push notifications (FCM) | **None exist.** Only an in-app `app_notifications` list plus realtime. | New feature (web push + Android). |
| G6 | "Publish individual subject results" | I found only exam-level `result_declared`. Not yet confirmed in the unread SQL. | Will confirm in the marks module and report before building. |
| G7 | Alumni, Super 15, discussions, AI Study Hub, timetable, holidays, board toppers, faculty, answer sheets, print settings | Exist and must keep working, but are not in your list. | Included in the migration. |
| G8 | Direct video upload | Lectures can still be **uploaded** into Supabase Storage. Your rule says YouTube/Drive/OneDrive only. | Upload option will be removed from the lecture form; confirm (D3). |

### 2.5 Security and quality findings in the current code
1. `accounts.js` stores **access + refresh tokens of up to 5 accounts in `localStorage`**: any XSS steals every account. Firebase cannot do this the same way (see 3.6).
2. Edge Functions send `Access-Control-Allow-Origin: *`; `submit-quiz` accepts the access token in the request body (for `sendBeacon`).
3. Google Drive/OneDrive/YouTube links are not access-controlled (G4). Unlisted YouTube links can be shared by any student.
4. Login identifies by guessable IDs; the only brute-force protection is Supabase's own. No App Check / CAPTCHA.
5. `config.js` still has `ADMIN_EMAIL: "PUT-YOUR-ADMIN-EMAIL-HERE"`: admin login cannot work until edited.
6. `_shared/common.ts` is copy-pasted inside `start-quiz` and `submit-quiz` (duplicated code).
7. Migrations 09-13 and 15-16 are repeated patches; the final state of several functions depends on run order.
8. The setup guide itself says the SQL, edge functions and scheduler were **never run against a real Supabase** ("first real test"). So the current backend's behaviour is partly unproven.
9. `legacy-ai-tutor.js` (5,600+ lines) has no backend calls; untouched by the migration.

## 3. Proposed Firebase architecture

### 3.1 Services
Firebase Auth, Firestore (Standard, `(default)` database so the free quota applies), Cloud Functions 2nd gen (Node 20, TypeScript, region `asia-south1`), Cloud Scheduler, FCM, App Check (reCAPTCHA Enterprise on web; Play Integrity on Android). Firebase Hosting or GitHub Pages for the static site. Firebase Storage **only** for small images (see D2).

### 3.2 Authentication and roles
* Firebase UID is the permanent id (`users/{uid}`).
* Student login keeps the same `id@students.bcc-portal.invalid` mapping, so the login card does not change.
* **Role and class live in custom claims**, set only by Cloud Functions: `{role, classNo}` for students, `{role, classes:[10,12]}` for teachers (fits the 1000-byte limit). Rules read claims, so most reads need **no extra lookup**.
* A mirror `users/{uid}` document holds name, loginId, isActive, photo path. Claims change on promotion/assignment, and the function also revokes refresh tokens so the new claims apply.
* Public sign-up disabled; accounts created only by the `adminCreateUser` function.

### 3.3 Firestore structure
Design rules: one deterministic document ID wherever duplicates must be impossible; growing history in subcollections; staff-only data separated from student-readable data (rules cannot hide single fields).

```
users/{uid}                         role, name, loginId, isActive, photoPath, lastNotifSeenAt
students/{uid}                      classNo, roll, admissionNo, status, enrolled sessions
students/{uid}/private/profile      phone, father, mother, dob, address   (self + staff only)
profileCards/{uid}                  name, photo, class, goal, dedication   (same-class students read)
classes/{classNo}                   label, order, isActive, classTeacher, features{18 switches}
sessions/{sessionId}                label, startsOn, isCurrent
subjects/{id}                       classNo, name
teachers/{uid}                      details, assignments[{classNo,isClassTeacher,canDeclare}]

lectures/{id}  notes/{id}  homework/{id}   classNo, subjectId, sourceType, ref (id/link), status, scheduledAt,
                                           audience {classNo | studentIds[]}, reminder flags
lectures/{id}/comments/{cid}

quizzes/{quizId}                    meta (class, window, duration, total marks)
quizzes/{quizId}/questions/{qid}    text, options, CORRECT OPTION, marks   (staff only)
quizSessions/{quizId_uid}           server-only; expiry, status          (deterministic id = one session)
quizzes/{quizId}/attempts/{uid}     score, counts, answers, reason       (deterministic id = one attempt)
leaderboards/{scope}                ranked array, rebuilt by function (one read per view)

exams/{examId}                      class, session, name, order, isFinal, declared, subjects[{id,name,fm}]
exams/{examId}/marks/{uid}          marks map, includedSubjects          (staff only)
results/{examId}/students/{uid}     precomputed fm, om, %, rank, cumulative, grade, remark, attendance
gradeRules/{id}  conduct/{sess_uid}  printSettings/main

attendance/{classNo_YYYY-MM-DD}     map uid -> P/A/L                     (staff only, authoritative)
students/{uid}/attendance/{YYYY-MM} derived monthly map                  (student can read own)

feeStructures/{id}  feeOverrides/{sess_uid_cat}
students/{uid}/invoices/{period_category}   deterministic id = no duplicate invoices
students/{uid}/payments/{receiptNo}         receipt R-1001... from counters/receipt (transaction)
students/{uid}/finance/summary              billed, paid, pending, updated in the same transaction
counters/receipt

notifications/{id}                  audience (all | class | user), kind, title, ref, dedupKey
users/{uid}/sessions/{sid}          platform, label, createdAt, revokedAt
meetings/{id}  meetings/{id}/participants/{uid}  meetings/{id}/invitees/{uid}
alumni/{id}  super15/{members,materials,messages}  discussions/{classNo}/messages/{id}
announcements, holidays, timetable, aiHubResources, answerSheets (metadata), site/{faculty,toppers,hero}
```

### 3.4 Cloud Functions (all callable, App Check enforced, role verified from the token)
`adminCreateUser`, `adminSetStatus`, `adminResetPassword` (re-verifies admin password), `setTeacherClasses`, `promoteClass`, `saveAttendance`, `saveMarks`/`correctMarks`, `declareResult`/`recalculateExam`, `archiveExam`, `generateInvoices`, `recordPayment`, `startQuiz`, `submitQuiz`, `getAttemptResult`, `rebuildLeaderboards` (scheduled), `registerSession`, `revokeSession`, `getProtectedFile` (Drive/OneDrive proxy), `sendNotification`, `processReminders` (scheduled every minute), `onLectureWrite` / `onMeetingWrite` triggers.
Every function validates input shape and range, and writes an audit entry for admin actions.

### 3.5 Security rules approach
* Default deny. Students: read only own `students/{uid}`, own results/attendance/invoices/payments, content where `resource.data.classNo == request.auth.token.classNo`, same-class `profileCards`. **No client write** to marks, results, attendance, fees, quizzes attempts, roles, sessions.
* Teachers: read their classes via the `classes` claim; writes go through functions.
* Admin: `role == 'admin'` claim.
* `get()`/`exists()` inside rules are **billed as reads**, so rules use claims wherever possible. Class feature switches are checked in functions and, for fees/marks/results only, in rules.
* Rules tests for every collection above will run in the Emulator.

### 3.6 Two things Firebase cannot do the way Supabase did
1. **Per-device session revocation.** Firebase can revoke *all* refresh tokens of a user, not one device. Design: after password sign-in the client calls `registerSession`, which stores the session and returns a **custom token carrying a `sid` claim**. Functions (and rules for fees/marks) reject a revoked `sid`; the client also listens to its own session document and signs out immediately. Residual risk: a revoked device holding a copied token can still read **non-sensitive** data for up to the token lifetime (about 1 hour).
2. **Multi-account switcher.** The JS SDK keeps one signed-in user per app instance. Design: one named Firebase app instance per account slot (max 5), each with its own persisted auth. No tokens copied into `localStorage` by our code (removes finding 2.5-1). Needs browser testing.

### 3.7 Files
* **YouTube:** store video ID only; embed. Unlisted links are not truly private; honest limit.
* **Drive / OneDrive:** store file ID. `getProtectedFile` checks role and class, then streams the file using a service account that has access to a private folder. Files are not shared publicly.
* **Cost risk:** the proxy's bandwidth is paid by you. Cap size (PDF/JPG up to a few MB), add caching headers, and watch usage (D2).
* **Profile photos, answer-sheet scans, fee QR, signatures, toppers/hero/faculty images** are small images: proposal is Firebase Storage with security rules (pennies per month), compressed in the browser as `storage.js` already does.

### 3.8 Leaderboards, notifications, reminders
* Quiz submit writes the attempt only. Leaderboards are rebuilt by a scheduled function when marked dirty (avoids the ~1 write/second limit on a single document when a whole class submits at once). Own rank is highlighted by finding the logged-in uid in the ranked array.
* Notifications: one document per notification with an audience; FCM topics per class; unread count from `lastNotifSeenAt` (single timestamp instead of a row per notification, see D6).
* Reminders: Cloud Scheduler every minute -> `processReminders` queries scheduled lectures/meetings starting within 10 minutes with `reminderSent == false`; sends FCM + notification once. "Goes live" is sent from the status-change trigger.
* Real-time listeners kept only for meeting participants, notifications badge and the two chats, each scoped to one class/document.

### 3.9 Cost estimate (Firestore, assumptions stated; prices from Google's pricing page: 50,000 reads and 20,000 writes per day free, about $0.03 per 100,000 reads and $0.09 per 100,000 writes beyond that; I will confirm the Mumbai row before launch)
* 5,000 openings/day. With caching and one-document dashboards, assume 12-30 reads per opening: 60,000-150,000 reads/day.
* Billed reads: about 10,000-100,000/day = 0.3-3 M/month = **about $0.10-$1.00**.
* Writes (attendance, marks, quiz attempts, notifications): well under the free 20,000/day on most days.
* Cloud Functions: scheduler job every minute is about 43,000 invocations/month (free tier is 2 M); Blaze plan required.
* **Expected total about $1-5/month**, well under the $10 target, **if** the Drive proxy and push volume stay small.
* What can raise the bill: Drive/OneDrive proxy bandwidth (the main risk), listeners left open, rules that use `get()`, queries without pagination, reading whole classes on every open, App Check/reCAPTCHA Enterprise above its free tier, and a burst from a bug. Budget alerts do **not** stop spending.

## 4. Decisions I need from you before building (Phase 3-4)
* **D1 Parents.** Separate parent logins linked to children (new feature), or keep today's "parent uses the student login"?
* **D2 Files.** (a) OK to use Firebase Storage for small images (photos, answer-sheet scans, QR, signatures, site images)? (b) For Drive/OneDrive, accept a backend proxy and its bandwidth cost, or keep share links (not private)?
* **D3 Upload option.** Remove "upload a video file" from the lecture form (YouTube/Drive/OneDrive only)?
* **D4 Teacher sessions.** Raise from 1+1 to 2+2 as you wrote?
* **D5 Mobile tab-switch rule.** Browsers cannot tell "screen locked" from "switched app". Proposal: on phones, submit only after the page has been hidden longer than a short grace period (e.g. 20 s) *and* the hide was not a screen lock where the platform exposes it; on desktop, submit immediately. OK, or do you want a different rule?
* **D6 Notification read state.** Replace per-notification read rows with one "last seen" time. OK?
* **D7 Student cards.** Other students see goal/dedication of classmates in **their own class** only, or of all classes?
* **D8 Android app.** It was not in the ZIP. Send that project when you want the Android side migrated; the backend will be built to serve both.

## 5. Build order (each module: code, rules, emulator tests, then move on)
1. Project skeleton, Auth, claims, `adminCreateUser`, sessions, login/switcher.
2. Classes, sessions, subjects, students, teachers.
3. Attendance. 4. Marks, results, grade sheet/cover/print. 5. Fees and receipts.
6. Content (lectures, notes, homework, Drive proxy). 7. Quizzes, anti-cheat, leaderboards.
8. Meetings, notifications, FCM, reminders. 9. Alumni, Super 15, discussions, announcements, site content.
10. Full test report, setup and deployment guide, cost check.

## 6. Test status
**No Firebase test has been run.** The work environment used for this audit has no network access, so the Firebase Emulator Suite and npm packages cannot be installed here. Rules and function tests will be written with the code and must be run where the emulator can be installed (your machine or a network-enabled session). The test report will keep three separate lists: executed, reviewed-only, needs a physical device.
