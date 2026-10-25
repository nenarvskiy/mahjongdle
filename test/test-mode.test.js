/**
 * Тесты тестового режима: парсер тайлов, валидация рук, тестовый контекст
 * (тот же формат, что у «руки дня» — поэтому скоринг идентичен).
 * initTestMode не проверяем здесь (это DOM-обвязка), считаем чистую логику.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHandTokens,
  validateHandTiles,
  buildTestContext,
  randomTestContext,
} from '../src/test-mode.js';
import { evaluateHand, evaluateCompleteHand } from '../src/scoring.js';
import { tileToIndex } from '../src/tile-index.js';

test('parseHandTokens: цифры, хоноры, красные пятёрки, мусор → ошибка', () => {
  const ok = parseHandTokens('1m 2m 3m 1p 2p 3p 1s 2s 3s 4s 5s 9s rd rd');
  assert.equal(ok.error, undefined);
  assert.equal(ok.tiles.length, 14);

  const reds = parseHandTokens('0m,0p;0s 5m 5p 5s');
  assert.deepEqual(reds.tiles, ['0m', '0p', '0s', '5m', '5p', '5s']);

  const honors = parseHandTokens('EW sw WW nw wd GD RD');
  assert.deepEqual(honors.tiles, ['ew', 'sw', 'ww', 'nw', 'wd', 'gd', 'rd']);

  const bad = parseHandTokens('1m 2x 3m');
  assert.match(bad.error, /2x/);
  const empty = parseHandTokens('');
  assert.equal(empty.tiles.length, 0);
});

test('validateHandTiles: 13/14, ≤4 копии вида, ≤1 красная на масть', () => {
  const base13 = '1m 2m 3m 1p 2p 3p 1s 2s 3s 4s 5s 9s rd'.split(' ');
  assert.equal(validateHandTiles(base13), null);
  assert.match(validateHandTiles(base13.slice(0, 12)), /13 или 14/);
  assert.match(validateHandTiles([...base13, 'rd', 'rd', 'rd']), /13 или 14/);

  // 5 копий вида (красная + 4 обычных = 5) — не может быть в стене
  const five = ['0m', '5m', '5m', '5m', '5m', '1p', '2p', '3p', '1s', '2s', '3s', '4s', '9s'];
  assert.match(validateHandTiles(five), /копи/);

  // две красные 5m
  const twoReds = ['0m', '0m', '1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '4s', '5s', '9s'];
  assert.match(validateHandTiles(twoReds), /красн/i);
});

test('buildTestContext: формат как у createDailyContext (индексы, доры, мёртвая стена)', () => {
  const ctx = buildTestContext('sw', 'nw', '5m', 'rd');
  assert.equal(ctx.roundWind, tileToIndex('sw'));
  assert.equal(ctx.seatWind, tileToIndex('nw'));
  assert.deepEqual(ctx.doraIndicators, ['5m']);
  assert.deepEqual(ctx.uraIndicators, ['rd']);
  assert.deepEqual(ctx.doraTiles, ['6m']);
  assert.deepEqual(ctx.uraTiles, ['wd']); // драконы циклически: rd -> wd
  assert.deepEqual(ctx.deadTiles, ['5m', 'rd']);

  const noUra = buildTestContext('ew', 'ew', '9s', null);
  assert.deepEqual(noUra.uraIndicators, []);
  assert.deepEqual(noUra.uraTiles, []);
  assert.equal(noUra.deadTiles.length, 1);
});

test('F10: buildTestContext без доры — пусто, а не краш (поле доры очищено)', () => {
  const ctx = buildTestContext('ew', 'sw', null, 'rd');
  assert.deepEqual(ctx.doraIndicators, []);
  assert.deepEqual(ctx.doraTiles, []);
  assert.deepEqual(ctx.uraIndicators, ['rd']);
  assert.deepEqual(ctx.deadTiles, ['rd']);

  // скоринг с нулевыми дорами не падает и считает без дора
  const tiles = ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '4s', '5s', '9s', 'rd'];
  const score = evaluateHand(tiles, ctx);
  assert.ok(score, 'оценка есть');
  assert.ok(!score.breakdown.some((row) => /дор/i.test(row.label)), 'дор без индикатора нет');
});

test('randomTestContext: ветра — ветра, индикаторы — существующие тайлы', () => {
  for (let i = 0; i < 50; i++) {
    const ctx = randomTestContext();
    assert.ok(['ew', 'sw', 'ww', 'nw'].includes(ctx.roundWindId));
    assert.ok(['ew', 'sw', 'ww', 'nw'].includes(ctx.seatWindId));
    assert.equal(ctx.doraIndicators.length, 1);
    assert.ok(ctx.uraIndicators.length === 1);
    assert.equal(ctx.deadTiles.length, 2);
    // индексы ветров — в диапазоне хоноров (27..30)
    assert.ok(ctx.roundWind >= 27 && ctx.roundWind <= 30);
    assert.ok(ctx.seatWind >= 27 && ctx.seatWind <= 30);
  }
});

test('тестовый контекст даёт те же очки, что обычный (идентичность скоринга)', () => {
  const tiles = ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '4s', '5s', '9s', 'rd'];
  // один и тот же контекст, собранный двумя способами
  const fromTest = buildTestContext('ew', 'sw', '5m', 'rd');
  const plain = {
    dayKey: 'test',
    roundWindId: 'ew',
    seatWindId: 'sw',
    roundWind: tileToIndex('ew'),
    seatWind: tileToIndex('sw'),
    doraIndicators: ['5m'],
    uraIndicators: ['rd'],
    doraTiles: ['6m'],
    uraTiles: ['wd'],
    deadTiles: ['5m', 'rd'],
  };
  const a = evaluateHand(tiles, fromTest);
  const b = evaluateHand(tiles, plain);
  assert.equal(a.total, b.total);
  assert.deepEqual(a.breakdown, b.breakdown);

  // готовая 14-тайловая рука в тестовом контексте
  const complete = ['1m', '1m', '1m', '2m', '3m', '4m', '1p', '2p', '3p', '1s', '2s', '3s', '9s', '9s'];
  const c = evaluateCompleteHand(complete, fromTest);
  assert.ok(c, 'рука готова — оценка есть');
  assert.ok(c.total > 0);
  // и наоборот: неготовая 14-тайловая рука → null (игра попросит сбросить)
  assert.equal(evaluateCompleteHand(tiles.concat('1m'), fromTest), null);
});
