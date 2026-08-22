// Veri Kayıt Defteri — Tüm şehir setlerini buradan yönet
import worldCities from './world.js';
import { europeCities } from './europe.js';
import { turkeyCities } from './turkey.js';
import { africaCities } from './africa.js';
import asiaCities from './asia.js';
import americasCities from './americas.js';

export const DataRegistry = {
  world: worldCities,
  europe: europeCities,
  turkey: turkeyCities,
  africa: africaCities,
  asia: asiaCities,
  americas: americasCities,
};

export function getCitiesForMode(modeDataSource) {
  const cities = DataRegistry[modeDataSource];
  if (!cities) throw new Error(`Unknown data source: ${modeDataSource}`);
  return cities;
}

export default DataRegistry;
