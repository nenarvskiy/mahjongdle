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

/** Слотов кандор в мёртвой стене. */
export const KAN_DORA_SLOTS = 5;

/** Все каны в наборе тайлов: [{tile, tiles, indices}]. */
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
      kans.push({
        tile: kind,
        tiles: items.slice(0, 4).map((item) => item.tile),
        indices: items.slice(0, 4).map((item) => item.index),
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

/** Сколько кандор открыто: 1 базовая + по одной за кан (макс. 5). */
export function openKanDoraCount(kanCount, baseOpen = 1) {
  return Math.max(baseOpen, Math.min(KAN_DORA_SLOTS, baseOpen + Math.max(0, kanCount)));
}

/** Слоты кандор: [{index, tile, open}] — первые openCount открыты. */
export function kanDoraSlots(deadWall, openCount) {
  const open = Math.max(1, Math.min(KAN_DORA_SLOTS, openCount));
  return deadWall.slice(0, KAN_DORA_SLOTS).map((tile, index) => ({
    index,
    tile,
    open: index < open,
  }));
}
