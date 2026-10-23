import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { handToCounts, indexToTile } from '../src/tile-index.js';
import { evaluateHand } from '../src/scoring.js';
import { bestPartition } from '../src/partition.js';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(join(here, '..', 'stats', 'fixtures', 'v4_eval_cases.json'), 'utf8'),
);

/** Пересобрать счётчики структур по id из лучшего разбиения игры. */
function structureCounts(tiles) {
  const part = bestPartition(handToCounts(tiles));
  const counts = {};
  for (const block of part.blocks) {
    counts[block.pattern.id] = (counts[block.pattern.id] ?? 0) + 1;
  }
  return { counts, score: part.score };
}

/** Сериализация словаря без зависимости от порядка ключей. */
const sorted = (obj) => JSON.stringify(
  Object.keys(obj).sort().map((k) => [k, obj[k]]),
);

test(`игра (JS) совпадает со статистикой (Python) на ${cases.length} руках v4`, { timeout: 120000 }, () => {
  const mismatches = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const ctx = {
      roundWind: c.roundWind,
      seatWind: c.seatWind,
      doraIndicators: [indexToTile(c.indicator)],
      uraIndicators: c.ura == null ? [] : [indexToTile(c.ura)],
    };
    const score = evaluateHand(c.tiles, ctx);
    const expected = c.expected;
    const { counts: structCounts, score: structScore } = structureCounts(c.tiles);

    const yakuMap = {};
    for (const row of score.breakdown.filter((r) => r.yaku)) yakuMap[row.id] = row.points;

    const diff = [];
    if (score.shanten !== expected.shanten) diff.push(`shanten ${score.shanten} != ${expected.shanten}`);
    // Два хана: финальный (с урадорами — он и задаёт тир/базу) и «решение» (без урадор,
    // по нему статистика выбирает сброс).
    if (score.potential.han !== expected.hanWithUra) diff.push(`han ${score.potential.han} != ${expected.hanWithUra}`);
    if (score.potential.hanWithoutUra !== expected.han) diff.push(`hanWithoutUra ${score.potential.hanWithoutUra} != ${expected.han}`);
    if (score.state !== expected.state) diff.push(`state ${score.state} != ${expected.state}`);
    if (score.tier.index !== expected.tier) diff.push(`tier ${score.tier.index} != ${expected.tier}`);
    if (score.base !== expected.base) diff.push(`base ${score.base} != ${expected.base}`);
    if (structScore !== expected.structurePoints) diff.push(`structures ${structScore} != ${expected.structurePoints}`);
    if (sorted(structCounts) !== sorted(expected.structures)) diff.push(`structCounts ${JSON.stringify(structCounts)} != ${JSON.stringify(expected.structures)}`);
    if (sorted(yakuMap) !== sorted(expected.yaku)) diff.push(`yaku ${JSON.stringify(yakuMap)} != ${JSON.stringify(expected.yaku)}`);
    if (score.total !== expected.total) diff.push(`total ${score.total} != ${expected.total}`);

    if (diff.length) {
      mismatches.push({
        i, tiles: c.tiles.join(' '), ind: c.indicator, rw: c.roundWind, sw: c.seatWind,
        expectedTotal: expected.total, actualTotal: score.total,
        note: c.note ?? 'random', diff,
      });
    }
  }

  if (mismatches.length) {
    console.error(`\nРассогласований игра↔статистика: ${mismatches.length}`);
    for (const m of mismatches.slice(0, 15)) {
      console.error(`  [${m.i}] ${m.tiles} (дор ${m.ind} раунд ${m.rw} место ${m.sw}) [${m.note}]`);
      for (const d of m.diff) console.error(`      ${d}`);
    }
  }
  assert.equal(mismatches.length, 0, 'все руки должны совпасть побитово');
});
