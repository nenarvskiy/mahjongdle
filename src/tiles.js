import { CONFIG, SUITS, SUIT_ORDER, HONORS, HONOR_SORT_BASE } from './config.js';
import { NUM_TILES, tileToIndex } from './tile-index.js';

/** Быстрые справочники для хоноров. */
const HONOR_BY_ID = new Map(HONORS.map((h) => [h.id, h]));
const HONOR_INDEX = new Map(HONORS.map((h, i) => [h.id, i]));

/** Является ли тайл хонором (ветер или дракон). */
export function isHonor(id) {
  return HONOR_BY_ID.has(id);
}

/** Всевозможные id тайлов в стандартном наборе (34 штуки). */
export function allTileIds() {
  const ids = [];
  for (const suit of Object.keys(SUITS)) {
    for (const n of SUITS[suit].numbers) ids.push(`${n}${suit}`);
  }
  for (const h of HONORS) ids.push(h.id);
  return ids;
}

/** Собрать полную стену с учётом копий. */
export function buildWall(copies = CONFIG.copiesPerTile) {
  const wall = [];
  for (const id of allTileIds()) {
    if (CONFIG.redFives && id[0] === '5' && copies > 0) {
      wall.push(`0${id[1]}`);
      for (let i = 1; i < copies; i++) wall.push(id);
    } else {
      for (let i = 0; i < copies; i++) wall.push(id);
    }
  }
  return wall;
}

/** Перемешать (Fisher–Yates), не мутируя вход. */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Сгенерировать руку нужного размера.
 *  deadTiles — тайлы мёртвой стены (индикаторы доры и урадор): их копии в
 *  добор не попадают, поэтому рука физически корректна (в стене 134 тайла).
 *  Если «мёртвый» тайл — пятёрка, изымается обычная копия, красная остаётся
 *  в стене (та же модель ака, что в статистике: красная пятёрка равновероятна
 *  среди копий вида).
 *  exclude (M2) — тайлы, уже у игрока (рука + тайлы канов): из стены
 *  изымаются по копии на каждый — добор не может выдать ПЯТУЮ копию вида
 *  (физически в обороте только 4; раньше добор после кана мог дать пятую). */
export function drawHand(size = CONFIG.handSize, { deadTiles = [], exclude = [] } = {}) {
  const wall = buildWall();
  for (const tile of deadTiles) {
    const index = wall.indexOf(canonicalTileId(tile));
    if (index >= 0) wall.splice(index, 1);
  }
  for (const tile of exclude) {
    if (typeof tile !== 'string' || !tile) continue;
    const index = wall.indexOf(tile);
    if (index >= 0) wall.splice(index, 1);
  }
  return shuffle(wall).slice(0, size);
}

/** Числовое значение для сортировки. */
export function tileSortValue(id) {
  if (isHonor(id)) {
    return HONOR_SORT_BASE + HONOR_INDEX.get(id);
  }
  const num = id[0] === '0' ? 5 : parseInt(id[0], 10);
  const suit = id[1];
  return (SUIT_ORDER[suit] ?? 99) * 100 + num;
}

/** Отсортировать руку (по мастям и номерам, хоноры в конце). */
export function sortHand(hand) {
  return hand.slice().sort((a, b) => tileSortValue(a) - tileSortValue(b));
}

/** Человеческое имя тайла (для alt-текста и тултипов). */
export function tileDisplayName(id) {
  if (isHonor(id)) return HONOR_BY_ID.get(id)?.name ?? id;
  const red = id[0] === '0';
  const num = red ? 5 : parseInt(id[0], 10);
  const suit = id[1];
  return `${red ? 'Красная ' : ''}${num} ${SUITS[suit]?.name ?? suit}`;
}

/** Красная пятёрка эквивалентна обычной для сравнений доры. */
export function canonicalTileId(id) {
  return id?.[0] === '0' ? `5${id[1]}` : id;
}

/**
 * Сколько копий каждого тайла вообще может оказаться в победной руке:
 * из 4 копий вида вычитаются те, что лежат в мёртвой стене (индикаторы).
 * Возвращает массив длиной NUM_TILES — потолок для добора в потенциале.
 */
export function maxCountsForDeadTiles(deadTiles = []) {
  const caps = new Array(NUM_TILES).fill(CONFIG.copiesPerTile);
  for (const tile of deadTiles) {
    const index = tileToIndex(tile);
    caps[index] = Math.max(0, caps[index] - 1);
  }
  return caps;
}

/**
 * Короткое имя тайла — для компактных мест (счётчики, отладка).
 * Числовые: "5p". Хоноры: "Восток", "Белый" и т.п.
 */
export function tileShortName(id) {
  if (isHonor(id)) return HONOR_BY_ID.get(id)?.short ?? id;
  return id;
}

/**
 * Сгруппировать руку в Map<id, count> — пригодится для скоринга.
 */
export function countTiles(hand) {
  const map = new Map();
  for (const id of hand) map.set(id, (map.get(id) ?? 0) + 1);
  return map;
}
