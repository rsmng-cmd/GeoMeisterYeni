/**
 * AuthUI.js — Kayıt ve Giriş Ekranı Yöneticisi
 */

import { AuthService } from '../services/AuthService.js';

export class AuthUI {
  constructor(authService, onGuestLogin) {
    this.authService = authService;
    this.onGuestLogin = onGuestLogin;
    this.activeTab = 'login';
  }

  init() {
    this._bindTabs();
    this._bindForms();
    this._bindGuest();
    this._prefillLastEmail();
  }

  show() {
    document.getElementById('auth-screen').classList.remove('hidden');
  }

  hide() {
    document.getElementById('auth-screen').classList.add('hidden');
  }

  // --- Private ---

  _bindTabs() {
    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this._switchTab(target);
      });
    });
  }

  _switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.auth-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.auth-form').forEach((f) => {
      f.classList.toggle('hidden', f.dataset.form !== tab);
    });
    this._clearMessages();
  }

  _bindForms() {
    const handleLogin = async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      if (!email || !password) {
        this._showError('login-error', 'Lütfen e-posta ve şifrenizi girin.');
        return;
      }

      this._setLoading('login-btn', true);
      this._clearMessages();

      try {
        console.log('[AuthUI] Giriş yapılmaya çalışılıyor...', email);
        await this.authService.login(email, password);
        this._showSuccess('login-success', '✅ Giriş başarılı! Yönlendiriliyorsunuz...');
      } catch (err) {
        console.error('[AuthUI] Giriş hatası:', err);
        const errMsg = AuthService.getErrorMessage(err.code) || err.message || 'Giriş yapılamadı. Şifre veya e-postayı kontrol edin.';
        this._showError('login-error', errMsg);
      } finally {
        this._setLoading('login-btn', false);
      }
    };

    const handleRegister = async () => {
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const confirm = document.getElementById('register-confirm').value;

      if (password !== confirm) {
        this._showError('register-error', 'Şifreler eşleşmiyor.');
        return;
      }
      if (name.length < 2) {
        this._showError('register-error', 'İsim en az 2 karakter olmalıdır.');
        return;
      }

      this._setLoading('register-btn', true);
      this._clearMessages();

      try {
        await this.authService.register(email, password, name);
        this._showSuccess('register-success', '✅ Kayıt başarılı! Giriş yapılıyor...');
      } catch (err) {
        this._showError('register-error', AuthService.getErrorMessage(err.code));
      } finally {
        this._setLoading('register-btn', false);
      }
    };

    // Form Submit & Button Click Handlers
    document.getElementById('login-form')?.addEventListener('submit', (e) => { e.preventDefault(); handleLogin(); });
    document.getElementById('login-btn')?.addEventListener('click', (e) => { e.preventDefault(); handleLogin(); });

    document.getElementById('register-form')?.addEventListener('submit', (e) => { e.preventDefault(); handleRegister(); });
    document.getElementById('register-btn')?.addEventListener('click', (e) => { e.preventDefault(); handleRegister(); });
  }

  _showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  _showSuccess(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  _clearMessages() {
    document.querySelectorAll('.auth-error, .auth-success').forEach((el) => {
      el.textContent = '';
      el.classList.add('hidden');
    });
  }

  _setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Yükleniyor...' : btn.dataset.label;
  }

  _bindGuest() {
    document.getElementById('guest-btn')?.addEventListener('click', () => {
      this.authService.loginAsGuest('Oyuncu');
      this.onGuestLogin?.();
    });
  }

  _prefillLastEmail() {
    try {
      const raw = localStorage.getItem('gm_last_user');
      if (!raw) return;
      const lastUser = JSON.parse(raw);
      if (lastUser.email) {
        const emailInput = document.getElementById('login-email');
        if (emailInput) emailInput.value = lastUser.email;
      }
    } catch { /* */ }
  }
}
