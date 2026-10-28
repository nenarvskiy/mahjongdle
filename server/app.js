/**
 * Приложение (фабрика): createApp({ db, verifyIdToken, sessionSecret, googleClientId, corsOrigins, rolesFile, staticRoot }).
 * Фабрика — чтобы тесты могли поднять приложение с тестовой БД и заглушкой
 * верификатора Google без сети.
 *
 * Роли: admin/test/player (player по умолчанию) — файл rolesFile
 * (по умолчанию server/config/roles.json, hot-reload, без рестарта).
 * role возвращается в /api/auth/login и /api/me; GET/POST /api/roles —
 * только для admin.
 */
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signSession, verifySession } from './auth.js';
import {
  upsertUser, getUser, getFixedResult, dayRank, submitDayResult, leaderboard,
  insertEvent, listEvents, updateEventPayload, addEventReport,
  upsertDayHandDraft, getDayHand, listDayHands, listMyDayHands,
  markDayHandRecalculated, setScoreValue, reissueDayHand, listDayKans,
  sumDayKanCount, setDayHandKans, pruneEvents,
} from './db.js';
import { createDailyContext } from '../src/daily-context.js';
import { drawHand, canonicalTileId } from '../src/tiles.js';
import { recalcScore, computeDayScore, validateDaySubmission, isValidTileId } from './recalc.js';
import { DEFAULT_ROLES_FILE, readRolesFile, roleFor, setRole } from './roles.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// По умолчанию корень репозитория (рядом с server/ лежат index.html, src/,
// config/, styles.css) — тогда фронтенд и API живут на одном origin.
const DEFAULT_STATIC_ROOT = path.resolve(HERE, '..');
// Белый список верхних уровней для статики (только фронтенд): остальное
// в репозитории (stats/, test/, server/, package.json и т.д.) не раздаётся.
const STATIC_TOP = new Set(['index.html', 'styles.css', 'src', 'config', 'assets']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** «Вчера» для dayKey: соседняя календарная дата (YYYY-MM-DD). */
function dayBefore(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
// Потолок на случай мусора в запросе. Реальный максимум счёта — джекпотные яку,
// например «большие ветра» 23·10¹² + другие яку + база ≈ 2.5·10¹³, поэтому
// запас на порядок: 10¹⁵.
const MAX_SCORE = 10 ** 15;
// Потолок payload события лога (рука + контекст + разбивка — обычно < 2KB).
const MAX_EVENT_PAYLOAD = 20_000;
const MAX_REPORT_TEXT = 2_000;
const EVENT_MODES = new Set(['daily', 'test']);
// В лог пишутся ТОЛЬКО посчитанные руки: один блок = одна рука + счёт.
const EVENT_KIND = 'hand';

// Простой in-memory ограничитель /api/events: 60 событий в минуту на КЛЮЧ
// (защита от спама логов; при рестарте счётчик сбрасывается — для этого
// масштаба достаточно). F15: ключ — пользователь (сессия), а не IP: за
// прокси Render у всех req.ip один и лимит 60/мин становился общим;
// анонимы — по клиентскому IP из X-Forwarded-For (Render его ставит).
const EVENT_LIMIT_MS = 60_000;
const EVENT_LIMIT_MAX = 60;
const eventHits = new Map();
function eventRateLimited(key) {
  const now = Date.now();
  const hits = (eventHits.get(key) ?? []).filter((t) => now - t < EVENT_LIMIT_MS);
  hits.push(now);
  eventHits.set(key, hits);
  return hits.length > EVENT_LIMIT_MAX;
}
/** IP клиента: Render ставит X-Forwarded-For, локально — req.ip. */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return typeof xff === 'string' && xff.trim() ? xff.split(',')[0].trim() : req.ip;
}

/** Ключ лимитера: сессия — id пользователя, аноним — IP (XFF → req.ip). */
function eventRateKey(req, user) {
  if (user?.id) return `u:${user.id}`;
  return `ip:${clientIp(req)}`;
}

// Аудит №8 (0.7.1): rate-limit на login. Каждая проверка — сетевой вызов
// в Google (JWKS): без лимита логин-эндпоинт — бесконечный прокси на
// Google API. Ключ — IP (сессии ещё нет). Лимит настраивается опцией
// createApp (loginRateLimit); 0 — выключен (тесты).
const LOGIN_LIMIT_MS = 60_000;
const LOGIN_LIMIT_MAX = 60;
// Per-app карты лимитеров — каждый инстанс считает свои ключи (в проде
// инстанс один; тесты не пересекаются через общий модульный счётчик).
const loginMaps = new Set();
function makeLoginGate(limit) {
  const map = new Map();
  loginMaps.add(map);
  return (key) => {
    if (!limit) return false;
    const now = Date.now();
    const hits = (map.get(key) ?? []).filter((t) => now - t < LOGIN_LIMIT_MS);
    hits.push(now);
    map.set(key, hits);
    return hits.length > limit;
  };
}
// Очистка лимитеров (особенно анонимные IP не должны копиться вечно) — раз в 5 минут.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of eventHits) {
    const fresh = hits.filter((t) => now - t < EVENT_LIMIT_MS);
    if (fresh.length) eventHits.set(key, fresh);
    else eventHits.delete(key);
  }
  for (const map of loginMaps) {
    for (const [key, hits] of map) {
      const fresh = hits.filter((t) => now - t < LOGIN_LIMIT_MS);
      if (fresh.length) map.set(key, fresh);
      else map.delete(key);
    }
  }
}, 5 * 60_000).unref();

/** YYYY-MM-DD — и форма, и реальная дата (не 2026-13-99). */
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

/**
 * «Сегодня» на сервере (Europe/Moscow) — единый источник правды для дня
 * (аудит F2c): клиентская дата не управляет ни отчётностью, ни ночным
 * пересчётом — неверные часы устройства не запускают полночь заранее.
 */
export function mskToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]);
  const t = Object.fromEntries(parts);
  return `${t.year}-${t.month}-${t.day}`;
}

function httpError(res, status, message) {
  res.status(status).json({ error: message });
}

/**
 * CORS без зависимостей: точный список origin либо '*'.
 * F19: «всем (*)» по умолчанию только для dev; в production пустой
 * CORS_ORIGINS = same-origin (CORS-заголовков нет — игра и API на одном
 * origin). Явный '*' в списке в любом случае уважается.
 */
function makeCors(allowed) {
  const explicitStar = allowed.includes('*');
  const production = process.env.NODE_ENV === 'production';
  const allowAll = explicitStar || (!production && allowed.length === 0);
  const setHeaders = (res, origin) => {
    let allowedFor = false;
    if (allowAll) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      // Ответ зависит от Origin (эхо) — кэшировать по URL нельзя.
      res.setHeader('Vary', 'Origin');
      allowedFor = true;
    } else if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      allowedFor = true;
    }
    if (!allowedFor) return; // никто не разрешён — CORS-заголовков нет
    // PATCH — обновление блоков лога (/api/events/:id, src/event-log.js):
    // без него кросс-доменный preflight падает (аудит F7).
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  };
  return (req, res, next) => {
    setHeaders(res, req.headers.origin);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Бearer-токен → профиль из users, иначе null. */
function authProfile(req, db, secret) {
  const h = req.headers.authorization || '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) return null;
  const payload = verifySession(m[1], secret);
  if (!payload) return null;
  const user = getUser(db, payload.sub);
  if (user) return user;
  // Диск на Render эфемерный: после деплоя БД пустая, а сессия в браузере
  // ещё валидна. Не выкидываем 401, а восстанавливаем строку из payload.
  try {
    upsertUser(db, {
      id: payload.sub,
      email: payload.email ?? '',
      name: payload.name ?? '',
      picture: null,
    });
  } catch {
    return null;
  }
  return getUser(db, payload.sub);
}

export function createApp({
  db, verifyIdToken, sessionSecret, googleClientId, corsOrigins = [],
  rolesFile = DEFAULT_ROLES_FILE, staticRoot = DEFAULT_STATIC_ROOT,
  backup = null, loginRateLimit = LOGIN_LIMIT_MAX,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(makeCors(corsOrigins));
  app.use(express.json({ limit: '64kb' }));
  const loginGate = makeLoginGate(loginRateLimit);

  app.get('/health', (req, res) => {
    res.json({ ok: true, name: 'mahjongdle-server' });
  });

  /** POST /api/auth/login {idToken} → {token, user} */
  app.post('/api/auth/login', async (req, res, next) => {
    // Аудит №8 (0.7.1): лимит попыток на IP (проверка токена — вызов в Google).
    if (loginGate(`ip:${clientIp(req)}`)) {
      return httpError(res, 429, 'слишком много попыток входа, замедлитесь');
    }
    try {
      const { idToken } = req.body ?? {};
      if (typeof idToken !== 'string' || idToken.length < 20) {
        return httpError(res, 400, 'нет idToken');
      }
      const profile = await verifyIdToken(idToken);
      if (!profile?.id) throw new Error('верификатор не вернул id');
      upsertUser(db, profile);
      const user = getUser(db, profile.id);
      const token = signSession(user, sessionSecret);
      // role — из файла ролей (hot-reload): владелец правит списки без рестарта
      res.json({ token, user: { ...user, role: await roleFor(user.email, rolesFile) } });
    } catch (e) {
      // «плохой токен» не детализируем — только причину, которую можно показать
      const msg = /недопустимый issuer|нет sub|нет email|не подтверждён/.test(e.message)
        ? e.message
        : 'недействительный ID-токен';
      httpError(res, 401, msg);
    }
  });

  /** GET /api/me → {user (с role)} */
  app.get('/api/me', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    res.json({ user: { ...user, role: await roleFor(user.email, rolesFile) } });
  });

  /** GET /api/roles → {admin: [...], test: [...]} (только admin) */
  app.get('/api/roles', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    if (await roleFor(user.email, rolesFile) !== 'admin') return httpError(res, 403, 'только admin');
    res.json(await readRolesFile(rolesFile));
  });

  /** POST /api/roles {email, role: admin|test|player} → новый файл (только admin) */
  app.post('/api/roles', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    if (await roleFor(user.email, rolesFile) !== 'admin') return httpError(res, 403, 'только admin');
    try {
      res.json(await setRole(req.body?.email, req.body?.role, rolesFile));
    } catch (e) {
      httpError(res, 400, e.message);
    }
  });

  /**
   * POST /api/events {mode, kind:'hand', payload} → {id}
   * Один блок = одна ПОСЧИТАННАЯ рука: payload содержит руку, условия и счёт
   * с полной разбивкой (payload.total обязателен). Несчитанные руки не пишем.
   * Жалоба прикладывается к блоку через POST /api/events/:id/report.
   * Данные игрока берём СЕРВЕРОМ из сессии — клиенту доверия нет.
   */
  app.post('/api/events', (req, res) => {
    const { mode, kind, payload } = req.body ?? {};
    if (!EVENT_MODES.has(mode)) return httpError(res, 400, 'mode должен быть daily или test');
    if (kind !== EVENT_KIND) return httpError(res, 400, "kind должен быть 'hand'");
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return httpError(res, 400, 'payload должен быть объектом');
    }
    if (!Number.isFinite(payload.total)) {
      return httpError(res, 400, 'в блок руки нужен посчитанный счёт (payload.total)');
    }
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > MAX_EVENT_PAYLOAD) return httpError(res, 400, 'payload слишком большой');
    const user = authProfile(req, db, sessionSecret); // null — аноним
    if (eventRateLimited(eventRateKey(req, user))) {
      return httpError(res, 429, 'слишком много событий, замедлитесь');
    }
    const id = insertEvent(db, {
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      userName: user?.name ?? null,
      mode,
      kind: EVENT_KIND,
      payload: payloadJson,
    });
    res.json({ id });
  });

  /** PATCH /api/events/:id {payload} — пересчёт той же руки (только владелец). */
  app.patch('/api/events/:id', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return httpError(res, 400, 'id должен быть числом');
    const { payload } = req.body ?? {};
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return httpError(res, 400, 'payload должен быть объектом');
    }
    if (!Number.isFinite(payload.total)) {
      return httpError(res, 400, 'в блок руки нужен посчитанный счёт (payload.total)');
    }
    if (JSON.stringify(payload).length > MAX_EVENT_PAYLOAD) {
      return httpError(res, 400, 'payload слишком большой');
    }
    const merged = updateEventPayload(db, { id, userId: user.id, payload });
    if (!merged) return httpError(res, 404, 'блок не найден');
    res.json({ id, payload: merged });
  });

  /** POST /api/events/:id/report {text} — жалоба к блоку руки (только владелец). */
  app.post('/api/events/:id/report', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return httpError(res, 400, 'id должен быть числом');
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return httpError(res, 400, 'текст жалобы пуст');
    if (text.length > MAX_REPORT_TEXT) return httpError(res, 400, 'жалоба слишком длинная');
    const payload = addEventReport(db, { id, userId: user.id, text });
    if (!payload) return httpError(res, 404, 'блок не найден');
    res.json({ id, report: payload.report });
  });

  /** GET /api/events?reports=1&limit= → {rows} (только admin; новые сначала) */
  app.get('/api/events', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    if (await roleFor(user.email, rolesFile) !== 'admin') return httpError(res, 403, 'только admin');
    let limit = parseInt(req.query.limit ?? '100', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 100;
    limit = Math.min(limit, 500);
    const reportsOnly = req.query.reports === '1' || req.query.reports === 'true';
    res.json({ rows: listEvents(db, { kind: EVENT_KIND, limit, reportsOnly }) });
  });

  /**
   * POST /api/scores {date, score, discarded?, tiles?} → {score, isBest, rank}
   *
   * Политика «1 результат в день»: результат фиксируется ОДИН раз.
   * Повторная отправка обычного игрока (перезагрузка страницы, вторая
   * вкладка) НЕ пишется в БД — возвращается уже зафиксированный результат,
   * поэтому перезагрузки и двойные попытки ничего не ломают. admin/test
   * могут пересдать (force): оба слоя (scores + day_hands) обновляются
   * согласованно, recalculated сбрасывается — новый результат пройдёт
   * ночной пересчёт.
   */
  app.post('/api/scores', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const { date, score, discarded, tiles } = req.body ?? {};
    if (!isValidDate(date)) {
      return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    }
    // День — только сегодняшний (сервер, МСК): вчерашнюю/будущую дату
    // принимать нельзя (аудит F2a/F2c) — ни результат, ни пересчёт.
    if (date !== mskToday()) {
      return httpError(res, 400, 'результат можно отправить только за сегодняшний день');
    }
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
      return httpError(res, 400, 'score — целое число от 0');
    }
    let tilesJson = null;
    if (tiles !== undefined) {
      if (!Array.isArray(tiles) || tiles.length > 34 || !tiles.every((t) => typeof t === 'string' && t.length <= 4)) {
        return httpError(res, 400, 'tiles — массив id тайлов (до 34)');
      }
      tilesJson = JSON.stringify(tiles);
    }
    let discardedStr = null;
    if (discarded != null) {
      if (typeof discarded !== 'string' || discarded.length > 4) {
        return httpError(res, 400, 'discarded — id тайла');
      }
      discardedStr = discarded;
    }

    // Рука дня для ночного пересчёта: исходные тайлы, каны, готовность.
    // dayCtx от клиента НЕ принимается — контекст дня выводится из dayKey
    // (аудит F2b: битый клиентский контекст ронял ночной пересчёт для всех).
    const { hand, kans, complete } = req.body ?? {};
    const isTileArray = (arr, max) =>
      Array.isArray(arr) && arr.length <= max && arr.every((t) => typeof t === 'string' && t.length <= 4);
    if (hand !== undefined && !isTileArray(hand, 14)) {
      return httpError(res, 400, 'hand — массив id тайлов (до 14)');
    }
    if (kans !== undefined && !isTileArray(kans, 4)) {
      return httpError(res, 400, 'kans — массив id объявленных канов (до 4)');
    }

    // Политика «1 результат в день»: результат уже зафиксирован —
    // обычный игрок пересдать не может (возвращаем записанный результат,
    // БД не трогаем), admin/test — перезаписывают согласованно.
    const role = await roleFor(user.email, rolesFile);
    const force = role === 'admin' || role === 'test';
    const existing = getFixedResult(db, user.id, date);
    if (existing && !force) {
      return res.json({
        score: existing.score,
        isBest: false,
        rank: dayRank(db, date, existing.score, existing.createdAt),
      });
    }

    // Семантика руки (аудит F2a): корректные id, нет тайлов мёртвой стены,
    // численность с учётом канов, каны — на выданную руку, рука совпадает
    // с зафиксированным черновиком (если тот есть).
    const dayRow = getDayHand(db, user.id, date);
    const check = validateDaySubmission({
      tiles: tiles ?? [],
      hand: hand ?? [],
      kans: kans ?? [],
      discarded: discardedStr,
      complete: Boolean(complete),
      dayKey: date,
      draft: dayRow?.hand ?? null,
    });
    if (!check.ok) return httpError(res, 400, check.error);
    // K2: результат сдаётся ТОЛЬКО против зафиксированного черновика —
    // выданной игроку руки. Без него происхождение руки не проверить:
    // клиент мог прислать готовую winning-hand произвольную и забрать
    // её очки (аудит: complete:true без черновика → 5 400 625 очков).
    // Проверяем ПОСЛЕ валидации тела: ошибка формата видна как есть.
    if (!Array.isArray(dayRow?.hand) || dayRow.hand.length !== 14) {
      return httpError(res, 400, 'рука дня не зафиксирована — сначала сгенерируйте руку в игре');
    }

    // Счёт пересчитывается НА СЕРВЕРЕ из tiles/hand/kans + контекста дня
    // (аудит F2a): клиентское значение не доверяется, при расхождении —
    // серверный (разные версии клиента могут считать иначе).
    const finalScore = computeDayScore({
      tiles: tiles ?? [],
      hand: hand ?? [],
      kans: kans ?? [],
      complete: Boolean(complete),
      dayKey: date,
    });
    // M4: готовая рука обязана быть ВЫИГРЫШНОЙ. В системе v4 база готовой
    // руки ≥ 5 400 000, поэтому 0 очков = не 4 сета + пара: такую строку
    // не записываем (раньше она рождалась через пустой/чужой hand, а повтор
    // отправки падал на UNIQUE constraint с 500).
    if (Boolean(complete) && finalScore === 0) {
      return httpError(res, 400, 'готовая рука не выигрышная');
    }
    if (finalScore !== score) {
      console.warn(`счёт ${user.id} за ${date}: клиент ${score}, сервер ${finalScore} — записан серверный`);
    }

    const result = submitDayResult(db, {
      userId: user.id,
      date,
      score: finalScore,
      discarded: discardedStr,
      tiles: tiles ?? null,
      hand: hand ?? [],
      kans: kans ?? [],
      complete: Boolean(complete),
      // Контекст дня — серверный, из dayKey (F2b).
      dayCtx: createDailyContext(new Date(`${date}T12:00:00Z`)),
      force,
    });

    res.json(result);
  });

  /**
   * GET /api/me/yesterday?date=YYYY-MM-DD → вчерашняя рука игрока.
   *
   * date — СЕГОДНЯШНИЙ день по клиенту (dayKey): на сервере только
   * сверяется по формату, «сегодня»/«вчера» считаются по серверному МСК
   * (аудит F2c): неверные часы устройства не запускают ночной пересчёт
   * досрочно и не пропускают поздние каны.
   * При первом обращении за день вчерашние руки пересчитываются с учётом
   * открывшихся в полночь дор: ура — 1 базовая + по одной за каждый кан дня,
   * кан-доры — по одной за каждый кан дня (каны дня = все игроки); один раз,
   * флаг recalculated; таблица дня
   * обновляется — поэтому рейтинг может измениться.
   *
   * Ответ: {date, hand, discarded, kans, oldScore, newScore, changed,
   *          dayKanCount, recalculated}
   */
  app.get('/api/me/yesterday', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    if (req.query.date != null && !isValidDate(req.query.date)) {
      return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    }
    const yesterday = dayBefore(mskToday());

    const mine = getDayHand(db, user.id, yesterday);
    // L2: черновик (рука сгенерирована, но не сдана: нет ни сброса, ни
    // готовности, ни очков) — НЕ сыгранная рука: окно «Вчера» его не
    // показывает (раньше игрок видел полноэкранный «Вчера» со счётом 0).
    const played = mine && (mine.score > 0 || mine.complete || mine.discarded != null);
    if (!mine || !played) return res.json({ date: yesterday, hand: null, dayKanCount: 0 });

    // Суммарные каны вчерашнего дня (все игроки): именно они определяют,
    // сколько дор открылось в полночь. Аудит №4 (0.7.1): сумма без LIMIT
    // (listDayKans ограничен 10 строками — при 10+ игроках с каном
    // открывалось меньше дор, чем положено).
    const dayKanCount = sumDayKanCount(db, yesterday);

    // Ленивый ночной пересчёт: один раз на дату (и на игрока).
    // Пачка — в транзакции; одна битая строка (битый JSON руки/тайлов,
    // неизвестный id) не роняет пересчёт дня для всех (аудит F2b): она
    // логируется, помечается пересчитанной (со старым счётом) и пропускается.
    if (!mine.recalculated) {
      db.exec('BEGIN');
      try {
        // Аудит №8 (0.7.1): retention — события старше 30 дней (раз в день).
        pruneEvents(db);
        for (const row of listDayHands(db, yesterday)) {
          if (row.recalculated) continue;
          // L2: черновик (не сдана) не пересчитывается — у него нет счёта
          // и «вчера» для него не откроется.
          if (row.score === 0 && !row.complete && !row.discarded) continue;
          try {
            const r = recalcScore({
              hand: row.hand,
              tiles: row.tiles,
              kans: row.kans,
              oldScore: row.score,
              complete: row.complete,
              ctx: row.day_ctx,
              dayKey: yesterday,
              dayKanCount,
            });
            markDayHandRecalculated(db, row.user_id, yesterday, r.newScore);
            // Таблицу дня обновляем всегда: после ночного пересчёта очки
            // могли измениться, а старый счёт остался бы с момента сдачи.
            setScoreValue(db, row.user_id, yesterday, r.newScore);
          } catch (e) {
            console.error(`ночной пересчёт ${yesterday}: строка user=${row.user_id} битая, пропускаю: ${e.message}`);
            markDayHandRecalculated(db, row.user_id, yesterday, row.score);
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* уже откатилось */ }
        throw e;
      }
    }

    const fresh = getDayHand(db, user.id, yesterday);
    res.json({
      date: yesterday,
      hand: fresh.hand,
      tiles: fresh.tiles,
      discarded: fresh.discarded,
      kans: fresh.kans,
      complete: fresh.complete,
      oldScore: mine.score,
      newScore: fresh.score,
      changed: fresh.score !== mine.score,
      dayKanCount,
      recalculated: fresh.recalculated,
    });
  });

  /**
   * POST /api/me/hand {date, hand} — зафиксировать исходную руку дня
   * сразу при генерации (до сброса). Рука больше не пропадает вместе с
   * localStorage: при загрузке страницы клиент восстанавливает её с сервера.
   *
   * H4: черновик — ОДИН на день. Повторная POST не перезаписывает руку
   * (раньше так можно было крутить «перевыпуск» до нужного расклада —
   * черновик — якорь валидации результата). Замена черновика — только
   * админским ре-ишю (POST /api/admin/hand/reissue): 409 на повтор.
   */
  /**
   * GET /api/me/hands → история рук дня игрока.
   * H3: строка СЕГОДНЕШНЕГО дня несёт day_ctx, где спрятаны ЕЩЁ НЕ ОТКРЫВШИЕСЯ
   * ура-доры и кан-доры (открываются в полночный пересчёт). Их клиенту
   * отдавать нельзя — вырезаем из day_ctx за сегодня; прошедшие дни открыты
   * (после полуночи доры публичны) — оставляем полностью (клиент берёт из
   * сохранённого ctx базовую дору старых схем и ветра).
   */
  app.get('/api/me/hands', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    let limit = parseInt(req.query.limit ?? '30', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 30;
    limit = Math.min(limit, 100);
    const today = mskToday();
    const rows = listMyDayHands(db, user.id, limit).map((row) => {
      if (row.date !== today || !row.day_ctx) return row;
      row.day_ctx = {
        dayKey: row.day_ctx.dayKey ?? row.date,
        doraIndicators: row.day_ctx.doraIndicators,
        doraTiles: row.day_ctx.doraTiles,
        roundWindId: row.day_ctx.roundWindId,
        seatWindId: row.day_ctx.seatWindId,
        roundWind: row.day_ctx.roundWind,
        seatWind: row.day_ctx.seatWind,
      };
      return row;
    });
    res.json({ rows });
  });

  app.post('/api/me/hand', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const { date, hand } = req.body ?? {};
    if (!isValidDate(date)) {
      return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    }
    // Рука дня фиксируется только за сегодняшний день (сервер, МСК) — F2a.
    if (date !== mskToday()) {
      return httpError(res, 400, 'рука можно зафиксировать только за сегодняшний день');
    }
    const isTileArray = (arr) =>
      Array.isArray(arr) && arr.length <= 14 && arr.every((t) => typeof t === 'string' && t.length <= 4);
    if (!isTileArray(hand) || hand.length !== 14) {
      return httpError(res, 400, 'hand — массив из 14 id тайлов');
    }
    // Формат id, мёртвая стена, ≤4 копий (F2a): черновик — будущая
    // проверка результата. M4: complete-ветка требует hand = tiles —
    // проверяем руку против самой себя (мультимножество тривиально).
    const check = validateDaySubmission({
      tiles: hand,
      hand,
      kans: [],
      discarded: null,
      complete: true,
      dayKey: date,
      draft: null,
    });
    if (!check.ok) return httpError(res, 400, check.error);
    // H4: один черновик на день — повтор не перезаписывает руку (иначе
    // «перевыпуск» до нужного расклада: черновик — якорь валидации).
    const existingRow = getDayHand(db, user.id, date);
    if (existingRow && Array.isArray(existingRow.hand) && existingRow.hand.length) {
      return httpError(res, 409, 'рука дня уже зафиксирована — замена только через ре-ишю');
    }
    upsertDayHandDraft(db, {
      userId: user.id,
      date,
      hand,
      // dayCtx — серверный, из dayKey (F2b): клиентский не доверяется.
      dayCtx: createDailyContext(new Date(`${date}T12:00:00Z`)),
    });
    res.json({ date, hand });
  });

  /**
   * GET /api/me/hand/:date → {date, hand, tiles, discarded, kans, complete, score}
   * или {date, hand: null}, если рука за этот день не фиксировалась.
   */
  app.get('/api/me/hand/:date', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const { date } = req.params;
    if (!isValidDate(date)) {
      return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    }
    const row = getDayHand(db, user.id, date);
    if (!row) return res.json({ date, hand: null });
    res.json({
      date,
      hand: row.hand,
      tiles: row.tiles,
      discarded: row.discarded,
      kans: row.kans,
      complete: row.complete,
      score: row.score,
    });
  });

  /**
   * PATCH /api/me/hand/:date {kans} — прогресс канов руки дня (аудит H2).
   *
   * Кан объявляется ДО сброса, до любого результата: раньше прогресс жил
   * только в localStorage и при синхронизации/перезагрузке/другом
   * устройстве «пропадал» (серверный пре-кан черновик перезаписывал
   * пост-кан состояние). Теперь сервер хранит объявленные каны:
   *  - на том же устройстве sync не откатывает локальный прогресс,
   *    если он новее серверного (и дособыл кан сюда),
   *  - на другом устройстве кан применяется с сервера (рука пере-
   *    выносится с доборами).
   * Только пока результат не зафиксирован: после сдачи каны хранятся
   * в результате (scores/day_hands).
   */
  app.patch('/api/me/hand/:date', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const { date } = req.params;
    if (!isValidDate(date)) {
      return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    }
    // Прогресс дня — только за сегодняшний день (сервер, МСК) — F2a.
    if (date !== mskToday()) {
      return httpError(res, 400, 'каны можно объявить только за сегодняшний день');
    }
    const kans = req.body?.kans;
    if (!Array.isArray(kans) || kans.length > 4 || !kans.every((k) => typeof k === 'string' && k.length <= 4)) {
      return httpError(res, 400, 'kans — массив id объявленных канов (до 4)');
    }
    for (const k of kans) {
      if (!isValidTileId(k)) return httpError(res, 400, 'некорректный id тайла');
    }
    if (new Set(kans.map((k) => canonicalTileId(k))).size !== kans.length) {
      return httpError(res, 400, 'один кан нельзя объявить дважды');
    }
    const row = getDayHand(db, user.id, date);
    if (!row) return httpError(res, 404, 'рука дня не зафиксирована');
    // Результат уже зафиксирован — каны живут в нём, прогресс закрыт.
    // (Проверяем ДО формы руки: после сдачи row.hand — уже не черновик 14.)
    // Аудит №6 (0.7.1): фиксация — наличие СТРОКИ в scores (любой, включая
    // legacy 0-очковую), а не свойство «score > 0»: смена правил (например,
    // блок «кан» → 0) не должна была открывать PATCH после сдачи.
    if (row.complete || getFixedResult(db, user.id, date)) {
      return httpError(res, 409, 'результат дня уже зафиксирован');
    }
    if (!Array.isArray(row.hand) || row.hand.length !== 14) {
      return httpError(res, 404, 'рука дня не зафиксирована (нет черновика)');
    }
    // Кан — на 4 тайла выданной руки (черновика).
    const draftCounts = new Map();
    for (const t of row.hand) {
      const c = canonicalTileId(t);
      draftCounts.set(c, (draftCounts.get(c) ?? 0) + 1);
    }
    for (const k of kans) {
      if ((draftCounts.get(canonicalTileId(k)) ?? 0) < 4) {
        return httpError(res, 400, 'кан объявлен на тайлы, которых нет в руке');
      }
    }
    if (!setDayHandKans(db, user.id, date, kans)) {
      return httpError(res, 409, 'результат дня уже зафиксирован');
    }
    res.json({ date, kans });
  });

  /**
   * GET /api/daily/kans?date=YYYY-MM-DD → {date, kans:[{name, kanCount}]}
   * Публично: кто за дату объявил каны — клиент обводит жёлтым
   * «откроется в конце дня» кан-доры в списке дор.
   */
  app.get('/api/daily/kans', (req, res) => {
    const { date } = req.query;
    if (!isValidDate(date)) return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    // Аудит №4 (0.7.1): total — точная сумма канов дня (без LIMIT 10 из
    // списка): клиент использует её для числа открывающихся кан-дор.
    res.json({ date, kans: listDayKans(db, date), total: sumDayKanCount(db, date) });
  });

  /**
   * POST /api/admin/hand/reissue {date?} → {date, hand} (только admin).
   * Выдаёт игроку НОВУЮ руку дня, ЗАМЕНЯЯ старую в БД (scores тоже удаляет):
   * логика «1 рука в день» сохраняется — строка дня одна, рука новая.
   */
  app.post('/api/admin/hand/reissue', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    if (await roleFor(user.email, rolesFile) !== 'admin') return httpError(res, 403, 'только admin');
    const date = req.body?.date ?? mskToday();
    if (!isValidDate(date)) return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    // Аудит №9 (0.7.1): ре-ишю — только за СЕГОДНЯшний день (рука дня
    // «одна на день» привязана к текущему дню; вчерашнюю/будущую дату
    // перезадавать бессмысленно и рискованно).
    if (date !== mskToday()) {
      return httpError(res, 400, 'ре-ишю только за сегодняшний день');
    }
    const ctx = createDailyContext(new Date(`${date}T12:00:00Z`));
    const hand = drawHand(14, { deadTiles: ctx.deadTiles });
    // day_ctx — серверный (из dayKey), клиентский не доверяется (F2b).
    reissueDayHand(db, { userId: user.id, date, hand, dayCtx: ctx });
    res.json({ date, hand });
  });

  /**
   * POST /api/admin/score/backfill {date, hand, discarded, kans?} →
   * {date, score, discarded} (только admin/test).
   * 0.7.4: восстановление ПРОПУЩЕННОГО результата — рука была сыграна, но
   * отправка до сервера не дошла (например, страница со старым деплоем,
   * где адрес API был сломан, — см. инцидент 2026-10-28). Принимаются
   * прошедшие и СЕГОДНЯШНЯ даты (будущее нельзя); обычный POST /api/scores
   * в этом случае не работает — он требует зафиксированный черновик (K2),
   * а черновик как раз и не дошёл.
   * hand — 14 выданных тайлов (черновик на сервере НЕ требуется),
   * discarded — сброшенный тайл. Счёт — СЕРВЕРНЫЙ:
   *  - прошедший день: «полночная» формула (ура + кан-доры, открывшиеся
   *    по канам дня) — пересчёт за этот день уже проходил; строка
   *    записывается как recalculated=1 и не будет пересчитана повторно;
   *  - сегодняшний день: «дневная» формула БЕЗ ура (computeDayScore) и
   *    recalculated=0 — полночный пересчёт добавит ура/кан-доры, как у
   *    всех остальных игроков дня.
   */
  app.post('/api/admin/score/backfill', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const role = await roleFor(user.email, rolesFile);
    if (role !== 'admin' && role !== 'test') {
      return httpError(res, 403, 'только admin/test');
    }
    const { date, hand, discarded } = req.body ?? {};
    const kans = req.body?.kans ?? [];
    if (!isValidDate(date)) return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    // Будущее нельзя; прошедшее и сегодня — можно (сегодня — случай,
    // когда черновик не дошёл и обычный POST /api/scores закрыт по K2).
    if (date > mskToday()) {
      return httpError(res, 400, 'backfill — будущие даты нельзя');
    }
    const isToday = date === mskToday();
    if (!Array.isArray(hand) || hand.length !== 14 || !hand.every((t) => isValidTileId(t))) {
      return httpError(res, 400, 'hand — 14 выданных тайлов');
    }
    if (typeof discarded !== 'string' || !isValidTileId(discarded)) {
      return httpError(res, 400, 'discarded — сброшенный тайл');
    }
    if (!Array.isArray(kans) || kans.length > 4 || !kans.every((t) => isValidTileId(t))) {
      return httpError(res, 400, 'kans — до 4 объявленных канов');
    }
    // tiles = hand минус сброшенный тайл (первая копия id).
    const tiles = [...hand];
    const at = tiles.indexOf(discarded);
    if (at === -1) return httpError(res, 400, 'сброшенного тайла нет в руке');
    tiles.splice(at, 1);
    // Каны — только на тайлах этой руки: черновика на сервере нет,
    // поэтому мультиконтр-проверку validateDaySubmission не провести —
    // проверяем явно (по виду: красная пятёрка = обычная).
    const handKinds = new Set(hand.map(canonicalTileId));
    for (const k of kans) {
      if (!handKinds.has(canonicalTileId(k))) {
        return httpError(res, 400, 'кан объявлен на тайле, которого нет в руке');
      }
    }
    // Семантическая валидация (F2a): id, мёртвая стена (≤3 копии),
    // численность 13 − 3×каны, каны без повторов. draft не требуем —
    // именно не зафиксированный черновик и есть случай backfill.
    const check = validateDaySubmission({
      tiles, hand: [], kans, discarded, complete: false, dayKey: date, draft: null,
    });
    if (!check.ok) return httpError(res, 400, check.error);
    const dayCtx = createDailyContext(new Date(`${date}T12:00:00Z`));
    let newScore;
    if (isToday) {
      // Сегодня: «дневной» счёт БЕЗ ура — точно как обычная сдача.
      // Ура/кан-доры добавит ленивый полночный пересчёт при первом
      // обращении нового дня (строка сыграна, recalculated=0).
      newScore = computeDayScore({ tiles, hand: [], kans, complete: false, dayKey: date });
    } else {
      // Прошедший день: ленивый пересчёт его уже пройдёт — пишем сразу
      // финальный «полночный» счёт (базовая ура + кан-уры/кан-доры по
      // канам дня) и отмечаем recalculated=1. Каны дня учитывают каны
      // ЭТОЙ руки, если её строки ещё нет в БД (сейчас запишем).
      const ownRow = getDayHand(db, user.id, date);
      const dayKanCount = sumDayKanCount(db, date) + (ownRow ? 0 : kans.length);
      newScore = recalcScore({
        hand: [], tiles, kans, oldScore: 0, complete: false,
        ctx: dayCtx, dayKey: date, dayKanCount,
      }).newScore;
    }
    submitDayResult(db, {
      userId: user.id, date, score: newScore, discarded, tiles,
      hand, kans, complete: false, dayCtx, force: true,
    });
    if (!isToday) markDayHandRecalculated(db, user.id, date, newScore);
    res.json({ date, score: newScore, discarded, today: isToday });
  });

  /**
   * GET /api/admin/backup → статус бэкапа БД в GitHub.
   * Админ-диагностика: последний commit, ошибки, размер файла.
   */
  app.get('/api/admin/backup', async (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    if (await roleFor(user.email, rolesFile) !== 'admin') return httpError(res, 403, 'только admin');
    if (!backup) return res.json({ configured: false });
    res.json(backup.status());
  });

  /** GET /api/scores/:date?limit=N → {date, rows:[{name, picture, score, discarded, mine}]} */
  app.get('/api/scores/:date', (req, res) => {
    const { date } = req.params;
    if (!isValidDate(date)) return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    let limit = parseInt(req.query.limit ?? '20', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const rows = leaderboard(db, date, limit);
    // F18: публичная таблица не отдаёт Google id (sub) — строку сессионного
    // игрока сервер сам помечает mine (подсветка «это я» в клиенте).
    const me = authProfile(req, db, sessionSecret);
    for (const row of rows) {
      row.mine = Boolean(me && me.id === row.id);
      delete row.id;
    }
    res.json({ date, rows });
  });

  // Фронтенд (статика) — на том же origin, что и API: один порт на всё
  // (локально http://localhost:PORT, в проде — Tailscale Funnel / домен)
  // и без CORS. Раздаётся только белый список STATIC_TOP (guard до статики:
  // у express.static нет whitelist-фильтра).
  if (existsSync(staticRoot)) {
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const seg = req.path.split('/').filter(Boolean)[0] || '';
      if (seg !== '' && !STATIC_TOP.has(seg)) return httpError(res, 404, 'не найдено');
      next();
    });
    // no-cache: после деплоя браузер сверяет файлы (304 дёшево), поэтому
    // новая версия подхватывается без Ctrl+F5.
    app.use(express.static(staticRoot, {
      index: 'index.html',
      fallthrough: true,
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }));
  }

  // 404 и обёртка ошибок
  app.use((req, res) => httpError(res, 404, 'не найдено'));
  app.use((err, req, res, next) => {
    // F20: 400 «некорректный JSON» — ТОЛЬКО для ошибок express.json
    // (body-parser метит их entity.parse.failed). Любой другой SyntaxError —
    // баг сервера: 500 + лог, а не маскировка ошибкой клиента.
    if (err?.type === 'entity.parse.failed') {
      return httpError(res, 400, 'некорректный JSON');
    }
    // L1: тело больше лимита express.json (64kb) — 413, а не 500:
    // клиент понимает, что дело в размере запроса, а не в сервере.
    if (err?.type === 'entity.too.large') {
      return httpError(res, 413, 'тело запроса слишком большое');
    }
    console.error(err);
    httpError(res, 500, 'внутренняя ошибка');
  });

  return app;
}
