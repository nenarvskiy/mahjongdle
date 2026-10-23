import { NUM_TILES } from './tile-index.js';
import { STRUCTURES } from './config.js';

/** Структуры (блоки) v4: значения и порядок берутся из config/scoring.json.
 *  Копии обязательны: редактор структур правит points прямо в этих объектах,
 *  а объект конфига общий для всех импортёров.
 *  edge → привычные флаги перебора: notEdge (только не край) и edgeOnly (только край). */
export const PATTERNS = STRUCTURES.map((structure) => ({
  ...structure,
  notEdge: structure.edge === 'notEdge',
  edgeOnly: structure.edge === 'edgeOnly',
}));

export const DEFAULT_PATTERN_POINTS = Object.freeze(
  Object.fromEntries(PATTERNS.map((pattern) => [pattern.id, pattern.points])),
);

export function addCustomPattern({ id, label, notation, points }) {
  const digits = [...notation].map(Number);
  const first = Math.min(...digits);
  const pattern = {
    id,
    label,
    notation,
    deltas: digits.map((digit) => digit - first).sort((a, b) => a - b),
    sameSuit: true,
    points,
    custom: true,
  };
  PATTERNS.push(pattern);
  return pattern;
}

export function removeCustomPatterns() {
  for (let i = PATTERNS.length - 1; i >= 0; i--) {
    if (PATTERNS[i].custom) PATTERNS.splice(i, 1);
  }
}

/** Метка структуры. В v4 у всех структур имя статичное (base не влияет). */
export function patternLabel(p) {
  return p.label;
}

/** Очки структуры. В v4 они плоские: ни надбавок за ценные тайлы, ни штрафа за край. */
export function patternScore(p) {
  return p.points;
}

/** Совпадает ли паттерн с counts, если база — base. */
export function tryPattern(p, counts, base) {
  const maxD = Math.max(...p.deltas);
  if (base + maxD >= NUM_TILES) return false;

  if (p.sameSuit) {
    if (base >= 27) return false;
    if (Math.floor(base / 9) !== Math.floor((base + maxD) / 9)) return false;
  }

  if (p.sameSuit && base < 27) {
    const pos = base % 9;
    const minPos = pos;
    const maxPos = pos + maxD;
    if (p.notEdge && (minPos === 0 || maxPos === 8)) return false;
    if (p.edgeOnly && minPos !== 0 && maxPos !== 8) return false;
  }

  const need = {};
  for (const d of p.deltas) need[base + d] = (need[base + d] || 0) + 1;
  for (const k in need) if (counts[k] < need[k]) return false;
  return true;
}

export function consume(counts, p, base) {
  const next = counts.slice();
  for (const d of p.deltas) next[base + d]--;
  return next;
}
