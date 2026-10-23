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
  upsertUser, getUser, upsertScore, leaderboard, insertEvent, listEvents,
  updateEventPayload, addEventReport,
  upsertDayHand, getDayHand, listDayHands, markDayHandRecalculated, setScoreValue,
} from './db.js';
import { recalcScore } from './recalc.js';
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

// Простой in-memory ограничитель /api/events: 60 событий в минуту на IP
// (защита от спама логов; при рестарте счётчик сбрасывается — для этого
// масштаба достаточно).
const EVENT_LIMIT_MS = 60_000;
const EVENT_LIMIT_MAX = 60;
const eventHits = new Map();
function eventRateLimited(ip) {
  const now = Date.now();
  const hits = (eventHits.get(ip) ?? []).filter((t) => now - t < EVENT_LIMIT_MS);
  hits.push(now);
  eventHits.set(ip, hits);
  return hits.length > EVENT_LIMIT_MAX;
}

/** YYYY-MM-DD — и форма, и реальная дата (не 2026-13-99). */
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

function httpError(res, status, message) {
  res.status(status).json({ error: message });
}

/** CORS без зависимостей: точный список origin либо '*' (dev). */
function makeCors(allowed) {
  const allowAll = allowed.length === 0 || allowed.includes('*');
  const setHeaders = (res, origin) => {
    if (allowAll) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
  return getUser(db, payload.sub);
}

export function createApp({ db, verifyIdToken, sessionSecret, googleClientId, corsOrigins = [], rolesFile = DEFAULT_ROLES_FILE, staticRoot = DEFAULT_STATIC_ROOT }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(makeCors(corsOrigins));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (req, res) => {
    res.json({ ok: true, name: 'mahjongdle-server' });
  });

  /** POST /api/auth/login {idToken} → {token, user} */
  app.post('/api/auth/login', async (req, res, next) => {
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
      const msg = /недопустимый issuer|нет sub/.test(e.message) ? e.message : 'недействительный ID-токен';
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
    if (eventRateLimited(req.ip)) return httpError(res, 429, 'слишком много событий, замедлитесь');
    const user = authProfile(req, db, sessionSecret); // null — аноним
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

  /** POST /api/scores {date, score, discarded?, tiles?} → {score, isBest, rank} */
  app.post('/api/scores', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const { date, score, discarded, tiles } = req.body ?? {};
    if (!isValidDate(date)) {
      return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
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
    if (discarded !== undefined) {
      if (typeof discarded !== 'string' || discarded.length > 4) {
        return httpError(res, 400, 'discarded — id тайла');
      }
      discardedStr = discarded;
    }

    // Рука дня для ночного пересчёта: 14 исходных тайлов, каны, контекст дня.
    const { hand, kans, complete, dayCtx } = req.body ?? {};
    const isTileArray = (arr, max) =>
      Array.isArray(arr) && arr.length <= max && arr.every((t) => typeof t === 'string' && t.length <= 4);
    if (hand !== undefined && !isTileArray(hand, 14)) {
      return httpError(res, 400, 'hand — массив id тайлов (до 14)');
    }
    if (kans !== undefined && !isTileArray(kans, 4)) {
      return httpError(res, 400, 'kans — массив id объявленных канов (до 4)');
    }

    const result = upsertScore(db, {
      userId: user.id,
      date,
      score,
      discarded: discardedStr,
      tiles: tilesJson,
    });

    upsertDayHand(db, {
      userId: user.id,
      date,
      hand: hand ?? [],
      tiles: tiles ?? null,
      kans: kans ?? [],
      discarded: discardedStr,
      score,
      complete: Boolean(complete),
      dayCtx: dayCtx && typeof dayCtx === 'object' ? dayCtx : {},
    });

    res.json(result);
  });

  /**
   * GET /api/me/yesterday?date=YYYY-MM-DD → вчерашняя рука игрока.
   *
   * date — СЕГОДНЯШНИЙ день (клиентский dayKey); вчера вычисляется на сервере.
   * При первом обращении за день вчерашние руки пересчитываются с учётом всех
   * ура-дор и открытых кандор (один раз, флаг recalculated), таблица дня
   * обновляется — поэтому рейтинг может измениться.
   *
   * Ответ: {date, hand, discarded, oldScore, newScore, changed, kanDoras,
   *          kanDoraCount, recalculated}
   */
  app.get('/api/me/yesterday', (req, res) => {
    const user = authProfile(req, db, sessionSecret);
    if (!user) return httpError(res, 401, 'нет сессии');
    const today = req.query.date;
    if (!isValidDate(today)) return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    const yesterday = dayBefore(today);

    const mine = getDayHand(db, user.id, yesterday);
    if (!mine) return res.json({ date: yesterday, hand: null });

    // Ленивый ночной пересчёт: один раз на дату (и на игрока).
    if (!mine.recalculated) {
      for (const row of listDayHands(db, yesterday)) {
        if (row.recalculated) continue;
        const r = recalcScore({
          hand: row.hand,
          tiles: row.tiles,
          kans: row.kans,
          oldScore: row.score,
          complete: row.complete,
          ctx: row.day_ctx,
          dayKey: yesterday,
        });
        markDayHandRecalculated(db, row.user_id, yesterday, r.newScore);
        // Таблицу дня обновляем всегда: после ночного пересчёта очки могли
        // измениться, а старый счёт остался бы с момента сдачи.
        setScoreValue(db, row.user_id, yesterday, r.newScore);
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
      recalculated: fresh.recalculated,
    });
  });

  /** GET /api/scores/:date?limit=N → {date, rows:[{name, picture, score, discarded}]} */
  app.get('/api/scores/:date', (req, res) => {
    const { date } = req.params;
    if (!isValidDate(date)) return httpError(res, 400, 'date должен быть в формате YYYY-MM-DD');
    let limit = parseInt(req.query.limit ?? '20', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    res.json({ date, rows: leaderboard(db, date, limit) });
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
    app.use(express.static(staticRoot, { index: 'index.html', fallthrough: true }));
  }

  // 404 и обёртка ошибок (express.json может кидать SyntaxError на кривом JSON)
  app.use((req, res) => httpError(res, 404, 'не найдено'));
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return httpError(res, 400, 'некорректный JSON');
    }
    console.error(err);
    httpError(res, 500, 'внутренняя ошибка');
  });

  return app;
}
