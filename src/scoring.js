import { handToCounts, indexToTile } from './tile-index.js';
import { calcShanten, isWinningHand, kanLock } from './shanten.js';
import { bestPartition, winningPartition } from './partition.js';
import { patternLabel } from './patterns.js';
import { detectV4Yaku } from './yaku-v4.js';
import { analyzePotential } from './potential.js';
import { evaluateComplete } from './evaluate.js';
import { basePoints, RULES, BASE_TABLE } from './config.js';
import { tierOfHan, stateLabel } from './tiers.js';
import { countHandDoras, doraRow } from './dora-points.js';

export { evaluateComplete } from './evaluate.js';
export { analyzePotential, valueTier } from './potential.js';

function displayFromPart(part) {
  return [
    ...part.blocks.map((block) => ({
      tiles: block.pattern.deltas.map((delta) => indexToTile(block.base + delta)),
      label: patternLabel(block.pattern, block.base),
      points: block.points,
      isSingle: false,
    })),
    ...part.singles.map((tile) => ({
      tiles: [indexToTile(tile)], label: 'Одиночка', points: 0, isSingle: true,
    })),
  ];
}

function partitionDisplay(counts, kanKinds = []) {
  const part = bestPartition(counts, kanKinds);
  return { part, display: displayFromPart(part) };
}

/** Индексы видов тайлов объявленных канов (для кан-блоков в разбиении). */
function kanKindsOf(declaredKans = []) {
  const lock = kanLock(declaredKans);
  const kinds = [];
  for (let i = 0; i < lock.length; i++) if (lock[i]) kinds.push(i);
  return kinds;
}

/**
 * Отображение готовой руки: правилное разбиение по типу руки
 * (4 сета + пара / 7 пар / кокуши), а не лучшее по очкам.
 * Очки структуры при этом считаются по лучшему разбиению (part).
 * Объявленные каны показываются блоками «Кан».
 */
function winningDisplay(counts, kanKinds = []) {
  const win = winningPartition(counts, kanKinds);
  return win ? displayFromPart(win) : null;
}

function structureRow(part) {
  return {
    label: 'Структура',
    points: part.score,
    blocks: part.blocks.map((block) => ({
      label: patternLabel(block.pattern, block.base),
      base: indexToTile(block.base),
      points: block.points,
    })),
  };
}

function yakuRows(counts, ctx) {
  return detectV4Yaku(counts, ctx).map((yaku) => ({
    id: yaku.id,
    label: yaku.count > 1 ? `${yaku.name} ×${yaku.count}` : yaku.name,
    points: yaku.points,
    yaku: true,
  }));
}

/** Строка базы: состояние × тир лучшей руки за минимальный добор. */
function baseRow(state, tier, base) {
  const label = stateLabel(state) ?? `Состояние ${state}`;
  return {
    label: `База: ${label} · ${tier.label}`,
    points: base,
    potential: true,
  };
}

function keepRedFives(display, sourceTiles) {
  const redFives = sourceTiles.filter((tile) => tile[0] === '0');
  if (!redFives.length) return display;
  const copy = display.map((group) => ({ ...group, tiles: group.tiles.slice() }));
  for (const red of redFives) {
    const regular = `5${red[1]}`;
    const group = copy.find((item) => item.tiles.includes(regular));
    if (group) group.tiles[group.tiles.indexOf(regular)] = red;
  }
  return copy;
}

function hanText(han) {
  return han < 0 ? 'без яку' : `${han} хан`;
}

/** Строка про лучшую достройку: какой рукой набирается тир. */
function potentialDescription(potential) {
  const yaku = potential.yaku
    .map((item) => (typeof item.han === 'number' && item.han > 1
      ? `${item.name} ×${item.han}`
      : item.name))
    .join(', ');
  const tier = tierOfHan(potential.han);
  return `Потенциал: ${tier.label} · ${hanText(potential.han)}${yaku ? ` · ${yaku}` : ''}`;
}

/** Оценка готовой стартовой руки: сбрасывать тайл не нужно.
 *  База берётся из строки «Готовая рука» (последняя строка таблицы базы)
 *  со своим тиром. Риичи считается по общему дефолту (как в potential.js). */
export function evaluateCompleteHand(tiles, ctx = {}, declaredKans = []) {
  const counts = handToCounts(tiles);
  if (tiles.length !== 14 || !isWinningHand(counts)) return null;
  // Объявленный кан в структуре — блок «Кан» (5500), а не «Пон» (125).
  const kanKinds = kanKindsOf(declaredKans);
  const partition = partitionDisplay(counts, kanKinds);
  const { part } = partition;
  // Готовую руку показываем правилами по типу руки (4 сета + пара / 7 пар /
  // кокуши), а не как лучшее по очкам.
  const display = keepRedFives(winningDisplay(counts, kanKinds) ?? partition.display, tiles);
  const redFives = tiles.filter((tile) => tile[0] === '0');
  const completed = evaluateComplete(counts, {
    ...ctx, redFives, closed: true, tsumo: true,
    // Тот же дефолт, что в bestCompletion (potential.js): рука по умолчанию
    // считается с риичи, поэтому готовая рука получает +1 хан риичи.
    riichi: true,
  }, declaredKans);
  const tier = tierOfHan(completed.han);
  const state = BASE_TABLE.rows.length - 1;
  const base = basePoints(state, tier.index);
  const breakdown = [baseRow(state, tier, base)];
  if (RULES.completeBonus > 0) {
    breakdown.push({ label: 'Готовая рука', points: RULES.completeBonus, potential: true });
  }
  breakdown.push(structureRow(part));
  breakdown.push(...yakuRows(counts, { ...ctx, redFives }));
  const completeDoras = countHandDoras(counts, ctx, redFives, declaredKans);
  const completeDoraRow = doraRow(completeDoras);
  if (completeDoraRow) breakdown.push(completeDoraRow);
  return {
    total: breakdown.reduce((sum, row) => sum + row.points, 0),
    breakdown, display, shanten: -1, potential: completed, complete: true,
    tier, state, base,
  };
}

/** Главная оценка руки из 13 тайлов после сброса.
 *  Итог = база (состояние × тир) + структуры + яку, все числа из config/scoring.json. */
export function evaluateHand(tiles, ctx = {}, declaredKans = []) {
  const counts = handToCounts(tiles);
  const redFives = tiles.filter((tile) => tile[0] === '0');
  const scoringCtx = { ...ctx, redFives };
  // Объявленный кан — фиксированный мелд: его тайлы не участвуют в поиске
  // шантена (их нельзя разломать или сбросить), а в структуре — это
  // блок «Кан» (5500), а не «Пон» (125).
  const kanKinds = kanKindsOf(declaredKans);
  const shanten = calcShanten(counts, declaredKans);
  const partition = partitionDisplay(counts, kanKinds);
  const { part } = partition;
  const display = keepRedFives(partition.display, tiles);

  const potential = analyzePotential(counts, shanten, scoringCtx, declaredKans);
  const tier = tierOfHan(potential.han);
  const state = shanten >= 0 && shanten <= 2 ? 2 - shanten : 3;
  const base = state <= 2 ? basePoints(state, tier.index) : 0;

  const breakdown = [];
  if (state <= 2) breakdown.push(baseRow(state, tier, base));
  breakdown.push(structureRow(part));
  breakdown.push(...yakuRows(counts, scoringCtx));
  const handDoras = countHandDoras(counts, ctx, redFives, declaredKans);
  const handDoraRow = doraRow(handDoras);
  if (handDoraRow) breakdown.push(handDoraRow);

  const potentialDisplay = state <= 2 && potential.completedCounts
    ? keepRedFives(winningDisplay(potential.completedCounts, kanKinds) ?? partitionDisplay(potential.completedCounts, kanKinds).display, tiles)
    : null;

  return {
    total: breakdown.reduce((sum, row) => sum + row.points, 0),
    breakdown, display, potentialDisplay,
    potentialSummary: potential.completedCounts ? potentialDescription(potential) : null,
    shanten, state, tier, base, potential, complete: false,
  };
}