// Временная симуляция для проверки вероятностей событий в руке.
// Задействует код проекта (shanten, tile-index) + локальную раздачу 14/13 тайлов.
import { handToCounts, tileToIndex, NUM_TILES } from '../../src/tile-index.js';
import { calcShanten, isWinningHand } from '../../src/shanten.js';
import { buildWall } from '../../src/tiles.js';

const SAMPLES = Number(process.env.SAMPLES ?? 2_000_000);
let seed = 0xabc12345;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

const baseWall = buildWall(); // 136 тайлов с одной красной пятёркой на масть
const shantenDist = {};
const shanten14Dist = {};
const ev = {};
const add = (name, v = 1) => { ev[name] = (ev[name] ?? 0) + v; };

const isHonor = (i) => i >= 27;
const isTerm = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8);
const isYao = (i) => isHonor(i) || isTerm(i);

// События
for (let s = 0; s < SAMPLES; s++) {
  // полный fisher-yates: равномерная 14-ка из 136
  const wall = baseWall.slice();
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const hand14 = wall.slice(0, 14);
  const counts14 = handToCounts(hand14);
  const sh14 = calcShanten(counts14);
  shanten14Dist[sh14] = (shanten14Dist[sh14] ?? 0) + 1;
  if (counts14[27] >= 2) add('ew_pair_only'); // проверка на 5.26% аналитически

  // "после лучшего сброса" — берём min shanten по всем уникальным сбросам
  let best = 8;
  const seen = new Set();
  for (const t of hand14) {
    if (seen.has(t)) continue;
    seen.add(t);
    const c = counts14.slice();
    c[tileToIndex(t)]--;
    const sh = calcShanten(c);
    if (sh < best) best = sh;
  }
  shantenDist[best] = (shantenDist[best] ?? 0) + 1;

  // События на 14-тайловой руке (как в симуляции "starting hands")
  // кан: 4 одинаковых
  for (let i = 0; i < NUM_TILES; i++) if (counts14[i] >= 4) add('kan_any');
  // пара / триплет хонора (любого из 7)
  let honorPair = false, honorTriplet = false;
  for (let i = 27; i < NUM_TILES; i++) {
    if (counts14[i] >= 2) honorPair = true;
    if (counts14[i] >= 3) honorTriplet = true;
  }
  if (honorPair) add('yaku_pair_any');
  if (honorTriplet) add('yaku_triplet_any');
  // триплет "ценного" в широком смысле: хонор или терминал (для сравнения с пон-структурами)
  let yaoTrip = false;
  for (let i = 0; i < NUM_TILES; i++) if (counts14[i] >= 3 && isYao(i)) yaoTrip = true;
  if (yaoTrip) add('yaochu_triplet_any');
  // танъяо: все 14 тайлов 2-8
  let tanyao = true;
  for (let i = 0; i < NUM_TILES; i++) if (counts14[i] && isYao(i)) { tanyao = false; break; }
  if (tanyao) add('tanyao');
  // хонрото: все 14 — терминалы/хоноры
  let honroutou = true, allTerm = true, allHonor = true;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!counts14[i]) continue;
    if (!isYao(i)) honroutou = false;
    if (!isTerm(i)) allTerm = false;
    if (!isHonor(i)) allHonor = false;
  }
  if (honroutou) add('honroutou');
  if (allTerm) add('chinroutou');
  if (allHonor) add('tsuuiisou');
  // масти
  const suits = new Set();
  let hasHonor = false;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!counts14[i]) continue;
    if (isHonor(i)) hasHonor = true;
    else suits.add(i < 9 ? 0 : i < 18 ? 1 : 2);
  }
  if (suits.size === 1 && hasHonor) add('honitsu');
  if (suits.size === 1 && !hasHonor) add('chinitsu');
  // иппейко: две одинаковые рун-строки (a,b,c с count>=2 у трёх подряд в масти)
  outer: for (let suit = 0; suit < 3; suit++) {
    for (let pos = 0; pos <= 6; pos++) {
      const b = suit * 9 + pos;
      if (counts14[b] >= 2 && counts14[b + 1] >= 2 && counts14[b + 2] >= 2) { add('iipeikou'); break outer; }
    }
  }
  // иццу: в масти по 1-3, 4-6, 7-9
  outer2: for (let suit = 0; suit < 3; suit++) {
    const b = suit * 9;
    if ([0, 1, 2, 3, 4, 5, 6, 7, 8].every((off) => counts14[b + off])) { add('ittsu'); break outer2; }
  }
  // саншоку доуджун: одинаковая рун-строка во всех трёх мастях
  for (let pos = 0; pos <= 6; pos++) {
    const ok = [0, 1, 2].every((suit) => {
      const b = suit * 9 + pos;
      return counts14[b] && counts14[b + 1] && counts14[b + 2];
    });
    if (ok) { add('sanshoku_dojun'); break; }
  }
  // саншоку доко: пон трёх мастей с одним номером
  for (let pos = 0; pos < 9; pos++) {
    const ok = [0, 1, 2].every((suit) => counts14[suit * 9 + pos] >= 3);
    if (ok) { add('sanshoku_doko'); break; }
  }
  // 3+ пona (любой триплет/кан)
  let pons = 0;
  for (let i = 0; i < NUM_TILES; i++) if (counts14[i] >= 3) pons++;
  if (pons >= 3) add('pon3plus');
  // шусанген-формат: два драконьих триплета + пара третьего
  const dragons = [31, 32, 33].map((i) => counts14[i]);
  const tripDragons = dragons.filter((c) => c >= 3).length;
  const pairDragons = dragons.filter((c) => c === 2).length;
  if (tripDragons === 2 && pairDragons >= 1) add('shousangen_shape');
  // готовая рука (win)
  if (isWinningHand(counts14)) add('complete');
}

const pct = (n) => `${(n / SAMPLES * 100).toFixed(4)}%`;
const out = {
  samples: SAMPLES,
  shantenAfterBestDiscard: Object.fromEntries(
    Object.entries(shantenDist).map(([k, v]) => [`${k}-shanten`, { n: v, rate: pct(v) }]),
  ),
  shanten14Formula: Object.fromEntries(
    Object.entries(shanten14Dist).map(([k, v]) => [`${k}-shanten`, { n: v, rate: pct(v) }]),
  ),
  events: Object.fromEntries(
    Object.entries(ev).map(([k, v]) => [k, { n: v, rate: pct(v) }]),
  ),
};
console.log(JSON.stringify(out, null, 2));
