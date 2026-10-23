/**
 * Соответствие «хан → тир» по конфигу (config/scoring.json -> systems.v4.tiers).
 * Фу не участвуют: тир определяется только числом хан.
 * Правило то же, что в статистике (stats/scorestat.py, tier_of_han):
 * отрицательный хан (рука без яку) — тир Normal, хан выше последнего порога — Якуман.
 */
import { TIERS, BASE_TABLE } from './config.js';

/** Индекс тира для числа хан. */
export function tierIndexForHan(han) {
  if (!Number.isFinite(han) || han < 0) return 0;
  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i];
    if (han < tier.minHan) continue;
    if (tier.maxHan == null || han <= tier.maxHan) return i;
  }
  return TIERS.length - 1;
}

/** Тир целиком: { index, key, label, minHan, maxHan }. */
export function tierOfHan(han) {
  const index = tierIndexForHan(han);
  return { index, ...TIERS[index] };
}

/** Название тира по индексу. */
export function tierLabel(index) {
  return TIERS[index]?.label ?? null;
}

/** Название состояния руки по индексу строки таблицы базы (0 — 2-сянтэн). */
export function stateLabel(state) {
  return BASE_TABLE.rows?.[state] ?? null;
}