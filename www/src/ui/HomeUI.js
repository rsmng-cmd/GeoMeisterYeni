/**
 * HomeUI.js — Ana Ekran (Mod Seçimi) Yöneticisi
 * Mod kartlarını render eder. Seviye sistemi kaldırıldı.
 */

import { modes } from '../modes/ModeRegistry.js';

export class HomeUI {
  /**
   * @param {object} callbacks
   * @param {Function} callbacks.onModeSelect - (modeId) => void
   * @param {Function} callbacks.onLeaderboard - () => void
   * @param {Function} callbacks.onLogout - () => void
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
  }

  init() {
    this._renderModeCards();
    this._bindButtons();
  }

  show(user, userProfile) {
    document.getElementById('home-screen').classList.remove('hidden');
    this._renderModeCards();
    this._updateUserInfo(user);
  }

  hide() {
    document.getElementById('home-screen').classList.add('hidden');
  }

  // --- Private ---

  _renderModeCards() {
    const grid = document.getElementById('modes-grid');
    if (!grid) return;

    grid.innerHTML = modes
      .map((mode) => this._createModeCard(mode))
      .join('');
  }

  _createModeCard(mode) {
    if (!mode.available) {
      return `
        <div class="mode-card locked" data-mode-id="${mode.id}">
          <div class="mode-card-lock">🔒</div>
          <div class="mode-card-icon">${mode.icon}</div>
          <div class="mode-card-name">${mode.name}</div>
          <div class="mode-card-desc">${mode.description || ''}</div>
          <div class="mode-card-footer">
            <span class="badge badge-coming">Yakında...</span>
          </div>
        </div>`;
    }

    return `
      <div class="mode-card" data-mode-id="${mode.id}" style="--mode-color: ${mode.color}">
        <div class="mode-card-glow"></div>
        <div class="mode-card-icon">${mode.icon}</div>
        <div class="mode-card-name">${mode.name}</div>
        <div class="mode-card-desc">${mode.description || ''}</div>
        <div class="mode-card-footer">
          <span class="mode-card-play">Oyna →</span>
        </div>
      </div>`;
  }

  _updateUserInfo(user) {
    const nameEl = document.getElementById('user-display-name');
    if (nameEl) nameEl.textContent = user?.displayName || 'Oyuncu';

    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) {
      const name = user?.displayName || 'Oyuncu';
      avatarEl.textContent = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }
  }

  /** Profil arka planda yüklendiğinde istatistikleri güncelle — artık seviye yok */
  updateStats(profile) {
    // Seviye sistemi kaldırıldı, burada yapılacak bir şey kalmadı
  }

  _bindButtons() {
    document.getElementById('leaderboard-btn')?.addEventListener('click', () => {
      this.callbacks.onLeaderboard?.();
    });
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      this.callbacks.onLogout?.();
    });

    // Delegated click listener for mode cards (never breaks when DOM re-renders)
    document.addEventListener('click', (e) => {
      const card = e.target?.closest?.('.mode-card[data-mode-id]');
      if (card) {
        const modeId = card.getAttribute('data-mode-id') || card.dataset.modeId;
        const mode = modes.find((m) => m.id === modeId);
        if (mode?.available) {
          this.callbacks.onModeSelect?.(modeId);
        }
      }
    });
  }
}
