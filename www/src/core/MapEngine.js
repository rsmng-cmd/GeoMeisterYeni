/**
 * MapEngine.js — Leaflet Harita Yöneticisi
 * Tüm harita işlemlerini (init, marker, line, zoom) ve tile önbelleklemesini yönetir.
 * Tek oyunculu (GameEngine) ve Online Multiplayer (OnlineGameEngine) modlarını destekler.
 */

export class MapEngine {
  /**
   * @param {string} [containerId] - Harita div ID'si
   * @param {object} [modeConfig] - Mod konfigürasyonu
   * @param {Function} [onGuess] - Kullanıcı tıkladığında çağrılır: (lat, lng) => void
   */
  constructor(containerId, modeConfig = {}, onGuess = null) {
    this.containerId = containerId;
    this.modeConfig = modeConfig;
    this.onGuess = onGuess;
    this.map = null;
    this.guessMarker = null;
    this.answerMarker = null;
    this.distanceLine = null;
    this.customMarkers = [];
    this.lines = [];
    this.isLocked = false;
  }

  /**
   * Haritayı başlatır.
   */
  init(containerId, modeConfig) {
    if (containerId) this.containerId = containerId;
    if (modeConfig) this.modeConfig = { ...this.modeConfig, ...modeConfig };

    const isPortrait = window.innerHeight > window.innerWidth;
    const mapCenter = this.modeConfig?.mapCenter || [20, 0];
    const mapZoom = this.modeConfig?.mapZoom || { start: 2, min: 1, max: 12 };
    const maxZoom = mapZoom.max || 10;
    
    let startZoom = mapZoom.start || 2;
    if (isPortrait) {
      if (this.modeConfig?.id === 'turkey') {
        startZoom = 5;
      } else if (this.modeConfig?.id === 'world' || this.modeConfig?.dataSource === 'world') {
        startZoom = 1;
      } else {
        startZoom = Math.max(1, startZoom - 1);
      }
    }

    const mapOptions = {
      center: (isPortrait && (this.modeConfig?.id === 'world' || !this.modeConfig?.id)) ? [15, 0] : mapCenter,
      zoom: startZoom,
      minZoom: 1, // Telefonlarda tüm haritanın tam oturması için minZoom 1
      maxZoom: maxZoom,
      zoomControl: true,
      attributionControl: false,
      touchZoom: true,
      dragging: true,
      tap: true,
      tapTolerance: 15,
      worldCopyJump: true,
    };

    if (this.modeConfig?.mapBounds && this.modeConfig?.id !== 'world') {
      mapOptions.maxBounds = this.modeConfig.mapBounds;
      mapOptions.maxBoundsViscosity = 0.5;
    }

    this.map = L.map(this.containerId, mapOptions);

    // Ülke sınırları ve kıyıları gösteren, araba/sokak yolları içermeyen temiz katman
    const tileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png';

    L.tileLayer(tileUrl, {
      subdomains: 'abcd',
      maxZoom: maxZoom,
      maxNativeZoom: 6,
      crossOrigin: true,
      noWrap: false,
      keepBuffer: 8,
    }).addTo(this.map);

    L.control.attribution({ prefix: '© OpenStreetMap © CARTO' }).addTo(this.map);

    // Eğer özel mod sınırları varsa (örn. Türkiye) haritayı sınırlara göre tam oturt
    if (this.modeConfig?.mapBounds && this.modeConfig?.id !== 'world') {
      this.map.fitBounds(this.modeConfig.mapBounds, { padding: isPortrait ? [10, 10] : [20, 20], animate: false });
    }

    // Otomatik Yeniden Boyutlandırma (Debounced - Ekran Döndürme & Siyah Ekran Önleme)
    let resizeTimer = null;
    this._resizeHandler = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
        }
      }, 100);
    };
    window.addEventListener('resize', this._resizeHandler);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (this.map) this.map.invalidateSize();
      }, 200);
    });

    // İlk yüklemede harita boyutunu zorla güncelle
    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 50);
    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 200);

    // Sürükleme koruması — haritayı kaydırırken yanlışlıkla tıklamayı engelle
    let isDragging = false;
    let dragEndTimer = null;

    this.map.on('movestart', () => {
      isDragging = true;
      if (dragEndTimer) { clearTimeout(dragEndTimer); dragEndTimer = null; }
    });

    this.map.on('moveend', () => {
      dragEndTimer = setTimeout(() => { isDragging = false; }, 200);
    });

    // Tıklama eventi — sürükleme bitiminden 200ms içindeki tıklamaları engelle
    this.map.on('click', (e) => {
      if (this.isLocked || isDragging) return;
      this._placeGuessMarker(e.latlng.lat, e.latlng.lng);
      if (this.onGuess) {
        this.onGuess(e.latlng.lat, e.latlng.lng);
      }
    });

    return this;
  }

  onMapClick(fn) {
    this.onGuess = (lat, lng) => fn({ lat, lng });
  }

  enableClick() {
    this.isLocked = false;
  }

  disableClick() {
    this.isLocked = true;
  }

  clearMarkers() {
    this._removeMarkers();
  }

  addGuessMarker(lat, lng, label = 'Siz') {
    this._placeGuessMarker(lat, lng, label);
  }

  addAnswerMarker(lat, lng, label = 'Doğru Konum') {
    if (this.answerMarker) {
      this.map.removeLayer(this.answerMarker);
    }
    this.answerMarker = L.marker([lat, lng], {
      icon: this._createIcon('answer'),
    })
      .addTo(this.map)
      .bindPopup(
        `<div class="map-popup answer-popup"><span>📍 ${label}</span></div>`,
        { closeButton: false }
      )
      .openPopup();
  }

  addCustomMarker(lat, lng, color = '#ec4899', label = 'Rakip') {
    const icon = L.divIcon({
      html: `<div class="map-marker custom-marker" style="background:${color}; box-shadow: 0 0 12px ${color};"><div class="marker-inner">👤</div></div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    const marker = L.marker([lat, lng], { icon })
      .addTo(this.map)
      .bindPopup(`<div class="map-popup"><span>${label}</span></div>`, { closeButton: false })
      .openPopup();

    this.customMarkers.push(marker);
    return marker;
  }

  drawLine(from, to, color = '#6366f1') {
    const line = L.polyline([from, to], {
      color,
      weight: 3,
      opacity: 0.85,
      dashArray: '10, 8',
      className: 'animated-dash-line',
    }).addTo(this.map);
    this.lines.push(line);
    return line;
  }

  fitBoundsToMarkers() {
    const points = [];
    if (this.guessMarker) points.push(this.guessMarker.getLatLng());
    if (this.answerMarker) points.push(this.answerMarker.getLatLng());
    this.customMarkers.forEach(m => points.push(m.getLatLng()));

    if (points.length > 0) {
      const isMobile = window.innerWidth <= 640;
      const bounds = L.latLngBounds(points);
      this.map.fitBounds(bounds, { padding: isMobile ? [40, 40] : [100, 100], maxZoom: 6, animate: true });
    }
  }

  /**
   * Yeni tur için haritayı sıfırlar.
   */
  resetForNewRound() {
    this.isLocked = false;
    this._removeMarkers();
    this.flyToDefault();
  }

  /**
   * Cevabı haritada gösterir: tahmin marker + doğru konum marker + kesikli çizgi.
   */
  showAnswer(answerLat, answerLng, guessLat, guessLng) {
    this.isLocked = true;
    this.addAnswerMarker(answerLat, answerLng, 'Doğru Konum');

    // Innovator TIP 1: Mesafe Skalası Çizgisi (Distance Gradient)
    const distMeters = this.map.distance([guessLat, guessLng], [answerLat, answerLng]);
    const distKm = distMeters / 1000;
    let lineColor = '#10b981'; // Yeşil (0-300km Yakın)
    if (distKm > 1200) {
      lineColor = '#ef4444'; // Kırmızı (>1200km Uzak)
    } else if (distKm > 300) {
      lineColor = '#f59e0b'; // Sarı/Turuncu (300-1200km Orta)
    }

    this.drawLine([guessLat, guessLng], [answerLat, answerLng], lineColor);

    const isMobile = window.innerWidth <= 640;
    const bounds = L.latLngBounds(
      [guessLat, guessLng],
      [answerLat, answerLng]
    );
    this.map.fitBounds(bounds, { padding: isMobile ? [50, 50] : [140, 140], maxZoom: 5, animate: true, duration: 0.4 });
  }

  /**
   * Haritayı anında başlangıç görünümüne döndürür (yeni tur geçişi).
   */
  flyToDefault() {
    if (!this.map) return;
    const isPortrait = window.innerHeight > window.innerWidth;
    if (this.modeConfig?.mapBounds && this.modeConfig?.id !== 'world') {
      this.map.fitBounds(this.modeConfig.mapBounds, { padding: isPortrait ? [10, 10] : [20, 20], animate: false });
    } else {
      const mapCenter = (isPortrait && (this.modeConfig?.id === 'world' || !this.modeConfig?.id)) ? [15, 0] : (this.modeConfig?.mapCenter || [20, 0]);
      const mapZoom = this.modeConfig?.mapZoom || { start: 2 };
      let startZoom = mapZoom.start || 2;
      if (isPortrait) {
        if (this.modeConfig?.id === 'turkey') startZoom = 5;
        else if (this.modeConfig?.id === 'world' || this.modeConfig?.dataSource === 'world') startZoom = 1;
        else startZoom = Math.max(1, startZoom - 1);
      }
      this.map.setView(mapCenter, startZoom, { animate: false });
    }
    this.isLocked = false;
    this.map.invalidateSize();
  }

  /**
   * İpucu kullanıldığında hedef bölgeye yumuşak zoom yapar.
   */
  zoomToHint(lat, lng) {
    if (!this.map) return;
    this.map.flyTo([lat, lng], 5, { animate: true, duration: 1.5 });
  }

  /**
   * Haritayı kaldırır.
   */
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // --- Private ---

  _placeGuessMarker(lat, lng, label = 'Siz') {
    if (this.guessMarker) {
      this.guessMarker.setLatLng([lat, lng]);
    } else {
      this.guessMarker = L.marker([lat, lng], {
        icon: this._createIcon('guess'),
      }).addTo(this.map);
    }
  }

  _removeMarkers() {
    if (this.guessMarker) { this.map.removeLayer(this.guessMarker); this.guessMarker = null; }
    if (this.answerMarker) { this.map.removeLayer(this.answerMarker); this.answerMarker = null; }
    if (this.distanceLine) { this.map.removeLayer(this.distanceLine); this.distanceLine = null; }
    this.customMarkers.forEach(m => this.map.removeLayer(m));
    this.customMarkers = [];
    this.lines.forEach(l => this.map.removeLayer(l));
    this.lines = [];
  }

  _createIcon(type) {
    const configs = {
      guess: {
        html: `<div class="map-marker guess-marker"><div class="marker-inner">?</div></div>`,
        size: [36, 36],
        anchor: [18, 18],
      },
      answer: {
        html: `<div class="map-marker answer-marker"><div class="marker-inner">✓</div></div>`,
        size: [36, 36],
        anchor: [18, 18],
      },
    };
    const cfg = configs[type];
    return L.divIcon({
      html: cfg.html,
      className: '',
      iconSize: cfg.size,
      iconAnchor: cfg.anchor,
    });
  }
}

