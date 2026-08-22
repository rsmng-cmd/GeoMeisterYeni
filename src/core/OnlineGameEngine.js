// OnlineGameEngine.js — 10 Soruluk 1v1 ve Çoklu Oyuncu Eşzamanlı Online Maç Motoru
import { MapEngine } from './MapEngine.js';
import { getCitiesForMode } from '../data/index.js';
import { distanceToScore as calculateScore, haversineDistance as calculateDistance } from './Scorer.js';
import matchmakingEngine from '../services/MatchmakingEngine.js';
import onlineService from '../services/OnlineService.js';
import soundService from '../services/SoundService.js';
import { getSeededQuestions } from '../utils/seededQuestions.js';
import { db, firebaseReady } from '../config/firebase.js';

let fsFns = null;
if (firebaseReady && db) {
  try {
    fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  } catch (e) {
    console.warn('[OnlineGameEngine] Firestore module load warning:', e.message);
  }
}

export class OnlineGameEngine {
  constructor({ modeConfig, matchData, user, onStateChange, onGameOver }) {
    this.modeConfig = modeConfig;
    this.matchData = matchData; // matchId, opponent / players, isBot, questions vb.
    this.matchId = matchData.matchId || `match_${Date.now()}`;
    this.isFriendMatch = !!matchData.isFriendMatch;
    this.user = user;
    this.onStateChange = onStateChange;
    this.onGameOver = onGameOver;

    this.mapEngine = null;
    this.questions = (matchData.questions && matchData.questions.length >= 10) ? matchData.questions : [];
    this.currentRoundIndex = 0;
    this.totalRounds = 10;
    this.playerRounds = [];

    this.is2v2 = !!matchData.is2v2;
    this.teamA = matchData.teamA || [];
    this.teamB = matchData.teamB || [];

    // Oyuncu ve Rakip Skorları
    this.playersState = {
      me: {
        uid: user?.uid || 'guest',
        displayName: user?.displayName || 'Siz',
        elo: matchData.player?.elo || 50,
        rank: matchData.player?.rank,
        score: 0,
        currentGuess: null,
        totalKm: 0,
      },
      opponent: {
        uid: matchData.opponent?.uid || 'opponent',
        displayName: matchData.opponent?.displayName || 'Rakip',
        elo: matchData.opponent?.elo || 50,
        rank: matchData.opponent?.rank,
        isBot: !!matchData.isBot,
        score: 0,
        currentGuess: null,
        totalKm: 0,
      },
    };

    if (this.is2v2) {
      this.teamAScore = 0;
      this.teamBScore = 0;
      this.teamGuesses = { teamA: [], teamB: [] };
    }

    this.roundTimer = null;
    this.timeLeftSeconds = 12;
    this.phase = 'idle'; // 'guessing', 'reveal_3s', 'scoreboard_3s', 'finished'
    this.phaseTimer = null;
    this.matchUnsubscribe = null;
    this._localPollTimer = null;

    // AFK Takip Değişkenleri (10s Sekme Dışı, 30s Hareketsiz)
    this._lastUserActionTime = Date.now();
    this._afkCheckTimer = null;
    this._visibilityAfkTimer = null;

    // Dinamik Bot Zorluğu Gücü
    this.currentBotPower = matchData.opponent?.targetAvgScore || 350;

    // Sekme Kapatma / Oyundan Çıkma Dinleyicisi
    this._unloadHandler = this._handleBeforeUnload.bind(this);
    window.addEventListener('beforeunload', this._unloadHandler);
  }

  /**
   * Haritayı ve 10 Soruyu Hazırlar, Canlı Senkronizasyonu Başlatır
   */
  async start(mapContainerId) {
    this.mapEngine = new MapEngine(mapContainerId, this.modeConfig, (lat, lng) => {
      this._recordUserAction();
      this._onPlayerGuess({ lat, lng });
    }).init();

    this.mapEngine.onMapClick((latlng) => {
      this._recordUserAction();
      this._onPlayerGuess(latlng);
    });

    // 10 Eşzamanlı Soru — Ortak tohum üzerinden %100 senkronize garantisi
    const seedKey = this.matchData?.roomCode 
      || this.matchData?.matchId 
      || this.matchId 
      || 'GEO_MATCH_SEED';

    const dataSource = this.modeConfig.dataSource || this.modeConfig.id || 'world';

    if (!this.questions || this.questions.length < this.totalRounds) {
      this.questions = getSeededQuestions(dataSource, seedKey, this.totalRounds);
    }

    // AFK Kontrolünü Başlat
    this._startAfkMonitoring();

    // Canlı İki İnsan Maçı için Firestore Senkronizasyonunu Kur
    if (!this.playersState.opponent.isBot) {
      await this._initLiveMatchSync();
    }

    this.currentRoundIndex = 0;
    this._startRound();
  }

  _recordUserAction() {
    this._lastUserActionTime = Date.now();
  }

  _startAfkMonitoring() {
    this._recordUserAction();

    // Kullanıcı etkileşimlerini dinle (hareket, tıklama, tuş)
    this._userActionListener = () => this._recordUserAction();
    window.addEventListener('pointermove', this._userActionListener, { passive: true });
    window.addEventListener('pointerdown', this._userActionListener, { passive: true });
    window.addEventListener('keydown', this._userActionListener, { passive: true });
    window.addEventListener('touchstart', this._userActionListener, { passive: true });
    window.addEventListener('wheel', this._userActionListener, { passive: true });

    // 1) 30 Saniye Boyunca Hiçbir Hareket Yapılmadıysa AFK Hükmen Mağlubiyet
    if (this._afkCheckTimer) clearInterval(this._afkCheckTimer);
    this._afkCheckTimer = setInterval(() => {
      if (this.phase !== 'finished' && this.phase !== 'idle') {
        const idleDuration = Date.now() - this._lastUserActionTime;
        if (idleDuration >= 30_000) {
          console.warn('[OnlineGameEngine] ⏱️ 30 saniye hareketsizlik tespit edildi (AFK Forfeit).');
          this._triggerAfkForfeit('30 saniye boyunca herhangi bir hareket (tıklama, kaydırma, zoom) yapmadığınız (AFK) için maç kaybedildi.');
        }
      }
    }, 1000);

    // 2) 10 Saniye Boyunca Ekran Kapatıldıysa / Sekmeden Çıkıldıysa AFK Hükmen Mağlubiyet
    this._visibilityHandler = () => {
      if (document.visibilityState === 'hidden' && this.phase !== 'finished' && this.phase !== 'idle') {
        if (this._visibilityAfkTimer) clearTimeout(this._visibilityAfkTimer);
        this._visibilityAfkTimer = setTimeout(() => {
          if (document.visibilityState === 'hidden' && this.phase !== 'finished' && this.phase !== 'idle') {
            console.warn('[OnlineGameEngine] ⏱️ 10 saniye sekme dışı kalındı (AFK Forfeit).');
            this._triggerAfkForfeit('10 saniye boyunca sekme dışında kaldığınız veya ekran kapalı olduğu için maç kaybedildi.');
          }
        }, 10_000);
      } else if (document.visibilityState === 'visible') {
        if (this._visibilityAfkTimer) {
          clearTimeout(this._visibilityAfkTimer);
          this._visibilityAfkTimer = null;
        }
        this._recordUserAction();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  /**
   * Canlı 1v1 Maç Eşzamanlı Firestore & LocalStorage Dinleyicisini Başlatır
   */
  async _initLiveMatchSync() {
    // 1. Canlı Maç Belgesini Başlat / Güncelle
    const initialDoc = {
      matchId: this.matchId,
      modeId: this.modeConfig.id,
      questions: this.questions,
      status: 'playing',
      players: {
        [this.user.uid]: {
          displayName: this.user.displayName || 'Oyuncu',
          ready: true,
        },
      },
      updatedAt: Date.now(),
    };

    try {
      localStorage.setItem(`gm_live_${this.matchId}`, JSON.stringify(initialDoc));
    } catch {}

    if (db && fsFns) {
      try {
        const ref = fsFns.doc(db, 'liveMatches', this.matchId);
        await fsFns.setDoc(ref, initialDoc, { merge: true });

        // Firestore Listener
        this.matchUnsubscribe = fsFns.onSnapshot(ref, (docSnap) => {
          if (!docSnap.exists()) return;
          const data = docSnap.data();
          this._handleLiveMatchUpdate(data);
        }, (err) => {
          console.warn('[OnlineGameEngine] Firestore match listener error:', err);
        });
      } catch (e) {
        console.warn('[OnlineGameEngine] Firestore live match init error:', e);
      }
    }

    // LocalStorage Fallback Polling (Aynı tarayıcıda çoklu sekme veya anlık yerel güncellemeler)
    let lastRaw = '';
    this._localPollTimer = setInterval(() => {
      try {
        const raw = localStorage.getItem(`gm_live_${this.matchId}`);
        if (raw && raw !== lastRaw) {
          lastRaw = raw;
          const data = JSON.parse(raw);
          this._handleLiveMatchUpdate(data);
        }
      } catch {}
    }, 400);
  }

  /**
   * Canlı maç belgesi güncellendiğinde gelen veriyi işler (Tahminler, Hükmen Çıkış, Bitiş)
   */
  _handleLiveMatchUpdate(data) {
    if (!data || this.phase === 'finished') return;

    const oppUid = this.playersState.opponent.uid;

    // 1. Eğer maç hükmen sonlandıysa (AFK / Sekmeden çıkma / Terk etme)
    if (data.status === 'forfeit') {
      if (data.forfeitedBy === this.user.uid || (data.winnerUid && data.winnerUid !== this.user.uid)) {
        // Bu oyuncu AFK kaldı veya sekme dışına çıktı -> Hükmen Mağlubiyet
        this._handleSelfForfeit(data);
      } else {
        // Rakip AFK kaldı veya oyundan ayrıldı -> Hükmen Galibiyet
        this._handleOpponentForfeit(data);
      }
      return;
    }

    // 2. Eğer maç normal olarak sonlandıysa (10 soru bittiyse)
    if (data.status === 'finished') {
      const oppFinalScore = data[`finalScore_${oppUid}`] ?? data.players?.[oppUid]?.score;
      if (oppFinalScore !== undefined) {
        this.playersState.opponent.score = oppFinalScore;
      }
      this._finishGame(true);
      return;
    }

    // 3. Eğer ilk başta sorular senkronize edildiyse
    if (data.questions && data.questions.length >= this.totalRounds && (!this.questions || this.questions.length === 0)) {
      this.questions = data.questions;
    }

    // 4. Rakibin bu tura ait cevabı geldiyse
    const oppGuessKey = `guess_${this.currentRoundIndex}_${oppUid}`;
    const oppGuess = data[oppGuessKey];

    if (oppGuess && !this.playersState.opponent.currentGuess && this.phase === 'guessing') {
      this.playersState.opponent.currentGuess = oppGuess;
      this._checkBothAnswered();
    }
  }

  /**
   * Turu Başlatır ve 12 Saniyelik Sayacı Çalıştırır
   */
  _startRound() {
    if (this.currentRoundIndex >= this.totalRounds) {
      this._finishGame();
      return;
    }

    this.phase = 'guessing';
    this.timeLeftSeconds = 12;
    this.playersState.me.currentGuess = null;
    this.playersState.opponent.currentGuess = null;

    this.mapEngine.resetForNewRound();
    this.mapEngine.enableClick();

    const currentQuestion = this.questions[this.currentRoundIndex];

    // Bot Rakip Varsa Botun Cevabını Planla
    if (this.is2v2) {
      this.p2Guess = null;
      this.opp1Guess = null;
      this.opp2Guess = null;

      const p2BotAns = matchmakingEngine.calculateBotAnswer(currentQuestion, this.currentBotPower);
      const opp1BotAns = matchmakingEngine.calculateBotAnswer(currentQuestion, this.currentBotPower);
      const opp2BotAns = matchmakingEngine.calculateBotAnswer(currentQuestion, this.currentBotPower);

      setTimeout(() => { if (this.phase === 'guessing') this.p2Guess = p2BotAns; }, p2BotAns.delayMs);
      setTimeout(() => { if (this.phase === 'guessing') this.opp1Guess = opp1BotAns; }, opp1BotAns.delayMs);
      setTimeout(() => { if (this.phase === 'guessing') this.opp2Guess = opp2BotAns; }, opp2BotAns.delayMs);
    } else if (this.playersState.opponent.isBot) {
      const botAns = matchmakingEngine.calculateBotAnswer(
        currentQuestion,
        this.currentBotPower
      );

      setTimeout(() => {
        if (this.phase === 'guessing') {
          this.playersState.opponent.currentGuess = botAns;
          this._checkBothAnswered();
        }
      }, botAns.delayMs);
    }

    // 12 Saniyelik Geri Sayım Zamanlayıcı
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundTimer = setInterval(() => {
      this.timeLeftSeconds--;
      this._emitState();

      if (this.timeLeftSeconds <= 0) {
        clearInterval(this.roundTimer);
        this._handleRoundTimeOut();
      }
    }, 1000);

    this._emitState();
  }

  /**
   * Oyuncu Haritaya Tıkladığında Tahminini Alır ve Eşzamanlı Yayınlar
   */
  _onPlayerGuess(latlng) {
    if (this.phase !== 'guessing' || this.playersState.me.currentGuess) return;

    const currentQuestion = this.questions[this.currentRoundIndex];
    const dist = calculateDistance(latlng.lat, latlng.lng, currentQuestion.lat, currentQuestion.lng);
    const score = calculateScore(dist);

    const myGuess = {
      lat: latlng.lat,
      lng: latlng.lng,
      distanceKm: Math.round(dist),
      score,
      timedOut: false,
    };

    this.playersState.me.currentGuess = myGuess;

    // Kendi tahmin pinini haritada göster
    this.mapEngine.addGuessMarker(latlng.lat, latlng.lng, 'Siz');
    this.mapEngine.disableClick();

    // Canlı rakibe tahmini yayınla
    if (!this.playersState.opponent.isBot) {
      this._publishMyGuess(this.currentRoundIndex, myGuess);
    }

    this._checkBothAnswered();
    this._emitState();
  }

  /**
   * Kendi tahminimizi Firestore ve localStorage'a yazar
   */
  async _publishMyGuess(roundIndex, guess) {
    const key = `guess_${roundIndex}_${this.user.uid}`;
    try {
      const raw = localStorage.getItem(`gm_live_${this.matchId}`);
      const obj = raw ? JSON.parse(raw) : {};
      obj[key] = guess;
      localStorage.setItem(`gm_live_${this.matchId}`, JSON.stringify(obj));
    } catch {}

    if (db && fsFns) {
      try {
        const ref = fsFns.doc(db, 'liveMatches', this.matchId);
        await fsFns.setDoc(ref, {
          [key]: guess,
          updatedAt: Date.now(),
        }, { merge: true });
      } catch (e) {
        console.warn('[OnlineGameEngine] Guess publish error:', e);
      }
    }
  }

  /**
   * 12 Saniye Dolduğunda Cevap Vermeyen Oyunculara 0 Puan Verir
   */
  _handleRoundTimeOut() {
    if (this.phase !== 'guessing') return;

    if (!this.playersState.me.currentGuess) {
      const timeoutGuess = { lat: 0, lng: 0, distanceKm: 9999, score: 0, timedOut: true };
      this.playersState.me.currentGuess = timeoutGuess;
      if (!this.playersState.opponent.isBot) {
        this._publishMyGuess(this.currentRoundIndex, timeoutGuess);
      }
    }
    if (!this.playersState.opponent.currentGuess) {
      this.playersState.opponent.currentGuess = { lat: 0, lng: 0, distanceKm: 9999, score: 0, timedOut: true };
    }

    this._start3sRevealPhase();
  }

  _checkBothAnswered() {
    if (this.is2v2) {
      if (this.playersState.me.currentGuess) {
        if (this.roundTimer) clearInterval(this.roundTimer);
        this._start3sRevealPhase();
      }
    } else if (this.playersState.me.currentGuess && this.playersState.opponent.currentGuess) {
      if (this.roundTimer) clearInterval(this.roundTimer);
      this._start3sRevealPhase();
    }
  }

  /**
   * 1. AŞAMA: 3 Saniyelik Konum & Tahmin Gösterimi (Haritada Oyuncu Pinleri + Doğru Konum + Çizgiler)
   */
  _start3sRevealPhase() {
    this.phase = 'reveal_3s';
    const currentQuestion = this.questions[this.currentRoundIndex];

    if (this.is2v2) {
      const p1 = this.playersState.me.currentGuess || { lat: 0, lng: 0, distanceKm: 9999, score: 0, timedOut: true };
      const p2 = this.p2Guess || matchmakingEngine.calculateBotAnswer(currentQuestion, this.currentBotPower);
      const opp1 = this.opp1Guess || matchmakingEngine.calculateBotAnswer(currentQuestion, this.currentBotPower);
      const opp2 = this.opp2Guess || matchmakingEngine.calculateBotAnswer(currentQuestion, this.currentBotPower);

      // Takım Ortalama Mesafeleri ve Skorları
      const teamADist = Math.round((p1.distanceKm + p2.distanceKm) / 2);
      const teamAScore = calculateScore(teamADist);

      const teamBDist = Math.round((opp1.distanceKm + opp2.distanceKm) / 2);
      const teamBScore = calculateScore(teamBDist);

      this.playersState.me.score += teamAScore;
      this.playersState.me.totalKm += teamADist;

      this.playersState.opponent.score += teamBScore;
      this.playersState.opponent.totalKm += teamBDist;

      // Dinamik Bot Adaptasyonu
      const scoreDiff = teamAScore - teamBScore;
      const botAdjust = Math.round(scoreDiff * 0.1);
      this.currentBotPower = Math.max(100, Math.min(920, this.currentBotPower + botAdjust));

      if (teamAScore >= 800) soundService.playPerfect();
      else if (teamAScore >= 500) soundService.playGood();

      // 4 Oyuncunun Pinlerini Haritada Göster
      this.mapEngine.clearMarkers();
      this.mapEngine.addAnswerMarker(currentQuestion.lat, currentQuestion.lng, `${currentQuestion.name}, ${currentQuestion.country}`);

      if (!p1.timedOut) this.mapEngine.addGuessMarker(p1.lat, p1.lng, 'Siz');
      if (p2.lat && p2.lng) this.mapEngine.addCustomMarker(p2.lat, p2.lng, '#06b6d4', this.teamA[1]?.displayName || 'Takım Arkadaşı');
      if (opp1.lat && opp1.lng) this.mapEngine.addCustomMarker(opp1.lat, opp1.lng, '#ef4444', this.teamB[0]?.displayName || 'Rakip 1');
      if (opp2.lat && opp2.lng) this.mapEngine.addCustomMarker(opp2.lat, opp2.lng, '#f97316', this.teamB[1]?.displayName || 'Rakip 2');

    } else {
      // 1v1 Skor Hesaplama
      const meScore = this.playersState.me.currentGuess?.score || 0;
      const oppScore = this.playersState.opponent.currentGuess?.score || 0;

      this.playersState.me.score += meScore;
      this.playersState.me.totalKm += (this.playersState.me.currentGuess?.distanceKm || 0);

      this.playerRounds.push({
        city: currentQuestion.name,
        country: currentQuestion.country,
        lat: currentQuestion.lat,
        lng: currentQuestion.lng,
        score: meScore,
        distance: Math.round(this.playersState.me.currentGuess?.distanceKm || 0),
      });

      // Online tahmin verisini ısı haritasına kaydet
      if (this.playersState.me.currentGuess) {
        import('../services/ScoreService.js').then(({ ScoreService }) => {
          new ScoreService().saveRoundGuess(this.user, this.modeConfig?.id || 'world', {
            city: currentQuestion,
            score: meScore,
            distanceKm: this.playersState.me.currentGuess.distanceKm,
          });
        }).catch(() => {});
      }

      this.playersState.opponent.score += oppScore;
      this.playersState.opponent.totalKm += (this.playersState.opponent.currentGuess?.distanceKm || 0);

      if (this.playersState.opponent.isBot) {
        const scoreDiff = meScore - oppScore;
        const botAdjust = Math.round(scoreDiff * 0.1);
        this.currentBotPower = Math.max(100, Math.min(920, this.currentBotPower + botAdjust));
      }

      if (meScore >= 800) soundService.playPerfect();
      else if (meScore >= 500) soundService.playGood();

      this.mapEngine.clearMarkers();
      this.mapEngine.addAnswerMarker(currentQuestion.lat, currentQuestion.lng, `${currentQuestion.name}, ${currentQuestion.country}`);

      if (this.playersState.me.currentGuess && !this.playersState.me.currentGuess.timedOut) {
        this.mapEngine.addGuessMarker(this.playersState.me.currentGuess.lat, this.playersState.me.currentGuess.lng, 'Siz');
        this.mapEngine.drawLine(
          [this.playersState.me.currentGuess.lat, this.playersState.me.currentGuess.lng],
          [currentQuestion.lat, currentQuestion.lng],
          '#6366f1'
        );
      }

      // 1v1 Rakip Pini & Çizgisi
      if (this.playersState.opponent.currentGuess && !this.playersState.opponent.currentGuess.timedOut) {
        this.mapEngine.addCustomMarker(
          this.playersState.opponent.currentGuess.lat,
          this.playersState.opponent.currentGuess.lng,
          '#ec4899',
          this.playersState.opponent.displayName
        );
        this.mapEngine.drawLine(
          [this.playersState.opponent.currentGuess.lat, this.playersState.opponent.currentGuess.lng],
          [currentQuestion.lat, currentQuestion.lng],
          '#ec4899'
        );
      }
    }

    // Kamera Zoom Sınırları
    this.mapEngine.fitBoundsToMarkers();
    this._emitState();

    // 3 Saniye Sonra Skor Tablosu Aşamasına Geç
    this.phaseTimer = setTimeout(() => {
      this._start3sScoreboardPhase();
    }, 3000);
  }

  /**
   * 2. AŞAMA: 3 Saniyelik Canlı Skor Tablosu Pop-up'ı
   */
  _start3sScoreboardPhase() {
    this.phase = 'scoreboard_3s';
    this._emitState();

    if (this.currentRoundIndex + 1 >= this.totalRounds) {
      this.phaseTimer = setTimeout(() => {
        this._finishGame();
      }, 3000);
      return;
    }

    this.phaseTimer = setTimeout(() => {
      this.currentRoundIndex++;
      this._startRound();
    }, 3000);
  }

  /**
   * AFK Kalındığında veya 10s Sekme Dışına Çıkıldığında Hükmen Mağlubiyet Tetikle
   */
  async _triggerAfkForfeit(reason = 'AFK') {
    if (this.phase === 'finished') return;
    this.phase = 'finished';

    const forfeitData = {
      status: 'forfeit',
      forfeitedBy: this.user?.uid || 'guest',
      forfeitReason: 'afk',
      forfeitDetails: reason,
      winnerUid: this.playersState.opponent.uid,
      updatedAt: Date.now(),
    };

    try {
      const raw = localStorage.getItem(`gm_live_${this.matchId}`);
      const obj = raw ? JSON.parse(raw) : {};
      Object.assign(obj, forfeitData);
      localStorage.setItem(`gm_live_${this.matchId}`, JSON.stringify(obj));
    } catch {}

    if (db) {
      try {
        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const ref = doc(db, 'liveMatches', this.matchId);
        await setDoc(ref, forfeitData, { merge: true });
      } catch (e) {}
    }

    // Kendisine -10 ELO uygula
    let eloResult = {
      oldElo: 1000,
      newElo: 990,
      eloDelta: -10,
      isRanked: true,
      rank: { name: 'Oyuncu', color: '#38bdf8', icon: '🏆' },
    };

    if (!this.isFriendMatch && this.user && !this.user.isGuest) {
      try {
        eloResult = await onlineService.updateMatchResult(this.user, this.modeConfig.id, false);
      } catch {}
    }

    this.destroy();

    // Hükmen mağlubiyet modalını göster
    if (typeof this.onGameOver === 'function') {
      this.onGameOver({
        isWin: false,
        isForfeit: true,
        forfeitReason: 'afk',
        forfeitDetails: reason,
        me: this.playersState.me || { score: this.playersState.me?.score || 0, displayName: 'Siz' },
        opponent: this.playersState.opponent || { score: this.playersState.opponent?.score || 0, displayName: 'Rakip' },
        eloResult,
        mode: this.modeConfig,
        rounds: this.playerRounds || [],
      });
    }
  }

  /**
   * Oyuncu AFK Kaldığında veya Sekme Dışına Çıktığında Hükmen Mağlup Sayılır
   */
  async _handleSelfForfeit(data = null) {
    if (this.phase === 'finished') return;
    this.phase = 'finished';

    this.destroy();

    const reason = data?.forfeitDetails || '10 saniye sekme dışı veya 30 saniye hareketsiz (AFK) kaldığınız için hükmen mağlup sayıldınız.';

    let eloResult = {
      oldElo: 1000,
      newElo: 990,
      eloDelta: -10,
      isRanked: true,
      rank: { name: 'Oyuncu', color: '#38bdf8', icon: '🏆' },
    };

    if (!this.isFriendMatch && this.user && !this.user.isGuest) {
      try {
        eloResult = await onlineService.updateMatchResult(this.user, this.modeConfig.id, false);
      } catch {}
    }

    if (typeof this.onGameOver === 'function') {
      this.onGameOver({
        isWin: false,
        isForfeit: true,
        forfeitReason: 'afk',
        forfeitDetails: reason,
        me: this.playersState.me || { score: this.playersState.me?.score || 0, displayName: 'Siz' },
        opponent: this.playersState.opponent || { score: this.playersState.opponent?.score || 0, displayName: 'Rakip' },
        eloResult,
        mode: this.modeConfig,
        rounds: this.playerRounds || [],
      });
    }
  }

  /**
   * Rakip Oyuncu Maçı Terk Ettiğinde veya AFK Kaldığında Çağrılır (Hükmen Galibiyet)
   */
  async _handleOpponentForfeit(forfeitData = null) {
    if (this.phase === 'finished') return;
    this.phase = 'finished';

    this.destroy();

    soundService.playWin();

    // Kazanan oyuncuya +10 ELO
    let eloResult = {
      oldElo: 1000,
      newElo: 1010,
      eloDelta: 10,
      isRanked: true,
      rank: { name: 'Oyuncu', color: '#38bdf8', icon: '🏆' },
    };

    try {
      if (!this.isFriendMatch && this.user && !this.user.isGuest) {
        eloResult = await onlineService.updateMatchResult(this.user, this.modeConfig.id, true);
      }
    } catch (err) {
      console.warn('[OnlineGameEngine] Forfeit ELO update warning:', err);
    }

    if (typeof this.onGameOver === 'function') {
      this.onGameOver({
        isWin: true,
        isForfeit: true,
        forfeitReason: 'opponent_forfeit',
        forfeitDetails: forfeitData?.forfeitReason === 'afk' 
          ? 'Rakip 10s sekme dışı veya 30s hareketsiz (AFK) kaldığı için maçı hükmen kazandınız! 🥇' 
          : 'Rakip oyundan ayrıldı, maçı hükmen kazandınız! 🥇',
        me: this.playersState.me || { score: this.playersState.me.score, displayName: 'Siz' },
        opponent: this.playersState.opponent || { score: this.playersState.opponent.score, displayName: 'Rakip' },
        eloResult,
        mode: this.modeConfig,
        rounds: this.playerRounds || [],
      });
    }
  }

  /**
   * Kullanıcı Onay Verip Oyundan Çıkmak İstediğinde Çağrılır (Hükmen Mağlubiyet)
   */
  async forfeitAndLeave() {
    if (this.phase === 'finished') return;
    this.phase = 'finished';

    // Firestore & localStorage'a maçı terk ettiğini yaz
    const forfeitData = {
      status: 'forfeit',
      forfeitedBy: this.user?.uid || 'guest',
      forfeitReason: 'leave',
      winnerUid: this.playersState.opponent.uid,
      updatedAt: Date.now(),
    };

    try {
      const raw = localStorage.getItem(`gm_live_${this.matchId}`);
      const obj = raw ? JSON.parse(raw) : {};
      Object.assign(obj, forfeitData);
      localStorage.setItem(`gm_live_${this.matchId}`, JSON.stringify(obj));
    } catch {}

    if (db) {
      try {
        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const ref = doc(db, 'liveMatches', this.matchId);
        await setDoc(ref, forfeitData, { merge: true });
      } catch (e) {}
    }

    // Kendisine -10 ELO uygula
    if (!this.isFriendMatch && this.user && !this.user.isGuest) {
      try {
        await onlineService.updateMatchResult(this.user, this.modeConfig.id, false);
      } catch {}
    }

    this.destroy();
  }

  /**
   * MAÇ BİTTİ: ELO Güncellemesi & Sonuçlar
   */
  async _finishGame(fromRemote = false) {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    if (this.roundTimer) clearInterval(this.roundTimer);
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    window.removeEventListener('beforeunload', this._unloadHandler);

    const meScore = this.playersState.me?.score || 0;
    const oppScore = this.playersState.opponent?.score || 0;
    const isWin = meScore >= oppScore;
    if (isWin) soundService.playWin();

    // Firestore & localStorage'a maçın bittiğini ve skorumuzu yaz
    if (!fromRemote && !this.playersState.opponent.isBot) {
      const matchEndData = {
        status: 'finished',
        [`finalScore_${this.user.uid}`]: meScore,
        [`rounds_${this.user.uid}`]: this.playerRounds || [],
        updatedAt: Date.now(),
      };

      try {
        const raw = localStorage.getItem(`gm_live_${this.matchId}`);
        const obj = raw ? JSON.parse(raw) : {};
        Object.assign(obj, matchEndData);
        localStorage.setItem(`gm_live_${this.matchId}`, JSON.stringify(obj));
      } catch {}

      if (db) {
        try {
          const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          const ref = doc(db, 'liveMatches', this.matchId);
          await setDoc(ref, matchEndData, { merge: true });
        } catch (e) {}
      }
    }

    // ELO Güncellemesi (Maksimum 1.2 sn bekle, takılma riskine karşı fail-safe)
    let eloResult = {
      oldElo: 1000,
      newElo: isWin ? 1010 : 990,
      eloDelta: isWin ? 10 : -10,
      isRanked: true,
      rank: { name: 'Oyuncu', color: '#38bdf8', icon: '🏆' },
    };

    try {
      const modeId = this.modeConfig?.id || 'world';
      const updatePromise = this.isFriendMatch
        ? onlineService.getPlayerOnlineStats(this.user, modeId).then(stats => ({
            oldElo: stats.elo, newElo: stats.elo, eloDelta: 0, rank: stats.rank, isRanked: stats.isRanked
          }))
        : onlineService.updateMatchResult(this.user, modeId, isWin);

      const res = await Promise.race([
        updatePromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1200))
      ]);
      if (res) eloResult = res;
    } catch (err) {
      console.warn('[OnlineGameEngine] ELO update fallback applied:', err);
    }

    // Oyun sonu modalını göster
    if (typeof this.onGameOver === 'function') {
      this.onGameOver({
        isWin,
        isForfeit: false,
        me: this.playersState.me || { score: meScore, displayName: 'Siz' },
        opponent: this.playersState.opponent || { score: oppScore, displayName: 'Rakip' },
        eloResult,
        mode: this.modeConfig,
        rounds: this.playerRounds || [],
      });
    }
  }

  /**
   * Oyuncu sekmeyi kapatırsa HÜKMEN MAĞLUP sayılır (-10 ELO)
   */
  _handleBeforeUnload() {
    if (this.phase !== 'finished' && this.phase !== 'idle') {
      this.forfeitAndLeave();
    }
  }

  destroy() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    if (this._afkCheckTimer) clearInterval(this._afkCheckTimer);
    if (this._visibilityAfkTimer) clearTimeout(this._visibilityAfkTimer);
    if (this._localPollTimer) clearInterval(this._localPollTimer);
    if (typeof this.matchUnsubscribe === 'function') {
      this.matchUnsubscribe();
      this.matchUnsubscribe = null;
    }
    if (this._userActionListener) {
      window.removeEventListener('pointermove', this._userActionListener);
      window.removeEventListener('pointerdown', this._userActionListener);
      window.removeEventListener('keydown', this._userActionListener);
      window.removeEventListener('touchstart', this._userActionListener);
      window.removeEventListener('wheel', this._userActionListener);
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
    window.removeEventListener('beforeunload', this._unloadHandler);
    if (this.mapEngine) this.mapEngine.destroy();
  }

  _emitState() {
    if (this.onStateChange) {
      this.onStateChange({
        phase: this.phase,
        roundNum: this.currentRoundIndex + 1,
        totalRounds: this.totalRounds,
        currentQuestion: this.questions[this.currentRoundIndex],
        timeLeftSeconds: this.timeLeftSeconds,
        players: this.playersState,
      });
    }
  }
}
