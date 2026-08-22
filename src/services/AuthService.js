/**
 * AuthService.js — Firebase Authentication Servisi
 * Email/password kayıt, giriş, "beni hatırla", misafir modu.
 */

import { auth, firebaseReady, initFirebase } from '../config/firebase.js';

// Firebase auth fonksiyonlarını dinamik yükle
let authFns = null;
async function getAuthFns() {
  if (authFns) return authFns;
  try {
    authFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    return authFns;
  } catch (e) {
    console.warn('[AuthService] Firebase auth modülü yüklenemedi:', e.message);
  }
  return null;
}

export class AuthService {
  constructor() {
    this.currentUser = null;
    this._listeners = [];

    // Arka planda auth dinleyicisini başlat (top-level await olmadan)
    this._initAuthListener();
  }

  async _initAuthListener() {
    await initFirebase();
    const fns = await getAuthFns();
    if (auth && fns) {
      fns.onAuthStateChanged(auth, (user) => {
        // Eğer kullanıcı aktif olarak Misafir moduna girdiyse ve Firebase null dönerse misafiri bozma!
        if (this.currentUser?.isGuest && !user) {
          return;
        }
        this.currentUser = user;
        this._listeners.forEach((cb) => cb(user));
      });
    }
  }

  /**
   * Misafir girişi — Firebase gerektirmez.
   */
  loginAsGuest(displayName) {
    const guestUser = {
      uid: 'guest_' + Date.now(),
      displayName: displayName || 'Misafir',
      email: null,
      isGuest: true,
    };
    this.currentUser = guestUser;
    this._listeners.forEach((cb) => cb(guestUser));
    return guestUser;
  }

  /**
   * Email/password ile kayıt ol.
   */
  async register(email, password, displayName) {
    await initFirebase();
    const fns = await getAuthFns();
    if (!auth || !fns) throw { code: 'auth/network-request-failed' };
    const credential = await fns.createUserWithEmailAndPassword(auth, email, password);
    await fns.updateProfile(credential.user, { displayName });
    return credential;
  }

  /**
   * Email/password ile giriş yap.
   */
  async login(email, password) {
    await initFirebase();
    const fns = await getAuthFns();
    if (!auth || !fns) throw { code: 'auth/network-request-failed' };
    return fns.signInWithEmailAndPassword(auth, email, password);
  }

  /**
   * Çıkış yap.
   */
  async logout() {
    if (this.currentUser?.isGuest) {
      this.currentUser = null;
      this._listeners.forEach((cb) => cb(null));
      return;
    }
    const fns = await getAuthFns();
    if (auth && fns) {
      return fns.signOut(auth);
    }
    this.currentUser = null;
    this._listeners.forEach((cb) => cb(null));
  }

  /**
   * Auth state değişikliğini dinle.
   */
  onAuthChange(callback) {
    this._listeners.push(callback);
    // Mevcut durumu hemen bildir
    callback(this.currentUser);
    return () => {
      this._listeners = this._listeners.filter((cb) => cb !== callback);
    };
  }

  /**
   * Firebase bağlı mı?
   */
  get isFirebaseConnected() {
    return firebaseReady && auth !== null;
  }

  /**
   * Firebase hata kodlarını Türkçe mesajlara çevirir.
   */
  static getErrorMessage(code) {
    const messages = {
      'auth/email-already-in-use': 'Bu e-posta adresi zaten kullanımda.',
      'auth/invalid-email': 'Geçersiz e-posta adresi.',
      'auth/operation-not-allowed': 'E-posta/şifre girişi etkin değil. Firebase Console\'dan aktif edin.',
      'auth/weak-password': 'Şifre en az 6 karakter olmalıdır.',
      'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
      'auth/user-not-found': 'Bu e-posta adresiyle kayıtlı hesap bulunamadı.',
      'auth/wrong-password': 'Hatalı şifre.',
      'auth/invalid-credential': 'E-posta veya şifre hatalı.',
      'auth/too-many-requests': 'Çok fazla deneme. Lütfen bekleyin.',
      'auth/network-request-failed': 'Ağ bağlantısı hatası.',
    };
    return messages[code] || `Bir hata oluştu (${code}). Lütfen tekrar deneyin.`;
  }
}
