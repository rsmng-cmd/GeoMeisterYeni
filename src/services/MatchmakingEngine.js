// MatchmakingEngine.js — 1v1 Eşleştirme ve Bot Yapay Zekası Engine
import onlineService, { getRankByElo } from './OnlineService.js';
import { db, firebaseReady } from '../config/firebase.js';
import { haversineDistance, distanceToScore } from '../core/Scorer.js';

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

export class MatchmakingEngine {
  constructor() {
    this.queueTimer = null;
    this.activeSearchId = null;
    this.onStatusChangeCallback = null;
    this.queueDocRef = null;
    this.currentUser = null;

    window.addEventListener('beforeunload', () => this.cancelSearch());
  }

  /**
   * 1v1 Eşleşme Kuyruğunu Başlatır.
   *   - 0-6sn: ±20 ELO yakınlığındaki rakip
   *   - 6-15sn: Tüm ELO seviyelerindeki canlı oyuncu
   *   - 15sn+: Bot Rakip Ataması
   */
  async startSearch({ user, modeId, onStatusChange, onMatchFound }) {
    this.cancelSearch();
    this.onStatusChangeCallback = onStatusChange;

    const stats = await onlineService.getPlayerOnlineStats(user, modeId);
    const searchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.activeSearchId = searchId;

    let secondsElapsed = 0;
    this._notifyStatus(`Eşleşme aranıyor... (±20 ELO) [0s]`, secondsElapsed);

    // Kendi sunucu / Firestore kuyruk kaydını oluştur (non-blocking)
    this.currentUser = user;
    const fns = await getFsFns();
    if (user && !user.isGuest && db && fns) {
      try {
        this.queueDocRef = fns.doc(db, 'matchmakingQueue', user.uid);
        fns.setDoc(this.queueDocRef, {
          uid: user.uid,
          displayName: user.displayName || 'Oyuncu',
          modeId,
          elo: stats.elo,
          joinedAt: Date.now(),
          status: 'waiting',
        }).catch(e => console.warn('[Matchmaking] Queue doc set warning:', e));
      } catch (e) {
        console.warn('[Matchmaking] Queue doc ref warning:', e);
      }
    }

    this.queueTimer = setInterval(async () => {
      secondsElapsed++;

      if (this.activeSearchId !== searchId) {
        clearInterval(this.queueTimer);
        return;
      }

      // 1. Aşama (0 - 6 saniye): ±20 ELO yakınlığındaki gerçek rakipleri ara
      if (secondsElapsed <= 6) {
        this._notifyStatus(`Eşleşme aranıyor... (±20 ELO) [${secondsElapsed}s]`, secondsElapsed);
        try {
          const match = await this._findRealOpponent(user, modeId, stats.elo, 20);
          if (match && this.activeSearchId === searchId) {
            this._cleanupQueueDoc();
            this._handleMatchSuccess(searchId, match, onMatchFound);
            return;
          }
        } catch (e) {
          console.warn('[Matchmaking] Stage 1 opponent search error:', e);
        }
      } 
      // 2. Aşama (6 - 15 saniye): Tüm ELO seviyelerinde gerçek oyuncu ara
      else if (secondsElapsed <= 15) {
        this._notifyStatus(`Uygun rakip aranıyor... (Genişletilmiş ELO) [${secondsElapsed}s]`, secondsElapsed);
        try {
          const match = await this._findRealOpponent(user, modeId, stats.elo, Infinity);
          if (match && this.activeSearchId === searchId) {
            this._cleanupQueueDoc();
            this._handleMatchSuccess(searchId, match, onMatchFound);
            return;
          }
        } catch (e) {
          console.warn('[Matchmaking] Stage 2 opponent search error:', e);
        }
      } 
      // 3. Aşama (15. saniye): Canlı rakip bulunamadığında rütbeye özel Bot Ata
      else {
        clearInterval(this.queueTimer);
        this._cleanupQueueDoc();
        this._notifyStatus(`Rakip bulundu! Maç başlatılıyor...`, 15);
        
        const botOpponent = this._generateBotOpponent(stats.elo, user);
        
        onMatchFound({
          matchId: `bot_match_${Date.now()}`,
          isBot: true,
          modeId,
          player: {
            uid: user?.uid || 'guest',
            displayName: user?.displayName || 'Oyuncu',
            elo: stats.elo,
            rank: stats.rank,
          },
          opponent: botOpponent,
        });
      }
    }, 1000);
  }

  /**
   * 2v2 Takımlı Eşleşme Araması
   * Takım (Siz + Arkadaşınız) için karşı takım (canlı rakip veya 2 Bot) arar.
   */
  async start2v2Search({ user, teammate, modeId, onStatusChange, onMatchFound }) {
    this.cancelSearch();
    this.onStatusChangeCallback = onStatusChange;

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
    this.activeSearchId = null;
    this._cleanupQueueDoc();
  }

  async _cleanupQueueDoc() {
    const fns = await getFsFns();
    if (this.queueDocRef && fns) {
      try {
        fns.deleteDoc(this.queueDocRef).catch(() => {});
      } catch {}
      this.queueDocRef = null;
    }
  }

  _notifyStatus(text, seconds) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback({ text, seconds });
    }
  }

  async _findRealOpponent(user, modeId, playerElo, maxEloDiff) {
    const fns = await getFsFns();
    if (!user || user.isGuest || !db || !fns) return null;
    try {
      const q = fns.query(
        fns.collection(db, 'matchmakingQueue'),
        fns.where('modeId', '==', modeId),
        fns.where('status', '==', 'waiting')
      );

      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 1000));
      const snap = await Promise.race([fns.getDocs(q), timeoutPromise]);

      if (!snap || !snap.docs) return null;

      const now = Date.now();
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (data.uid !== user.uid) {
          // Kuyruk zaman aşımı kontrolü (15 saniyeden eski geçmiş kayıtları ele ve Firestore'dan temizle)
          const joinedTime = typeof data.joinedAt === 'number'
            ? data.joinedAt
            : (data.joinedAt?.toMillis ? data.joinedAt.toMillis() : new Date(data.joinedAt || 0).getTime());

          if (!joinedTime || now - joinedTime > 15000) {
            fns.deleteDoc(docSnap.ref).catch(() => {});
            continue;
          }

          const eloDiff = Math.abs((data.elo || 50) - playerElo);
          if (eloDiff <= maxEloDiff) {
            // Eşleşme bulundu, rakibin kuyruk kaydını sil
            fns.deleteDoc(docSnap.ref).catch(() => {});
            return {
              uid: data.uid,
              displayName: data.displayName || 'Rakip',
              elo: data.elo || 50,
              rank: getRankByElo(data.elo || 50),
              isBot: false,
            };
          }
        }
      }
    } catch (e) {
      console.warn('[Matchmaking] Real opponent search error:', e);
    }
    return null;
  }

  _handleMatchSuccess(searchId, opponent, onMatchFound) {
    if (this.activeSearchId !== searchId) return;
    this.cancelSearch();
    onMatchFound({
      matchId: `live_match_${Date.now()}`,
      isBot: opponent.isBot,
      opponent,
    });
  }

  /**
   * 15 saniye arama sonunda canlı oyuncu bulunamadığında atanan Bot
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
    // Hedef puan etrafında rastgele hafif sapma (±60)
    const baseScore = Math.max(100, Math.min(950, botAvgScore + Math.floor(Math.random() * 120 - 60)));
    
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

    const botLat = targetCity.lat + latOffset;
    const botLng = targetCity.lng + lngOffset;

    // Haritadaki pin ile verilen puan tam birebir tutarlı olsun
    const actualDistance = haversineDistance(botLat, botLng, targetCity.lat, targetCity.lng);
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
