/**
 * Тесты хранения «руки дня» (src/daily-hand.js): рука закрепляется за днём —
 * повторное открытие страницы в тот же день отдаёт ту же руку, на следующий
 * день — новая. Сохраняются также объявленные каны дня (восстановление
 * согласованной пары hand+kans после перезагрузки), пропущенные каны
 * (игрок нажал «Пропустить» — кан не предлагать повторно) и сброшенный тайл
 * (рука посчитана — повторный сброс невозможен).
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

test('readStoredDailyHand: пусто → null; валидный день → {dayKey, hand, kans: [], skipped: [], discarded: null}', () => {
  assert.equal(readStoredDailyHand(fakeStorage()), null);
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-23', ['1m', '2m', '3m'], [], [], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m', '2m', '3m'], kans: [], skipped: [], discarded: null });
});

test('readStoredDailyHand: каны сохраняются и восстанавливаются', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-23', ['1m', '2m', '3m'], ['9m'], [], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m', '2m', '3m'], kans: ['9m'], skipped: [], discarded: null });
});

test('readStoredDailyHand: пропущенные каны сохраняются и восстанавливаются', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-23', ['1m', '2m', '3m'], [], ['5p'], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m', '2m', '3m'], kans: [], skipped: ['5p'], discarded: null });

  // Кан + пропуск одновременно (объявил один, пропустил другой).
  writeStoredDailyHand('2026-10-23', ['1m', '2m', '3m'], ['9m'], ['5p', '1s'], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m', '2m', '3m'], kans: ['9m'], skipped: ['5p', '1s'], discarded: null });
});

test('readStoredDailyHand: сброшенный тайл сохраняется и восстанавливается', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-23', ['1m', '2m', '3m'], ['9m'], [], '3m', s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m', '2m', '3m'], kans: ['9m'], skipped: [], discarded: '3m' });

  // Новая запись без сброса стирает закреплённый сброс (ре-ишю / новая рука).
  writeStoredDailyHand('2026-10-23', ['4m', '5m'], [], [], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['4m', '5m'], kans: [], skipped: [], discarded: null });
});

test('readStoredDailyHand: чужой день ≠ текущий — решение принимает main.js', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-22', ['1m'], [], [], null, s);
  const data = readStoredDailyHand(s);
  assert.equal(data.dayKey, '2026-10-22'); // сама функция просто читает; dayKey сверяет вызывающий
});

test('readStoredDailyHand: мусор в хранилище → null (не падает)', () => {
  const key = 'mh_daily_hand_v1';
  for (const junk of ['not json', '{"dayKey":1}', '{"dayKey":"x","hand":"y"}', '{"dayKey":"x","hand":[1]}', '[]']) {
    assert.equal(readStoredDailyHand(fakeStorage([key, junk])), null, `для значения ${junk}`);
  }
  // каны-мусор не валидны → kans просто [], рука остаётся
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-23', ['1m'], 'nope', [], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['1m'], kans: [], skipped: [], discarded: null });
  // пропуски-мусор (не массив / >4 / не строки) → skipped просто []
  const s2 = fakeStorage([
    'mh_daily_hand_v1',
    '{"dayKey":"2026-10-23","hand":["1m"],"skipped":"5p"}',
  ]);
  assert.deepEqual(readStoredDailyHand(s2), { dayKey: '2026-10-23', hand: ['1m'], kans: [], skipped: [], discarded: null });
  const s3 = fakeStorage([
    'mh_daily_hand_v1',
    '{"dayKey":"2026-10-23","hand":["1m"],"skipped":["a","b","c","d","e"]}',
  ]);
  assert.deepEqual(readStoredDailyHand(s3), { dayKey: '2026-10-23', hand: ['1m'], kans: [], skipped: [], discarded: null });
  // discarded-мусор (не строка) → null, рука остаётся
  const s4 = fakeStorage([
    'mh_daily_hand_v1',
    '{"dayKey":"2026-10-23","hand":["1m"],"discarded":"5m"}',
  ]);
  assert.deepEqual(readStoredDailyHand(s4), { dayKey: '2026-10-23', hand: ['1m'], kans: [], skipped: [], discarded: '5m' });
  const s5 = fakeStorage([
    'mh_daily_hand_v1',
    '{"dayKey":"2026-10-23","hand":["1m"],"discarded":5}',
  ]);
  assert.deepEqual(readStoredDailyHand(s5), { dayKey: '2026-10-23', hand: ['1m'], kans: [], skipped: [], discarded: null });
});

test('writeStoredDailyHand: перезаписывает предыдущий день', () => {
  const s = fakeStorage();
  writeStoredDailyHand('2026-10-22', ['1m'], [], [], null, s);
  writeStoredDailyHand('2026-10-23', ['2m', '3m'], [], [], null, s);
  assert.deepEqual(readStoredDailyHand(s), { dayKey: '2026-10-23', hand: ['2m', '3m'], kans: [], skipped: [], discarded: null });
});

test('хранилище недоступно (null) — не падает', () => {
  assert.equal(readStoredDailyHand(null), null);
  writeStoredDailyHand('2026-10-23', ['1m'], [], [], null, null); // void
});
