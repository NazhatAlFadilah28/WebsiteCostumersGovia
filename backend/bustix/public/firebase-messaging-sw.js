/* Firebase Cloud Messaging — service worker (pesan saat tab tertutup) */
importScripts('https://www.gstatic.com/firebasejs/13.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCBSiyTgx0Zt3Ys1GgZaGfDprtWnaidFsM',
  authDomain: 'govia-64860.firebaseapp.com',
  projectId: 'govia-64860',
  storageBucket: 'govia-64860.firebasestorage.app',
  messagingSenderId: '469673444925',
  appId: '1:469673444925:web:09ddb727f3782cc089cc54',
  measurementId: 'G-W7324F2XX6',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || 'GOVIA';
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || '';
  self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    data: { url: (payload.data && payload.data.url) || '/' },
  });
});

// Klik notifikasi → buka aplikasi
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});
