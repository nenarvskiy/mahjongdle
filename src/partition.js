import { NUM_TILES } from './tile-index.js';
import { PATTERNS, tryPattern, consume, patternScore } from './patterns.js';
import { KOKUSHI } from './shanten.js';

const cache = new Map();
const keyOf = (c) => c.join(',');

export function clearPartitionCache() { cache.clear(); }

const findPattern = (id) => PATTERNS.find((p) => p.id === id);

/**
 * Правилное разбиение готовой руки для отображения (не «лучшее по очкам»):
 *  * кокуши — 13 терминалов/хоноров + пара;
 *  * стандарт — 4 сета + пара;
 *  * чиитоицу — 7 пар.
 * Возвращает {score: 0, blocks, singles} в формате bestPartition или null,
 * если рука не готова.
 */
export function winningPartition(counts) {
  // Кокуши: 13 разных видов терминалов/хоноров + одна пара
  let kinds = 0;
  let pairKind = null;
  let kokushi = true;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!counts[i]) continue;
    if (!KOKUSHI.includes(i)) { kokushi = false; break; }
    kinds++;
    if (counts[i] >= 2) {
      if (counts[i] > 2 || pairKind !== null) { kokushi = false; break; }
      pairKind = i;
    }
  }
  if (kokushi && kinds === 13 && pairKind !== null) {
    const pairP = findPattern('pair');
    return {
      score: 0,
      blocks: pairP ? [{ pattern: pairP, base: pairKind, points: pairP.points }] : [],
      singles: KOKUSHI.filter((i) => i !== pairKind),
    };
  }

  // Стандарт: пара + 4 сета
  const pairP = findPattern('pair');
  const ponP = findPattern('pon');
  const chiP = findPattern('chi');
  for (let p = 0; p < NUM_TILES; p++) {
    if (counts[p] < 2) continue;
    const c = counts.slice();
    c[p] -= 2;
    const melds = [];
    if (takeMelds(c, 4, melds)) {
      return {
        score: 0,
        blocks: [
          ...(pairP ? [{ pattern: pairP, base: p, points: pairP.points }] : []),
          ...melds.map((m) => {
            const pattern = m.kind === 'pon' ? ponP : chiP;
            return { pattern, base: m.base, points: pattern ? pattern.points : 0 };
          }),
        ],
        singles: [],
      };
    }
  }

  // Чиитоицу: 7 пар
  const pairs = [];
  let chii = true;
  for (let i = 0; i < NUM_TILES; i++) {
    if (counts[i] === 2) pairs.push(i);
    else if (counts[i] !== 0) { chii = false; break; }
  }
  if (chii && pairs.length === 7 && pairP) {
    return {
      score: 0,
      blocks: pairs.map((i) => ({ pattern: pairP, base: i, points: pairP.points })),
      singles: [],
    };
  }
  return null;
}

/** Собирает ровно n сета (пон или чии) и возвращает их в массив melds. */
function takeMelds(c, n, melds) {
  if (n === 0) return c.every((x) => x === 0);
  let i = 0;
  while (i < NUM_TILES && !c[i]) i++;
  if (i >= NUM_TILES) return false;
  if (c[i] >= 3) {
    c[i] -= 3;
    melds.push({ kind: 'pon', base: i });
    if (takeMelds(c, n - 1, melds)) return true;
    c[i] += 3;
    melds.pop();
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    melds.push({ kind: 'chi', base: i });
    if (takeMelds(c, n - 1, melds)) return true;
    c[i]++; c[i + 1]++; c[i + 2]++;
    melds.pop();
  }
  return false;
}

export function bestPartition(counts) {
  const k = keyOf(counts);
  if (cache.has(k)) return cache.get(k);

  let first = 0;
  while (first < NUM_TILES && !counts[first]) first++;
  if (first >= NUM_TILES) {
    const empty = { score: 0, blocks: [], singles: [] };
    cache.set(k, empty);
    return empty;
  }

  // Вариант "одиночка" — гарантирует, что best существует
  let best;
  {
    const next = counts.slice(); next[first]--;
    const sub = bestPartition(next);
    best = {
      score: sub.score,
      blocks: sub.blocks,
      singles: [first, ...sub.singles],
    };
  }

  for (const p of PATTERNS) {
    if (!tryPattern(p, counts, first)) continue;
    const next = consume(counts, p, first);
    const sub = bestPartition(next);
    const pts = patternScore(p, first);
    const total = pts + sub.score;
    if (total > best.score) {
      best = {
        score: total,
        blocks: [{ pattern: p, base: first, points: pts }, ...sub.blocks],
        singles: sub.singles,
      };
    }
  }

  cache.set(k, best);
  return best;
}