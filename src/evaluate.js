import {
  isHonorIdx, isYaochuIdx, suitOf, tileToIndex,
} from './tile-index.js';
import { detectYaku } from './yaku.js';
import {
  allDecompositions, isChiitoitsuComplete, isKokushiComplete,
} from './decompose.js';
import { countDora } from './daily-context.js';
import { tierOfHan } from './tiers.js';
import { RULES } from './config.js';
import { canonicalTileId } from './tiles.js';

/** Красные пятёрки (отдельные id): '0m'/'0p'/'0s'. */
const RED_FIVE_IDS = new Set(['0m', '0p', '0s']);

/** Id тайла кан-объявления: строка или {tile}. */
function kanId(kan) {
  return typeof kan === 'string' ? kan : kan?.tile ?? null;
}

/**
 * Счётчики «полной» руки: counts + по одному тайлу за каждый объявленный кан
 * (4-й тайл кана отложен и в counts не входит — F4: дора-хан за него терялся).
 */
function doraCounts(counts, declaredKans = []) {
  const c = counts.slice();
  for (const kan of declaredKans ?? []) {
    const kind = kanId(kan);
    if (kind == null) continue;
    c[tileToIndex(canonicalTileId(kind))] += 1;
  }
  return c;
}

function waitTypesFor(decompose, winningTile) {
  if (winningTile == null) return [null];
  const types = new Set();
  if (decompose.pair[0] === winningTile) types.add('tanki');
  for (const meld of decompose.melds) {
    if (!meld.tiles.includes(winningTile)) continue;
    if (meld.type === 'pon' || meld.type === 'kan') {
      types.add('shanpon');
      continue;
    }
    const start = meld.tiles[0];
    const pos = start % 9;
    if (winningTile === start + 1) types.add('kanchan');
    else if ((pos === 0 && winningTile === start + 2) || (pos === 6 && winningTile === start)) {
      types.add('penchan');
    } else types.add('ryanmen');
  }
  return types.size ? [...types] : [null];
}

function chiitoitsuExtraYaku(counts) {
  const tiles = [];
  for (let i = 0; i < counts.length; i++) if (counts[i]) tiles.push(i);
  const extras = [];
  if (tiles.every((tile) => !isYaochuIdx(tile))) extras.push({ name: 'Танъяо', han: 1 });
  const suits = new Set(tiles.filter((tile) => !isHonorIdx(tile)).map(suitOf));
  const hasHonor = tiles.some(isHonorIdx);
  if (suits.size === 1 && hasHonor) extras.push({ name: 'Хоницу', han: 3 });
  if (suits.size === 1 && !hasHonor) extras.push({ name: 'Чиницу', han: 6 });
  if (tiles.every(isYaochuIdx)) extras.push({ name: 'Хонрото', han: 2 });
  return extras;
}

/** Дора, ура-дора и ака-дора дают хан (и через хан — тир), отдельных очков у них нет.
 *  Что именно считать — задают правила config/scoring.json -> systems.v4.rules.
 *  Ура-индикаторы приходят в ctx.uraIndicators: при выборе сброса их передают
 *  пустыми (урадоры ещё не открыты), в финальном счёте — как есть.
 *  declaredKans — объявленные каны: «пон» в counts несёт 3 тайла, кан — 4,
 *  поэтому 4-й тайл добавляется для подсчёта дор (аудит F4); кан, в котором
 *  красная пятёрка отложена 4-м тайлом, объявляется красным id ('0m'/'0p'/'0s'). */
function doraBonuses(counts, ctx, declaredKans = []) {
  const bonuses = [];
  const dora = doraCounts(counts, declaredKans);
  if (RULES.doraFromIndicator) {
    const regular = countDora(dora, ctx.doraIndicators);
    if (regular > 0) bonuses.push({ id: 'dora', name: `Дора ×${regular}`, han: regular });
  }
  if (RULES.uraDora) {
    const ura = countDora(dora, ctx.uraIndicators);
    if (ura > 0) bonuses.push({ id: 'ura_dora', name: `Ура-дора ×${ura}`, han: ura });
  }
  if (RULES.akaDora) {
    const red = new Set(ctx.redFives ?? []);
    let aka = [...red].filter((tile) => dora[tileToIndex(tile)] > 0).length;
    // Красная пятёрка как 4-й тайл кана: в 14-тайловой форме её нет
    // (redFives строится из формы), но кан объявлен красным id.
    for (const kan of declaredKans ?? []) {
      const id = kanId(kan);
      if (id && RED_FIVE_IDS.has(id) && !red.has(id)) aka += 1;
    }
    if (aka > 0) bonuses.push({ id: 'aka_dora', name: `Красная дора ×${aka}`, han: aka });
  }
  return bonuses;
}

/** Убрать яку, которые отключены правилами (например, цумо). */
function withoutDisabledYaku(yaku) {
  if (RULES.tsumo) return yaku;
  return yaku.filter((item) => item?.id !== 'menzen_tsumo');
}

function evaluateChiitoitsu(counts, ctx, declaredKans = []) {
  const yaku = withoutDisabledYaku([{ name: 'Чиитоицу', han: 2 }, ...chiitoitsuExtraYaku(counts)]);
  let han = yaku.reduce((sum, item) => sum + item.han, 0);
  if (ctx.riichi) { yaku.push({ name: 'Риичи', han: RULES.riichiHan }); han += RULES.riichiHan; }
  if (ctx.tsumo && RULES.tsumo) { yaku.push({ name: 'Мензен цумо', han: 1 }); han++; }
  for (const bonus of doraBonuses(counts, ctx, declaredKans)) {
    yaku.push(bonus);
    han += bonus.han;
  }
  return { han, yaku, label: tierOfHan(han).label };
}

/** Лучшее по хану стандартное разложение руки.
 *  Если выполнено несколько яку-манов — действует один: ровно 13 хан. */
function evaluateStandard(counts, ctx, declaredKans = []) {
  let best = { han: -1, yaku: [], label: null };
  for (const decomposition of allDecompositions(counts)) {
    for (const inferredWait of waitTypesFor(decomposition, ctx.winningTile)) {
      const actualCtx = { ...ctx, waitType: inferredWait ?? ctx.waitType };
      let detected = detectYaku(decomposition, counts, actualCtx);
      detected = withoutDisabledYaku(detected);
      if (detected.length === 0) continue;
      const yakuman = detected.filter((item) => item.han === 'yakuman');
      let yaku;
      let han;
      if (yakuman.length) {
        yaku = yakuman;
        han = 13;
      } else {
        yaku = [...detected, ...doraBonuses(counts, ctx, declaredKans)];
        han = yaku.reduce((sum, item) => sum + item.han, 0);
      }
      if (han > best.han) {
        best = { han, yaku, label: tierOfHan(han).label };
      }
    }
  }
  return best;
}

/** Оценка завершённой руки: только хан и яку.
 *  Фу в v4 не считаются, тир определяется числом хан (см. src/tiers.js).
 *  Рука может быть одновременно чиитоицу и стандартной — берём лучшую по хану.
 *  declaredKans — для 4-го тайла кана в дорах (аудит F4). */
export function evaluateComplete(counts, ctx = {}, declaredKans = []) {
  if (isKokushiComplete(counts)) {
    return {
      han: 13, yaku: [{ name: 'Кокуши мусо', han: 'yakuman' }], label: 'Якуман',
    };
  }
  const results = [];
  if (isChiitoitsuComplete(counts)) {
    results.push(evaluateChiitoitsu(counts, ctx, declaredKans));
  }
  results.push(evaluateStandard(counts, ctx, declaredKans));
  return results.reduce((a, b) => (b.han > a.han ? b : a));
}
