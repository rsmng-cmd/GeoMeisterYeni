/**
 * PresenceService.js — Çevrimiçi Durum Takip Servisi
 * Firestore 'presence' koleksiyonu ile arkadaşların aktif/çevrimdışı durumunu
 * ve mevcut aktivitesini (ana menü, oyun modu, online maç) takip eder.
 * 
 * Optimizasyonlar:
 * - 3 dakikalık heartbeat (yazma tasarrufu)
 * - Panel kapalıyken dinleme duraklatılır (okuma tasarrufu)
 * - Panel açıldığında tek seferlik fetch + 30s polling
 */

import { db, firebaseReady } from '../config/firebase.js';

let fsFns = null;
if (firebaseReady && db) {
  try {
    fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  } catch (e) {
    console.warn('[PresenceService] Firestore module load warning:', e.message);
  }
}

const HEARTBEAT_INTERVAL = 180_000; // 3 dakika
const OFFLINE_THRESHOLD = 360_000;  // 6 dakika (2 heartbeat kaçarsa çevrimdışı)
const POLL_INTERVAL = 30_000;       // Panel açıkken 30 saniyede bir arkadaş durumu güncelle

export class PresenceService {
  constructor() {
    this._heartbeatTimer = null;
    this._pollTimer = null;
    this._currentUser = null;
    this._currentActivity = 'Ana Menü';
    this._isListening = false;
    this._onFriendsUpdate = null;
    this._friendUids = [];
  }

  /**
   * Presence sistemini başlatır. Giriş yapıldığında çağrılır.
   */
  start(user) {
    if (!user?.uid || user.isGuest || user.uid.startsWith('guest')) return;
    this._currentUser = user;
    this._setPresence('online', this._currentActivity);
    this._startHeartbeat();
    this._bindPageEvents();
  }

  /**
   * Presence sistemini durdurur. Çıkış yapılınca çağrılır.
   */
  stop() {
    this._setPresence('offline', '');
    this._stopHeartbeat();
    this.stopWatching();
    this._unbindPageEvents();
    this._currentUser = null;
  }

  /**
   * Kullanıcının mevcut aktivitesini günceller.
   * @param {string} activity — Örn: 'Ana Menü', '🌍 Dünya Modu oynuyor', '⚔️ Online Maç'
   */
  setActivity(activity) {
    this._currentActivity = activity;
    this._setPresence('online', activity);
  }

  /**
   * Arkadaşların presence durumunu izlemeye başlar (panel açılınca).
   * Tek seferlik fetch + 30 saniye polling.
   * @param {string[]} friendUids — İzlenecek arkadaş UID'leri
   * @param {Function} onChange — (presenceMap) => void
   */
  startWatching(friendUids, onChange) {
    if (!friendUids || friendUids.length === 0) return;
    this._friendUids = friendUids;
    this._onFriendsUpdate = onChange;
    this._isListening = true;

    // İlk fetch
    this._fetchFriendsPresence();

    // 30 saniyede bir polling
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (this._isListening) {
        this._fetchFriendsPresence();
      }
    }, POLL_INTERVAL);
  }

  /**
   * Arkadaş izlemesini durdurur (panel kapanınca).
   */
  stopWatching() {
    this._isListening = false;
    this._onFriendsUpdate = null;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ─── Private ───────────────────────────────────────────────

  async _setPresence(status, activity) {
    if (!this._currentUser?.uid) return;
    const uid = this._currentUser.uid;

    // LocalStorage (anında)
    const presenceData = {
      uid,
      displayName: this._currentUser.displayName || 'Oyuncu',
      status,
      activity: activity || '',
      lastSeen: Date.now(),
    };
    try {
      localStorage.setItem(`gm_presence_${uid}`, JSON.stringify(presenceData));
    } catch {}

    // Firestore (arka plan)
    if (db && fsFns) {
      try {
        await fsFns.setDoc(fsFns.doc(db, 'presence', uid), {
          ...presenceData,
          lastSeen: fsFns.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        // Sessizce devam et — çevrimdışı olabilir
      }
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._currentUser) {
        this._setPresence('online', this._currentActivity);
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  async _fetchFriendsPresence() {
    if (!this._friendUids.length || !this._onFriendsUpdate) return;

    const presenceMap = {};

    // Firestore'dan toplu çek (batch — max 10 per 'in' query)
    if (db && fsFns) {
      try {
        const batches = [];
        for (let i = 0; i < this._friendUids.length; i += 10) {
          const batch = this._friendUids.slice(i, i + 10);
          batches.push(batch);
        }

        for (const batch of batches) {
          const q = fsFns.query(
            fsFns.collection(db, 'presence'),
            fsFns.where('uid', 'in', batch)
          );
          const snap = await Promise.race([
            fsFns.getDocs(q),
            new Promise(resolve => setTimeout(() => resolve(null), 3000)),
          ]);
          if (snap) {
            snap.docs.forEach(doc => {
              const data = doc.data();
              const lastSeen = data.lastSeen?.toMillis?.() || data.lastSeen || 0;
              const isOnline = data.status === 'online' && (Date.now() - lastSeen) < OFFLINE_THRESHOLD;
              presenceMap[data.uid] = {
                uid: data.uid,
                displayName: data.displayName || 'Oyuncu',
                status: isOnline ? 'online' : 'offline',
                activity: isOnline ? (data.activity || 'Çevrimiçi') : '',
                lastSeen,
              };
            });
          }
        }
      } catch (e) {
        console.warn('[PresenceService] Fetch friends presence error:', e.message);
      }
    }

    // Firestore'da bulunamayan arkadaşları çevrimdışı olarak işaretle
    this._friendUids.forEach(uid => {
      if (!presenceMap[uid]) {
        presenceMap[uid] = {
          uid,
          displayName: '',
          status: 'offline',
          activity: '',
          lastSeen: 0,
        };
      }
    });

    this._onFriendsUpdate(presenceMap);
  }

  // ─── Sayfa Olayları ────────────────────────────────────────

  _bindPageEvents() {
    this._visibilityTimeout = null;

    this._onBeforeUnload = () => {
      this._setPresenceSync('offline');
    };

    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Ekran küçültüldüğünde veya sekme değiştirildiğinde hemen çevrimdışı yapma!
        // 3 dakika boyunca geri gelmezse çevrimdışına al
        if (this._visibilityTimeout) clearTimeout(this._visibilityTimeout);
        this._visibilityTimeout = setTimeout(() => {
          if (document.visibilityState === 'hidden') {
            this._setPresence('offline', '');
          }
        }, 180_000); // 3 dakika tolerans
      } else if (document.visibilityState === 'visible' && this._currentUser) {
        if (this._visibilityTimeout) {
          clearTimeout(this._visibilityTimeout);
          this._visibilityTimeout = null;
        }
        this._setPresence('online', this._currentActivity);
      }
    };

    window.addEventListener('beforeunload', this._onBeforeUnload);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _unbindPageEvents() {
    if (this._visibilityTimeout) {
      clearTimeout(this._visibilityTimeout);
      this._visibilityTimeout = null;
    }
    if (this._onBeforeUnload) {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
    }
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  /**
   * Senkron presence güncelleme (beforeunload için — navigator.sendBeacon)
   */
  _setPresenceSync(status) {
    if (!this._currentUser?.uid) return;
    const uid = this._currentUser.uid;
    try {
      localStorage.setItem(`gm_presence_${uid}`, JSON.stringify({
        uid,
        status,
        activity: '',
        lastSeen: Date.now(),
      }));
    } catch {}

    // sendBeacon ile Firestore'a yazamayız ama en azından localStorage güncelledik
    // Firestore heartbeat kaçınca otomatik çevrimdışı sayılacak
  }
}

export default new PresenceService();
