/**
 * Плоские яку v4 — то, что видно в текущем составе (13 тайлов после сброса
 * или все 14 тайлов готовой руки).
 * Это точный порт stats/scorestat.py -> detect_yaku_v4: те же условия, те же id,
 * поэтому игра и статистика считают одни и те же яку (сверяется test/v4-parity.test.js).
 *
 * ГОТОВНОСТЬ РУКИ НЕ ПРОВЕРЯЕТСЯ: засчитывается само наличие структуры/свойства
 * в составе (так же, как структуры считаются по лучшему разбиению 13 тайлов).
 *
 * МУЛЬТИ-ИНСТАНСЫ (2026-10-23): ценные яку (valuable_tile, valuable_pair,
 * yakuhai_pon) считаются по ВИДАМ ценных тайлов (драконы + ветер раунда +
 * ветер игрока): 1 тайл вида = «1 ценный тайл», 2 = «пара ценных»,
 * 3–4 = «якухай (пон ценного)». Вид засчитывается ТОЛЬКО на своей самой
 * высокой ступеньке (пара дракона не даёт «1 ценный тайл», пон не даёт ни
 * «пару», ни «тайл»), а разные виды суммируются (две пары ценных = 2× «пара
 * ценных»). Очки = count × цена из конфига.
 *
 * «СИЛЬНЫЙ ЯКУ ГАСИТ ОЧЕВИДНО ВКЛЮЧЁННЫЙ СЛАБЫЙ» (2026-10-23):
 *  - рянпейко уже включает иппейко — иппейко не засчитывается;
 *  - сананко не засчитывается, если три тройки «внутри» более сильного яку:
 *    дайсанген, дайсууши, сёсууши, сансёку доккоу;
 *  - дайсанген/сёсанген, дайсууши/сёсууши, чиницу/хоницу — всегда
 *    взаимоисключительные (как и раньше).
 *
 * Очки берутся из config/scoring.json -> systems.v4.yaku; порядок вывода — как в
 * конфиге (по убыванию цены, то есть от самого дорогого к дешёвому).
 */
import { NUM_TILES, isYaochuIdx } from './tile-index.js';
import { YAKU } from './config.js';

const DRAGONS = [31, 32, 33];
const WINDS = [27, 28, 29, 30];
/** Рюисо: 2,3,4,6,8 соу (19,20,21,23,25) + зелёный дракон (32). */
const GREEN = new Set([19, 20, 21, 23, 25, 32]);

/** Сколько «иппейко» можно собрать из состава: по каждой масти и позиции —
 *  min(c[p],c[p+1],c[p+2])//2 (две одинаковые последовательности = 1 иппейко).
 *  >=1 => иппейко. (Рянпейко — другое определение, см. hasRyanpeikou.) */
function iipeikouInstances(counts) {
  let total = 0;
  for (const base of [0, 9, 18]) {
    for (let pos = 0; pos < 7; pos++) {
      const a = counts[base + pos];
      const b = counts[base + pos + 1];
      const c = counts[base + pos + 2];
      const m = Math.min(a, b, c);
      if (m >= 2) total += m >> 1;
    }
  }
  return total;
}

// Рянпейко (определение исправлено 2026-10-22): ДВА НЕПЕРЕКРЫВАЮЩИХСЯ
// иппейко — 12 тайлов: 2*A + 2*B (A, B — любые цу, могут совпадать; общий
// ранг требует 4 тайла) + пара (для 14-тайловой руки). В 13-тайловом
// составе пара не требуется. Старая формула (сумма min//2 >= 2) считала
// перекрывающиеся задвоенные последовательности (11223344 -> «123» и «234»)
// отдельными структурами и завышала шанс ряпéйко в ~73 000 раз.
const RYANPEIKOU_PAIRS = (() => {
  const shapes = [];
  for (const base of [0, 9, 18]) {
    for (let pos = 0; pos < 7; pos++) {
      shapes.push([base + pos, base + pos + 1, base + pos + 2]);
    }
  }
  const pairs = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i; j < shapes.length; j++) {
      const req = new Array(34).fill(0);
      for (const t of shapes[i]) req[t] += 2;
      for (const t of shapes[j]) req[t] += 2;
      let ok = true;
      for (let t = 0; t < 34; t++) {
        if (req[t] > 4) { ok = false; break; }
      }
      if (ok) pairs.push(req);
    }
  }
  return pairs;
})();

/** Два неперекрывающихся одинаковых цу (12 тайлов) + пара при 14 тайлах. */
function hasRyanpeikou(counts, total) {
  for (const req of RYANPEIKOU_PAIRS) {
    let ok = true;
    for (let t = 0; t < 34; t++) {
      if (counts[t] < req[t]) { ok = false; break; }
    }
    if (!ok) continue;
    if (total < 14) return true; // 13 (или меньше) тайлов: пара не нужна
    // точное вложение: 12 тайлов структуры + 2 пары => общий ранг k,
    // где req[k] <= 2 и counts[k] = req[k] + 2
    for (let t = 0; t < 34; t++) {
      if (req[t] <= 2 && counts[t] >= req[t] + 2) return true;
    }
  }
  return false;
}

/**
 * Яку v4 с ЧИСЛОМ экземпляров: {id: count} (count >= 1).
 * Большинство яку — 0/1; ценные (valuable_tile/valuable_pair/yakuhai_pon)
 * могут быть > 1 (по видам ценных тайлов).
 */
export function detectV4YakuCounts(counts, ctx = {}) {
  const roundWind = ctx.roundWind;
  const seatWind = ctx.seatWind;
  const fired = {};

  const total = counts.reduce((sum, value) => sum + value, 0);
  let yaochuTiles = 0;
  let honors = 0;
  let greenTiles = 0;
  let terminalTiles = 0;
  const suitTiles = [0, 0, 0];
  let triplets = 0;

  for (let tile = 0; tile < NUM_TILES; tile++) {
    const value = counts[tile];
    if (!value) continue;
    if (isYaochuIdx(tile)) yaochuTiles += value;
    if (tile >= 27) honors += value;
    else suitTiles[Math.floor(tile / 9)] += value;
    if (GREEN.has(tile)) greenTiles += value;
    // терминал = 1 или 9 числовой масти (хоноры терминалами не считаются)
    if (tile < 27 && (tile % 9 === 0 || tile % 9 === 8)) terminalTiles += value;
    if (value >= 3) triplets++;
  }

  const add = (id, n = 1) => { fired[id] = (fired[id] ?? 0) + n; };

  if (yaochuTiles === 0) add('tanyao');
  if (yaochuTiles === total && total > 0) add('honroutou');
  // все тайлы хоноры / только терминалы / только зелёные (готовность не важна)
  if (honors === total && total > 0) add('tsuuiisou');
  if (terminalTiles === total && total > 0) add('chinroutou');
  if (greenTiles === total && total > 0) add('ryuuiisou');

  const suitsUsed = suitTiles.filter((value) => value > 0).length;
  if (suitsUsed === 1 && honors === 0) add('chinitsu');
  else if (suitsUsed === 1 && honors > 0) add('honitsu');

  for (const base of [0, 9, 18]) {
    let complete = true;
    for (let pos = 0; pos < 9; pos++) if (!counts[base + pos]) complete = false;
    if (complete) { add('ittsu'); break; }
  }

  const iipeikou = iipeikouInstances(counts);
  const ryanpeikou = hasRyanpeikou(counts, total);
  // рянпейко уже включает иппейко — слабый яку не засчитывается (2026-10-23)
  if (ryanpeikou) add('ryanpeikou');
  else if (iipeikou >= 1) add('iipeikou');

  for (let pos = 0; pos < 7; pos++) {
    if ([0, 9, 18].every((base) => (
      counts[base + pos] > 0 && counts[base + pos + 1] > 0 && counts[base + pos + 2] > 0
    ))) {
      add('sanshoku_dojun');
      break;
    }
  }

  // сансёку доккоу — тройки одного ранга в трёх мастях (не путать с драконами!)
  let doko = false;
  for (let pos = 0; pos < 9; pos++) {
    if (counts[pos] >= 3 && counts[9 + pos] >= 3 && counts[18 + pos] >= 3) {
      doko = true;
      break;
    }
  }
  if (doko) add('sanshoku_doko');

  // Драконы: три по 3 => дайсанген (большие драконы); два по 3 + третий парой
  // => сёсанген.
  const dragons = DRAGONS.map((tile) => counts[tile]);
  const daisangen = dragons[0] >= 3 && dragons[1] >= 3 && dragons[2] >= 3;
  if (daisangen) add('daisangen');
  else if (
    (dragons[0] >= 3 && dragons[1] >= 3 && dragons[2] >= 2)
    || (dragons[0] >= 3 && dragons[2] >= 3 && dragons[1] >= 2)
    || (dragons[1] >= 3 && dragons[2] >= 3 && dragons[0] >= 2)
  ) add('shousangen');

  // Ветра: четыре по 3 => дайсууши (большие ветра); три по 3 и четвёртый парой
  // => сёсууши (малые ветра).
  let windTriplets = 0;
  let windPairs = 0;
  for (const wind of WINDS) {
    if (counts[wind] >= 3) windTriplets++;
    if (counts[wind] >= 2) windPairs++;
  }
  const daisuushi = windTriplets === 4;
  const shousuushi = !daisuushi && windTriplets === 3 && windPairs === 4;
  if (daisuushi) add('daisuushi');
  else if (shousuushi) add('shousuushi');

  // сананко — три тройки, но НЕ когда они «внутри» более сильного яку:
  // тройки дайсангена/дайсууши/сёсууши/сансёку-доккоу уже оплачены им (2026-10-23)
  if (triplets >= 3 && !daisangen && !daisuushi && !shousuushi && !doko) add('sanankou');

  // Ценные тайлы: драконы + ветер раунда + ветер игрока (могут совпадать).
  // По видам, каждый вид — только на своей самой высокой ступеньке
  // (2026-10-23): 1 = «1 ценный тайл», 2 = «пара ценных», 3–4 = «якухай».
  // Разные виды суммируются; ступеньки внутри вида не кумулируются.
  const precious = [...new Set([...DRAGONS, roundWind, seatWind])]
    .filter((tile) => Number.isInteger(tile) && tile >= 0 && tile < NUM_TILES);
  let nPon = 0;
  let nPair = 0;
  let nTile = 0;
  for (const tile of precious) {
    const n = counts[tile];
    if (n >= 3) nPon++;
    else if (n === 2) nPair++;
    else if (n === 1) nTile++;
  }
  if (nPon) add('yakuhai_pon', nPon);
  if (nPair) add('valuable_pair', nPair);
  if (nTile) add('valuable_tile', nTile);

  return fired;
}

/** Коды яку, которые видны в текущем составе (без числа экземпляров). */
export function detectV4YakuIds(counts, ctx = {}) {
  return new Set(Object.keys(detectV4YakuCounts(counts, ctx)));
}

/** Строки разбора для интерфейса: [{id, name, count, points, yaku}] в порядке
 *  конфига; points = count × цена из конфига. */
export function detectV4Yaku(counts, ctx = {}) {
  const fired = detectV4YakuCounts(counts, ctx);
  return YAKU
    .filter((yaku) => fired[yaku.id])
    .map((yaku) => ({
      id: yaku.id,
      name: yaku.label,
      count: fired[yaku.id],
      points: yaku.points * fired[yaku.id],
      yaku: true,
    }));
}
