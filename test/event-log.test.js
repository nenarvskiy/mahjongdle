/**
 * Тесты лога рук (src/event-log.js): формы payload и защитные проверки
 * (несчитанные руки не уходят на сервер).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxPayload, scorePayload, logHand, updateHandBlock, reportHandBlock } from '../src/event-log.js';

const CTX = {
  dayKey: '2026-10-23',
  roundWindId: 'ew',
  seatWindId: 'sw',
  doraIndicators: ['5m'],
  uraIndicators: ['rd'],
};

test('ctxPayload: только то, что влияет на счёт', () => {
  assert.deepEqual(ctxPayload(CTX), {
    dayKey: '2026-10-23',
    roundWindId: 'ew',
    seatWindId: 'sw',
    doraIndicators: ['5m'],
    uraIndicators: ['rd'],
  });
  assert.deepEqual(ctxPayload(null), {
    dayKey: null, roundWindId: null, seatWindId: null, doraIndicators: [], uraIndicators: [],
  });
});

test('scorePayload: итог, разбивка «что за что», рука и сброс', () => {
  const hand = ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '4s', '5s', '9s', 'rd'];
  const score = {
    total: 1532,
    shanten: 1,
    complete: false,
    tier: { label: 'Normal' },
    state: 1,
    base: 720,
    breakdown: [
      { label: '1-шантен / Normal', points: 720 },
      { label: 'Структуры', points: 312, potential: true },
      { label: 'Таняо', points: 1600, yaku: true },
    ],
    potentialSummary: 'Потенциал: …',
  };
  const p = scorePayload(CTX, { hand, discarded: '9s', remaining: hand.filter((t) => t !== '9s'), score });
  assert.equal(p.total, 1532);
  assert.equal(p.shanten, 1);
  assert.equal(p.tier, 'Normal');
  assert.equal(p.complete, false);
  assert.equal(p.discarded, '9s');
  assert.equal(p.remaining.length, 12);
  assert.deepEqual(p.ctx, ctxPayload(CTX));
  assert.deepEqual(p.breakdown, [
    { label: '1-шантен / Normal', points: 720, yaku: false, potential: false },
    { label: 'Структуры', points: 312, yaku: false, potential: true },
    { label: 'Таняо', points: 1600, yaku: true, potential: false },
  ]);
  assert.equal(p.potentialSummary, 'Потенциал: …');
});

test('scorePayload: без счёта — безопасные null (рука не должна уходить в лог)', () => {
  const p = scorePayload(CTX, { hand: ['1m', '2m'], score: null });
  assert.equal(p.total, null);
  assert.equal(p.breakdown.length, 0);
  assert.deepEqual(p.remaining, ['1m', '2m']);
});

test('logHand: без посчитанного total или с чужим mode — не пишет (null)', async () => {
  assert.equal(await logHand({ mode: 'daily', payload: { hand: ['1m'] } }), null);
  assert.equal(await logHand({ mode: 'nope', payload: { total: 5 } }), null);
});

test('updateHandBlock/reportHandBlock: без id/текста — null', async () => {
  assert.equal(await updateHandBlock(null, { total: 1 }), null);
  assert.equal(await updateHandBlock(5, { hand: [] }), null);
  assert.equal(await reportHandBlock(null, 'текст'), null);
  assert.equal(await reportHandBlock(5, ''), null);
});
