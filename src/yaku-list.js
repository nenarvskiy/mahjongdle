/**
 * Полный список яку и якуманов.
 * Поля:
 *   id       — машинное имя
 *   name     — русское название
 *   han      — число или 'yakuman'
 *   closed   — только для закрытой руки
 *   openHan  — хан для открытой руки (если отличается)
 *   partial  — можно ли засчитать в НЕдособранной руке как потенциал
 */

export const YAKU = [
  // === 1 хан ===
  { id: 'riichi',         name: 'Риичи',                 han: 1, closed: true,  partial: false },
  { id: 'ippatsu',        name: 'Иппацу',                han: 1, closed: true,  partial: false },
  { id: 'menzen_tsumo',   name: 'Мензен цумо',           han: 1, closed: true,  partial: false },
  { id: 'pinfu',          name: 'Пинфу',                 han: 1, closed: true,  partial: false },
  { id: 'iipeikou',       name: 'Иипейко',               han: 1, closed: true,  partial: true  },
  { id: 'tanyao',         name: 'Танъяо',                han: 1, closed: false, partial: true  },
  { id: 'yakuhai_dragon', name: 'Якухай (дракон)',       han: 1, closed: false, partial: false },
  { id: 'yakuhai_seat',   name: 'Якухай (ветер места)',  han: 1, closed: false, partial: false },
  { id: 'yakuhai_round',  name: 'Якухай (ветер раунда)', han: 1, closed: false, partial: false },
  { id: 'rinshan',        name: 'Риншан кайхо',          han: 1, closed: false, partial: false },
  { id: 'chankan',        name: 'Чанкан',                han: 1, closed: false, partial: false },
  { id: 'haitei',         name: 'Хайтей',                han: 1, closed: false, partial: false },
  { id: 'houtei',         name: 'Хоутей',                han: 1, closed: false, partial: false },

  // === 2 хан ===
  { id: 'daburu_riichi',  name: 'Дабуру риичи',          han: 2, closed: true,  partial: false },
  { id: 'chiitoitsu',     name: 'Чиитоицу (7 пар)',      han: 2, closed: true,  partial: true  },
  { id: 'sanshoku_dojun', name: 'Саншоку доуджун',       han: 2, closed: false, openHan: 1, partial: true },
  { id: 'ittsu',          name: 'Иццу',                  han: 2, closed: false, openHan: 1, partial: true },
  { id: 'chanta',         name: 'Чанта',                 han: 2, closed: false, openHan: 1, partial: true },
  { id: 'sanshoku_doko',  name: 'Саншоку доко',          han: 2, closed: false, partial: true  },
  { id: 'sanankou',       name: 'Сананко',               han: 2, closed: false, partial: true  },
  { id: 'sankantsu',      name: 'Санканцу',              han: 2, closed: false, partial: true  },
  { id: 'toitoi',         name: 'Тойтой',                han: 2, closed: false, partial: true  },
  { id: 'shousangen',     name: 'Шосанген',              han: 2, closed: false, partial: true  },
  { id: 'honroutou',      name: 'Хонрото',               han: 2, closed: false, partial: true  },

  // === 3 хан ===
  { id: 'honitsu',        name: 'Хоницу',                han: 3, closed: false, openHan: 2, partial: true  },
  { id: 'junchan',        name: 'Джунчан',               han: 3, closed: false, openHan: 2, partial: true  },
  { id: 'ryanpeikou',     name: 'Рянпейко',              han: 3, closed: true,  partial: true  },

  // === 6 хан ===
  { id: 'chinitsu',       name: 'Чиницу',                han: 6, closed: false, openHan: 5, partial: true  },

  // === Якуманы ===
  { id: 'kokushi',        name: 'Кокуши мусо',           han: 'yakuman', closed: true,  partial: true  },
  { id: 'suuankou',       name: 'Сууанко',               han: 'yakuman', closed: true,  partial: true  },
  { id: 'daisangen',      name: 'Дайсангэн',             han: 'yakuman', closed: false, partial: true  },
  { id: 'shousuushii',    name: 'Шосууши',               han: 'yakuman', closed: false, partial: true  },
  { id: 'daisuushii',     name: 'Дайсууши',              han: 'yakuman', closed: false, partial: true  },
  { id: 'tsuuiisou',      name: 'Цууисо',                han: 'yakuman', closed: false, partial: true  },
  { id: 'chinroutou',     name: 'Чинрото',               han: 'yakuman', closed: false, partial: true  },
  { id: 'ryuuiisou',      name: 'Рюисо',                 han: 'yakuman', closed: false, partial: true  },
  { id: 'chuuren',        name: 'Чууренпото',            han: 'yakuman', closed: true,  partial: true  },
  { id: 'suukantsu',      name: 'Сууканцу',              han: 'yakuman', closed: false, partial: true  },
  { id: 'tenhou',         name: 'Тенхо',                 han: 'yakuman', closed: true,  partial: false },
  { id: 'chiihou',        name: 'Чиихо',                 han: 'yakuman', closed: true,  partial: false },
];

export const YAKU_BY_ID = new Map(YAKU.map((y) => [y.id, y]));