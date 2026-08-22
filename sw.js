// sw.js — GeoMeister Service Worker (Çevrimdışı Harita & Statik Dosya Önbelleği)

const CACHE_NAME = 'geomeister-offline-v2';
const TILE_CACHE_NAME = 'geomeister-tiles-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './assets/css/variables.css',
  './assets/css/base.css',
  './assets/css/auth.css',
  './assets/css/home.css',
  './assets/css/game.css',
  './assets/css/online.css',
  './assets/css/leaderboard.css',
  './assets/css/profile.css',
  './assets/css/settings.css',
  './assets/css/friends.css',
  './src/app.js',
  './src/core/GameEngine.js',
  './src/core/MapEngine.js',
  './src/core/Scorer.js',
  './src/modes/ModeRegistry.js',
  './src/modes/world.mode.js',
  './src/modes/turkey.mode.js',
  './src/modes/europe.mode.js',
  './src/modes/africa.mode.js',
  './src/data/index.js',
  './src/data/world.js',
  './src/data/turkey.js',
  './src/data/europe.js',
  './src/data/africa.js',
  './src/config/levels.js',
  './src/config/firebase.js',
  './src/ui/HomeUI.js',
  './src/ui/GameUI.js',
  './src/ui/LevelSelectUI.js',
  './src/ui/SettingsUI.js',
  './src/services/OfflineTileManager.js'
];

// Install — Statik dosyaları önbelleğe al
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// Activate — Eski önbellekleri temizle
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — İstekleri yakala (Harita karoları & Statik kaynaklar)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Harita karosu isteği mi? (CARTO veya OSM tile sunucuları)
  if (url.hostname.includes('cartocdn.com') || url.hostname.includes('openstreetmap.org') || url.pathname.endsWith('.png')) {
    e.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(e.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(e.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return cachedResponse || new Response('', { status: 404, statusText: 'Offline tile missing' });
        }
      })
    );
    return;
  }

  // Statik dosyalar için Strateji: Önce Ağ (Network-First), Yoksa Önbellek
  e.respondWith(
    fetch(e.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200 && e.request.url.startsWith('http')) {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
      }
      return networkResponse;
    }).catch(() => {
      return caches.match(e.request).then((cached) => {
        return cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : null);
      });
    })
  );
});
