/**
 * M2: добор (drawHand) — за вычетом уже использованных тайлов.
 * Физика: в обороте не больше 4 копий вида (и не больше 1 красной пятёрки) —
 * добор после кана/с синхронизацией не мог выдать ПЯТУЮ копию.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawHand } from '../src/tiles.js';

test('M2: exclude — добор не выдаёт 5-ю копию вида', () => {
  // Игрок держит 4 копии 1m (кан): в стене 1m не осталось.
  for (let i = 0; i < 300; i += 1) {
    const hand = drawHand(14, { exclude: ['1m', '1m', '1m', '1m'] });
    assert.ok(!hand.includes('1m'), `итерация ${i}: 5-я копия 1m невозможна`);
    assert.equal(hand.length, 14);
  }
});

test('M2: exclude — красная пятёрка отдельный тайл (0m ≠ 5m)', () => {
  // 0m уже у игрока → добор не возвращает 0m (в игре одна красная).
  for (let i = 0; i < 300; i += 1) {
    const drawn = drawHand(1, { exclude: ['0m'] });
    assert.ok(drawn[0] !== '0m', `итерация ${i}: вторая 0m невозможна`);
  }
  // …но обычная 5m всё ещё раздаётся (в стене 3 копии 5m + красная).
  let saw5m = false;
  for (let i = 0; i < 500; i += 1) {
    if (drawHand(1, { exclude: ['0m'] })[0] === '5m') { saw5m = true; break; }
  }
  assert.ok(saw5m, '5m раздаётся, если 0m уже использован');
  // И наоборот: 5m в exclude не отзывает красную 0m.
  let saw0m = false;
  for (let i = 0; i < 500; i += 1) {
    if (drawHand(1, { exclude: ['5m'] })[0] === '0m') { saw0m = true; break; }
  }
  assert.ok(saw0m, '0m раздаётся, если 5m уже использован');
});

test('M2: exclude + deadTiles вместе — обе модели сохраняются', () => {
  // Мёртвый тайл изымает из стены ОДНУ копию (индикатор; остальные 3
  // копии в обороте), exclude — точные id (по копии на каждый).
  // 9m мёртв, у игрока 3 копии 1s.
  for (let i = 0; i < 200; i += 1) {
    const hand = drawHand(14, { deadTiles: ['9m'], exclude: ['1s', '1s', '1s'] });
    const nines = hand.filter((t) => t === '9m').length;
    assert.ok(nines <= 3, `итерация ${i}: мёртвая стена изымает одну копию 9m`);
    const ones = hand.filter((t) => t === '1s').length;
    assert.ok(ones <= 1, `итерация ${i}: с учётом 3-х 1s у игрока максимум 1 копия в доборе`);
  }
});
