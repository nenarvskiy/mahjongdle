// Распределение B: 14 тайлов -> лучший сброс (min shanten) -> 13 тайлов.
// Все события (структуры + яку) считаются на 13 тайлов ПОСЛЕ сброса.
import { handToCounts, tileToIndex, NUM_TILES } from '../../src/tile-index.js';
import { calcShanten } from '../../src/shanten.js';
import { buildWall } from '../../src/tiles.js';

const SAMPLES = Number(process.env.SAMPLES ?? 1_000_000);
let seed = 0xabc12345;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

const baseWall = buildWall();
const ev = {};
const add = (n) => { ev[n] = (ev[n] ?? 0) + 1; };
const shantenDist = {};

const isHonor = (i) => i >= 27;
const isTerm = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8);
const isYao = (i) => isHonor(i) || isTerm(i);

for (let s = 0; s < SAMPLES; s++) {
  const wall = baseWall.slice();
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const hand14 = wall.slice(0, 14);
  const counts14 = handToCounts(hand14);

  // лучший сброс: min shanten (deterministic tiebreak: первый встречный)
  let bestSh = 8, bestTile = hand14[0];
  const seen = new Set();
  for (const t of hand14) {
    if (seen.has(t)) continue;
    seen.add(t);
    const c = counts14.slice();
    c[tileToIndex(t)]--;
    const sh = calcShanten(c);
    if (sh < bestSh) { bestSh = sh; bestTile = t; }
  }
  shantenDist[bestSh] = (shantenDist[bestSh] ?? 0) + 1;

  // 13 тайлов после сброса
  const c = counts14;
  c[tileToIndex(bestTile)]--;

  // ---- СТРУКТУРЫ на 13 ----
  let kan = false, pon = 0, pair = false;
  for (let i = 0; i < NUM_TILES; i++) {
    if (c[i] >= 4) kan = true;
    if (c[i] >= 3) pon++;
    if (c[i] >= 2) pair = true;
  }
  if (kan) add('kan');
  if (pon >= 1) add('pon_any');
  if (pon >= 3) add('pon3plus');
  if (pair) add('pair');

  let chi = false, seq4 = false, seq5 = false, kanchan = false, ryanmen = false,
      penchan = false, s334 = false, s246 = false, s3334 = false, s1122 = false;
  for (let suit = 0; suit < 3; suit++) {
    const b = suit * 9;
    for (let p = 0; p <= 6; p++) if (c[b+p] && c[b+p+1] && c[b+p+2]) chi = true;
    for (let p = 0; p <= 5; p++) if (c[b+p] && c[b+p+1] && c[b+p+2] && c[b+p+3]) seq4 = true;
    for (let p = 0; p <= 4; p++) if (c[b+p] && c[b+p+1] && c[b+p+2] && c[b+p+3] && c[b+p+4]) seq5 = true;
    for (let p = 0; p <= 7; p++) if (c[b+p] && c[b+p+2]) kanchan = true;
    for (let p = 1; p <= 6; p++) if (c[b+p] && c[b+p+1]) ryanmen = true;   // (1,2)..(6,7) 0-based
    if (c[b+0] && c[b+1]) penchan = true;
    if (c[b+7] && c[b+8]) penchan = true;
    for (let p = 0; p < 8; p++) if (c[b+p] >= 2 && c[b+p+1] >= 1) s334 = true;
    for (let p = 0; p <= 6; p++) if (c[b+p] && c[b+p+2] && c[b+p+4]) s246 = true;
    for (let p = 0; p < 8; p++) if (c[b+p] >= 3 && c[b+p+1] >= 1) s3334 = true;
    for (let p = 0; p < 8; p++) if (c[b+p] >= 2 && c[b+p+1] >= 2) s1122 = true;
  }
  if (chi) add('chi'); if (seq4) add('seq4'); if (seq5) add('seq5');
  if (kanchan) add('kanchan'); if (ryanmen) add('ryanmen'); if (penchan) add('penchan');
  if (s334) add('s334'); if (s246) add('s246'); if (s3334) add('s3334'); if (s1122) add('s1122');

  // ---- ЯКУ на 13 ----
  let tanyao = true;
  for (let i = 0; i < NUM_TILES; i++) if (c[i] && isYao(i)) { tanyao = false; break; }
  if (tanyao) add('tanyao');

  let honroutou = true;
  for (let i = 0; i < NUM_TILES; i++) if (c[i] && !isYao(i)) { honroutou = false; break; }
  if (honroutou) add('honroutou');

  const suits = new Set(); let hasHonor = false;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!c[i]) continue;
    if (isHonor(i)) hasHonor = true;
    else suits.add(i < 9 ? 0 : i < 18 ? 1 : 2);
  }
  if (suits.size === 1 && hasHonor) add('honitsu');
  if (suits.size === 1 && !hasHonor) add('chinitsu');

  let ii = false;
  outer: for (let suit = 0; suit < 3; suit++) {
    const b = suit * 9;
    for (let p = 0; p <= 6; p++)
      if (c[b+p] >= 2 && c[b+p+1] >= 2 && c[b+p+2] >= 2) { ii = true; break outer; }
  }
  if (ii) add('iipeikou');

  let it = false;
  outer2: for (let suit = 0; suit < 3; suit++) {
    const b = suit * 9;
    let ok = true;
    for (let p = 0; p < 9; p++) if (!c[b+p]) { ok = false; break; }
    if (ok) { it = true; break outer2; }
  }
  if (it) add('ittsu');

  let sdj = false;
  for (let p = 0; p <= 6 && !sdj; p++) {
    let ok = true;
    for (let suit = 0; suit < 3; suit++) {
      const b = suit * 9;
      if (!(c[b+p] && c[b+p+1] && c[b+p+2])) { ok = false; break; }
    }
    if (ok) sdj = true;
  }
  if (sdj) add('sanshoku_dojun');

  let sdo = false;
  for (let p = 0; p < 9 && !sdo; p++) {
    let ok = true;
    for (let suit = 0; suit < 3; suit++) if (c[suit*9+p] < 3) { ok = false; break; }
    if (ok) sdo = true;
  }
  if (sdo) add('sanshoku_doko');

  if (pon >= 3) add('sanankou');

  // ценные = 7 хоноров (wind-independent)
  let vTile = false, vPair = false, vTri = false;
  for (let i = 27; i < NUM_TILES; i++) {
    if (c[i] >= 1) vTile = true;
    if (c[i] >= 2) vPair = true;
    if (c[i] >= 3) vTri = true;
  }
  if (vTile) add('valuable_tile');
  if (vPair) add('valuable_pair');
  if (vTri) add('valuable_triplet');
}

const pct = (n) => (n / SAMPLES * 100).toFixed(4) + '%';
const once = (n) => n > 0 ? '1 из ' + Math.round(SAMPLES / n).toLocaleString() : '0 (не встречено)';
const out = {
  samples: SAMPLES,
  shantenAfterBestDiscard: Object.fromEntries(
    Object.entries(shantenDist).sort((a,b)=>a[0]-b[0]).map(([k,v]) => [`${k}-shanten`, { n: v, rate: pct(v) }])),
  events: Object.fromEntries(
    Object.entries(ev).sort((a,b)=>b[1]-a[1]).map(([k,v]) => [k, { n: v, rate: pct(v), once: once(v) }])),
};
console.log(JSON.stringify(out, null, 2));
