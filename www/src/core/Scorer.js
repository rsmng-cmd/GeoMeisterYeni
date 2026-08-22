/**
 * Scorer.js — GeoMeister Puanlama Motoru
 * UI bağımsız, saf hesaplama modülü.
 *
 * Puanlama Kuralları (%25 Kolaylaştırılmış):
 *   0 – 50 km    → 1000 puan (tam puan)
 *   50 – 350 km  → 1000 − (mesafe − 50) × 0.833
 *   350 – 550 km → 750 − (mesafe − 350) × 1.25
 *   550 km+      → 500 − (mesafe − 550) / 3  (min: 0)
 */

export const MAX_SCORE = 1000;

/**
 * İki koordinat arasındaki mesafeyi Haversine formülüyle hesaplar.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Mesafe (kilometre)
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Dünya yarıçapı (km)
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Mesafeyi puana çevirir. Maksimum puan her zaman 1000'dir.
 * Turkey modunda harita ölçeği küçük olduğu için mesafe sapması %30 daha sıkı puan düşürür.
 * @param {number} distanceKm
 * @param {number} [multiplier=1.0] - Mod çarpanı
 * @param {string} [modeId=null] - Mod kimliği ('turkey', 'world', vb.)
 * @returns {number} Puan (0–1000 arası tam sayı)
 */
export function distanceToScore(distanceKm, multiplier = 1.0, modeId = null, timeSpentSeconds = 0) {
  let score;

  if (modeId === 'turkey' || multiplier === 0.7) {
    // Türkiye Modu Puanlaması:
    // 0 – 20 km: 1000 puan (tam puan)
    // 20 – 120 km: her km için -6 puan (1000 -> 400)
    // 120+ km: her km için -2 puan (400 -> 0)
    if (distanceKm <= 20) {
      score = 1000;
    } else if (distanceKm <= 120) {
      score = 1000 - (distanceKm - 20) * 6;
    } else {
      score = 400 - (distanceKm - 120) * 2;
    }
  } else {
    // Dünya & Diğer Modlar: Normal Ölçek (Max 1000 Puan)
    if (distanceKm <= 50) {
      score = 1000;
    } else if (distanceKm <= 350) {
      score = 1000 - (distanceKm - 50) * 0.833;
    } else if (distanceKm <= 550) {
      score = 750 - (distanceKm - 350) * 1.25;
    } else {
      score = 500 - (distanceKm - 550) / 3;
    }

    if (multiplier && multiplier !== 1.0 && modeId !== 'turkey') {
      score *= multiplier;
    }
  }

  score = Math.min(MAX_SCORE, Math.max(0, Math.round(score)));

  // İlk 6 saniyeden sonra cevaplanan her saniye için 25 puan ceza (Örn: 8. saniyede -50 Puan)
  if (timeSpentSeconds > 6) {
    const extraSeconds = timeSpentSeconds - 6;
    const timePenalty = Math.round(extraSeconds * 25);
    score = Math.max(0, score - timePenalty);
  }

  return score;
}

/**
 * Puanı anlamlı bir etikete dönüştürür.
 * @param {number} score
 * @returns {{ label: string, tier: 'perfect'|'good'|'okay'|'bad' }}
 */
export function scoreToLabel(score) {
  if (score >= 950) return { label: 'Mükemmel! 🎯', tier: 'perfect' };
  if (score >= 800) return { label: 'Harika! ⭐', tier: 'perfect' };
  if (score >= 600) return { label: 'İyi! 👍', tier: 'good' };
  if (score >= 400) return { label: 'Fena Değil', tier: 'okay' };
  if (score >= 200) return { label: 'Uzak...', tier: 'bad' };
  return { label: 'Çok Uzak 😅', tier: 'bad' };
}

/**
 * Mesafeyi okunabilir stringe formatlar.
 * @param {number} distanceKm
 * @returns {string}
 */
export function formatDistance(distanceKm) {
  if (distanceKm < 1) return '< 1 km';
  if (distanceKm < 100) return `${Math.round(distanceKm)} km`;
  return `${Math.round(distanceKm / 10) * 10} km`;
}
