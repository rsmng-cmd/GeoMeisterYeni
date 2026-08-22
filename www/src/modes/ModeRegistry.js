import worldMode from './world.mode.js';
import europeMode from './europe.mode.js';
import turkeyMode from './turkey.mode.js';
import africaMode from './africa.mode.js';

// Tüm mevcut oyun modları
export const modes = [
  {
    id: 'online',
    name: 'Online',
    icon: '🌐',
    description: '1v1 Canlı Eşleşme veya Özel Oda Kur',
    color: '#38bdf8',
    available: true,
    isOnline: true,
  },
  worldMode,
  turkeyMode,
  europeMode,
  africaMode,
  {
    id: 'asia',
    name: 'Asya',
    icon: '🌏',
    description: 'Asya şehirleri ve başkentleri',
    difficulty: 'medium',
    difficultyLabel: 'Orta',
    dataSource: 'asia',
    mapCenter: [34.0, 100.0],
    mapZoom: { min: 2, max: 10, start: 3 },
    color: '#10b981',
    available: false,
  },
  {
    id: 'americas',
    name: 'Amerika',
    icon: '🌎',
    description: 'Kuzey ve Güney Amerika şehirleri',
    difficulty: 'medium',
    difficultyLabel: 'Orta',
    dataSource: 'americas',
    mapCenter: [10.0, -85.0],
    mapZoom: { min: 2, max: 10, start: 3 },
    color: '#8b5cf6',
    available: false,
  },
];

export function getModeById(id) {
  return modes.find(m => m.id === id) || null;
}

export default modes;
