/**
 * Хранение «руки дня» в localStorage: рука генерируется ОДИН РАЗ в день
 * (кнопка «Сгенерировать руку»), после этого кнопка неактивна до следующего
 * дня, а повторное открытие страницы в тот же день восстанавливает ту же
 * руку. Условия дня (ветра/дора) всё равно берутся из даты, поэтому
 * сохраняем только саму руку, dayKey, объявленные каны, пропущенные каны
 * и сброшенный тайл (если рука восстановлена с сервера вместе с счётом —
 * четверка hand+kans+discarded+tiles согласована; пропущенные каны хранятся
 * только локально).
 *
 * Функции чистые (storage инжектится) — тесты в test/daily-hand.test.js.
 */
const STORAGE_KEY = 'mh_daily_hand_v1';

/** @returns {{dayKey: string, hand: string[], kans: string[], skipped: string[], discarded: (string|null)}|null} */
export function readStoredDailyHand(storage = localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      data &&
      typeof data.dayKey === 'string' &&
      Array.isArray(data.hand) &&
      data.hand.length > 0 &&
      data.hand.every((t) => typeof t === 'string')
    ) {
      const kans =
        Array.isArray(data.kans) &&
        data.kans.length <= 4 &&
        data.kans.every((t) => typeof t === 'string')
          ? data.kans
          : [];
      // Пропущенные каны: игрок нажал «Пропустить» — кан больше не
      // предлагаем. До 4 (сколько канов может быть в руке).
      const skipped =
        Array.isArray(data.skipped) &&
        data.skipped.length <= 4 &&
        data.skipped.every((t) => typeof t === 'string')
          ? data.skipped
          : [];
      // Сброшенный тайл дня: рука уже посчитана — повторный сброс
      // невозможен (сброс также зафиксирован на сервере и подтягивается
      // с него на любом устройстве).
      const discarded = typeof data.discarded === 'string' ? data.discarded : null;
      return { dayKey: data.dayKey, hand: data.hand, kans, skipped, discarded };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Записать руку дня — закреплена за этим днём (кнопка неактивна до
 * следующего). discarded — тайл сброса или null (рука ещё не посчитана).
 */
export function writeStoredDailyHand(dayKey, hand, kans = [], skipped = [], discarded = null, storage = localStorage) {
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dayKey,
        hand,
        kans: kans ?? [],
        skipped: skipped ?? [],
        discarded: discarded ?? null,
      }),
    );
  } catch {
    /* localStorage недоступен (приватный режим и т.п.) — играем без закрепления */
  }
}

/**
 * Удалить закреплённую руку дня (аудит H5): рука хранится БЕЗ привязки к
 * пользователю, поэтому при выходе из аккаунта и при смене аккаунта её
 * нужно стирать — иначе чужая (гостевая/прошлая) рука видна новому
 * пользователю и может быть отправлена на его аккаунт.
 */
export function clearStoredDailyHand(storage = localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage недоступен — нечего стирать */
  }
}
