// Web push for BCC (Firebase Cloud Messaging). Must live at the site root. Values are public.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
// Values copied from js/config.js (public web-app settings):
firebase.initializeApp({ apiKey: 'AIzaSyC79oTlFu6dSL8rHao7Qby-VRAsS9DZEY0', authDomain: 'brilliant-coaching-centr-ef15b.firebaseapp.com', projectId: 'brilliant-coaching-centr-ef15b', storageBucket: 'brilliant-coaching-centr-ef15b.firebasestorage.app', messagingSenderId: '927417717695', appId: '1:927417717695:web:2b97fc8e05d5f491cec70a' });
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {}; const link = (payload.data && payload.data.link) || '/';
  self.registration.showNotification(n.title || 'BCC', { body: n.body || '', icon: '/android-chrome-192x192.png', badge: '/favicon-96x96.png', data: { link } });
});
self.addEventListener('notificationclick', e => { e.notification.close(); const link = (e.notification.data && e.notification.data.link) || '/'; e.waitUntil(clients.openWindow(link)); });
