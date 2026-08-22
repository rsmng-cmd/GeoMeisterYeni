/**
 * FriendService.js — Arkadaş Sistemi Servisi
 * Oyuncu arama, arkadaş ekleme/kaldırma, oyun daveti.
 * Firebase Firestore + localStorage fallback.
 */

import { db, firebaseReady } from '../config/firebase.js';

let fsFns = null;
async function getFsFns() {
  if (fsFns) return fsFns;
  if (firebaseReady && db) {
    try {
      fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      return fsFns;
    } catch (e) {
      console.warn('[FriendService] Firestore module load warning:', e.message);
    }
  }
  return null;
}

const FRIENDS_KEY = 'geomeister_friends';
const REQUESTS_KEY = 'geomeister_friend_requests';
const INVITES_KEY = 'geomeister_game_invites';

export class FriendService {
  constructor() {
    this._inviteListener = null;
  }

  /**
   * Kullanıcı adına göre oyuncu arar.
   */
  async searchPlayers(query, currentUser) {
    if (!query || query.length < 2) return [];

    const results = [];
    const queryLower = query.toLowerCase();

    // Firestore'da ara
    const fns = await getFsFns();
    if (db && fns) {
      try {
        const usersRef = fns.collection(db, 'users');
        const snapshot = await Promise.race([
          fns.getDocs(fns.query(usersRef, fns.limit(100))),
          new Promise(resolve => setTimeout(() => resolve(null), 2000)),
        ]);

        if (snapshot) {
          snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.uid !== currentUser?.uid &&
                data.displayName?.toLowerCase().includes(queryLower) &&
                !data.uid?.startsWith('guest')) {
              results.push({
                uid: data.uid,
                displayName: data.displayName,
                email: data.email || '',
              });
            }
          });
        }
      } catch (e) {
        console.warn('[FriendService] Search error:', e);
      }
    }

    // localStorage'dan da ara
    try {
      const scores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
      const seen = new Set(results.map(r => r.uid));
      scores.forEach(s => {
        if (s.uid !== currentUser?.uid &&
            !s.uid?.startsWith('guest') &&
            s.displayName?.toLowerCase().includes(queryLower) &&
            !seen.has(s.uid)) {
          results.push({
            uid: s.uid,
            displayName: s.displayName,
          });
          seen.add(s.uid);
        }
      });
    } catch {}

    return results.slice(0, 20);
  }

  /**
   * Arkadaşlık isteği gönderir.
   */
  async sendFriendRequest(fromUser, toUid, toName) {
    if (!fromUser?.uid || !toUid || fromUser.uid === toUid) return null;

    // Aynı kullanıcıya tekrar istek gönderilmesini engelle
    const currentStatus = await this.getFriendshipStatus(fromUser.uid, toUid);
    if (currentStatus !== 'none') {
      console.warn('[FriendService] İstek zaten mevcut veya arkadaşsınız:', currentStatus);
      return null;
    }

    const request = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      fromUid: fromUser.uid,
      fromName: fromUser.displayName || 'Oyuncu',
      toUid,
      toName: toName || 'Oyuncu',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // LocalStorage (tekilleştirerek ekle)
    const requests = this._getLocalRequests();
    const exists = requests.some(r => r.fromUid === fromUser.uid && r.toUid === toUid && r.status === 'pending');
    if (!exists) {
      requests.push(request);
      localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
    }

    // Firestore
    const fns = await getFsFns();
    if (db && fns) {
      try {
        const q = fns.query(
          fns.collection(db, 'friendRequests'),
          fns.where('fromUid', '==', fromUser.uid),
          fns.where('toUid', '==', toUid),
          fns.where('status', '==', 'pending')
        );
        const snap = await Promise.race([
          fns.getDocs(q),
          new Promise(r => setTimeout(() => r(null), 1500))
        ]);

        if (!snap || snap.docs.length === 0) {
          await fns.addDoc(fns.collection(db, 'friendRequests'), {
            ...request,
            createdAt: fns.serverTimestamp(),
          });
        }
      } catch (e) {
        console.warn('[FriendService] Firestore friend request error:', e);
      }
    }

    return request;
  }

  /**
   * Arkadaşlık isteğini geri alır / iptal eder.
   */
  async cancelFriendRequest(fromUid, toUid) {
    if (!fromUid || !toUid) return;
    this._removeRequestLocalByUsers(fromUid, toUid);
    const fns = await getFsFns();
    if (db && fns) {
      await this._deleteFirestoreRequests(fromUid, toUid);
    }
  }

  /**
   * Arkadaşlık isteğini kabul eder.
   */
  async acceptFriendRequest(request, currentUser) {
    const fromUid = request.fromUid;
    const fromName = request.fromName || request.displayName || 'Oyuncu';

    // Arkadaş listesine ekle (her iki taraf)
    this._addFriendLocal(currentUser.uid, {
      uid: fromUid,
      displayName: fromName,
    });
    this._addFriendLocal(fromUid, {
      uid: currentUser.uid,
      displayName: currentUser.displayName,
    });

    // İsteği kaldır (yerel)
    if (request.id) {
      this._removeRequestLocal(request.id);
    }
    this._removeRequestLocalByUsers(fromUid, currentUser.uid);

    // Firestore sync
    const fns = await getFsFns();
    if (db && fns) {
      try {
        // Arkadaşlık belgesini oluştur
        const friendDocId = [currentUser.uid, fromUid].sort().join('_');
        await fns.setDoc(fns.doc(db, 'friendships', friendDocId), {
          users: [currentUser.uid, fromUid],
          userNames: {
            [currentUser.uid]: currentUser.displayName,
            [fromUid]: fromName,
          },
          createdAt: fns.serverTimestamp(),
        });

        // Bekleyen istekleri Firestore'dan temizle
        await this._deleteFirestoreRequests(fromUid, currentUser.uid);
      } catch (e) {
        console.warn('[FriendService] Firestore accept error:', e);
      }
    }
  }

  /**
   * Arkadaşlık isteğini reddeder.
   */
  async declineFriendRequest(request, currentUser) {
    const reqId = typeof request === 'object' ? request?.id : request;
    const fromUid = typeof request === 'object' ? request?.fromUid : null;
    const toUid = currentUser?.uid;

    if (reqId) {
      this._removeRequestLocal(reqId);
    }

    if (fromUid && toUid) {
      this._removeRequestLocalByUsers(fromUid, toUid);
      const fns = await getFsFns();
      if (db && fns) {
        await this._deleteFirestoreRequests(fromUid, toUid);
      }
    }
  }

  /**
   * Arkadaşı her iki tarafın yerel hafızasından ve Firestore friendships koleksiyonundan kaldırır.
   */
  async removeFriend(currentUid, friendUid) {
    if (!currentUid || !friendUid) return;

    // 1) LocalStorage'dan kaldır (her iki taraf)
    try {
      const friends1 = this._getFriendsLocal(currentUid).filter(f => f.uid !== friendUid);
      localStorage.setItem(`${FRIENDS_KEY}_${currentUid}`, JSON.stringify(friends1));

      const friends2 = this._getFriendsLocal(friendUid).filter(f => f.uid !== currentUid);
      localStorage.setItem(`${FRIENDS_KEY}_${friendUid}`, JSON.stringify(friends2));
    } catch (e) {
      console.warn('[FriendService] Local removeFriend error:', e);
    }

    // 2) Firestore'dan sil
    const fns = await getFsFns();
    if (db && fns) {
      try {
        const friendDocId = [currentUid, friendUid].sort().join('_');
        await fns.deleteDoc(fns.doc(db, 'friendships', friendDocId)).catch(() => {});
      } catch (e) {
        console.warn('[FriendService] Firestore removeFriend error:', e);
      }
    }
  }

  /**
   * Arkadaş listesini getirir.
   */
  async getFriends(user) {
    if (!user?.uid) return [];

    let friends = this._getFriendsLocal(user.uid);

    // Firestore'dan güncelle
    const fns = await getFsFns();
    if (db && fns) {
      try {
        const q = fns.query(
          fns.collection(db, 'friendships'),
          fns.where('users', 'array-contains', user.uid)
        );
        const snap = await Promise.race([
          fns.getDocs(q),
          new Promise(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
        if (snap) {
          const fseFriends = [];
          snap.docs.forEach(doc => {
            const data = doc.data();
            const otherUid = data.users.find(u => u !== user.uid);
            if (otherUid) {
              fseFriends.push({
                uid: otherUid,
                displayName: data.userNames?.[otherUid] || 'Oyuncu',
              });
            }
          });
          if (fseFriends.length > 0) {
            friends = fseFriends;
            localStorage.setItem(`${FRIENDS_KEY}_${user.uid}`, JSON.stringify(friends));
          }
        }
      } catch (e) {
        console.warn('[FriendService] Firestore friends fetch error:', e);
      }
    }

    return friends;
  }

  /**
   * İki oyuncu arasındaki arkadaşlık durumunu sorgular.
   * @returns {'friends' | 'pending_sent' | 'pending_received' | 'none'}
   */
  async getFriendshipStatus(currentUid, targetUid) {
    if (!currentUid || !targetUid || currentUid === targetUid) return 'none';

    // 1) Arkadaş listesini kontrol et
    const friends = await this.getFriends({ uid: currentUid });
    if (friends.some(f => f.uid === targetUid)) return 'friends';

    // 2) Yerel ve Firestore isteklerini kontrol et
    const allRequests = this._getLocalRequests();
    const sentReq = allRequests.find(r => r.fromUid === currentUid && r.toUid === targetUid && r.status === 'pending');
    if (sentReq) return 'pending_sent';

    const recvReq = allRequests.find(r => r.fromUid === targetUid && r.toUid === currentUid && r.status === 'pending');
    if (recvReq) return 'pending_received';

    // Firestore kontrolü
    const fns = await getFsFns();
    if (db && fns) {
      try {
        const qSent = fns.query(
          fns.collection(db, 'friendRequests'),
          fns.where('fromUid', '==', currentUid),
          fns.where('toUid', '==', targetUid),
          fns.where('status', '==', 'pending')
        );
        const snapSent = await Promise.race([
          fns.getDocs(qSent),
          new Promise(r => setTimeout(() => r(null), 1500))
        ]);
        if (snapSent && snapSent.docs.length > 0) return 'pending_sent';

        const qRecv = fns.query(
          fns.collection(db, 'friendRequests'),
          fns.where('fromUid', '==', targetUid),
          fns.where('toUid', '==', currentUid),
          fns.where('status', '==', 'pending')
        );
        const snapRecv = await Promise.race([
          fns.getDocs(qRecv),
          new Promise(r => setTimeout(() => r(null), 1500))
        ]);
        if (snapRecv && snapRecv.docs.length > 0) return 'pending_received';
      } catch (e) {
        console.warn('[FriendService] getFriendshipStatus Firestore error:', e);
      }
    }

    return 'none';
  }

  /**
   * Bekleyen istekleri getirir (aynı gönderenden gelen istekleri tekilleştirir).
   */
  async getPendingRequests(user) {
    if (!user?.uid) return [];

    let requests = this._getLocalRequests().filter(
      r => r.toUid === user.uid && r.status === 'pending'
    );

    // Firestore'dan güncelle
    const fns = await getFsFns();
    if (db && fns) {
      try {
        const q = fns.query(
          fns.collection(db, 'friendRequests'),
          fns.where('toUid', '==', user.uid),
          fns.where('status', '==', 'pending')
        );
        const snap = await Promise.race([
          fns.getDocs(q),
          new Promise(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
        if (snap && snap.docs.length > 0) {
          requests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
      } catch {}
    }

    // Aynı kullanıcıdan gelen birden fazla isteği engelle / tekilleştir
    const uniqueMap = new Map();
    requests.forEach(req => {
      if (req.fromUid && !uniqueMap.has(req.fromUid)) {
        uniqueMap.set(req.fromUid, req);
      }
    });

    const uniqueRequests = Array.from(uniqueMap.values());

    // LocalStorage verisindeki kopyaları da temizle
    try {
      const allLocal = this._getLocalRequests();
      const seen = new Set();
      const cleanedLocal = allLocal.filter(r => {
        const key = `${r.fromUid}_${r.toUid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      localStorage.setItem(REQUESTS_KEY, JSON.stringify(cleanedLocal));
    } catch {}

    return uniqueRequests;
  }

  /**
   * Oyun daveti gönderir (10 saniyelik gerçek zamanlı geçerlilik).
   */
  async sendGameInvite(fromUser, toUid, toName, modeId, roomCode = null) {
    const now = Date.now();
    const invite = {
      id: `inv_${now}_${Math.random().toString(36).substr(2, 4)}`,
      fromUid: fromUser.uid,
      fromName: fromUser.displayName || 'Oyuncu',
      toUid,
      toName,
      modeId,
      roomCode,
      status: 'pending',
      createdAt: now,
      expiresAt: now + 10000, // 10 saniye sonra geçerliliğini yitirir
    };

    // localStorage
    const invites = JSON.parse(localStorage.getItem(INVITES_KEY) || '[]');
    invites.push(invite);
    localStorage.setItem(INVITES_KEY, JSON.stringify(invites));

    // Firestore
    const fns = await getFsFns();
    if (db && fns) {
      try {
        await fns.setDoc(fns.doc(db, 'gameInvites', invite.id), {
          ...invite,
          createdAt: fns.serverTimestamp(),
        });
      } catch (e) {
        console.warn('[FriendService] Invite send error:', e);
      }
    }

    return invite;
  }

  /**
   * Gelen oyun davetlerini dinler (10 saniyeden eski veya geçersiz istekleri eler).
   */
  async listenForInvites(user, callback) {
    if (!user?.uid) return;

    const fns = await getFsFns();

    const isInviteValid = async (invite) => {
      if (!invite) return false;
      const now = Date.now();
      const inviteTime = typeof invite.createdAt === 'number'
        ? invite.createdAt
        : (invite.createdAt?.toMillis ? invite.createdAt.toMillis() : new Date(invite.createdAt || 0).getTime());

      // 1. Gerçek hayattaki 10 saniye kuralı
      if (now - inviteTime > 10000) {
        if (db && fns && invite.id) {
          fns.deleteDoc(fns.doc(db, 'gameInvites', invite.id)).catch(() => {});
        }
        return false;
      }

      // 2. Eğer lobi kodu varsa, odanın hala 'waiting' durumunda olup olmadığını kontrol et
      if (invite.roomCode && db && fns) {
        try {
          const roomSnap = await fns.getDoc(fns.doc(db, 'customRooms', invite.roomCode));
          if (!roomSnap.exists()) return false;
          const roomData = roomSnap.data();
          if (roomData.status !== 'waiting') return false;
        } catch {
          // Bağlantı hatası durumunda devam et
        }
      }

      return true;
    };

    // Firestore listener
    if (db && fns) {
      try {
        const q = fns.query(
          fns.collection(db, 'gameInvites'),
          fns.where('toUid', '==', user.uid),
          fns.where('status', '==', 'pending')
        );
        this._inviteListener = fns.onSnapshot(q, (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const inviteData = { id: change.doc.id, ...change.doc.data() };
              const valid = await isInviteValid(inviteData);
              if (valid) {
                callback(inviteData);
              }
            }
          });
        });
      } catch (e) {
        console.warn('[FriendService] Invite listener error:', e);
      }
    }

    // localStorage polling fallback
    let lastCheck = Date.now();
    this._invitePoller = setInterval(async () => {
      const invites = JSON.parse(localStorage.getItem(INVITES_KEY) || '[]');
      const now = Date.now();
      const newInvites = invites.filter(i =>
        i.toUid === user.uid &&
        i.status === 'pending' &&
        now - (typeof i.createdAt === 'number' ? i.createdAt : new Date(i.createdAt).getTime()) <= 10000 &&
        (typeof i.createdAt === 'number' ? i.createdAt : new Date(i.createdAt).getTime()) > lastCheck
      );
      for (const inv of newInvites) {
        const valid = await isInviteValid(inv);
        if (valid) callback(inv);
      }
      lastCheck = Date.now();
    }, 1500);
  }

  stopListening() {
    if (typeof this._inviteListener === 'function') {
      this._inviteListener();
      this._inviteListener = null;
    }
    if (this._invitePoller) {
      clearInterval(this._invitePoller);
      this._invitePoller = null;
    }
  }

  // --- Private localStorage helpers ---

  _getFriendsLocal(uid) {
    try {
      return JSON.parse(localStorage.getItem(`${FRIENDS_KEY}_${uid}`) || '[]');
    } catch { return []; }
  }

  _addFriendLocal(uid, friend) {
    const friends = this._getFriendsLocal(uid);
    if (!friends.some(f => f.uid === friend.uid)) {
      friends.push(friend);
      localStorage.setItem(`${FRIENDS_KEY}_${uid}`, JSON.stringify(friends));
    }
  }

  _getLocalRequests() {
    try {
      return JSON.parse(localStorage.getItem(REQUESTS_KEY) || '[]');
    } catch { return []; }
  }

  _removeRequestLocal(requestId) {
    const requests = this._getLocalRequests().filter(r => r.id !== requestId);
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
  }

  _removeRequestLocalByUsers(uid1, uid2) {
    const requests = this._getLocalRequests().filter(
      r => !((r.fromUid === uid1 && r.toUid === uid2) || (r.fromUid === uid2 && r.toUid === uid1))
    );
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
  }

  async _deleteFirestoreRequests(uid1, uid2) {
    const fns = await getFsFns();
    if (!db || !fns) return;
    try {
      const q1 = fns.query(
        fns.collection(db, 'friendRequests'),
        fns.where('fromUid', '==', uid1),
        fns.where('toUid', '==', uid2)
      );
      const q2 = fns.query(
        fns.collection(db, 'friendRequests'),
        fns.where('fromUid', '==', uid2),
        fns.where('toUid', '==', uid1)
      );

      const [snap1, snap2] = await Promise.all([
        fns.getDocs(q1).catch(() => null),
        fns.getDocs(q2).catch(() => null)
      ]);

      const docsToDelete = [];
      if (snap1) snap1.docs.forEach(d => docsToDelete.push(d.ref));
      if (snap2) snap2.docs.forEach(d => docsToDelete.push(d.ref));

      for (const ref of docsToDelete) {
        await fns.deleteDoc(ref).catch(e => console.warn('[FriendService] deleteDoc error:', e));
      }
    } catch (e) {
      console.warn('[FriendService] _deleteFirestoreRequests error:', e);
    }
  }
}

export default new FriendService();
