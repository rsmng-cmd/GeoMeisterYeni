/**
 * ScoreService.js — Skor ve Profil Servisi
 * Kayıtlı kullanıcıların skorları Firebase Firestore'a ve yerel yedek saklamaya yazılır.
 * Misafir kullanıcı verileri kesinlikle kaydedilmez ve Liderlik Tablosunda yer almaz.
 */

import { db, firebaseReady } from '../config/firebase.js';

let fsFns = null;
if (firebaseReady && db) {
  try {
    fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  } catch (e) {
    console.warn('[ScoreService] Firestore modülü yüklenemedi:', e.message);
  }
}

/**
 * Bir kullanıcı nesnesinin veya skor girdisinin misafir olup olmadığını kontrol eder.
 */
export function isGuestUser(userOrScore) {
  if (!userOrScore) return true;
  if (userOrScore.isGuest === true) return true;
  if (!userOrScore.uid) return true;
  const uid = String(userOrScore.uid);
  if (uid.startsWith('guest') || uid === 'guest' || uid === 'null' || uid === 'undefined') return true;
  const displayName = String(userOrScore.displayName || '');
  if (displayName.toLowerCase().startsWith('misafir')) return true;
  return false;
}

export class ScoreService {

  constructor() {
    this._cleanLocalGuestScores();
  }

  _canUseFirestore(user = null) {
    if (user && isGuestUser(user)) return false;
    return !!(firebaseReady && db && fsFns);
  }

  // ─── Skor Kaydetme ──────────────────────────────────────────

  async saveScore(user, gameResult) {
    // Misafir kullanıcıların verileri KESİNLİKLE kaydedilmez ve liderlik tablosuna eklenmez
    if (isGuestUser(user)) {
      console.log('[ScoreService] Misafir kullanıcı skoru kaydedilmedi.');
      return;
    }

    const { totalScore, rounds, mode, levelConfig } = gameResult;

    const scoreEntry = {
      uid: user.uid,
      displayName: user.displayName || 'Anonim',
      isGuest: false,
      modeId: mode.id,
      modeName: mode.name,
      levelNum: levelConfig?.level || 0,
      totalScore,
      maxPossible: gameResult.maxPossible,
      accuracy: Math.round((totalScore / gameResult.maxPossible) * 100),
      roundCount: rounds.length,
      rounds: rounds.map((r) => ({
        city: r.city.name,
        country: r.city.country,
        lat: r.city.lat,
        lng: r.city.lng,
        score: r.score,
        distance: Math.round(r.distance),
      })),
    };

    // Kayıtlı kullanıcı için yerel yedeğe kaydet
    scoreEntry.playedAt = new Date().toISOString();
    this._saveToLocal(scoreEntry);

    // Firebase Firestore'a kaydet (Herkesin Liderlik Tablosunda görebilmesi için)
    if (this._canUseFirestore(user)) {
      try {
        const fsEntry = { ...scoreEntry, playedAt: fsFns.serverTimestamp() };
        await fsFns.addDoc(fsFns.collection(db, 'scores'), fsEntry);
        await this._updateUserProfileFirestore(user, totalScore);
        await this._updateModeStatsFirestore(user, mode.id, totalScore);
        console.log('[ScoreService] Skor başarıyla Firebase Firestore\'a kaydedildi.');
      } catch (e) {
        console.warn('[ScoreService] Firestore sync hatası:', e.message);
      }
    }
  }

  // ─── Liderlik Tablosu ───────────────────────────────────────

  async getLeaderboard(modeId = 'world', limitCount = 50) {
    if (this._canUseFirestore()) {
      try {
        const rawScores = await Promise.race([
          (async () => {
            try {
              let q;
              if (modeId === 'all') {
                q = fsFns.query(
                  fsFns.collection(db, 'scores'),
                  fsFns.limit(200)
                );
              } else {
                q = fsFns.query(
                  fsFns.collection(db, 'scores'),
                  fsFns.where('modeId', '==', modeId),
                  fsFns.limit(200)
                );
              }
              const snapshot = await fsFns.getDocs(q);
              return snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
                playedAt: d.data().playedAt?.toDate?.() || new Date(),
              }));
            } catch (err) {
              console.warn('[ScoreService] Firestore getDocs hatası:', err);
              return null;
            }
          })(),
          new Promise((resolve) => setTimeout(() => resolve(null), 2000))
        ]);

        if (rawScores && rawScores.length > 0) {
          const uniqueScores = this._deduplicateLeaderboard(rawScores, limitCount);
          if (uniqueScores.length > 0) return uniqueScores;
        }
      } catch (e) {
        console.warn('[ScoreService] Firestore leaderboard hatası:', e.message);
      }
    }

    return this._getLocalLeaderboard(modeId, limitCount);
  }

  /**
   * Skor listesindeki her kayıtlı kullanıcının yalnızca en yüksek skorunu tutar ve sıralar.
   * Misafir kullanıcılar (isGuest: true veya guest_ ID'li) kesinlikle elenir.
   */
  _deduplicateLeaderboard(scores, limitCount = 50) {
    const userMap = new Map();
    for (const item of scores) {
      if (isGuestUser(item)) continue;

      const key = item.uid;
      const existing = userMap.get(key);
      if (!existing || (item.totalScore > existing.totalScore)) {
        userMap.set(key, item);
      }
    }
    const sorted = Array.from(userMap.values()).sort((a, b) => b.totalScore - a.totalScore);
    return sorted.slice(0, limitCount).map((s, idx) => ({
      ...s,
      rank: idx + 1
    }));
  }

  // ─── Kullanıcı Profili ──────────────────────────────────────

  async getUserProfile(user) {
    if (isGuestUser(user)) {
      return {
        uid: user?.uid || 'guest',
        displayName: user?.displayName || 'Misafir',
        totalScore: 0,
        gamesPlayed: 0,
        bestScore: 0,
      };
    }

    if (this._canUseFirestore(user)) {
      try {
        const profile = await Promise.race([
          (async () => {
            try {
              const ref = fsFns.doc(db, 'users', user.uid);
              const snap = await fsFns.getDoc(ref);
              if (snap.exists()) return snap.data();

              const newProf = {
                uid: user.uid,
                displayName: user.displayName || 'Anonim',
                email: user.email || null,
                totalScore: 0,
                gamesPlayed: 0,
                bestScore: 0,
                createdAt: fsFns.serverTimestamp(),
              };
              await fsFns.setDoc(ref, newProf);
              return newProf;
            } catch (e) {
              if (navigator.onLine && !e?.message?.includes('offline') && e?.code !== 'unavailable') {
                console.warn('[ScoreService] Firestore profil okuma hatası:', e.message);
              }
              return null;
            }
          })(),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500))
        ]);

        if (profile) return profile;
      } catch (e) {
        if (navigator.onLine && !e?.message?.includes('offline') && e?.code !== 'unavailable') {
          console.warn('[ScoreService] Profil getirme hatası:', e.message);
        }
      }
    }

    return this._getLocalProfile(user);
  }

  // ─── Mod Bazlı İstatistikler ────────────────────────────────

  async getModeStats(user, modeId) {
    const all = await this.getAllModeStats(user);
    return all[modeId] || { gamesPlayed: 0, bestScore: 0 };
  }

  async getAllModeStats(user) {
    const modeIds = ['world', 'europe', 'turkey', 'africa', 'asia', 'americas'];
    const results = {};

    if (isGuestUser(user)) {
      for (const modeId of modeIds) {
        results[modeId] = { gamesPlayed: 0, bestScore: 0 };
      }
      return results;
    }

    const userUid = user.uid;
    const allLocalScores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');

    for (const modeId of modeIds) {
      const modeScores = allLocalScores.filter((s) =>
        s.modeId === modeId && s.uid === userUid && !isGuestUser(s)
      );

      let gamesPlayed = modeScores.length;
      let bestScore = modeScores.reduce((max, s) => Math.max(max, s.totalScore || 0), 0);

      const key = `geomeister_mode_stats_${userUid}_${modeId}`;
      try {
        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        if (stored.gamesPlayed) gamesPlayed = Math.max(gamesPlayed, stored.gamesPlayed);
        if (stored.bestScore) bestScore = Math.max(bestScore, stored.bestScore);
      } catch {}

      results[modeId] = { gamesPlayed, bestScore };
    }

    if (this._canUseFirestore(user)) {
      try {
        await Promise.race([
          (async () => {
            for (const modeId of modeIds) {
              const docId = `${user.uid}_${modeId}`;
              const ref = fsFns.doc(db, 'userModeStats', docId);
              const snap = await fsFns.getDoc(ref);
              if (snap.exists()) {
                const data = snap.data();
                results[modeId].gamesPlayed = Math.max(results[modeId].gamesPlayed, data.gamesPlayed || 0);
                results[modeId].bestScore = Math.max(results[modeId].bestScore, data.bestScore || 0);
              }
            }
          })(),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500))
        ]);
      } catch (e) {
        console.warn('[ScoreService] Firestore mode stats skip:', e.message);
      }
    }

    return results;
  }

  // ─── Herkese Açık Profil (Başka Oyuncu) ──────────────────────

  async getPublicProfile(uid) {
    if (!uid) return null;

    let profileData = null;

    if (this._canUseFirestore() && !uid.startsWith('guest')) {
      try {
        const ref = fsFns.doc(db, 'users', uid);
        const snap = await Promise.race([
          fsFns.getDoc(ref),
          new Promise(resolve => setTimeout(() => resolve(null), 1500)),
        ]);
        if (snap && snap.exists()) profileData = snap.data();
      } catch (e) {
        console.warn('[ScoreService] Public profile fetch error:', e);
      }
    }

    // LocalStorage fallback & aggregation
    try {
      const allScores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
      const userScores = allScores.filter(s => s.uid === uid);
      if (userScores.length > 0) {
        const bestScore = userScores.reduce((max, s) => Math.max(max, s.totalScore || 0), 0);
        const gamesPlayed = userScores.length;
        const displayName = userScores[0].displayName || 'Oyuncu';

        if (!profileData) {
          profileData = { uid, displayName, bestScore, gamesPlayed, totalScore: bestScore };
        } else {
          profileData.bestScore = Math.max(profileData.bestScore || 0, bestScore);
          profileData.gamesPlayed = Math.max(profileData.gamesPlayed || 0, gamesPlayed);
        }
      }
    } catch {}

    return profileData || { uid, displayName: 'Oyuncu', bestScore: 0, gamesPlayed: 0, totalScore: 0 };
  }

  async getAllModeStatsPublic(uid) {
    const modeIds = ['world', 'europe', 'turkey', 'africa', 'asia', 'americas'];
    const results = {};

    for (const modeId of modeIds) {
      results[modeId] = { gamesPlayed: 0, bestScore: 0 };
    }

    if (!uid) return results;

    // LocalStorage fallback
    try {
      const allScores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
      const userScores = allScores.filter(s => s.uid === uid);
      for (const s of userScores) {
        const modeId = s.modeId || 'world';
        if (!results[modeId]) results[modeId] = { gamesPlayed: 0, bestScore: 0 };
        results[modeId].gamesPlayed++;
        results[modeId].bestScore = Math.max(results[modeId].bestScore, s.totalScore || 0);
      }
    } catch {}

    if (this._canUseFirestore() && !uid.startsWith('guest')) {
      try {
        for (const modeId of modeIds) {
          const docId = `${uid}_${modeId}`;
          const ref = fsFns.doc(db, 'userModeStats', docId);
          const snap = await Promise.race([
            fsFns.getDoc(ref),
            new Promise(r => setTimeout(() => r(null), 1500)),
          ]);
          if (snap && snap.exists()) {
            const data = snap.data();
            results[modeId] = {
              gamesPlayed: Math.max(results[modeId].gamesPlayed, data.gamesPlayed || 0),
              bestScore: Math.max(results[modeId].bestScore, data.bestScore || 0),
            };
          }
        }
      } catch (e) {
        console.warn('[ScoreService] Public mode stats error:', e);
      }
    }

    return results;
  }

  /**
   * Herhangi bir tur tahmini yapıldığında (Online, Offline veya Yarım Bırakılan) anında kaydeder.
   */
  saveRoundGuess(user, modeId, roundData) {
    if (isGuestUser(user)) return;
    try {
      const history = JSON.parse(localStorage.getItem('geomeister_round_history') || '[]');
      history.push({
        uid: user.uid,
        modeId: modeId || 'world',
        timestamp: Date.now(),
        lat: roundData.city?.lat ?? roundData.lat,
        lng: roundData.city?.lng ?? roundData.lng,
        city: roundData.city?.name ?? roundData.city ?? 'Bölge',
        country: roundData.city?.country ?? roundData.country ?? '',
        score: roundData.score || 0,
        distance: roundData.distanceKm ?? roundData.distance ?? 0,
      });
      if (history.length > 2500) history.shift();
      localStorage.setItem('geomeister_round_history', JSON.stringify(history));
    } catch {}

    // Firestore'a kaydet (Farklı domainlerde ve cihazlarda ısı haritasının korunması için)
    if (this._canUseFirestore(user)) {
      try {
        const entry = {
          uid: user.uid,
          modeId: modeId || 'world',
          timestamp: fsFns.serverTimestamp(),
          lat: roundData.city?.lat ?? roundData.lat,
          lng: roundData.city?.lng ?? roundData.lng,
          city: roundData.city?.name ?? roundData.city ?? 'Bölge',
          country: roundData.city?.country ?? roundData.country ?? '',
          score: roundData.score || 0,
          distance: roundData.distanceKm ?? roundData.distance ?? 0,
        };
        fsFns.addDoc(fsFns.collection(db, 'roundGuesses'), entry).catch(() => {});
      } catch {}
    }
  }

  /**
   * Oyuncunun oynadığı maçlara göre coğrafi performans ısı haritası verisini üretir (Online + Offline + Yarım Bırakılan).
   */
  getHeatmapData(userOrUid, modeId = 'turkey') {
    const targetUid = typeof userOrUid === 'string' ? userOrUid : userOrUid?.uid;
    if (!targetUid || targetUid.startsWith('guest')) return [];

    const locationStats = new Map();

    const processRound = (r, mId) => {
      if (r.lat == null || r.lng == null) return;
      if (modeId !== 'all' && mId !== modeId) return;
      const key = `${Number(r.lat).toFixed(3)}_${Number(r.lng).toFixed(3)}`;
      const existing = locationStats.get(key) || {
        name: r.city || 'Bölge',
        country: r.country || '',
        lat: Number(r.lat),
        lng: Number(r.lng),
        totalScore: 0,
        totalDistance: 0,
        count: 0,
      };
      existing.totalScore += r.score || 0;
      existing.totalDistance += (r.distanceKm ?? r.distance ?? 0);
      existing.count += 1;
      locationStats.set(key, existing);
    };

    // 1) Tamamlanan maç skorları (local)
    const allScores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
    const userScores = allScores.filter(s => s.uid === targetUid);
    userScores.forEach(game => {
      if (Array.isArray(game.rounds)) {
        game.rounds.forEach(r => processRound(r, game.modeId));
      }
    });

    // 2) Anlık / Online / Yarım bırakılan tur geçmişi (local)
    const roundHistory = JSON.parse(localStorage.getItem('geomeister_round_history') || '[]');
    const userRounds = roundHistory.filter(r => r.uid === targetUid);
    userRounds.forEach(r => processRound(r, r.modeId));

    return this._formatHeatmapItems(locationStats);
  }

  async getHeatmapDataAsync(userOrUid, modeId = 'turkey') {
    const targetUid = typeof userOrUid === 'string' ? userOrUid : userOrUid?.uid;
    if (!targetUid || targetUid.startsWith('guest')) return [];

    const localData = this.getHeatmapData(userOrUid, modeId);

    // Firestore'dan o kullanıcının kamuya açık maçlarını çek
    if (this._canUseFirestore() && !targetUid.startsWith('guest')) {
      try {
        const q = fsFns.query(
          fsFns.collection(db, 'scores'),
          fsFns.where('uid', '==', targetUid),
          fsFns.limit(50)
        );
        const snap = await Promise.race([
          fsFns.getDocs(q),
          new Promise(r => setTimeout(() => r(null), 2000))
        ]);

        if (snap && snap.docs.length > 0) {
          const locationStats = new Map();
          const processRound = (r, mId) => {
            if (r.lat == null || r.lng == null) return;
            if (modeId !== 'all' && mId !== modeId) return;
            const key = `${Number(r.lat).toFixed(3)}_${Number(r.lng).toFixed(3)}`;
            const existing = locationStats.get(key) || {
              name: r.city || 'Bölge',
              country: r.country || '',
              lat: Number(r.lat),
              lng: Number(r.lng),
              totalScore: 0,
              totalDistance: 0,
              count: 0,
            };
            existing.totalScore += r.score || 0;
            existing.totalDistance += (r.distanceKm ?? r.distance ?? 0);
            existing.count += 1;
            locationStats.set(key, existing);
          };

          snap.docs.forEach(doc => {
            const game = doc.data();
            if (Array.isArray(game.rounds)) {
              game.rounds.forEach(r => processRound(r, game.modeId));
            }
          });

          const fsItems = this._formatHeatmapItems(locationStats);
          if (fsItems.length > 0) return fsItems;
        }
      } catch (e) {
        console.warn('[ScoreService] Heatmap Firestore error:', e);
      }
    }

    return localData;
  }

  _formatHeatmapItems(locationStatsMap) {
    const heatmapItems = [];
    locationStatsMap.forEach(loc => {
      const avgScore = Math.round(loc.totalScore / loc.count);
      const avgDistance = Math.round(loc.totalDistance / loc.count);

      let status = 'medium';
      let color = '#f59e0b'; // Sarı / Turuncu (Orta Nokta)

      if (avgScore >= 720 || (avgDistance > 0 && avgDistance <= 250)) {
        status = 'strong';
        color = '#10b981'; // Yeşil (Güçlü Nokta)
      } else if (avgScore < 350 || avgDistance > 1500) {
        status = 'weak';
        color = '#ef4444'; // Kırmızı (Zayıf Nokta)
      }

      heatmapItems.push({
        name: loc.name,
        country: loc.country,
        lat: loc.lat,
        lng: loc.lng,
        attempts: loc.count,
        avgScore,
        avgDistance,
        status,
        color,
      });
    });
    return heatmapItems;
  }

  // ─── Private: Firestore ─────────────────────────────────────

  _canUseFirestore(user) {
    return firebaseReady && db && fsFns && !isGuestUser(user);
  }

  async _updateUserProfileFirestore(user, score) {
    if (isGuestUser(user)) return;
    const ref = fsFns.doc(db, 'users', user.uid);
    try {
      const snap = await fsFns.getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        await fsFns.updateDoc(ref, {
          totalScore: fsFns.increment(score),
          gamesPlayed: fsFns.increment(1),
          bestScore: Math.max(data.bestScore || 0, score),
        });
      } else {
        await fsFns.setDoc(ref, {
          uid: user.uid,
          displayName: user.displayName || 'Anonim',
          email: user.email || null,
          totalScore: score,
          gamesPlayed: 1,
          bestScore: score,
          createdAt: fsFns.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn('[ScoreService] Profil güncelleme hatası:', e);
    }
  }

  async _updateModeStatsFirestore(user, modeId, score) {
    if (isGuestUser(user)) return;
    const docId = `${user.uid}_${modeId}`;
    const ref = fsFns.doc(db, 'userModeStats', docId);
    try {
      const snap = await fsFns.getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        await fsFns.updateDoc(ref, {
          gamesPlayed: fsFns.increment(1),
          bestScore: Math.max(data.bestScore || 0, score),
          lastPlayed: fsFns.serverTimestamp(),
        });
      } else {
        await fsFns.setDoc(ref, {
          uid: user.uid,
          modeId,
          gamesPlayed: 1,
          bestScore: score,
          lastPlayed: fsFns.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn('[ScoreService] Mode stats güncelleme hatası:', e);
    }
  }

  // ─── Private: localStorage Fallback ─────────────────────────

  _cleanLocalGuestScores() {
    try {
      const raw = localStorage.getItem('geomeister_scores');
      if (!raw) return;
      const scores = JSON.parse(raw);
      const cleaned = scores.filter((s) => !isGuestUser(s));
      if (cleaned.length !== scores.length) {
        localStorage.setItem('geomeister_scores', JSON.stringify(cleaned));
      }
    } catch {}
  }

  _saveToLocal(scoreEntry) {
    if (isGuestUser(scoreEntry)) return;
    try {
      const scores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
      scores.push(scoreEntry);
      localStorage.setItem('geomeister_scores', JSON.stringify(scores));

      const profileKey = `geomeister_profile_${scoreEntry.uid}`;
      const profile = JSON.parse(localStorage.getItem(profileKey) || '{}');
      profile.totalScore = (profile.totalScore || 0) + scoreEntry.totalScore;
      profile.gamesPlayed = (profile.gamesPlayed || 0) + 1;
      profile.bestScore = Math.max(profile.bestScore || 0, scoreEntry.totalScore);
      localStorage.setItem(profileKey, JSON.stringify(profile));

      const modeKey = `geomeister_mode_stats_${scoreEntry.uid}_${scoreEntry.modeId}`;
      const modeStats = JSON.parse(localStorage.getItem(modeKey) || '{}');
      modeStats.gamesPlayed = (modeStats.gamesPlayed || 0) + 1;
      modeStats.bestScore = Math.max(modeStats.bestScore || 0, scoreEntry.totalScore);
      localStorage.setItem(modeKey, JSON.stringify(modeStats));
    } catch (e) {
      console.warn('[ScoreService] localStorage kayıt hatası:', e);
    }
  }

  _getLocalLeaderboard(modeId, limitCount) {
    try {
      this._cleanLocalGuestScores();
      let scores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
      scores = scores.filter((s) => !isGuestUser(s));
      if (modeId !== 'all') scores = scores.filter((s) => s.modeId === modeId);
      return this._deduplicateLeaderboard(scores, limitCount);
    } catch { return []; }
  }

  _getLocalProfile(user) {
    if (isGuestUser(user)) {
      return { uid: user?.uid || 'guest', displayName: user?.displayName || 'Misafir', totalScore: 0, gamesPlayed: 0, bestScore: 0 };
    }
    try {
      const userUid = user.uid;
      const allScores = JSON.parse(localStorage.getItem('geomeister_scores') || '[]');
      const userScores = allScores.filter((s) => s.uid === userUid && !isGuestUser(s));

      const totalScore = userScores.reduce((sum, s) => sum + (s.totalScore || 0), 0);
      const gamesPlayed = userScores.length;
      const bestScore = userScores.reduce((max, s) => Math.max(max, s.totalScore || 0), 0);

      return {
        uid: userUid,
        displayName: user.displayName || 'Kullanıcı',
        totalScore,
        gamesPlayed,
        bestScore,
      };
    } catch { return { totalScore: 0, gamesPlayed: 0, bestScore: 0 }; }
  }

  _getLocalModeStats(user, modeId) {
    if (isGuestUser(user)) {
      return { gamesPlayed: 0, bestScore: 0 };
    }
    try {
      const key = `geomeister_mode_stats_${user.uid}_${modeId}`;
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      return { gamesPlayed: stored.gamesPlayed || 0, bestScore: stored.bestScore || 0 };
    } catch { return { gamesPlayed: 0, bestScore: 0 }; }
  }
}
