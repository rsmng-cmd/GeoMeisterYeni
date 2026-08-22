/**
 * SettingsService.js — Ayarlar Yönetimi (localStorage tabanlı)
 * Tema, tuş atamaları ve profil gizliliği ayarlarını yönetir.
 */

const STORAGE_KEY = 'geomeister_settings';

const DEFAULT_SETTINGS = {
  theme: 'dark', // Sadece koyu tema destekleniyor
  keyBindings: {
    nextQuestion: 'Enter',
    home: 'Escape',
    hint: 'KeyH',
    zoomIn: 'Equal',
    zoomOut: 'Minus',
  },
  privacy: {
    showStats: true, // Profil istatistiklerini herkese göster
  },
};

export class SettingsService {
  constructor() {
    this._settings = this._load();
  }

  get() {
    return { ...this._settings };
  }

  getTheme() {
    return this._settings.theme || 'dark';
  }

  getKeyBindings() {
    return { ...DEFAULT_SETTINGS.keyBindings, ...this._settings.keyBindings };
  }

  getPrivacy() {
    return { ...DEFAULT_SETTINGS.privacy, ...this._settings.privacy };
  }

  update(key, value) {
    this._settings[key] = value;
    this._save();
  }

  updateKeyBinding(action, keyCode) {
    if (!this._settings.keyBindings) {
      this._settings.keyBindings = { ...DEFAULT_SETTINGS.keyBindings };
    }
    this._settings.keyBindings[action] = keyCode;
    this._save();
  }

  setTheme(theme) {
    this._settings.theme = theme;
    this._save();
    this.applyTheme();
  }

  applyTheme() {
    const theme = this._settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }

  setPrivacy(privacyObj) {
    this._settings.privacy = { ...this._settings.privacy, ...privacyObj };
    this._save();
  }

  resetDefaults() {
    this._settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this._save();
    this.applyTheme();
  }

  // --- Private ---

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
          ...parsed,
          keyBindings: { ...DEFAULT_SETTINGS.keyBindings, ...parsed.keyBindings },
          privacy: { ...DEFAULT_SETTINGS.privacy, ...parsed.privacy },
        };
      }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
    } catch {}
  }
}
