/**
 * Тесты хранения «руки дня» (src/daily-hand.js): рука закрепляется за днём —
 * повторное открытие страницы в тот же день отдаёт ту же руку, на следующий
 * день — новая.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredDailyHand, writeStoredDailyHand } from '../src/daily-hand.js';

/** Мок localStorage. */
function fakeStorage(initial = null) {
  const map = new Map(initial ? [initial] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
}

test('readStoredDailyHand: пусто → null; валидный день → {dayKey, hand}', () => {
  assert.equal(readStoredDailyHand(fakeStorage()), null);
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-23', ['1m', '2m', '3m'], s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m', '2m', '3m'] });
});

test('readStoredDailyHand: чужой день ≠ текущий — решение принимает main.js', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-22', ['1m'], s);
  const data = readStoredDailyHand(s);
  assert.equal(data.dayKey, '2026-10-22'); // сама функция просто читает; dayKey сверяет вызывающий
});

test('readStoredDailyHand: мусор в хранилище → null (не падает)', () => {
  const key = 'mh_daily_hand_v1';
  for (const junk of ['not json', '{"dayKey":1}', '{"dayKey":"x","hand":"y"}', '{"dayKey":"x","hand":[1]}', '[]']) {
    assert.equal(readStoredDailyHand(fakeStorage([key, junk])), null, `для значения ${junk}`);
  }
});

test('writeStoredDailyHand: перезаписывает предыдущий день', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-22', ['1m'], s);
  writeStoredDailyHand('2026-10-23', ['2m', '3m'], s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['2m', '3m'] });
});

test('хранилище недоступно (null) — не падает', () => {
  assert.equal(readStoredDailyHand(null), null);
  writeStoredDailyHand('2026-10-23', ['1m'], null); // void
});
