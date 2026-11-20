# Supabase removal verification (2026-11-07)

## What was removed
* `js/core/supabase-client.js` (the client and its keys) and the whole `supabase/` folder: 38 files (30 SQL setup files, 4 Edge Functions, shared helpers, notes). Their logic now lives in `functions/lib/*.js` and `firestore.rules`.
* Every `sb.from(...)`, `sb.rpc(...)`, `sb.auth...`, `sb.storage...`, `sb.channel(...)` call in `js/`.
* `SUPABASE_URL` / `SUPABASE_ANON_KEY` from `js/config.js`.

## Verification searches (case-insensitive, whole project, excluding the `docs/` folder)
1. `grep -rli supabase .` : **no matches** outside `docs/`.
2. `grep -rE "\bsb\.|createClient|sb\.(from|rpc|auth|storage|channel)" js/` : **no matches**.
3. Files that imported the old client: **0** (was 44 at the start of this phase).
4. External calls to `supabase.co` / `supabase.com` hosts: **none**.

## Remaining references (all documentation only, none active)
* `docs/01_AUDIT_AND_FIREBASE_ARCHITECTURE.md`, `docs/CHANGES.md`, `docs/STATUS.md`, `docs/SETUP.md`, `docs/TEST_REPORT.md` and this file mention Supabase only to describe the migration.
* The original upload (`files.zip`, outside this project) still contains the old Supabase code as your backup.

## Replacements (old to new)
| Old | New |
|---|---|
| Supabase Auth, JWT, 1+1/2+2 sessions table | Firebase Auth + custom claims + `registerSession` and session documents |
| Postgres tables and RLS (139 policies) | Firestore collections and `firestore.rules` |
| 89 SQL functions / RPCs | Cloud Functions in `functions/lib/*.js` (79 deployed functions) |
| 4 Edge Functions (`admin-create-user`, `start-quiz`, `submit-quiz`, `attempt-result`) | `adminUsers`, `startQuiz`, `submitQuiz`, `getAttemptResult` |
| Supabase Storage buckets (`bcc-content`, `student-photos`, `answer-sheets`, `site-public`) | Firebase Storage folders with the same names + `alumni-photos`, protected by `storage.rules` |
| `pg_cron` reminders | Cloud Scheduler (`processLectureReminders`, `processMeetingReminders`, `processAnnouncements`, `processQuizBoards`) |
| Realtime channels | Firestore `onSnapshot` on small, scoped queries (discussion, Super 15 chat, meeting participants, notification refresh) |
