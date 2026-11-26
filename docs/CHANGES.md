# Complete change record (original BCC website ZIP versus this project)

Original upload preserved untouched: `files.zip` (contains `bcc-website.zip`).

## Added (44 files)
* `.firebaserc`
* `.github/workflows/firebase-backend.yml`
* `.github/workflows/pages.yml`
* `.gitignore`
* `cors.json`
* `docs/01_AUDIT_AND_FIREBASE_ARCHITECTURE.md`
* `docs/CHANGES.md`
* `docs/SETUP.md`
* `docs/STATUS.md`
* `docs/local-test-results.json`
* `firebase-messaging-sw.js`
* `firebase.json`
* `firestore.indexes.json`
* `firestore.rules`
* `functions/.env.example`
* `functions/index.js`
* `functions/lib/answers.js`
* `functions/lib/attendance.js`
* `functions/lib/classes.js`
* `functions/lib/common.js`
* `functions/lib/community.js`
* `functions/lib/content.js`
* `functions/lib/dashboard.js`
* `functions/lib/exams.js`
* `functions/lib/fees.js`
* `functions/lib/meetings.js`
* `functions/lib/notifications.js`
* `functions/lib/quizzes.js`
* `functions/lib/sessions.js`
* `functions/lib/users.js`
* `functions/package.json`
* `functions/scripts/bootstrap.js`
* `functions/test/sessions-and-users.test.js`
* `js/core/db.js`
* `js/core/firebase-client.js`
* `js/core/notifications.js`
* `js/core/push.js`
* `js/data/people.js`
* `package.json`
* `storage.rules`
* `tests/local/fake-firebase.js`
* `tests/local/results.json`
* `tests/local/run.js`
* `tests/rules/firestore.rules.test.js`

## Changed (62 files)
* `README.md`
* `bcc-assets/cover-bg.jpg`
* `js/config.js`
* `js/core/accounts.js`
* `js/core/auth.js`
* `js/core/permissions.js`
* `js/core/storage.js`
* `js/pages/admin-admission.js`
* `js/pages/admin-alumni.js`
* `js/pages/admin-announcements.js`
* `js/pages/admin-classes.js`
* `js/pages/admin-fees.js`
* `js/pages/admin-holidays.js`
* `js/pages/admin-meetings.js`
* `js/pages/admin-students.js`
* `js/pages/admin-super15.js`
* `js/pages/admin-teachers.js`
* `js/pages/admin-toppers.js`
* `js/pages/guest-content.js`
* `js/pages/quiz-player.js`
* `js/pages/staff-ai-hub.js`
* `js/pages/staff-answer-sheets.js`
* `js/pages/staff-attendance.js`
* `js/pages/staff-content.js`
* `js/pages/staff-dashboard.js`
* `js/pages/staff-discussions.js`
* `js/pages/staff-leaderboards.js`
* `js/pages/staff-marks.js`
* `js/pages/staff-print.js`
* `js/pages/staff-quizzes.js`
* `js/pages/staff-timetable.js`
* `js/pages/student-ai-hub.js`
* `js/pages/student-alumni.js`
* `js/pages/student-announcements.js`
* `js/pages/student-answer-sheets.js`
* `js/pages/student-attendance.js`
* `js/pages/student-board-results.js`
* `js/pages/student-dashboard.js`
* `js/pages/student-discussion.js`
* `js/pages/student-faculty.js`
* `js/pages/student-fees.js`
* `js/pages/student-leaderboard.js`
* `js/pages/student-lectures.js`
* `js/pages/student-marks.js`
* `js/pages/student-meeting.js`
* `js/pages/student-notes-homework.js`
* `js/pages/student-profile.js`
* `js/pages/student-quizzes.js`
* `js/pages/student-settings.js`
* `js/pages/student-super15.js`
* `js/pages/student-timetable.js`
* `js/print/attendance.js`
* `js/print/common.js`
* `js/print/cover.js`
* `js/print/gradesheet.js`
* `js/print/receipt.js`
* `js/shared/api.js`
* `js/shared/classes-ui.js`
* `js/shared/meeting.js`
* `js/shared/result-popup.js`
* `js/shared/shell.js`
* `js/shared/viewer.js`

## Removed (38 files; Supabase backend)
* `js/core/supabase-client.js`
* `supabase/config.toml`
* `supabase/functions/_shared/common.ts`
* `supabase/functions/admin-create-user/index.ts`
* `supabase/functions/attempt-result/index.ts`
* `supabase/functions/start-quiz/index.ts`
* `supabase/functions/submit-quiz/index.ts`
* `supabase/setup/01_scheme.sql`
* `supabase/setup/01b_teacher_base.sql`
* `supabase/setup/02_app_features.sql`
* `supabase/setup/03_app_features_2_replies.sql`
* `supabase/setup/04_academic_marks_migration.sql`
* `supabase/setup/05_photo_profile_migration.sql`
* `supabase/setup/06_bcc_device_session_management.sql`
* `supabase/setup/07_bcc_student_password_reset_audit.sql`
* `supabase/setup/08_bcc_marks_edit_archive_audit.sql`
* `supabase/setup/09_20260929210000_leaderboard_anti_cheat.sql`
* `supabase/setup/10_leaderboard_fix_and_upgrade.sql`
* `supabase/setup/11_leaderboard_photos_fix.sql`
* `supabase/setup/12_restore_get_quiz_leaderboard.sql`
* `supabase/setup/13_discussion_avatars_fix.sql`
* `supabase/setup/14_20261015000100_teacher_portal.sql`
* `supabase/setup/15_restore_original_arts_notebooklm.sql`
* `supabase/setup/16_security_fixes_2026_10_21.sql`
* `supabase/setup/17_classes_features_sessions.sql`
* `supabase/setup/18_attendance.sql`
* `supabase/setup/19_fees.sql`
* `supabase/setup/20_timetable_announcements_notifications.sql`
* `supabase/setup/21_exams_gradesheet.sql`
* `supabase/setup/22_dashboard_rpcs.sql`
* `supabase/setup/23_site_toppers_hero.sql`
* `supabase/setup/24_content_quiz_people.sql`
* `supabase/setup/25_meetings_super15_alumni.sql`
* `supabase/setup/26_sessions_two_per_platform.sql`
* `supabase/setup/27_scheduled_lectures_notifications.sql`
* `supabase/setup/28_meetings_audience_reminders.sql`
* `supabase/setup/29_leaderboard_attendance_report_hub.sql`
* `supabase/setup/30_content_sources_faculty.sql`

## Behaviour changes you should know about (nothing else in the business logic was changed)
1. Report-card cover artwork replaced by your new design (`bcc-assets/cover-bg.jpg`); the session text is still printed by the app.
2. Teachers may now be signed in on 2 browsers + 2 phones (was 1 + 1), as you asked.
3. Exams, content and quizzes now work for any class the admin activates (the old database limited them to Class 10 and 12).
4. Quiz wrong-answer penalty: the old screen stored "marks lost" as a plain number that was then ADDED to the score. Now the penalty is stored as a positive number and subtracted. Default stays: +1 for right, 0 for wrong.
5. Attendance percentage now defaults to the current academic session (was: all time, which mixed old classes after promotion).
6. Notification read state: each opened notification is remembered, and "Mark all as read" stores one time stamp.
7. Lectures: the "upload a video file" option was removed (YouTube, Google Drive and OneDrive links remain; your decisions D2 and D3). Notes and homework: uploads now go to Firebase Storage (PDF, JPG, PNG up to 15 MB, private to the class) and Drive / OneDrive share links remain (not private). Super 15 materials: file or link.
8. Pausing a student, resetting a password, changing a teacher's classes and promoting a class now sign the affected people out on every device.
9. A fee discount can no longer take a due below what was already paid; the server decides whether marks are Draft or Completed.
10. The quiz is auto-submitted when a desktop browser tab is left or loses focus. On phones (your decision D5) the screen is kept awake, a glance away of 20 seconds or less is ignored, and the quiz is submitted when the student returns after more than 20 seconds away; the teacher sees how often and how long the page was hidden. Limit: a manual power-button lock longer than 20 seconds cannot be told from an app switch.
11. Leaderboards and dashboards are precomputed: quiz boards refresh within about a minute of a submission, the staff dashboard is cached 5 minutes, the student dashboard 10 minutes.
12. The unused per-student fee override table was not carried over (no page ever used it).


## Update 2026-11-26: redesign, Events, attendance switch, email
1. **Welcome page redesigned** (index.html, style.css, script.js; login card styles moved unchanged to login.css). "Our Faculty" removed from the welcome page and its header; header is Home, About Us, Facilities, Results, Events, Contact. Leadership enlarged (Director left, Principal right).
2. **Events section** on the welcome page: cards with swipeable photo albums; first row 2 cards, then rows of 3. Managed in Admin > Website Events (collection `site_events`, images in Storage `site-public/events`). New Firestore rule for `site_events`.
3. **Attendance switch**: Admin > Portal Settings (`app_settings/features`) or `CONFIG.ATTENDANCE` in js/config.js ("panel" / "off" / "on"). Off by default. Hides the Attendance and Holidays pages, dashboard numbers, report-card rows, attendance notice. New Firestore rule for `app_settings`. Backend functions unchanged.
4. **Portal redesign** (css/theme.css, base.css, components.css; font Inter). Page logic unchanged. The live quiz screen uses frozen copies of the old CSS (css/quiz-frozen) and looks exactly as before.
5. **Contact email** is now bccbirpur@gmail.com (contact card, footer, mailto links).
6. **login-check.html**: step-by-step login diagnostic (see deploy guide). No login code was changed.

## Update 2026-11-26 (b): palette and text clean-up
- Exact palette applied to the welcome page and all portal pages: primary yellow #FFE600 (active items, key buttons), soft yellow #FFF9A6 (page background), deep navy #1B1464 (sidebar, headings), black / grey #555555 / #6B7280 text, green #16A34A, red #DC2626. (The deploy guide PDF still says "cream background": the background is now soft yellow.)
- Extra text removed: page subtitles on every portal page, sidebar tagline and motivational card, explanatory paragraphs and notes (fees, holidays, teachers, settings, marks, events, attendance switch), long form intros, and the longer welcome-page descriptions. Confirmation warnings that protect against mistakes (record payment, reset password, archive exam, import format) were kept.
