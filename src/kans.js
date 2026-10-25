/**
 * Каны в «руке дня» (чистая логика, без DOM).
 *
 * Правила:
 *  - кан — 4 одинаковых тайла; красная пятёрка — та же пятёрка
 *    ('0m' + '5m' x3 = кан пятёрок);
 *  - объявленный кан = фиксированный пон: в оценке шантена его нельзя
 *    разобрать. Реализация: к скрытой руке добавляются 3 тайла кана
 *    (withKanPons) — разбор «мелд» всегда выгоднее «пара+сингл», поэтому
 *    решатель шантена его не ломает;
 *  - кан, оставшийся в руке после сброса, тоже считается объявленным
 *    (countKans учитывает четвёрки в остатке).
 */
import { canonicalTileId } from './tiles.js';

/** Тайлов-кандор в мёртвой стене (часть 10 скрытых тайлов дня). */
export const KAN_DORA_SLOTS = 5;

/** Максимум кан-дор: одна за каждый кан, в руке не больше 4 канов. */
export const MAX_KAN_DORA = 4;

/** Все каны в наборе тайлов: [{tile, tiles, indices}].
 *  tile — вид тайла; если красная пятёрка входит в кан, — красный id
 *  ('0m'/'0p'/'0s'): серверу и скорингу нужна красная дора за 4-й тайл
 *  кана (аудит F4), а все потребители (kanLock, withKanPons) канонизируют. */
export function findKans(tiles) {
  const byKind = new Map();
  tiles.forEach((tile, index) => {
    const kind = canonicalTileId(tile);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ tile, index });
  });
  const kans = [];
  for (const [kind, items] of byKind) {
    if (items.length >= 4) {
      const four = items.slice(0, 4);
      const red = four.find((item) => item.tile[0] === '0');
      kans.push({
        tile: red ? red.tile : kind,
        tiles: four.map((item) => item.tile),
        indices: four.map((item) => item.index),
      });
    }
  }
  return kans;
}

/** Есть ли кан. */
export function hasKan(tiles) {
  return findKans(tiles).length > 0;
}

/** Объявленные + оставшиеся в руке четвёрки. */
export function countKans(declaredKans, remainingTiles) {
  return declaredKans.length + findKans(remainingTiles).length;
}

/** Тайлы для оценки: скрытая рука + 3 тайла за каждый объявленный кан. */
export function withKanPons(tiles, declaredKans = []) {
  const extra = [];
  for (const kan of declaredKans) {
    const kind = typeof kan === 'string' ? kan : kan.tile;
    extra.push(kind, kind, kind);
  }
  return [...tiles, ...extra];
}

/**
 * Сколько кан-дор открыто: по одной за каждый кан дня, БЕЗ базовой
 * (максимум 4 — столько канов, сколько может быть в руке).
 */
export function openKanDoraCount(kanCount, baseOpen = 0) {
  return Math.min(MAX_KAN_DORA, baseOpen + Math.max(0, kanCount));
}

/**
 * Сколько ура-дор открыто в конце дня: 1 базовая (ура индикатор дня) +
 * по одной за каждый кан (максимум 5 тайлов-ура в мёртвой стене).
 */
export function openUraCount(kanCount) {
  return Math.min(KAN_DORA_SLOTS, 1 + Math.max(0, kanCount));
}

/** Слоты кандор: [{index, tile, open}] — первые openCount открыты. */
export function kanDoraSlots(deadWall, openCount) {
  const open = Math.max(0, Math.min(deadWall.length, openCount));
  return deadWall.map((tile, index) => ({
    index,
    tile,
    open: index < open,
  }));
}
