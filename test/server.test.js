/**
 * Тесты сервера (таблица дня): вход по поддельному Google-токену,
 * сессии, запись/лучший результат/ранги, публичный лидерборд, CORS, валидация.
 * Google в этих тестах не задействован: verifyIdToken — заглушка.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { signSession } from '../server/auth.js';
import { readRolesFile } from '../server/roles.js';

const SECRET = 'test-secret-0123456789';
const DAY = '2026-10-20';

const profile = (id) => ({ id, email: `${id}@example.com`, name: `Игрок ${id}`, picture: null });
const verifyStub = async (idToken) => {
  // «токены» длиннее 20 символов — как у реальных Google ID-токенов
  if (idToken === 'good-token-1-abcdefghijklmnopqrstuvwxyz') return profile('sub-1');
  if (idToken === 'good-token-2-abcdefghijklmnopqrstuvwxyz') return profile('sub-2');
  throw new Error('bad token');
};

let server;
let base;

before(async () => {
  const app = createApp({
    db: openDb(':memory:'),
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    corsOrigins: ['*'],
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function login(idToken) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  return { status: res.status, body: await res.json() };
}

async function postScore(token, body) {
  const res = await fetch(`${base}/api/scores`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('health', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('login: плохой токен → 401', async () => {
  const { status, body } = await login('wrong-token-abcdefghijklmnopqrstuvwxyz');
  assert.equal(status, 401);
  assert.equal(body.error, 'недействительный ID-токен');
  const noToken = await login('');
  assert.equal(noToken.status, 400);
});

test('login: хороший токен → сессия; /api/me работает', async () => {
  const { status, body } = await login('good-token-1-abcdefghijklmnopqrstuvwxyz');
  assert.equal(status, 200);
  assert.equal(body.user.id, 'sub-1');
  assert.equal(body.user.email, 'sub-1@example.com');
  assert.ok(body.token.split('.').length === 3);

  const me = await fetch(`${base}/api/me`, {
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.name, 'Игрок sub-1');

  const meBad = await fetch(`${base}/api/me`, {
    headers: { authorization: `Bearer ${body.token}x` },
  });
  assert.equal(meBad.status, 401);
});

test('scores: без токена → 401, кривые данные → 400', async () => {
  assert.equal((await postScore(null, { date: DAY, score: 1 })).status, 401);
  const token = (await login('good-token-1-abcdefghijklmnopqrstuvwxyz')).body.token;
  assert.equal((await postScore(token, { date: '20.10.2026', score: 1 })).status, 400);
  assert.equal((await postScore(token, { date: DAY, score: -5 })).status, 400);
  assert.equal((await postScore(token, { date: DAY, score: 1.5 })).status, 400);
  assert.equal((await postScore(token, { date: DAY, score: 10 ** 16 })).status, 400);
  assert.equal((await postScore(token, { date: DAY, score: 1, tiles: 'не массив' })).status, 400);
});

test('upsert: лучший результат сохраняется, ранги считаются', async () => {
  const t1 = (await login('good-token-1-abcdefghijklmnopqrstuvwxyz')).body.token;
  const t2 = (await login('good-token-2-abcdefghijklmnopqrstuvwxyz')).body.token;

  let r = (await postScore(t1, { date: DAY, score: 100, discarded: '5m', tiles: ['1m', '2m'] })).body;
  assert.deepEqual(r, { score: 100, isBest: true, rank: 1 });

  r = (await postScore(t1, { date: DAY, score: 50 })).body; // хуже — не обновляет
  assert.deepEqual(r, { score: 100, isBest: false, rank: 1 });

  r = (await postScore(t2, { date: DAY, score: 250 })).body; // второй игрок — выше
  assert.deepEqual(r, { score: 250, isBest: true, rank: 1 });

  r = (await postScore(t1, { date: DAY, score: 200 })).body;
  assert.deepEqual(r, { score: 200, isBest: true, rank: 2 });

  // равенство очков: раннее время — выше
  const r2 = (await postScore(t2, { date: DAY, score: 250 })).body;
  assert.deepEqual(r2, { score: 250, isBest: false, rank: 1 });
});

test('leaderboard: порядок, ограничение, другая дата пуста', async () => {
  const res = await fetch(`${base}/api/scores/${DAY}?limit=10`);
  assert.equal(res.status, 200);
  const { date, rows } = await res.json();
  assert.equal(date, DAY);
  assert.equal(rows.length, 2);
  // рука не сохранялась (счёт без day_hand) — hand: null, каны [], complete false
  assert.deepEqual(rows[0], {
    id: 'sub-2', name: 'Игрок sub-2', picture: null, score: 250, discarded: null,
    hand: null, kans: [], complete: false,
  });
  assert.equal(rows[1].score, 200);

  const one = await (await fetch(`${base}/api/scores/${DAY}?limit=1`)).json();
  assert.equal(one.rows.length, 1);

  const empty = await (await fetch(`${base}/api/scores/2026-01-01`)).json();
  assert.deepEqual(empty.rows, []);

  const badDate = await fetch(`${base}/api/scores/2026-13-99`);
  assert.equal(badDate.status, 400);
});

test('CORS: заголовки для фронтенда', async () => {
  const res = await fetch(`${base}/health`, { headers: { origin: 'https://game.example' } });
  assert.ok(res.headers.get('access-control-allow-origin'));
  const opt = await fetch(`${base}/api/scores`, {
    method: 'OPTIONS',
    headers: { origin: 'https://game.example', 'access-control-request-method': 'POST' },
  });
  assert.equal(opt.status, 204);
  assert.ok(opt.headers.get('access-control-allow-headers').includes('Authorization'));
});

test('сессия: токен с другим секретом не проходит', async () => {
  const foreign = signSession({ id: 'sub-1', email: 'sub-1@example.com', name: 'x' }, 'другой-секрет-1234567890');
  const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${foreign}` } });
  assert.equal(me.status, 401);
});

test('статика: игра на том же origin, что и API; белым списком', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(html.includes('Mahjongdle'), 'корень отдаёт index.html игры');

  for (const p of ['/src/main.js', '/styles.css', '/config/auth.json', '/assets/tiles/1m.svg']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} должен отдаваться`);
  }
  // auth.json отдаётся как есть: googleClientId + apiBaseUrl (строки; адрес
  // бекенда может быть пустым = тот же origin или абсолютным URL Render)
  const authCfg = await (await fetch(`${base}/config/auth.json`)).json();
  assert.equal(typeof authCfg.googleClientId, 'string');
  assert.equal(typeof authCfg.apiBaseUrl, 'string');

  // остальное репозитория — не раздаётся
  for (const p of ['/stats/scorestat.py', '/package.json', '/test/server.test.js', '/server/app.js']) {
    assert.equal((await fetch(`${base}${p}`)).status, 404, `${p} не должен отдаваться`);
  }
});

// --- Роли: admin / test / player (player по умолчанию) ---

test('роли: файл, логин, /api/me, панель admin, hot-reload', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mj-roles-'));
  const rolesFile = path.join(dir, 'roles.json');
  writeFileSync(
    rolesFile,
    JSON.stringify({ admin: ['sub-1@example.com'], test: ['sub-2@example.com'] }),
    'utf8',
  );

  let roleServer;
  const app = createApp({
    db: openDb(':memory:'),
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    rolesFile,
  });
  await new Promise((resolve) => {
    roleServer = app.listen(0, '127.0.0.1', resolve);
  });
  const b = `http://127.0.0.1:${roleServer.address().port}`;

  const loginAt = async (idToken) => {
    const res = await fetch(`${b}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    return { status: res.status, body: await res.json() };
  };
  const adminTok = (await loginAt('good-token-1-abcdefghijklmnopqrstuvwxyz')).body.token;
  const testTok = (await loginAt('good-token-2-abcdefghijklmnopqrstuvwxyz')).body.token;

  // логин возвращает роль; по умолчанию (не в списках) — player
  const meAdmin = await fetch(`${b}/api/me`, { headers: { authorization: `Bearer ${adminTok}` } });
  assert.equal((await meAdmin.json()).user.role, 'admin');
  const meTest = await fetch(`${b}/api/me`, { headers: { authorization: `Bearer ${testTok}` } });
  assert.equal((await meTest.json()).user.role, 'test');

  // GET /api/roles: admin — 200, test — 403, без сессии — 401
  const getOk = await fetch(`${b}/api/roles`, { headers: { authorization: `Bearer ${adminTok}` } });
  assert.equal(getOk.status, 200);
  assert.deepEqual(await getOk.json(), { admin: ['sub-1@example.com'], test: ['sub-2@example.com'] });
  assert.equal(
    (await fetch(`${b}/api/roles`, { headers: { authorization: `Bearer ${testTok}` } })).status,
    403,
  );
  assert.equal((await fetch(`${b}/api/roles`)).status, 401);

  // POST /api/roles: admin добавляет аккаунт в test (файл меняется, без рестарта)
  const post = (tok, body) =>
    fetch(`${b}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
  let r = await post(adminTok, { email: 'New@Test.example', role: 'test' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).test, ['new@test.example', 'sub-2@example.com']);

  // не admin → 403; некорректные email/роль → 400
  assert.equal((await post(testTok, { email: 'x@y.z', role: 'admin' })).status, 403);
  assert.equal((await post(adminTok, { email: 'not-an-email', role: 'test' })).status, 400);
  assert.equal((await post(adminTok, { email: 'x@y.z', role: 'moderator' })).status, 400);

  // 'player' — убрать из списков
  r = await post(adminTok, { email: 'sub-2@example.com', role: 'player' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { admin: ['sub-1@example.com'], test: ['new@test.example'] });

  // файл на диске — тот же (источник правды, hot-reload: перечитывается на каждый запрос)
  assert.deepEqual(await readRolesFile(rolesFile), {
    admin: ['sub-1@example.com'],
    test: ['new@test.example'],
  });

  await new Promise((resolve) => roleServer.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// --- Сквозной лог: блок = посчитанная рука (счёт внутри, жалоба в блоке) ---

test('events: блок руки со счётом, PATCH, жалоба, admin-просмотр, 400/403', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mj-events-'));
  const rolesFile = path.join(dir, 'roles.json');
  writeFileSync(rolesFile, JSON.stringify({ admin: ['sub-1@example.com'] }), 'utf8');

  let evServer;
  const app = createApp({
    db: openDb(':memory:'),
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    rolesFile,
  });
  await new Promise((resolve) => {
    evServer = app.listen(0, '127.0.0.1', resolve);
  });
  const b = `http://127.0.0.1:${evServer.address().port}`;

  const post = (tok, body) =>
    fetch(`${b}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify(body),
    });

  // пишутся ТОЛЬКО посчитанные руки: без total — 400
  assert.equal((await post(null, { mode: 'daily', kind: 'hand', payload: { hand: ['1m'] } })).status, 400);
  // кривой mode/kind — 400
  assert.equal((await post(null, { mode: 'x', kind: 'hand', payload: { total: 1 } })).status, 400);
  assert.equal((await post(null, { mode: 'daily', kind: 'deal', payload: { total: 1 } })).status, 400);
  assert.equal(
    (await post(null, { mode: 'daily', kind: 'hand', payload: { total: 1, big: 'x'.repeat(30_000) } })).status,
    400,
  );

  // аноним со счётом — можно (user_* = null)
  const anonRes = await post(null, { mode: 'daily', kind: 'hand', payload: { hand: ['1m'], total: 120, breakdown: [] } });
  assert.equal(anonRes.status, 200);

  // логины: sub-1 — admin по файлу ролей, sub-2 — player
  const loginAt = async (idToken) => {
    const res = await fetch(`${b}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    return (await res.json()).token;
  };
  const t1 = await loginAt('good-token-1-abcdefghijklmnopqrstuvwxyz');
  const t2 = await loginAt('good-token-2-abcdefghijklmnopqrstuvwxyz');

  const created = await post(t1, {
    mode: 'test',
    kind: 'hand',
    payload: { hand: ['1m', '2m'], total: 900, breakdown: [{ label: 'Таняо', points: 1600, yaku: true }] },
  });
  assert.equal(created.status, 200);
  const blockId = (await created.json()).id;

  // PATCH пересчёта: владелец — 200, чужой — 404
  const patch = (tok, payload) =>
    fetch(`${b}/api/events/${blockId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ payload }),
    });
  const patched = await patch(t1, { hand: ['1m', '2m'], total: 1500 });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).payload.total, 1500);
  assert.equal((await patch(t2, { total: 1 })).status, 404);

  // жалоба прикладывается к блоку
  const report = (tok, text) =>
    fetch(`${b}/api/events/${blockId}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ text }),
    });
  const rep = await report(t1, 'очки считаются неверно');
  assert.equal(rep.status, 200);
  assert.equal((await rep.json()).report.text, 'очки считаются неверно');
  assert.equal((await report(t1, '   ')).status, 400);
  assert.equal((await report(t2, 'чужая рука')).status, 404);

  // чтение: admin — все блоки; reports=1 — только с жалобой
  const all = await (await fetch(`${b}/api/events?limit=10`, { headers: { authorization: `Bearer ${t1}` } })).json();
  assert.equal(all.rows.length, 2);
  assert.equal(all.rows[0].kind, 'hand');
  assert.equal(all.rows[0].user_name, 'Игрок sub-1');
  assert.equal(all.rows[1].user_id, null); // аноним

  const reps = await (await fetch(`${b}/api/events?reports=1`, { headers: { authorization: `Bearer ${t1}` } })).json();
  assert.equal(reps.rows.length, 1);
  assert.equal(reps.rows[0].payload.report.text, 'очки считаются неверно');

  assert.equal((await fetch(`${b}/api/events`, { headers: { authorization: `Bearer ${t2}` } })).status, 403);
  assert.equal((await fetch(`${b}/api/events`)).status, 401);

  // PATCH сохраняет ранее оставленную жалобу (слияние payload)
  assert.equal((await (await patch(t1, { hand: ['1m', '2m'], total: 777 })).json()).payload.total, 777);
  const after = await (await fetch(`${b}/api/events?reports=1`, { headers: { authorization: `Bearer ${t1}` } })).json();
  assert.equal(after.rows[0].payload.total, 777);
  assert.equal(after.rows[0].payload.report.text, 'очки считаются неверно');

  await new Promise((resolve) => evServer.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// --- Вчерашняя рука и ночной пересчёт (ура-доры + кандоры) ---

test('вчерашняя рука: day_hands, пересчёт с ура-дорами, таблица дня меняется', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mj-yday-'));
  let srv;
  const app = createApp({
    db: openDb(':memory:'),
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    rolesFile: path.join(dir, 'roles.json'),
  });
  await new Promise((resolve) => { srv = app.listen(0, '127.0.0.1', resolve); });
  const b = `http://127.0.0.1:${srv.address().port}`;

  const login = async (idToken) => {
    const res = await fetch(`${b}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    return (await res.json()).token;
  };
  const token = await login('good-token-1-abcdefghijklmnopqrstuvwxyz');
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  const TODAY = '2026-10-23';
  const YDAY = '2026-10-22';

  // без сессии — 401
  assert.equal((await fetch(`${b}/api/me/yesterday?date=${TODAY}`)).status, 401);
  // кривая дата — 400
  assert.equal((await fetch(`${b}/api/me/yesterday?date=2026-13-99`, { headers: auth })).status, 400);
  // до первой сдачи — руки нет
  let r = await fetch(`${b}/api/me/yesterday?date=${TODAY}`, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).hand, null);
  assert.equal((await (await fetch(`${b}/api/me/yesterday?date=${TODAY}`, { headers: auth })).json()).dayKanCount, 0);

  // сдача вчерашней готовой руки с каном
  const hand = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','5s','5s'];
  const post = await fetch(`${b}/api/scores`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      date: YDAY,
      score: 1234,
      discarded: null,
      tiles: hand,
      hand,
      kans: ['9s'],
      complete: true,
      dayCtx: { dayKey: YDAY, doraIndicators: [], uraIndicators: [] },
    }),
  });
  assert.equal(post.status, 200);

  // вчерашняя рука: возвращает руку и каны, пересчёт уже произошёл
  r = await fetch(`${b}/api/me/yesterday?date=${TODAY}`, { headers: auth });
  assert.equal(r.status, 200);
  const y = await r.json();
  assert.equal(y.date, YDAY);
  assert.equal(y.hand.length, 14);
  assert.deepEqual(y.kans, ['9s']);
  assert.equal(y.recalculated, true);
  assert.equal(typeof y.newScore, 'number');
  assert.equal(typeof y.changed, 'boolean');
  // Суммарные каны дня (здесь — один, наш) определяют открывшиеся доры.
  assert.equal(y.dayKanCount, 1);

  // повторный запрос — без нового пересчёта (флаг), счёт тот же
  const again = await (await fetch(`${b}/api/me/yesterday?date=${TODAY}`, { headers: auth })).json();
  assert.equal(again.newScore, y.newScore);

  // таблица дня вчера: очки обновлены после пересчёта
  const lb = await (await fetch(`${b}/api/scores/${YDAY}`)).json();
  assert.equal(lb.rows.length, 1);
  assert.equal(lb.rows[0].score, y.newScore);

  await new Promise((resolve) => srv.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// ── Рука дня на сервере: черновик при генерации, восстановление, защита ──
const HDATE = '2026-11-01';
const HAND14 = ['1m','1m','2m','3m','4m','5p','5p','6p','7s','8s','9s','ew','ew','1s'];

test('me/hand: без сессии → 401', async () => {
  const r = await fetch(`${base}/api/me/hand/${HDATE}`);
  assert.equal(r.status, 401);
  const p = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: HDATE, hand: HAND14 }),
  });
  assert.equal(p.status, 401);
});

test('me/hand: черновик при генерации и восстановление', async () => {
  const { body } = await login('good-token-2-abcdefghijklmnopqrstuvwxyz');
  const auth = { authorization: `Bearer ${body.token}` };

  const post = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ date: HDATE, hand: HAND14, dayCtx: { dayKey: HDATE } }),
  });
  assert.equal(post.status, 200);

  const get = await fetch(`${base}/api/me/hand/${HDATE}`, { headers: auth });
  assert.equal(get.status, 200);
  const row = await get.json();
  assert.deepEqual(row.hand, HAND14);
  assert.equal(row.score, 0);
  assert.equal(row.complete, false);
  assert.equal(row.tiles, null);

  // кривая рука отклоняется
  const bad = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ date: HDATE, hand: HAND14.slice(0, 13) }),
  });
  assert.equal(bad.status, 400);

  // другой день без руки → hand: null
  const empty = await fetch(`${base}/api/me/hand/2026-11-02`, { headers: auth });
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).hand, null);
});

test('me/hand: черновик не затирает руку со счётом (после сброса)', async () => {
  const { body } = await login('good-token-2-abcdefghijklmnopqrstuvwxyz');
  const auth = { authorization: `Bearer ${body.token}` };

  // игрок сбросил: счёт + tiles записаны через /api/scores
  const post = await postScore(body.token, {
    date: HDATE,
    score: 5000,
    discarded: '1s',
    tiles: HAND14.filter((t) => t !== '1s'),
    hand: HAND14,
    complete: false,
    dayCtx: { dayKey: HDATE },
  });
  assert.equal(post.status, 200);

  // повторная синхронизация «черновика» не затирает данные со счётом
  const sync = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ date: HDATE, hand: ['9m','9m','9m','9m','1p','1p','1p','2p','3p','4p','5p','6p','7p','8p'] }),
  });
  assert.equal(sync.status, 200);

  const row = await (await fetch(`${base}/api/me/hand/${HDATE}`, { headers: auth })).json();
  assert.equal(row.score, 5000);
  assert.equal(row.discarded, '1s');
  assert.equal(row.tiles.length, 13);
  assert.deepEqual(row.hand, HAND14);
});

test('me/hands: история рук; строки таблицы несут руку для просмотра', async () => {
  // без сессии → 401
  const anon = await fetch(`${base}/api/me/hands`);
  assert.equal(anon.status, 401);

  const { body } = await login('good-token-2-abcdefghijklmnopqrstuvwxyz');
  const auth = { authorization: `Bearer ${body.token}` };

  // история sub-2: день HDATE (черновик + счёт 5000 из предыдущего теста)
  const list = await (await fetch(`${base}/api/me/hands`, { headers: auth })).json();
  assert.ok(Array.isArray(list.rows));
  assert.ok(list.rows.length >= 1);
  assert.equal(list.rows[0].date, HDATE); // новые даты первыми
  const row = list.rows.find((r) => r.date === HDATE);
  assert.deepEqual(row.hand, HAND14);
  assert.equal(row.score, 5000);
  assert.equal(row.complete, false);

  // строка таблицы дня несёт руку и каны (клик по строке → просмотр)
  const lb = await (await fetch(`${base}/api/scores/${HDATE}`)).json();
  assert.equal(lb.rows.length, 1);
  assert.deepEqual(lb.rows[0].hand, HAND14);
  assert.deepEqual(lb.rows[0].kans, []);
  assert.equal(lb.rows[0].complete, false);
});

// ── Админ-реиздус руки дня + публичные каны дня ──

test('admin reissue: новая рука заменяет старую, счёт удаляется, 1 рука/день', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mj-reissue-'));
  const rolesFile = path.join(dir, 'roles.json');
  writeFileSync(rolesFile, JSON.stringify({ admin: ['sub-1@example.com'] }), 'utf8');
  let srv;
  const app = createApp({
    db: openDb(':memory:'),
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    rolesFile,
  });
  await new Promise((resolve) => { srv = app.listen(0, '127.0.0.1', resolve); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  const loginAt = async (idToken) => {
    const res = await fetch(`${b}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    return (await res.json()).token;
  };
  const adminTok = await loginAt('good-token-1-abcdefghijklmnopqrstuvwxyz');
  const playerTok = await loginAt('good-token-2-abcdefghijklmnopqrstuvwxyz');
  const authA = { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` };
  const authP = { 'content-type': 'application/json', authorization: `Bearer ${playerTok}` };
  const reissue = (headers, body) =>
    fetch(`${b}/api/admin/hand/reissue`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  const RDATE = '2026-10-25';

  // без сессии → 401; не admin → 403
  const anonRes = await fetch(`${b}/api/admin/hand/reissue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: RDATE }) });
  assert.equal(anonRes.status, 401);
  assert.equal((await reissue(authP, { date: RDATE })).status, 403);
  // кривая дата → 400
  assert.equal((await reissue(authA, { date: '2026-13-99' })).status, 400);

  // admin (sub-1) генерирует руку дня
  let r = await reissue(authA, { date: RDATE });
  assert.equal(r.status, 200);
  const first = await r.json();
  assert.equal(first.date, RDATE);
  assert.equal(first.hand.length, 14);

  // игрок сыграл: сброс + счёт + кан
  const post = await fetch(`${b}/api/scores`, {
    method: 'POST',
    headers: authA,
    body: JSON.stringify({
      date: RDATE, score: 12345, discarded: first.hand[13], tiles: first.hand.slice(0, 13),
      hand: first.hand, kans: ['5m'], complete: false,
      dayCtx: { dayKey: RDATE, doraIndicators: [], uraIndicators: [], roundWindId: 'ew', seatWindId: 'ew' },
    }),
  });
  assert.equal(post.status, 200);
  // кан виден публично
  let k = await (await fetch(`${b}/api/daily/kans?date=${RDATE}`)).json();
  assert.deepEqual(k.kans, [{ name: 'Игрок sub-1', kanCount: 1 }]);
  assert.equal((await fetch(`${b}/api/daily/kans?date=2026-13-99`)).status, 400);
  assert.equal((await (await fetch(`${b}/api/daily/kans?date=2026-10-26`)).json()).kans.length, 0);

  // реиздус: НОВАЯ рука, старые счёт/кан/сброс удалены
  r = await reissue(authA, { date: RDATE });
  assert.equal(r.status, 200);
  const second = await r.json();
  assert.notDeepEqual(second.hand, first.hand, 'рука другая');
  const row = await (await fetch(`${b}/api/me/hand/${RDATE}`, { headers: authA })).json();
  assert.deepEqual(row.hand, second.hand);
  assert.equal(row.score, 0);
  assert.equal(row.complete, false);
  assert.equal(row.tiles, null);
  assert.deepEqual(row.kans, []);
  // из таблицы дня результат ушёл
  const lb = await (await fetch(`${b}/api/scores/${RDATE}`)).json();
  assert.equal(lb.rows.length, 0);
  // каны дня после реиздуса — пустые
  k = await (await fetch(`${b}/api/daily/kans?date=${RDATE}`)).json();
  assert.deepEqual(k.kans, []);

  await new Promise((resolve) => srv.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test('kans: повторная отправка счёта с пустыми kans не стирает объявленные каны', async () => {
  const { body } = await login('good-token-2-abcdefghijklmnopqrstuvwxyz');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${body.token}` };
  const KDATE = '2026-10-21';
  const HAND = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', 'sw', 'nw'];
  const dayCtx = { dayKey: KDATE, doraIndicators: [], uraIndicators: [], roundWindId: 'ew', seatWindId: 'ew' };

  // 1-я отправка: игрок объявил кан
  let r = await fetch(`${base}/api/scores`, {
    method: 'POST', headers,
    body: JSON.stringify({
      date: KDATE, score: 2000, discarded: '4p', tiles: HAND.slice(0, 13),
      hand: HAND, kans: ['1m'], complete: false, dayCtx,
    }),
  });
  assert.equal(r.status, 200);

  // 2-я отправка — эмуляция перезагрузки страницы старым клиентом
  // (declaredKans не восстановлен → kans: []): счёт хуже, каны пустые
  r = await fetch(`${base}/api/scores`, {
    method: 'POST', headers,
    body: JSON.stringify({
      date: KDATE, score: 1000, discarded: '4p', tiles: HAND.slice(0, 13),
      hand: HAND, kans: [], complete: false, dayCtx,
    }),
  });
  assert.equal(r.status, 200);

  // кан дня сохранился (каны только накапливаются)
  const row = await (await fetch(`${base}/api/me/hand/${KDATE}`, { headers })).json();
  assert.deepEqual(row.kans, ['1m']);
  const k = await (await fetch(`${base}/api/daily/kans?date=${KDATE}`)).json();
  assert.deepEqual(k.kans, [{ name: 'Игрок sub-2', kanCount: 1 }]);
});
