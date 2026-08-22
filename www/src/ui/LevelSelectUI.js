/**
 * LevelSelectUI.js — Seviye Seçimi Ekranı Yöneticisi
 * Seviye 1'den 10'a kadar kilitli ve açık seviyeleri listeler.
 */

import { LEVELS, getUnlockedLevel } from '../config/levels.js';

export class LevelSelectUI {
  /**
   * @param {object} callbacks
   * @param {Function} callbacks.onLevelSelect - (levelConfig) => void
   * @param {Function} callbacks.onBack - () => void
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.unlockedLevel = 1;
  }

  init() {
    this._bindEvents();
  }

  show(modeName = 'Dünya Modu') {
    const screen = document.getElementById('level-select-screen');
    if (!screen) return;

    this.unlockedLevel = getUnlockedLevel();

    const titleEl = document.getElementById('level-select-title');
    if (titleEl) titleEl.textContent = `🗺️ ${modeName} — Seviye Seçimi`;

    this._renderLevels();
    screen.classList.remove('hidden');
  }

  hide() {
    document.getElementById('level-select-screen')?.classList.add('hidden');
  }

  _renderLevels() {
    const grid = document.getElementById('levels-grid');
    if (!grid) return;

    grid.innerHTML = LEVELS.map((lvl) => {
      const isUnlocked = lvl.level <= this.unlockedLevel;
      const isCompleted = lvl.level < this.unlockedLevel;

      return `
        <div class="level-card ${isUnlocked ? 'unlocked' : 'locked'} ${isCompleted ? 'completed' : ''}" 
             data-level="${lvl.level}" 
             style="--lvl-color: ${lvl.color}">
          <div class="level-card-header">
            <span class="level-icon">${isUnlocked ? lvl.icon : '🔒'}</span>
            <span class="level-badge">${isCompleted ? '✅ Tamamlandı' : isUnlocked ? 'Açık' : 'Kilitli'}</span>
          </div>
          <div class="level-title">${lvl.title}</div>
          <div class="level-desc">${lvl.description}</div>
          <div class="level-footer">
            ${isUnlocked 
              ? `<button class="btn btn-primary btn-sm btn-full start-level-btn">Başlat 🚀</button>` 
              : `<span class="locked-hint">Önceki Seviyeyi Geç</span>`}
          </div>
        </div>
      `;
    }).join('');
  }

  _bindEvents() {
    const screen = document.getElementById('level-select-screen');
    if (!screen) return;

    screen.addEventListener('click', (e) => {
      if (e.target?.closest?.('#level-select-back-btn')) {
        this.hide();
        this.callbacks.onBack?.();
        return;
      }

      const card = e.target?.closest?.('.level-card.unlocked');
      if (card) {
        const levelNum = parseInt(card.dataset.level, 10);
        const config = LEVELS.find((l) => l.level === levelNum);
        if (config) {
          this.hide();
          this.callbacks.onLevelSelect?.(config);
        }
      }
    });
  }
}
