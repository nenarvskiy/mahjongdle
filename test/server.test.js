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
import { createApp, mskToday } from '../server/app.js';
import { openDb, pruneEvents, insertEvent } from '../server/db.js';
import { signSession } from '../server/auth.js';
import { readRolesFile } from '../server/roles.js';
import { createDeadWall, createDailyContext, doraFromIndicator } from '../src/daily-context.js';
import { allTileIds } from '../src/tiles.js';
import { computeDayScore, recalcScore } from '../server/recalc.js';

const SECRET = 'test-secret-0123456789';
// «Сегодня»/«вчера»/«завтра» — серверные (МСК): сервер принимает только
// сегодняшний день (аудит F2a/F2c), поэтому тесты работают с реальными датами.
const DAY = mskToday();
const YDAY = (() => {
  const [y, m, d] = DAY.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
})();
const TOMORROW = (() => {
  const [y, m, d] = DAY.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
})();
/** Тайлы НЕ из мёртвой стены дня (детерминированные руки без тайлов стены). */
function liveIds(dateKey, n, except = []) {
  const dead = new Set(createDailyContext(new Date(`${dateKey}T12:00:00Z`)).deadTiles);
  return allTileIds().filter((t) => !dead.has(t) && !except.includes(t)).slice(0, n);
}
/**
 * Аудит №1 (0.7.1): выигрышная рука С КАНОМ, независимая от календарной
 * даты. Вид кана берётся из живых (не в мёртвой стене) номеров масти m —
 * кан требует 4 копии, а у вида из стены оборот всего 3; чи в шаблоне
 * не пересекается с номером кана. 9 кандидатов: вероятность, что все в
 * стене, ~(10/136)^9 — нереалистична (на такой день тест упадёт явным
 * throw, а не тихим 400).
 * @returns {{kan:string, draft14:string[], full14:string[], drawn:string}}
 *   draft14 — 14 с 4 тайлами кана; full14 — пон-форма 14 (3 тайла кана +
 *   добор drawn); оба валидны для дня dateKey.
 */
function kanWinningHand(dateKey) {
  const dead = new Set(createDailyContext(new Date(`${dateKey}T12:00:00Z`)).deadTiles);
  for (let n = 1; n <= 9; n += 1) {
    const kan = `${n}m`;
    if (dead.has(kan)) continue;
    const chii = n === 1 ? ['2m', '3m', '4m'] : n === 2 ? ['3m', '4m', '5m']
      : n === 3 ? ['4m', '5m', '6m'] : ['1m', '2m', '3m'];
    // Все некан-виды — по 1–2 копии (даже из мёртвой стены ≤3 — валидно).
    const draft14 = [kan, kan, kan, kan, ...chii, '1p', '2p', '3p', '7s', '8s', '9s', 'ww'];
    const full14 = [kan, kan, kan, ...chii, '1p', '2p', '3p', '7s', '8s', '9s', 'ww', 'ww'];
    return { kan, draft14, full14, drawn: 'ww' };
  }
  throw new Error(`день ${dateKey}: все 9 м-кандидатов в мёртвой стене — сценарий невозможен`);
}
// Рука, общая для тестов scores/leaderboard: 14 тайлов, ≤1 копия каждого id
// (по 1 копии тайлов мёртвой стены — физически допустимо).
const HAND_SHARED = ['1m', '2m', '3m', '4m', '5m', '6p', '7p', '8p', '9p', '1s', '2s', '3s', 'ew', 'sw'];

const profile = (id) => ({ id, email: `${id}@example.com`, name: `Игрок ${id}`, picture: null });
const verifyStub = async (idToken) => {
  // «токены» длиннее 20 символов — как у реальных Google ID-токенов
  if (idToken === 'good-token-1-abcdefghijklmnopqrstuvwxyz') return profile('sub-1');
  if (idToken === 'good-token-2-abcdefghijklmnopqrstuvwxyz') return profile('sub-2');
  if (idToken === 'good-token-3-abcdefghijklmnopqrstuvwxyz') return profile('sub-3');
  if (idToken === 'good-token-4-abcdefghijklmnopqrstuvwxyz') return profile('sub-4');
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

/** Зафиксировать черновик руки дня (K2: без черновика результат не сдаётся). */
async function postDraft(token, date, hand) {
  const res = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ date, hand }),
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

// Счёт пересчитывается сервером (F2a): в тестах ждём значение из
// computeDayScore — то же правило, что на сервере.
function dayScore(discarded) {
  return computeDayScore({
    tiles: HAND_SHARED.filter((t) => t !== discarded),
    hand: HAND_SHARED, kans: [], complete: false, dayKey: DAY,
  });
}

test('scores: 1 результат в день — повтор игрока не пишется, ранги считаются', async () => {
  const t1 = (await login('good-token-1-abcdefghijklmnopqrstuvwxyz')).body.token;
  const t2 = (await login('good-token-2-abcdefghijklmnopqrstuvwxyz')).body.token;
  // Оба игрока — одна и та же рука и сброс: сервер посчитает один и тот же счёт.
  const discarded = HAND_SHARED[13];
  const tiles = HAND_SHARED.filter((t) => t !== discarded);
  const S = dayScore(discarded);

  // K2: сначала фиксируем выданную руку (черновик) — результат сдаётся
  // только против неё.
  assert.equal((await postDraft(t1, DAY, HAND_SHARED)).status, 200);
  assert.equal((await postDraft(t2, DAY, HAND_SHARED)).status, 200);

  let r = (await postScore(t1, { date: DAY, score: 100, discarded, tiles, hand: HAND_SHARED })).body;
  assert.deepEqual(r, { score: S, isBest: true, rank: 1 });

  // повторная отправка (перезагрузка страницы, вторая вкладка) с ДРУГИМ
  // счётом — БД не трогается: сервер возвращает зафиксированный результат
  r = (await postScore(t1, { date: DAY, score: S + 1, discarded, tiles, hand: HAND_SHARED })).body;
  assert.deepEqual(r, { score: S, isBest: false, rank: 1 });

  // второй игрок — тот же счёт: ранг при равенстве — по времени (раньше выше)
  r = (await postScore(t2, { date: DAY, score: 1, discarded, tiles, hand: HAND_SHARED })).body;
  assert.deepEqual(r, { score: S, isBest: true, rank: 2 });

  // повтор второго игрока — тоже не пишется
  const r2 = (await postScore(t2, { date: DAY, score: 2, discarded, tiles, hand: HAND_SHARED })).body;
  assert.deepEqual(r2, { score: S, isBest: false, rank: 2 });

  // в БД ровно зафиксированные результаты, таблица согласована.
  // F18: в публичной таблице нет Google id (sub) — аноним видит mine: false.
  const lb = (await (await fetch(`${base}/api/scores/${DAY}`)).json()).rows;
  assert.deepEqual(lb.map((row) => row.name), ['Игрок sub-1', 'Игрок sub-2']);
  assert.deepEqual(lb.map((row) => row.score), [S, S]);
  for (const row of lb) {
    assert.ok(!('id' in row), 'id (Google sub) не отдаётся в публичной таблице');
    assert.equal(row.mine, false);
  }
});

test('leaderboard: порядок, ограничение, другая дата пуста', async () => {
  const res = await fetch(`${base}/api/scores/${DAY}?limit=10`);
  assert.equal(res.status, 200);
  const { date, rows } = await res.json();
  assert.equal(date, DAY);
  assert.equal(rows.length, 2);
  // рука сохраняется с результатом (клик по строке → просмотр): hand = исходная 14,
  // tiles = 13 после сброса (нужны для разбивки «за что» — аудит F6)
  const discarded = HAND_SHARED[13];
  const tiles = HAND_SHARED.filter((t) => t !== discarded);
  // F18: вместо id — серверный флаг mine (для анонима — везде false)
  assert.deepEqual(rows[0], {
    name: 'Игрок sub-1', picture: null, score: dayScore(discarded), discarded,
    hand: HAND_SHARED, tiles, kans: [], complete: false, mine: false,
  });
  assert.equal(rows[1].mine, false);
  assert.equal(rows[1].score, dayScore(discarded));
  assert.deepEqual(rows[1].tiles, tiles, 'у второй строки тоже tiles (F6)');

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

test('CORS: preflight PATCH разрешён (обновление блоков лога, F7)', async () => {
  const opt = await fetch(`${base}/api/events/1`, {
    method: 'OPTIONS',
    headers: { origin: 'https://game.example', 'access-control-request-method': 'PATCH' },
  });
  assert.equal(opt.status, 204);
  const methods = opt.headers.get('access-control-allow-methods') ?? '';
  assert.ok(methods.split(',').map((s) => s.trim()).includes('PATCH'),
    `в allow-methods есть PATCH: ${methods}`);
});

test('CORS: в production пустой список = same-origin, явный «*» уважается (F19)', async () => {
  const prev = process.env.NODE_ENV;
  const listen = (app) => new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    process.env.NODE_ENV = 'production';
    // Пустой CORS_ORIGINS в проде — CORS-заголовков нет вообще.
    const prodApp = createApp({
      db: openDb(':memory:'),
      verifyIdToken: verifyStub,
      sessionSecret: SECRET,
      googleClientId: 'test-client',
      corsOrigins: [],
    });
    const s1 = await listen(prodApp);
    const b1 = `http://127.0.0.1:${s1.address().port}`;
    const r1 = await fetch(`${b1}/health`, { headers: { origin: 'https://game.example' } });
    assert.equal(r1.headers.get('access-control-allow-origin'), null,
      'prod без CORS_ORIGINS — без ACAO (same-origin)');
    await new Promise((resolve) => s1.close(resolve));
    // Явный «*» в проде — открытый режим как в dev (эхо origin + Vary).
    const starApp = createApp({
      db: openDb(':memory:'),
      verifyIdToken: verifyStub,
      sessionSecret: SECRET,
      googleClientId: 'test-client',
      corsOrigins: ['*'],
    });
    const s2 = await listen(starApp);
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    const r2 = await fetch(`${b2}/health`, { headers: { origin: 'https://game.example' } });
    assert.equal(r2.headers.get('access-control-allow-origin'), 'https://game.example');
    assert.equal(r2.headers.get('vary'), 'Origin');
    await new Promise((resolve) => s2.close(resolve));
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test('F18: строка сессионного игрока помечена mine=true, id в ответе нет', async () => {
  const token = (await login('good-token-1-abcdefghijklmnopqrstuvwxyz')).body.token;
  const { rows } = await (await fetch(`${base}/api/scores/${DAY}`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mine, true, 'своя строка помечена');
  assert.equal(rows[1].mine, false);
  for (const row of rows) assert.ok(!('id' in row), 'id не отдаётся');
});

test('F20: битый JSON тела → 400, как и раньше (entity.parse.failed)', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"idToken": "обрезано',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'некорректный JSON');
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
  const testDb = openDb(':memory:');
  let srv;
  const app = createApp({
    db: testDb,
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    rolesFile: path.join(dir, 'roles.json'),
  });
  await new Promise((resolve) => { srv = app.listen(0, '127.0.0.1', resolve); });
  srv.unref();
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

  // без сессии — 401
  assert.equal((await fetch(`${b}/api/me/yesterday?date=${DAY}`)).status, 401);
  // кривая дата — 400
  assert.equal((await fetch(`${b}/api/me/yesterday?date=2026-13-99`, { headers: auth })).status, 400);
  // до «вчерашней» сдачи — руки нет
  let r = await fetch(`${b}/api/me/yesterday?date=${DAY}`, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).hand, null);
  assert.equal((await (await fetch(`${b}/api/me/yesterday?date=${DAY}`, { headers: auth })).json()).dayKanCount, 0);

  // «Вчерашняя» готовая рука с каном — прямо в БД (сдана вчера, сегодня
  // её уже не отправить: сервер принимает только сегодняшний день — F2a).
  const K = liveIds(YDAY, 1)[0]; // кан — вне мёртвой стены
  const rest = liveIds(YDAY, 11, [K]);
  const draft14 = [K, K, K, K, ...rest.slice(0, 10)]; // исходная 14
  const R = rest[10];                                  // добор после кана
  const hand14 = [K, K, K, ...rest.slice(0, 10), R];   // готовая 14 (пон кана)
  const ctx = createDailyContext(new Date(`${YDAY}T12:00:00Z`));
  const nowIso = new Date().toISOString();
  testDb.prepare(`INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)`)
    .run('sub-1', YDAY, 1234, null, JSON.stringify(hand14), nowIso);
  testDb.prepare(`INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sub-1', YDAY, JSON.stringify(draft14), JSON.stringify(hand14), JSON.stringify([K]), null, 1234, 1, JSON.stringify(ctx), 0, nowIso);

  // вчерашняя рука: пересчёт уже произошёл при первом запросе
  r = await fetch(`${b}/api/me/yesterday?date=${DAY}`, { headers: auth });
  assert.equal(r.status, 200);
  const y = await r.json();
  assert.equal(y.date, YDAY);
  assert.equal(y.hand.length, 14);
  assert.deepEqual(y.kans, [K]);
  assert.equal(y.recalculated, true);
  assert.equal(typeof y.newScore, 'number');
  assert.equal(typeof y.changed, 'boolean');
  // Суммарные каны дня (здесь — один, наш) определяют открывшиеся доры.
  assert.equal(y.dayKanCount, 1);

  // повторный запрос — без нового пересчёта (флаг), счёт тот же
  const again = await (await fetch(`${b}/api/me/yesterday?date=${DAY}`, { headers: auth })).json();
  assert.equal(again.newScore, y.newScore);

  // «завтра» по часам клиента (F2c) — не триггер: возвращается реальный вчерашний
  const skew = await (await fetch(`${b}/api/me/yesterday?date=${TOMORROW}`, { headers: auth })).json();
  assert.equal(skew.date, YDAY);
  assert.equal(skew.newScore, y.newScore);

  // таблица дня вчера: очки обновлены после пересчёта
  const lb = await (await fetch(`${b}/api/scores/${YDAY}`)).json();
  assert.equal(lb.rows.length, 1);
  assert.equal(lb.rows[0].score, y.newScore);

  await new Promise((resolve) => srv.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// ── Рука дня на сервере: черновик при генерации, восстановление, защита ──
// Сервер фиксирует руку только за сегодняшний день (F2a) — тест на реальную дату.
const HDATE = DAY;
// ≤2 копии каждого id: физически безопасно для любой мёртвой стены (лимит 3).
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
  const { body } = await login('good-token-3-abcdefghijklmnopqrstuvwxyz');
  const auth = { authorization: `Bearer ${body.token}` };

  const post = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    // dayCtx от клиента игнорируется (F2b) — сервер выводит из dayKey.
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

  // другой день без руки → hand: null (GET любой даты доступен)
  const empty = await fetch(`${base}/api/me/hand/2026-11-02`, { headers: auth });
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).hand, null);
});

test('me/hand: черновик не затирает руку со счётом (после сброса)', async () => {
  const { body } = await login('good-token-3-abcdefghijklmnopqrstuvwxyz');
  const auth = { authorization: `Bearer ${body.token}` };

  // игрок сбросил: tiles + hand записаны через /api/scores (счёт — серверный)
  const tiles = HAND14.filter((t) => t !== '1s');
  const S2 = computeDayScore({ tiles, hand: HAND14, kans: [], complete: false, dayKey: HDATE });
  const post = await postScore(body.token, {
    date: HDATE,
    score: 5000,
    discarded: '1s',
    tiles,
    hand: HAND14,
    complete: false,
    dayCtx: { dayKey: HDATE },
  });
  assert.equal(post.status, 200);
  assert.equal(post.body.score, S2); // клиентское 5000 не доверяется (F2a)

  // H4: повторная POST черновика — 409 (один черновик на день; замена
  // только ре-ишю). Данные со счётом и рука не затираются.
  const safe = liveIds(HDATE, 1)[0];
  const sync = await fetch(`${base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      date: HDATE,
      hand: [safe, safe, safe, safe, '1p','1p','1p','2p','3p','4p','5p','6p','7p','8p'],
    }),
  });
  assert.equal(sync.status, 409);

  const row = await (await fetch(`${base}/api/me/hand/${HDATE}`, { headers: auth })).json();
  assert.equal(row.score, S2);
  assert.equal(row.discarded, '1s');
  assert.equal(row.tiles.length, 13);
  assert.deepEqual(row.hand, HAND14);
});

test('me/hands: история рук; строки таблицы несут руку для просмотра', async () => {
  // без сессии → 401
  const anon = await fetch(`${base}/api/me/hands`);
  assert.equal(anon.status, 401);

  const { body } = await login('good-token-3-abcdefghijklmnopqrstuvwxyz');
  const auth = { authorization: `Bearer ${body.token}` };

  // история sub-3: день HDATE (черновик + результат из предыдущего теста)
  const list = await (await fetch(`${base}/api/me/hands`, { headers: auth })).json();
  assert.ok(Array.isArray(list.rows));
  assert.ok(list.rows.length >= 1);
  assert.equal(list.rows[0].date, HDATE); // новые даты первыми
  const row = list.rows.find((r) => r.date === HDATE);
  assert.deepEqual(row.hand, HAND14);
  const tiles = HAND14.filter((t) => t !== '1s');
  assert.equal(row.score, computeDayScore({ tiles, hand: HAND14, kans: [], complete: false, dayKey: HDATE }));
  assert.equal(row.complete, false);

  // строка таблицы дня несёт руку и каны (клик по строке → просмотр)
  const lb = await (await fetch(`${base}/api/scores/${HDATE}`)).json();
  const mine = lb.rows.find((r) => r.name === 'Игрок sub-3'); // F18: id в таблице нет
  assert.ok(mine, 'строка sub-3 в таблице дня');
  assert.deepEqual(mine.hand, HAND14);
  assert.deepEqual(mine.kans, []);
  assert.equal(mine.complete, false);
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
  // Результаты принимаются только за сегодняшний день (F2a) — реиздус тоже.
  const RDATE = DAY;

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

  // игрок сыграл: сброс + счёт (сервер пересчитывает — F2a)
  const post = await fetch(`${b}/api/scores`, {
    method: 'POST',
    headers: authA,
    body: JSON.stringify({
      date: RDATE, score: 12345, discarded: first.hand[13], tiles: first.hand.slice(0, 13),
      hand: first.hand, kans: [], complete: false,
      dayCtx: { dayKey: RDATE, doraIndicators: [], uraIndicators: [], roundWindId: 'ew', seatWindId: 'ew' },
    }),
  });
  assert.equal(post.status, 200);
  assert.equal(
    (await post.clone().json()).score,
    computeDayScore({ tiles: first.hand.slice(0, 13), hand: first.hand, kans: [], complete: false, dayKey: RDATE }),
  );
  // каны дня — публичная точка: кривая дата 400, пустой день — пусто
  assert.equal((await fetch(`${b}/api/daily/kans?date=2026-13-99`)).status, 400);
  assert.equal((await (await fetch(`${b}/api/daily/kans?date=${TOMORROW}`)).json()).kans.length, 0);

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
  const k2 = await (await fetch(`${b}/api/daily/kans?date=${RDATE}`)).json();
  assert.deepEqual(k2.kans, []);

  await new Promise((resolve) => srv.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test('kans: повторная отправка счёта с пустыми kans не стирает объявленные каны', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  // Валидная рука с каном: черновик 4×кан (вне мёртвой стены) + 10 остальных.
  const K = liveIds(DAY, 1)[0];
  const others = liveIds(DAY, 10, [K]);
  const draft14 = [K, K, K, K, ...others];
  const save = await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers,
    body: JSON.stringify({ date: DAY, hand: draft14 }),
  });
  assert.equal(save.status, 200);
  // добор после кана, рука 11, сброс → 10 тайлов
  const drawn = others[0];
  const hand11 = [...others, drawn];
  const discarded = others[9];
  const tiles10 = hand11.filter((t) => t !== discarded); // 10: 9 других + добор
  const S = computeDayScore({ tiles: tiles10, hand: hand11, kans: [K], complete: false, dayKey: DAY });

  // 1-я отправка: игрок объявил кан
  let r = await p.post(p.playerTok, {
    date: DAY, score: 2000, discarded, tiles: tiles10,
    hand: hand11, kans: [K], complete: false,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { score: S, isBest: true, rank: 1 });

  // 2-я отправка — эмуляция перезагрузки страницы старым клиентом
  // (declaredKans не восстановлен → kans: []): счёт хуже, каны пустые.
  // Политика «1 результат в день»: повтор НЕ пишется (зафиксированный
  // результат возвращается), каны не могут стёрться.
  r = await p.post(p.playerTok, {
    date: DAY, score: 1000, discarded, tiles: tiles10,
    hand: hand11, kans: [], complete: false,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { score: S, isBest: false, rank: 1 });

  // зафиксированный результат и кан дня на месте
  const row = await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers })).json();
  assert.deepEqual(row.kans, [K]);
  assert.equal(row.score, S);
  const k = await (await fetch(`${p.base}/api/daily/kans?date=${DAY}`)).json();
  assert.deepEqual(k.kans, [{ name: 'Игрок sub-2', kanCount: 1 }]);

  await p.close();
  p.cleanup();
});

// ── Политика «1 результат в день»: force admin/test, защита пересчёта ──

function makePolicyApp(roles) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mj-policy-'));
  const rolesFile = path.join(dir, 'roles.json');
  writeFileSync(rolesFile, JSON.stringify(roles), 'utf8');
  const db = openDb(':memory:');
  let srv;
  const app = createApp({
    db,
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    rolesFile,
  });
  return (async () => {
    await new Promise((resolve) => { srv = app.listen(0, '127.0.0.1', resolve); });
    srv.unref(); // упавший тест не должен держать процесс открытыми сокетами
    const b = `http://127.0.0.1:${srv.address().port}`;
    const loginAt = async (idToken) => {
      const res = await fetch(`${b}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      return (await res.json()).token;
    };
    const post = (tok, body) =>
      fetch(`${b}/api/scores`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
      });
    return {
      base: b,
      db,
      post,
      adminTok: await loginAt('good-token-1-abcdefghijklmnopqrstuvwxyz'),
      playerTok: await loginAt('good-token-2-abcdefghijklmnopqrstuvwxyz'),
      close: async () => new Promise((resolve) => srv.close(resolve)),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  })();
}

test('policy: admin пересдаёт — оба слоя обновляются согласованно', async () => {
  const p = await makePolicyApp({ admin: ['sub-1@example.com'], test: [] });
  const PDATE = DAY; // сервер принимает только сегодняшний день (F2a)
  // ≤3 копии каждого id — безопасно для любой мёртвой стены.
  const HAND = ['1m', '1m', '1m', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', 'sw', 'nw', 'rd'];
  const sAdmin = computeDayScore({ tiles: HAND.filter((t) => t !== 'rd'), hand: HAND, kans: [], complete: false, dayKey: PDATE });
  const sPlayer = computeDayScore({ tiles: HAND.filter((t) => t !== 'nw'), hand: HAND, kans: [], complete: false, dayKey: PDATE });
  const body = (score) => ({
    date: PDATE, score, discarded: 'rd', tiles: HAND.filter((t) => t !== 'rd'),
    hand: HAND, kans: [], complete: false,
  });
  const draft = (tok) => fetch(`${p.base}/api/me/hand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ date: PDATE, hand: HAND }),
  });

  // K2: черновики выданных рук — до сдачи результатов.
  assert.equal((await draft(p.adminTok)).status, 200);
  assert.equal((await draft(p.playerTok)).status, 200);

  // первая запись (счёт — серверный, клиентский 1000 не доверяется)
  let r = await (await p.post(p.adminTok, body(1000))).json();
  assert.deepEqual(r, { score: sAdmin, isBest: true, rank: 1 });

  // admin пересдаёт (force): scores и day_hands — оба перезаписаны
  r = await (await p.post(p.adminTok, body(500))).json();
  assert.deepEqual(r, { score: sAdmin, isBest: true, rank: 1 });
  const row = await (await fetch(`${p.base}/api/me/hand/${PDATE}`, {
    headers: { authorization: `Bearer ${p.adminTok}` },
  })).json();
  assert.equal(row.score, sAdmin);
  assert.equal(row.discarded, 'rd');
  assert.deepEqual((await (await fetch(`${p.base}/api/scores/${PDATE}`)).json()).rows.map((x) => x.score), [sAdmin]);

  // игрок: первая запись проходит, повтор — нет (политика 1 результат/день)
  const pbody = (score) => ({ ...body(score), discarded: 'nw', tiles: HAND.filter((t) => t !== 'nw') });
  let pr = await (await p.post(p.playerTok, pbody(900))).json();
  assert.equal(pr.score, sPlayer);
  assert.equal(pr.isBest, true);
  const playerRank = pr.rank; // 1 или 2 — зависит от сравнения с sAdmin
  assert.ok(playerRank >= 1 && playerRank <= 2);
  pr = await (await p.post(p.playerTok, pbody(300))).json();
  assert.deepEqual(pr, { score: sPlayer, isBest: false, rank: playerRank });
  const lb = (await (await fetch(`${p.base}/api/scores/${PDATE}`)).json()).rows;
  assert.equal(lb.length, 2);
  assert.equal(lb.find((x) => x.discarded === 'rd').score, sAdmin);
  assert.equal(lb.find((x) => x.discarded === 'nw').score, sPlayer);

  await p.close();
  p.cleanup();
});

test('policy: пересдаться «за вчера» после ночного пересчёта нельзя (F1.3 + F2c)', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  // «Вчерашняя» рука с каном ВРУЧНУЮ в БД (сегодня сервер принимает только
  // сегодняшний день — F2a), где заложена открывающаяся в «полночный»
  // пересчёт дора (кан-дора дня) — счёт гарантированно изменится.
  const wall = createDeadWall(YDAY);
  const kanDoraTile = doraFromIndicator(wall.kanDora[0]);
  const dead = new Set(createDailyContext(new Date(`${YDAY}T12:00:00Z`)).deadTiles);
  const K = allTileIds().find((t) => !dead.has(t) && t !== kanDoraTile);
  const rest = allTileIds().filter((t) => !dead.has(t) && t !== K && t !== kanDoraTile);
  const others = [kanDoraTile, kanDoraTile, ...rest.slice(0, 8)]; // 10 не-кана
  const R = rest[8];
  const draft14 = [K, K, K, K, ...others];
  const hand11 = [...others, R];
  const discarded = R;
  const tiles10 = others;
  const ctx = createDailyContext(new Date(`${YDAY}T12:00:00Z`));
  const dayScoreVal = computeDayScore({ tiles: tiles10, hand: hand11, kans: [K], complete: false, dayKey: YDAY });
  const expected = recalcScore({
    hand: hand11, tiles: tiles10, kans: [K], oldScore: dayScoreVal,
    complete: false, ctx, dayKey: YDAY, dayKanCount: 1,
  }).newScore;
  assert.notEqual(expected, dayScoreVal, `пересчёт должен изменить счёт (получилось ${expected})`);
  const nowIso = new Date().toISOString();
  p.db.prepare(`INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)`)
    .run('sub-2', YDAY, dayScoreVal, discarded, JSON.stringify(tiles10), nowIso);
  p.db.prepare(`INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sub-2', YDAY, JSON.stringify(draft14), JSON.stringify(tiles10), JSON.stringify([K]), discarded, dayScoreVal, 0, JSON.stringify(ctx), 0, nowIso);

  // «полночь»: клиент спрашивает вчерашний день → пересчёт (флаг recalculated)
  const y = await (await fetch(`${p.base}/api/me/yesterday?date=${DAY}`, {
    headers: { authorization: `Bearer ${p.playerTok}` },
  })).json();
  assert.equal(y.recalculated, true);
  assert.equal(y.newScore, expected);

  // вкладка, открытая через полночь, отправляет СТАРЫЙ счёт «за вчера» —
  // дата уже не «сегодня» (сервер, МСК) → 400, запись не пишется
  const r = await p.post(p.playerTok, {
    date: YDAY, score: 10, discarded, tiles: tiles10,
    hand: hand11, kans: [K], complete: false,
  });
  assert.equal(r.status, 400);

  // БД согласована: в таблице и в day_hands пересчитанный счёт
  const lb = (await (await fetch(`${p.base}/api/scores/${YDAY}`)).json()).rows;
  assert.deepEqual(lb.map((x) => x.score), [expected]);
  const row = await (await fetch(`${p.base}/api/me/hand/${YDAY}`, {
    headers: { authorization: `Bearer ${p.playerTok}` },
  })).json();
  assert.equal(row.score, expected);

  await p.close();
  p.cleanup();
});

// ── F2: сервер не доверяет клиенту в делах дня ──

test('F2: только сегодняшний день (сервер, МСК); «завтра» клиента — не триггер', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const discarded = HAND_SHARED[13];
  const tiles = HAND_SHARED.filter((t) => t !== discarded);
  const submit = (date) => fetch(`${p.base}/api/scores`, {
    method: 'POST', headers,
    body: JSON.stringify({ date, score: 100, discarded, tiles, hand: HAND_SHARED }),
  });
  // вчера → 400
  assert.equal((await submit(YDAY)).status, 400);
  // завтра → 400
  assert.equal((await submit(TOMORROW)).status, 400);
  // черновик руки — тоже только за сегодня
  const draftPost = await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers,
    body: JSON.stringify({ date: YDAY, hand: HAND_SHARED }),
  });
  assert.equal(draftPost.status, 400);
  // «завтра» по часам клиента (F2c) не запускает досрочный пересчёт:
  // возвращается реальный вчерашний
  const y = await (await fetch(`${p.base}/api/me/yesterday?date=${TOMORROW}`, { headers })).json();
  assert.equal(y.date, YDAY);

  await p.close();
  p.cleanup();
});

test('F2: семантика руки — кривые id, мёртвая стена, численность, черновик, каны', async () => {
  // 1. Некорректный id тайла
  let p = await makePolicyApp({ admin: [], test: [] });
  let h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  let r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 100, discarded: '1m', tiles: ['9999', ...HAND_SHARED.slice(0, 12)], hand: HAND_SHARED }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /id тайла/);
  await p.close(); p.cleanup();

  // 2. Больше 3 копий тайла мёртвой стены — физически невозможно
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const deadId = createDailyContext(new Date(`${DAY}T12:00:00Z`)).deadTiles[0];
  const live = liveIds(DAY, 10);
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 100, discarded: live[0],
      tiles: [deadId, deadId, deadId, deadId, ...live.slice(0, 9)], hand: [],
    }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /мёртвой стены/);
  await p.close(); p.cleanup();

  // 3. Неправильная численность: 12 тайлов вместо 13
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 100, discarded: '1m', tiles: HAND_SHARED.slice(0, 12), hand: HAND_SHARED }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /13 тайлов/);
  await p.close(); p.cleanup();

  // 4. Рука не совпадает с выданной (черновик зафиксирован)
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const K = liveIds(DAY, 1)[0];
  const rest = liveIds(DAY, 10, [K]);
  const draft14 = [K, K, K, K, ...rest];
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, hand: draft14 }),
  })).status, 200);
  const fake = liveIds(DAY, 14, [K]);
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 100, discarded: fake[13], tiles: fake.slice(0, 13), hand: fake }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /не совпадает/);
  await p.close(); p.cleanup();

  // 5. Кан на тайлы, которых нет в выданной руке
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const D = liveIds(DAY, 14);
  const FK = liveIds(DAY, 15, [])[14]; // 15-й живого тайла — не входит в D
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, hand: D }),
  })).status, 200);
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 100, discarded: D[13], tiles: D.slice(0, 10),
      hand: [...D.slice(0, 10), FK], kans: [FK], complete: false,
    }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /не совпадает|нет в руке/);
  await p.close(); p.cleanup();

  // 6. Валидный кан проходит: черновик 4×кан, добор, сброс, 10 тайлов
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const K2 = liveIds(DAY, 1)[0];
  const rest2 = liveIds(DAY, 10, [K2]);
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, hand: [K2, K2, K2, K2, ...rest2] }),
  })).status, 200);
  const R2 = rest2[0];
  const hand11 = [...rest2, R2];
  const discarded2 = rest2[9];
  const tiles10 = hand11.filter((t) => t !== discarded2); // 10: 9 других + добор
  const S2 = computeDayScore({ tiles: tiles10, hand: hand11, kans: [K2], complete: false, dayKey: DAY });
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 2000, discarded: discarded2, tiles: tiles10,
      hand: hand11, kans: [K2], complete: false,
    }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).score, S2);
  const row = await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json();
  assert.deepEqual(row.kans, [K2]);
  const k = await (await fetch(`${p.base}/api/daily/kans?date=${DAY}`)).json();
  assert.deepEqual(k.kans, [{ name: 'Игрок sub-2', kanCount: 1 }]);
  await p.close(); p.cleanup();

  // 7. Готовая рука с каном: 14 содержит пон (3 тайла), 4-й тайл отложен.
  // M4: готовая рука обязана быть ВЫИГРЫШНОЙ. Аудит №1 (0.7.1): рука и
  // вид кана — из живых тайлов дня (раньше хардкод 1m×4: ~3 дня из 10
  // 1m сидел в мёртвой стене и тест падал ложкой).
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const hw7 = kanWinningHand(DAY);
  const K3 = hw7.kan;
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, hand: hw7.draft14 }),
  })).status, 200);
  const full14 = hw7.full14;
  const S3 = computeDayScore({ tiles: full14, hand: full14, kans: [K3], complete: true, dayKey: DAY });
  assert.ok(S3 > 0, 'выигрышная рука даёт очки > 0 (M4-проверка опирается на это)');
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 2000, discarded: null, tiles: full14,
      hand: full14, kans: [K3], complete: true,
    }),
  });
  const r7Body = await r.json();
  assert.equal(r.status, 200, `готовая рука с каном принимается: ${JSON.stringify(r7Body)}`);
  assert.equal(r7Body.score, S3);
  assert.deepEqual((await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json()).kans, [K3]);
  await p.close(); p.cleanup();

  // 8. Красный id кана ('0m'): в выданной руке 4 пятёрки, одна красная.
  // Масть выбирается из мёртвой стены дня (детерминированно): все 4 копии
  // вида + красная должны быть в обороте — иначе 4 копии физически
  // невозможны (на 2026-10-26 в стене 5m — сценарий на 5m невалиден).
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const deadDay = new Set(createDailyContext(new Date(`${DAY}T12:00:00Z`)).deadTiles);
  const RED = { m: '0m', p: '0p', s: '0s' };
  const suit8 = ['m', 'p', 's'].find((s) => !deadDay.has(`5${s}`) && !deadDay.has(RED[s]));
  assert.ok(suit8, 'день, когда все 4 пятёрки трёх мастей в мёртвой стене — сценарий невозможен');
  const red8 = RED[suit8];
  const rest4 = liveIds(DAY, 10, [`5${suit8}`, red8]);
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, hand: [red8, `5${suit8}`, `5${suit8}`, `5${suit8}`, ...rest4] }),
  })).status, 200);
  const R4 = rest4[0];
  const hand11r = [...rest4, R4];
  const discarded4 = rest4[9];
  const tiles10r = hand11r.filter((t) => t !== discarded4);
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 2000, discarded: discarded4, tiles: tiles10r,
      hand: hand11r, kans: [red8], complete: false,
    }),
  });
  assert.equal(r.status, 200, `красный id кана принимается: ${await r.text()}`);
  assert.deepEqual((await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json()).kans, [red8]);
  await p.close(); p.cleanup();
});

test('F2: клиентский score и dayCtx не доверяются — сервер пересчитывает', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const discarded = HAND_SHARED[13];
  const tiles = HAND_SHARED.filter((t) => t !== discarded);
  const S = computeDayScore({ tiles, hand: HAND_SHARED, kans: [], complete: false, dayKey: DAY });
  // K2: черновик выданной руки — до сдачи результата.
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers,
    body: JSON.stringify({ date: DAY, hand: HAND_SHARED }),
  })).status, 200);
  // мусорный score + мусорный dayCtx (F2b: null-индикаторы должны были
  // ронять ночной пересчёт — теперь ctx вообще не принимается от клиента)
  const r = await (await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers,
    body: JSON.stringify({
      date: DAY, score: 999999999, discarded, tiles, hand: HAND_SHARED,
      dayCtx: { doraIndicators: [null], uraIndicators: [null] },
    }),
  })).json();
  assert.equal(r.score, S);
  assert.notEqual(r.score, 999999999);
  // в day_hands сохранён серверный контекст (dora-индикатор дня на месте)
  const saved = p.db.prepare(`SELECT day_ctx FROM day_hands WHERE user_id = 'sub-2' AND date = ?`).get(DAY);
  const ctx = JSON.parse(saved.day_ctx);
  assert.deepEqual(ctx.doraIndicators, createDailyContext(new Date(`${DAY}T12:00:00Z`)).doraIndicators);

  await p.close();
  p.cleanup();
});

test('F2: битая строка в ночном пересчёте не роняет день для всех', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const ctx = createDailyContext(new Date(`${YDAY}T12:00:00Z`));
  const nowIso = new Date().toISOString();
  // sub-2 — нормальная готовая рука; sub-3 — битые tiles (null в JSON-массиве:
  // tileToIndex(null) бросает — тот же класс падения, что в F2b)
  const tilesB = [...HAND_SHARED.slice(0, 12), null]; // 13 элементов
  // sub-3 существует в users (FK): логиним только ради строки
  await fetch(`${p.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: 'good-token-3-abcdefghijklmnopqrstuvwxyz' }),
  });
  p.db.prepare(`INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)`)
    .run('sub-2', YDAY, 100, null, JSON.stringify(HAND_SHARED), nowIso);
  p.db.prepare(`INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)`)
    .run('sub-3', YDAY, 200, '1s', JSON.stringify(tilesB), nowIso);
  p.db.prepare(`INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sub-2', YDAY, JSON.stringify(HAND_SHARED), JSON.stringify(HAND_SHARED), '[]', null, 100, 1, JSON.stringify(ctx), 0, nowIso);
  p.db.prepare(`INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sub-3', YDAY, JSON.stringify(HAND_SHARED), JSON.stringify(tilesB), '[]', '1s', 200, 0, JSON.stringify(ctx), 0, nowIso);

  const headers = { authorization: `Bearer ${p.playerTok}` }; // sub-2
  const r = await fetch(`${p.base}/api/me/yesterday?date=${TOMORROW}`, { headers });
  assert.equal(r.status, 200);
  const y = await r.json();
  assert.equal(y.recalculated, true); // нормальная строка пересчитана
  // битая строка: помечена пересчитанной, старый счёт сохранён
  const bad = p.db.prepare(`SELECT score, recalculated FROM day_hands WHERE user_id = 'sub-3'`).get();
  assert.equal(bad.recalculated, 1);
  assert.equal(bad.score, 200);
  // таблица дня: обе строки на месте, у битой — старый счёт
  const lb = (await (await fetch(`${p.base}/api/scores/${YDAY}`)).json()).rows;
  assert.equal(lb.length, 2);
  assert.equal(lb.find((x) => x.name === 'Игрок sub-3').score, 200); // F18: id в таблице нет
  assert.equal(lb.find((x) => x.name === 'Игрок sub-2').score, y.newScore);

  await p.close();
  p.cleanup();
});

// ── 0.6.26: контракты K2/H (аудит 2026-10-26) ──
// Готовая рука (123m 456m 789m 123p 55s): ≤2 копии каждого id — безопасна
// для любой мёртвой стены; для дня DAY.
const HAND_READY = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '5s', '5s'];

test('K2: complete без черновика → 400 (произвольная winning-hand не сдаётся)', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 5400625, tiles: HAND_READY, hand: HAND_READY, complete: true }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /не зафиксирована/);
  await p.close(); p.cleanup();
});

test('K2: complete с черновиком — hand обязан совпадать с tiles мультимножеством', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: HAND_READY }),
  })).status, 200);

  // hand — другая готовая рука (тот же счёт на экране клиента) → 400:
  // счёт считается от tiles, закреплённых черновиком.
  const otherReady = ['2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1m', '2p', '3p', '4p', '5s', '5s'];
  let r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 1000, tiles: HAND_READY, hand: otherReady, complete: true }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /hand готовой руки не совпадает с tiles/);

  // hand без 14 → 400
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 1000, tiles: HAND_READY, hand: HAND_READY.slice(0, 13), complete: true }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /hand готовой руки — 14 тайлов/);

  // hand ≡ tiles = черновик → 200, счёт серверный (готовая рука, без сброса)
  const S = computeDayScore({ tiles: HAND_READY, hand: HAND_READY, kans: [], complete: true, dayKey: DAY });
  r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, score: 999999, tiles: HAND_READY, hand: HAND_READY, complete: true }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).score, S);
  const row = await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json();
  assert.equal(row.complete, true);
  await p.close(); p.cleanup();
});

test('K2: 5 копий одного тайла в черновике → 400 (физически невозможно)', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const live = liveIds(DAY, 9);
  const r = await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ date: DAY, hand: ['1s', '1s', '1s', '1s', '1s', ...live] }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /максимум 4/);
  await p.close(); p.cleanup();
});

test('H1: готовая рука ПОСЛЕ кана — tiles 14 в пон-форме, hand = tiles → 200', async () => {
  // Аудит №1 (0.7.1): черновик/пон-форма — из живых тайлов дня
  // (канWinningHand): раньше хардкод 4×1m, и ~3 дня из 10 тест падал.
  // Черновик: 4 тайла кана + 3 чи + одиночка (добор). Кан, добор:
  // готовая в пон-форме (пон входит в 14, 4-й тайл кана отложен —
  // сервер дописывает его в валидации).
  const hw = kanWinningHand(DAY);
  let p = await makePolicyApp({ admin: [], test: [] });
  let h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: hw.draft14 }),
  })).status, 200);
  const full14 = hw.full14;
  const S = computeDayScore({ tiles: full14, hand: full14, kans: [hw.kan], complete: true, dayKey: DAY });
  const r = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 12345, tiles: full14, hand: full14, kans: [hw.kan], complete: true,
    }),
  });
  const rBody = await r.json();
  assert.equal(r.status, 200, `пон-форма 14 принимается: ${JSON.stringify(rBody)}`);
  assert.equal(rBody.score, S);

  await p.close(); p.cleanup();

  // Старый клиентский баг: tiles = 11 «на экране» (без пон) → 400.
  // Отдельный app: в предыдущем результат уже зафиксирован (политика
  // «1 результат в день» вернула бы 200 с записанным счётом).
  p = await makePolicyApp({ admin: [], test: [] });
  h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: hw.draft14 }),
  })).status, 200);
  const r2 = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 1, tiles: full14.filter((t) => t !== hw.kan),
      hand: full14.filter((t) => t !== hw.kan), kans: [hw.kan], complete: true,
    }),
  });
  assert.equal(r2.status, 400);
  await p.close(); p.cleanup();
});

test('H4: повторная POST черновика → 409, рука не меняется', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const first = liveIds(DAY, 14);
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: first }),
  })).status, 200);
  const second = liveIds(DAY, 14, [first[0]]);
  const r = await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: second }),
  });
  assert.equal(r.status, 409, 'повторный «перевыпуск» отклонён');
  const row = await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json();
  assert.deepEqual(row.hand, first, 'рука дня не заменена');
  await p.close(); p.cleanup();
});

test('H2: PATCH /api/me/hand/:date — прогресс канов на сервере', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const K = liveIds(DAY, 1)[0];
  const draft14 = [K, K, K, K, ...liveIds(DAY, 10, [K])];
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: draft14 }),
  })).status, 200);

  const patch = (kans, headers = h) => fetch(`${p.base}/api/me/hand/${DAY}`, {
    method: 'PATCH', headers, body: JSON.stringify({ kans }),
  });
  // без сессии → 401
  assert.equal((await patch([K], { 'content-type': 'application/json' })).status, 401);
  // кан, которого нет 4 раза в выданной руке → 400
  const FK = liveIds(DAY, 15, [K])[14];
  assert.equal((await patch([FK])).status, 400);
  // один кан дважды → 400
  assert.equal((await patch([K, K])).status, 400);
  // валидный кан → 200, прогресс в строке
  let r = await patch([K]);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { date: DAY, kans: [K] });
  let row = await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json();
  assert.deepEqual(row.kans, [K]);
  assert.equal(row.score, 0, 'прогресс не фиксирует результат');
  // повторный PATCH (идемпотентная синхронизация) — тоже 200
  assert.equal((await patch([K])).status, 200);
  // вчерашняя дата → 400
  assert.equal((await fetch(`${p.base}/api/me/hand/${YDAY}`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ kans: [K] }),
  })).status, 400);

  // после сдачи результата — 409 (каны живут в результате).
  // Экран после кана: 10 «других» + добор (пон кана закрыт отдельно).
  const discarded = draft14[13];
  const draw = liveIds(DAY, 3, [K])[0];
  const screen11 = [...draft14.filter((t) => t !== K), draw];
  const r2 = await fetch(`${p.base}/api/scores`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      date: DAY, score: 1, discarded, tiles: screen11.filter((t) => t !== discarded),
      hand: screen11, kans: [K], complete: false,
    }),
  });
  assert.equal(r2.status, 200, `сдача с каном: ${await r2.text()}`);
  assert.equal((await patch([K])).status, 409, 'после результата прогресс закрыт');
  await p.close(); p.cleanup();
});

test('H3: /api/me/hands — за сегодня скрытые доры в day_ctx не отдаются', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  // Черновик за сегодня (строка с живым day_ctx).
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: HAND_SHARED }),
  })).status, 200);
  // Пршедшая строка (вчера) — ctx сохранён полностью.
  const ctxY = createDailyContext(new Date(`${YDAY}T12:00:00Z`));
  const nowIso = new Date().toISOString();
  p.db.prepare(`
    INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run('sub-2', YDAY, JSON.stringify(HAND_SHARED), JSON.stringify(HAND_SHARED.slice(0, 13)), '[]', HAND_SHARED[13], 100, 0, JSON.stringify(ctxY), 1, nowIso);
  p.db.prepare(`INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)`)
    .run('sub-2', YDAY, 100, HAND_SHARED[13], JSON.stringify(HAND_SHARED.slice(0, 13)), nowIso);

  const list = await (await fetch(`${p.base}/api/me/hands`, { headers: h })).json();
  const today = list.rows.find((r) => r.date === DAY);
  const yday = list.rows.find((r) => r.date === YDAY);
  // Сегодня: ура/кан-доры ещё не открыты — их в ответе нет.
  assert.ok(today.day_ctx, 'ctx за сегодня есть (дора/ветра — публичные)');
  assert.deepEqual(today.day_ctx.doraIndicators, createDailyContext(new Date(`${DAY}T12:00:00Z`)).doraIndicators);
  assert.ok(!('uraIndicators' in today.day_ctx), 'uraIndicators за сегодня не отдаются');
  assert.ok(!('uraTiles' in today.day_ctx), 'uraTiles за сегодня не отдаются');
  assert.ok(!('deadWall' in today.day_ctx), 'deadWall за сегодня не отдаётся');
  // Вчера: день прошёл — полный ctx (базовая дора старых схем + ветра).
  assert.deepEqual(yday.day_ctx.uraIndicators, ctxY.uraIndicators);
  assert.ok(yday.day_ctx.deadWall, 'прошедший день — полный ctx');
  await p.close(); p.cleanup();
});

test('M4: невыигрышная готовая рука → 400 без строки; повтор на нулевую строку → 200', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  // HAND_SHARED — гарантированно НЕ выигрышная (нет пары: 4 сета + пара).
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: HAND_SHARED }),
  })).status, 200);
  // готовая рука = черновик (не выигрышная) → 400, строка в БД НЕ создаётся
  let r = await p.post(p.playerTok, {
    date: DAY, score: 0, discarded: null, tiles: HAND_SHARED, hand: HAND_SHARED, complete: true,
  });
  assert.equal(r.status, 400, 'невыигрышная готовая рука отклоняется');
  assert.match((await r.json()).error, /не выигрышная|14 тайлов/);
  assert.equal(
    p.db.prepare('SELECT score FROM scores WHERE user_id = ? AND date = ?').get('sub-2', DAY),
    undefined, 'нулевая строка не создаётся',
  );
  // legacy-нулевая строка (старая версия клиента): повтор НЕ падал 500 на
  // UNIQUE constraint — возвращается зафиксированный (нулевой) результат
  p.db.prepare('INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)')
    .run('sub-2', DAY, 0, null, '[]', new Date().toISOString());
  r = await p.post(p.playerTok, {
    date: DAY, score: 0, discarded: null, tiles: HAND_SHARED, hand: HAND_SHARED, complete: true,
  });
  assert.equal(r.status, 200, 'повтор на нулевую строку — 200, а не 500');
  assert.equal((await r.json()).score, 0);
  await p.close(); p.cleanup();
});

test('L1: тело запроса больше лимита → 413, а не 500', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const r = await fetch(`${p.base}/api/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` },
    body: JSON.stringify({ date: DAY, score: 1, tiles: [], hand: [], pad: 'x'.repeat(200 * 1024) }),
  });
  assert.equal(r.status, 413, 'ограничение размера тела — 413');
  assert.match((await r.json()).error, /слишком большое/);
  await p.close(); p.cleanup();
});

test('L2: окно «Вчера» не показывает черновик (рука сгенерирована, но не сдана)', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  // Черновик за вчера: ни сброса, ни готовности, ни очков (score 0, complete 0).
  p.db.prepare(`
    INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run('sub-2', YDAY, JSON.stringify(HAND_SHARED), null, '[]', null, 0, 0,
    JSON.stringify(createDailyContext(new Date(`${YDAY}T12:00:00Z`))), 0, new Date().toISOString());
  const r = await fetch(`${p.base}/api/me/yesterday?date=${DAY}`, { headers: h });
  assert.equal(r.status, 200);
  const y = await r.json();
  assert.equal(y.hand, null, 'черновик — не сыгранная рука: окно «Вчера» не показывается');
  assert.equal(y.dayKanCount, 0);
  // черновик не помечен пересчитанным (и очков у него нет)
  const row = p.db.prepare('SELECT score, recalculated FROM day_hands WHERE user_id = ? AND date = ?').get('sub-2', YDAY);
  assert.equal(row.score, 0);
  assert.equal(row.recalculated, 0);
  await p.close(); p.cleanup();
});

test('аудит №4: сумма канов дня — без LIMIT 10 (11 игроков с каном)', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  const nowIso = new Date().toISOString();
  const ctxY = JSON.stringify(createDailyContext(new Date(`${YDAY}T12:00:00Z`)));
  // 11 игроков за вчера, по 1 кану: p.sub-1 (суб-1 — запрашивающий) + 10 строк.
  const seed = (userId) => p.db.prepare(`
    INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, YDAY, JSON.stringify(HAND_SHARED), JSON.stringify(HAND_SHARED.slice(0, 13)),
    JSON.stringify(['1m']), HAND_SHARED[13], 100, 0, ctxY, 1, nowIso);
  // Запрашивающий (playerTok = sub-2) — сыгранная рука; + 10 игроков.
  seed('sub-2');
  for (let i = 2; i <= 11; i += 1) seed(`sub-x${i}`);
  p.db.prepare('INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)')
    .run('sub-2', YDAY, 100, HAND_SHARED[13], JSON.stringify(HAND_SHARED.slice(0, 13)), nowIso);

  // Публичный список: строки ограничены 10, но total — точная сумма.
  const k = await (await fetch(`${p.base}/api/daily/kans?date=${YDAY}`)).json();
  assert.equal(k.kans.length, 10, 'список — до 10 строк (атрибуция для тултипа)');
  assert.equal(k.total, 11, 'total — все каны дня, без обрезки');
  // «Вчера»: dayKanCount — из точной суммы (открывшиеся доры).
  const y = await (await fetch(`${p.base}/api/me/yesterday?date=${DAY}`, { headers: h })).json();
  assert.equal(y.dayKanCount, 11, 'до аудита №4 тут было 10 (LIMIT 10)');
  await p.close(); p.cleanup();
});

test('аудит №6: 0-очковая строка в scores фиксирует результат (PATCH канов → 409)', async () => {
  const p = await makePolicyApp({ admin: [], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.playerTok}` };
  // Черновик с чётвёркой (кан — на 4 тайла руки): 4×K + 10 других живых.
  const K = liveIds(DAY, 1)[0];
  const draft = [K, K, K, K, ...liveIds(DAY, 10, [K])];
  assert.equal((await fetch(`${p.base}/api/me/hand`, {
    method: 'POST', headers: h, body: JSON.stringify({ date: DAY, hand: draft }),
  })).status, 200);
  // До фиксации — прогресс канов пишется.
  let r = await fetch(`${p.base}/api/me/hand/${DAY}`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ kans: [K] }),
  });
  assert.equal(r.status, 200, 'пока результата нет — каны принимаются');
  // Legacy-ситуация: строка в scores со счётом 0 (старый клиент/старые правила)
  // — результат ЕСТЬ, хотя score = 0. Раньше гвард «score > 0» пропускала PATCH.
  p.db.prepare('INSERT INTO scores (user_id, date, score, discarded, tiles, created_at) VALUES (?,?,?,?,?,?)')
    .run('sub-2', DAY, 0, null, '[]', new Date().toISOString());
  r = await fetch(`${p.base}/api/me/hand/${DAY}`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ kans: [] }),
  });
  assert.equal(r.status, 409, 'строка в scores — результат зафиксирован, прогресс закрыт');
  const row = await (await fetch(`${p.base}/api/me/hand/${DAY}`, { headers: h })).json();
  assert.deepEqual(row.kans, [K], 'каны не затёрты повторным PATCH');
  await p.close(); p.cleanup();
});

test('аудит №8: rate-limit на login (429 после лимита попыток)', async () => {
  const app = createApp({
    db: openDb(':memory:'),
    verifyIdToken: verifyStub,
    sessionSecret: SECRET,
    googleClientId: 'test-client',
    loginRateLimit: 3,
  });
  let srv;
  await new Promise((resolve) => { srv = app.listen(0, '127.0.0.1', resolve); });
  srv.unref();
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const login = async () => {
      const res = await fetch(`${b}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: 'good-token-1-abcdefghijklmnopqrstuvwxyz' }),
      });
      return res.status;
    };
    assert.equal(await login(), 200);
    assert.equal(await login(), 200);
    assert.equal(await login(), 200);
    assert.equal(await login(), 429, 'лимит 3/мин на IP исчерпан');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('аудит №8: retention событий — старше 30 дней удаляется, свежее живёт', async () => {
  const db = openDb(':memory:');
  const oldTs = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const oldId = insertEvent(db, { mode: 'daily', kind: 'hand', payload: '{"total":1}' });
  const freshId = insertEvent(db, { mode: 'daily', kind: 'hand', payload: '{"total":2}' });
  db.prepare('UPDATE events SET ts = ? WHERE id = ?').run(oldTs, oldId);
  db.prepare('UPDATE events SET ts = ? WHERE id = ?').run(new Date().toISOString(), freshId);
  const pruned = pruneEvents(db);
  assert.equal(pruned, 1, 'удалено ровно старое событие');
  const ids = db.prepare('SELECT id FROM events ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(ids, [freshId], 'свежее событие на месте');
  db.close();
});

test('аудит №9: ре-ишю — только за сегодняшний день', async () => {
  const p = await makePolicyApp({ admin: ['sub-1@example.com'], test: [] });
  const h = { 'content-type': 'application/json', authorization: `Bearer ${p.adminTok}` };
  const post = (body) => fetch(`${p.base}/api/admin/hand/reissue`, {
    method: 'POST', headers: h, body: JSON.stringify(body),
  });
  assert.equal((await post({ date: YDAY })).status, 400, 'вчера — нельзя');
  assert.equal((await post({ date: TOMORROW })).status, 400, 'завтра — нельзя');
  const ok = await post({});
  assert.equal(ok.status, 200, 'сегодня — можно');
  assert.equal((await ok.json()).date, DAY);
  await p.close(); p.cleanup();
});
