// BCC SETUP. Everything here is PUBLIC (it ships to every browser). Real secrets never go in this file:
// service-account keys and passwords stay on your computer / in Firebase. Security comes from Firestore rules + Cloud Functions.
// Copy the values from: Firebase console > Project settings > General > Your apps > Web app > SDK setup and configuration.
export const CONFIG = {
  FIREBASE: {
    apiKey: "AIzaSyC79oTlFu6dSL8rHao7Qby-VRAsS9DZEY0",
    authDomain: "brilliant-coaching-centr-ef15b.firebaseapp.com",
    projectId: "brilliant-coaching-centr-ef15b",
    storageBucket: "brilliant-coaching-centr-ef15b.firebasestorage.app",
    messagingSenderId: "927417717695",
    appId: "1:927417717695:web:2b97fc8e05d5f491cec70a",
  },
  FUNCTIONS_REGION: "asia-south1",
  VAPID_KEY: "BNUSON9vCA2mvYJtp0S6veM1pZVEHVzSmhSAJRICGEVziUjQaYZ9PgNQ1TQJCH8MSjPus7hchwjttqFe4JNavyY",                                 // Firebase console > Project settings > Cloud Messaging > Web Push certificates > key pair (public key)
  APP_CHECK_SITE_KEY: "",                       // reCAPTCHA v3 site key (free); leave empty until App Check is set up (docs/SETUP.md)
  AUTH_EMAIL_DOMAIN: "students.bcc-portal.invalid", // internal namespace only, not a real mailbox. Must match functions/.env
  ADMIN_EMAIL: "zaq00850@gmail.com",     // typing the ID  ADMIN  on the Teacher card signs in this account (same email you gave bootstrap.js)
  CENTRE_NAME: "Brilliant Coaching Centre",
  CENTRE_SHORT: "BCC",
  CENTRE_ADDRESS: "Kairi Birpur",
};
