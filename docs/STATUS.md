# BCC Firebase migration: STATUS (final checkpoint, 2026-11-07)

**Update 2026-11-10: a production audit was done (see AUDIT_FIX_REPORT.md): security, cache-isolation, index, mobile, performance and scaling fixes; 59 logic tests, 106 real-browser page loads, 12 browser flows and load simulations up to 5,000 students all pass; Firebase Emulator tests are written but NOT executed.**

**Headline: every page and feature of the original project now calls Firebase. No Supabase code remains. Nothing has been deployed, and nothing has been run against a real Firebase project, the emulator, a browser or a phone.** The code is ready for controlled pre-launch testing, not for launch. See `docs/TEST_REPORT.md` for exactly what was and was not tested.

## Migration checklist
| # | Feature | Backend (functions / rules) | Pages | State |
|---|---|---|---|---|
| 1 | Login, device sessions (2 web + 2 app), account switcher | registerSession, logoutSession, revokeMySession, touchSession | guest login, settings device list | Code done; logic tested locally; browser test pending |
| 2 | Students, teachers, admission, classes, subjects, sessions, promotion, faculty | adminUsers, updateStudent, updateTeacher, createAcademicSession, deleteSubject, promoteClass, facultySave/Delete | admin pages | Done; logic tested locally (promotion not tested) |
| 3 | Attendance (daily, summaries, low attendance, notices, holidays) | saveClassAttendance, attendanceSummary/Month, lowAttendance, attendanceNotice | staff, student, print, holidays | Done; logic tested locally |
| 4 | Marks, results, report cards, ranks, publish result, correction, archive, leaderboards | createExam, saveExamMarks, correctMarks, declareResult, archiveExam, getGradesheets, updateExamFullMarks | marks, student marks, print, popup, toppers | Done; logic tested locally |
| 5 | Fees (structure, dues, payments, receipts, adjustments, totals) | saveFeeStructure, generateInvoices, recordFeePayment, adjustInvoice, getFeeReceipts | admin fees, student fees, receipt print | Done; logic tested locally |
| 6 | Pictures: profile, faculty, toppers, alumni, fee QR | setProfilePhoto + storage.rules | all upload dialogs | Done; untested |
| 7 | Lectures (YouTube, live, reminders, comments) | saveContent, updateContent, deleteContent, lectureSetStatus, lectureReschedule, postLectureComment, processLectureReminders | staff content, student lectures | Done; reminders tested locally |
| 8 | Notes and homework (Firebase Storage files or Drive/OneDrive share links) | saveContent/updateContent/deleteContent + storage.rules | staff content, student notes/homework | Done; untested with real files |
| 9 | Answer sheets (private) | saveAnswerSheet, deleteAnswerSheet | staff + student pages | Done; untested |
| 10 | Quizzes, anti-cheating, history, latest + cumulative leaderboards | createQuiz, updateQuiz, saveQuestion, importQuestions, startQuiz, submitQuiz, getAttemptResult, processQuizBoards, studentMonitoring | staff quizzes, player, student quizzes/leaderboard, staff leaderboards | Done; scoring logic tested locally; tab-switch needs browser test |
| 11 | Meetings and invitations | createMeeting, meetingSetStatus, meetingReschedule, myMeetings, joinMeeting, leaveMeeting, processMeetingReminders | admin + student meetings | Done; invitation logic tested locally |
| 12 | Notifications + push (FCM) + announcements | notify helper, subscribePush, unsubscribePush, saveAnnouncement, processAnnouncements, markNotificationsSeen | announcements pages, settings switch | Done; once-only behaviour tested locally; push needs a device |
| 13 | Alumni | rules only (admin writes directly) | admin + student alumni | Done; untested |
| 14 | Super 15 (members, materials, chat, live classes) | super15AddMembers, saveSuper15Material, deleteSuper15Material, postDiscussionMessage | admin + student Super 15 | Done; untested |
| 15 | Discussions (class chat, lecture comments) | postDiscussionMessage, deleteLectureComment | staff + student | Done; untested |
| 16 | Dashboards (admin, teacher, student) | dashboardStats, studentDashboard (cached) | both dashboards | Done; untested |
| 17 | Public home page (toppers, hero, faculty) | public rules | index.html + guest-content.js | Done; untested |
| 18 | Parents | role, claims, rules and functions accept parents (attendance, fees, report cards, quiz results) | **no parent screens exist** | Backend only (see limitations) |
| 19 | Report-card cover | n/a | print/cover | New design in place; print not tested |
| 20 | Supabase removal | n/a | n/a | Done; verified by search |

## Remaining limitations and open items
1. **Not deployed, not tested on Firebase.** Run `npm run test:rules` and `npm run test:functions` (written, never executed) and follow the smoke-test list in `docs/SETUP.md`.
2. **Parents cannot log in yet.** The backend supports parent accounts (`adminUsers` with `type: 'parent'`), but the project has no parent pages and the login cards only admit students and teachers/admin. Needs your approval to add a parent card and pages.
3. **"FM Update" and "publish individual subject results" do not exist in the original screens.** The original has Save, automatic Completed status, Declare/Withdraw result for a whole exam, Correct, and Archive. `updateExamFullMarks` exists on the server but has no button. Per-subject publishing is not built. Tell me if you want either as new screens.
4. **Device sessions:** Firebase cannot cancel one device's token. A replaced browser is signed out at once through its live session document and is refused by every function and by the fees/marks rules, but could still read non-sensitive data for up to an hour if its page stayed open offline.
5. **Custom-claim persistence after token refresh** is the one Firebase behaviour I could not confirm without running it (see TEST_REPORT section 5).
6. **Private files:** notes and homework uploaded to Firebase, answer sheets and Super 15 files are opened through the SDK (rules checked each time; no shareable link) and need the one-time bucket CORS setting. Profile photos, alumni photos and the fee QR use download URLs (long unguessable links, not public listings). Public site images (faculty, toppers, hero) are public by design. Profile photos are readable by any signed-in user who knows the file name (`<uid>.jpg`); leaderboards expose classmates' photo paths. Tightening this needs signed URLs or a function proxy.
7. **YouTube, Google Drive and OneDrive links** cannot be made private; anyone with the link can open them (your decision D2b).
8. **Phones and quizzes:** per your D5 rule: screen kept awake, away 20 seconds or less is ignored, longer than 20 seconds submits on return; a manual power-button lock over 20 seconds looks the same to the browser and will submit. Hidden-page count and time are recorded for the teacher.
9. Teachers/students must sign in again after class changes or promotion (class lives in the login token).
10. Hindi/English quiz text, answer-sheet and homework behaviours were ported, not redesigned.
11. Android app was not part of the ZIP; the backend already accepts `platform: 'android'` sessions and FCM tokens.
12. Counts of reads/writes per page have not been measured; the cost estimate is an estimate (see the architecture document).

## Decisions D1 to D8 (confirmed by you, and how they are built)
D1 parents use the student login: works (backend parent role dormant). D2a small images in Firebase Storage: done. D2b Drive/OneDrive share links kept (not private): restored for lectures, notes, homework, Super 15; Firebase uploads for notes/homework stay private. D3 lecture sources YouTube / Drive / OneDrive, no video upload: done. D4 teachers 2+2: done, tested locally. D5 desktop immediate, phone 20-second rule with screen kept awake: done, needs real-phone test. D6 one last-seen time: done together with per-item read marks. D7 classmates' goal cards: the original has no such screen, so nothing to enable (new feature if wanted). D8 Android: compatible, see ANDROID_BACKEND_GUIDE.md.

## Connection to your Firebase project
js/config.js, firebase-messaging-sw.js, .firebaserc, functions/.env and cors.json already contain project `brilliant-coaching-centr-ef15b`, the web app settings and the web-push (VAPID) key. `ADMIN_EMAIL` in js/config.js is set to the administrator e-mail (2026-11-12); the Administrator role is added by `functions/scripts/bootstrap.js` (tested on a pre-existing user: role added, password kept). Everything else you must do is in `docs/SETUP.md` / `BCC-Firebase-Setup-Guide.pdf`.
