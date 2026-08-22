/**
 * GameUI.js — Oyun Ekranı Yöneticisi
 * Seviye sistemi kaldırıldı. Basit 10 soru → sonuç ekranı akışı.
 */

export class GameUI {
  /**
   * @param {object} callbacks
   * @param {Function} callbacks.onNext - Sonraki soruya geç
   * @param {Function} callbacks.onHome - Ana sayfaya dön
   * @param {Function} callbacks.onReplay - Aynı modu tekrar oyna
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this._bindButtons();
  }

  show() {
    document.getElementById('game-screen').classList.remove('hidden');
    this._bindButtons();
  }

  hide() {
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('online-live-toast')?.remove();
    this._hideResult();
    this._hideGameComplete();
  }

  /**
   * Yeni tur başladığında çağrılır.
   */
  onRoundStart(city, roundNum, totalRounds, levelConfig = null) {
    // Soru güncelle: "Lozan, İsviçre" veya "Kadıköy, İstanbul" formatında göster
    const cityEl = document.getElementById('question-city');
    const countryEl = document.getElementById('question-country');
    if (cityEl) {
      cityEl.textContent = city.country ? `${city.name}, ${city.country}` : city.name;
    }
    if (countryEl) countryEl.style.display = 'none';

    // Başlık
    const titleEl = document.querySelector('.game-panel-title');
    if (titleEl) {
      if (levelConfig) {
        titleEl.textContent = `${levelConfig.icon || '🌱'} ${levelConfig.title} • Target: ${levelConfig.passScore} P`;
      } else {
        titleEl.textContent = '🌍 GeoMeister';
      }
    }

    // Progress bar
    const progress = (roundNum / totalRounds) * 100;
    document.getElementById('round-progress-bar').style.width = `${progress}%`;
    document.getElementById('round-counter').textContent = `${roundNum} / ${totalRounds}`;

    // Üst Bar Sağ Skor Kutusu
    const topRightScoreEl = document.querySelector('.game-top-right');
    if (topRightScoreEl) topRightScoreEl.style.display = 'flex';

    // Sonuç panellerini gizle
    this._hideResult();
    this._hideGameComplete();
  }

  /**
   * 12 Saniyelik Sayacı ve Animasyonlu Çubuğu Günceller
   */
  updateTimer(timeLeft, total = 12) {
    const textEl = document.getElementById('offline-timer-text');
    const fillEl = document.getElementById('offline-timer-fill');
    if (!textEl || !fillEl) return;

    const seconds = Math.ceil(timeLeft);
    textEl.textContent = `${seconds}s`;

    const percent = Math.max(0, (timeLeft / total) * 100);
    fillEl.style.width = `${percent}%`;

    // 6 saniyeden az kaldığında uyarı rengine geç
    if (timeLeft <= 6) {
      fillEl.classList.add('warning');
    } else {
      fillEl.classList.remove('warning');
    }
  }

  /**
   * Cevap verildiğinde çağrılır.
   */
  onGuessResult(result) {
    const { score, distanceStr, totalScore, roundNum, totalRounds } = result;

    // Toplam skor güncelle
    document.getElementById('total-score').textContent = totalScore.toLocaleString('tr-TR');

    // Sonuç panelini göster
    const resultPanel = document.getElementById('round-result-panel');
    resultPanel.classList.remove('hidden');
    resultPanel.className = 'round-result-modal';

    document.getElementById('result-score').textContent = `+${score}`;
    document.getElementById('result-distance').textContent = distanceStr;

    // Son tur mu? → direkt oyun sonucuna geç
    const nextBtn = document.getElementById('next-btn');
    if (roundNum >= totalRounds) {
      nextBtn.style.display = 'none';
      setTimeout(() => {
        this.callbacks.onNext?.();
      }, 1500);
    } else {
      nextBtn.style.display = '';
      nextBtn.textContent = 'Sonraki Soru →';
    }

    // Animasyon
    resultPanel.classList.add('animate-in');
    setTimeout(() => resultPanel.classList.remove('animate-in'), 600);
  }

  /**
   * Oyun bittiğinde çağrılır — seviye sonucu veya genel sonuç ekranı.
   */
  onGameOver(result) {
    const { levelScore, runTotalScore, totalScore, maxPossible, mode, levelConfig, isPassed, passScore } = result;

    this._hideResult();

    const panel = document.getElementById('level-complete-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    const iconEl = document.getElementById('level-complete-icon');
    const titleEl = document.getElementById('level-complete-title');
    const totalEl = document.getElementById('lc-total-score');
    const totalLabelEl = document.getElementById('lc-total-label');
    const targetEl = document.getElementById('lc-target-score');
    const targetLabelEl = document.getElementById('lc-target-label');
    const msgEl = document.getElementById('level-complete-msg');
    const nextLevelBtn = document.getElementById('next-level-btn');
    const homeBtn = document.getElementById('home-from-level-btn');

    if (levelConfig) {
      if (targetEl) targetEl.textContent = passScore.toLocaleString('tr-TR');
      if (targetLabelEl) targetLabelEl.textContent = 'Hedef Puan';

      if (isPassed && !levelConfig.isFinal) {
        // Ara Seviye Geçildi: Yalnızca o seviyede alınan puanı (Puanınız: 1150) göster
        if (totalEl) totalEl.textContent = (levelScore ?? totalScore).toLocaleString('tr-TR');
        if (totalLabelEl) totalLabelEl.textContent = 'Puanınız';
        if (iconEl) iconEl.textContent = '🎉';
        if (titleEl) titleEl.textContent = `${levelConfig.title} Tamamlandı!`;
        if (msgEl) msgEl.textContent = 'Seviyeyi Geçtiniz! 🚀';

        if (nextLevelBtn) {
          nextLevelBtn.textContent = 'Sonraki Seviye 🚀';
          nextLevelBtn.onclick = () => this.callbacks.onNextLevel?.(levelConfig.level + 1);
        }
      } else {
        // Oyun Bitti (Elendi veya Şampiyon Oldu): Birikmiş Tüm Maraton Skorunu (Toplam Skor: 15500) göster
        const finalRunScore = runTotalScore ?? totalScore;
        if (totalEl) totalEl.textContent = finalRunScore.toLocaleString('tr-TR');
        if (totalLabelEl) totalLabelEl.textContent = 'Toplam Skor';

        if (isPassed && levelConfig.isFinal) {
          if (iconEl) iconEl.textContent = '🏆';
          if (titleEl) titleEl.textContent = 'ŞAMPİYON! 🏆';
          if (msgEl) msgEl.textContent = 'Tebrikler! Tüm seviyeleri başarıyla tamamladınız! 🥇';
        } else {
          if (iconEl) iconEl.textContent = '😢';
          if (titleEl) titleEl.textContent = 'Oyun Bitti!';
          if (msgEl) msgEl.textContent = 'Hedef puana ulaşılamadı. Tekrar deneyin!';
        }

        if (nextLevelBtn) {
          nextLevelBtn.textContent = 'Tekrar Oyna 🔄';
          nextLevelBtn.onclick = () => this.callbacks.onReplay?.();
        }
      }
    } else {
      const accuracy = Math.round((totalScore / maxPossible) * 100);
      if (totalEl) totalEl.textContent = totalScore.toLocaleString('tr-TR');
      if (totalLabelEl) totalLabelEl.textContent = 'Toplam Skor';
      if (iconEl) iconEl.textContent = accuracy >= 70 ? '🎉' : accuracy >= 40 ? '👍' : '💪';
      if (titleEl) titleEl.textContent = 'Oyun Bitti!';
      if (targetEl) targetEl.textContent = maxPossible.toLocaleString('tr-TR');
      if (msgEl) msgEl.textContent = `${mode?.name || 'Mod'} — %${accuracy} isabet`;

      if (nextLevelBtn) {
        nextLevelBtn.textContent = 'Tekrar Oyna 🔄';
        nextLevelBtn.onclick = () => this.callbacks.onReplay?.();
      }
    }

    if (homeBtn) {
      homeBtn.textContent = 'Ana Menü 🏠';
      homeBtn.onclick = () => this.callbacks.onHome?.();
    }

    panel.classList.add('animate-in');
  }

  /**
   * Online Maç Durumunu Günceller (12s Sayaç, 3s Konum Gösterimi, 3s Skor Tablosu)
   */
  updateOnlineHUD(state) {
    // Online maçta sağ üstteki 'TOPLAM PUAN 0' yazısını gizle
    const topRightScoreEl = document.querySelector('.game-top-right');
    if (topRightScoreEl) topRightScoreEl.style.display = 'none';

    // Soru bilgisi: "Lozan, İsviçre" formatında göster
    if (state.currentQuestion) {
      const cityEl = document.getElementById('question-city');
      const countryEl = document.getElementById('question-country');
      const q = state.currentQuestion;
      if (cityEl) {
        cityEl.textContent = q.country ? `${q.name}, ${q.country}` : q.name;
      }
      if (countryEl) countryEl.style.display = 'none';
    }

    // Üst Bar Başlığı ve 12s Sayaç Çubuğu
    const titleEl = document.querySelector('.game-panel-title');
    if (titleEl) {
      titleEl.innerHTML = `🌐 Online Maç`;
    }

    this.updateTimer(state.timeLeftSeconds, 12);

    // Progress bar & Round
    const progress = (state.roundNum / state.totalRounds) * 100;
    const barEl = document.getElementById('round-progress-bar');
    if (barEl) barEl.style.width = `${progress}%`;
    const counterEl = document.getElementById('round-counter');
    if (counterEl) counterEl.textContent = `${state.roundNum} / ${state.totalRounds}`;

    // 3 Saniyelik Konum & Skor Pop-up Görünümü
    let onlineToast = document.getElementById('online-live-toast');
    if (!onlineToast) {
      onlineToast = document.createElement('div');
      onlineToast.id = 'online-live-toast';
      onlineToast.className = 'online-live-toast hidden';
      document.body.appendChild(onlineToast);
    }

    if (state.phase === 'reveal_3s') {
      this._hideResult();
      const meScore = state.players.me.currentGuess?.score || 0;
      const meDist = state.players.me.currentGuess?.distanceKm || 0;
      const oppScore = state.players.opponent.currentGuess?.score || 0;
      const oppDist = state.players.opponent.currentGuess?.distanceKm || 0;
      const oppName = state.players.opponent.displayName || 'Rakip';

      onlineToast.className = 'online-live-toast visible reveal';
      onlineToast.innerHTML = `
        <div class="toast-title">📍 Tur Sonucu</div>
        <div class="toast-scores">
          <div class="toast-score-item me">
            <span class="toast-name">Siz</span>
            <span class="toast-score-val">+${meScore} p</span>
            <span class="toast-dist-val">${meDist} km</span>
          </div>
          <div class="toast-score-item opp">
            <span class="toast-name">${oppName}</span>
            <span class="toast-score-val">+${oppScore} p</span>
            <span class="toast-dist-val">${oppDist} km</span>
          </div>
        </div>
      `;
    } else if (state.phase === 'scoreboard_3s') {
      onlineToast.className = 'online-live-toast visible scoreboard';
      onlineToast.innerHTML = `
        <div class="toast-title">🏆 Toplam Skor (Tur ${state.roundNum}/${state.totalRounds})</div>
        <div class="toast-scores-row">
          <span class="toast-me-total">Siz: <strong>${state.players.me.score} p</strong></span>
          <span class="toast-vs-badge">VS</span>
          <span class="toast-opp-total">${state.players.opponent.displayName || 'Rakip'}: <strong>${state.players.opponent.score} p</strong></span>
        </div>
      `;
    } else {
      onlineToast.className = 'online-live-toast hidden';
    }
  }

  // --- Private ---

  _hideResult() {
    const panel = document.getElementById('round-result-panel');
    if (panel) panel.classList.add('hidden');
  }

  _hideGameComplete() {
    const panel = document.getElementById('level-complete-panel');
    if (panel) panel.classList.add('hidden');
  }

  _bindButtons() {
    if (this._buttonsBound) return;
    this._buttonsBound = true;

    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('#home-from-game-btn') || e.target?.closest?.('#home-from-level-btn')) {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onHome?.();
        return;
      }

      if (e.target?.closest?.('#next-btn')) {
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn && nextBtn.style.pointerEvents !== 'none') {
          nextBtn.style.pointerEvents = 'none';
          setTimeout(() => { if (nextBtn) nextBtn.style.pointerEvents = 'auto'; }, 600);
          this.callbacks.onNext?.();
        }
        return;
      }
    });
  }
}
