/**
 * Ночной пересчёт вчерашних рук (мёртвая стена, кандоры, ура-доры).
 *
 * Установленные факты (проверено на реальном скоринге):
 *  - доры и ура-доры влияют и на ГОТОВУЮ руку (evaluateCompleteHand), и на
 *    13-тайловую после сброса (evaluateHand) — через потенциальный тир базы;
 *    поэтому пересчитываются ВСЕ руки, а не только готовые;
 *  - мёртвая стена дня детерминирована dayKey, ВСЕ доры дня — из стены
 *    (0.6.25): [0] дора-индикатор, [1] ура-индикатор, [2]/[4]/[6]/[8]
 *    кан-доры, [3]/[5]/[7]/[9] кан-уры (все 10 тайлов скрыты до полуночи);
 *  - в полночь открываются (для ВСЕХ, по канам дня в целом):
 *    кан-доры — по одной за каждый кан дня (базовой НЕТ, макс. 4),
 *    ура-доры — 1 базовая (ура-индикатор дня, 2-й тайл стены) + по одной за
 *    каждый кан.
 *
 * Модуль чистый (без БД и DOM) — тесты в test/recalc.test.js.
 */
import { evaluateHand, evaluateCompleteHand } from '../src/scoring.js';
import { createDailyContext, createDeadWall } from '../src/daily-context.js';
import { openKanDoraCount, withKanPons } from '../src/kans.js';
import { tileToIndex } from '../src/tile-index.js';
import { allTileIds, canonicalTileId } from '../src/tiles.js';

const ALL_TILE_IDS = allTileIds();
const RED_FIVES = new Set(['0m', '0p', '0s']);

/** Корректный id тайла: 34 канонических + красные пятёрки ('0m'/'0p'/'0s'). */
export function isValidTileId(id) {
  return typeof id === 'string' && (ALL_TILE_IDS.includes(id) || RED_FIVES.has(id));
}

/**
 * Серверный пересчёт счёта дня из tiles/hand/kans + контекста дня (аудит F2a):
 * клиентский `score` не доверяется. Дневной контекст — createDailyContext
 * БЕЗ ура-дор (они открываются только в полночный пересчёт) — та же формула,
 * что у клиента. Возвращает число очков.
 */
export function computeDayScore({ tiles, hand, kans = [], complete = false, dayKey }) {
  const ctx = createDailyContext(new Date(`${dayKey}T12:00:00Z`));
  const scoringCtx = { ...ctx, uraIndicators: [], uraTiles: [] };
  if (complete && Array.isArray(hand) && hand.length === 14) {
    const r = evaluateCompleteHand(hand, scoringCtx, kans);
    return r?.total ?? 0;
  }
  const kanCount = Array.isArray(kans) ? kans.length : 0;
  if (Array.isArray(tiles) && (tiles.length === 13 || tiles.length + 3 * kanCount === 13)) {
    return evaluateHand(withKanPons(tiles, kans), scoringCtx, kans).total;
  }
  return 0;
}

/**
 * Семантическая проверка отправки результата дня (аудит F2a): сервер больше
 * не доверяет клиенту «во всём».
 *  - все id тайлов корректны (34 + красные пятёрки);
 *  - тайлы мёртвой стены: из них в руке максимум 3 копии (одна копия каждого
 *    индикатора отложена в стену и не участвует в раздаче/доборе — модель
 *    drawHand: из 4 копий в обороте 3);
 *  - численность: после сброса tiles = 13 − 3×каны, готовая рука = 14;
 *  - готовая рука (K2): hand — ровно 14 и мультимножеством РАВНО tiles —
 *    счёт считается от tiles (выданных), произвольная «иная готовая рука»
 *    с тем же tiles отклоняется;
 *  - физический максимум: не больше 4 копий любого тайла (в обороте 4);
 *  - каны: без повторов, объявлены на 4 тайла выданной руки;
 *  - если выданная рука известна (черновик draft, 14 тайлов) — проверка
 *    мультиконтура: отправка не может содержать МЕНЬШЕ выданных тайлов;
 *    на каждый кан допускается ровно один доборный тайл (complete-рука с
 *    каноми несёт 3-й тайл кана вместо 4-го — он отложен).
 * draft — массив 14 выданных тайлов или null (рука не фиксировалась до
 * отправки — мультиконтр-проверка не применяется, остальные — да).
 * Возвращает {ok:true} или {ok:false, error}.
 */
export function validateDaySubmission({
  tiles, hand, kans = [], discarded = null, complete = false, dayKey, draft = null,
}) {
  const all = [
    ...(Array.isArray(tiles) ? tiles : []),
    ...(Array.isArray(hand) ? hand : []),
    ...(Array.isArray(kans) ? kans : []),
    ...(discarded != null ? [discarded] : []),
  ];
  for (const id of all) {
    if (!isValidTileId(id)) return { ok: false, error: 'некорректный id тайла' };
  }

  if (!Array.isArray(tiles)) return { ok: false, error: 'tiles — массив id тайлов' };
  const kCount = Array.isArray(kans) ? kans.length : 0;
  // Уникальность — по виду тайла: '0m' и '5m' — один и тот же кан.
  if (new Set(kans.map((k) => canonicalTileId(k))).size !== kCount) {
    return { ok: false, error: 'один кан нельзя объявить дважды' };
  }
  if (complete) {
    if (tiles.length !== 14) return { ok: false, error: 'готовая рука — 14 тайлов' };
    if (discarded != null) return { ok: false, error: 'у готовой руки нет сброшенного тайла' };
    // K2/M4: готовая рука — ОБЯЗАТЕЛЬНО те же 14 тайлов, что в tiles
    // (счёт считается от tiles, закреплённых черновиком). Клиент мог
    // прислать «свою» готовую руку или пустой hand — отклоняем: hand обязан
    // совпадать с tiles мультимножеством (пустой hand раньше проходил и
    // создавал нулевую строку — аудит M4).
    if (!Array.isArray(hand) || hand.length !== 14) {
      return { ok: false, error: 'hand готовой руки — 14 тайлов' };
    }
    {
      const countOf = (arr) => {
        const m = new Map();
        for (const t of arr) {
          const c = canonicalTileId(t);
          m.set(c, (m.get(c) ?? 0) + 1);
        }
        return m;
      };
      const tileCounts = countOf(tiles);
      const handCounts = countOf(hand);
      const ids = new Set([...tileCounts.keys(), ...handCounts.keys()]);
      for (const id of ids) {
        if ((tileCounts.get(id) ?? 0) !== (handCounts.get(id) ?? 0)) {
          return { ok: false, error: 'hand готовой руки не совпадает с tiles' };
        }
      }
    }
  } else {
    if (discarded == null) return { ok: false, error: 'нужен сброшенный тайл' };
    if (tiles.length + 3 * kCount !== 13) {
      return { ok: false, error: 'после сброса — 13 тайлов с учётом канов' };
    }
  }

  // Мёртвая стена дня: индикаторы (дора, ура + 10 тайлов стены) — по одной
  // копии отложенные, остальные 3 копии каждого id в обороте. Игрок физически
  // не может держать больше 3 копий такого id (раздача + доборы идут из
  // оборота), поэтому и в отправе больше 3 быть не может.
  const deadIds = new Set(createDailyContext(new Date(`${dayKey}T12:00:00Z`)).deadTiles);
  // Физические тайлы отправки: текущие 14 (tiles + сброшенный; у готовой —
  // tiles) + тайлы канов (у готовой руки 4-й тайл кана отложен — добавляем).
  const physical = [
    ...tiles,
    ...(discarded != null ? [discarded] : []),
    ...(complete ? kans : kans.flatMap((k) => [k, k, k, k])),
  ];
  const physicalCounts = new Map();
  for (const id of physical) {
    const c = canonicalTileId(id);
    physicalCounts.set(c, (physicalCounts.get(c) ?? 0) + 1);
  }
  for (const [id, n] of physicalCounts) {
    // В обороте любого тайла ровно 4 копии — больше физически невозможно
    // (K2/M2: защита от «пять копий» в черновике/отправке).
    if (n > 4) return { ok: false, error: 'слишком много копий одного тайла (максимум 4)' };
    // Из тайлов мёртвой стены одна копия каждого отложена — в руке ≤ 3.
    if (deadIds.has(id) && n > 3) return { ok: false, error: 'слишком много копий тайла мёртвой стены' };
  }

  // Мультиконтр-проверка против выданной руки (если она зафиксирована).
  // Считается по ВИДУ тайла (canonicalTileId): '0m' и '5m' — одна пятёрка.
  if (!Array.isArray(draft) || draft.length !== 14) return { ok: true };
  const countOf = (arr) => {
    const m = new Map();
    for (const t of arr) {
      const c = canonicalTileId(t);
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  };
  const draftCounts = countOf(draft);
  // Физические тайлы отправки: текущие (tiles + сброшенный) + тайлы канов —
  // у неготовой руки 4 тайла каждого кана (пон не входит в tiles), у готовой
  // 14 уже содержит пон (3 тайла), добавляем только отложенную 4-ю.
  const sent = [
    ...tiles,
    ...(discarded != null ? [discarded] : []),
    ...(complete ? kans : kans.flatMap((k) => [k, k, k, k])),
  ];
  const sentCounts = countOf(sent);
  const ids = new Set([...draftCounts.keys(), ...sentCounts.keys()]);
  let excess = 0;
  for (const id of ids) {
    const diff = (sentCounts.get(id) ?? 0) - (draftCounts.get(id) ?? 0);
    if (diff < 0) return { ok: false, error: 'рука не совпадает с выданной' };
    if (diff > 0) excess += diff;
  }
  // На каждый объявленный кан — ровно один доборный тайл из стены.
  if (excess !== kCount) return { ok: false, error: 'рука не совпадает с выданной' };
  for (const k of kans) {
    if ((draftCounts.get(canonicalTileId(k)) ?? 0) < 4) {
      return { ok: false, error: 'кан объявлен на тайлы, которых нет в руке' };
    }
  }
  return { ok: true };
}

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

  // В полночь открыты: 1 базовая ура-дора (ура-индикатор дня — 2-й тайл
  // стены, 0.6.25) + по одной кан-уре за каждый кан дня, и кан-доры —
  // по одной за кан (без базовой, тайлы 3, 5, 7, 9 стены).
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
