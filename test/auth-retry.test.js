// 0.7.3: авторетраи API при «холодном старте» Render (405/5xx/HTML-страница).
// Fetch мокнутся в globalThis; задержки — тестовым хуком setApiRetryDelays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitScore, setApiRetryDelays } from '../src/auth.js';

const restore = (t, fetchMock) => {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchMock;
  t.after(() => {
    globalThis.fetch = orig;
    setApiRetryDelays([3000, 7000, 12000, 15000]);
  });
};

test('405 на первой попытке — повтор, результат записан', async (t) => {
  setApiRetryDelays([1, 1]);
  let calls = 0;
  restore(t, async (url, opts) => {
    calls += 1;
    assert.match(String(url), /\/api\/scores$/);
    assert.equal(opts.method, 'POST');
    if (calls === 1) return new Response('{}', { status: 405 });
    return Response.json({ score: 4860, isBest: true, rank: 2 });
  });
  const r = await submitScore('2026-10-28', 4860, {
    discarded: '1p', tiles: [], hand: [], kans: [], complete: false,
  });
  assert.equal(r.score, 4860);
  assert.equal(calls, 2, 'ровно один повтор');
});

test('5xx — повтор; HTML «spinning up» (200) — тоже повтор', async (t) => {
  setApiRetryDelays([1, 1]);
  let calls = 0;
  restore(t, async () => {
    calls += 1;
    if (calls === 1) return new Response('<html>spinning up</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (calls === 2) return new Response('{}', { status: 503 });
    return Response.json({ score: 100, isBest: false, rank: 3 });
  });
  const r = await submitScore('2026-10-28', 100, { discarded: '1p', tiles: [], hand: [] });
  assert.equal(r.rank, 3);
  assert.equal(calls, 3, 'HTML и 503 — два повтора');
});

test('401/400 — без повторов (ошибка пользователя, не холодный старт)', async (t) => {
  setApiRetryDelays([1, 1]);
  let calls = 0;
  restore(t, async () => {
    calls += 1;
    return Response.json({ error: 'нет сессии' }, { status: 401 });
  });
  await assert.rejects(
    () => submitScore('2026-10-28', 100, { discarded: '1p', tiles: [], hand: [] }),
    /нет сессии/,
  );
  assert.equal(calls, 1, 'повторов не было');
});

test('сеть молчит — повторы, затем читаемая ошибка', async (t) => {
  setApiRetryDelays([1, 1]);
  let calls = 0;
  restore(t, async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    () => submitScore('2026-10-28', 100, { discarded: '1p', tiles: [], hand: [] }),
    /нет соединения с сервером/,
  );
  assert.equal(calls, 3, 'начальная + 2 повтора (длина тестовых задержек)');
});
