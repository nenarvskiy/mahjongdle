/**
 * Ночной пересчёт вчерашних рук (мёртвая стена, кандоры, ура-доры).
 *
 * Установленные факты (проверено на реальном скоринге):
 *  - доры и ура-доры влияют и на ГОТОВУЮ руку (evaluateCompleteHand), и на
 *    13-тайловую после сброса (evaluateHand) — через потенциальный тир базы;
 *    поэтому пересчитываются ВСЕ руки, а не только готовые;
 *  - мёртвая стена дня детерминирована dayKey: 5 кандор + 5 их ура-тайлов;
 *  - за каждый объявленный кан открывается кандор: 1 базовая + каны, макс. 5;
 *  - в конце дня открываются ВСЕ ура-доры мёртвой стены.
 *
 * Модуль чистый (без БД и DOM) — тесты в test/recalc.test.js.
 */
import { evaluateHand, evaluateCompleteHand } from '../src/scoring.js';
import { createDeadWall } from '../src/daily-context.js';
import { openKanDoraCount, withKanPons, KAN_DORA_SLOTS } from '../src/kans.js';

/**
 * Пересчитать одну руку.
 *
 * @param {object} p
 * @param {string[]} p.hand    — исходные 14 тайлов (для готовой руки)
 * @param {string[]} p.tiles   — 13 тайлов после сброса (для неготовой)
 * @param {Array}    p.kans    — объявленные каны
 * @param {number}   p.oldScore— счёт на момент сдачи
 * @param {boolean}  p.complete— рука была готовой
 * @param {object}   p.ctx     — контекст дня на момент сдачи (ветра/дора/ура)
 * @param {string}   p.dayKey  — день руки (для мёртвой стены)
 * @returns {{oldScore:number,newScore:number,changed:boolean,openKanDoras:number,kanDoras:string[],uraIndicators:string[]}}
 */
export function recalcScore({ hand, tiles, kans = [], oldScore, complete = false, ctx = {}, dayKey }) {
  const old = Number.isFinite(oldScore) ? oldScore : 0;
  const wall = createDeadWall(dayKey ?? ctx.dayKey ?? '');
  const kanCount = Array.isArray(kans) ? kans.length : 0;
  const openKanDoras = openKanDoraCount(kanCount);
  const kanDoras = wall.kanDora.slice(0, Math.min(openKanDoras, KAN_DORA_SLOTS));

  // В конце дня открыты все ура-доры мёртвой стены + все открытые кандоры.
  const uraIndicators = [...(ctx.uraIndicators ?? []), ...wall.kanUra];
  const doraIndicators = [...(ctx.doraIndicators ?? []), ...kanDoras];
  const scoringCtx = {
    ...ctx,
    dayKey: dayKey ?? ctx.dayKey,
    doraIndicators,
    uraIndicators,
  };

  let next = old;
  if (complete && Array.isArray(hand) && hand.length === 14) {
    const rescored = evaluateCompleteHand(hand, scoringCtx);
    if (rescored?.total != null) next = rescored.total;
  } else if (Array.isArray(tiles) && tiles.length === 13) {
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
 * rows — [{user_id, hand, tiles, kans, score, complete, day_ctx}], dayKey — день.
 */
export function recalcDay(rows, dayKey) {
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
    }),
  }));
}
