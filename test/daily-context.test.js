/**
 * Тесты контекста дня (src/daily-context.js).
 *
 * Схема 0.6.25: ВСЕ доры дня берутся из мёртвой стены (10 тайлов,
 * детерминирована dayKey, одинакова для всех игроков):
 *   [0] дора-индикатор, [1] ура-индикатор,
 *   [2] кан-дора 1, [3] кан-ура 1, [4] кан-дора 2, [5] кан-ура 2,
 *   [6] кан-дора 3, [7] кан-ура 3, [8] кан-дора 4, [9] кан-ура 4.
 * Один тайл каждого вида стены отложен (в раздачу не попадает).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDailyContext, createDeadWall, doraFromIndicator,
} from '../src/daily-context.js';
import { allTileIds } from '../src/tiles.js';
import { RULES } from '../src/config.js';

const DAY = '2026-10-26';
const ctx = createDailyContext(new Date(`${DAY}T12:00:00Z`));
const wall = ctx.deadWall;

test('стена: 10 разных тайлов, детерминирована по dayKey', () => {
  assert.equal(wall.tiles.length, 10);
  assert.equal(new Set(wall.tiles).size, 10, 'тайлы стены не повторяются');
  for (const tile of wall.tiles) {
    assert.ok(allTileIds().includes(tile), `${tile} — тайл из 134`);
  }
  const again = createDeadWall(DAY);
  assert.deepEqual(again, wall, 'один день — одна стена');
  const other = createDeadWall('2026-10-27');
  assert.notDeepEqual(other.tiles, wall.tiles, 'другой день — другая стена');
});

test('все доры дня — члены стены (позиции по схеме 0.6.25)', () => {
  assert.equal(wall.doraIndicator, wall.tiles[0], 'дора-индикатор — 1-й тайл');
  assert.equal(wall.uraIndicator, wall.tiles[1], 'ура-индикатор — 2-й тайл');
  assert.deepEqual(wall.kanDora, [wall.tiles[2], wall.tiles[4], wall.tiles[6], wall.tiles[8]]);
  assert.deepEqual(wall.kanUra, [wall.tiles[3], wall.tiles[5], wall.tiles[7], wall.tiles[9]]);
  const allDora = [wall.doraIndicator, wall.uraIndicator, ...wall.kanDora, ...wall.kanUra];
  for (const tile of allDora) {
    assert.ok(wall.tiles.includes(tile), `${tile} лежит в стене`);
  }
});

test('контекст: индикаторы выведены из стены, не независимый хэш', () => {
  assert.deepEqual(ctx.doraIndicators, [wall.tiles[0]]);
  if (RULES.uraDora) {
    assert.deepEqual(ctx.uraIndicators, [wall.tiles[1]]);
  } else {
    assert.deepEqual(ctx.uraIndicators, []);
  }
  assert.deepEqual(ctx.doraTiles, [doraFromIndicator(wall.tiles[0])]);
  assert.deepEqual(ctx.uraTiles, ctx.uraIndicators.map(doraFromIndicator));
});

test('мёртвые тайлы = ровно 10 тайлов стены (копии в добор не попадают)', () => {
  assert.deepEqual(ctx.deadTiles, wall.tiles);
  assert.equal(ctx.deadTiles.length, 10);
});

test('ветра дня сохраняются при новой схеме', () => {
  assert.ok(['ew', 'sw', 'ww', 'nw'].includes(ctx.roundWindId));
  assert.ok(['ew', 'sw', 'ww', 'nw'].includes(ctx.seatWindId));
  assert.equal(ctx.dayKey, DAY);
});
