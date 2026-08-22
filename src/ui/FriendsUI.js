import { modes } from '../modes/ModeRegistry.js';
import { ProfileUI } from './ProfileUI.js';

export class FriendsUI {
  constructor(friendService) {
    this.friendService = friendService;
    this.presenceService = null; // app.js tarafından atanır
    this.profileUI = new ProfileUI();
    this.currentUser = null;
    this._onGameInviteAccepted = null;
    this._isOpen = false;
    this._presenceMap = {};
    this._injected = false;
  }

  /**
   * Paneli açar.
   */
  show() {
    this._injectPanel();
    this._render();
    const panel = document.getElementById('friends-slide-panel');
    const backdrop = document.getElementById('friends-panel-backdrop');
    if (panel) {
      panel.classList.add('open');
      this._isOpen = true;
    }
    if (backdrop) backdrop.classList.add('visible');

    // Presence izlemeyi başlat
    this._startPresenceWatch();
  }

  /**
   * Paneli kapatır.
   */
  hide() {
    const panel = document.getElementById('friends-slide-panel');
    const backdrop = document.getElementById('friends-panel-backdrop');
    if (panel) panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('visible');
    this._isOpen = false;

    // Presence izlemeyi durdur (okuma tasarrufu)
    if (this.presenceService) {
      this.presenceService.stopWatching();
    }
  }

  toggle() {
    if (this._isOpen) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Gelen oyun davetini gösterir (10 saniyelik geri sayımlı).
   */
  showIncomingInvite(invite, onResponse) {
    const existing = document.getElementById('invite-toast');
    if (existing) existing.remove();

    const modeName = modes.find(m => m.id === invite.modeId)?.name || invite.modeId;
    let secondsLeft = 10;

    const toast = document.createElement('div');
    toast.id = 'invite-toast';
    toast.className = 'invite-toast visible';
    toast.innerHTML = `
      <div class="invite-toast-content">
        <div class="invite-toast-title">⚔️ Oyun Daveti! (<span id="invite-countdown">10s</span>)</div>
        <div class="invite-toast-msg"><strong>${invite.fromName}</strong> seni <strong>${modeName}</strong> modunda oyuna davet etti</div>
        <div class="invite-toast-actions">
          <button class="btn btn-success btn-sm" id="btn-accept-invite">Kabul Et</button>
          <button class="btn btn-outline btn-sm" id="btn-decline-invite">Reddet</button>
        </div>
      </div>
    `;
    document.body.appendChild(toast);

    let responded = false;
    const handleResponse = (accepted) => {
      if (responded) return;
      responded = true;
      clearInterval(countdownTimer);
      toast.remove();
      onResponse(accepted);
    };

    document.getElementById('btn-accept-invite')?.addEventListener('click', () => handleResponse(true));
    document.getElementById('btn-decline-invite')?.addEventListener('click', () => handleResponse(false));

    const countdownTimer = setInterval(() => {
      secondsLeft--;
      const countdownEl = document.getElementById('invite-countdown');
      if (countdownEl) countdownEl.textContent = `${secondsLeft}s`;

      if (secondsLeft <= 0) {
        handleResponse(false);
      }
    }, 1000);
  }

  // ─── Private: Panel Injection ──────────────────────────────

  _injectPanel() {
    if (this._injected) return;
    this._injected = true;

    const html = `
    <div id="friends-panel-backdrop"></div>
    <div id="friends-slide-panel">
      <div class="fp-header">
        <span class="fp-title">👥 Arkadaşlar</span>
        <button class="fp-close-btn" id="fp-close-btn">✕</button>
      </div>
      <div class="fp-body">
        <!-- Oyuncu Ara -->
        <div class="fp-search-box">
          <input type="text" id="fp-search-input" placeholder="Oyuncu adı ile ara..." />
          <button class="fp-search-btn" id="fp-search-btn">Ara</button>
        </div>
        <div id="fp-search-results" class="fp-search-results"></div>

        <!-- Bekleyen İstekler -->
        <div id="fp-pending-section" class="fp-pending-section" style="display:none;"></div>

        <!-- Çevrimiçi Arkadaşlar -->
        <div id="fp-online-section"></div>

        <!-- Çevrimdışı Arkadaşlar -->
        <div id="fp-offline-section"></div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('fp-close-btn')?.addEventListener('click', () => this.hide());
    document.getElementById('friends-panel-backdrop')?.addEventListener('click', () => this.hide());

    document.getElementById('fp-search-btn')?.addEventListener('click', () => this._handleSearch());
    document.getElementById('fp-search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._handleSearch();
    });
  }

  // ─── Private: Presence Watch ───────────────────────────────

  async _startPresenceWatch() {
    if (!this.presenceService || !this.currentUser) return;

    const friends = await this.friendService.getFriends(this.currentUser);
    const friendUids = friends.map(f => f.uid);

    if (friendUids.length === 0) return;

    this.presenceService.startWatching(friendUids, (presenceMap) => {
      this._presenceMap = presenceMap;
      if (this._isOpen) {
        this._renderFriendLists();
      }
    });
  }

  // ─── Private: Render ───────────────────────────────────────

  async _render() {
    if (!this.currentUser) return;

    // Bekleyen istekler
    await this._renderPendingRequests();

    // Arkadaş listesi
    const friends = await this.friendService.getFriends(this.currentUser);
    this._renderFriendListsFromData(friends);

    // Badge güncelle
    this.updateBadge(this.currentUser);
  }

  _renderFriendLists() {
    // _presenceMap güncellenince çağrılır — mevcut arkadaş listesini güncelle
    this.friendService.getFriends(this.currentUser).then(friends => {
      this._renderFriendListsFromData(friends);
    });
  }

  _renderFriendListsFromData(friends) {
    const onlineSection = document.getElementById('fp-online-section');
    const offlineSection = document.getElementById('fp-offline-section');
    if (!onlineSection || !offlineSection) return;

    if (friends.length === 0) {
      onlineSection.innerHTML = '';
      offlineSection.innerHTML = `
        <div class="fp-empty">
          <div class="fp-empty-icon">👋</div>
          Henüz arkadaş yok. Yukarıdan oyuncu arayarak ekleyebilirsin!
        </div>`;
      return;
    }

    const onlineFriends = [];
    const offlineFriends = [];

    friends.forEach(friend => {
      const presence = this._presenceMap[friend.uid];
      if (presence && presence.status === 'online') {
        onlineFriends.push({ ...friend, presence });
      } else {
        offlineFriends.push({
          ...friend,
          presence: presence || { status: 'offline', activity: '', lastSeen: 0 },
        });
      }
    });

    // Çevrimiçi
    if (onlineFriends.length > 0) {
      onlineSection.innerHTML = `
        <div class="fp-section-title">
          🟢 Çevrimiçi <span class="count">${onlineFriends.length}</span>
        </div>
        ${onlineFriends.map(f => this._renderFriendCard(f, true)).join('')}
      `;
    } else {
      onlineSection.innerHTML = `
        <div class="fp-section-title">🟢 Çevrimiçi <span class="count">0</span></div>
        <div class="fp-empty" style="padding: 8px 0; font-size: 0.78rem;">Şu an çevrimiçi arkadaş yok</div>
      `;
    }

    // Çevrimdışı
    if (offlineFriends.length > 0) {
      offlineSection.innerHTML = `
        <div class="fp-section-title">
          ⚫ Çevrimdışı <span class="count">${offlineFriends.length}</span>
        </div>
        ${offlineFriends.map(f => this._renderFriendCard(f, false)).join('')}
      `;
    } else {
      offlineSection.innerHTML = '';
    }

    // Buton eventleri bağla
    this._bindFriendCardEvents();
  }

  _renderFriendCard(friend, isOnline) {
    const activity = isOnline ? (friend.presence?.activity || 'Çevrimiçi') : this._getLastSeenText(friend.presence?.lastSeen);

    return `
      <div class="fp-friend-card ${isOnline ? 'online' : ''}" data-uid="${friend.uid}" data-name="${this._escapeHtml(friend.displayName)}" title="İstatistikleri ve Profili Görüntüle" style="cursor: pointer;">
        <div class="fp-avatar-wrap">
          <div class="fp-avatar">${this._getInitials(friend.displayName)}</div>
          <div class="fp-status-dot ${isOnline ? 'online' : 'offline'}"></div>
        </div>
        <div class="fp-friend-info">
          <div class="fp-friend-name">${this._escapeHtml(friend.displayName)}</div>
          <div class="fp-friend-activity ${isOnline ? '' : 'offline'}">${activity}</div>
        </div>
        <div class="fp-friend-actions">
          ${isOnline ? `<button class="fp-invite-btn" data-uid="${friend.uid}" data-name="${this._escapeHtml(friend.displayName)}">⚔️ Davet</button>` : ''}
          <button class="fp-remove-btn" data-uid="${friend.uid}" data-name="${this._escapeHtml(friend.displayName)}" title="Arkadaşı Sil">✕</button>
        </div>
      </div>
    `;
  }

  _bindFriendCardEvents() {
    // Kart tıklama — İstatistik / Profil Ekranı Aç
    document.querySelectorAll('.fp-friend-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fp-friend-actions') || e.target.closest('button')) return;
        const uid = card.dataset.uid;
        const name = card.dataset.name;
        if (uid) {
          this.profileUI.showOtherProfile(uid, name, this.currentUser, this.friendService);
        }
      });
    });

    // Davet butonları
    document.querySelectorAll('.fp-invite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showInviteModeSelect(btn.dataset.uid, btn.dataset.name);
      });
    });

    // Sil butonları
    document.querySelectorAll('.fp-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showDeleteConfirm(btn.dataset.uid, btn.dataset.name);
      });
    });
  }

  _getLastSeenText(lastSeen) {
    if (!lastSeen) return 'Çevrimdışı';
    const diff = Date.now() - lastSeen;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 5) return 'Az önce çevrimiçiydi';
    if (mins < 60) return `${mins} dk önce`;
    if (hours < 24) return `${hours} saat önce`;
    if (days < 7) return `${days} gün önce`;
    return 'Çevrimdışı';
  }

  // ─── Private: Pending Requests ─────────────────────────────

  async _renderPendingRequests() {
    const section = document.getElementById('fp-pending-section');
    if (!section || !this.currentUser) return;

    const requests = await this.friendService.getPendingRequests(this.currentUser);

    if (requests.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'flex';
    section.innerHTML = `
      <div class="fp-section-title">📩 Bekleyen İstekler <span class="count">${requests.length}</span></div>
      ${requests.map(req => `
        <div class="fp-pending-card">
          <div class="fp-avatar-wrap">
            <div class="fp-avatar" style="width:30px;height:30px;font-size:0.65rem;">${this._getInitials(req.fromName)}</div>
          </div>
          <span class="fp-pending-name">${this._escapeHtml(req.fromName)}</span>
          <div class="fp-pending-actions">
            <button class="fp-accept-btn" data-req='${JSON.stringify(req)}'>✓</button>
            <button class="fp-decline-btn" data-req-id="${req.id}" data-from-uid="${req.fromUid}">✕</button>
          </div>
        </div>
      `).join('')}
    `;

    section.querySelectorAll('.fp-accept-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const req = JSON.parse(btn.dataset.req);
        await this.friendService.acceptFriendRequest(req, this.currentUser);
        this._render();
      });
    });

    section.querySelectorAll('.fp-decline-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await this.friendService.declineFriendRequest(
          { id: btn.dataset.reqId, fromUid: btn.dataset.fromUid },
          this.currentUser
        );
        this._render();
      });
    });
  }

  // ─── Private: Search ───────────────────────────────────────

  async _handleSearch() {
    const input = document.getElementById('fp-search-input');
    const resultsEl = document.getElementById('fp-search-results');
    if (!input || !resultsEl) return;

    const query = input.value.trim();
    if (query.length < 2) {
      resultsEl.innerHTML = '<div class="fp-empty" style="padding:6px 0;font-size:0.78rem;">En az 2 karakter girin</div>';
      return;
    }

    resultsEl.innerHTML = '<div class="fp-empty" style="padding:6px 0;font-size:0.78rem;">Aranıyor...</div>';

    const results = await this.friendService.searchPlayers(query, this.currentUser);

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="fp-empty" style="padding:6px 0;font-size:0.78rem;">Oyuncu bulunamadı</div>';
      return;
    }

    const playerStatuses = await Promise.all(
      results.map(async (player) => {
        const status = await this.friendService.getFriendshipStatus(this.currentUser.uid, player.uid);
        return { player, status };
      })
    );

    resultsEl.innerHTML = playerStatuses.map(({ player, status }) => {
      let actionHtml = '';
      if (status === 'friends') {
        actionHtml = '<span class="badge badge-friend" style="font-size:0.7rem;">Arkadaş ✓</span>';
      } else if (status === 'pending_sent') {
        actionHtml = `<button class="btn btn-outline btn-sm fp-toggle-btn" data-uid="${player.uid}" data-name="${this._escapeHtml(player.displayName)}" data-status="pending_sent" style="font-size:0.7rem;padding:3px 8px;">İstek Gönderildi</button>`;
      } else if (status === 'pending_received') {
        actionHtml = `<button class="fp-accept-btn fp-accept-search" data-uid="${player.uid}" data-name="${this._escapeHtml(player.displayName)}" style="font-size:0.7rem;">Kabul Et</button>`;
      } else {
        actionHtml = `<button class="fp-invite-btn fp-toggle-btn" data-uid="${player.uid}" data-name="${this._escapeHtml(player.displayName)}" data-status="none" style="font-size:0.7rem;padding:3px 8px;background:#6366f1;">+ Ekle</button>`;
      }

      return `
        <div class="fp-search-item" data-uid="${player.uid}" data-name="${this._escapeHtml(player.displayName)}" title="İstatistikleri ve Profili Görüntüle" style="cursor: pointer;">
          <div class="fp-search-avatar">${this._getInitials(player.displayName)}</div>
          <span class="fp-search-name">${this._escapeHtml(player.displayName)}</span>
          ${actionHtml}
        </div>`;
    }).join('');

    // Arama sonucu profil tıklama
    resultsEl.querySelectorAll('.fp-search-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.badge')) return;
        const uid = item.dataset.uid;
        const name = item.dataset.name;
        if (uid) {
          this.profileUI.showOtherProfile(uid, name, this.currentUser, this.friendService);
        }
      });
    });

    // Toggle butonları
    resultsEl.querySelectorAll('.fp-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        const currentStatus = btn.dataset.status;

        btn.disabled = true;
        if (currentStatus === 'none') {
          btn.textContent = 'Gönderiliyor...';
          const result = await this.friendService.sendFriendRequest(this.currentUser, uid, name);
          if (result) {
            btn.textContent = 'İstek Gönderildi';
            btn.dataset.status = 'pending_sent';
            btn.style.background = 'transparent';
            btn.style.border = '1px solid rgba(255,255,255,0.15)';
          } else {
            const freshStatus = await this.friendService.getFriendshipStatus(this.currentUser.uid, uid);
            if (freshStatus === 'friends') {
              btn.textContent = 'Arkadaş ✓';
              btn.disabled = true;
              return;
            }
            btn.textContent = 'İstek Gönderildi';
            btn.dataset.status = 'pending_sent';
          }
        } else if (currentStatus === 'pending_sent') {
          btn.textContent = 'İptal...';
          await this.friendService.cancelFriendRequest(this.currentUser.uid, uid);
          btn.textContent = '+ Ekle';
          btn.dataset.status = 'none';
          btn.style.background = '#6366f1';
          btn.style.border = 'none';
        }
        btn.disabled = false;
        this.updateBadge(this.currentUser);
      });
    });

    // Arama sonucu kabul et butonları
    resultsEl.querySelectorAll('.fp-accept-search').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        btn.disabled = true;
        btn.textContent = 'Kabul...';
        await this.friendService.acceptFriendRequest({ fromUid: uid, fromName: name }, this.currentUser);
        this._handleSearch();
        this._render();
      });
    });
  }

  // ─── Private: Invite Mode Select ───────────────────────────

  _showInviteModeSelect(friendUid, friendName) {
    const existing = document.getElementById('friend-invite-mode-modal');
    if (existing) existing.remove();

    const playableModes = modes.filter(m => m.available && !m.isOnline);

    const modalHTML = `
      <div id="friend-invite-mode-modal" class="modal-backdrop" style="z-index: 100000 !important;">
        <div class="friends-modal-card" style="max-width: 440px; padding: 24px;">
          <button id="btn-close-invite-mode-modal" class="btn-close-modal">✕</button>
          <div style="text-align: center; margin-bottom: 16px;">
            <h3 style="font-size: 1.2rem; font-weight: 800; color: var(--color-text-primary); margin-bottom: 4px;">⚔️ Özel Maç Daveti</h3>
            <p style="font-size: 0.85rem; color: var(--color-text-secondary);">
              <strong>${this._escapeHtml(friendName)}</strong> ile oynamak istediğiniz modu seçin:
            </p>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
            ${playableModes.map(m => `
              <button class="btn btn-outline invite-mode-card-btn" data-mode="${m.id}" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px; border-radius: 12px; border: 1px solid var(--color-border);">
                <span style="font-size: 1.8rem;">${m.icon}</span>
                <span style="font-weight: 700; font-size: 0.9rem; color: var(--color-text-primary);">${m.name}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-close-invite-mode-modal')?.addEventListener('click', () => {
      document.getElementById('friend-invite-mode-modal')?.remove();
    });

    const modalEl = document.getElementById('friend-invite-mode-modal');
    modalEl?.querySelectorAll('.invite-mode-card-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modeId = btn.dataset.mode;
        modalEl.remove();
        this.hide();

        try {
          const roomFns = await import('../services/RoomManager.js');
          const roomManager = roomFns.default || roomFns.roomManager || (roomFns.RoomManager ? new roomFns.RoomManager() : null);

          let room = null;
          if (roomManager && typeof roomManager.createRoom === 'function') {
            room = await roomManager.createRoom(this.currentUser, modeId);
          }

          await this.friendService.sendGameInvite(
            this.currentUser,
            friendUid,
            friendName,
            modeId,
            room?.code || null
          );

          const onlineFns = await import('./OnlineUI.js');
          const onlineUI = onlineFns.default || onlineFns.onlineUI;
          if (onlineUI) {
            onlineUI.currentUser = this.currentUser;
            onlineUI.show();
            if (room) {
              onlineUI._renderLobby(room);
            }
          }
        } catch (e) {
          console.warn('[FriendsUI] Room creation/invite error:', e);
          alert(`${friendName} kullanıcısına davet gönderildi!`);
        }
      });
    });
  }

  // ─── Private: Delete Confirm ───────────────────────────────

  _showDeleteConfirm(friendUid, friendName) {
    const existing = document.getElementById('friend-delete-confirm-modal');
    if (existing) existing.remove();

    const modalHTML = `
      <div id="friend-delete-confirm-modal" class="modal-backdrop" style="z-index: 100000 !important;">
        <div class="friends-modal-card text-center" style="max-width: 400px; padding: 24px; text-align: center;">
          <div style="font-size: 40px; margin-bottom: 8px;">⚠️</div>
          <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--color-text-primary); margin-bottom: 12px;">Arkadaşı Sil</h3>
          <p style="font-size: 0.9rem; color: var(--color-text-secondary); line-height: 1.4; margin-bottom: 20px;">
            <strong>${this._escapeHtml(friendName)}</strong> kullanıcısını arkadaş listenizden silmek istediğinize emin misiniz?
          </p>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button id="btn-confirm-delete-friend" class="btn btn-sm" style="background: #ef4444; color: white; flex: 1; padding: 10px; font-weight: 700; border-radius: 8px;">Evet, Sil</button>
            <button id="btn-cancel-delete-friend" class="btn btn-outline btn-sm" style="flex: 1; padding: 10px; font-weight: 700; border-radius: 8px;">İptal</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-confirm-delete-friend')?.addEventListener('click', async () => {
      document.getElementById('friend-delete-confirm-modal')?.remove();
      await this.friendService.removeFriend(this.currentUser.uid, friendUid);
      this._render();
    });

    document.getElementById('btn-cancel-delete-friend')?.addEventListener('click', () => {
      document.getElementById('friend-delete-confirm-modal')?.remove();
    });
  }

  // ─── Public: Badge ─────────────────────────────────────────

  async updateBadge(user) {
    const targetUser = user || this.currentUser;
    const badgeEl = document.getElementById('friends-badge');
    if (!badgeEl || !targetUser || targetUser.isGuest) {
      badgeEl?.classList.add('hidden');
      return;
    }

    try {
      const requests = await this.friendService.getPendingRequests(targetUser);
      if (requests.length > 0) {
        badgeEl.textContent = requests.length;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    } catch {
      badgeEl.classList.add('hidden');
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  _getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }
}
