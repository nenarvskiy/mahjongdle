/**
 * Хранение «руки дня» в localStorage: рука генерируется ОДИН РАЗ в день
 * (кнопка «Сгенерировать руку»), после этого кнопка неактивна до следующего
 * дня, а повторное открытие страницы в тот же день восстанавливает ту же
 * руку. Условия дня (ветра/дора) всё равно берутся из даты, поэтому
 * сохраняем только саму руку, dayKey, объявленные каны и пропущенные каны
 * (если рука восстановлена с сервера вместе с счётом — пара hand+kans
 * согласована; пропущенные каны хранятся только локально).
 *
 * Функции чистые (storage инжектится) — тесты в test/daily-hand.test.js.
 */
const STORAGE_KEY = 'mh_daily_hand_v1';

/** @returns {{dayKey: string, hand: string[], kans: string[], skipped: string[]}|null} */
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
      return { dayKey: data.dayKey, hand: data.hand, kans, skipped };
    }
    return null;
  } catch {
    return null;
  }
}

/** Записать руку дня — закреплена за этим днём (кнопка неактивна до следующего). */
export function writeStoredDailyHand(dayKey, hand, kans = [], skipped = [], storage = localStorage) {
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ dayKey, hand, kans: kans ?? [], skipped: skipped ?? [] }),
    );
  } catch {
    /* localStorage недоступен (приватный режим и т.п.) — играем без закрепления */
  }
}
