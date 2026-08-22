/**
 * levels.js — GeoMeister Seviye Konfigürasyonu ve İlerleme Yönetimi
 */

export const LEVELS = [
  { level: 1, questions: 3, passScore: 1000, title: '1. Seviye', icon: '🌱', description: '3 Soru • Hedef: 1000 Puan', color: '#10b981' },
  { level: 2, questions: 4, passScore: 1500, title: '2. Seviye', icon: '☘️', description: '4 Soru • Hedef: 1500 Puan', color: '#3b82f6' },
  { level: 3, questions: 4, passScore: 1650, title: '3. Seviye', icon: '🌿', description: '4 Soru • Hedef: 1650 Puan', color: '#6366f1' },
  { level: 4, questions: 5, passScore: 2250, title: '4. Seviye', icon: '🪴', description: '5 Soru • Hedef: 2250 Puan', color: '#8b5cf6' },
  { level: 5, questions: 6, passScore: 3000, title: '5. Seviye', icon: '🌲', description: '6 Soru • Hedef: 3000 Puan', color: '#ec4899' },
  { level: 6, questions: 7, passScore: 3800, title: '6. Seviye', icon: '⛰️', description: '7 Soru • Hedef: 3800 Puan', color: '#f59e0b' },
  { level: 7, questions: 7, passScore: 4200, title: '7. Seviye', icon: '🏔️', description: '7 Soru • Hedef: 4200 Puan', color: '#ef4444' },
  { level: 8, questions: 8, passScore: 5000, title: '8. Seviye', icon: '🌋', description: '8 Soru • Hedef: 5000 Puan', color: '#dc2626' },
  { level: 9, questions: 8, passScore: 5500, title: '9. Seviye', icon: '👑', description: '8 Soru • Hedef: 5500 Puan', color: '#a855f7' },
  { level: 10, questions: 10, passScore: 7750, title: '10. Seviye (FİNAL)', icon: '🏆', description: '10 Soru • Hedef: 7750 Puan', color: '#eab308', isFinal: true },
];

export function getLevelConfig(levelNum) {
  const num = parseInt(levelNum, 10);
  return LEVELS.find((l) => l.level === num) || LEVELS[0];
}

export function getUnlockedLevel() {
  try {
    const saved = localStorage.getItem('geomeister_unlocked_level');
    return saved ? Math.max(1, parseInt(saved, 10)) : 1;
  } catch {
    return 1;
  }
}

export function unlockNextLevel(currentLevel) {
  try {
    const nextLevel = currentLevel + 1;
    const currentMax = getUnlockedLevel();
    if (nextLevel <= LEVELS.length && nextLevel > currentMax) {
      localStorage.setItem('geomeister_unlocked_level', nextLevel.toString());
      return true;
    }
  } catch (e) {
    console.warn('[Level] Unlock error:', e);
  }
  return false;
}

/**
 * Kullanıcının birikmiş toplam puanına göre seviyesini hesaplar.
 *   - 0–20. Seviye: Her 10.000 puanda +2 seviye (her 5.000 puan = 1 seviye)
 *   - 20–40. Seviye: Her 20.000 puanda +1 seviye
 *   - 40+. Seviye: Her 40.000 puanda +1 seviye
 */
export function calculateUserLevel(totalScore = 0) {
  let score = Math.max(0, Number(totalScore) || 0);

  // 0 - 20. Seviyeler (0-100.000 puan arası, her 5.000 puan = 1 seviye)
  if (score < 100000) {
    return 1 + Math.floor(score / 5000);
  }

  // 20 - 40. Seviyeler (100.000-500.000 puan arası, her 20.000 puan = 1 seviye)
  score -= 100000;
  if (score < 400000) {
    return 21 + Math.floor(score / 20000);
  }

  // 40+ Seviyeler (500.000+ puan, her 40.000 puan = 1 seviye)
  score -= 400000;
  return 41 + Math.floor(score / 40000);
}
