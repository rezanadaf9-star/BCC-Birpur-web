# Firestore and Storage structure (final)

Conventions: field names keep the old snake_case; all times are ISO-8601 text in UTC; deterministic document ids wherever duplicates must be impossible; growing history is in subcollections, never in one document; students never read staff-only data (rules cannot hide single fields, so such data is in separate documents). "fn" = written only by Cloud Functions; "admin" = admin writes directly under rules.

| Path | Purpose | Who reads | Who writes |
|---|---|---|---|
| `users/{uid}` | profile; students carry `student{{class_no, roll_number, status, ...}}`, teachers `teacher{{assignments[]}}`, parents `parent{{children[]}}` | self, admin, teacher of the student's class | fn |
| `users/{uid}/sessions/{sid}` | login devices (revoked_at) | self | fn |
| `users/{uid}/enrollments/{sessionId}` | class per academic session | self, staff | fn |
| `users/{uid}/attendance/{YYYY-MM}` | the student's own month (days map) | self | fn |
| `users/{uid}/notif_reads/{id}`, `push_tokens`, `result_acks`, `cache/dashboard` | notification state, devices, popups, dashboard cache | self (reads) / none | self (reads) / fn |
| `login_ids/{id}`, `counters/{name}`, `audit_log/{id}`, `stats/fees`, `stats_cache/*` | server bookkeeping | none (audit: admin) | fn |
| `classes/{n}` | label, is_active, 18 feature switches | signed in | admin |
| `academic_sessions/{id}`, `subjects/{id}` | sessions, subjects per class | signed in | admin / fn |
| `attendance/{class}_{date}` | ONE doc per class per day (marks map) | none (fn) | fn |
| `class_attendance_days/{class}_{YYYY-MM}` | working days | none (fn) | fn |
| `attendance_reports/{uid}_{YYYY-MM}` | numbered notices | none | fn |
| `centre_holidays/{YYYY-MM-DD}` | holidays | signed in | admin |
| `exams/{id}` (+ `marks/{uid}`, `marks_audit/{id}`) | exam meta with embedded subjects; marks; corrections | class members / staff; marks and audit: staff | fn |
| `gradesheets/{session}_{uid}` | finished report card | the student, linked parent, staff | fn |
| `exam_leaderboards/{session}_{class}` | ranked rows per declared exam | class members, staff | fn |
| `grade_rules`, `print_settings`, `conduct` | grading scale, signatures, conduct grades | signed in / staff | admin |
| `fee_structures`, `fee_invoices`, `fee_payments`, `fee_once`, `fee_settings` | fees | admin; student/parent: own invoices and payments (session-checked) | fn (settings: admin) |
| `lectures`, `notes`, `homework` (+ `lectures/{id}/comments`) | content | class members (feature switch) / staff | fn |
| `answer_sheets/{id}` | private scans metadata | the student, linked parent, staff | fn |
| `notebooklm_resources`, `class_timetable` | AI hub links, timetable | class members / staff | admin (+ teachers create AI links) |
| `quizzes/{id}` (+ `questions`, `attempts/{uid}`) | quiz, questions with answers (staff only), one attempt per student | class members (meta), staff (questions), own attempt | fn |
| `quiz_sessions`, `quiz_totals`, `quiz_dirty` | server state | none | fn |
| `quiz_boards/{quizId}`, `class_boards/{class}` | precomputed leaderboards | class members, staff | fn |
| `meetings/{id}` (+ `invitees`, `participants`), `meeting_rooms/{id}` | meetings; room name is server-only | staff; participants: invited | fn |
| `notifications/{id}` | audience `['all']`, `['class_10']` or `['user_<uid>']` | audience | fn |
| `announcements/{id}` | notices | students of the target class, admin | fn |
| `alumni/{id}` | alumni | students (published), admin | admin |
| `super15_members/{uid}`, `super15_materials/{id}`, `discussion_messages/{id}` | Super 15 and chats | members/staff; chat: class or members | fn (members: admin toggles) |
| `site_toppers`, `site_faculty`, `site_hero` | public website content | everyone (published) | admin / fn |

## Storage (`storage.rules`)
| Path | Rule |
|---|---|
| `student-photos/{uid}.jpg` | signed-in read; owner or admin writes; images under 1 MB |
| `alumni-photos/*` | signed-in read; admin writes |
| `site-public/*` | public read; admin writes |
| `bcc-content/fees/*` | signed-in read; admin writes |
| `bcc-content/{notes|homework}/{class}/{file}` | that class's students and staff read; staff of the class upload (PDF/JPG/PNG, 15 MB); delete/replace by function only |
| `bcc-content/super15/*` | Super 15 members and staff read; staff upload |
| `answer-sheets/{studentId}/{file}` | the student, linked parent, admin, teacher of the student's class read; staff upload |
| everything else | denied |

Indexes: `firestore.indexes.json` (43 composite indexes + field overrides). Rules: `firestore.rules`.
