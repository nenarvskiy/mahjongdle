import test from 'node:test';
import assert from 'node:assert/strict';

import { handToCounts } from '../src/tile-index.js';
import { allDecompositions } from '../src/decompose.js';
import { evaluateComplete } from '../src/evaluate.js';
import { evaluateCompleteHand, evaluateHand, valueTier } from '../src/scoring.js';
import { withKanPons } from '../src/kans.js';
import { detectV4Yaku, detectV4YakuCounts, detectV4YakuIds } from '../src/yaku-v4.js';
import { PATTERNS, addCustomPattern } from '../src/patterns.js';
import { bestPartition, clearPartitionCache } from '../src/partition.js';
import { parseStructureNotation } from '../src/structure-editor.js';
import { buildWall, tileDisplayName } from '../src/tiles.js';
import { countDora, createDailyContext, doraFromIndicator } from '../src/daily-context.js';
import {
  BASE_TABLE, RULES, STRUCTURES, TIERS, YAKU, basePoints,
} from '../src/config.js';
import { tierIndexForHan, tierOfHan } from '../src/tiers.js';

const hand = (notation) => notation.trim().split(/\s+/);
const stateRow = (score) => score.breakdown.find((row) => row.label.startsWith('База:'));
const structureRow = (score) => score.breakdown.find((row) => row.label === 'Структура');
const yakuPoints = (score) => score.breakdown
  .filter((row) => row.yaku || row.dora).reduce((sum, row) => sum + row.points, 0);

test('structure prices come from the config and keep the design order', () => {
  assert.deepEqual(
    PATTERNS.map((pattern) => pattern.id),
    STRUCTURES.map((structure) => structure.id),
  );
  const points = Object.fromEntries(PATTERNS.map((pattern) => [pattern.id, pattern.points]));
  for (const structure of STRUCTURES) assert.equal(points[structure.id], structure.points);
  assert.ok(points.pon > points.chi);
  assert.ok(points.ryanmen > points.kanchan);
  assert.ok(points.kanchan > points.penchan);
  assert.ok(points.kan > points.pon);
  assert.ok(points.nobetan > points.chi);
});

test('tiers are cut by han only: mangan starts at five han', () => {
  assert.equal(tierIndexForHan(-1), 0);
  assert.equal(tierIndexForHan(4), 0);
  assert.equal(tierIndexForHan(5), 1);
  assert.equal(tierIndexForHan(7), 2);
  assert.equal(tierIndexForHan(10), 3);
  assert.equal(tierIndexForHan(12), 4);
  assert.equal(tierIndexForHan(13), 5);
  assert.equal(tierIndexForHan(99), 5);
  assert.equal(tierOfHan(5).label, 'Манган');
  assert.deepEqual(valueTier({ han: 5 }), { index: 1, ...TIERS[1] });
  assert.equal(RULES.fu, false);
  assert.equal(RULES.manganMinHan, 5);
});

test('four han is not mangan even with a heavy hand shape', () => {
  // 3 хан + риичи = 4 хан; в прежней модели 4 хан / 40 фу давали манган.
  const tiles = '1m 2m 3m 1p 2p 3p 1s 2s 3s 7m 7m rd rd rd';
  const four = evaluateComplete(handToCounts(hand(tiles)), { closed: true, riichi: true });
  assert.equal(four.han, 4);
  assert.equal(four.label, 'Normal');
  // одна дора (индикатор 9s -> дора 1s) доводит до 5 хан — вот здесь манган.
  const five = evaluateComplete(handToCounts(hand(tiles)), {
    closed: true, riichi: true, doraIndicators: ['9s'],
  });
  assert.equal(five.han, 5);
  assert.equal(five.label, 'Манган');
});

test('chiitoitsu keeps compatible hand-wide yaku', () => {
  // Рука только чиитоицу: в мастях нет соседних тайлов, стандартного
  // разброса не существует. Хоницу — одна масть со старшими.
  const counts = handToCounts(hand('2m 2m 4m 4m 6m 6m 8m 8m ew ew wd wd rd rd'));
  const result = evaluateComplete(counts, { closed: true, riichi: true });
  assert.ok(result.yaku.some((item) => item.name === 'Чиитоицу'));
  assert.ok(result.yaku.some((item) => item.name === 'Хоницу'));
  assert.equal(result.han, 6);
  assert.equal(result.label, 'Ханеман');
  assert.equal(result.fu, undefined, 'фу в v4 не считаются вообще');
});

test('double hand (chiitoitsu and standard) is scored by the better', () => {
  // 22334455667788m — одновременно 7 пар и 234m 234m 567m 567m + 88m.
  // Стандарт сильнее: рянпейкоу + танъяо + чиницу + риичи = 11 (санбайман),
  // чиитоицу дало бы 10 — берётся лучшее по хану.
  const counts = handToCounts(hand('2m 2m 3m 3m 4m 4m 5m 5m 6m 6m 7m 7m 8m 8m'));
  const result = evaluateComplete(counts, { closed: true, riichi: true });
  assert.equal(result.han, 11);
  assert.equal(result.label, 'Санбайман');
  assert.ok(!result.yaku.some((item) => item.name === 'Чиитоицу'));
  assert.ok(result.yaku.some((item) => item.name === 'Чиницу'));
});

test('flat yaku come from the config', () => {
  const counts = handToCounts(hand('1m 1m 2m 2m 3m 3m 4m 5m 6m rd rd rd ew'));
  const ids = detectV4YakuIds(counts);
  // без ctx ценные = только драконы: rd×3 — это «якухай (пон)»,
  // ни «пары», ни «тайла» он не даёт; ew без ветра — не ценный
  for (const id of ['iipeikou', 'honitsu', 'yakuhai_pon']) {
    assert.ok(ids.has(id), `ожидалось яку ${id}`);
  }
  assert.ok(!ids.has('valuable_pair'));
  assert.ok(!ids.has('valuable_tile'));
  const rows = detectV4Yaku(counts);
  const prices = Object.fromEntries(YAKU.map((yaku) => [yaku.id, yaku.points]));
  for (const row of rows) assert.equal(row.points, prices[row.id] * row.count);
  assert.ok(rows.every((row) => row.yaku === true));
  // порядок строк — как в конфиге, то есть от дорогого к дешёвому
  const order = rows.map((row) => YAKU.findIndex((yaku) => yaku.id === row.id));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('a hand without a tier gets the Normal tier of its state', () => {
  // 4 хан потенциала — в v4 это ещё Normal, база берётся из столбца Normal.
  const score = evaluateHand(
    hand('1m 2m 3m 1p 2p 1s 2s 7m rd rd rd 5m 5p'),
    { roundWind: 27, seatWind: 29 },
  );
  assert.equal(score.shanten, 2);
  assert.equal(score.potential.han, 4);
  assert.equal(score.tier.label, 'Normal');
  assert.equal(score.base, basePoints(0, 0));
  assert.equal(stateRow(score).points, score.base);
  assert.ok(yakuPoints(score) > 0, 'плоские яку видны и без базы');

  // Дальше 2-сянтэна базы нет вовсе, но структуры и яку всё равно считаются.
  const far = evaluateHand(hand('1m 2m 4m 6m 8m 1p 3p 5p 7p 9p 2s 4s 6s'));
  assert.ok(far.shanten > 2);
  assert.equal(far.base, 0);
  assert.ok(!stateRow(far));
  assert.equal(far.total, structureRow(far).points + yakuPoints(far));
});

test('state row shows base of the config table for the reached tier', () => {
  const yakumanTenpai = evaluateHand(hand('1m 1m 1m 2m 3m 4m 5m 6m 7m 8m 9m 9m 9m'));
  assert.equal(yakumanTenpai.shanten, 0);
  assert.equal(yakumanTenpai.tier.label, 'Якуман');
  assert.equal(yakumanTenpai.potential.han, 13);
  assert.equal(yakumanTenpai.base, BASE_TABLE.values[2][5]);
  assert.equal(stateRow(yakumanTenpai).points, BASE_TABLE.values[2][5]);

  const manganTenpai = evaluateHand(hand('1m 2m 3m 1p 2p 3p 1s 2s 3s 7m rd rd rd'));
  assert.equal(manganTenpai.base, basePoints(2 - manganTenpai.shanten, manganTenpai.tier.index));
  assert.ok(manganTenpai.base < yakumanTenpai.base);
});

test('total is exactly base + structures + flat yaku', () => {
  for (const tiles of [
    '1m 2m 3m 1p 2p 1s 2s 7m rd rd rd 5m 5p',
    '1m 1m 2m 2m 3m 3m 4m 5m 6m rd rd rd ew',
    '1m 9m 1p 9p 1s 9s ew sw ww nw wd gd 5m',
  ]) {
    const score = evaluateHand(hand(tiles));
    assert.equal(score.total, score.base + structureRow(score).points + yakuPoints(score));
  }
});

test('dora raise the tier AND give their own points 2^(n-1)*100', () => {
  const tiles = hand('1m 2m 3m 1p 2p 3p 1s 2s 3s 7m rd rd rd');
  const plain = evaluateHand(tiles);
  const withDora = evaluateHand(tiles, { doraIndicators: ['6m'] });
  // хан и тир — как раньше
  assert.equal(withDora.potential.han, plain.potential.han + 2);
  assert.ok(withDora.potential.yaku.some((item) => item.id === 'dora' && item.han === 2));
  assert.match(withDora.potentialSummary, /Дора ×2/);
  // плюс отдельная строка очков за доры
  const doraLine = withDora.breakdown.find((row) => row.dora);
  assert.ok(doraLine, 'строка дор должна быть в разбивке');
  const n = Number(/×\s*(\d+)/.exec(doraLine.label)[1]);
  assert.ok(n >= 1);
  assert.equal(doraLine.points, 2 ** (n - 1) * 100);
  assert.ok(!plain.breakdown.some((row) => row.dora), 'без дор строки нет');

  const red = evaluateHand(hand('3m 4m 0m 1p 2p 3p 1s 2s 3s 7m rd rd rd'));
  assert.ok(red.potential.yaku.some((item) => item.id === 'aka_dora' && item.han === 1));
  const redLine = red.breakdown.find((row) => row.dora);
  assert.ok(redLine, 'красная пятёрка даёт строку дор');
  assert.equal(redLine.points, 100);
  assert.equal(countDora(handToCounts(['5m', '5m', '1p']), ['4m']), 2);
});

test('a complete starting hand gets the "Готовая рука" base row of its tier', () => {
  const result = evaluateCompleteHand(hand('1m 2m 3m 1p 2p 3p 1s 2s 3s 7s 8s 9s 7m 7m'));
  assert.equal(result.complete, true);
  assert.equal(result.shanten, -1);
  const completeState = BASE_TABLE.rows.length - 1;
  assert.equal(result.state, completeState);
  assert.equal(result.base, basePoints(completeState, tierIndexForHan(result.potential.han)));
  assert.equal(result.base, BASE_TABLE.values[completeState][0]); // 0 хан -> Normal
  assert.ok(!result.breakdown.some((row) => row.label === 'Готовая рука'));
  assert.equal(
    result.total,
    result.base + structureRow(result).points + yakuPoints(result),
  );
  assert.equal(result.display.flatMap((group) => group.tiles).length, 14);
});

test('custom structure notation is validated and participates in partitioning', () => {
  assert.equal(parseStructureNotation(' 135 '), '135');
  assert.throws(() => parseStructureNotation('531'), /возрастанию/);
  assert.throws(() => parseStructureNotation('10'), /от 1 до 9/);

  const custom = addCustomPattern({
    id: 'custom-test-13', label: 'Тестовая форма 13', notation: '13', points: 99,
  });
  clearPartitionCache();
  try {
    const result = bestPartition(handToCounts(hand('1m 3m')));
    assert.equal(result.score, 99);
    assert.equal(result.blocks[0].pattern.id, custom.id);
  } finally {
    PATTERNS.splice(PATTERNS.indexOf(custom), 1);
    clearPartitionCache();
  }
});

test('all standard decompositions are retained', () => {
  const counts = handToCounts(hand('1m 1m 2m 2m 3m 3m 4m 4m 5m 5m 6m 6m 7m 7m'));
  assert.ok(allDecompositions(counts).length > 1);
});

test('daily winds are stable, round wind rotates and dora wraps correctly', () => {
  const today = createDailyContext(new Date('2026-09-29T00:00:00Z'));
  const sameDay = createDailyContext(new Date('2026-09-29T20:59:59Z'));
  const tomorrow = createDailyContext(new Date('2026-09-29T21:00:00Z'));
  assert.deepEqual(today, sameDay);
  assert.notEqual(today.roundWindId, tomorrow.roundWindId);
  assert.ok(['ew', 'sw', 'ww', 'nw'].includes(today.seatWindId));
  assert.equal(doraFromIndicator('9m'), '1m');
  assert.equal(doraFromIndicator('nw'), 'ew');
  assert.equal(doraFromIndicator('rd'), 'wd');
  assert.ok(Number.isInteger(today.roundWind) && Number.isInteger(today.seatWind));
});

test('valuable tiles are counted exactly like the statistics do', () => {
  // пон ветер раунда = только «якухай (пон ценного)» — ни «пара», ни «тайл»
  // (2026-10-23: ступеньки внутри вида не кумулируются)
  const counts = handToCounts(hand('ew ew ew 1m 1m 2m 3m 4m 5m 6m 7m 8m 9m'));
  const c = detectV4YakuCounts(counts, { roundWind: 27, seatWind: 29 });
  assert.equal(c.yakuhai_pon, 1);
  assert.ok(!('valuable_pair' in c));
  assert.ok(!('valuable_tile' in c));
  // без ценных тайлов в составе остаются только общие яку
  const plain = detectV4YakuIds(handToCounts(hand('2m 3m 4m 5m 6m 7m 2p 3p 4p 5p 6p 7p 8p')));
  assert.ok(!plain.has('valuable_tile'));
  assert.ok(!plain.has('valuable_pair'));
  assert.ok(plain.has('tanyao'));
});

test('valuable yaku are counted per kind, not stacked (2026-10-23)', () => {
  // две пары ценных (ветер раунда + ветер места) = 2 × «пара ценных»
  const two = detectV4YakuCounts(
    handToCounts(hand('ew ew sw sw 1m 2m 3m 4p 5p 6p 7s 8s 9s')),
    { roundWind: 27, seatWind: 28 },
  );
  assert.equal(two.valuable_pair, 2);
  assert.ok(!('valuable_tile' in two));
  assert.ok(!('yakuhai_pon' in two));
  const rows = detectV4Yaku(
    handToCounts(hand('ew ew sw sw 1m 2m 3m 4p 5p 6p 7s 8s 9s')),
    { roundWind: 27, seatWind: 28 },
  );
  const vp = rows.find((row) => row.id === 'valuable_pair');
  assert.equal(vp.count, 2);
  assert.equal(vp.points, 120); // 2 × 60

  // два дракона по 3 + третий дракон парой = 2 × «якухай» + «пара ценных»
  // (пара сёсангена — отдельный вид, она и есть «пара ценных»)
  const pon2 = detectV4YakuCounts(
    handToCounts(hand('wd wd wd gd gd gd rd rd 1m 2m 3m 4p 5p')),
    { roundWind: 27, seatWind: 29 },
  );
  assert.equal(pon2.yakuhai_pon, 2);
  assert.equal(pon2.valuable_pair, 1);
  assert.ok(!('valuable_tile' in pon2));
  assert.equal(pon2.shousangen, 1);

  // смешанно: пон + пара + одиночка трёх разных видов
  const mix = detectV4YakuCounts(
    handToCounts(hand('wd wd wd gd gd rd 1m 2m 3m 4p 5p 6p 7s')),
    { roundWind: 27, seatWind: 29 },
  );
  assert.equal(mix.yakuhai_pon, 1);
  assert.equal(mix.valuable_pair, 1);
  assert.equal(mix.valuable_tile, 1);

  // ветер раунда == ветра места: один вид, двойной счёт не возникает
  const same = detectV4YakuCounts(
    handToCounts(hand('ew ew 1m 2m 3m 4p 5p 6p 7s 8s 9s 5m 5m')),
    { roundWind: 27, seatWind: 27 },
  );
  assert.equal(same.valuable_pair, 1);
});

test('a strong yaku cancels the obviously contained weaker one (2026-10-23)', () => {
  // рянпейко уже иппейко — иппейко не засчитывается
  const ry = detectV4YakuIds(handToCounts(hand('1m 1m 2m 2m 3m 3m 4p 4p 5p 5p 6p 6p 9s')));
  assert.ok(ry.has('ryanpeikou'));
  assert.ok(!ry.has('iipeikou'));

  // дайсанген уже сананко (три тройки)
  const ds = detectV4YakuIds(handToCounts(hand('wd wd wd gd gd gd rd rd rd 1m 2m 3m 9p')));
  assert.ok(ds.has('daisangen'));
  assert.ok(!ds.has('sanankou'));

  // дайсууши уже сананко
  const du = detectV4YakuIds(handToCounts(hand('ew ew ew sw sw sw ww ww ww nw nw nw 1m')));
  assert.ok(du.has('daisuushi'));
  assert.ok(!du.has('sanankou'));

  // сёсууши уже сананко (три ветра по 3)
  const ss2 = detectV4YakuIds(
    handToCounts(hand('ew ew ew sw sw sw ww ww ww nw nw 1m 2m')),
    { roundWind: 27, seatWind: 29 },
  );
  assert.ok(ss2.has('shousuushi'));
  assert.ok(!ss2.has('sanankou'));

  // сансёку доккоу уже сананко
  const sd = detectV4YakuIds(handToCounts(hand('1m 1m 1m 1p 1p 1p 1s 1s 1s 5m 6m 7m 9p')));
  assert.ok(sd.has('sanshoku_doko'));
  assert.ok(!sd.has('sanankou'));

  // без сильного яку — сананко засчитывается (три тройки, одна из них ценный пон)
  const plain = detectV4YakuIds(handToCounts(hand('wd wd wd 2m 2m 2m 3p 3p 3p 7s 8s 9s 5m')));
  assert.ok(plain.has('sanankou'));
  assert.ok(plain.has('yakuhai_pon'));
});

test('the wall has one red five per suit and red fives behave as normal fives', () => {
  const wall = buildWall();
  for (const suit of ['m', 'p', 's']) {
    assert.equal(wall.filter((tile) => tile === `0${suit}`).length, 1);
    assert.equal(wall.filter((tile) => tile === `5${suit}`).length, 3);
  }
  assert.match(tileDisplayName('0m'), /Красная 5/);
});

test('deterministic random hands preserve scoring invariants', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const wall = buildWall();

  for (let sample = 0; sample < 50; sample++) {
    const shuffled = wall.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const score = evaluateHand(shuffled.slice(0, 13), {
      roundWind: 27, seatWind: 28, doraIndicators: ['4m'],
    });
    assert.equal(score.total, score.breakdown.reduce((sum, row) => sum + row.points, 0));
    assert.equal(score.total, score.base + structureRow(score).points + yakuPoints(score));
    assert.ok(score.breakdown.every((row) => Number.isFinite(row.points) && row.points >= 0));
    assert.ok(score.breakdown.every((row) => !/фу/.test(row.label)));
    assert.equal(score.base, score.state <= 2 ? basePoints(score.state, score.tier.index) : 0);
    assert.equal(score.tier.index, tierIndexForHan(score.potential.han));

    const copies = new Map();
    for (const tile of shuffled.slice(0, 13)) copies.set(tile, (copies.get(tile) ?? 0) + 1);
    assert.ok([...copies.values()].every((count) => count <= 4));
  }
});
// --- Кан как кан: 4-й тайл кан-дора в готовой руке ---

test('complete hand with kan: четвёртый тайл кана считается дорой, кан = блок 5500', () => {
  const ctx = { roundWind: 27, seatWind: 27, doraIndicators: ['9m'], uraIndicators: [] };
  // кан 1m + 234m + 456p + 789s + пара ew (11 тайлов)
  const hand11 = ['2m', '3m', '4m', '4p', '5p', '6p', '7s', '8s', '9s', 'ew', 'ew'];
  const full14 = withKanPons(hand11, ['1m']);
  const withKan = evaluateCompleteHand(full14, ctx, ['1m']);
  const withoutKan = evaluateCompleteHand(full14, ctx);
  assert.ok(withKan, 'рука готова с каном');
  assert.ok(withoutKan, 'та же рука готова и без аргумента кана (пон = 4-й сет)');
  // Структура: с аргументом кана тайлы кана — блок «Кан» (5500) и не
  // участвуют в поиске лучших форм остальной руки.
  const kanBlocks = withKan.breakdown.find((r) => r.label === 'Структура').blocks.filter((b) => b.label === 'Кан');
  assert.equal(kanBlocks.length, 1, 'в структуре ровно один блок «Кан»');
  assert.equal(kanBlocks[0].points, 5500);
  // F4: 4-й тайл кана идёт в доры → с каном 4 доры (хан: риичи 1 + дора 4 = 5,
  // манган, база 56 000 000), без — 3 (4 хана, Normal, база 5 400 000).
  assert.equal(withKan.potential.han, 5, 'с каном — 4 доры-хана');
  assert.equal(withKan.tier.label, 'Манган');
  assert.equal(withKan.base, 56000000);
  assert.equal(withoutKan.potential.han, 4);
  assert.equal(withoutKan.tier.label, 'Normal');
  // Структура с каном 5665 (без — 715), дора-строка 800 (без — 400),
  // пара ценных 60: разница = 56 006 525 − 5 401 175.
  assert.equal(withKan.total - withoutKan.total, 50605350);
});

test('complete hand with kan: красная пятёрка в кане — дора за 4-й тайл (F4)', () => {
  const ctx = { roundWind: 27, seatWind: 27, doraIndicators: ['9m'], uraIndicators: [] };
  // Пон пятёрок; остальное — саншоку доуджун (234m, 234p, 234s) + пара 9p.
  const base14 = ['2m', '3m', '4m', '2p', '3p', '4p', '2s', '3s', '4s', '9p', '9p'];
  // Красная — отложенный 4-й тайл кана (в 14-форме её нет), кан объявлен красным id:
  const redKan = evaluateCompleteHand(['5m', '5m', '5m', ...base14], ctx, ['0m']);
  const plainKan = evaluateCompleteHand(['5m', '5m', '5m', ...base14], ctx, ['5m']);
  assert.ok(redKan && plainKan);
  const akaRed = redKan.potential.yaku.find((y) => y.id === 'aka_dora');
  assert.ok(akaRed, 'красная дора за 4-й тайл кана');
  assert.equal(akaRed.han, 1, 'ровно одна (красная в стене одна)');
  assert.equal(redKan.potential.han, plainKan.potential.han + 1);
  // Красная в пон (в 14-форме) + красный id кана — без двойного счёта:
  const redInPon = evaluateCompleteHand(['0m', '5m', '5m', ...base14], ctx, ['0m']);
  const akaPon = redInPon.potential.yaku.find((y) => y.id === 'aka_dora');
  assert.equal(akaPon.han, 1, 'красная в пон не считается дважды');
  assert.equal(redInPon.potential.han, redKan.potential.han);
});

test('complete hand with kan: в отображении кан показывается блоком из 4 тайлов', () => {
  const ctx = { roundWind: 27, seatWind: 27, doraIndicators: [], uraIndicators: [] };
  const hand11 = ['2m', '3m', '4m', '4p', '5p', '6p', '7s', '8s', '9s', 'ew', 'ew'];
  const full14 = withKanPons(hand11, ['1m']);
  const withKan = evaluateCompleteHand(full14, ctx, ['1m']);
  const kanGroup = withKan.display.find((g) => g.label === 'Кан');
  assert.ok(kanGroup, 'в правилном отображении есть группа «Кан»');
  assert.deepEqual(kanGroup.tiles, ['1m', '1m', '1m', '1m']);
});
