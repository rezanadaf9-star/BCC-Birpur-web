# Production audit: findings, fixes and remaining risks (2026-11-10)

Method: full code review of rules, functions and pages; then execution (logic tests, real-browser page loads and flows, load simulations, index-coverage checks). Findings below were fixed unless listed under "Remaining risks". "Verified by" says exactly what ran; "not executed" means the fix is written and reviewed but could not be run here.

## Security
| # | Finding | Fix | Files | Verified by |
|---|---|---|---|---|
| S1 | **Super 15 access only checked that a membership document existed.** A paused member (is_active false) could still read materials, the Super 15 chat and files through the database and storage rules (functions already checked is_active). | Rules now require `is_active == true` for materials, chat, meeting participants and Super 15 storage files. | firestore.rules, storage.rules | Logic test (functions refuse paused members: passed). Rule tests written, **not executed**. |
| S2 | **Cached data was not separated per student.** The stale-while-revalidate cache used keys without the person, so after switching accounts on one device the next student could briefly be shown the previous student's cached data. | Every cache entry is keyed by the signed-in uid; nothing is persisted before the person is known; the cache is wiped on login and account switch; feature, Super 15 and unread caches also per uid. | js/core/cache.js, permissions.js, notifications.js, auth.js, accounts.js, student-announcements.js | Browser flow "switch between two students": passed (positive test only). |
| S3 | Push token was stored per device, so after an account switch the next user shared the previous user's token registration. | Token stored per person. | js/core/push.js | Code review only. |
| S4 | Teachers could read other people's personal notifications (meeting invitations addressed to one student). | Rule: personal notifications readable only by the owner and the admin. | firestore.rules | Rule test written, **not executed**. |
| S5 | Closed device-session records accumulated forever. | Sessions closed for more than 30 days are deleted when someone logs in. | functions/lib/sessions.js | Logic test (sessions): passed. |
| S6 | Chat and comment endpoints could be flooded by one account. | Per-person limit (12 chat messages / 8 comments per 30 seconds per server instance). | functions/lib/common.js, community.js, content.js | Code review; limit is per instance, App Check is the second line. |
| S7 | Quiz questions are read at every start/submit; the answer key lived next to the public questions. | Questions and answers now live in one server-only document (`quiz_packs`) that clients cannot read; students receive questions without answers. | functions/lib/quizzes.js, firestore.rules (default deny) | Logic tests: start returns no answers; edits propagate: passed. Rule test written, not executed. |

## Bugs
| # | Finding | Fix | Verified by |
|---|---|---|---|
| B1 | **Missing composite indexes** for the student dashboard (lectures, notes, homework by class and date); the page would have failed on real Firestore. Found by the new index-coverage check during the browser run. | Three indexes added (46 in total). | Browser smoke: dashboard loads clean. |
| B2 | Lecture/notes form: the "Students may download" checkbox hid the **whole form** when switching to a Drive/OneDrive link (wrong container selected). Found by code review. | Correct container. | Browser flow "add a Google Drive lecture through the real form": passed. (Not reproduced before the fix.) |
| B3 | Phone layout: the tab row on the student Marks page overflowed the screen by 52 px at 390 px width. Measured in Chromium. | Row wraps (no change on desktop). | Re-measured: no overflow on any page, all roles. |
| B4 | Opening a quiz page without a quiz threw an unhandled error after showing the message. | Message stays, nothing else runs. | Browser smoke. |
| B5 | `app-icon.png`, referenced by the login window, did not exist in the original upload (broken image, HTTP 404). | Added a copy of the existing 192 px app icon under that name. | Browser smoke: no 404 left. Replace with your own icon if you prefer. |

## Performance and scaling (numbers are exact Firestore operation counts from the load simulation)
| # | Finding | Fix | Before | After |
|---|---|---|---|---|
| P1 | Leaderboard rebuild re-ran after every batch of 500 submissions and read every attempt each time. | One rebuild per quiz/class per run; markers read first; rebuild runs every 2 minutes; only needed fields are read. | 155,011 reads at 5,000 students (measured) | 20,001 reads (measured) |
| P2 | Starting/submitting a quiz read every question (one read each). | One pack document, cached 60 s per server instance; cap of 150 questions per quiz. | reads grew with the number of questions | 6 reads (start), 5 reads (submit) at 20 questions, constant |
| P3 | Attendance summary read two documents per month of the session. | Running per-session totals kept in the same transaction as each attendance save. | 19 reads (measured) | 5 reads (measured); equality with the month-by-month method is tested |
| P4 | One request per server instance (small CPU) would need thousands of instances for a rush. | 1 vCPU / 512 MiB with concurrency 40 (80 for the hot functions), maxInstances 100/200, optional `MIN_INSTANCES_HOT` for exam days. | n/a | configuration; autoscaling not measured |
| P5 | Class promotion revoked students' sessions one by one. | 10 at a time. | sequential | parallel (time not measured against real Auth) |
| P6 | A leaderboard document could exceed Firestore's 1 MB limit for very large classes. | Caps: 2,500 rows (quiz/class boards), 800 rows per exam leaderboard. | possible failure | capped (a class has far fewer) |

## Code quality
Repeated helpers (`istToday`, `classAccess`, `chunk`) moved into `functions/lib/common.js`; one consistent options object for functions; pack and attendance logic documented in file headers.

## Remaining risks (not fixed, or not verifiable here)
1. **Security rules have never been executed.** 54 rule tests are written; run them with the emulator before launch. Treat any failure as a blocker.
2. Real Firebase behaviour not confirmed: custom-claim persistence after token refresh; real latency; autoscaling; contention when thousands start one quiz in the same second (start quizzes in waves); Storage CORS.
3. Profile photos are readable by any signed-in person who knows the file name (`<uid>.jpg`; not guessable, not listed). Leaderboards expose classmates' photo paths. Fixing needs signed URLs or a proxy function.
4. Google Drive, OneDrive and YouTube links are not private (your decision D2b).
5. Phone quiz rule (approved D5): a manual power-button lock of more than 20 seconds cannot be told from an app switch, so that quiz will submit.
6. The per-person flood limit is per server instance, not global.
7. Parents have no screens. "FM update" button and per-subject publishing do not exist in the original screens.
8. Cost is an estimate until real usage is measured.
9. The tests of the browser pages used a stand-in SDK; the real Firebase SDK (version 10.14.1 from gstatic) has not run with these pages.
