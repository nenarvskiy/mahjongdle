import { HONORS } from './config.js';

export const NUM_TILES = 34;
export const SUIT_BASE = { m: 0, p: 9, s: 18 };
export const HONOR_BASE = 27;

const HONOR_INDEX = new Map(HONORS.map((h, i) => [h.id, HONOR_BASE + i]));

export function tileToIndex(id) {
  if (HONOR_INDEX.has(id)) return HONOR_INDEX.get(id);
  const n = (id[0] === '0' ? 5 : parseInt(id[0], 10)) - 1;
  return SUIT_BASE[id[1]] + n;
}

export function indexToTile(i) {
  if (i >= 27) return HONORS[i - 27].id;
  if (i < 9) return `${i + 1}m`;
  if (i < 18) return `${i - 8}p`;
  return `${i - 17}s`;
}

export function handToCounts(hand) {
  const c = new Array(NUM_TILES).fill(0);
  for (const t of hand) c[tileToIndex(t)]++;
  return c;
}

export function countsToHand(counts) {
  const hand = [];
  for (let i = 0; i < NUM_TILES; i++) {
    for (let k = 0; k < counts[i]; k++) hand.push(indexToTile(i));
  }
  return hand;
}

export const isHonorIdx = (i) => i >= 27;
export const isTerminalIdx = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8);
export const isYaochuIdx = (i) => isHonorIdx(i) || isTerminalIdx(i);
export const isDragonIdx = (i) => i >= 31;
export const isWindIdx = (i) => i >= 27 && i <= 30;
export const suitOf = (i) => (i < 9 ? 'm' : i < 18 ? 'p' : i < 27 ? 's' : 'z');
