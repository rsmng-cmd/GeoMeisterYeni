// OnlineUI.js — Online Hub, Matchmaking Modal, Özel Odalar & Canlı Maç HUD
import onlineService, { getRankByElo } from '../services/OnlineService.js?v=20260811';
import matchmakingEngine from '../services/MatchmakingEngine.js?v=20260811';
import roomManager from '../services/RoomManager.js?v=20260811';

export class OnlineUI {
  constructor() {
    this.container = null;
    this.currentUser = null;
    this.selectedModeId = 'world'; // 'world' veya 'europe'
    this.onStartMatchCallback = null;
  }

  init(user, onStartMatch) {
    this.currentUser = user;
    this.onStartMatchCallback = onStartMatch;
    this._injectModalHTML();
    this._bindEvents();
  }

  _injectModalHTML() {
    let existing = document.getElementById('online-hub-modal');
    if (!existing) {
      const modalHTML = `
      <div id="online-hub-modal" class="modal-backdrop hidden">
        <div class="online-modal-card">
          <button id="btn-close-online-modal" class="btn-close-modal">✕</button>
          
          <div class="online-header">
            <h2 class="online-title">🌐 GeoMeister Online</h2>
            <p class="online-subtitle">Rakiplerinle kapış, ELO puanı kazan ve rütbeni yükselt!</p>
          </div>

          <!-- Mod Seçimi (Dünya / Avrupa / Türkiye / Afrika) -->
          <div class="online-mode-selector">
            <button class="online-mode-tab active" data-mode="world">🌍 Dünya</button>
            <button class="online-mode-tab" data-mode="europe">🇪🇺 Avrupa</button>
            <button class="online-mode-tab" data-mode="turkey">🇹🇷 Türkiye</button>
            <button class="online-mode-tab" data-mode="africa">🦁 Afrika</button>
          </div>

          <!-- Oyuncu ELO & Rütbe Kartı -->
          <div id="online-user-rank-card" class="user-rank-card">
            <div class="rank-badge-icon">❓</div>
            <div class="rank-info">
              <div class="rank-name" style="color: #94a3b8">Yerleşme Aşamasında (0/5)</div>
              <div class="rank-elo-details">5 Yerleşme Maçından 0'ı Tamamlandı</div>
            </div>
          </div>

          <!-- Ana Eylemler (1v1 Matchmaking, 2v2 Takımlı Maç & Özel Oda) -->
          <div class="online-actions-grid">
            <div class="online-action-card primary" id="card-start-matchmaking">
              <div class="action-icon">⚔️</div>
              <div class="action-title">1v1 Hızlı Eşleşme</div>
              <div class="action-desc">Kendi seviyendeki oyuncularla 1v1 rekabet et</div>
              <button class="btn btn-primary btn-full mt-auto" id="btn-search-match">1v1 Maç Ara</button>
            </div>

            <div class="online-action-card primary" style="border-color: rgba(6,182,212,0.4);" id="card-start-2v2-matchmaking">
              <div class="action-icon">👥⚔️</div>
              <div class="action-title">2v2 Takımlı Maç</div>
              <div class="action-desc">Takım arkadaşınla ortalama mesafede rakip takımı yen!</div>
              <button class="btn btn-full mt-auto" style="background: linear-gradient(135deg, #06b6d4, #3b82f6); color: white;" id="btn-search-2v2-match">2v2 Takım Maçı Ara</button>
            </div>

            <div class="online-action-card secondary">
              <div class="action-icon">🏠</div>
              <div class="action-title">Özel Oda</div>
              <div class="action-desc">Arkadaşlarınla 5 kişiye kadar özel maç yap</div>
              <div class="room-action-buttons">
                <button class="btn btn-secondary" id="btn-create-room">Oda Kur</button>
                <button class="btn btn-outline" id="btn-open-join-input">Odaya Katıl</button>
              </div>
            </div>
          </div>

          <!-- Eşleşme Arama Animasyon Ekranı -->
          <div id="matchmaking-search-overlay" class="search-overlay hidden">
            <div class="spinner-pulse"></div>
            <div class="search-title">Rakip Aranıyor...</div>
            <div id="search-status-text" class="search-status">±20 ELO yakınlığında oyuncu aranıyor [0s]</div>
            <button id="btn-cancel-search" class="btn btn-outline btn-sm mt-md">Aramayı İptal Et</button>
          </div>

          <!-- Odaya Katılma Kod Girdisi -->
          <div id="join-room-container" class="join-room-box hidden mt-md">
            <input type="text" id="input-room-code" placeholder="Oda Kodu (Örn: GEO-8492)" maxlength="8" class="input-room-code" />
            <button id="btn-join-room-submit" class="btn btn-primary">Katıl</button>
          </div>

          <!-- Özel Oda Lobisi -->
          <div id="room-lobby-overlay" class="room-lobby-box hidden">
            <div class="lobby-header">
              <h3>Özel Oda Lobisi</h3>
              <div id="lobby-code-display" class="lobby-code-badge">GEO-XXXX</div>
            </div>

            <!-- Lobi İçi Mod Seçici -->
            <div class="lobby-mode-section">
              <div class="lobby-section-title">🗺️ Seçili Oyun Modu:</div>
              <div class="lobby-mode-chips" id="lobby-mode-chips">
                <button type="button" class="lobby-chip active" data-mode="world">🌍 Dünya</button>
                <button type="button" class="lobby-chip" data-mode="turkey">🇹🇷 Türkiye</button>
                <button type="button" class="lobby-chip" data-mode="europe">🇪🇺 Avrupa</button>
                <button type="button" class="lobby-chip" data-mode="asia">🌏 Asya</button>
                <button type="button" class="lobby-chip" data-mode="americas">🌎 Amerika</button>
                <button type="button" class="lobby-chip" data-mode="africa">🌍 Afrika</button>
              </div>
            </div>

            <div class="lobby-players-list" id="lobby-players-list">
              <!-- Oyuncular buraya gelecek -->
            </div>
            <div class="lobby-controls">
              <button id="btn-start-lobby-game" class="btn btn-success btn-full hidden">Oyunu Başlat 🚀</button>
              <button id="btn-leave-lobby" class="btn btn-outline btn-full">Lobiden Çık</button>
            </div>
          </div>

        </div>
      </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHTML);
      existing = document.getElementById('online-hub-modal');
    }
    this.container = existing;
  }

  _bindEvents() {
    // Kapat Butonu
    document.getElementById('btn-close-online-modal')?.addEventListener('click', () => this.hide());
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('#btn-close-online-modal')) {
        this.hide();
      }
    });

    // Mod Sekmeleri (Dünya / Avrupa / Türkiye / Afrika)
    document.addEventListener('click', async (e) => {
      const tab = e.target?.closest?.('.online-mode-tab');
      if (tab) {
        document.querySelectorAll('.online-mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.selectedModeId = tab.dataset.mode || tab.getAttribute('data-mode') || 'world';
        console.log('[OnlineUI] Mode changed to:', this.selectedModeId);
        await this.refreshUserRankCard();
      }
    });

    // 1v1 Eşleşme Ara Butonu
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('#btn-search-match')) {
        this._startMatchmaking();
      } else if (e.target?.closest?.('#btn-search-2v2-match')) {
        this._start2v2Matchmaking();
      } else if (e.target?.closest?.('#btn-cancel-search')) {
        this._cancelMatchmaking();
      }
    });

    // Özel Oda Butonları
    document.getElementById('btn-create-room')?.addEventListener('click', () => this._handleCreateRoom());
    document.getElementById('btn-open-join-input')?.addEventListener('click', () => {
      document.getElementById('join-room-container')?.classList.toggle('hidden');
    });
    document.getElementById('btn-join-room-submit')?.addEventListener('click', () => this._handleJoinRoom());
    document.getElementById('btn-start-lobby-game')?.addEventListener('click', () => this._handleStartLobbyGame());
    document.getElementById('btn-leave-lobby')?.addEventListener('click', () => this._handleLeaveLobby());
  }

  _start2v2Matchmaking() {
    if (this._checkGuestUser()) return;

    if (!this.teamTeammate) {
      this._show2v2TeammateModal();
      return;
    }

    const overlay = document.getElementById('matchmaking-search-overlay');
    const statusText = document.getElementById('search-status-text');
    if (overlay) overlay.classList.remove('hidden');

    matchmakingEngine.start2v2Search({
      user: this.currentUser,
      teammate: this.teamTeammate,
      modeId: this.selectedModeId,
      onStatusChange: ({ text }) => {
        if (statusText) statusText.textContent = text;
      },
      onMatchFound: (matchData) => {
        if (overlay) overlay.classList.add('hidden');
        this.hide();
        this.onStartMatchCallback?.(matchData);
      },
    });
  }

  _show2v2TeammateModal() {
    let modal = document.getElementById('teammate-select-modal');
    if (modal) modal.remove();

    const modalHTML = `
      <div id="teammate-select-modal" class="modal-backdrop">
        <div class="online-modal-card" style="max-width: 400px; text-align: center; padding: 24px;">
          <div style="font-size: 40px; margin-bottom: 8px;">⚔️</div>
          <h3 style="font-size: 18px; font-weight: 800; color: #f8fafc; margin-bottom: 8px;">2v2 Takımlı Maç Lobisi</h3>
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 20px;">
            2v2 Maç arayabilmek için takımında en az 1 arkadaşın olmalıdır! Lobiye arkadaşını davet et veya test için bot takım arkadaşı ekle.
          </p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="btn-invite-friend-2v2" class="btn btn-primary btn-full">👥 Arkadaş Davet Et</button>
            <button id="btn-add-bot-teammate" class="btn btn-secondary btn-full">🤝 Bot Efe 🤝 (Hızlı Oyna / Test)</button>
            <button id="btn-close-teammate-modal" class="btn btn-outline btn-full">İptal</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-invite-friend-2v2')?.addEventListener('click', () => {
      document.getElementById('teammate-select-modal')?.remove();
      const friendsBtn = document.getElementById('nav-friends-btn');
      if (friendsBtn) friendsBtn.click();
    });

    document.getElementById('btn-add-bot-teammate')?.addEventListener('click', () => {
      document.getElementById('teammate-select-modal')?.remove();
      this.teamTeammate = { uid: 'bot_efe', displayName: 'Bot Efe 🤝', isBot: true };
      this._start2v2Matchmaking();
    });

    document.getElementById('btn-close-teammate-modal')?.addEventListener('click', () => {
      document.getElementById('teammate-select-modal')?.remove();
    });
  }

  async show() {
    console.log('[OnlineUI] show called, container:', this.container);
    if (this._checkGuestUser()) {
      return;
    }
    if (!this.container) {
      this._injectModalHTML();
      this._bindEvents();
    }
    this.container?.classList.remove('hidden');
    try {
      await this.refreshUserRankCard();
    } catch (e) {
      console.warn('[OnlineUI] Error refreshing rank card:', e);
    }
  }

  _checkGuestUser() {
    if (!this.currentUser || this.currentUser.isGuest || this.currentUser.uid?.startsWith('guest')) {
      this.showGuestRestrictionModal();
      return true;
    }
    return false;
  }

  showGuestRestrictionModal() {
    let existing = document.getElementById('guest-restriction-modal');
    if (existing) existing.remove();

    const modalHTML = `
      <div id="guest-restriction-modal" class="modal-backdrop">
        <div class="online-modal-card text-center" style="max-width: 420px; padding: 28px;">
          <div style="font-size: 48px; margin-bottom: 12px;">🔒</div>
          <h2 style="font-size: 22px; font-weight: 800; color: #f8fafc; margin-bottom: 10px;">Misafir Hesap Kısıtlaması</h2>
          <p style="color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
            Online 1v1 maç yapmak, arkadaşlarınla yarışmak ve ELO sıralamasına girmek için lütfen ücretsiz bir üyelik oluşturun veya giriş yapın.
          </p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="btn-guest-auth-redirect" class="btn btn-primary btn-full">Kayıt Ol / Giriş Yap 🚀</button>
            <button id="btn-guest-modal-close" class="btn btn-outline btn-full">Vazgeç</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-guest-auth-redirect')?.addEventListener('click', () => {
      document.getElementById('guest-restriction-modal')?.remove();
      this.hide();
      if (this.onRequireAuthCallback) {
        this.onRequireAuthCallback();
      }
    });

    document.getElementById('btn-guest-modal-close')?.addEventListener('click', () => {
      document.getElementById('guest-restriction-modal')?.remove();
    });
  }

  hide(force = false) {
    const lobbyEl = document.getElementById('room-lobby-overlay');
    const isInLobby = !force && ((lobbyEl && !lobbyEl.classList.contains('hidden')) || !!roomManager.currentRoom);

    if (isInLobby) {
      this._showLeaveLobbyConfirmation(() => {
        this._forceLeaveLobby();
        this.container?.classList.add('hidden');
        matchmakingEngine.cancelSearch();
      });
      return;
    }

    this.container?.classList.add('hidden');
    document.getElementById('room-lobby-overlay')?.classList.add('hidden');
    document.getElementById('matchmaking-search-overlay')?.classList.add('hidden');
    matchmakingEngine.cancelSearch();
    if (!force) {
      roomManager.stopListening();
    }
  }

  async refreshUserRankCard() {
    const stats = await onlineService.getPlayerOnlineStats(this.currentUser, this.selectedModeId);
    const rankCard = document.getElementById('online-user-rank-card');
    if (!rankCard) return;

    const rank = stats.rank;
    const modeNames = {
      world: 'Dünya',
      europe: 'Avrupa',
      turkey: 'Türkiye',
      africa: 'Afrika',
    };
    const modeName = modeNames[this.selectedModeId] || 'Dünya';
    const placementText = stats.isRanked 
      ? `${stats.elo} ELO • ${stats.wins} Galibiyet / ${stats.losses} Mağlubiyet`
      : `5 Yerleşme Maçından ${stats.matchesPlayed}'i Tamamlandı`;

    rankCard.style.borderColor = rank.color;
    rankCard.innerHTML = `
      <div class="rank-badge-icon">${rank.icon}</div>
      <div class="rank-info">
        <div class="rank-name" style="color: ${rank.color}">${rank.name} (${modeName})</div>
        <div class="rank-elo-details">${placementText}</div>
      </div>
    `;
  }

  _startMatchmaking() {
    if (this._checkGuestUser()) return;
    const overlay = document.getElementById('matchmaking-search-overlay');
    const statusText = document.getElementById('search-status-text');
    overlay?.classList.remove('hidden');

    matchmakingEngine.startSearch({
      user: this.currentUser,
      modeId: this.selectedModeId,
      onStatusChange: ({ text }) => {
        if (statusText) statusText.innerText = text;
      },
      onMatchFound: (matchData) => {
        overlay?.classList.add('hidden');
        this.hide(true);
        if (this.onStartMatchCallback) {
          this.onStartMatchCallback({
            modeId: this.selectedModeId,
            matchData,
          });
        }
      },
    });
  }

  _cancelMatchmaking() {
    matchmakingEngine.cancelSearch();
    document.getElementById('matchmaking-search-overlay')?.classList.add('hidden');
  }

  async _handleCreateRoom() {
    try {
      const room = await roomManager.createRoom(this.currentUser, this.selectedModeId);
      this._renderLobby(room);
    } catch (e) {
      alert(e.message);
    }
  }

  async _handleJoinRoom() {
    const codeInput = document.getElementById('input-room-code');
    const code = codeInput?.value?.trim();
    if (!code) {
      alert('Lütfen geçerli bir oda kodu girin!');
      return;
    }

    try {
      const room = await roomManager.joinRoom(code, this.currentUser);
      this._renderLobby(room);
    } catch (e) {
      alert(e.message);
    }
  }

  async reopenLobby(roomCode, isHost = false) {
    if (!roomCode) return;
    if (!this.container) {
      this._injectModalHTML();
      this._bindEvents();
    }
    this.container?.classList.remove('hidden');

    // Odayı sıfırla ve 'waiting' modunda lobiye gir
    let room = await roomManager.resetRoomToLobby(roomCode);
    if (!room) {
      room = await roomManager.joinRoom(roomCode, this.currentUser).catch(async () => {
        return await roomManager.resetRoomToLobby(roomCode);
      });
    }

    if (room) {
      this._renderLobby(room);
    }
  }

  _renderLobby(room) {
    const lobbyBox = document.getElementById('room-lobby-overlay');
    const codeDisplay = document.getElementById('lobby-code-display');
    const playersList = document.getElementById('lobby-players-list');
    const startBtn = document.getElementById('btn-start-lobby-game');

    lobbyBox?.classList.remove('hidden');
    if (codeDisplay) codeDisplay.innerText = room.code;

    const myUid = this.currentUser?.uid || room.hostUid;
    const isHost = room.hostUid === myUid || (room.players && room.players.some(p => p.uid === myUid && p.isHost));
    if (startBtn) {
      if (isHost) startBtn.classList.remove('hidden');
      else startBtn.classList.add('hidden');
    }

    // Lobi Mod Seçici Çiplerini Başlat
    const chipsContainer = document.getElementById('lobby-mode-chips');
    const currentMode = room.modeId || this.selectedModeId || 'world';
    this.selectedModeId = currentMode;

    if (chipsContainer) {
      const chips = chipsContainer.querySelectorAll('.lobby-chip');
      chips.forEach(chip => {
        const mode = chip.dataset.mode || chip.getAttribute('data-mode');
        chip.classList.toggle('active', mode === currentMode);
        if (!isHost) {
          chip.classList.add('guest-disabled');
          chip.style.pointerEvents = 'none';
        } else {
          chip.classList.remove('guest-disabled');
          chip.style.pointerEvents = 'auto';
          chip.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectedModeId = mode;
            chips.forEach(c => c.classList.toggle('active', c === chip));
            await roomManager.updateRoomMode(room.code, mode);
          };
        }
      });
    }

    const renderPlayers = (players) => {
      if (playersList && players) {
        playersList.innerHTML = players.map(p => `
          <div class="lobby-player-item">
            <span class="player-avatar">👤</span>
            <span class="player-name">${p.displayName} ${p.isHost ? '👑 (Kurucu)' : ''}</span>
          </div>
        `).join('');
      }
    };

    // Anlık oyuncu listesini hemen göster
    renderPlayers(room.players);

    let matchStarted = false;

    roomManager.listenToRoom(room.code, (updatedRoom) => {
      // Lobi kurucusu ayrıldıysa veya oda silindiyse misafiri lobiden at
      if (!updatedRoom || updatedRoom.status === 'closed') {
        roomManager.stopListening();
        lobbyBox?.classList.add('hidden');
        alert('Oda kurucusu ayrıldığı için lobi kapatıldı.');
        this.show();
        return;
      }

      // Kurucu modu değiştirdiyse tüm oyuncuların ekranında güncelle
      if (updatedRoom.modeId && updatedRoom.modeId !== this.selectedModeId) {
        this.selectedModeId = updatedRoom.modeId;
        const chips = document.querySelectorAll('.lobby-chip');
        chips.forEach(chip => {
          const mode = chip.dataset.mode || chip.getAttribute('data-mode');
          chip.classList.toggle('active', mode === updatedRoom.modeId);
        });
      }

      // Oda 'playing' durumuna geçtiğinde hem kurucu hem davet edilen oyuncuda maçı başlat!
      if (updatedRoom.status === 'playing' && !matchStarted) {
        matchStarted = true;
        roomManager.stopListening();
        lobbyBox?.classList.add('hidden');
        this.hide(true); // Direkt başla — lobiden çıkılsın mı uyarısı verme!

        const currentUid = this.currentUser?.uid || (this.currentUser ? this.currentUser.uid : 'guest');
        const isCurrentHost = updatedRoom.hostUid === currentUid || (updatedRoom.players && updatedRoom.players.some(p => p.uid === currentUid && p.isHost));
        const opponentPlayer = (updatedRoom.players && updatedRoom.players.find(p => p.uid !== currentUid)) || {
          uid: updatedRoom.hostUid || 'opponent_host',
          displayName: isCurrentHost ? 'GeoBot' : 'Oda Sahibi',
          elo: 50,
          rank: { name: 'Bronz', color: '#cd7f32', icon: '🥉' }
        };

        if (this.onStartMatchCallback) {
          this.onStartMatchCallback({
            modeId: updatedRoom.modeId || this.selectedModeId || 'world',
            matchData: {
              matchId: updatedRoom.matchId || `room_${updatedRoom.code}`,
              roomCode: updatedRoom.code,
              isRoomMatch: true,
              isFriendMatch: true,
              isHost: isCurrentHost,
              isBot: (updatedRoom.players || []).length <= 1,
              opponent: opponentPlayer,
              questions: updatedRoom.questions || room.questions || [],
              players: updatedRoom.players || [],
            },
          });
        }
        return;
      }

      renderPlayers(updatedRoom.players);
    });
  }

  _handleStartLobbyGame() {
    if (roomManager.currentRoom) {
      const playersCount = roomManager.currentRoom.players ? roomManager.currentRoom.players.length : 1;
      if (playersCount < 2) {
        const proceedWithBot = confirm('Arkadaşınız henüz lobiye dönmedi veya ayrıldı.\n\nOyun bir Bot rakip ile başlatılsın mı?');
        if (!proceedWithBot) return;
      }
      roomManager.startGame(roomManager.currentRoom.code, this.selectedModeId);
    }
  }

  _handleLeaveLobby() {
    this._showLeaveLobbyConfirmation(() => {
      this._forceLeaveLobby();
    });
  }

  _forceLeaveLobby() {
    if (roomManager.currentRoom) {
      roomManager.leaveRoom(roomManager.currentRoom.code, this.currentUser);
    } else {
      roomManager.stopListening();
    }
    document.getElementById('room-lobby-overlay')?.classList.add('hidden');
  }

  _showLeaveLobbyConfirmation(onConfirm) {
    let existing = document.getElementById('leave-lobby-confirm-modal');
    if (existing) existing.remove();

    const modalHTML = `
      <div id="leave-lobby-confirm-modal" class="modal-backdrop" style="z-index: 9999999 !important; display: flex !important; align-items: center !important; justify-content: center !important;">
        <div class="online-modal-card text-center" style="max-width: 400px; padding: 24px; background: #0f172a; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 16px;">
          <div style="font-size: 40px; margin-bottom: 8px;">🚪</div>
          <h3 style="font-size: 18px; font-weight: 800; color: #f8fafc; margin-bottom: 8px;">Lobiden Ayrıl</h3>
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 20px;">
            Lobiden çıkış yapmak istediğinize emin misiniz? Çıkış yaparsanız oda bağlantınız sonlandırılacaktır.
          </p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="btn-confirm-leave-lobby" class="btn btn-danger btn-full" style="background: #ef4444; border-color: #ef4444; color: white; padding: 10px; font-weight: 700; border-radius: 8px;">Evet, Lobiden Çık</button>
            <button id="btn-cancel-leave-lobby" class="btn btn-outline btn-full" style="padding: 10px; border-radius: 8px;">İptal</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-confirm-leave-lobby')?.addEventListener('click', () => {
      document.getElementById('leave-lobby-confirm-modal')?.remove();
      if (typeof onConfirm === 'function') onConfirm();
    });

    document.getElementById('btn-cancel-leave-lobby')?.addEventListener('click', () => {
      document.getElementById('leave-lobby-confirm-modal')?.remove();
    });
  }

  /**
   * Canlı Online Maç Bittiğinde ELO Güncelleme Sonuç Ekranı Gösterir
   * @param {object} result — Maç sonucu
   * @param {object} callbacks — { onReturnHome, onSearchMatch, onCreateRoom, onReturnToLobby }
   */
  showOnlineGameOverModal(result, callbacks = {}) {
    const existing = document.getElementById('online-gameover-modal');
    if (existing) existing.remove();

    const { onReturnHome, onSearchMatch, onCreateRoom, onReturnToLobby } = callbacks;

    const me = result.me || { displayName: 'Siz', score: 0 };
    const opponent = result.opponent || { displayName: 'Rakip', score: 0 };
    const rankInfo = result.eloResult || { newElo: 1000, rank: null };
    const isWin = !!result.isWin;
    const isForfeit = !!result.isForfeit;
    const isRoomMatch = !!(result.isRoomMatch || result.roomCode);

    const rankDisplay = (!isRoomMatch && rankInfo.rank)
      ? `<div class="rank-badge-inline" style="color: ${rankInfo.rank.color || '#38bdf8'}">${rankInfo.rank.icon || '🏆'} ${rankInfo.rank.name || ''}</div>`
      : '';

    const eloText = isRoomMatch 
      ? `🏠 Özel Oda Maçı`
      : (rankInfo.eloDelta ? (rankInfo.eloDelta > 0 ? `+${rankInfo.eloDelta} ELO` : `${rankInfo.eloDelta} ELO`) : (isWin ? '+10 ELO' : '-10 ELO'));

    let headerTitle = isWin ? '🏆 KAZANDINIZ!' : '💔 KAYBETTİNİZ';
    let headerSubtitle = isWin ? 'Tebrikler, rakibinizi mağlup ettiniz!' : 'Bu sefer olmadı, tekrar deneyin!';

    if (isForfeit) {
      if (isWin) {
        headerTitle = '🏆 HÜKMEN KAZANDINIZ!';
        headerSubtitle = result.forfeitDetails || 'Rakip AFK kaldığı veya oyundan ayrıldığı için maçı hükmen kazandınız! 🥇';
      } else {
        headerTitle = '⏱️ HÜKMEN MAĞLUP OLDUNUZ';
        headerSubtitle = result.forfeitDetails || '10 saniye sekme dışı kaldığınız veya 30 saniye hareketsiz (AFK) kaldığınız için maç kaybedildi.';
      }
    }

    // Aksiyon Butonları: Özel oda maçında "Lobiye Dön" göster, rastgele eşleşmede "Tekrar Eşleşme" göster
    const actionButtonsHTML = isRoomMatch ? `
      <div class="gameover-actions-grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
        <button id="btn-return-lobby-online" class="btn btn-primary btn-full" style="font-size: 15px; font-weight: 800; background: linear-gradient(135deg, #06b6d4, #3b82f6); box-shadow: 0 4px 15px rgba(6,182,212,0.35);">Lobiye Dön 🏠</button>
        <button id="btn-return-home-online" class="btn btn-secondary btn-full">Ana Menü 🚪</button>
      </div>
    ` : `
      <div class="gameover-actions-grid">
        <button id="btn-return-home-online" class="btn btn-secondary btn-full">Ana Menüye Dön 🏠</button>
        <button id="btn-search-match-again" class="btn btn-primary btn-full">Tekrar Eşleşme ⚔️</button>
        <button id="btn-create-room-gameover" class="btn btn-outline btn-full">Oda Oluştur 🏠</button>
      </div>
    `;

    const modalHTML = `
      <div id="online-gameover-modal" class="modal-backdrop" style="z-index: 999999 !important; display: flex !important; visibility: visible !important; opacity: 1 !important;">
        <div class="online-modal-card gameover-card">
          <div class="gameover-header ${isWin ? 'win' : 'loss'}">
            <h2>${headerTitle}</h2>
            <p>${headerSubtitle}</p>
          </div>

          <div class="score-comparison">
            <div class="player-score-box me">
              <div class="box-label">${me.displayName || 'Siz'}</div>
              <div class="box-score">${(me.score || 0).toLocaleString('tr-TR')} p</div>
            </div>
            <div class="vs-divider">VS</div>
            <div class="player-score-box opponent">
              <div class="box-label">${opponent.displayName || 'Rakip'}</div>
              <div class="box-score">${(opponent.score || 0).toLocaleString('tr-TR')} p</div>
            </div>
          </div>

          <!-- ELO Değişim & Rütbe -->
          <div class="elo-change-card">
            <div class="elo-delta ${isRoomMatch ? '' : (isWin ? 'positive' : 'negative')}" style="${isRoomMatch ? 'color: #38bdf8; font-size: 1.1rem;' : ''}">
              ${eloText}
            </div>
            ${isRoomMatch ? '<div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Oda Kodu: ' + (result.roomCode || '') + '</div>' : `<div class="new-elo-value">Yeni ELO: <strong>${rankInfo.newElo ?? 1000}</strong></div>`}
            ${rankDisplay}
          </div>

          ${actionButtonsHTML}
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-return-lobby-online')?.addEventListener('click', () => {
      document.getElementById('online-gameover-modal')?.remove();
      document.getElementById('online-live-toast')?.remove();
      if (onReturnToLobby) onReturnToLobby({ roomCode: result.roomCode, isHost: result.isHost });
    });

    document.getElementById('btn-return-home-online')?.addEventListener('click', () => {
      document.getElementById('online-gameover-modal')?.remove();
      document.getElementById('online-live-toast')?.remove();
      if (isRoomMatch && result.roomCode) {
        roomManager.leaveRoom(result.roomCode, this.currentUser);
      }
      if (onReturnHome) onReturnHome();
      else window.location.hash = 'home';
    });

    document.getElementById('btn-search-match-again')?.addEventListener('click', () => {
      document.getElementById('online-gameover-modal')?.remove();
      document.getElementById('online-live-toast')?.remove();
      if (onSearchMatch) onSearchMatch();
    });

    document.getElementById('btn-create-room-gameover')?.addEventListener('click', () => {
      document.getElementById('online-gameover-modal')?.remove();
      document.getElementById('online-live-toast')?.remove();
      if (onCreateRoom) onCreateRoom();
    });
  }
}

export default new OnlineUI();
