/**
 * Единая точка конфигурации.
 * Здесь — механика игры; все ЧИСЛА очков живут в config/scoring.json
 * (systems.v4 — рабочая система, её читают и игра, и статистика).
 */
import scoringConfig from '../config/scoring.json' with { type: 'json' };
import authConfig from '../config/auth.json' with { type: 'json' };

/** Система очков v4 из общего конфига. */
export const SCORING_CONFIG = scoringConfig.systems.v4;

/** Конфиг авторизации/таблицы дня: googleClientId (пусто = функция выкл), apiBaseUrl. */
export const AUTH_CONFIG = authConfig;

/** Правила системы (фу, цумо, манган, риичи, дора, ака). */
export const RULES = SCORING_CONFIG.rules;

/** Тиры по хану, по возрастанию: [{minHan, maxHan, key, label}] */
export const TIERS = SCORING_CONFIG.tiers;

/** Таблица базы: values[состояние][тир], состояния 0..2 = 2-сянтэн..тенпай. */
export const BASE_TABLE = SCORING_CONFIG.base;

/** Очки базы за состояние и тир (за пределами таблицы — 0). */
export function basePoints(state, tierIndex) {
  const row = BASE_TABLE.values[state];
  if (!row) return 0;
  return row[tierIndex] ?? 0;
}

/** Структуры (блоки) с плоскими очками. */
export const STRUCTURES = SCORING_CONFIG.structures.list;

/** Яку с плоскими очками (видимые на 13 тайлах). */
export const YAKU = SCORING_CONFIG.yaku.list;

export const CONFIG = {
  /** Сколько тайлов в стартовой руке */
  handSize: 14,

  /** Сколько копий каждого тайла в стене (обычно 4) */
  copiesPerTile: 4,

  /** По одной красной пятёрке каждой масти вместо обычной. */
  redFives: true,

  /**
   * Путь к картинке тайла.
   * Получает id вида "1m", "5p", "3s", "ew", "rd", "0m" (красная пятёрка).
   * Имена файлов совпадают с id: assets/tiles/ew.svg, assets/tiles/rd.svg,
   * красные пятёрки — свои картинки assets/tiles/0m.svg, 0p.svg, 0s.svg
   * (0.7.0: раньше красная показывала обычную пятёрку 5x.svg).
   */
  tileImagePath: (tileId) => `./assets/tiles/${tileId}.svg`,

  /** Сортировать ли руку после раздачи */
  autoSortHand: true,
};

/** Числовые масти. */
export const SUITS = {
  m: { name: 'Ман', numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  p: { name: 'Пин', numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  s: { name: 'Соу', numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
};

/**
 * Хоноры: 4 ветра + 3 дракона.
 * Порядок элементов в массиве = порядок сортировки в руке.
 * id — это же имя файла картинки.
 */
export const HONORS = [
  { id: 'ew', name: 'Восточный ветер', short: 'Восток' },
  { id: 'sw', name: 'Южный ветер',    short: 'Юг' },
  { id: 'ww', name: 'Западный ветер', short: 'Запад' },
  { id: 'nw', name: 'Северный ветер', short: 'Север' },
  { id: 'wd', name: 'Белый дракон',   short: 'Белый' },
  { id: 'gd', name: 'Зелёный дракон', short: 'Зелёный' },
  { id: 'rd', name: 'Красный дракон', short: 'Красный' },
];

/** Порядок мастей для сортировки (хоноры идут после числовых). */
export const SUIT_ORDER = { m: 0, p: 1, s: 2 };

/** С какого значения начинаются хоноры в сортировке. */
export const HONOR_SORT_BASE = 1000;
