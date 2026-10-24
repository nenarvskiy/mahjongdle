/**
 * Ночной пересчёт вчерашних рук (мёртвая стена, кандоры, ура-доры).
 *
 * Установленные факты (проверено на реальном скоринге):
 *  - доры и ура-доры влияют и на ГОТОВУЮ руку (evaluateCompleteHand), и на
 *    13-тайловую после сброса (evaluateHand) — через потенциальный тир базы;
 *    поэтому пересчитываются ВСЕ руки, а не только готовые;
 *  - мёртвая стена дня детерминирована dayKey: 5 тайлов-кандор + 5 тайлов-
 *    кан-ура (все 10 тайлов скрыты до полуночи — никем не видны заранее);
 *  - в полночь открываются (для ВСЕХ, по канам дня в целом):
 *    кан-доры — по одной за каждый кан дня (базовой НЕТ, макс. 4),
 *    ура-доры — 1 базовая (ура-индикатор дня) + по одной за каждый кан.
 *
 * Модуль чистый (без БД и DOM) — тесты в test/recalc.test.js.
 */
import { evaluateHand, evaluateCompleteHand } from '../src/scoring.js';
import { createDailyContext, createDeadWall } from '../src/daily-context.js';
import { openKanDoraCount, withKanPons } from '../src/kans.js';
import { tileToIndex } from '../src/tile-index.js';

/**
 * Пересчитать одну руку.
 *
 * @param {object} p
 * @param {string[]} p.hand    — исходные 14 тайлов (для готовой руки)
 * @param {string[]} p.tiles   — 13 тайлов после сброса (для неготовой)
 * @param {Array}    p.kans    — объявленные каны (самой руки)
 * @param {number}   p.oldScore— счёт на момент сдачи
 * @param {boolean}  p.complete— рука была готовой
 * @param {object}   p.ctx     — контекст дня на момент сдачи (ветра/дора/ура)
 * @param {string}   p.dayKey  — день руки (для мёртвой стены)
 * @param {number}   p.dayKanCount — СУММАРНО кано дня (все игроки): именно
 *   от него зависят открывшиеся в полночь доры; без параметра — свои каны
 * @returns {{oldScore:number,newScore:number,changed:boolean,openKanDoras:number,kanDoras:string[],uraIndicators:string[]}}
 */
export function recalcScore({
  hand, tiles, kans = [], oldScore, complete = false, ctx = {}, dayKey, dayKanCount = null,
}) {
  const old = Number.isFinite(oldScore) ? oldScore : 0;
  const key = dayKey ?? ctx.dayKey ?? '';
  const wall = createDeadWall(key);
  const kanCount = Array.isArray(kans) ? kans.length : 0;
  // Открывшиеся в полночь доры зависят от канов ДНЯ в целом (все игроки),
  // а не только от канов этой руки.
  const dayKans = Number.isFinite(dayKanCount) ? Math.max(0, dayKanCount) : kanCount;
  const openKanDoras = openKanDoraCount(dayKans);
  const kanDoras = wall.kanDora.slice(0, openKanDoras);

  // В полночь открыты: 1 базовая ура-дора (ура-индикатор дня) + по одной
  // кан-уре за каждый кан дня, и кан-доры — по одной за кан (без базовой).
  let dayUra = [];
  try {
    dayUra = createDailyContext(new Date(`${key}T12:00:00Z`)).uraIndicators ?? [];
  } catch {
    dayUra = [];
  }
  const uraIndicators = [...dayUra, ...wall.kanUra.slice(0, Math.min(4, dayKans))];
  const doraIndicators = [...(ctx.doraIndicators ?? []), ...kanDoras];
  // day_ctx на сервере хранит ветра как id (roundWindId/seatWindId), а скоринг
  // ждёт индексы — восстанавливаем, если индекса нет (иначе ветра-яку
  // тихо теряются в пересчёте).
  const scoringCtx = {
    ...ctx,
    dayKey: key,
    doraIndicators,
    uraIndicators,
    ...(ctx.roundWind == null && ctx.roundWindId ? { roundWind: tileToIndex(ctx.roundWindId) } : {}),
    ...(ctx.seatWind == null && ctx.seatWindId ? { seatWind: tileToIndex(ctx.seatWindId) } : {}),
  };

  let next = old;
  if (complete && Array.isArray(hand) && hand.length === 14) {
    // Готовая рука может включать «поны» объявленных канов (рука после
    // кана — 11 тайлов + 3×кан): каны передаются для оценки (доры ×4).
    const rescored = evaluateCompleteHand(hand, scoringCtx, kans);
    if (rescored?.total != null) next = rescored.total;
  } else if (
    Array.isArray(tiles) &&
    // 13 тайлов после сброса; с каноми — 13 − 3×каны (10 при одном кане),
    // поны канов добавляются обратно перед оценкой.
    (tiles.length === 13 || tiles.length + 3 * kanCount === 13)
  ) {
    next = evaluateHand(withKanPons(tiles, kans), scoringCtx, kans).total;
  }

  return {
    oldScore: old,
    newScore: next,
    changed: next !== old,
    openKanDoras,
    kanDoras,
    uraIndicators,
  };
}

/**
 * Пересчитать набор вчерашних рук.
 * rows — [{user_id, hand, tiles, kans, score, complete, day_ctx}], dayKey —
 * день, dayKanCount — суммарные каны дня (все игроки).
 */
export function recalcDay(rows, dayKey, dayKanCount = null) {
  return rows.map((row) => ({
    userId: row.user_id ?? row.userId,
    ...recalcScore({
      hand: row.hand,
      tiles: row.tiles,
      kans: row.kans ?? [],
      oldScore: row.score,
      complete: Boolean(row.complete),
      ctx: row.day_ctx ?? row.dayCtx ?? {},
      dayKey,
      dayKanCount,
    }),
  }));
}
