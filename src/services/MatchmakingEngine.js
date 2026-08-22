// MatchmakingEngine.js — 1v1 Eşleştirme (Atomic Firestore Transaction) ve Bot Yapay Zekası Engine
import onlineService, { getRankByElo } from './OnlineService.js';
import { db, firebaseReady } from '../config/firebase.js';
import { haversineDistance, distanceToScore } from '../core/Scorer.js';
import { getSeededQuestions } from '../utils/seededQuestions.js';

let fsFns = null;
async function getFsFns() {
  if (fsFns) return fsFns;
  if (firebaseReady && db) {
    try {
      fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      return fsFns;
    } catch (e) {
      console.warn('[MatchmakingEngine] Firestore module load warning:', e.message);
    }
  }
  return null;
}

// 45 saniyeden eski kuyruk kayıtları hayalet sayılır
const STALE_THRESHOLD_MS = 45 * 1000;

export class MatchmakingEngine {
  constructor() {
    this.queueTimer = null;
    this.activeSearchId = null;
    this.onStatusChangeCallback = null;
    this.queueDocRef = null;
    this.queueUnsubscribe = null;
    this.currentUser = null;
    this.matchHandled = false;
    this.isMatchingInProgress = false;

    // Sayfa kapanması veya arka plana geçme temizleyicileri
    window.addEventListener('beforeunload', () => this.cancelSearch());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        const gameActive = (typeof window.mpGameActive !== 'undefined' && window.mpGameActive);
        if (!gameActive && this.activeSearchId) {
          this.cancelSearch();
        }
      }
    });
  }

  getStableGuestUid() {
    let uid = localStorage.getItem('geomeister_guest_uid');
    if (!uid) {
      uid = 'guest_' + Math.floor(Math.random() * 999999999);
      localStorage.setItem('geomeister_guest_uid', uid);
    }
    return uid;
  }

  /**
   * 1v1 Eşleşme Kuyruğunu Başlatır.
   *   - 0-7sn: ±30 ELO yakınlığındaki rakip (en yakın ELO öncelikli)
   *   - 7-15sn: Tüm ELO seviyelerinde canlı oyuncular (en yakın ELO öncelikli)
   *   - 15sn: Canlı oyuncu yoksa rütbeye özel Bot Rakip Ataması
   */
  async startSearch({ user, modeId, onStatusChange, onMatchFound }) {
    this.cancelSearch();
    this.onStatusChangeCallback = onStatusChange;
    this.matchHandled = false;
    this.isMatchingInProgress = false;

    const stats = await onlineService.getPlayerOnlineStats(user, modeId);
    const searchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.activeSearchId = searchId;

    const uid = user?.uid || this.getStableGuestUid();
    const displayName = user?.displayName || user?.name || 'Oyuncu';
    const me = {
      uid,
      displayName,
      elo: stats.elo || 50,
      rank: stats.rank || getRankByElo(stats.elo || 50),
    };
    this.currentUser = me;

    let secondsElapsed = 0;
    this._notifyStatus(`Eşleşme aranıyor... (±30 ELO) [0s]`, secondsElapsed);

    // Kendi sunucu / Firestore kuyruk kaydını oluştur ve dinlemeye başla
    const fns = await getFsFns();
    if (db && fns) {
      try {
        this.queueDocRef = fns.doc(db, 'matchmaking', me.uid);
        await fns.setDoc(this.queueDocRef, {
          uid: me.uid,
          displayName: me.displayName,
          modeId,
          elo: me.elo,
          rank: me.rank,
          status: 'searching',
          matchedWith: null,
          matchId: null,
          ready: false,
          bot: false,
          createdAt: Date.now(),
        });

        // Kendi kuyruk belgemizi dinle: Karşı taraf transaction ile bizi eşleştirdiğinde anında tetiklenir!
        this.queueUnsubscribe = fns.onSnapshot(this.queueDocRef, (docSnap) => {
          if (!docSnap.exists() || this.matchHandled) return;
          const data = docSnap.data();
          if (data.status === 'matched' && data.matchId && !this.matchHandled) {
            console.log('[MatchmakingEngine] ⚡ Eşleşme bulundu (Snapshot bildirim):', data);
            this.matchHandled = true;
            this.cancelSearch();

            onMatchFound({
              matchId: data.matchId,
              isBot: !!data.bot,
              modeId: data.modeId || modeId,
              questions: data.questions || [],
              opponent: data.opponent,
              player: {
                uid: me.uid,
                displayName: me.displayName,
                elo: me.elo,
                rank: me.rank,
              },
            });
          }
        }, (err) => {
          console.warn('[MatchmakingEngine] Queue snapshot listener warning:', err);
        });
      } catch (e) {
        console.warn('[MatchmakingEngine] Queue doc init error:', e);
      }
    }

    // Eşleştirme Arama Döngüsü (Toplam 15 saniye)
    this.queueTimer = setInterval(async () => {
      if (this.activeSearchId !== searchId || this.matchHandled) {
        clearInterval(this.queueTimer);
        return;
      }

      secondsElapsed++;

      // Çakışan eşleştirme sorgularını önle
      if (this.isMatchingInProgress) return;
      this.isMatchingInProgress = true;

      try {
        if (secondsElapsed <= 7) {
          // 0 - 7 saniye: ±30 ELO yakınlığında ara (en yakın ELO öncelikli)
          this._notifyStatus(`Eşleşme aranıyor... (±30 ELO) [${secondsElapsed}s]`, secondsElapsed);
          await this._findMatch(modeId, 30, me, stats, onMatchFound, searchId);
        } else if (secondsElapsed < 15) {
          // 7 - 15 saniye: Tüm oyuncular arasında ara (en yakın ELO öncelikli)
          this._notifyStatus(`Aralık genişletildi... (Tüm Oyuncular) [${secondsElapsed}s]`, secondsElapsed);
          await this._findMatch(modeId, null, me, stats, onMatchFound, searchId);
        } else {
          // 15. saniyede bot ata
          clearInterval(this.queueTimer);
          this.queueTimer = null;
          if (!this.matchHandled && this.activeSearchId === searchId) {
            this.matchHandled = true;
            this._notifyStatus(`Rakip bulundu! Maç başlatılıyor...`, 15);
            this._assignBotMatch(modeId, me, stats, onMatchFound);
          }
        }
      } catch (e) {
        console.warn('[MatchmakingEngine] Search tick error:', e);
      } finally {
        this.isMatchingInProgress = false;
      }
    }, 1000);
  }

  /**
   * Firestore Transaction ile Atomik ve Çakışmasız Eşleşme Gerçekleştirir
   */
  async _findMatch(modeId, eloLimit, me, stats, onMatchFound, searchId) {
    if (this.matchHandled || this.activeSearchId !== searchId) return;

    const fns = await getFsFns();
    if (!db || !fns) return;

    try {
      const q = fns.query(
        fns.collection(db, 'matchmaking'),
        fns.where('modeId', '==', modeId),
        fns.where('status', '==', 'searching')
      );

      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2500));
      const snap = await Promise.race([fns.getDocs(q), timeoutPromise]);

      if (!snap || !snap.docs) return;

      const now = Date.now();
      let bestOpponent = null;
      let minDiff = Infinity;

      for (const docSnap of snap.docs) {
        const p = docSnap.data();
        if (p.uid === me.uid) continue;

        // Hayalet kayıt filtresi (45 saniyeden eski kayıtları eşleştirme)
        const age = now - (p.createdAt || 0);
        if (age > STALE_THRESHOLD_MS) {
          fns.deleteDoc(docSnap.ref).catch(() => {});
          continue;
        }

        const diff = Math.abs((p.elo || 50) - (me.elo || 50));
        if (eloLimit === null || diff <= eloLimit) {
          if (diff < minDiff) {
            minDiff = diff;
            bestOpponent = p;
          }
        }
      }

      if (!bestOpponent || this.matchHandled || this.activeSearchId !== searchId) return;

      const myRef = fns.doc(db, 'matchmaking', me.uid);
      const oppRef = fns.doc(db, 'matchmaking', bestOpponent.uid);
      const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const questions = getSeededQuestions(modeId, matchId, 10);

      // Firestore Transaction — Her iki oyuncunun belgesini aynı anda atomik olarak kitle ve eşleştir!
      await fns.runTransaction(db, async (tx) => {
        const mySnap = await tx.get(myRef);
        const oppSnap = await tx.get(oppRef);

        if (!mySnap.exists() || !oppSnap.exists()) {
          throw new Error('Kuyruk kaydı bulunamadı.');
        }

        const myData = mySnap.data();
        const oppData = oppSnap.data();

        if (myData.status !== 'searching') {
          throw new Error('Ben zaten eşleştim.');
        }
        if (oppData.status !== 'searching') {
          throw new Error('Rakip zaten eşleşti.');
        }

        const oppAge = now - (oppData.createdAt || 0);
        if (oppAge > STALE_THRESHOLD_MS) {
          throw new Error('Rakip kaydı eskimiş.');
        }

        const matchPayloadForMe = {
          status: 'matched',
          matchedWith: oppData.uid,
          matchId,
          modeId,
          questions,
          opponent: {
            uid: oppData.uid,
            displayName: oppData.displayName || 'Rakip',
            elo: oppData.elo || 50,
            rank: oppData.rank || getRankByElo(oppData.elo || 50),
            isBot: false,
          },
          player: {
            uid: me.uid,
            displayName: me.displayName,
            elo: me.elo,
            rank: me.rank,
          },
          matchedAt: Date.now(),
        };

        const matchPayloadForOpp = {
          status: 'matched',
          matchedWith: me.uid,
          matchId,
          modeId,
          questions,
          opponent: {
            uid: me.uid,
            displayName: me.displayName,
            elo: me.elo,
            rank: me.rank,
            isBot: false,
          },
          player: {
            uid: oppData.uid,
            displayName: oppData.displayName || 'Rakip',
            elo: oppData.elo || 50,
            rank: oppData.rank || getRankByElo(oppData.elo || 50),
          },
          matchedAt: Date.now(),
        };

        tx.update(myRef, matchPayloadForMe);
        tx.update(oppRef, matchPayloadForOpp);

        // Canlı maç belgesini (liveMatches) başlat
        const liveRef = fns.doc(db, 'liveMatches', matchId);
        tx.set(liveRef, {
          matchId,
          modeId,
          questions,
          status: 'playing',
          players: {
            [me.uid]: { displayName: me.displayName, elo: me.elo, ready: true },
            [oppData.uid]: { displayName: oppData.displayName || 'Rakip', elo: oppData.elo || 50, ready: true },
          },
          createdAt: Date.now(),
        });
      });

      console.log('[MatchmakingEngine] ✅ Transaction başarılı! Canlı 1v1 Maç Başlatılıyor:', matchId);
      if (!this.matchHandled && this.activeSearchId === searchId) {
        this.matchHandled = true;
        this.cancelSearch();

        onMatchFound({
          matchId,
          isBot: false,
          modeId,
          questions,
          opponent: {
            uid: bestOpponent.uid,
            displayName: bestOpponent.displayName || 'Rakip',
            elo: bestOpponent.elo || 50,
            rank: bestOpponent.rank || getRankByElo(bestOpponent.elo || 50),
            isBot: false,
          },
          player: {
            uid: me.uid,
            displayName: me.displayName,
            elo: me.elo,
            rank: me.rank,
          },
        });
      }
    } catch (err) {
      console.log('[MatchmakingEngine] Transaction denemesi (beklenen yarış durumu):', err.message);
    }
  }

  /**
   * Canlı rakip bulunamadığında rütbeye uygun Bot ataması yapar
   */
  async _assignBotMatch(modeId, me, stats, onMatchFound) {
    this.cancelSearch();
    const botOpponent = this._generateBotOpponent(stats.elo || 50, me);
    const matchId = `botmatch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const questions = getSeededQuestions(modeId, matchId, 10);

    onMatchFound({
      matchId,
      isBot: true,
      modeId,
      questions,
      player: {
        uid: me.uid,
        displayName: me.displayName,
        elo: stats.elo || 50,
        rank: stats.rank || getRankByElo(stats.elo || 50),
      },
      opponent: botOpponent,
    });
  }

  /**
   * 2v2 Takımlı Eşleşme Araması
   * Takım (Siz + Arkadaşınız) için karşı takım (canlı rakip veya 2 Bot) arar.
   */
  async start2v2Search({ user, teammate, modeId, onStatusChange, onMatchFound }) {
    this.cancelSearch();
    this.onStatusChangeCallback = onStatusChange;
    this.matchHandled = false;

    const mode2v2Id = `${modeId}_2v2`;
    const p1Stats = await onlineService.getPlayerOnlineStats(user, mode2v2Id);
    const searchId = `match2v2_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.activeSearchId = searchId;

    let secondsElapsed = 0;
    this._notifyStatus(`2v2 Rakip Takım Aranıyor... [0s]`, secondsElapsed);

    this.queueTimer = setInterval(async () => {
      secondsElapsed++;

      if (this.activeSearchId !== searchId) {
        clearInterval(this.queueTimer);
        return;
      }

      this._notifyStatus(`2v2 Rakip Takım Aranıyor... [${secondsElapsed}s]`, secondsElapsed);

      if (secondsElapsed >= 6) {
        clearInterval(this.queueTimer);
        this._notifyStatus(`Rakip Takım Bulundu! (2v2 Maç Başlatılıyor...)`, 6);

        const bot1 = this._generateBotOpponent(p1Stats.elo, user);
        bot1.displayName = 'Bot Mert 🤖';
        const bot2 = this._generateBotOpponent(p1Stats.elo, user);
        bot2.displayName = 'Bot Elif 🤖';

        onMatchFound({
          matchId: `2v2_match_${Date.now()}`,
          is2v2: true,
          isBotTeam: true,
          modeId: mode2v2Id,
          teamA: [
            { uid: user?.uid || 'guest', displayName: user?.displayName || 'Siz', elo: p1Stats.elo, rank: p1Stats.rank },
            { uid: teammate?.uid || 'mate', displayName: teammate?.displayName || (teammate?.isBot ? 'Bot Efe 🤝' : 'Takım Arkadaşı'), elo: p1Stats.elo, rank: p1Stats.rank, isBot: !!teammate?.isBot },
          ],
          teamB: [
            bot1,
            bot2,
          ],
        });
      }
    }, 1000);
  }

  cancelSearch() {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
    if (typeof this.queueUnsubscribe === 'function') {
      try {
        this.queueUnsubscribe();
      } catch {}
      this.queueUnsubscribe = null;
    }
    this.activeSearchId = null;
    this._cleanupQueueDoc();
  }

  async _cleanupQueueDoc() {
    const fns = await getFsFns();
    if (this.currentUser?.uid && db && fns) {
      try {
        const ref = fns.doc(db, 'matchmaking', this.currentUser.uid);
        fns.deleteDoc(ref).catch(() => {});
      } catch {}
    }
    this.queueDocRef = null;
  }

  _notifyStatus(text, seconds) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback({ text, seconds });
    }
  }

  /**
   * Bot Rakip Üretici
   */
  _generateBotOpponent(playerElo, user) {
    const playerRank = getRankByElo(playerElo);
    const botNames = [
      'GeoMaster_99', 'AtlasRunner', 'TerraQuest', 'CompassPro', 'GlobeTrotter',
      'CartoKing', 'GeoNinja', 'MapWizard', 'Explorer_TR', 'GeoRider'
    ];
    const name = botNames[Math.floor(Math.random() * botNames.length)];

    return {
      uid: `bot_${Math.random().toString(36).substr(2, 6)}`,
      displayName: `${name} 🤖`,
      elo: playerElo + Math.floor(Math.random() * 10 - 5),
      rank: playerRank,
      isBot: true,
      targetAvgScore: playerRank.botAvgScore,
    };
  }

  /**
   * Botun tur başına vereceği cevabı ve mesafeyi hesaplar.
   * Pin konumu ve verilen puan %100 matematiksel olarak tutarlıdır.
   */
  calculateBotAnswer(targetCity, botAvgScore) {
    if (!targetCity) {
      return { score: 500, distanceKm: 400, lat: 0, lng: 0, delayMs: 4000 };
    }
    // Hedef puan etrafında rastgele hafif sapma (±60)
    const baseScore = Math.max(100, Math.min(950, (botAvgScore || 400) + Math.floor(Math.random() * 120 - 60)));
    
    // Mesafeyi puana göre hesapla
    let distanceKm = 0;
    if (baseScore >= 750) {
      distanceKm = 1000 - baseScore; // 50 - 250 km
    } else if (baseScore >= 450) {
      distanceKm = 250 + (750 - baseScore) / 2; // 250 - 400 km
    } else {
      distanceKm = 400 + (450 - baseScore) * 3; // 400 - 1000 km
    }

    // Tam 360 derece rastgele açı
    const theta = Math.random() * 2 * Math.PI;

    // Hedef şehirden tam distanceKm kadar uzağa koordinat hesapla
    const latOffset = (distanceKm * Math.cos(theta)) / 111.32;
    const cosLat = Math.max(0.2, Math.cos((targetCity.lat * Math.PI) / 180));
    const lngOffset = (distanceKm * Math.sin(theta)) / (111.32 * cosLat);

    const botLat = (targetCity.lat || 0) + latOffset;
    const botLng = (targetCity.lng || 0) + lngOffset;

    // Haritadaki pin ile verilen puan tam birebir tutarlı olsun
    const actualDistance = haversineDistance(botLat, botLng, targetCity.lat || 0, targetCity.lng || 0);
    const actualScore = distanceToScore(actualDistance);

    return {
      score: actualScore,
      distanceKm: Math.round(actualDistance),
      lat: botLat,
      lng: botLng,
      delayMs: 3000 + Math.random() * 4000, // 3 - 7 saniye arası cevap verir
    };
  }
}

export default new MatchmakingEngine();
