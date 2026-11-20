# BCC Firebase: testing report (after the production audit)

Date: 2026-11-10. This report separates, without blurring, **what was executed**, **what could not be executed**, and **what needs a real Firebase project or a physical phone**. Nothing in section 1 was run against real Firebase.

**Environment limits that decided what could run:** no internet (so no Firebase Emulator, no Firebase project, no npm packages from the registry); Java 21 and a Chromium 153 browser (via Playwright) were available.

## How the executed tests work (read this to understand what they prove)
* **Cloud Functions logic:** the project's own `functions/lib/*.js` files run unchanged on an in-memory stand-in for Firestore, Auth, Messaging and Storage (`tests/local/fake-firebase.js`). The stand-in also checks that every query is covered by `firestore.indexes.json`, the way Firestore would. It does not enforce security rules, and it has no network latency or write contention.
* **Browser tests:** a real Chromium loads the real pages (`index.html`, `admin/`, `teacher/`, `student/`, `print/`). The Firebase web SDK is replaced by a small stand-in (`tests/browser/shim-core.js`) that sends every call to a local server running the same function code on the in-memory database. This tests the page code, the screens, the buttons and the flows. It does **not** test security rules or the real Firebase SDK.

## 1. Tests actually executed

### 1.1 Cloud Functions business logic: 59 of 59 passed
Run: `node tests/local/run.js`

| Feature | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| Device sessions | Three web logins by one student | first two allowed, third replaces the oldest | oldest revoked, 2 active | PASS |
| Device sessions | App logins counted separately from web | two app logins add no replacement | as expected | PASS |
| Device sessions | Session token carries role + session id | custom token includes bsid and role | as expected | PASS |
| Device sessions | Paused account / unknown platform | both refused | as expected | PASS |
| Device sessions | Privileged call without a registered session | unauthenticated | Session not registered. Please sign in again. | PASS |
| Device sessions | Revoked session cannot call functions | unauthenticated | as expected | PASS |
| Accounts | Admin creates a student | next free roll (05 after 01-04): ID 26BCC1005, claims set, enrollment created | as expected | PASS |
| Accounts | Student tries to create an account | permission-denied | You do not have permission for this action. | PASS |
| Accounts | Short password / inactive class | both refused | as expected | PASS |
| Accounts | Same roll number twice in one class and year | second attempt already-exists (Student ID is unique) | as expected | PASS |
| Accounts | Pause a student | disabled in Auth, sessions revoked, status paused | as expected | PASS |
| Accounts | Teacher class change forces new sign-in | claims updated, sessions revoked | as expected | PASS |
| Marks | Teacher of the class enters marks | saved; status decided by server | as expected | PASS |
| Marks | Marks above full marks / unknown subject | rejected | as expected | PASS |
| Marks | Draft marks block declaring | failed-precondition | as expected | PASS |
| Results | Teacher without declare right | permission-denied | You are not authorised to declare results for this class. | PASS |
| Results | Admin declares: totals, %, ranks (ties share a rank), Urdu skip | A,B rank 1 (84%); C rank 3 on FM 200 (65%); D rank 4 | A 84% r1, B r1, C 65% (FM 200) r3, D 48% r4 | PASS |
| Results | Grade from grading scale | A=A, C=B, D=D | as expected | PASS |
| Results | Declaring twice does not notify twice | one notification | as expected | PASS |
| Results | Leaderboard document built | rows for the declared exam | as expected | PASS |
| Marks | Marks locked after declaring | failed-precondition | This result is declared. Use “Correct” to change a mark. | PASS |
| Marks | Correction needs a reason; recalculates ranks | A moves alone to rank 1, B rank 2 | as expected | PASS |
| Results | Student reads only own report card through the function | own card returned | as expected | PASS |
| Results | Teacher of another class cannot print this class | permission-denied | You are not allowed to view these report cards. | PASS |
| Attendance | Future date | failed-precondition | Attendance cannot be marked for a future date. | PASS |
| Attendance | Mark a day, then save the same day again | one record per class per day; second save replaces | as expected | PASS |
| Attendance | Percentage and low-attendance list | B 100%, others 0%; threshold works | as expected | PASS |
| Attendance | Session totals equal the month-by-month count | both methods agree, also after an edit | as expected | PASS |
| Attendance | Teacher of another class | permission-denied | You are not allowed to mark attendance for this class. | PASS |
| Attendance | Student cannot see another student's attendance | permission-denied | You are not allowed to see this attendance. | PASS |
| Attendance | Notice number is stable | same number when printed again | as expected | PASS |
| Fees | Duplicate fee name for the class | already-exists | This fee already exists for the class. | PASS |
| Fees | Generate month twice | first creates dues, second creates none | 10 then 0 | PASS |
| Fees | One-time fee is not billed again next month | no second Admission fee | as expected | PASS |
| Fees | Partial payment | balance reduces, receipt R-1001 | as expected | PASS |
| Fees | Payment above what is due | failed-precondition, nothing changed | as expected | PASS |
| Fees | All-or-nothing: one bad line cancels the whole payment | no partial write | as expected | PASS |
| Fees | Second payment gets the next receipt number | R-1002 | as expected | PASS |
| Fees | Discount lower than what was paid | failed-precondition | The new total cannot be lower than the amount already paid. | PASS |
| Fees | Running totals | billed and paid totals match the ledger | as expected | PASS |
| Fees | Receipt lines | tuition fully paid, due 0 | as expected | PASS |
| Fees | Student cannot record a payment | permission-denied | You do not have permission for this action. | PASS |
| Quizzes | Total marks follow questions and marking scheme | 3 questions x 4 = 12 | as expected | PASS |
| Quizzes | Start returns questions WITHOUT answers | no correct_option / explanation | as expected | PASS |
| Quizzes | Class 10 quiz is closed to class 12 | permission-denied | This quiz is not for your class. | PASS |
| Quizzes | Server scores: 2 right, 1 wrong with −1 | score 7 (2×4 − 1) | as expected | PASS |
| Quizzes | Second submission / restart | both refused | as expected | PASS |
| Quizzes | Browser cannot choose its own score | extra fields ignored; score comes from answers | as expected | PASS |
| Quizzes | Late manual submission (after expiry + grace) | failed-precondition | as expected | PASS |
| Quizzes | Tab-switch submission is recorded with its reason | submission_reason tab-switch | as expected | PASS |
| Leaderboards | Quiz + cumulative boards built once from markers | A first (7), ranks shared on equal score | as expected | PASS |
| Quizzes | Student result with explanations after submission | correct answers revealed only now | as expected | PASS |
| Notifications | 10-minute reminder runs twice | exactly ONE notification | as expected | PASS |
| Notifications | "Go live" pressed twice | exactly ONE live notification, push sent once | as expected | PASS |
| Content | Drive / OneDrive share links accepted; wrong site rejected; video upload not offered | links saved, bad link refused, lecture upload refused | as expected | PASS |
| Meetings | Create for selected students; room name hidden | room stored apart; only invited student can join when live | as expected | PASS |
| Super 15 | Paused member cannot post, join or list; active member can | refused for paused, allowed for active | as expected | PASS |
| Quizzes | Quiz with more than 150 questions refused; edits refresh what students receive | cap enforced; edited question served | as expected | PASS |
| Notifications | Mark all as read stores one timestamp | last_notif_seen_at set | as expected | PASS |

### 1.2 Real-browser page loads: every page of every role
Chromium 153, desktop width 1280 px, then the same page re-measured at phone width 390 px. A page counts as clean when it produced no JavaScript error, no console error from our code, no failed backend call and no "undefined/NaN/[object Object]" text. One page is counted as not clean on purpose: `student/quiz.html` opened without choosing a quiz returns the server's "Quiz not found" (HTTP 400) and shows a message with a back link; that is the intended behaviour.

| Role | Pages loaded | Login | Pages with no console/page/backend error | Pages with sideways overflow at 390 px (after fix) |
|---|---|---|---|---|
| admin | 39 | login OK | 39 | 0 |
| teacher | 31 | login OK | 31 | 0 |
| student | 33 | login OK | 32 | 0 |

### 1.3 Real-browser functional flows: 12 of 12 passed
Run: `python3 tests/browser/run_flows.py`

| Feature | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| Login | Wrong password | message "Incorrect ID or password", stays on login page | Incorrect ID or password. | PASS |
| Login | Student ID on the Teacher card | refused with a clear message | Teachers sign in with their email address. | PASS |
| Login | Student signs in with Student ID | lands on student dashboard; dashboard shows the student name | as expected | PASS |
| Device sessions | Three browsers for one student (limit 2) | first browser signed out within seconds | oldest browser sent to the login page with #session-ended; the other two stay signed in | PASS |
| Quiz anti-cheat | Desktop: page hidden (tab switched) | submitted at once with reason tab-switch | auto-submitted (tab-switch), score 0/3, result screen shown | PASS |
| Quiz anti-cheat | Phone: 5 s away ignored, 30 s away submits on return (D5) | matches the approved rule | 5 s away ignored; 30 s away submitted on return (reason tab-switch-phone); hidden_count=2 | PASS |
| Quizzes | Answer, submit, leaderboard | server-scored attempt and leaderboard row | score 1/3 saved by the server; student shown on the leaderboard | PASS |
| Quizzes | Open the same quiz again | refused | second start refused: "You have already submitted this quiz." | PASS |
| Cache isolation | Switch between two students on one device | no cached data of the previous student remains | two accounts on one device; after each switch the other student's cached data is gone and the right student is shown | PASS |
| Admission | Admin admits a student through the real form | Student ID and password shown | admission created 26BCC1004; credentials shown to the admin | PASS |
| Lectures | Add a Google Drive lecture through the real form | saved and listed | form switches YouTube/Drive fields correctly; lecture saved and listed | PASS |
| Notes | Upload a PDF note | file stored, metadata saved, listed | PDF uploaded to storage, checked by the server, note listed | PASS |

Note: the cache-isolation flow was run only as a positive test (it passes with the fixed code); I did not re-run it against the old code as a negative control.

### 1.4 Load / stress simulation, 50 to 5,000 students
Run: `node tests/load/run_load.js 5000` (results in `tests/load/results.json`). Every student does a whole session at the same moment: log in (register device), dashboard, attendance summary, report card, start a 20-question quiz, submit it, see the result. Then the class leaderboards are rebuilt once.

| Students (all at once) | Wall time of the whole rush (in-memory CPU only) | Reads per student | Writes per student | Total reads | Total writes | Reads to declare a result for the class | Leaderboard rebuild: reads / time | Errors | Process memory MB |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 0.03 | 35 | 7 | 1750 | 350 | 257 | 201 / 2 ms | 0 | 62 |
| 100 | 0.04 | 35 | 7 | 3500 | 700 | 507 | 401 / 5 ms | 0 | 65 |
| 500 | 0.34 | 35 | 7 | 17500 | 3500 | 2507 | 2001 / 10 ms | 0 | 103 |
| 1000 | 0.71 | 35 | 7 | 35000 | 7000 | 5007 | 4001 / 36 ms | 0 | 122 |
| 2000 | 1.05 | 35 | 7 | 70000 | 14000 | 10007 | 8001 / 60 ms | 0 | 156 |
| 5000 | 3.03 | 35 | 7 | 175000 | 35000 | 25007 | 20001 / 150 ms | 0 | 267 |

| Operation (5,000 students) | Calls | CPU ms p50 | CPU ms p95 | CPU ms max | Reads per call | Writes per call |
|---|---|---|---|---|---|---|
| login (registerSession) | 5000 | 0.06 | 0.12 | 2.7 | 3 | 1 |
| student dashboard | 5000 | 0.11 | 0.35 | 3.2 | 11 | 1 |
| attendance summary | 5000 | 0.03 | 0.12 | 9.7 | 5 | 0 |
| own report card | 5000 | 0.02 | 0.06 | 1.7 | 3 | 0 |
| quiz start | 5000 | 0.05 | 0.1 | 1.6 | 6 | 1 |
| quiz submit | 5000 | 0.11 | 0.24 | 4 | 5 | 4 |
| quiz result | 5000 | 0.03 | 0.07 | 4.3 | 2 | 0 |

**How to read these numbers.** The reads/writes are exact counts of Firestore operations the real code issues, so they are valid inputs for cost and quota planning (about 35 reads and 7 writes per student per session of use). The times are CPU time of the logic on an in-memory database on one core: they show the code does no wasteful work and has no errors, memory leak or quadratic behaviour up to 5,000 students. They are **not** Firebase response times, and they do **not** include network latency, Cloud Run cold starts or autoscaling, or Firestore contention. Memory shown is the whole test process including the stand-in database.

### 1.5 Static checks executed
`node --check` syntax validation of every JavaScript file; JSON validation of `firebase.json`, `firestore.indexes.json`, `cors.json`; an import-graph check (every import in `js/` resolves); a check that every function the pages call exists in `functions/index.js`; structural lint of both rules files (balanced braces and parentheses); a project-wide search for Supabase (none outside docs).

## 2. Written but NOT executed (need the Firebase Emulator: Java 17 + `npm install`)
* `tests/rules/firestore.rules.test.js` (25 cases) and `tests/rules/rules-extended.test.js` (29 cases): security rules for Firestore and Storage, including Super 15 active-membership, fees, marks, quiz answers, notifications, answer sheets, class isolation, Storage uploads. Run: `npm run test:rules`.
* `functions/test/sessions-and-users.test.js` (9 cases): sessions and account creation through the real emulators. Run: `npm run test:functions`.
**Because of this, the security rules themselves are unverified by execution.** They were reviewed line by line and linted for structure only.

## 3. Needs a real Firebase project and/or a physical device (not done)
* Login with real Firebase Authentication, the 2+2 device limit with real tokens, and whether custom claims survive token refresh.
* Real Firestore latency, indexes (the stand-in checks index coverage but Firestore itself is the authority), write contention when thousands start a quiz in the same second (Firestore guidance is to ramp new keyspaces gradually: start quizzes in waves).
* Storage uploads and downloads with the bucket CORS setting; push notifications (FCM) on phones and browsers; App Check.
* Quiz behaviour on real phones (screen lock, app switch, Wake Lock support), Safari and Firefox, iOS home-screen web push.
* Printing the cover, report cards, receipts and attendance notices from a real browser and printer.
* Measured (not estimated) Firebase billing.
