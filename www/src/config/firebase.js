/**
 * firebase.js — Firebase Konfigürasyonu ve Başlatma
 * Auth + Firestore + Analytics
 */

let auth = null;
let db = null;
let firebaseApp = null;
let firebaseReady = false;

const firebaseConfig = {
  apiKey: "AIzaSyBrEf90oxHcH3NHxjld-dJMk7VvjlZGwXI",
  authDomain: "geomeister-47.firebaseapp.com",
  projectId: "geomeister-47",
  storageBucket: "geomeister-47.firebasestorage.app",
  messagingSenderId: "623939491480",
  appId: "1:623939491480:web:e39749aa27c629c32de2ed",
  measurementId: "G-H7Y44TKVF3"
};

try {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const { getAuth, setPersistence, browserLocalPersistence } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);

  // "Beni hatırla" — oturum yerel olarak kalıcı olsun
  await setPersistence(auth, browserLocalPersistence);

  firebaseReady = true;
  console.log('[Firebase] ✅ Başarıyla başlatıldı — projectId:', firebaseConfig.projectId);
} catch (e) {
  console.warn('[Firebase] ⚠️ Başlatılamadı — misafir modda çalışılıyor.', e.message);
}

export { auth, db, firebaseReady };
export default firebaseApp;
