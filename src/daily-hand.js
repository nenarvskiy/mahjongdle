/**
 * Хранение «руки дня» в localStorage: рука генерируется ОДИН РАЗ в день
 * (кнопка «Сгенерировать руку»), после этого кнопка неактивна до следующего
 * дня, а повторное открытие страницы в тот же день восстанавливает ту же
 * руку. Условия дня (ветра/дора) всё равно берутся из даты, поэтому
 * сохраняем только саму руку и dayKey.
 *
 * Функции чистые (storage инжектится) — тесты в test/daily-hand.test.js.
 */
const STORAGE_KEY = 'mh_daily_hand_v1';

/** @returns {{dayKey: string, hand: string[]}|null} */
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
      return { dayKey: data.dayKey, hand: data.hand };
    }
    return null;
  } catch {
    return null;
  }
}

/** Записать руку дня — закреплена за этим днём (кнопка неактивна до следующего). */
export function writeStoredDailyHand(dayKey, hand, storage = localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ dayKey, hand }));
  } catch {
    /* localStorage недоступен (приватный режим и т.п.) — играем без закрепления */
  }
}
