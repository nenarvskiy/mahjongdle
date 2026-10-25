import { NUM_TILES } from './tile-index.js';
import { maxCountsForDeadTiles } from './tiles.js';
import { calcShanten, tenpaiWaits, kanLock } from './shanten.js';
import { evaluateComplete } from './evaluate.js';
import { tierOfHan } from './tiers.js';

const EMPTY = Object.freeze({
  han: -1, hanWithoutUra: -1, uraHan: 0, yaku: [], label: null, type: 'none',
});
const potentialCache = new Map();
const keyOf = (counts) => counts.join('');
const kanKeyOf = (kans) => (kans ?? []).map((k) => (typeof k === 'string' ? k : k?.tile)).join(',');

/** Лучшая по хану достройка среди перечисленных 13-тайловых состояний. */
function bestCompletion(tenpaiStates, ctx, declaredKans = []) {
  let best = { ...EMPTY };
  for (const counts of tenpaiStates) {
    for (const winningTile of tenpaiWaits(counts, declaredKans)) {
      const completed = counts.slice();
      completed[winningTile]++;
      const result = evaluateComplete(completed, {
        ...ctx,
        closed: true,
        riichi: true,
        // Достройка — добором тайла игроком (цумо), поэтому закрытые поны
        // остаются закрытыми (сананко на шанпон-ожидании не теряет хан).
        // Хан за само цумо не даётся: rules.tsumo = false.
        tsumo: true,
        winningTile,
      }, declaredKans);
      // В v4 тир определяется числом хан, поэтому и лучшая достройка — по хану.
      if (result.han > best.han) best = { ...result, completedCounts: completed };
    }
  }
  return best;
}

/**
 * Все уникальные 13-тайловые состояния после одного эффективного добора и
 * сброса. Оставляем только переходы, которые действительно уменьшают сянтэн.
 * maxCounts — потолок копий вида в руке (копии индикаторов лежат в мёртвой
 * стене и в добор не попадают).
 */
function improveOnce(states, fromShanten, maxCounts, declaredKans = []) {
  const nextStates = new Map();
  const target = fromShanten - 1;
  const lock = kanLock(declaredKans);
  for (const counts of states) {
    for (let draw = 0; draw < NUM_TILES; draw++) {
      const cap = maxCounts ? maxCounts[draw] : 4;
      if (counts[draw] >= cap) continue;
      const withDraw = counts.slice();
      withDraw[draw]++;
      for (let discard = 0; discard < NUM_TILES; discard++) {
        if (!withDraw[discard]) continue;
        // Тайлы объявленного кана зафиксированы: сбрасывать можно только
        // копии сверх «пона» (если добор принёс ещё одну).
        if (withDraw[discard] <= lock[discard]) continue;
        const next = withDraw.slice();
        next[discard]--;
        if (calcShanten(next, declaredKans) !== target) continue;
        nextStates.set(keyOf(next), next);
      }
    }
  }
  return [...nextStates.values()];
}

/**
 * Максимальная реальная стоимость руки, достижимой за минимальное число
 * эффективных улучшений. Поддерживаются тенпай, ишантен и 2-сянтэн.
 *
 * Ура-дор: две оценки.
 *  * hanWithoutUra — хан БЕЗ урадор: величина «решения». Сброс игрок выбирает
 *    до открытия индикатора, поэтому именно по ней считает модель идеального
 *    сброса (stats/scorestat.py, режим 1). В игре автоподсказки сброса нет,
 *    сброс выбирает игрок, так что здесь это информационное поле;
 *  * han — финальный хан: после сброса индикатор открыт, лучшая достройка
 *    ищется ЗАНОВО уже с урадорами; этот хан задаёт тир и базу и то, какая
 *    именно рука показана в «потенциале».
 */
export function analyzePotential(counts, shanten, ctx = {}, declaredKans = []) {
  if (shanten < 0 || shanten > 2) return { ...EMPTY };
  const uraIndicators = ctx.uraIndicators ?? [];
  const deadTiles = ctx.deadTiles ?? [...(ctx.doraIndicators ?? []), ...uraIndicators];
  const doraKey = (ctx.doraIndicators ?? []).join(',');
  const uraKey = uraIndicators.join(',');
  const deadKey = deadTiles.join(',');
  const redKey = (ctx.redFives ?? []).join(',');
  const kanKey = kanKeyOf(declaredKans);
  const cacheKey = `${keyOf(counts)}|${shanten}|${ctx.dealer ? 1 : 0}|${ctx.seatWind ?? '-'}|${ctx.roundWind ?? '-'}|${doraKey}|${uraKey}|${deadKey}|${redKey}|${kanKey}`;
  if (potentialCache.has(cacheKey)) return potentialCache.get(cacheKey);

  const maxCounts = maxCountsForDeadTiles(deadTiles);
  let states = [counts];
  for (let current = shanten; current > 0; current--) {
    states = improveOnce(states, current, maxCounts, declaredKans);
    if (states.length === 0) break;
  }

  const best = states.length ? bestCompletion(states, ctx, declaredKans) : { ...EMPTY };
  const withoutUra = states.length && uraIndicators.length
    ? bestCompletion(states, { ...ctx, uraIndicators: [] }, declaredKans)
    : best;
  const uraHan = (best.yaku ?? [])
    .filter((item) => item?.id === 'ura_dora')
    .reduce((sum, item) => sum + item.han, 0);
  const result = {
    ...best,
    hanWithoutUra: withoutUra.han,
    uraHan,
    type: shanten === 0 ? 'tenpai' : shanten === 1 ? 'ishanten' : 'two-shanten',
  };
  potentialCache.set(cacheKey, result);
  return result;
}

/** Тир руки по числу хан (фу в v4 не участвуют).
 *  Пороги — config/scoring.json -> systems.v4.tiers. */
export function valueTier(value) {
  const han = typeof value === 'number' ? value : value?.han ?? -1;
  return tierOfHan(han);
}

export function clearPotentialCache() {
  potentialCache.clear();
}