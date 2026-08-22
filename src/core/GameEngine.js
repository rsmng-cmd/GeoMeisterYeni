/**
 * GameEngine.js — GeoMeister Oyun Motoru
 * Tur yönetimi, soru seçimi, state makinesi.
 * Seviye sistemi kaldırıldı — sabit 10 soruluk düz oyun.
 */

import { haversineDistance, distanceToScore, scoreToLabel, formatDistance } from './Scorer.js';
import { MapEngine } from './MapEngine.js';
import { getCitiesForMode } from '../data/index.js';
import { unlockNextLevel } from '../config/levels.js';
import soundService from '../services/SoundService.js';

export const GameState = {
  IDLE: 'idle',
  WAITING_GUESS: 'waiting_guess',
  SHOWING_RESULT: 'showing_result',
  ROUND_OVER: 'round_over',
};

export class GameEngine {
  /**
   * @param {object} modeConfig - Mod konfigürasyonu
   * @param {object} callbacks - UI callback fonksiyonları
   * @param {object} [levelConfig] - İsteğe bağlı seviye konfigürasyonu
   */
  constructor(modeConfig, callbacks = {}, levelConfig = null) {
    this.mode = modeConfig;
    this.callbacks = callbacks;
    this.levelConfig = levelConfig;

    this.state = GameState.IDLE;
    this.cities = [];
    this.cityPool = [];
    this.currentCity = null;
    this.currentRound = 0;
    this.totalRounds = levelConfig?.questions || 10;
    this.totalScore = 0;
    this.rounds = [];
    this.mapEngine = null;
    this.lastGuess = null;
    this.timer = null;
    this.startTime = 0;
    this.timeLeft = 12;
  }

  /**
   * Oyunu başlatır.
   * @param {string} mapContainerId - Leaflet map div ID
   */
  start(mapContainerId) {
    this.cities = getCitiesForMode(this.mode.dataSource);
    this.cityPool = this._shuffle([...this.cities]);
    this.currentRound = 0;
    this.totalScore = 0;
    this.rounds = [];
    this.lastGuess = null;
    this.state = GameState.IDLE;

    this.mapEngine = new MapEngine(
      mapContainerId,
      this.mode,
      (lat, lng) => this._handleGuess(lat, lng)
    ).init();

    this._nextRound();
  }

  /**
   * Sonraki soruya geçer.
   */
  next() {
    if (this.state !== GameState.SHOWING_RESULT) return;
    if (this.timer) clearInterval(this.timer);
    this.mapEngine.resetForNewRound();
    this.mapEngine.flyToDefault();
    this._nextRound();
  }

  /**
   * İpucu kullanır (bölgeye zoom yapar).
   */
  useHint() {
    if (this.state !== GameState.WAITING_GUESS || !this.currentCity) return false;
    this.mapEngine?.zoomToHint(this.currentCity.lat, this.currentCity.lng);
    return true;
  }

  /**
   * Temizler.
   */
  destroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.mapEngine) {
      this.mapEngine.destroy();
      this.mapEngine = null;
    }
    this.state = GameState.IDLE;
  }

  // ─── Private ────────────────────────────────────────────────

  _nextRound() {
    if (this.currentRound >= this.totalRounds) {
      this._endGame();
      return;
    }

    if (this.timer) clearInterval(this.timer);

    this.currentRound++;
    this.lastGuess = null;

    if (this.cityPool.length === 0) {
      this.cityPool = this._shuffle([...this.cities]);
    }

    this.currentCity = this.cityPool.pop();
    this.state = GameState.WAITING_GUESS;
    this.startTime = Date.now();
    this.timeLeft = 12;

    this.callbacks.onRoundStart?.(
      this.currentCity,
      this.currentRound,
      this.totalRounds
    );

    // 12 saniyelik sayaç çalıştır
    this.callbacks.onTimerTick?.(12, 12);
    this.timer = setInterval(() => {
      if (this.state !== GameState.WAITING_GUESS) {
        clearInterval(this.timer);
        return;
      }
      const elapsed = (Date.now() - this.startTime) / 1000;
      this.timeLeft = Math.max(0, 12 - elapsed);
      this.callbacks.onTimerTick?.(this.timeLeft, 12);

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this._handleTimeout();
      }
    }, 100);
  }

  _handleGuess(lat, lng) {
    if (this.state !== GameState.WAITING_GUESS) return;
    if (this.timer) clearInterval(this.timer);

    this.lastGuess = { lat, lng };
    this.state = GameState.SHOWING_RESULT;

    const timeSpentSeconds = Math.max(0, (Date.now() - this.startTime) / 1000);

    const distance = haversineDistance(
      lat, lng,
      this.currentCity.lat,
      this.currentCity.lng
    );

    const score = distanceToScore(distance, this.mode.scoreMultiplier || 1.0, this.mode.id, timeSpentSeconds);
    const { label, tier } = scoreToLabel(score);
    const distanceStr = formatDistance(distance);

    if (score >= 800) soundService.playPerfect();
    else if (score >= 500) soundService.playGood();

    this.totalScore += score;

    const roundResult = {
      city: this.currentCity,
      guessLat: lat,
      guessLng: lng,
      distance,
      distanceStr,
      score,
      label,
      tier,
      timeSpentSeconds,
    };

    if (this.scoreService) {
      this.scoreService.saveRoundGuess(this.user, this.mode.id, roundResult);
    }
    this.rounds.push(roundResult);

    this.mapEngine.showAnswer(
      this.currentCity.lat,
      this.currentCity.lng,
      lat,
      lng
    );

    this.callbacks.onGuessResult?.({
      ...roundResult,
      totalScore: this.totalScore,
      roundNum: this.currentRound,
      totalRounds: this.totalRounds,
    });
  }

  _handleTimeout() {
    if (this.state !== GameState.WAITING_GUESS) return;
    if (this.timer) clearInterval(this.timer);

    this.state = GameState.SHOWING_RESULT;
    this.lastGuess = null;

    const score = 0;
    const distance = 9999;
    const label = 'Süre Doldu ⏱️ (0 Puan)';
    const tier = 'bad';
    const distanceStr = 'Zaman Aşımı';

    this.rounds.push({
      city: this.currentCity,
      guessLat: 0,
      guessLng: 0,
      distance,
      distanceStr,
      score,
      label,
      tier,
      timedOut: true,
      timeSpentSeconds: 12,
    });

    this.mapEngine.showAnswer(
      this.currentCity.lat,
      this.currentCity.lng,
      this.currentCity.lat,
      this.currentCity.lng
    );

    this.callbacks.onGuessResult?.({
      city: this.currentCity,
      guessLat: 0,
      guessLng: 0,
      distance,
      distanceStr,
      score: 0,
      label,
      tier,
      totalScore: this.totalScore,
      roundNum: this.currentRound,
      totalRounds: this.totalRounds,
      timedOut: true,
    });
  }

  _endGame() {
    this.state = GameState.ROUND_OVER;

    const passScore = this.levelConfig?.passScore || 0;
    const isPassed = this.levelConfig ? (this.totalScore >= passScore) : true;
    let unlockedNext = false;

    if (isPassed && this.levelConfig) {
      unlockedNext = unlockNextLevel(this.levelConfig.level);
    }

    this.callbacks.onGameOver?.({
      totalScore: this.totalScore,
      rounds: this.rounds,
      mode: this.mode,
      levelConfig: this.levelConfig,
      isPassed,
      passScore,
      unlockedNext,
      maxPossible: this.totalRounds * 1000,
    });
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
