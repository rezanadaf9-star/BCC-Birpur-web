# Brilliant Coaching Centre portal (Firebase edition)

The original BCC website and screens, with a Firebase backend: Authentication, Cloud Firestore, Cloud Functions, Cloud Storage, Cloud Messaging.

* **Start here:** `docs/SETUP.md` (project, deploy, GitHub) and `docs/STATUS.md` (what is done, what is not, what was tested).
* Design and cost: `docs/01_AUDIT_AND_FIREBASE_ARCHITECTURE.md`. Database layout: `docs/FIRESTORE_STRUCTURE.md`. Every change: `docs/CHANGES.md`. Tests: `docs/TEST_REPORT.md`.
* `student/`, `teacher/`, `admin/`: one small HTML file per page, logic in `js/pages/<name>.js`. `print/`: report card, receipts, attendance notices.
* `functions/`: Cloud Functions (all privileged work happens here). `firestore.rules`, `storage.rules`, `firestore.indexes.json`: security and indexes.
* `tests/local/run.js`: runs the business-logic tests with no installation (`node tests/local/run.js`).
