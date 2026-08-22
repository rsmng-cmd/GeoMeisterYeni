/**
 * SettingsUI.js — Ayarlar Modalı
 * Tema, tuş atamaları ve profil gizliliği yönetimi.
 */

const KEY_LABELS = {
  nextQuestion: 'Sonraki Soru',
  home: 'Ana Menüye Dön',
  hint: 'İpucu Kullan',
  zoomIn: 'Harita Yakınlaştır',
  zoomOut: 'Harita Uzaklaştır',
};

const KEY_DISPLAY = {
  Enter: 'Enter',
  Escape: 'Esc',
  KeyH: 'H',
  Equal: '+',
  Minus: '-',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

import OfflineTileManager from '../services/OfflineTileManager.js';
import soundService from '../services/SoundService.js';

export class SettingsUI {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.tileManager = new OfflineTileManager();
    this._listeningForKey = null; // { action: string, el: HTMLElement }
    this._showKeybindingsPanel = false;
  }

  init() {
    this._injectModal();
    this._bindEvents();
  }

  show() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      this._render();
      modal.classList.remove('hidden');
    }
  }

  hide() {
    document.getElementById('settings-modal')?.classList.add('hidden');
    this._listeningForKey = null;
  }

  _injectModal() {
    if (document.getElementById('settings-modal')) return;

    const html = `
    <div id="settings-modal" class="modal-backdrop hidden">
      <div class="settings-modal-card">
        <button id="btn-close-settings" class="btn-close-modal">✕</button>
        <div class="settings-header">
          <h2 class="settings-title">⚙️ Ayarlar</h2>
        </div>
        <div id="settings-content" class="settings-content"></div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  _bindEvents() {
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.hide());

    // Tuş atama dinleyicisi
    document.addEventListener('keydown', (e) => {
      if (!this._listeningForKey) return;
      e.preventDefault();
      e.stopPropagation();

      const { action, el } = this._listeningForKey;
      this.settingsService.updateKeyBinding(action, e.code);
      el.textContent = this._getKeyDisplay(e.code);
      el.classList.remove('listening');
      this._listeningForKey = null;
    });
  }

  _render() {
    const content = document.getElementById('settings-content');
    if (!content) return;

    const settings = this.settingsService.get();
    const bindings = this.settingsService.getKeyBindings();
    const privacy = this.settingsService.getPrivacy();
    const isSoundOn = soundService.isSoundEnabled();
    const isDark = settings.theme === 'dark';

    content.innerHTML = `
      <!-- Ses Ayarları -->
      <div class="settings-section">
        <h3 class="settings-section-title">🔊 Ses</h3>
        <label class="settings-toggle-row">
          <span>Oyun İçi Ses Efektleri (SFX)</span>
          <input type="checkbox" id="toggle-sfx" ${isSoundOn ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <div style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <span style="font-size: 0.85rem; color: var(--color-text-secondary);">Ses Seviyesi (%<span id="sfx-vol-label">${Math.round(soundService.getVolume() * 100)}</span>)</span>
          <input type="range" id="slider-sfx-volume" min="0" max="1" step="0.05" value="${soundService.getVolume()}" style="accent-color: var(--color-accent); cursor: pointer;" />
        </div>
      </div>



      <!-- Gizlilik -->
      <div class="settings-section">
        <h3 class="settings-section-title">🔒 Gizlilik</h3>
        <label class="settings-toggle-row">
          <span>İstatistiklerimi herkese göster</span>
          <input type="checkbox" id="toggle-show-stats" ${privacy.showStats ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <!-- Sıfırla -->
      <button class="btn-secondary btn-full" id="btn-reset-settings">Varsayılana Sıfırla</button>
    `;

    // SFX toggle & Volume slider
    document.getElementById('toggle-sfx')?.addEventListener('change', (e) => {
      soundService.setSoundEnabled(e.target.checked);
      if (e.target.checked) soundService.playClick();
    });

    document.getElementById('slider-sfx-volume')?.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      soundService.setVolume(vol);
      const label = document.getElementById('sfx-vol-label');
      if (label) label.textContent = Math.round(vol * 100);
    });

    // Keybindings toggle button
    document.getElementById('btn-toggle-keybindings')?.addEventListener('click', () => {
      this._showKeybindingsPanel = !this._showKeybindingsPanel;
      soundService.playClick();
      this._render();
    });

    // Theme buttons
    content.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.settingsService.setTheme(btn.dataset.theme);
        this._render();
      });
    });

    // Offline Map Download buttons
    content.querySelectorAll('.btn-download-pkg').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pkgId = btn.dataset.pkgId;
        const progressBox = document.getElementById(`pkg-progress-${pkgId}`);
        const fillEl = progressBox?.querySelector('.pkg-progress-fill');
        const textEl = progressBox?.querySelector('.pkg-progress-text');

        btn.style.display = 'none';
        if (progressBox) progressBox.classList.remove('hidden');

        await this.tileManager.downloadMapPackage(pkgId, (done, total, percent) => {
          if (fillEl) fillEl.style.width = `${percent}%`;
          if (textEl) textEl.textContent = `%${percent} (${done}/${total})`;
        });

        this._render();
      });
    });

    // Offline Map Delete buttons
    content.querySelectorAll('.btn-delete-pkg').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pkgId = btn.dataset.pkgId;
        await this.tileManager.deleteMapPackage(pkgId);
        this._render();
      });
    });

    // Keybinding buttons
    content.querySelectorAll('.keybind-key').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this._listeningForKey) {
          this._listeningForKey.el.classList.remove('listening');
        }
        btn.classList.add('listening');
        btn.textContent = '...';
        this._listeningForKey = { action: btn.dataset.action, el: btn };
      });
    });

    // Privacy toggle
    document.getElementById('toggle-show-stats')?.addEventListener('change', (e) => {
      this.settingsService.setPrivacy({ showStats: e.target.checked });
    });

    // Reset
    document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
      this.settingsService.resetDefaults();
      this._render();
    });
  }

  _getKeyDisplay(code) {
    return KEY_DISPLAY[code] || code.replace('Key', '').replace('Digit', '');
  }
}
