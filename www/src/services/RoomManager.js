// RoomManager.js — Özel Oda Kurma, Kod İle Katılma (Maks 5 Oyuncu)
import { db, firebaseReady } from '../config/firebase.js';
import { getModeById } from '../modes/ModeRegistry.js';
import { getSeededQuestions } from '../utils/seededQuestions.js';

let fsFns = null;
async function getFsFns() {
  if (fsFns) return fsFns;
  if (firebaseReady && db) {
    try {
      fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      return fsFns;
    } catch (e) {
      console.warn('[RoomManager] Firestore module load warning:', e.message);
    }
  }
  return null;
}

export class RoomManager {
  constructor() {
    this.currentRoom = null;
    this.roomListener = null;
  }

  /**
   * 6 Haneli Rastgele Oda Kodu Üretir (Örn: GEO-8492)
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `GEO-${code}`;
  }

  /**
   * Yeni Özel Oda Kurar
   */
  async createRoom(hostUser, modeId = 'world') {
    const roomCode = this.generateRoomCode();
    const roomId = `room_${roomCode.replace('-', '')}_${Date.now()}`;
    const hostPlayer = {
      uid: hostUser?.uid || `guest_host_${Date.now()}`,
      displayName: hostUser?.displayName || 'Oda Kurucusu',
      isHost: true,
      joinedAt: new Date().toISOString(),
      score: 0,
    };

    // 10 Eşzamanlı Soru — Ortak roomCode tohumu ile deterministik üret
    const mode = getModeById(modeId) || getModeById('world');
    const dataSource = mode?.dataSource || modeId;
    const questions = getSeededQuestions(dataSource, roomCode, 10);

    const roomData = {
      roomId,
      code: roomCode,
      hostUid: hostPlayer.uid,
      modeId,
      status: 'waiting', // waiting, playing, finished
      maxPlayers: 5,
      players: [hostPlayer],
      questions,
      currentRound: 1,
      totalRounds: 10,
      createdAt: new Date().toISOString(),
    };

    this.currentRoom = roomData;

    // Local Storage Fallback & State (Instant)
    localStorage.setItem(`geomeister_room_${roomCode}`, JSON.stringify(roomData));

    // Firestore Sync in background (non-blocking)
    const fns = await getFsFns();
    if (db && fns) {
      fns.setDoc(fns.doc(db, 'customRooms', roomCode), {
        ...roomData,
        createdAt: fns.serverTimestamp(),
      }).catch(e => console.warn('[RoomManager] Firestore room creation warning:', e));
    }

    return roomData;
  }

  /**
   * Kodu Girilen Odaya Katılır (En Fazla 5 Oyuncu)
   */
  async joinRoom(roomCode, user) {
    const formattedCode = roomCode.trim().toUpperCase();
    const playerObj = {
      uid: user?.uid || `guest_${Date.now()}`,
      displayName: user?.displayName || 'Oyuncu',
      isHost: false,
      joinedAt: new Date().toISOString(),
      score: 0,
    };

    // 1. Local Fallback dene
    let room = JSON.parse(localStorage.getItem(`geomeister_room_${formattedCode}`) || 'null');

    // 2. Firestore'da dene (1.5s timeout)
    const fns = await getFsFns();
    if (db && fns && !room) {
      try {
        const fetchPromise = (async () => {
          const ref = fns.doc(db, 'customRooms', formattedCode);
          return await fns.getDoc(ref);
        })();
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 1500));
        const snap = await Promise.race([fetchPromise, timeoutPromise]);
        if (snap && snap.exists()) {
          room = snap.data();
        }
      } catch (e) {
        console.warn('[RoomManager] Firestore join room read warning:', e);
      }
    }

    if (!room) {
      throw new Error('Oda bulunamadı! Lütfen oda kodunu kontrol edin.');
    }

    if (room.status !== 'waiting') {
      throw new Error('Bu oda oyunu başlatmış veya tamamlanmış!');
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Error(`Oda dolu! (Maksimum ${room.maxPlayers} oyuncu)`);
    }

    // Zaten ekli mi kontrol et
    const existingIndex = room.players.findIndex(p => p.uid === playerObj.uid);
    if (existingIndex === -1) {
      room.players.push(playerObj);
    }

    this.currentRoom = room;
    localStorage.setItem(`geomeister_room_${formattedCode}`, JSON.stringify(room));

    if (db && fns) {
      fns.updateDoc(fns.doc(db, 'customRooms', formattedCode), {
        players: room.players,
      }).catch(e => console.warn('[RoomManager] Firestore join update warning:', e));
    }

    return room;
  }

  /**
   * Odadan Ayrılma (Oyuncu Lobiyi Terk Ettiğinde)
   */
  async leaveRoom(roomCode, user) {
    if (!roomCode) return;
    const formattedCode = roomCode.trim().toUpperCase();
    const userUid = user?.uid;

    this.stopListening();
    this.currentRoom = null;

    try {
      const stored = JSON.parse(localStorage.getItem(`geomeister_room_${formattedCode}`) || 'null');
      if (stored && Array.isArray(stored.players)) {
        stored.players = stored.players.filter(p => p.uid !== userUid);
        if (stored.players.length === 0) {
          localStorage.removeItem(`geomeister_room_${formattedCode}`);
        } else {
          if (stored.hostUid === userUid && stored.players[0]) {
            stored.hostUid = stored.players[0].uid;
            stored.players[0].isHost = true;
          }
          localStorage.setItem(`geomeister_room_${formattedCode}`, JSON.stringify(stored));
        }
      }
    } catch {}

    const fns = await getFsFns();
    if (db && fns) {
      try {
        const ref = fns.doc(db, 'customRooms', formattedCode);
        const snap = await fns.getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const updatedPlayers = (data.players || []).filter(p => p.uid !== userUid);
          if (updatedPlayers.length === 0) {
            await fns.deleteDoc(ref);
          } else {
            let updatedHostUid = data.hostUid;
            if (data.hostUid === userUid && updatedPlayers[0]) {
              updatedHostUid = updatedPlayers[0].uid;
              updatedPlayers[0].isHost = true;
            }
            await fns.updateDoc(ref, {
              players: updatedPlayers,
              hostUid: updatedHostUid,
            });
          }
        }
      } catch (e) {
        console.warn('[RoomManager] Leave room error:', e);
      }
    }
  }

  /**
   * Oda Sahibi Oyunu Başlatır
   */
  async startGame(roomCode) {
    const formattedCode = roomCode.trim().toUpperCase();
    if (!this.currentRoom) return;

    if (!this.currentRoom.questions || this.currentRoom.questions.length === 0) {
      const mode = getModeById(this.currentRoom.modeId) || getModeById('world');
      const dataSource = mode?.dataSource || this.currentRoom.modeId || 'world';
      this.currentRoom.questions = getSeededQuestions(dataSource, formattedCode, 10);
    }

    const matchId = `room_${formattedCode}_${Date.now()}`;
    this.currentRoom.status = 'playing';
    this.currentRoom.matchId = matchId;
    this.currentRoom.startedAt = Date.now();
    localStorage.setItem(`geomeister_room_${formattedCode}`, JSON.stringify(this.currentRoom));

    const fns = await getFsFns();
    if (db && fns) {
      fns.setDoc(fns.doc(db, 'customRooms', formattedCode), {
        ...this.currentRoom,
        status: 'playing',
        matchId: matchId,
        questions: this.currentRoom.questions,
        startedAt: fns.serverTimestamp(),
      }, { merge: true }).catch(e => console.warn('[RoomManager] Firestore start game warning:', e));
    }
  }

  /**
   * Maç bittikten sonra odayı yeniden lobi durumuna getirir (yeni sorularla)
   */
  async resetRoomToLobby(roomCode) {
    if (!roomCode) return null;
    const formattedCode = roomCode.trim().toUpperCase();
    let room = this.currentRoom;

    if (!room || room.code !== formattedCode) {
      try {
        room = JSON.parse(localStorage.getItem(`geomeister_room_${formattedCode}`) || 'null');
      } catch {}
    }

    const fns = await getFsFns();
    if (db && fns) {
      try {
        const snap = await fns.getDoc(fns.doc(db, 'customRooms', formattedCode));
        if (snap.exists()) {
          room = snap.data();
        }
      } catch (e) {
        console.warn('[RoomManager] Fetch room for reset warning:', e);
      }
    }

    if (!room) return null;

    const mode = getModeById(room.modeId) || getModeById('world');
    const dataSource = mode?.dataSource || room.modeId || 'world';
    const newQuestions = getSeededQuestions(dataSource, `${formattedCode}_${Date.now()}`, 10);

    room.status = 'waiting';
    room.matchId = null;
    room.questions = newQuestions;
    room.currentRound = 1;
    this.currentRoom = room;

    try {
      localStorage.setItem(`geomeister_room_${formattedCode}`, JSON.stringify(room));
    } catch {}

    if (db && fns) {
      await fns.setDoc(fns.doc(db, 'customRooms', formattedCode), {
        status: 'waiting',
        matchId: null,
        questions: newQuestions,
        currentRound: 1,
        resetAt: fns.serverTimestamp(),
      }, { merge: true }).catch(e => console.warn('[RoomManager] Firestore reset room warning:', e));
    }

    return room;
  }

  /**
   * Odadaki Değişiklikleri Dinler
   */
  async listenToRoom(roomCode, onChange) {
    const formattedCode = roomCode.trim().toUpperCase();

    // Anlık mevcut odayı hemen bildir
    if (this.currentRoom && this.currentRoom.code === formattedCode) {
      onChange(this.currentRoom);
    }

    let unsubFirestore = null;
    const fns = await getFsFns();

    if (db && fns) {
      try {
        const ref = fns.doc(db, 'customRooms', formattedCode);
        unsubFirestore = fns.onSnapshot(ref, (docSnap) => {
          if (docSnap.exists()) {
            this.currentRoom = docSnap.data();
            onChange(this.currentRoom);
          }
        }, (err) => {
          console.warn('[RoomManager] Firestore snapshot listener warning:', err);
        });
      } catch (e) {
        console.warn('[RoomManager] Firestore listen error:', e);
      }
    }

    // Local Fallback polling (aynı sekme veya yerel depolama değişiklikleri için)
    let lastJson = JSON.stringify(this.currentRoom);
    const intervalId = setInterval(() => {
      const stored = JSON.parse(localStorage.getItem(`geomeister_room_${formattedCode}`) || 'null');
      if (stored) {
        const currentJson = JSON.stringify(stored);
        if (currentJson !== lastJson) {
          lastJson = currentJson;
          this.currentRoom = stored;
          onChange(stored);
        }
      }
    }, 500);

    this.roomListener = () => {
      if (typeof unsubFirestore === 'function') unsubFirestore();
      clearInterval(intervalId);
    };
  }

  stopListening() {
    if (typeof this.roomListener === 'function') {
      this.roomListener();
      this.roomListener = null;
    }
  }
}

export default new RoomManager();
