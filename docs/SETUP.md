# BCC Firebase setup and go-live guide

Project ID `brilliant-coaching-centr-ef15b` · Region asia-south1 · Website https://rezanadaf9-star.github.io/bcc-kne/


## 1. Where things stand

Your Brilliant Coaching Centre website now runs entirely on Firebase. The screens, colours and pages are the original ones; only the backend connections were replaced. Everything below is written for someone doing this for the first time. Follow the steps in order.


### What is already done (by me, in the project ZIP)

| Item | State |
|---|---|
| Firebase project connected | Your web app keys, project ID (brilliant-coaching-centr-ef15b), messaging ID, app ID and the push-notification (VAPID) key are already filled into js/config.js, firebase-messaging-sw.js, .firebaserc and functions/.env. |
| Backend code | 79 Cloud Functions, Firestore security rules, Storage security rules and 46 database indexes are written and ready to deploy. A full security and performance audit has been done (see docs/AUDIT_FIX_REPORT.md). |
| All features migrated | Login and devices, students, teachers, classes, attendance, marks, results and report cards, fees and receipts, lectures, notes, homework, answer sheets, quizzes and leaderboards, meetings, notifications and push, alumni, Super 15, discussions, dashboards, public home page. |
| Supabase removed | No Supabase code or keys remain in the project (verified by search; see docs/SUPABASE_REMOVAL_REPORT.md). |
| Report card cover | Your new cover design is in place (bcc-assets/cover-bg.jpg). |
| GitHub publishing | A ready workflow publishes the website to GitHub Pages (.github/workflows/pages.yml). Your site address will be https://rezanadaf9-star.github.io/bcc-kne/ |
| Tests actually run | 59 business-logic tests, 106 page loads in a real Chromium browser (admin, teacher, student; desktop and phone width), 12 browser flows (login, 2-device limit, quiz tab-switch rule, cache isolation, admission, uploads) and load simulations for 50 to 5,000 students: all passed. NOT run: the Firebase Emulator and any real Firebase project (no internet here). See docs/TEST_REPORT.md. |
| Git repository | The project folder is already a git repository with its first commit, ready to push to a NEW GitHub repository (step 9). |


### What is NOT done yet (needs you)

* Nothing is deployed. No Firebase service is switched on yet: Blaze plan, Authentication, Firestore and Storage must be created in your Firebase console (steps 1 to 4 below).
* The Administrator role is not given yet: it is added by the script in step 8 (the e-mail is already set in the project).
* The code has never run against your real Firebase project, a browser or a phone. The first real test is your smoke test in step 11. Expect to fix small things; that is normal.
* App Check (extra protection) and a few optional hardening steps come after the first test.

> **Important.** I cannot deploy or publish anything for you. You need your own Google login for that, and you asked me not to publish without your approval.


## 2. Your decisions D1 to D8 and how each one is built

| # | Your answer | How it works now |
|---|---|---|
| D1 | Parents use the same student login | Works as is. A parent signs in on the Student card with the child's Student ID and password (2 browsers + 2 phones). A separate parent role exists in the backend but is switched off in the screens. |
| D2 (a) | Firebase Storage for small images | Done: profile photos, alumni photos, fee QR code, faculty/topper/hero images, answer-sheet scans (private) are in Firebase Storage. Notes and homework can also be uploaded there as PDF/JPG/PNG (private to the class). |
| D2 (b) | Keep Drive / OneDrive share links (not private) | Done: lectures, notes, homework and Super 15 materials accept Google Drive and OneDrive share links again. These links are NOT private: anyone who has the link can open the file. |
| D3 | Lecture form: YouTube / Drive / OneDrive only | Done: lecture sources are YouTube (recorded or scheduled live), Google Drive link, OneDrive link. The 'upload a video file' option is removed. |
| D4 | Teachers 2 + 2 sessions | Done and tested: student, teacher and admin can each be signed in on 2 browsers and 2 phones at once; the oldest login is replaced when a new one starts. |
| D5 | Mobile quiz rule | Done as you approved. Desktop: leaving the quiz tab, switching window or losing focus submits at once. Phone: the screen is kept awake during the quiz, a glance away of 20 seconds or less is ignored, and the quiz is submitted when the student returns after being away more than 20 seconds. Away-time is recorded for the teacher. Limit: if a student locks the phone with the power button for more than 20 seconds, the browser cannot tell that from switching apps, so the quiz will submit. Test on real phones. |
| D6 | One 'last seen' time for notifications | Done: 'Mark all as read' stores one time. Opening a single notification is still remembered separately, as in the original, so the unread count stays exact. |
| D7 | Classmates' goal/dedication cards (same class only) | The original website has no screen that shows classmates' goals; each student sees and edits only their own goal (Profile), and the admin sees them in Students. Nothing needs switching on. If you want a classmates' card screen, it is a new feature: tell me and I will add it, limited to the same class. |
| D8 | Android app later, same backend | Yes, it is compatible. The same Firebase project, functions, rules and data are used. Sessions from the app are counted separately (2 per person), push uses the same topics. See docs/ANDROID_BACKEND_GUIDE.md and section 5 of this guide. |


## 3. What you must do to make it live

> **Note.** Fast path (details follow): 1 Blaze plan, 2 Authentication, 3 Firestore, 4 Storage + CORS, 5 admin e-mail in js/config.js, 6 install Node + Firebase tools, 7 firebase deploy, 8 bootstrap the admin, 9 push to a NEW GitHub repository and enable Pages, 11 smoke test, 13 App Check. I cannot do these for you: they need your Google and GitHub logins.

> **Note.** Do the steps in order. Each step says WHERE to click and HOW to check that it worked. Total time: about 2 hours the first time.


### Step 1. Upgrade to the Blaze plan (pay-as-you-go) and set a budget alert

* Open https://console.firebase.google.com and open the project 'brilliant-coaching-centr'. At the bottom left you will see the plan name 'Spark'. Click Upgrade.
* Choose Blaze, create or choose a billing account and add a payment card. (Cloud Functions and Storage cannot be used on the free Spark plan.)
* Set a budget alert: open https://console.cloud.google.com/billing, choose Budgets & alerts, Create budget, amount 10 US dollars, alerts at 50%, 90% and 100%.

> **Important.** A budget alert only e-mails you. It does NOT stop spending. Look at Billing, Reports once a week in the first month.

Check: the plan name at the bottom left now says Blaze.


### Step 2. Turn on login (Authentication)

* Firebase console, Build, Authentication, Get started.
* Sign-in method, Email/Password, switch Enable ON (only the first switch; leave 'Email link' off), Save.
* Authentication, Settings, User actions: UNTICK 'Enable create (sign-up)'. This stops strangers from creating accounts. Accounts are created only by the admin inside the app.
* Authentication, Settings, Authorized domains, Add domain: rezanadaf9-star.github.io  (the web.app and firebaseapp.com domains are already listed).


### Step 3. Create the database (Firestore)

* Build, Firestore Database, Create database.
* Edition: Standard. Database ID: leave as (default). Location: asia-south1 (Mumbai). The location cannot be changed later.
* Start in Production mode, Create. (The real rules are deployed in step 7.)


### Step 4. Create file storage (Storage) and allow file viewing

* Build, Storage, Get started, Production mode, Location asia-south1, Done.
* One-time setting so that private notes, homework and answer sheets can open in the website: open https://console.cloud.google.com, click the Cloud Shell icon (the >_ button at top right). In the Cloud Shell window click the three dots, Upload, and upload the file cors.json from the project folder. Then run this command:

```
gcloud storage buckets update gs://brilliant-coaching-centr-ef15b.firebasestorage.app --cors-file=cors.json
```

Check: the command prints 'Updating gs://...'. If the command is not found, use: gsutil cors set cors.json gs://brilliant-coaching-centr-ef15b.firebasestorage.app


### Step 5. The administrator e-mail address (already set in the project)

* Your administrator e-mail zaq00850@gmail.com is already written into js/config.js (ADMIN_EMAIL). Nothing to edit. If you ever change the admin e-mail, change that one line and step 8 must be run again with the new address.
* You already created this user in Firebase Authentication. That alone does NOT make the person an administrator: the role is given by step 8 (it adds the admin role to the account). Until step 8 is done, login will be refused.
* How the admin signs in: on the website's Teacher card, type ADMIN as the ID and the password you set for this user in Firebase Authentication. (Teachers type their own e-mail.)


### Step 6. Install the tools on your computer (one time)

* Node.js version 20 LTS from https://nodejs.org (the installer is enough).
* Git from https://git-scm.com (needed only to publish on GitHub).
* Open a terminal (Windows: PowerShell; Mac: Terminal) and run:

```
npm install -g firebase-tools
firebase login
```

A browser opens: sign in with the same Google account that owns the Firebase project.


### Step 7. Deploy the backend (rules, indexes, functions)

* Unzip bcc-firebase-project.zip. In the terminal go into the folder (cd path/to/bcc-firebase).
* Run the three commands below. The first deploy takes 5 to 10 minutes.

```
cd functions
npm install
cd ..
firebase deploy --only firestore,storage,functions
```

* If it asks to enable Google APIs (Cloud Build, Artifact Registry, Cloud Scheduler, Eventarc...), answer Y.
* If the first attempt stops with a permission message, wait 3 minutes and run the same deploy command again.
* Indexes build in the background: Firestore Database, Indexes tab; wait until every row says Enabled (a few minutes).

Check: Firebase console, Functions, shows about 79 functions in region asia-south1; Firestore, Rules tab, shows the new rules.

> **Note.** Busy days: for exam days or live quizzes, set MIN_INSTANCES_HOT=1 (or 2) in functions/.env and run the deploy for functions again; this keeps one server warm for logins and quizzes (small extra cost). Set it back to 0 afterwards. Also give students a few minutes to start a quiz instead of all in the same second.


### Step 8. Give the account the Administrator role and create the starting data

* Firebase console, Project settings (gear icon), Service accounts, Generate new private key. A .json file downloads. This file is a master key: keep it only on your computer, never put it on GitHub, never send it to anyone.
* In the terminal (inside the project folder) run the commands for your computer, replacing only the path of the key file and typing your own password at the end:

```
Windows PowerShell:
  cd functions
  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\bcc-key.json"
  node scripts/bootstrap.js zaq00850@gmail.com "YOUR-ADMIN-PASSWORD"

Mac / Linux:
  cd functions
  export GOOGLE_APPLICATION_CREDENTIALS=/Users/me/keys/bcc-key.json
  node scripts/bootstrap.js zaq00850@gmail.com "YOUR-ADMIN-PASSWORD"
```

* Because you already created this user in Firebase Authentication, the script finds it by e-mail, KEEPS the password you set there (the password in the command is used only when the account does not exist yet) and adds the Administrator role to it.
* It also creates classes Nursery to 12 (Class 10 and 12 switched on), the 2026-27 session, the grading scale and the website faculty list. It is safe to run twice.
* When it prints 'Admin ready', delete the key file from your computer (or store it offline). Then sign in on the website: Teacher card, ID ADMIN, your password.

> **Note.** The administrator password is never stored in the project and is not written in this guide. Because it was typed in a chat message, change it after the first login (Firebase console, Authentication, Users, the three dots, Reset password) and use a new one.


### Step 9. Create a NEW GitHub repository and put the website online

* The project folder is already a git repository with its first commit. Open a terminal inside it (cd path/to/bcc-firebase) and check:

```
git status
git log --oneline
```

* Option A (GitHub CLI, one command; install from https://cli.github.com):

```
gh auth login
gh repo create bcc-portal --public --source=. --remote=origin --push
```

* Option B (no CLI): on github.com click New repository, name it bcc-portal, leave 'Add a README' unticked, Create. Then run (use your GitHub user name):

```
git remote add origin https://github.com/rezanadaf9-star/bcc-portal.git
git branch -M main
git push -u origin main
```

* Use a PUBLIC repository: GitHub Pages is free only for public repositories. This is safe: the project contains no secrets (the Firebase web keys are public by design; the service-account key is never in the project and is blocked by .gitignore).
* On GitHub: repository, Settings, Pages, Build and deployment, Source: GitHub Actions. Then open the Actions tab and wait for the green tick on 'Deploy website to GitHub Pages' (1 to 2 minutes).
* Your site address will be https://rezanadaf9-star.github.io/bcc-portal/  (if you named the repository differently, use that name). The address without the folder name, https://rezanadaf9-star.github.io, is what step 2 and the CORS file already allow, so nothing else needs changing.
* Alternative without GitHub: run  firebase deploy --only hosting  and use https://brilliant-coaching-centr-ef15b.web.app
* Later updates: change files, then  git add -A  /  git commit -m "message"  /  git push. The website updates by itself. Backend changes (functions, rules) still need  firebase deploy  (step 7).

> **Note.** The Firebase web keys in js/config.js are public by design (every website shows them). Security comes from the rules and functions, not from hiding these keys.


### Step 10. Optional but recommended: restrict the web API key

* https://console.cloud.google.com, APIs & Services, Credentials, open the 'Browser key' for the project.
* Application restrictions: Websites. Add: https://rezanadaf9-star.github.io/*, https://brilliant-coaching-centr-ef15b.web.app/*, https://brilliant-coaching-centr-ef15b.firebaseapp.com/*, http://localhost/*.
* Save. (The admin-password check inside the server already sends a matching website address, so it keeps working.)


### Step 11. Smoke test: try every area once with test data

| # | Do this | Expected |
|---|---|---|
| 1 | Open your site, Teacher card, ID ADMIN, admin password | Admin dashboard opens |
| 2 | Classes: check Class 10 and 12 are active; add subjects to each | Subjects listed |
| 3 | Admission: admit a test student in Class 10 | A Student ID like 26BCC1001 and a password are shown once. Write them down. |
| 4 | Student card: sign in with that ID on two browsers, then a third | The first browser is signed out when the third signs in |
| 5 | Attendance: mark today; student opens Attendance | Student sees Present/Absent and percentage |
| 6 | Examinations: create an exam; Marks: enter marks, Save, then Declare result | Student sees marks, percentage and rank only after declaring |
| 7 | Print: open a Report Card for the class | New cover design prints with the name, roll and class on the lines |
| 8 | Fees: add a fee, generate dues, record a part payment | Receipt number R-1001; student sees the balance |
| 9 | Notes: upload a PDF; student opens it | PDF opens (if it does not, repeat the CORS command in step 4) |
| 10 | Lectures: add a YouTube link; schedule a live class 15 minutes ahead | Student notified; reminder 10 minutes before; once only |
| 11 | Quizzes: create a quiz with 3 questions; student starts it on a computer and opens another tab | Quiz auto-submits when the tab is left |
| 12 | Student Settings: turn on notifications on a phone (see step 12) | A test announcement arrives as a notification |
| 13 | Meetings: create a PTM for one student | Only that student sees and can join it |


### Step 12. Phone notifications

* Students open Settings and press 'Turn on notifications', then Allow.
* Android phones: works in Chrome. iPhones: iOS 16.4 or newer, and the website must first be added to the Home Screen (Share, Add to Home Screen), then opened from that icon.
* The push key (VAPID) is already set in js/config.js.


### Step 13. App Check (extra protection): do this only AFTER the smoke test passes

* Go to https://www.google.com/recaptcha/admin and register a reCAPTCHA v3 site with domains rezanadaf9-star.github.io and brilliant-coaching-centr-ef15b.web.app. Copy the Site key and the Secret key. (v3 is free; do not use 'Enterprise', it is paid.)
* Firebase console, App Check, Apps, your web app, reCAPTCHA v3: paste the Secret key, Save.
* In js/config.js put the Site key in APP_CHECK_SITE_KEY, publish the website again (step 9) and test everything once more.
* App Check, APIs: choose Cloud Firestore, Cloud Storage, then Enforce. In functions/.env change ENFORCE_APP_CHECK=false to true and run  firebase deploy --only functions.

> **Important.** If you enforce App Check before the website sends the key, nobody can log in. Always test first, enforce last.


### Step 14. Optional: run the automated tests yourself

```
node tests/local/run.js          (no installation; 59 tests; already passed here)
npm install                       (project root; needs Java 17 for the next two)
npm run test:rules                (54 rule tests; written, never run)
npm run test:functions

Browser tests (need Python + Playwright):  python3 tests/browser/run_browser.py student
                                           python3 tests/browser/run_flows.py
Load simulation:                           node tests/load/run_load.js 1000
```

The two npm run test commands were written but have never been run (they need the Firebase Emulator). Run them once before inviting students and tell me any failure.


### Step 15. Before real students use it

* Change the admin password; create the teachers (Teachers page) and set their classes.
* Class features: Classes, Manage, switch on only what each class should see.
* Admit students (Admission) and give each family the Student ID and password.
* Keep your original files.zip safe as a backup. Check Billing, Reports each week; check Firestore, Usage for reads.


## 4. Quick reference

| Item | Value |
|---|---|
| Firebase project ID | brilliant-coaching-centr-ef15b |
| Region (functions, database, storage) | asia-south1 (Mumbai) |
| Storage bucket | brilliant-coaching-centr-ef15b.firebasestorage.app |
| Website address | https://rezanadaf9-star.github.io/bcc-kne/ |
| Admin e-mail | zaq00850@gmail.com (already set in js/config.js) |
| Admin sign-in | Teacher card, ID ADMIN, the password of this user in Firebase Authentication |
| Student sign-in | Student card, Student ID such as 26BCC1001 (year, BCC, class, roll) |
| Teacher sign-in | Teacher card, the teacher's own e-mail |
| Where secrets live | Only in the service-account key on your computer. Nothing secret is in the project. |
| Device limit | 2 browsers + 2 phones per person, counted separately |
| Files | private: answer sheets, Firebase-uploaded notes/homework. Not private: Drive/OneDrive/YouTube links, public site images. |


## 5. Using the same backend for the Android app later

* Register an Android app in the same Firebase project (Project settings, Add app, Android) with its package name and SHA-1/SHA-256 keys; download google-services.json.
* The app signs in with e-mail and password, then calls the function registerSession with platform 'android' and signs in with the returned token (same flow as the website).
* Push: the app sends its FCM token to the function subscribePush; the server subscribes it to the same class topics.
* Details: docs/ANDROID_BACKEND_GUIDE.md.


## 6. Troubleshooting

| You see | Meaning / fix |
|---|---|
| Login says 'Incorrect ID or password' for ADMIN | Step 8 was not run yet (the account has no Administrator role), or the password is not the one set in Firebase Authentication. Run step 8; if needed reset the password in Firebase console, Authentication, Users. |
| auth/operation-not-allowed or 'Incorrect ID or password' for a new admin | Email/Password sign-in is not enabled (step 2) or bootstrap was not run (step 8). |
| 'The query requires an index' with a link | Open the link and press Create, or wait until the Indexes tab shows Enabled (step 7), then retry. |
| Missing or insufficient permissions | The rules are not deployed yet, or the person is in the wrong class. Run the deploy command again. |
| A function says not found / blocked by CORS | Functions are not deployed in asia-south1, or your website address is missing from ALLOWED_ORIGINS in functions/.env. Fix and redeploy functions. |
| Notes or answer sheets do not open | The storage CORS command in step 4 was not run for your site address. |
| Deploy says billing account required | Blaze upgrade (step 1) is not finished. |
| Push notifications do not arrive | Student pressed Turn on notifications? Phone allowed notifications? iPhone: opened from the Home Screen icon? |
| Everybody is signed out after turning on App Check | Enforcement was switched on before the site key was in js/config.js. Turn enforcement off, fix, test, enforce again. |


## 7. Limits you should know about

* Google Drive, OneDrive and YouTube links are not private; anyone with a link can open them. Use the Upload option for private notes and homework.
* Parents currently share the student login; there are no parent screens.
* The original screens have no 'FM update' button and no per-subject publishing; results are declared for a whole exam. The server can update full marks (updateExamFullMarks) if you want a button.
* A student signed in on an old browser is signed out immediately, but if that browser stayed open offline it could still show cached pages for up to an hour.
* Teachers and students must sign in again after class changes or promotion.
* Profile photos use long unguessable web addresses; they are not listed publicly but are not locked per viewer.
* Cost is an estimate (about US$2 to 4 a month at 500 students, 5 to 8 at 1,000, 10 to 16 at 2,000). Real usage must be watched in the first weeks.
* Load tests ran on an in-memory copy of the backend logic: they prove the operations scale (about 35 reads and 7 writes per student for a whole study session; no errors up to 5,000 simultaneous students) but they do NOT measure real Firebase speed. If 5,000 students start one quiz in the same second, Firestore may slow some of them; start quizzes in waves.
* Super 15 now needs an ACTIVE membership everywhere (database rules, file rules, chat, meetings). Paused members lose access immediately.
