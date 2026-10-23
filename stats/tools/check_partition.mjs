// Сверка bestPartition (v4) с Python: те же руки, те же паттерны, те же очки.
// Паттерны и цены берутся из config/scoring.json -> systems.v4.structures —
// отдельного списка здесь нет, чтобы конфиг оставался единственным источником.
//
// Запуск:
//   node stats/tools/check_partition.mjs [hands.json] [py_scores.txt]
// Первый аргумент — руки (по умолчанию stats/fixtures/hands13.json),
// второй (необязательный) — файл с очками из
//   py stats/scorestat.py --partition-check stats/fixtures/hands13.json
// тогда инструмент сам сообщит число расхождений и вернёт код 1, если они есть.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATS = resolve(HERE, '..');
const CONFIG = resolve(STATS, '..', 'config', 'scoring.json');

const NUM_TILES = 34;

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const PATTERNS = config.systems.v4.structures.list.map((s) => ({
  id: s.id,
  deltas: s.deltas,
  sameSuit: Boolean(s.sameSuit),
  notEdge: s.edge === 'notEdge',
  edgeOnly: s.edge === 'edgeOnly',
  points: s.points,
}));

function tryPattern(p, counts, base) {
  const maxD = Math.max(...p.deltas);
  if (base + maxD >= NUM_TILES) return false;
  if (p.sameSuit) {
    if (base >= 27) return false;
    if (Math.floor(base / 9) !== Math.floor((base + maxD) / 9)) return false;
  }
  if (p.sameSuit && base < 27) {
    const minPos = base % 9;
    const maxPos = minPos + maxD;
    if (p.notEdge && (minPos === 0 || maxPos === 8)) return false;
    if (p.edgeOnly && minPos !== 0 && maxPos !== 8) return false;
  }
  const need = {};
  for (const d of p.deltas) need[base + d] = (need[base + d] || 0) + 1;
  for (const k in need) if (counts[k] < need[k]) return false;
  return true;
}

function consume(counts, p, base) {
  const next = counts.slice();
  for (const d of p.deltas) next[base + d]--;
  return next;
}

const cache = new Map();

function bestPartition(counts) {
  const k = counts.join(',');
  if (cache.has(k)) return cache.get(k);
  let first = 0;
  while (first < NUM_TILES && !counts[first]) first++;
  if (first >= NUM_TILES) {
    const empty = { score: 0, blocks: [] };
    cache.set(k, empty);
    return empty;
  }
  let best;
  {
    const next = counts.slice(); next[first]--;
    const sub = bestPartition(next);
    best = { score: sub.score, blocks: sub.blocks.slice() };
  }
  for (const p of PATTERNS) {
    if (!tryPattern(p, counts, first)) continue;
    const sub = bestPartition(consume(counts, p, first));
    const total = p.points + sub.score;
    if (total > best.score) best = { score: total, blocks: [p.id, ...sub.blocks] };
  }
  cache.set(k, best);
  return best;
}

const handsPath = process.argv[2] ? resolve(process.argv[2]) : join(STATS, 'fixtures', 'hands13.json');
const hands = JSON.parse(readFileSync(handsPath, 'utf8'));
const scores = hands.map((c) => bestPartition(c).score);

if (process.argv[3]) {
  // PowerShell-перенаправление пишет UTF-16 — читаем и такой файл тоже
  const buf = readFileSync(resolve(process.argv[3]));
  const text = buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
  const expected = text.replace(/^\uFEFF/, '').trim().split(/\s+/).map(Number);
  const n = Math.min(scores.length, expected.length);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    if (scores[i] !== expected[i]) {
      bad++;
      if (bad <= 5) console.log(`РАСХОЖДЕНИЕ #${i}: js=${scores[i]} py=${expected[i]}  ${hands[i].join('')}`);
    }
  }
  console.log(`сверено с Python: ${n} рук, расхождений: ${bad}`);
  process.exitCode = bad === 0 && n === scores.length ? 0 : 1;
} else {
  process.stdout.write(scores.join('\n') + '\n');
}