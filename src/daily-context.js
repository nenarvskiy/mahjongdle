import { HONORS, RULES } from './config.js';
import { allTileIds, canonicalTileId } from './tiles.js';
import { tileToIndex } from './tile-index.js';

const WINDS = ['ew', 'sw', 'ww', 'nw'];
const DRAGONS = ['wd', 'gd', 'rd'];
const DAY_MS = 86_400_000;
const DAILY_TIME_ZONE = 'Europe/Moscow';

function hash32(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Дора (и ура-дора) по индикатору: следующий тайл по кругу (9 → 1, ветры, драконы).
 *  Красная пятёрка — это та же пятёрка ('0p' → '6p'), поэтому сначала канонизируем id. */
export function doraFromIndicator(indicator) {
  const kind = canonicalTileId(indicator);
  if (WINDS.includes(kind)) return WINDS[(WINDS.indexOf(kind) + 1) % WINDS.length];
  if (DRAGONS.includes(kind)) return DRAGONS[(DRAGONS.indexOf(kind) + 1) % DRAGONS.length];
  const number = Number.parseInt(kind[0], 10);
  return `${number === 9 ? 1 : number + 1}${kind[1]}`;
}

export function countDora(counts, indicators = []) {
  return indicators.reduce((total, indicator) => {
    const dora = doraFromIndicator(indicator);
    return total + counts[tileToIndex(dora)];
  }, 0);
}

/**
 * Мёртвая стена дня: 10 тайлов = 5 индикаторов кандор + 5 их ура-тайлов
 * (ура кандор открывается на следующий день). Детерминирована по dayKey:
 * одинакова для всех игроков, на следующий день — другая.
 */
export function createDeadWall(dayKey) {
  const ids = allTileIds();
  const shuffled = ids
    .map((tile, index) => ({ tile, key: hash32(`dead:${dayKey}:${index}`) }))
    .sort((a, b) => a.key - b.key)
    .map((item) => item.tile);
  return {
    kanDora: shuffled.slice(0, 5),
    kanUra: shuffled.slice(5, 10),
    tiles: shuffled.slice(0, 10),
  };
}

export function createDailyContext(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: DAILY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
  const dayNumber = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS);
  const roundWindId = WINDS[((dayNumber % WINDS.length) + WINDS.length) % WINDS.length];
  const seatWindId = WINDS[hash32(`seat:${dayKey}`) % WINDS.length];
  const ids = allTileIds();
  const doraIndicator = ids[hash32(`dora:${dayKey}`) % ids.length];
  // Ура-индикатор — второй тайл мёртвой стены. Открывается только после сброса:
  // до этого момента очки считаются без урадор (см. rules.uraDora).
  const uraIndicator = RULES.uraDora ? ids[hash32(`ura:${dayKey}`) % ids.length] : null;
  const uraIndicators = uraIndicator ? [uraIndicator] : [];
  const deadWall = createDeadWall(dayKey);
  return {
    dayKey,
    deadWall,
    roundWindId,
    seatWindId,
    roundWind: tileToIndex(roundWindId),
    seatWind: tileToIndex(seatWindId),
    doraIndicators: [doraIndicator],
    uraIndicators,
    doraTiles: [doraFromIndicator(doraIndicator)],
    uraTiles: uraIndicators.map(doraFromIndicator),
    /** Тайлы, лежащие в мёртвой стене: их копии в добор не попадают. */
    deadTiles: [doraIndicator, ...uraIndicators, ...deadWall.tiles],
  };
}

export function windName(id) {
  return HONORS.find((honor) => honor.id === id)?.short ?? id;
}
