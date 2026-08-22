// seededQuestions.js — Çok Oyunculu Maçlar İçin %100 Eşzamanlı Deterministik Soru Üretici
import { getCitiesForMode } from '../data/index.js';

/**
 * Belirtilen mod ve ortak tohum (roomCode / matchId) üzerinden
 * tüm cihazlarda birebir aynı 10 soruyu aynı sırada üretir.
 * 
 * @param {string} dataSource — 'world', 'europe', 'turkey', 'africa' vb.
 * @param {string} seedString — 'GEO-XXXX' veya matchId
 * @param {number} count — Soru sayısı (varsayılan 10)
 * @returns {Array} 10 Şehir Objeleri
 */
export function getSeededQuestions(dataSource, seedString, count = 10) {
  const allCities = getCitiesForMode(dataSource || 'world');
  if (!allCities || allCities.length === 0) return [];

  // Tohum Değerini Hesapla (Deterministik Hash)
  let seed = 0;
  const str = String(seedString || 'GEO_DEFAULT_SEED_2026');
  for (let i = 0; i < str.length; i++) {
    seed = ((seed << 5) - seed + str.charCodeAt(i)) | 0;
  }
  seed = Math.abs(seed) || 987654321;

  // Linear Congruential Generator (LCG) PRNG
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // Fisher-Yates Deterministik Karıştırma
  const pool = allCities.map(c => ({ ...c }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = pool[i];
    pool[i] = pool[j];
    pool[j] = temp;
  }

  return pool.slice(0, count);
}

export default getSeededQuestions;
