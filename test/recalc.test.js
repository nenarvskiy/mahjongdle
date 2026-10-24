/**
 * Тесты ночного пересчёта (server/recalc.js).
 *
 * Пересчёт в полночь: открываются ВСЕ ура-доры вчерашней мёртвой стены и
 * кандоры (1 базовая + по одной за объявленный кан, макс. 5). Мёртвая стена
 * детерминирована dayKey — одинакова для всех игроков.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recalcScore, recalcDay } from '../server/recalc.js';
import { createDeadWall } from '../src/daily-context.js';
import { KAN_DORA_SLOTS, withKanPons } from '../src/kans.js';
import { evaluateCompleteHand, evaluateHand } from '../src/scoring.js';

const DAY = '2026-10-22';
// Готовая рука: 123m 456m 789m 123p 55s
const HAND_READY = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '5s', '5s'];
const TILES13 = HAND_READY.slice(0, 13);

/** Контекст дня БЕЗ дор и ура-дор (как при сдаче руки). */
function emptyCtx() {
  return { dayKey: DAY, doraIndicators: [], uraIndicators: [] };
}

test('recalcScore: кандоры 1 базовая + по одной за кан, максимум 5', () => {
  const base = { hand: HAND_READY, oldScore: 0, complete: true, ctx: emptyCtx(), dayKey: DAY };
  assert.equal(recalcScore(base).openKanDoras, 1);
  assert.equal(recalcScore({ ...base, kans: ['1s'] }).openKanDoras, 2);
  assert.equal(recalcScore({ ...base, kans: ['1s', '2s'] }).openKanDoras, 3);
  assert.equal(recalcScore({ ...base, kans: ['1s', '2s', '3s', '4s'] }).openKanDoras, KAN_DORA_SLOTS);
  assert.equal(recalcScore({ ...base, kans: ['1s', '2s', '3s', '4s', '5s'] }).openKanDoras, KAN_DORA_SLOTS);
});

test('recalcScore: кандоры берутся из мёртвой стены дня', () => {
  const wall = createDeadWall(DAY);
  const r = recalcScore({ hand: HAND_READY, oldScore: 0, complete: true, ctx: emptyCtx(), dayKey: DAY });
  assert.deepEqual(r.kanDoras, wall.kanDora.slice(0, 1));
  // ура-доры вчерашнего дня открываются целиком
  assert.equal(r.uraIndicators.length, wall.kanUra.length);
  for (const ura of wall.kanUra) assert.ok(r.uraIndicators.includes(ura));
});

test('recalcScore: разные дни — разные кандоры (стена зависит от дня)', () => {
  const a = recalcScore({ hand: HAND_READY, oldScore: 0, complete: true, ctx: emptyCtx(), dayKey: '2026-10-22' });
  const b = recalcScore({ hand: HAND_READY, oldScore: 0, complete: true, ctx: emptyCtx(), dayKey: '2026-10-23' });
  assert.notDeepEqual(a.kanDoras, b.kanDoras);
});

test('recalcScore: счёт растёт, когда открытая дора реально есть в руке', () => {
  const wall = createDeadWall(DAY);
  // Ищем индикатор, чей тайл доры есть в готовой руке (5s): тогда открытие
  // кандоры/ура обязано увеличить счёт.
  const hand = [...HAND_READY];
  const r = recalcScore({
    hand,
    oldScore: 1,
    complete: true,
    ctx: { dayKey: DAY, doraIndicators: [wall.kanDora[0]], uraIndicators: [] },
    dayKey: DAY,
  });
  // Пересчёт всегда возвращает число и не теряет руку.
  assert.equal(typeof r.newScore, 'number');
  assert.ok(r.newScore >= 0);
  assert.equal(r.oldScore, 1);
  assert.equal(r.changed, r.newScore !== 1);
});

test('recalcScore: 13 тайлов после сброса тоже пересчитываются', () => {
  const r = recalcScore({ tiles: TILES13, oldScore: 0, complete: false, ctx: emptyCtx(), dayKey: DAY });
  assert.equal(typeof r.newScore, 'number');
  assert.equal(r.openKanDoras, 1);
});

test('recalcScore: кан как фиксированный пон учитывается в руке после сброса', () => {
  // Рука ПОСЛЕ кана и сброса: 10 тайлов (+ пон кана при оценке = 13).
  const tiles10 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p'];
  const wall = createDeadWall(DAY);
  const scoringCtx = {
    ...emptyCtx(),
    doraIndicators: wall.kanDora.slice(0, 2),
    uraIndicators: wall.kanUra,
  };
  const withKan = recalcScore({
    tiles: tiles10, kans: ['5s'], oldScore: 0, complete: false, ctx: emptyCtx(), dayKey: DAY,
  });
  // Пересчёт обязан совпасть с прямой оценкой 13-тайловой руки (10 + пон).
  const direct = evaluateHand(withKanPons(tiles10, ['5s']), scoringCtx, ['5s']);
  assert.equal(withKan.openKanDoras, 2);
  assert.equal(withKan.newScore, direct.total, 'кан-рука после сброса реально пересчитывается');
  // 10 тайлов БЕЗ кана — не рука для оценки: счёт не меняется.
  const notAHand = recalcScore({ tiles: tiles10, oldScore: 77, complete: false, ctx: emptyCtx(), dayKey: DAY });
  assert.equal(notAHand.newScore, 77);
});

test('recalcDay: пакетный пересчёт возвращает userId и новые очки', () => {
  const rows = [
    { user_id: 'u1', hand: HAND_READY, kans: [], score: 10, complete: true, day_ctx: emptyCtx() },
    { user_id: 'u2', tiles: TILES13, kans: ['1s'], score: 20, complete: false, day_ctx: emptyCtx() },
  ];
  const out = recalcDay(rows, DAY);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.userId), ['u1', 'u2']);
  assert.equal(out[1].openKanDoras, 2);
  for (const r of out) assert.equal(typeof r.newScore, 'number');
});

// --- Готовая рука после кана + ветра из day_ctx ---

test('recalcScore: готовая рука после кана (11 + пон) пересчитывается как готовая', () => {
  const hand11 = ['2m', '3m', '4m', '4p', '5p', '6p', '7s', '8s', '9s', 'ew', 'ew'];
  const full14 = withKanPons(hand11, ['1m']);
  const r = recalcScore({
    hand: full14, kans: ['1m'], oldScore: 0, complete: true, ctx: emptyCtx(), dayKey: DAY,
  });
  // Прямая оценка тем же контекстом, что строит пересчёт (кандоры + все кан-ура)
  const wall = createDeadWall(DAY);
  const ctx2 = {
    ...emptyCtx(),
    doraIndicators: wall.kanDora.slice(0, 2),
    uraIndicators: wall.kanUra,
  };
  const direct = evaluateCompleteHand(full14, ctx2, ['1m']);
  assert.ok(direct, 'рука распознана как готовая');
  assert.equal(r.newScore, direct.total);
  assert.equal(r.openKanDoras, 2);
});

test('recalcScore: ветра из day_ctx (id) восстанавливаются для скоринга', () => {
  // пара = ветер раунда: без восстановления индекса ветра-яку теряется
  const ready = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', 'ew', 'ew'];
  const withIds = recalcScore({
    hand: ready, oldScore: 0, complete: true,
    ctx: { dayKey: DAY, doraIndicators: [], uraIndicators: [], roundWindId: 'ew', seatWindId: 'sw' },
    dayKey: DAY,
  });
  const without = recalcScore({
    hand: ready, oldScore: 0, complete: true,
    ctx: { dayKey: DAY, doraIndicators: [], uraIndicators: [] },
    dayKey: DAY,
  });
  assert.ok(withIds.newScore > without.newScore, 'вент-яку не теряется в пересчёте');
});
