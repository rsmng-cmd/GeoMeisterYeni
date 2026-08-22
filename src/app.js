/**
 * app.js — GeoMeister Ana Giriş Noktası
 * Seviye sistemi kaldırıldı — mod seçimi → 10 soruluk oyun akışı.
 */

import { AuthService } from './services/AuthService.js';
import { ScoreService } from './services/ScoreService.js';
import { AuthUI } from './ui/AuthUI.js';
import { HomeUI } from './ui/HomeUI.js';
import { GameUI } from './ui/GameUI.js';
import { LeaderboardUI } from './ui/LeaderboardUI.js';
import { ProfileUI } from './ui/ProfileUI.js';
import { LevelSelectUI } from './ui/LevelSelectUI.js';
import { GameEngine } from './core/GameEngine.js';
import { OnlineGameEngine } from './core/OnlineGameEngine.js';
import onlineUI from './ui/OnlineUI.js';
import { getModeById } from './modes/ModeRegistry.js';
import { getLevelConfig } from './config/levels.js';
import { SettingsService } from './services/SettingsService.js';
import { SettingsUI } from './ui/SettingsUI.js';
import { FriendService } from './services/FriendService.js';
import { FriendsUI } from './ui/FriendsUI.js';
import presenceService from './services/PresenceService.js';

class App {
  constructor() {
    // Servisler
    this.authService = new AuthService();
    this.scoreService = new ScoreService();
    this.settingsService = new SettingsService();
    this.friendService = new FriendService();
    this.presenceService = presenceService;

    // Core State
    this.currentUser = null;
    this.userProfile = null;
    this.activeGame = null;
    this.activeOnlineGame = null;
    this.currentScreen = null;
    this.currentModeId = 'world';
    this.currentMode = getModeById('world');
    this.currentLevelConfig = null;

    // Unsubscribe handlers (Memory Leak Prevention)
    this._authUnsubscribe = null;
    this._inviteUnsubscribe = null;

    // UI Bileşenleri — Lazy Initialization (İlk Açılış Hızlandırma)
    this.authUI = new AuthUI(this.authService, () => {
      const guest = this.authService.loginAsGuest('Oyuncu');
      this.currentUser = guest;
      onlineUI.currentUser = guest;
      this.userProfile = { totalScore: 0, gamesPlayed: 0, bestScore: 0 };
      this.authUI.hide();
      this._showHome();
    });

    this.homeUI = new HomeUI({
      onModeSelect: (modeId) => this._startMode(modeId),
      onLeaderboard: () => this._showLeaderboard(),
      onLogout: () => this._logout(),
    });

    this.gameUI = new GameUI({
      onNext: () => this._onNextRound(),
      onHome: () => this._goHome(),
      onReplay: () => this._onReplay(),
      onNextLevel: (nextLevelNum) => {
        const nextConfig = getLevelConfig(nextLevelNum);
        this._startLevelGame(this.currentMode, nextConfig, true);
      },
    });

    // Lazy UI instances
    this._levelSelectUI = null;
    this._leaderboardUI = null;
    this._profileUI = null;
    this._settingsUI = null;
    this._friendsUI = null;
  }

  // Lazy UI Getters
  get levelSelectUI() {
    if (!this._levelSelectUI) {
      this._levelSelectUI = new LevelSelectUI({
        onLevelSelect: (levelConfig) => this._startLevelGame(this.currentMode, levelConfig),
        onBack: () => this._showHome(),
      });
      this._levelSelectUI.init();
    }
    return this._levelSelectUI;
  }

  get leaderboardUI() {
    if (!this._leaderboardUI) {
      this._leaderboardUI = new LeaderboardUI({ onBack: () => this._goHome() });
      this._leaderboardUI.init();
    }
    return this._leaderboardUI;
  }

  get profileUI() {
    if (!this._profileUI) {
      this._profileUI = new ProfileUI();
    }
    return this._profileUI;
  }

  get settingsUI() {
    if (!this._settingsUI) {
      this._settingsUI = new SettingsUI(this.settingsService);
      this._settingsUI.init();
    }
    return this._settingsUI;
  }

  get friendsUI() {
    if (!this._friendsUI) {
      this._friendsUI = new FriendsUI(this.friendService);
      this._friendsUI.presenceService = this.presenceService;
      if (this.currentUser) this._friendsUI.currentUser = this.currentUser;
    }
    return this._friendsUI;
  }

  async init() {
    this.authUI.init();
    this.homeUI.init();
    onlineUI.init(this.currentUser, ({ modeId, matchData }) => {
      this._startOnlineMatch(modeId, matchData);
    });
    onlineUI.onRequireAuthCallback = () => this._showAuth();

    // Ayarlar — tema uygula
    this.settingsService.applyTheme();

    // Mobil tam ekran kontrolü
    this._checkMobileFullscreenPrompt();

    // Keyboard shortcuts
    this._initKeyboardShortcuts();

    // Auth dinleyicisi (Unsubscribe sakla)
    if (this._authUnsubscribe) this._authUnsubscribe();
    this._authUnsubscribe = this.authService.onAuthChange((user) => {
      this.currentUser = user;
      onlineUI.currentUser = user;
      if (this._friendsUI) {
        this._friendsUI.currentUser = user;
        this._friendsUI.presenceService = this.presenceService;
      }
      if (user) {
        // Presence başlat
        this.presenceService.start(user);
        this.presenceService.setActivity('Ana Menü');

        this.userProfile = this._loadCachedProfile(user.uid);
        this.authUI.hide();
        this._showHome();

        this._cacheLastUser(user);

        // Firestore'dan güncel profili arka planda yükle
        this.scoreService.getUserProfile(user)
          .then((profile) => {
            this.userProfile = profile;
            this._cacheProfile(user.uid, profile);
          })
          .catch((e) => {
            console.warn('[App] Profil yüklenemedi:', e.message);
          });

        // Arkadaş davetlerini dinle (Önceki dinleyiciyi temizle)
        this.friendService.stopListening();
        this.friendService.listenForInvites(user, (invite) => {
          this.friendsUI.showIncomingInvite(invite, async (accepted) => {
            if (accepted) {
              if (invite.roomCode) {
                try {
                  const roomFns = await import('./services/RoomManager.js');
                  const roomManager = roomFns.default || roomFns.roomManager || (roomFns.RoomManager ? new roomFns.RoomManager() : null);
                  const room = await roomManager.joinRoom(invite.roomCode, user);
                  
                  const onlineFns = await import('./ui/OnlineUI.js');
                  const onlineUI = onlineFns.default || onlineFns.onlineUI;
                  if (onlineUI) {
                    onlineUI.currentUser = user;
                    onlineUI.show();
                    onlineUI._renderLobby(room);
                  }
                } catch (e) {
                  console.warn('[App] Error joining room from invite:', e);
                  alert(`Odaya katılırken hata oluştu: ${e.message}`);
                }
              } else {
                this._startOnlineMatch(invite.modeId, {
                  matchId: `friend_match_${Date.now()}`,
                  isFriendMatch: true,
                  isBot: false,
                  opponent: {
                    uid: invite.fromUid,
                    displayName: invite.fromName,
                    elo: 50,
                  },
                });
              }
            }
          });
        });
      } else {
        this.presenceService.stop();
        this.friendService.stopListening();
        this._destroyActiveGame();
        this._showAuth();
      }
    });

    // Profil tıklama (avatar veya kullanıcı adı)
    const openProfile = () => this.profileUI.show(this.currentUser, this.userProfile);
    document.getElementById('user-avatar')?.addEventListener('click', openProfile);
    document.getElementById('user-display-name')?.addEventListener('click', openProfile);

    // Ayarlar butonu
    document.getElementById('settings-btn')?.addEventListener('click', () => this.settingsUI.show());

    // Arkadaşlar butonu (Slide Panel Toggle)
    document.getElementById('friends-btn')?.addEventListener('click', () => this.friendsUI.toggle());

    // Tam Ekran Butonu (Header, Oyun İçi & Mobil Toggle)
    const toggleFullscreen = () => this._toggleFullscreen();
    document.getElementById('fullscreen-btn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('game-fullscreen-btn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('floating-fullscreen-btn')?.addEventListener('click', toggleFullscreen);

    // Fullscreen state listener
    const updateFsIcons = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      const fsBtn = document.getElementById('fullscreen-btn');
      const gameFsBtn = document.getElementById('game-fullscreen-btn');
      const floatFsBtn = document.getElementById('floating-fullscreen-btn');
      if (fsBtn) fsBtn.textContent = isFs ? '🗗' : '⛶';
      if (gameFsBtn) gameFsBtn.textContent = isFs ? '🗗' : '⛶';
      if (floatFsBtn) floatFsBtn.style.display = isFs ? 'none' : '';
    };

    document.addEventListener('fullscreenchange', updateFsIcons);
    document.addEventListener('webkitfullscreenchange', updateFsIcons);
  }

  // ─── Ekran Geçişleri ────────────────────────────────────────

  _showAuth() {
    this._hideAllScreens();
    this.currentScreen = 'auth';
    this.authUI.show();
  }

  _showHome() {
    this._destroyActiveGame();
    this._hideAllScreens();
    this.currentScreen = 'home';
    this.presenceService.setActivity('Ana Menü');
    this.homeUI.show(this.currentUser, this.userProfile);
    this.friendsUI.updateBadge(this.currentUser);
  }

  _showLeaderboard() {
    this._hideAllScreens();
    this.currentScreen = 'leaderboard';
    this.presenceService.setActivity('🏆 Liderlik Tablosunda');
    this.leaderboardUI.show(this.currentUser, this.friendService);
  }

  _isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  _showIOSFullscreenGuide() {
    let modal = document.getElementById('ios-fullscreen-guide-modal');
    if (modal) modal.remove();

    const modalHTML = `
      <div id="ios-fullscreen-guide-modal" class="modal-backdrop" style="z-index: 99999999 !important; display: flex; align-items: center; justify-content: center;">
        <div class="online-modal-card" style="max-width: 380px; padding: 24px; text-align: center; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.8);">
          <div style="font-size: 40px; margin-bottom: 8px;">🍎</div>
          <h3 style="font-size: 18px; font-weight: 800; color: #f8fafc; margin-bottom: 12px;">iPhone Tam Ekran Kılavuzu</h3>
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.6; text-align: left; margin-bottom: 20px; background: rgba(255,255,255,0.04); padding: 12px 14px; border-radius: 12px;">
            Apple (iOS Safari) tarayıcı içinde butonla tam ekrana izin vermemektedir. Tam ekran ve çubuksuz oynamak için:<br/><br/>
            <strong style="color: #38bdf8;">1.</strong> Safari'nin altındaki <strong style="color: #f8fafc;">Paylaş (📤)</strong> butonuna dokunun.<br/>
            <strong style="color: #38bdf8;">2.</strong> <strong style="color: #f8fafc;">'Ana Ekrana Ekle' (➕)</strong> seçeneğini seçin.<br/><br/>
            🎉 Ana ekrandan açtığınızda oyun tıpkı bir uygulama gibi tam ekran açılacaktır!
          </p>
          <button id="btn-close-ios-guide" class="btn btn-primary btn-full" style="padding: 12px; font-weight: 700;">Anladım 👍</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.getElementById('btn-close-ios-guide')?.addEventListener('click', () => {
      document.getElementById('ios-fullscreen-guide-modal')?.remove();
    });
  }

  _toggleFullscreen() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    const docEl = document.documentElement;
    const canFs = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen);

    if (!canFs && this._isIOS()) {
      this._showIOSFullscreenGuide();
      return;
    }

    if (!isFs) {
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {
          if (this._isIOS()) this._showIOSFullscreenGuide();
        });
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.mozRequestFullScreen) {
        docEl.mozRequestFullScreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      } else if (this._isIOS()) {
        this._showIOSFullscreenGuide();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  _checkMobileFullscreenPrompt() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || window.Capacitor?.isNativePlatform?.()
      || ('ontouchstart' in window)
      || window.innerWidth <= 768;

    if (isMobile && !sessionStorage.getItem('gm_mobile_prompted')) {
      sessionStorage.setItem('gm_mobile_prompted', 'true');
      
      const modalHTML = `
        <div id="mobile-fullscreen-modal" class="modal-backdrop" style="z-index: 9999999 !important;">
          <div class="online-modal-card text-center" style="max-width: 400px; padding: 24px; text-align: center;">
            <div style="font-size: 42px; margin-bottom: 8px;">📱</div>
            <h3 style="font-size: 20px; font-weight: 800; color: #f8fafc; margin-bottom: 8px;">Mobil Cihaz Algılandı</h3>
            <p style="color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
              En iyi oyun deneyimi için tam ekrana geçilsin mi?<br/>
              <span style="color: #38bdf8; font-size: 0.82rem;">(Bildirim çubuğu ve alt gezinme paneli gizlenir)</span>
            </p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <button id="btn-enable-fullscreen" class="btn btn-primary btn-full" style="padding: 12px; font-weight: 800;">Tam Ekrana Geç 🚀</button>
              <button id="btn-skip-fullscreen" class="btn btn-outline btn-full">Şimdi Değil</button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHTML);

      document.getElementById('btn-enable-fullscreen')?.addEventListener('click', () => {
        document.getElementById('mobile-fullscreen-modal')?.remove();
        this._toggleFullscreen();
      });

      document.getElementById('btn-skip-fullscreen')?.addEventListener('click', () => {
        document.getElementById('mobile-fullscreen-modal')?.remove();
      });
    }
  }

  _hideAllScreens() {
    this.authUI.hide();
    this.homeUI.hide();
    this._levelSelectUI?.hide();
    this.gameUI.hide();
    this._leaderboardUI?.hide();
    this._profileUI?.hide();
    document.getElementById('online-live-toast')?.remove();
    document.getElementById('online-gameover-modal')?.remove();
  }

  // ─── Oyun Akışı ────────────────────────────────────────────

  /**
   * Bir moda tıklandığında — Seviye seçim ekranını açar.
   */
  _startMode(modeId) {
    if (modeId === 'online') {
      onlineUI.currentUser = this.currentUser;
      onlineUI.show();
      return;
    }

    const mode = getModeById(modeId);
    if (!mode || !mode.available) return;

    this.currentModeId = modeId;
    this.currentMode = mode;

    // Seviye Seçim Ekranını Atlama — Doğrudan 1. Seviyeden Başlat
    this.currentRunScore = 0;
    this.currentRunRounds = [];
    this.currentRunMaxPossible = 0;

    const level1Config = getLevelConfig(1);
    this._startLevelGame(mode, level1Config, false);
  }

  /**
   * Seviye Oyununu Başlatır (Level 1-10) — Maraton Birikimli Skor Sistemi
   */
  _startLevelGame(mode, levelConfig, isContinuingRun = false) {
    this.currentLevelConfig = levelConfig;
    if (!isContinuingRun) {
      this.currentRunScore = 0;
      this.currentRunRounds = [];
      this.currentRunMaxPossible = 0;
    }

    this._destroyActiveGame();
    this._hideAllScreens();
    this.currentScreen = 'game';
    this.presenceService.setActivity(`🎮 ${mode.name} (Seviye ${levelConfig?.level || 1})`);
    this.gameUI.show();

    this.activeGame = new GameEngine(
      mode,
      {
        onRoundStart: (city, round, total) => {
          this.gameUI.onRoundStart(city, round, total, levelConfig);
        },
        onTimerTick: (timeLeft, total) => {
          this.gameUI.updateTimer(timeLeft, total);
        },
        onGuessResult: (result) => {
          this.gameUI.onGuessResult(result);
        },
        onGameOver: async (result) => {
          const levelScore = result.totalScore;
          this.currentRunScore = (this.currentRunScore || 0) + levelScore;
          this.currentRunMaxPossible = (this.currentRunMaxPossible || 0) + result.maxPossible;
          if (!this.currentRunRounds) this.currentRunRounds = [];
          this.currentRunRounds.push(...result.rounds);

          const runResult = {
            ...result,
            levelScore,
            runTotalScore: this.currentRunScore,
            totalScore: this.currentRunScore,
            maxPossible: this.currentRunMaxPossible,
            rounds: this.currentRunRounds,
          };

          this.gameUI.onGameOver(runResult);

          // Maraton Seri Rekorunu Liderlik Tablosuna ve Profile Kaydet
          try {
            const saveTimeout = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('save timeout')), 5000)
            );
            await Promise.race([
              this.scoreService.saveScore(this.currentUser, runResult),
              saveTimeout,
            ]);
          } catch (err) {
            console.warn('[App] Score save error:', err.message);
            this.scoreService._saveToLocal({
              uid: this.currentUser.uid,
              displayName: this.currentUser.displayName || 'Anonim',
              modeId: runResult.mode.id,
              modeName: runResult.mode.name,
              totalScore: runResult.totalScore,
              maxPossible: runResult.maxPossible,
              accuracy: Math.round((runResult.totalScore / runResult.maxPossible) * 100),
              roundCount: runResult.rounds.length,
              rounds: runResult.rounds.map((r) => ({
                city: r.city.name, country: r.city.country,
                score: r.score, distance: Math.round(r.distance),
              })),
              playedAt: new Date().toISOString(),
            });
          }

          // Profil cache güncelle
          try {
            const updatedProfile = await this.scoreService.getUserProfile(this.currentUser);
            this.userProfile = updatedProfile;
            this._cacheProfile(this.currentUser.uid, updatedProfile);
          } catch {}
        },
      },
      levelConfig
    );

    this.activeGame.start('map-container');
  }

  _startOnlineMatch(modeIdOrPayload, maybeMatchData) {
    let modeId = modeIdOrPayload;
    let matchData = maybeMatchData;

    if (typeof modeIdOrPayload === 'object' && modeIdOrPayload !== null) {
      if (modeIdOrPayload.matchData) {
        matchData = modeIdOrPayload.matchData;
        modeId = modeIdOrPayload.modeId || matchData.modeId || 'world';
      } else {
        matchData = modeIdOrPayload;
        modeId = matchData.modeId || 'world';
      }
    }

    const mode = getModeById(modeId) || getModeById('world');
    this._destroyActiveGame();
    this._hideAllScreens();
    this.currentScreen = 'game';
    this.presenceService.setActivity(`⚔️ ${mode.name} Online 1v1`);
    this.gameUI.show();

    this.activeOnlineGame = new OnlineGameEngine({
      modeConfig: mode,
      matchData,
      user: this.currentUser,
      onStateChange: (state) => {
        this.gameUI.updateOnlineHUD(state);
      },
      onGameOver: (result) => {
        this.gameUI.hide();
        onlineUI.showOnlineGameOverModal(result, {
          onReturnHome: () => this._showHome(),
          onReturnToLobby: async ({ roomCode, isHost }) => {
            this._showHome();
            setTimeout(async () => {
              onlineUI.currentUser = this.currentUser;
              await onlineUI.reopenLobby(roomCode, isHost);
            }, 200);
          },
          onSearchMatch: () => {
            this._showHome();
            setTimeout(() => {
              onlineUI.currentUser = this.currentUser;
              onlineUI.show();
              onlineUI._startMatchmaking();
            }, 300);
          },
          onCreateRoom: () => {
            this._showHome();
            setTimeout(() => {
              onlineUI.currentUser = this.currentUser;
              onlineUI.show();
              onlineUI._handleCreateRoom();
            }, 300);
          },
        });

        // Online skorunu ilgili moda (Örn: Avrupa, Türkiye, Dünya, Afrika) kaydet
        try {
          const targetMode = result.mode || mode || { id: 'world', name: 'Dünya' };
          const modeId = targetMode.id || 'world';
          const modeName = targetMode.name || 'Dünya';

          this.scoreService.saveScore(this.currentUser, {
            totalScore: result.me?.score || 0,
            rounds: (result.rounds && result.rounds.length > 0) ? result.rounds : (result.me?.rounds || []),
            mode: { id: modeId, name: modeName },
            maxPossible: 10000,
          });

          // Profil cache güncelle
          this.scoreService.getUserProfile(this.currentUser).then((updatedProf) => {
            if (updatedProf) {
              this.userProfile = updatedProf;
              this._cacheProfile(this.currentUser.uid, updatedProf);
            }
          }).catch(() => {});
        } catch (err) {
          console.warn('[App] Online score save warning:', err);
        }
      },
    });

    this.activeOnlineGame.start('map-container');
  }

  _onNextRound() {
    this.activeGame?.next();
  }

  _onReplay() {
    const mode = getModeById(this.currentModeId) || this.currentMode;
    if (mode && this.currentLevelConfig) {
      this._startLevelGame(mode, this.currentLevelConfig);
    } else {
      this._goHome();
    }
  }

  _goHome() {
    if (this.activeOnlineGame && this.activeOnlineGame.phase !== 'finished') {
      this._showOnlineExitConfirmModal(() => {
        this.activeOnlineGame?.forfeitAndLeave();
        this._showHome();
      });
      return;
    }
    this._showHome();
  }

  _showOnlineExitConfirmModal(onConfirm) {
    const existing = document.getElementById('online-exit-confirm-modal');
    if (existing) existing.remove();

    const modalHTML = `
      <div id="online-exit-confirm-modal" class="modal-backdrop" style="z-index: 9999999 !important;">
        <div class="online-modal-card text-center" style="max-width: 400px; padding: 24px; text-align: center;">
          <div style="font-size: 40px; margin-bottom: 8px;">⚠️</div>
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #f8fafc; margin-bottom: 8px;">Maçtan Çıkılsın mı?</h3>
          <p style="font-size: 0.88rem; color: #94a3b8; line-height: 1.4; margin-bottom: 20px;">
            Ana menüye dönmek istediğinize emin misiniz?<br/>
            <span style="color: #ef4444; font-weight: 700;">Maçı terk ederseniz hükmen mağlup sayılacaksınız (-10 ELO).</span>
          </p>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button id="btn-confirm-online-exit" class="btn btn-sm" style="background: #ef4444; color: white; flex: 1; padding: 10px; font-weight: 700; border-radius: 8px;">Evet, Çık</button>
            <button id="btn-cancel-online-exit" class="btn btn-outline btn-sm" style="flex: 1; padding: 10px; font-weight: 700; border-radius: 8px;">Vazgeç</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('btn-confirm-online-exit')?.addEventListener('click', () => {
      document.getElementById('online-exit-confirm-modal')?.remove();
      onConfirm?.();
    });

    document.getElementById('btn-cancel-online-exit')?.addEventListener('click', () => {
      document.getElementById('online-exit-confirm-modal')?.remove();
    });
  }

  async _logout() {
    try {
      await this.authService.logout();
    } catch (err) {
      console.error('[App] Logout error:', err);
    }
  }

  _destroyActiveGame() {
    if (this.activeGame) {
      this.activeGame.destroy();
      this.activeGame = null;
    }
    if (this.activeOnlineGame) {
      this.activeOnlineGame.destroy();
      this.activeOnlineGame = null;
    }
  }

  // ─── Keyboard Shortcuts ─────────────────────────────────────

  _initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Formlarda ve input'larda çalışmasın
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const bindings = this.settingsService.getKeyBindings();

      if (e.code === bindings.nextQuestion) {
        e.preventDefault();
        if (this.currentScreen === 'game') {
          const nextBtn = document.getElementById('next-btn');
          if (nextBtn && nextBtn.style.display !== 'none') {
            this.gameUI.callbacks.onNext?.();
          }
        }
      } else if (e.code === bindings.home) {
        e.preventDefault();
        if (this.currentScreen === 'game') {
          this._goHome();
        }
      }
    });
  }

  // ─── LocalStorage Cache ─────────────────────────────────────

  _cacheProfile(uid, profile) {
    if (!uid || uid.startsWith('guest_')) return;
    try {
      const data = {
        totalScore: profile.totalScore || 0,
        gamesPlayed: profile.gamesPlayed || 0,
        bestScore: profile.bestScore || 0,
        cachedAt: Date.now(),
      };
      localStorage.setItem(`gm_profile_${uid}`, JSON.stringify(data));
    } catch { /* localStorage dolu veya erişilemez */ }
  }

  _loadCachedProfile(uid) {
    if (!uid || uid.startsWith('guest_')) return null;
    try {
      const raw = localStorage.getItem(`gm_profile_${uid}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  _cacheLastUser(user) {
    if (!user || user.isGuest || user.uid?.startsWith('guest_')) return;
    try {
      localStorage.setItem('gm_last_user', JSON.stringify({
        email: user.email || '',
        displayName: user.displayName || '',
      }));
    } catch { /* */ }
  }

  static getLastUser() {
    try {
      const raw = localStorage.getItem('gm_last_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
}

// ─── Uygulama Başlatma ───────────────────────────────────────

const app = new App();
app.init().catch((err) => {
  console.error('[App] Init error:', err);
});
