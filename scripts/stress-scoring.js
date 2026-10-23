/**
 * Стресс-прогон скоринга v4: раздача -> все 14 вариантов сброса -> инварианты.
 * Запускается как npm run test:stress (SAMPLES=... для числа рук).
 */
import assert from 'node:assert/strict';

import { BASE_TABLE, basePoints } from '../src/config.js';
import { evaluateCompleteHand, evaluateHand } from '../src/scoring.js';
import { tierIndexForHan } from '../src/tiers.js';
import { buildWall } from '../src/tiles.js';
import { createDailyContext } from '../src/daily-context.js';

const samples = Number(process.env.SAMPLES ?? 100);
const context = createDailyContext(new Date('2026-09-29T12:00:00Z'));
let seed = 0x5eedc0de;
const random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const baseWall = buildWall();
const distribution = { complete: 0, tenpai: 0, ishanten: 0, twoShanten: 0, other: 0 };
const tierCounts = BASE_TABLE.cols.map(() => 0);
let evaluations = 0;
let totalSum = 0;
const started = performance.now();

for (let sample = 0; sample < samples; sample++) {
  const wall = baseWall.slice();
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const dealt = wall.slice(0, 14);
  if (evaluateCompleteHand(dealt, context)) distribution.complete++;

  for (let discard = 0; discard < dealt.length; discard++) {
    const tiles = dealt.filter((_, index) => index !== discard);
    const score = evaluateHand(tiles, context);
    evaluations++;
    totalSum += score.total;

    const structure = score.breakdown.find((row) => row.label === 'Структура');
    const yaku = score.breakdown.filter((row) => row.yaku).reduce((sum, row) => sum + row.points, 0);

    assert.equal(score.total, score.breakdown.reduce((sum, row) => sum + row.points, 0));
    assert.equal(score.total, score.base + structure.points + yaku, 'итог = база + структуры + яку');
    assert.ok(score.breakdown.every((row) => Number.isFinite(row.points) && row.points >= 0));
    assert.ok(score.breakdown.every((row) => !/фу/.test(row.label)), 'фу в v4 нет');
    assert.equal(score.tier.index, tierIndexForHan(score.potential.han));
    assert.equal(score.base,
      score.state <= 2 ? basePoints(score.state, score.tier.index) : 0);

    if (score.shanten === 0) distribution.tenpai++;
    else if (score.shanten === 1) distribution.ishanten++;
    else if (score.shanten === 2) distribution.twoShanten++;
    else distribution.other++;
    if (score.state <= 2) tierCounts[score.tier.index]++;
  }
}

console.log(JSON.stringify({
  samples, evaluations, distribution, tierCounts, tierLabels: BASE_TABLE.cols,
  meanScore: Math.round(totalSum / evaluations * 1000) / 1000,
  elapsedMs: Math.round(performance.now() - started),
}, null, 2));
