/**
 * H2/аудит №2: применение канов, объявленных на сервере, к 14-тайловому
 * черновику. Чистая логика без DOM — вынесена из src/main.js в 0.7.1,
 * чтобы покрываться тестами (test/daily-hand-sync.test.js): раньше баг с
 * 5-й копией тайла при 2+ канах (аудит №2) тестами не покрывался, потому
 * что логика жила внутри модуля с DOM.
 *
 * Правила:
 *  - с каждого вида кана выносится 4 тайла (пон + 4-й);
 *  - доборы (по тайлу на кан) — из стены за вычетом всего черновика
 *    (M2: 5-я копия вида невозможна);
 *  - ВСЕ доборы — ОДНИМ вызовом drawHand(N) из одной перемешанной стены:
 *    доборы различны между собой (аудит №2: раздельные вызовы видели
 *    одинаковую стену и с вероятностью ~N²/2N могли вернуть один и тот же
 *    тайл — 5-ю копию вида).
 */
import { canonicalTileId, drawHand, sortHand } from './tiles.js';

/**
 * @param {string[]} draft14 — исходные 14 тайлов (серверный черновик)
 * @param {string[]} serverKans — виды объявленных канов (иды, канонические
 *   или красные — канонизируются)
 * @param {string[]} deadTiles — мёртвая стена дня (индикаторы)
 * @returns {string[]} пост-кан экранная форма (14 − 3×каны)
 */
export function applyServerKansToDraft(draft14, serverKans, deadTiles = []) {
  let hand = [...draft14];
  for (const kind of serverKans.map(canonicalTileId)) {
    for (let i = 0; i < 4; i += 1) {
      const idx = hand.findIndex((t) => canonicalTileId(t) === kind);
      if (idx >= 0) hand.splice(idx, 1);
    }
  }
  if (serverKans.length) {
    // Аудит №2 (0.7.1): один вызов — одна стена, доборы различны.
    hand.push(...drawHand(serverKans.length, { deadTiles, exclude: draft14 }));
  }
  return sortHand(hand);
}
