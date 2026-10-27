/**
 * Тесты синхронизации канов с сервера (src/hand-sync.js) — аудит №2 (0.7.1):
 * доборы после 2+ канов не дают 5-ю копию тайла. Логика вынесена из
 * src/main.js (DOM-модуль) именно для покрываемости тестами.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyServerKansToDraft } from '../src/hand-sync.js';
import { canonicalTileId } from '../src/tiles.js';

const countsOf = (arr) => {
  const m = new Map();
  for (const t of arr) {
    const c = canonicalTileId(t);
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
};

test('2 кана: ни один вид не получает 5-й тайл, форма 14 − 3×каны (аудит №2)', () => {
  // Черновик с двумя четвёрками: раньше доборы делали раздельными
  // drawHand(1) от одной стены — с вероятностью ~N²/2N оба возврата
  // совпадали (в репро аудита: 36 из 300 000 синхронизаций, 8p×5, 2m×3).
  const draft = ['3p', '3p', '3p', '3p', '4s', '4s', '4s', '4s', '8p', '8p', '8p', '2m', '2m', '2m'];
  for (let i = 0; i < 500; i += 1) {
    const hand = applyServerKansToDraft(draft, ['3p', '4s'], []);
    assert.equal(hand.length, 8, '14 − 6 + 2 добора = 8');
    for (const [kind, n] of countsOf(hand)) {
      assert.ok(n <= 4, `вид ${kind} — ${n} копий (5-я копия невозможна): ${JSON.stringify([...countsOf(hand)])}`);
    }
    // Тайлы обоих канов полностью вынесены.
    assert.equal(countsOf(hand).get('3p') ?? 0, 0);
    assert.equal(countsOf(hand).get('4s') ?? 0, 0);
  }
});

test('1 кан: выносятся все 4 тайла, добирается ровно 1 тайл', () => {
  const draft = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '5s', '6s', '7s', '8s', '9s', 'ew', 'sw'];
  const hand = applyServerKansToDraft(draft, ['1m'], []);
  assert.equal(hand.length, 11, '14 − 3');
  assert.equal(countsOf(hand).get('1m') ?? 0, 0, 'все 4 тайла кана вынесены');
});

test('красный id кана канонизируется (кан пятёрок «0m» = вид 5m)', () => {
  const draft = ['0m', '5m', '5m', '5m', '1p', '2p', '3p', '1s', '2s', '3s', '1s', '2s', '3s', 'ew'];
  const hand = applyServerKansToDraft(draft, ['0m'], []);
  assert.equal(hand.length, 11);
  assert.equal(countsOf(hand).get('5m') ?? 0, 0, 'красная + обычные — все вынесены');
});
