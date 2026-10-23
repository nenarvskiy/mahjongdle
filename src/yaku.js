import {
  isYaochuIdx, isHonorIdx, isDragonIdx, isTerminalIdx,
  isWindIdx, suitOf,
} from './tile-index.js';
import { YAKU_BY_ID } from './yaku-list.js';
import { RULES } from './config.js';

/** Определить яку для завершённой стандартной руки.
 *  Нужен только для хана (а через хан — для тира); плоские яку v4, видимые
 *  на 13 тайлах, считает src/yaku-v4.js. */
export function detectYaku(decompose, counts, ctx = {}) {
  const yaku = [];
  const { melds, pair } = decompose;
  const closed = ctx.closed !== false;
  const allTiles = [...melds.flatMap((m) => m.tiles), ...pair];

  // Танъяо
  if (allTiles.every((t) => !isYaochuIdx(t))) yaku.push(YAKU_BY_ID.get('tanyao'));

  // Якухай
  for (const m of melds) {
    if (m.type !== 'pon' && m.type !== 'kan') continue;
    const t = m.tiles[0];
    if (isDragonIdx(t)) yaku.push(YAKU_BY_ID.get('yakuhai_dragon'));
    if (ctx.seatWind != null && t === ctx.seatWind) yaku.push(YAKU_BY_ID.get('yakuhai_seat'));
    if (ctx.roundWind != null && t === ctx.roundWind) yaku.push(YAKU_BY_ID.get('yakuhai_round'));
  }

  // Иппейко / Рянпейко
  const chiCount = new Map();
  for (const m of melds) {
    if (m.type !== 'chi') continue;
    const k = m.tiles.join(',');
    chiCount.set(k, (chiCount.get(k) || 0) + 1);
  }
  const sameChi = [...chiCount.values()].filter((v) => v >= 2).length;
  if (closed && sameChi >= 2) yaku.push(YAKU_BY_ID.get('ryanpeikou'));
  else if (closed && sameChi >= 1) yaku.push(YAKU_BY_ID.get('iipeikou'));

  // Тойтой
  if (melds.every((m) => m.type === 'pon' || m.type === 'kan')) {
    yaku.push(YAKU_BY_ID.get('toitoi'));
  }

  // Сананко / Сууанко с учётом шанпон-рона.
  if (closed) {
    let anko = melds.filter((m) => m.type === 'pon' || m.type === 'kan').length;
    // Пон, завершённый роном на шанпон, не является закрытым.
    if (!ctx.tsumo && ctx.waitType === 'shanpon') anko--;
    if (anko >= 4) yaku.push(YAKU_BY_ID.get('suuankou'));
    else if (anko >= 3) yaku.push(YAKU_BY_ID.get('sanankou'));
  }

  // Санканцу / Сууканцу
  {
    const kanCount = melds.filter((m) => m.type === 'kan').length;
    if (kanCount >= 4) yaku.push(YAKU_BY_ID.get('suukantsu'));
    else if (kanCount >= 3) yaku.push(YAKU_BY_ID.get('sankantsu'));
  }

  // Саншоку доуджун
  {
    const byStart = new Map();
    for (const m of melds) {
      if (m.type !== 'chi') continue;
      const pos = m.tiles[0] % 9;
      if (!byStart.has(pos)) byStart.set(pos, new Set());
      byStart.get(pos).add(suitOf(m.tiles[0]));
    }
    for (const [, suits] of byStart) {
      if (suits.size === 3) { yaku.push(YAKU_BY_ID.get('sanshoku_dojun')); break; }
    }
  }

  // Саншоку доко
  {
    const byPos = new Map();
    for (const m of melds) {
      if (m.type !== 'pon' && m.type !== 'kan') continue;
      const pos = m.tiles[0] % 9;
      if (!byPos.has(pos)) byPos.set(pos, new Set());
      byPos.get(pos).add(suitOf(m.tiles[0]));
    }
    for (const [, suits] of byPos) {
      if (suits.size === 3) { yaku.push(YAKU_BY_ID.get('sanshoku_doko')); break; }
    }
  }

  // Иццу
  {
    const bySuit = new Map();
    for (const m of melds) {
      if (m.type !== 'chi') continue;
      const s = suitOf(m.tiles[0]);
      if (!bySuit.has(s)) bySuit.set(s, new Set());
      bySuit.get(s).add(m.tiles[0] % 9);
    }
    for (const [, starts] of bySuit) {
      if (starts.has(0) && starts.has(3) && starts.has(6)) {
        yaku.push(YAKU_BY_ID.get('ittsu'));
        break;
      }
    }
  }

  // Шосанген / Дайсангэн
  {
    const dragonPons = melds.filter(
      (m) => (m.type === 'pon' || m.type === 'kan') && isDragonIdx(m.tiles[0]),
    ).length;
    const dragonPair = isDragonIdx(pair[0]);
    if (dragonPons === 3) yaku.push(YAKU_BY_ID.get('daisangen'));
    else if (dragonPons === 2 && dragonPair) yaku.push(YAKU_BY_ID.get('shousangen'));
  }

  // Шосууши / Дайсууши
  {
    const windPons = melds.filter(
      (m) => (m.type === 'pon' || m.type === 'kan') && isWindIdx(m.tiles[0]),
    ).length;
    const windPair = isWindIdx(pair[0]);
    if (windPons === 4) yaku.push(YAKU_BY_ID.get('daisuushii'));
    else if (windPons === 3 && windPair) yaku.push(YAKU_BY_ID.get('shousuushii'));
  }

  // Хонрото
  const allYaochu = allTiles.every((t) => isYaochuIdx(t));
  const allHonorTiles = allTiles.every((t) => isHonorIdx(t));
  if (allYaochu && !allHonorTiles) yaku.push(YAKU_BY_ID.get('honroutou'));

  // Чанта / джунчан: каждая группа и пара содержат терминал или хонор.
  {
    const groups = [...melds.map((m) => m.tiles), pair];
    const everyGroupHasYaochu = groups.every((g) => g.some((t) => isYaochuIdx(t)));
    const hasSequence = melds.some((m) => m.type === 'chi');
    if (everyGroupHasYaochu && hasSequence) {
      if (allTiles.some(isHonorIdx)) yaku.push(YAKU_BY_ID.get('chanta'));
      else yaku.push(YAKU_BY_ID.get('junchan'));
    }
  }

  // Хоницу / Чиницу
  {
    const suits = new Set();
    let hasHonor = false;
    for (const t of allTiles) {
      if (isHonorIdx(t)) hasHonor = true;
      else suits.add(suitOf(t));
    }
    if (suits.size === 1 && hasHonor) yaku.push(YAKU_BY_ID.get('honitsu'));
    if (suits.size === 1 && !hasHonor) yaku.push(YAKU_BY_ID.get('chinitsu'));
  }

  // Чинрото
  if (allTiles.every((t) => isTerminalIdx(t))) yaku.push(YAKU_BY_ID.get('chinroutou'));

  // Цууисо
  if (allHonorTiles) yaku.push(YAKU_BY_ID.get('tsuuiisou'));

  // Рюисо
  {
    const RYU = new Set([19, 20, 21, 23, 25, 32]); // 2s,3s,4s,6s,8s,gd
    if (allTiles.every((t) => RYU.has(t))) yaku.push(YAKU_BY_ID.get('ryuuiisou'));
  }

  // Чууренпото: закрытая рука одной масти 1112345678999 + любой тайл.
  if (closed && !allTiles.some(isHonorIdx)) {
    const suits = new Set(allTiles.map(suitOf));
    if (suits.size === 1) {
      const first = Math.floor(allTiles[0] / 9) * 9;
      const local = new Array(9).fill(0);
      for (const tile of allTiles) local[tile - first]++;
      const minimum = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      if (minimum.every((need, i) => local[i] >= need)) yaku.push(YAKU_BY_ID.get('chuuren'));
    }
  }

  // Пинфу: все менцены — чи, пара не ценная, ожидание — рянмен.
  if (
    closed &&
    melds.every((m) => m.type === 'chi') &&
    !isDragonIdx(pair[0]) &&
    pair[0] !== ctx.seatWind &&
    pair[0] !== ctx.roundWind &&
    ctx.waitType === 'ryanmen'
  ) {
    yaku.push(YAKU_BY_ID.get('pinfu'));
  }

  // Риичи / цумо. Хан риичи — из правил (rules.riichiHan), как в чиитоицу-пути
  // (src/evaluate.js) и в статистике (par[P_RIICHI]).
  if (closed && ctx.riichi && RULES.riichiHan > 0) {
    yaku.push({ id: 'riichi', name: 'Риичи', han: RULES.riichiHan });
  }
  if (closed && ctx.tsumo && RULES.tsumo) yaku.push(YAKU_BY_ID.get('menzen_tsumo'));

  return yaku;
}
