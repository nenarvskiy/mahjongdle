import { NUM_TILES } from './tile-index.js';
import { PATTERNS, tryPattern, consume, patternScore } from './patterns.js';

const cache = new Map();
const keyOf = (c) => c.join(',');

export function clearPartitionCache() { cache.clear(); }

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