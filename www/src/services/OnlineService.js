// OnlineService.js — ELO, Rütbe (Rank) ve Yerleşme Maçları Yönetimi
import { db, firebaseReady } from '../config/firebase.js';

let fsFns = null;
async function getFsFns() {
  if (fsFns) return fsFns;
  if (firebaseReady && db) {
    try {
      fsFns = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      return fsFns;
    } catch (e) {
      console.warn('[OnlineService] Firestore module load warning:', e.message);
    }
  }
  return null;
}

export const UNRANKED = { id: 'unranked', name: 'Yerleşme Aşamasında', icon: '❓', color: '#94a3b8', botAvgScore: 350 };

export const RANKS = {
  BRONZE: { id: 'bronz', name: 'Bronz', icon: '🥉', minElo: 0, maxElo: 40, color: '#cd7f32', botAvgScore: 300 },
  SILVER: { id: 'gumus', name: 'Gümüş', icon: '🥈', minElo: 40, maxElo: 70, color: '#c0c0c0', botAvgScore: 420 },
  GOLD: { id: 'altin', name: 'Altın', icon: '🥇', minElo: 70, maxElo: 100, color: '#ffd700', botAvgScore: 540 },
  PLATINUM: { id: 'platin', name: 'Platin', icon: '💎', minElo: 100, maxElo: Infinity, color: '#38bdf8', botAvgScore: 700 },
};

export function getRankByElo(elo = 50) {
  const score = Math.max(0, Number(elo) || 0);
  if (score < 40) return RANKS.BRONZE;
  if (score < 70) return RANKS.SILVER;
  if (score < 100) return RANKS.GOLD;
  return RANKS.PLATINUM;
}

export class OnlineService {
  constructor() {
    this.DEFAULT_ELO = 50;
    this.PLACEMENT_MATCHES_REQUIRED = 5;
  }

  /**
   * Kullanıcının belirtilen mod için ELO ve online istatistiklerini getirir.
   * Modlar: 'world' veya 'europe'
   */
  async getPlayerOnlineStats(user, modeId = 'world') {
    const uid = user?.uid || 'guest';
    const storageKey = `geomeister_online_stats_${uid}_${modeId}`;
    
    // Varsayılan değerler
    let stats = {
      elo: this.DEFAULT_ELO,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      isRanked: false,
    };

    const fns = await getFsFns();
    if (user && !user.isGuest && db && fns) {
      try {
        const ref = fns.doc(db, 'userOnlineStats', `${uid}_${modeId}`);
        const snap = await Promise.race([
          fns.getDoc(ref),
          new Promise(r => setTimeout(() => r(null), 2500))
        ]);
        if (snap && snap.exists()) {
          const data = snap.data();
          stats = {
            elo: data.elo ?? stats.elo,
            matchesPlayed: data.matchesPlayed ?? stats.matchesPlayed,
            wins: data.wins ?? stats.wins,
            losses: data.losses ?? stats.losses,
            isRanked: (data.matchesPlayed || 0) >= this.PLACEMENT_MATCHES_REQUIRED,
          };
          localStorage.setItem(storageKey, JSON.stringify(stats));
        }
      } catch (e) {
        console.warn('[OnlineService] Stats fetch warning:', e.message);
      }
    } else {
      try {
        const localData = localStorage.getItem(storageKey);
        if (localData) {
          stats = { ...stats, ...JSON.parse(localData) };
        }
      } catch {}
    }

    const matchesCount = Number(stats.matchesPlayed) || 0;
    stats.matchesPlayed = matchesCount;
    stats.isRanked = matchesCount >= this.PLACEMENT_MATCHES_REQUIRED;
    stats.rank = stats.isRanked ? getRankByElo(stats.elo) : {
      ...UNRANKED,
      name: `Yerleşme Aşamasında (${matchesCount}/5)`,
    };
    return stats;
  }

  /**
   * Maç bittiğinde ELO güncellemesi yapar (+10 Win, -10 Loss)
   */
  async updateMatchResult(user, modeId, isWin) {
    const uid = user?.uid || 'guest';
    const stats = await this.getPlayerOnlineStats(user, modeId);

    const eloDelta = isWin ? 10 : -10;
    const newElo = Math.max(0, stats.elo + eloDelta);
    const newMatchesPlayed = stats.matchesPlayed + 1;
    const newWins = stats.wins + (isWin ? 1 : 0);
    const newLosses = stats.losses + (isWin ? 0 : 1);
    const isRanked = newMatchesPlayed >= this.PLACEMENT_MATCHES_REQUIRED;

    const updatedStats = {
      elo: newElo,
      matchesPlayed: newMatchesPlayed,
      wins: newWins,
      losses: newLosses,
      isRanked,
    };

    // LocalStorage Güncelle (Sadece kayıtlı kullanıcılar için)
    if (user && !user.isGuest && !uid.startsWith('guest_')) {
      const storageKey = `geomeister_online_stats_${uid}_${modeId}`;
      localStorage.setItem(storageKey, JSON.stringify(updatedStats));
    }

    // Firestore Güncelle
    const fns = await getFsFns();
    if (user && !user.isGuest && db && fns) {
      try {
        const ref = fns.doc(db, 'userOnlineStats', `${uid}_${modeId}`);
        await fns.setDoc(ref, {
          uid,
          displayName: user.displayName || 'Anonim',
          modeId,
          elo: newElo,
          matchesPlayed: newMatchesPlayed,
          wins: newWins,
          losses: newLosses,
          updatedAt: fns.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn('[OnlineService] Firestore ELO save error:', e);
      }
    }

    return {
      oldElo: stats.elo,
      newElo,
      eloDelta,
      matchesPlayed: newMatchesPlayed,
      rank: isRanked ? getRankByElo(newElo) : {
        ...UNRANKED,
        name: `Yerleşme Aşamasında (${newMatchesPlayed}/5)`,
      },
      isRanked,
    };
  }
  /**
   * Başka bir oyuncunun online istatistiklerini getirir (profil görüntüleme için).
   */
  async getPlayerPublicOnlineStats(uid, modeId = 'world') {
    let stats = {
      elo: this.DEFAULT_ELO,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      isRanked: false,
      rank: null,
    };

    if (db && fsFns) {
      try {
        const ref = fsFns.doc(db, 'userOnlineStats', `${uid}_${modeId}`);
        const snap = await Promise.race([
          fsFns.getDoc(ref),
          new Promise(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
        if (snap && snap.exists()) {
          const data = snap.data();
          stats = {
            elo: data.elo ?? stats.elo,
            matchesPlayed: data.matchesPlayed ?? 0,
            wins: data.wins ?? 0,
            losses: data.losses ?? 0,
            isRanked: (data.matchesPlayed || 0) >= this.PLACEMENT_MATCHES_REQUIRED,
          };
        }
      } catch (e) {
        console.warn('[OnlineService] Public stats fetch error:', e);
      }
    }

    stats.rank = stats.isRanked ? getRankByElo(stats.elo) : null;
    return stats;
  }
}

export default new OnlineService();
