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
 * Мёртвая стена дня — 10 тайлов, одинаковая для всех игроков, детерминирована
 * по dayKey (на следующий день — другая). ВСЕ доры дня берутся из стены:
 *   [0] дора-индикатор, [1] ура-индикатор,
 *   [2] кан-дора 1, [3] кан-ура 1, [4] кан-дора 2, [5] кан-ура 2,
 *   [6] кан-дора 3, [7] кан-ура 3, [8] кан-дора 4, [9] кан-ура 4.
 * Один тайл каждого вида отложен (в раздачу не попадает — как индикаторы в
 * реально риичи, лежащие в мёртвой стене), остальные 3 копии вида в обороте.
 */
export function createDeadWall(dayKey) {
  const ids = allTileIds();
  const shuffled = ids
    .map((tile, index) => ({ tile, key: hash32(`dead:${dayKey}:${index}`) }))
    .sort((a, b) => a.key - b.key)
    .map((item) => item.tile);
  return {
    doraIndicator: shuffled[0],
    uraIndicator: RULES.uraDora ? shuffled[1] : null,
    kanDora: [shuffled[2], shuffled[4], shuffled[6], shuffled[8]],
    kanUra: [shuffled[3], shuffled[5], shuffled[7], shuffled[9]],
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
  // Дора- и ура-индикаторы берутся из мёртвой стены дня (первые два тайла),
  // а не независимым хэшем (0.6.25): все доры дня — члены одной стены.
  // Ура открывается только после сброса: до этого момента очки считаются
  // без урадор (см. rules.uraDora).
  const deadWall = createDeadWall(dayKey);
  const doraIndicator = deadWall.doraIndicator;
  const uraIndicator = deadWall.uraIndicator;
  const uraIndicators = uraIndicator ? [uraIndicator] : [];
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
    deadTiles: deadWall.tiles,
  };
}

export function windName(id) {
  return HONORS.find((honor) => honor.id === id)?.short ?? id;
}
