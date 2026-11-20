# Using the same Firebase backend from the Android app (answer to D8: yes, it is compatible)

Nothing in the backend is web-only. When you build the app later, it connects to the SAME Firebase project (`brilliant-coaching-centr-ef15b`) and uses the same functions, rules and data.

1. Firebase console, Project settings, Your apps, Add app, Android: enter the package name, add the SHA-1 and SHA-256 of your signing key, download `google-services.json`.
2. Use the Firebase Android SDK (Auth, Firestore, Functions with region `asia-south1`, Storage, Messaging).
3. Login flow (identical to the website): sign in with email and password, call the function `registerSession` with `platform: "android"`, then sign in again with the returned custom token. The server allows 2 web + 2 app sessions per person, counted separately. Watch the document `users/{uid}/sessions/{sessionId}` (the `bsid` claim in the token is the session id) and sign out when `revoked_at` is set.
4. Student IDs map to email `<id lowercase>@students.bcc-portal.invalid`; teachers use their own email; the admin uses the email set at bootstrap.
5. Push: get the FCM token and call `subscribePush` with `platform: "android"`; the server subscribes the device to the topics `all` and `class_<n>`.
6. Call the same functions by name (`startQuiz`, `submitQuiz`, `getGradesheets`, ...). Documents keep the same field names the website uses.
7. Files: notes, homework, answer sheets and Super 15 files are read through the Storage SDK (the rules check the signed-in user every time). Do not use public links for private files.
8. App Check for Android: use the Play Integrity provider.
9. Quiz rule on the phone: keep the screen awake during a quiz (`FLAG_KEEP_SCREEN_ON`); the Android app can detect real app switching (`onPause`/`onStop`) far more reliably than a browser, so the 20-second rule can be tightened there.
