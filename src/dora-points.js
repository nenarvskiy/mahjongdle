/**
 * Очки за доры в руке.
 *
 * Правило: 2^(n-1) * 100, где n — СУММАРНОЕ количество дор в руке:
 *   - обычные доры (по индикаторам доры),
 *   - ура-доры (по индикаторам ура),
 *   - красные пятёрки.
 *
 * Доры при этом продолжают давать хан (и через хан — тир базы): это
 * независимая награда, поэтому очки добавляются отдельной строкой разбивки.
 */
import { RULES } from './config.js';
import { countDora } from './daily-context.js';
import { tileToIndex } from './tile-index.js';
import { canonicalTileId } from './tiles.js';

/**
 * Сколько дор в руке: обычные + ура + красные пятёрки.
 * counts — счётчики видов тайлов (handToCounts), redFives — красные из руки,
 * declaredKans — объявленные каны: «пон» кана в counts несёт 3 тайла,
 * но кан — это 4, поэтому четвёртый тайл добавляется для подсчёта дор.
 */
export function countHandDoras(counts, ctx = {}, redFives = [], declaredKans = []) {
  const c = counts.slice();
  for (const kan of declaredKans ?? []) {
    const kind = typeof kan === 'string' ? kan : kan?.tile;
    if (kind == null) continue;
    const idx = tileToIndex(canonicalTileId(kind));
    if (idx != null) c[idx] += 1;
  }
  let total = 0;
  if (RULES.doraFromIndicator) {
    total += countDora(c, ctx.doraIndicators ?? []);
  }
  if (RULES.uraDora) {
    total += countDora(c, ctx.uraIndicators ?? []);
  }
  if (RULES.akaDora) {
    const seen = new Set(redFives ?? []);
    for (const tile of seen) {
      const index = tileToIndex(tile);
      if (index != null && c[index] > 0) total += 1;
    }
  }
  return total;
}

/** Очки за n дор: 2^(n-1) * 100 (при n <= 0 — ноль). */
export function doraPoints(n) {
  return n > 0 ? 2 ** (n - 1) * 100 : 0;
}

/** Строка разбивки для n дор (null, если дор нет). */
export function doraRow(n) {
  if (!(n > 0)) return null;
  return { label: `Доры ×${n}`, points: doraPoints(n), dora: true };
}
