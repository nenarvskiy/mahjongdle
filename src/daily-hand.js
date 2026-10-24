/**
 * Хранение «руки дня» в localStorage: рука генерируется ОДИН РАЗ в день
 * (кнопка «Сгенерировать руку»), после этого кнопка неактивна до следующего
 * дня, а повторное открытие страницы в тот же день восстанавливает ту же
 * руку. Условия дня (ветра/дора) всё равно берутся из даты, поэтому
 * сохраняем только саму руку, dayKey и объявленные каны (если рука
 * восстановлена с сервера вместе с счётом — пара hand+kans согласована).
 *
 * Функции чистые (storage инжектится) — тесты в test/daily-hand.test.js.
 */
const STORAGE_KEY = 'mh_daily_hand_v1';

/** @returns {{dayKey: string, hand: string[], kans: string[]}|null} */
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
      return { dayKey: data.dayKey, hand: data.hand, kans };
    }
    return null;
  } catch {
    return null;
  }
}

/** Записать руку дня — закреплена за этим днём (кнопка неактивна до следующего). */
export function writeStoredDailyHand(dayKey, hand, kans = [], storage = localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ dayKey, hand, kans: kans ?? [] }));
  } catch {
    /* localStorage недоступен (приватный режим и т.п.) — играем без закрепления */
  }
}
