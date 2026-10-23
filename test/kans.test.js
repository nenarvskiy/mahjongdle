/**
 * Тесты канов (src/kans.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findKans, hasKan, withKanPons, countKans,
  kanDoraSlots, openKanDoraCount, KAN_DORA_SLOTS,
} from '../src/kans.js';
import { evaluateHand } from '../src/scoring.js';

const ctx = { roundWindId: 'ew', seatWindId: 'sw', doraIndicators: [], uraIndicators: [] };

test('findKans: четыре одинаковых; красная пятёрка входит в кан пятёрок', () => {
  assert.equal(findKans(['1m', '1m', '1m', '1m', '2p']).length, 1);
  const red = findKans(['0m', '5m', '5m', '5m', '2p']);
  assert.equal(red.length, 1);
  assert.equal(red[0].tile, '5m');
  assert.deepEqual(red[0].tiles, ['0m', '5m', '5m', '5m']);
  assert.equal(findKans(['1m', '1m', '1m', '2p']).length, 0);
  assert.equal(hasKan(['1m', '1m', '1m', '1m']), true);
});

test('findKans: несколько канов в руке', () => {
  const hand = ['1m', '1m', '1m', '1m', '2p', '2p', '2p', '2p', '3s', '4s', '5s'];
  const kans = findKans(hand);
  assert.equal(kans.length, 2);
  assert.deepEqual(kans.map((k) => k.tile).sort(), ['1m', '2p']);
});

test('withKanPons: кан даёт 3 тайла, длина 13/14 сохраняется', () => {
  const concealed10 = ['2m', '3m', '4m', '6p', '7p', '8p', '1s', '2s', '3s', 'rd'];
  const withPon = withKanPons(concealed10, ['5m']);
  assert.equal(withPon.length, 13);
  assert.equal(withPon.filter((t) => t === '5m').length, 3);
  assert.equal(withKanPons([...concealed10, 'wd'], [{ tile: '5m' }]).length, 14);
});

test('кан = фиксированный пон: тенпай и те же очки, что у явного пона', () => {
  const concealed = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p'];
  const score = evaluateHand(withKanPons(concealed, ['5s']), ctx);
  assert.equal(score.shanten, 0);
  assert.equal(evaluateHand([...concealed, '5s', '5s', '5s'], ctx).total, score.total);
});

test('countKans: объявленные + оставшиеся четвёрки', () => {
  assert.equal(countKans([], ['1m', '2m', '3s']), 0);
  assert.equal(countKans(['5m'], ['2p', '2p', '2p', '2p', '3s']), 2);
});

test('кандоры: 1 открыта, каждый кан +1, максимум 5', () => {
  assert.equal(KAN_DORA_SLOTS, 5);
  assert.equal(openKanDoraCount(0), 1);
  assert.equal(openKanDoraCount(1), 2);
  assert.equal(openKanDoraCount(99), 5);
  const slots = kanDoraSlots(['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p'], 2);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map((s) => s.open), [true, true, false, false, false]);
});
