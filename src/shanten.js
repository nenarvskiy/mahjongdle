import { NUM_TILES } from './tile-index.js';

export function calcShanten(counts) {
  return Math.min(
    shantenStandard(counts),
    shantenChiitoitsu(counts),
    shantenKokushi(counts)
  );
}

export function calcShantenFor14(counts) {
  if (isWinningHand(counts)) return -1;
  let best = 8;
  for (let i = 0; i < NUM_TILES; i++) {
    if (!counts[i]) continue;
    const t = counts.slice(); t[i]--;
    const s = calcShanten(t);
    if (s < best) best = s;
  }
  return best;
}

/** Все тайлы-ожидания для тенпай-руки (13 тайлов). */
export function tenpaiWaits(counts) {
  const waits = [];
  for (let i = 0; i < NUM_TILES; i++) {
    if (counts[i] >= 4) continue;
    const t = counts.slice(); t[i]++;
    if (isWinningHand(t)) waits.push(i);
  }
  return waits;
}

// --- стандартный (4 менцена + пара) ---
function shantenStandard(counts) {
  let best = 8;
  const c = counts.slice();
  function dfs(idx, melds, partials, pairs) {
    while (idx < NUM_TILES && !c[idx]) idx++;
    if (idx >= NUM_TILES) {
      const head = pairs > 0 ? 1 : 0;
      const extraPairs = Math.max(0, pairs - 1);
      const usable = Math.min(partials + extraPairs, 4 - melds);
      const sh = 8 - 2 * melds - usable - head;
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

const KOKUSHI = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
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
  let i = 0;
  while (i < NUM_TILES && !c[i]) i++;
  if (i >= NUM_TILES) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    if (canForm4Melds(c)) { c[i] += 3; return true; }
    c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (canForm4Melds(c)) { c[i]++; c[i + 1]++; c[i + 2]++; return true; }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return false;
}