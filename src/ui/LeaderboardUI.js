/**
 * LeaderboardUI.js — Liderlik Tablosu Ekranı Yöneticisi
 * Oyuncuların profillerine tıklanabilir.
 */

import { ScoreService } from '../services/ScoreService.js';
import { ProfileUI } from './ProfileUI.js';
import { modes } from '../modes/ModeRegistry.js';

export class LeaderboardUI {
  /**
   * @param {object} callbacks
   * @param {Function} callbacks.onBack - Geri dön
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.scoreService = new ScoreService();
    this.profileUI = new ProfileUI();
    this.currentMode = 'world';
    this.currentUser = null;
  }

  init() {
    this._renderModeTabs();
    document.getElementById('leaderboard-back-btn')?.addEventListener('click', () => {
      this.callbacks.onBack?.();
    });
  }

  async show(user, friendService = null) {
    this.currentUser = user;
    this.friendService = friendService;
    document.getElementById('leaderboard-screen').classList.remove('hidden');
    await this._loadLeaderboard(this.currentMode);
  }

  hide() {
    document.getElementById('leaderboard-screen').classList.add('hidden');
  }

  // --- Private ---

  _renderModeTabs() {
    const container = document.getElementById('leaderboard-mode-tabs');
    if (!container) return;

    const availableModes = modes.filter((m) => m.available);

    container.innerHTML = availableModes
      .map(
        (m) =>
          `<button class="lb-tab ${m.id === this.currentMode ? 'active' : ''}" 
            data-mode="${m.id}">${m.icon} ${m.name}</button>`
      )
      .join('');

    container.querySelectorAll('.lb-tab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        this.currentMode = btn.dataset.mode;
        container.querySelectorAll('.lb-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        await this._loadLeaderboard(this.currentMode);
      });
    });
  }

  async _loadLeaderboard(modeId) {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;

    // Skeleton göster
    tbody.innerHTML = Array(10)
      .fill(0)
      .map(
        () => `
        <tr class="skeleton-row">
          <td><div class="skeleton"></div></td>
          <td><div class="skeleton"></div></td>
          <td><div class="skeleton"></div></td>
        </tr>`
      )
      .join('');

    try {
      const scores = await this.scoreService.getLeaderboard(modeId, 50);
      if (scores.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="3" class="lb-empty">
              Henüz skor yok. İlk sen ol! 🏆
            </td>
          </tr>`;
        return;
      }

      tbody.innerHTML = scores
        .map((s) => this._renderRow(s))
        .join('');

      // Profil tıklama eventleri ekle
      tbody.querySelectorAll('.lb-row[data-uid]').forEach(row => {
        row.addEventListener('click', () => {
          const uid = row.dataset.uid;
          const name = row.dataset.displayName;
          if (uid && !uid.startsWith('guest')) {
            this.profileUI.showOtherProfile(uid, name, this.currentUser, this.friendService);
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="lb-error">
            Liderlik tablosu yüklenemedi. Lütfen tekrar deneyin.
          </td>
        </tr>`;
      console.error('[LeaderboardUI] Load error:', err);
    }
  }

  _renderRow(score) {
    const isCurrentUser = this.currentUser && !this.currentUser.isGuest && !this.currentUser.uid?.startsWith('guest_') && this.currentUser.uid === score.uid;
    const rankDisplay = this._renderRank(score.rank);

    return `
      <tr class="lb-row ${isCurrentUser ? 'current-user' : ''}" data-uid="${score.uid}" data-display-name="${this._escapeHtml(score.displayName)}" style="cursor: pointer;" title="Profili görüntüle">
        <td class="lb-rank">${rankDisplay}</td>
        <td class="lb-player">
          <div class="lb-avatar">${this._getInitials(score.displayName)}</div>
          <span class="lb-name">${this._escapeHtml(score.displayName)}${isCurrentUser ? ' <span class="you-badge">Sen</span>' : ''}</span>
        </td>
        <td class="lb-score">${score.totalScore.toLocaleString('tr-TR')}</td>
      </tr>`;
  }

  _renderRank(rank) {
    if (rank === 1) return '<span class="rank-badge gold">🥇</span>';
    if (rank === 2) return '<span class="rank-badge silver">🥈</span>';
    if (rank === 3) return '<span class="rank-badge bronze">🥉</span>';
    return `<span class="rank-num">${rank}</span>`;
  }

  _getInitials(name) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }
}
