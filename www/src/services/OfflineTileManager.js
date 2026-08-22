/**
 * OfflineTileManager.js — Çevrimdışı Harita Paket İndirme Yöneticisi
 * Seçilen oyun modlarının (Dünya, Türkiye, Avrupa, Afrika) harita karolarını
 * (tiles) hesaplar, toplu indirir ve Cache Storage'a kaydeder.
 */

const TILE_CACHE_NAME = 'geomeister-tiles-v1';
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'];

export class OfflineTileManager {

  /**
   * Enlem/Boylam ve Zoom değerine göre harita karosu (x, y) indeksini hesaplar.
   */
  latLngToTile(lat, lng, zoom) {
    const rad = (lat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
    );
    return { x, y, z: zoom };
  }

  /**
   * Bir oyun modu için gerekli tüm tile URL'lerini üretir.
   */
  getTileUrlsForMode(modeId) {
    const urls = new Set();

    if (modeId === 'world') {
      // Dünya: Zoom 2..4 (Tüm gezegen)
      for (let z = 2; z <= 4; z++) {
        const maxXY = Math.pow(2, z) - 1;
        for (let x = 0; x <= maxXY; x++) {
          for (let y = 0; y <= maxXY; y++) {
            const sub = CARTO_SUBDOMAINS[(x + y) % 4];
            urls.add(`https://${sub}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`);
          }
        }
      }
    } else if (modeId === 'turkey') {
      // Türkiye: lat [35.5, 42.5], lng [25.5, 45.0], Zoom 5..7
      for (let z = 5; z <= 7; z++) {
        const nw = this.latLngToTile(42.5, 25.5, z);
        const se = this.latLngToTile(35.5, 45.0, z);

        for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x++) {
          for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y++) {
            const sub = CARTO_SUBDOMAINS[(x + y) % 4];
            urls.add(`https://${sub}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`);
          }
        }
      }
    } else if (modeId === 'europe') {
      // Avrupa: lat [34.0, 71.0], lng [-25.0, 45.0], Zoom 3..5
      for (let z = 3; z <= 5; z++) {
        const nw = this.latLngToTile(71.0, -25.0, z);
        const se = this.latLngToTile(34.0, 45.0, z);

        for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x++) {
          for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y++) {
            const sub = CARTO_SUBDOMAINS[(x + y) % 4];
            urls.add(`https://${sub}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`);
          }
        }
      }
    } else if (modeId === 'africa') {
      // Afrika: lat [-35.0, 37.0], lng [-18.0, 51.0], Zoom 3..5
      for (let z = 3; z <= 5; z++) {
        const nw = this.latLngToTile(37.0, -18.0, z);
        const se = this.latLngToTile(-35.0, 51.0, z);

        for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x++) {
          for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y++) {
            const sub = CARTO_SUBDOMAINS[(x + y) % 4];
            urls.add(`https://${sub}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`);
          }
        }
      }
    }

    return Array.from(urls);
  }

  /**
   * Bir harita modunun karolarını arka planda indirir.
   * @param {string} modeId - Mod ID
   * @param {Function} onProgress - (completedCount, totalCount, percent) => void
   */
  async downloadMapPackage(modeId, onProgress) {
    const urls = this.getTileUrlsForMode(modeId);
    if (urls.length === 0) return true;

    const cache = await caches.open(TILE_CACHE_NAME);
    let completed = 0;
    const total = urls.length;

    // Concurrency limit (eşzamanlı 6 paralel indirme)
    const chunkSize = 6;
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (url) => {
          try {
            const existing = await cache.match(url);
            if (!existing) {
              const response = await fetch(url, { mode: 'cors' });
              if (response.ok) {
                await cache.put(url, response);
              }
            }
          } catch (err) {
            console.warn('[OfflineTileManager] Karo indirme uyarısı:', url, err.message);
          } finally {
            completed++;
            const percent = Math.round((completed / total) * 100);
            onProgress?.(completed, total, percent);
          }
        })
      );
    }

    localStorage.setItem(`geomeister_offline_pkg_${modeId}`, 'true');
    return true;
  }

  /**
   * Mod paketinin indirilip indirilmediğini kontrol eder.
   */
  isPackageDownloaded(modeId) {
    return localStorage.getItem(`geomeister_offline_pkg_${modeId}`) === 'true';
  }

  /**
   * Mod paketinin indirme kaydını ve hafızasını siler.
   */
  async deleteMapPackage(modeId) {
    localStorage.removeItem(`geomeister_offline_pkg_${modeId}`);
    return true;
  }
}

export default OfflineTileManager;
