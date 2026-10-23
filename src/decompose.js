import { NUM_TILES } from './tile-index.js';

const KOKUSHI_TILES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/**
 * Разложить завершённую стандартную руку (14 тайлов) на 4 менцена + пару.
 * Возвращает первый найденный вариант.
 */
export function decomposeStandard(counts) {
  for (let p = 0; p < NUM_TILES; p++) {
    if (counts[p] < 2) continue;
    const c = counts.slice();
    c[p] -= 2;
    const melds = [];
    if (extractMelds(c, melds)) {
      return { melds, pair: [p, p] };
    }
  }
  return null;
}

/**
 * Все возможные разложения стандартной руки. Нужно, чтобы выбрать лучшее по очкам.
 */
export function allDecompositions(counts) {
  const results = [];
  for (let p = 0; p < NUM_TILES; p++) {
    if (counts[p] < 2) continue;
    const c = counts.slice();
    c[p] -= 2;
    collectMelds(c, [], (melds) => results.push({ melds, pair: [p, p] }));
  }
  return results;
}

/** Перебирает все варианты, а не только первый найденный путь. */
function collectMelds(c, melds, emit) {
  let i = 0;
  while (i < NUM_TILES && !c[i]) i++;
  if (i >= NUM_TILES) {
    emit(melds);
    return;
  }

  if (c[i] >= 3) {
    c[i] -= 3;
    collectMelds(c, [...melds, { type: 'pon', tiles: [i, i, i] }], emit);
    c[i] += 3;
  }

  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    collectMelds(c, [...melds, { type: 'chi', tiles: [i, i + 1, i + 2] }], emit);
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

function extractMelds(c, out) {
  let i = 0;
  while (i < NUM_TILES && !c[i]) i++;
  if (i >= NUM_TILES) return true;

  // Пон
  if (c[i] >= 3) {
    c[i] -= 3;
    if (extractMelds(c, out)) {
      out.unshift({ type: 'pon', tiles: [i, i, i] });
      c[i] += 3;
      return true;
    }
    c[i] += 3;
  }

  // Чи
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (extractMelds(c, out)) {
      out.unshift({ type: 'chi', tiles: [i, i + 1, i + 2] });
      c[i]++; c[i + 1]++; c[i + 2]++;
      return true;
    }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }

  return false;
}

export function isChiitoitsuComplete(counts) {
  let pairs = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    if (counts[i] === 2) pairs++;
    else if (counts[i] !== 0) return false;
  }
  return pairs === 7;
}

export function isKokushiComplete(counts) {
  let unique = 0, pair = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!KOKUSHI_TILES.includes(i) && counts[i]) return false;
    if (counts[i] >= 1) unique++;
    if (counts[i] >= 2) pair++;
  }
  return unique === 13 && pair === 1;
}
