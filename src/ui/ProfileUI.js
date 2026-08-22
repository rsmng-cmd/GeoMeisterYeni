/**
 * ProfileUI.js — Profil Modalı Yöneticisi
 * Kendi profilimiz ve başka oyuncuların profillerini gösterir.
 * Seviye sistemi kaldırıldı. Online kazanma yüzdesi ve mod bazlı en yüksek puan gösterilir.
 */

import { ScoreService } from '../services/ScoreService.js';
import onlineService from '../services/OnlineService.js';
import { modes } from '../modes/ModeRegistry.js';

export class ProfileUI {
  constructor() {
    this.scoreService = new ScoreService();
    this.heatmapMap = null;
    this._bindCloseEvents();
  }

  _bindCloseEvents() {
    document.getElementById('profile-close-btn')?.addEventListener('click', () => this.hide());
    document.getElementById('profile-backdrop')?.addEventListener('click', () => this.hide());
  }

  /**
   * Kendi profilimizi gösterir.
   */
  async show(user, userProfile) {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;

    const displayName = user?.displayName || 'Misafir';

    // Kendi profilimizde "Arkadaş Ekle" butonunu gizle
    const actionBtn = document.getElementById('btn-profile-add-friend');
    if (actionBtn) {
      actionBtn.style.display = 'none';
    }

    // Header
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const avatarEl = document.getElementById('profile-avatar');
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = user?.email || (user?.isGuest ? 'Misafir Hesap' : '');
    if (avatarEl) avatarEl.textContent = this._getInitials(displayName);

    // Önce cache ile göster
    this._renderStats(userProfile || { totalScore: 0, gamesPlayed: 0, bestScore: 0 });
    this._renderModeStats(null);
    this._renderHeatmap(user, 'turkey');
    this._renderOnlineStats(null);

    modal.classList.remove('hidden');

    // Arka planda güncel verileri yükle
    this._loadAllStatsAsync(user);
  }

  /**
   * Başka bir oyuncunun profilini gösterir (liderlik tablosundan tıklanır).
   */
  async showOtherProfile(uid, displayName, currentUser = null, friendService = null) {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;

    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const avatarEl = document.getElementById('profile-avatar');
    if (nameEl) nameEl.textContent = displayName || 'Oyuncu';
    if (emailEl) emailEl.textContent = '';
    if (avatarEl) avatarEl.textContent = this._getInitials(displayName);

    // Arkadaş Ekle butonu
    let actionBtn = document.getElementById('btn-profile-add-friend');
    if (!actionBtn) {
      actionBtn = document.createElement('button');
      actionBtn.id = 'btn-profile-add-friend';
      actionBtn.className = 'btn btn-primary btn-sm mt-xs';
      emailEl?.after(actionBtn);
    }

    const isSelf = currentUser && uid && (currentUser.uid === uid);

    if (!isSelf && currentUser && !currentUser.isGuest && friendService) {
      actionBtn.style.display = 'inline-block';
      actionBtn.disabled = true;
      actionBtn.textContent = 'Yükleniyor...';

      const updateProfileBtnState = (status) => {
        if (status === 'friends') {
          actionBtn.textContent = '✓ Arkadaşsınız';
          actionBtn.className = 'btn btn-outline btn-sm mt-xs';
          actionBtn.disabled = true;
          actionBtn.onclick = null;
        } else if (status === 'pending_sent') {
          actionBtn.textContent = '⏳ İstek Gönderildi';
          actionBtn.className = 'btn btn-outline btn-sm mt-xs';
          actionBtn.disabled = false;
          actionBtn.onclick = async () => {
            actionBtn.disabled = true;
            actionBtn.textContent = 'İptal Ediliyor...';
            await friendService.cancelFriendRequest(currentUser.uid, uid);
            updateProfileBtnState('none');
          };
        } else if (status === 'pending_received') {
          actionBtn.textContent = '📩 İstek Geldi (Kabul Et)';
          actionBtn.className = 'btn btn-success btn-sm mt-xs';
          actionBtn.disabled = false;
          actionBtn.onclick = async () => {
            actionBtn.disabled = true;
            actionBtn.textContent = 'Kabul Ediliyor...';
            await friendService.acceptFriendRequest({ fromUid: uid, fromName: displayName }, currentUser);
            updateProfileBtnState('friends');
          };
        } else {
          actionBtn.textContent = '➕ Arkadaş Ekle';
          actionBtn.className = 'btn btn-primary btn-sm mt-xs';
          actionBtn.disabled = false;
          actionBtn.onclick = async () => {
            actionBtn.disabled = true;
            actionBtn.textContent = 'Gönderiliyor...';
            const result = await friendService.sendFriendRequest(currentUser, uid, displayName);
            if (result) {
              updateProfileBtnState('pending_sent');
            } else {
              // İstek zaten mevcut, durumu tekrar kontrol et
              const freshStatus = await friendService.getFriendshipStatus(currentUser.uid, uid);
              updateProfileBtnState(freshStatus);
            }
          };
        }
      };

      friendService.getFriendshipStatus(currentUser.uid, uid).then(status => {
        updateProfileBtnState(status);
      });
    } else {
      actionBtn.style.display = 'none';
    }

    this._renderStats(null);
    this._renderModeStats(null);
    this._renderHeatmap(uid, 'turkey');
    this._renderOnlineStats(null);

    modal.classList.remove('hidden');

    // Herkese açık profili yükle
    try {
      const publicProfile = await this.scoreService.getPublicProfile(uid);
      if (publicProfile) {
        this._renderStats(publicProfile);
      }

      const allStats = await this.scoreService.getAllModeStatsPublic(uid);
      this._renderModeStats(allStats);

      const onlineStats = await this._loadOnlineStatsForUid(uid);
      this._renderOnlineStats(onlineStats);
    } catch (e) {
      console.warn('[ProfileUI] Public profile load error:', e);
    }
  }

  _renderStats(profile) {
    const statsGrid = document.getElementById('profile-stats-grid');
    if (!statsGrid) return;

    if (!profile) {
      statsGrid.innerHTML = `
        <div class="profile-stat-card">
          <span class="profile-stat-value">—</span>
          <span class="profile-stat-label">Yükleniyor...</span>
        </div>`;
      return;
    }

    statsGrid.innerHTML = `
      <div class="profile-stat-card">
        <span class="profile-stat-value">${(profile.bestScore || 0).toLocaleString('tr-TR')}</span>
        <span class="profile-stat-label">En Yüksek Skor</span>
      </div>
      <div class="profile-stat-card">
        <span class="profile-stat-value">${profile.gamesPlayed || 0}</span>
        <span class="profile-stat-label">Toplam Oyun</span>
      </div>
    `;
  }

  _renderModeStats(allStats) {
    const modeStatsEl = document.getElementById('profile-mode-stats');
    if (!modeStatsEl) return;

    const playableModes = modes.filter(m => !m.isOnline);

    if (!allStats) {
      modeStatsEl.innerHTML = `
        <h3 class="profile-section-title">🎯 Mod İstatistikleri</h3>
        ${playableModes.map((m) => `
        <div class="profile-mode-card">
          <span class="profile-mode-icon">${m.icon}</span>
          <div class="profile-mode-info">
            <div class="profile-mode-name">${m.name}</div>
            <div class="profile-mode-detail">Yükleniyor...</div>
          </div>
          <span class="profile-mode-best">—</span>
        </div>
      `).join('')}`;
      return;
    }

    modeStatsEl.innerHTML = `
      <h3 class="profile-section-title">🎯 Mod İstatistikleri</h3>
      ${playableModes.map((m) => {
        const stats = allStats[m.id] || { gamesPlayed: 0, bestScore: 0 };
        return `
        <div class="profile-mode-card">
          <span class="profile-mode-icon">${m.icon}</span>
          <div class="profile-mode-info">
            <div class="profile-mode-name">${m.name}</div>
            <div class="profile-mode-detail">${stats.gamesPlayed} oyun oynandı</div>
          </div>
          <span class="profile-mode-best">${stats.bestScore > 0 ? stats.bestScore.toLocaleString('tr-TR') : '—'}</span>
        </div>`;
      }).join('')}`;
  }

  _renderOnlineStats(onlineStats) {
    let onlineStatsEl = document.getElementById('profile-online-stats');
    if (!onlineStatsEl) {
      const modeStatsEl = document.getElementById('profile-mode-stats');
      if (!modeStatsEl) return;
      onlineStatsEl = document.createElement('div');
      onlineStatsEl.id = 'profile-online-stats';
      modeStatsEl.after(onlineStatsEl);
    }

    if (!onlineStats) {
      onlineStatsEl.innerHTML = `
        <h3 class="profile-section-title">🌐 Online İstatistikler</h3>
        <div class="profile-mode-card">
          <span class="profile-mode-icon">🌐</span>
          <div class="profile-mode-info">
            <div class="profile-mode-name">Online</div>
            <div class="profile-mode-detail">Yükleniyor...</div>
          </div>
        </div>`;
      return;
    }

    const onlineModes = [
      { id: 'world', name: 'Dünya', icon: '🌍' },
      { id: 'europe', name: 'Avrupa', icon: '🇪🇺' },
      { id: 'turkey', name: 'Türkiye', icon: '🇹🇷' },
      { id: 'africa', name: 'Afrika', icon: '🦁' },
    ];

    onlineStatsEl.innerHTML = `
      <h3 class="profile-section-title">🌐 Online İstatistikler</h3>
      ${onlineModes.map(om => {
        const stats = onlineStats[om.id] || { matchesPlayed: 0, wins: 0, losses: 0, elo: 50, rank: null };
        const winRate = stats.matchesPlayed > 0 ? Math.round((stats.wins / stats.matchesPlayed) * 100) : 0;
        return `
        <div class="profile-mode-card online-stat-card">
          <span class="profile-mode-icon">${om.icon}</span>
          <div class="profile-mode-info">
            <div class="profile-mode-name">${om.name} Online</div>
            <div class="profile-mode-detail">
              ${stats.matchesPlayed} Oyun • ${stats.wins}G / ${stats.losses}M
              ${stats.rank ? ` • ${stats.rank.icon} ${stats.rank.name}` : ''}
            </div>
          </div>
          <div class="profile-online-winrate">
            <span class="winrate-value">${winRate}%</span>
            <span class="winrate-label">Kazanma</span>
          </div>
        </div>`;
      }).join('')}`;
  }

  async _loadAllStatsAsync(user) {
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000)
      );
      const allStats = await Promise.race([
        this.scoreService.getAllModeStats(user),
        timeout,
      ]);
      this._renderModeStats(allStats);
    } catch {
      this._renderModeStats(
        modes.reduce((acc, m) => ({ ...acc, [m.id]: { gamesPlayed: 0, bestScore: 0 } }), {})
      );
    }

    // Online stats
    try {
      const onlineStats = {};
      for (const modeId of ['world', 'europe', 'turkey', 'africa']) {
        onlineStats[modeId] = await onlineService.getPlayerOnlineStats(user, modeId);
      }
      this._renderOnlineStats(onlineStats);
    } catch {
      this._renderOnlineStats({});
    }
  }

  async _loadOnlineStatsForUid(uid) {
    try {
      const stats = {};
      for (const modeId of ['world', 'europe', 'turkey', 'africa']) {
        stats[modeId] = await onlineService.getPlayerPublicOnlineStats(uid, modeId);
      }
      return stats;
    } catch {
      return {};
    }
  }

  async _renderHeatmap(user, modeId = 'turkey') {
    // 1. Devam eden harita veya zamanlayıcı varsa temizle
    if (this._heatmapTimer) {
      clearTimeout(this._heatmapTimer);
      this._heatmapTimer = null;
    }
    if (this.heatmapMap) {
      try {
        this.heatmapMap.remove();
      } catch (e) {}
      this.heatmapMap = null;
    }

    let heatmapSection = document.getElementById('profile-heatmap-section');
    if (!heatmapSection) {
      const modeStatsEl = document.getElementById('profile-mode-stats');
      if (!modeStatsEl) return;
      heatmapSection = document.createElement('div');
      heatmapSection.id = 'profile-heatmap-section';
      heatmapSection.className = 'profile-heatmap-section';
      modeStatsEl.after(heatmapSection);
    }

    const items = await this.scoreService.getHeatmapDataAsync(user, modeId).catch(() => []);
    const strongCount = (items || []).filter(i => i.status === 'strong').length;
    const mediumCount = (items || []).filter(i => i.status === 'medium').length;
    const weakCount = (items || []).filter(i => i.status === 'weak').length;

    heatmapSection.innerHTML = `
      <h3 class="profile-section-title">🗺️ Performans Isı Haritası (Heatmap)</h3>
      <div class="heatmap-mode-selector">
        <button class="hm-tab ${modeId === 'turkey' ? 'active' : ''}" data-hm-mode="turkey">🇹🇷 Türkiye</button>
        <button class="hm-tab ${modeId === 'world' ? 'active' : ''}" data-hm-mode="world">🌍 Dünya</button>
        <button class="hm-tab ${modeId === 'europe' ? 'active' : ''}" data-hm-mode="europe">🇪🇺 Avrupa</button>
      </div>

      <div class="heatmap-summary-row">
        <span class="hm-badge strong">🟢 ${strongCount} Güçlü</span>
        <span class="hm-badge medium">🟡 ${mediumCount} Orta</span>
        <span class="hm-badge weak">🔴 ${weakCount} Zayıf Nokta</span>
      </div>

      <div id="profile-heatmap-map" class="profile-heatmap-map" style="height: 240px; min-height: 240px; width: 100%; border-radius: 12px; position: relative; overflow: hidden; background: #0f172a;"></div>
    `;

    // Tab tıklama olayları
    heatmapSection.querySelectorAll('.hm-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const nextMode = e.currentTarget.dataset.hmMode;
        this._renderHeatmap(user, nextMode);
      });
    });

    // Leaflet haritasını DOM hazır olunca başlat
    this._heatmapTimer = setTimeout(() => {
      const mapContainer = document.getElementById('profile-heatmap-map');
      if (!mapContainer || typeof L === 'undefined') return;

      // Önceki leafleti temizle
      if (this.heatmapMap) {
        try { this.heatmapMap.remove(); } catch {}
        this.heatmapMap = null;
      }
      mapContainer._leaflet_id = null;

      const modeConfigs = {
        turkey: { center: [39.0, 35.2], zoom: 5 },
        world: { center: [20, 0], zoom: 1 },
        europe: { center: [50.0, 15.0], zoom: 3 },
      };
      const cfg = modeConfigs[modeId] || modeConfigs.turkey;

      try {
        const map = L.map(mapContainer, {
          center: cfg.center,
          zoom: cfg.zoom,
          zoomControl: false,
          attributionControl: false,
        });
        this.heatmapMap = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd',
          maxZoom: 10,
          crossOrigin: true,
        }).addTo(map);

        if (!items || items.length === 0) {
          const infoMsg = document.createElement('div');
          infoMsg.className = 'hm-empty-overlay';
          infoMsg.innerHTML = '<span>Henüz bu modda kayıtlı maç bulunamadı.<br/>Maç yaptıkça zayıf ve güçlü bölgeleriniz burada haritaya işlenecektir! 🎯</span>';
          mapContainer.appendChild(infoMsg);
        } else {
          items.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
              radius: 8,
              color: item.color,
              fillColor: item.color,
              fillOpacity: 0.85,
              weight: 2,
            }).addTo(map);

            const statusText = item.status === 'strong'
              ? '🟢 Güçlü Bölge'
              : item.status === 'weak'
              ? '🔴 Zayıf Nokta'
              : '🟡 Orta Seviye';

            marker.bindPopup(`
              <div class="hm-popup">
                <strong>📍 ${item.name}, ${item.country}</strong><br/>
                <span>Ortalama Skor: <strong>${item.avgScore} p</strong></span><br/>
                <span>Ortalama Sapma: <strong>${item.avgDistance} km</strong> (${item.attempts} deneme)</span><br/>
                <span style="color:${item.color}; font-weight:700;">${statusText}</span>
              </div>
            `, { closeButton: false });
          });
        }

        // Harita boyutunu modal animasyonundan sonra tazeleyin
        map.invalidateSize();
        setTimeout(() => map.invalidateSize(), 150);
        setTimeout(() => map.invalidateSize(), 400);
      } catch (err) {
        console.warn('[ProfileUI] Heatmap render error:', err);
      }
    }, 100);
  }

  hide() {
    if (this._heatmapTimer) {
      clearTimeout(this._heatmapTimer);
      this._heatmapTimer = null;
    }
    if (this.heatmapMap) {
      try { this.heatmapMap.remove(); } catch {}
      this.heatmapMap = null;
    }
    document.getElementById('profile-modal')?.classList.add('hidden');
  }

  _getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }
}
