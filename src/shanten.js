import { NUM_TILES, tileToIndex } from './tile-index.js';
import { canonicalTileId } from './tiles.js';

/**
 * Блокировка объявленных канов: кан в оценочной руке — это «пон» (3 тайла
 * из withKanPons), которые нельзя использовать в других сетах и сбрасывать.
 */
export function kanLock(declaredKans = []) {
  const lock = new Array(NUM_TILES).fill(0);
  for (const kan of declaredKans ?? []) {
    const kind = typeof kan === 'string' ? kan : kan?.tile;
    if (kind == null) continue;
    const idx = tileToIndex(canonicalTileId(kind));
    if (idx != null) lock[idx] = Math.min(3, lock[idx] + 3);
  }
  return lock;
}

export function calcShanten(counts, declaredKans = []) {
  const n = (declaredKans ?? []).length;
  if (n > 0) {
    // С каном: тайлы кана зафиксированы (вычтены), остальные тайлы должны
    // дать (4 − каны) сета + пару. Чиитоицу/кокуши с каном невозможны.
    const c = counts.slice();
    const lock = kanLock(declaredKans);
    for (let i = 0; i < NUM_TILES; i++) c[i] = Math.max(0, c[i] - lock[i]);
    return shantenStandard(c, 4 - n);
  }
  return Math.min(
    shantenStandard(counts),
    shantenChiitoitsu(counts),
    shantenKokushi(counts)
  );
}

export function calcShantenFor14(counts, declaredKans = []) {
  if (isWinningHand(counts)) return -1;
  let best = 8;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!counts[i]) continue;
    const t = counts.slice(); t[i]--;
    const s = calcShanten(t, declaredKans);
    if (s < best) best = s;
  }
  return best;
}

/** Все тайлы-ожидания для тенпай-руки (13 тайлов), с учётом фиксированных канов. */
export function tenpaiWaits(counts, declaredKans = []) {
  const n = (declaredKans ?? []).length;
  const waits = [];
  for (let i = 0; i < NUM_TILES; i++) {
    if (counts[i] >= 4) continue;
    const t = counts.slice(); t[i]++;
    if (n > 0 ? isWinningHandWithKans(t, declaredKans) : isWinningHand(t)) waits.push(i);
  }
  return waits;
}

/**
 * Готовая рука с фиксированным каном: «пон» кана вычитается, из остальных
 * тайлов нужны (4 − каны) сета + пара. (Физически: кан + 3 сета + пара.)
 */
export function isWinningHandWithKans(c, declaredKans) {
  const n = declaredKans.length;
  const lock = kanLock(declaredKans);
  const t = c.slice();
  for (let i = 0; i < NUM_TILES; i++) t[i] = Math.max(0, t[i] - lock[i]);
  for (let p = 0; p < NUM_TILES; p++) {
    if (t[p] < 2) continue;
    const rest = t.slice(); rest[p] -= 2;
    if (canFormNMelds(rest, 4 - n)) return true;
  }
  return false;
}

// --- стандартный (N мендз + пара; N=4 без канов, меньше — с кан-мелдами) ---
function shantenStandard(counts, meldsNeeded = 4) {
  let best = 2 * meldsNeeded;
  const c = counts.slice();
  function dfs(idx, melds, partials, pairs) {
    while (idx < NUM_TILES && !c[idx]) idx++;
    if (idx >= NUM_TILES) {
      const head = pairs > 0 ? 1 : 0;
      const extraPairs = Math.max(0, pairs - 1);
      const usable = Math.min(partials + extraPairs, meldsNeeded - melds);
      const sh = 2 * meldsNeeded - 2 * melds - usable - head;
      if (sh < best) best = sh;
      return;
    }
    if (c[idx] >= 3) { c[idx] -= 3; dfs(idx, melds + 1, partials, pairs); c[idx] += 3; }
    if (idx < 27 && idx % 9 <= 6 && c[idx + 1] && c[idx + 2]) {
      c[idx]--; c[idx + 1]--; c[idx + 2]--;
      dfs(idx, melds + 1, partials, pairs);
      c[idx]++; c[idx + 1]++; c[idx + 2]++;
    }
    if (c[idx] >= 2) { c[idx] -= 2; dfs(idx, melds, partials, pairs + 1); c[idx] += 2; }
    if (idx < 27 && idx % 9 <= 7 && c[idx + 1]) {
      c[idx]--; c[idx + 1]--;
      dfs(idx, melds, partials + 1, pairs);
      c[idx]++; c[idx + 1]++;
    }
    if (idx < 27 && idx % 9 <= 6 && c[idx + 2]) {
      c[idx]--; c[idx + 2]--;
      dfs(idx, melds, partials + 1, pairs);
      c[idx]++; c[idx + 2]++;
    }
    c[idx]--; dfs(idx, melds, partials, pairs); c[idx]++;
  }
  dfs(0, 0, 0, 0);
  return best;
}

function shantenChiitoitsu(c) {
  let pairs = 0, unique = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    if (c[i] >= 2) pairs++;
    if (c[i] >= 1) unique++;
  }
  return 6 - pairs + Math.max(0, 7 - unique);
}

export const KOKUSHI = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
function shantenKokushi(c) {
  let unique = 0, hasPair = false;
  for (const t of KOKUSHI) {
    if (c[t] >= 1) unique++;
    if (c[t] >= 2) hasPair = true;
  }
  return 13 - unique - (hasPair ? 1 : 0);
}

export function isWinningHand(c) {
  // Стандарт
  for (let p = 0; p < NUM_TILES; p++) {
    if (c[p] < 2) continue;
    const t = c.slice(); t[p] -= 2;
    if (canForm4Melds(t)) return true;
  }
  // Чиитоицу
  let p = 0, bad = false;
  for (let i = 0; i < NUM_TILES; i++) {
    if (c[i] === 2) p++;
    else if (c[i] !== 0) { bad = true; break; }
  }
  if (!bad && p === 7) return true;
  // Кокуши
  let k = 0, pair = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!KOKUSHI.includes(i) && c[i]) return false;
    if (c[i] >= 1) k++;
    if (c[i] >= 2) pair++;
  }
  return k === 13 && pair === 1;
}

function canForm4Melds(c) {
  return canFormNMelds(c, 4);
}

/** Могут ли оставшиеся тайлы (ровно 3·n штук) составить n сета. */
function canFormNMelds(c, n = 4) {
  if (n === 0) return c.every((x) => x === 0);
  let i = 0;
  while (i < NUM_TILES && !c[i]) i++;
  if (i >= NUM_TILES) return false;
  if (c[i] >= 3) {
    c[i] -= 3;
    if (canFormNMelds(c, n - 1)) { c[i] += 3; return true; }
    c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (canFormNMelds(c, n - 1)) { c[i]++; c[i + 1]++; c[i + 2]++; return true; }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return false;
}