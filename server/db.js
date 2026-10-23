/**
 * База данных: встроенный node:sqlite (Node 24+).
 * users  — Google-профили (id = «sub» из ID-токена);
 * scores — лучший результат на (user, date); date = «YYYY-MM-DD» (dayKey дня);
 * events — сквозной лог игры: раздачи, счёты и жалобы на ошибки (подробности
 *          в payload — JSON с рукой, контекстом и разбивкой очков).
 */
import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      name       TEXT NOT NULL,
      picture    TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scores (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,
      score      INTEGER NOT NULL,
      discarded  TEXT,
      tiles      TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(date, score DESC);

    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT NOT NULL,
      user_id    TEXT,
      user_email TEXT,
      user_name  TEXT,
      mode       TEXT NOT NULL,
      kind       TEXT NOT NULL,
      payload    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

    -- Рука дня на момент сдачи: нужна для ночного пересчёта (ура-доры, кандоры).
    -- hand — исходные 14 тайлов, tiles — 13 после сброса, kans — объявленные
    -- каны, day_ctx — контекст дня (ветра/дора/ура/мёртвая стена).
    CREATE TABLE IF NOT EXISTS day_hands (
      user_id      TEXT NOT NULL,
      date         TEXT NOT NULL,
      hand         TEXT NOT NULL DEFAULT '[]',
      tiles        TEXT,
      kans         TEXT NOT NULL DEFAULT '[]',
      discarded    TEXT,
      score        INTEGER NOT NULL DEFAULT 0,
      complete     INTEGER NOT NULL DEFAULT 0,
      day_ctx      TEXT NOT NULL DEFAULT '{}',
      recalculated INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );
  `);
  return db;
}

/** Создать пользователя или обновить профиль (имя/аватар меняются в Google). */
export function upsertUser(db, { id, email, name, picture }) {
  db.prepare(`
    INSERT INTO users (id, email, name, picture, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      picture = excluded.picture
  `).run(id, email, name, picture, new Date().toISOString());
}

export function getUser(db, id) {
  return db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(id);
}

/**
 * Записать результат дня: храним ЛУЧШИЙ (максимум очков).
 * Возвращает { score, isBest, rank }:
 *   score  — лучший после этой записи,
 *   isBest — запись стала новым личным рекордом (включая первый),
 *   rank   — место в таблице дня (одинаковые очки — ранг по времени).
 */
export function upsertScore(db, { userId, date, score, discarded, tiles }) {
  const existing = db
    .prepare('SELECT score, created_at FROM scores WHERE user_id = ? AND date = ?')
    .get(userId, date);
  const isBest = !existing || score > existing.score;
  const now = new Date().toISOString();
  // время записи обновляем только при новом рекорде — иначе равенство очков
  // в таблице дня решалось бы «последней» записью, а не первой
  const keptAt = isBest ? now : existing.created_at;
  if (existing) {
    db.prepare(`
      UPDATE scores SET score = ?, discarded = ?, tiles = ?, created_at = ?
      WHERE user_id = ? AND date = ?
    `).run(score, discarded, tiles, keptAt, userId, date);
  } else {
    db.prepare(`
      INSERT INTO scores (user_id, date, score, discarded, tiles, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, date, score, discarded, tiles, now);
  }
  const best = isBest ? score : existing.score;
  // ранг: 1 + число игроков, чья строка строго «выше» нашей
  const rank = db.prepare(`
    SELECT 1 + (
      SELECT COUNT(*) FROM scores
      WHERE date = ? AND (score > ? OR (score = ? AND created_at < ?))
    ) AS rank
  `).get(date, best, best, keptAt).rank;
  return { score: best, isBest, rank };
}

/**
 * Таблица дня: топ-N, сортировка — очки (по убыванию), при равенстве — раньше
 * по времени. Строки несут и руку дня игрока (day_hands) — для просмотра
 * по клику на строку; hand = null, если рука не сохранялась.
 */
export function leaderboard(db, date, limit) {
  const rows = db.prepare(`
    SELECT u.id AS id, u.name AS name, u.picture AS picture,
           s.score AS score, s.discarded AS discarded,
           dh.hand AS hand, dh.kans AS kans, dh.complete AS complete
    FROM scores s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN day_hands dh ON dh.user_id = s.user_id AND dh.date = s.date
    WHERE s.date = ?
    ORDER BY s.score DESC, s.created_at ASC
    LIMIT ?
  `).all(date, limit);
  for (const row of rows) {
    const hand = parseJson(row.hand, []);
    row.hand = Array.isArray(hand) && hand.length ? hand : null;
    row.kans = parseJson(row.kans, []);
    row.complete = row.complete === 1;
  }
  return rows;
}

// --- Сквозной лог событий (раздачи, счёты, жалобы) ---

/** Записать событие. user-поля — из сессии (сервер), либо null (аноним). */
export function insertEvent(db, { userId = null, userEmail = null, userName = null, mode, kind, payload }) {
  const info = db.prepare(`
    INSERT INTO events (ts, user_id, user_email, user_name, mode, kind, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(new Date().toISOString(), userId, userEmail, userName, mode, kind, payload);
  return Number(info.lastInsertRowid);
}

/**
 * События для админ-просмотра: новые сначала.
 * kind — точное совпадение ('hand') или null (все);
 * reportsOnly — только блоки, к которым приложена жалоба.
 */
export function listEvents(db, { kind = null, limit = 100, reportsOnly = false } = {}) {
  const where = [];
  const params = [];
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  if (reportsOnly) {
    where.push("json_extract(payload, '$.report') IS NOT NULL");
  }
  const sql = `
    SELECT id, ts, user_id, user_email, user_name, mode, kind, payload
    FROM events
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit);
  for (const row of rows) {
    try {
      row.payload = JSON.parse(row.payload);
    } catch {
      row.payload = null;
    }
  }
  return rows;
}

/**
 * Обновить блок руки (PATCH: пересчёт при смене условий): только владелец.
 * Поля сливаются с существующими — жалоба (report) не теряется.
 * Возвращает итоговый payload или null (нет блока / чужой).
 */
export function updateEventPayload(db, { id, userId, payload }) {
  const row = db.prepare('SELECT user_id, payload FROM events WHERE id = ?').get(id);
  if (!row || row.user_id !== userId) return null;
  let existing = {};
  try {
    existing = JSON.parse(row.payload) ?? {};
  } catch {
    existing = {};
  }
  if (typeof existing !== 'object' || Array.isArray(existing)) existing = {};
  const merged = { ...existing, ...payload };
  if (existing.report) merged.report = existing.report;
  db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(JSON.stringify(merged), id);
  return merged;
}

/** Приложить жалобу к блоку руки (только владелец). payload с report или null. */
export function addEventReport(db, { id, userId, text }) {
  const row = db.prepare('SELECT user_id, payload FROM events WHERE id = ?').get(id);
  if (!row || row.user_id !== userId) return null;
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = {};
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) payload = {};
  payload.report = { text, ts: new Date().toISOString() };
  db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id);
  return payload;
}

// --- Рука дня: хранение для ночного пересчёта ---

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Сохранить руку дня на момент сдачи (лучший результат дня — в scores).
 * Повторная запись в тот же день перезаписывает руку, но счёт/флаг пересчёта
 * сбрасываются только если новый счёт больше прежнего.
 */
export function upsertDayHand(db, {
  userId, date, hand = [], tiles = null, kans = [], discarded = null,
  score, complete = false, dayCtx = {},
}) {
  db.prepare(`
    INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      hand = excluded.hand,
      tiles = excluded.tiles,
      kans = excluded.kans,
      discarded = excluded.discarded,
      day_ctx = excluded.day_ctx,
      score = CASE WHEN excluded.score > day_hands.score THEN excluded.score ELSE day_hands.score END,
      complete = CASE WHEN excluded.score > day_hands.score THEN excluded.complete ELSE day_hands.complete END,
      recalculated = CASE WHEN excluded.score > day_hands.score THEN 0 ELSE day_hands.recalculated END
  `).run(
    userId, date,
    JSON.stringify(hand ?? []),
    tiles ? JSON.stringify(tiles) : null,
    JSON.stringify(kans ?? []),
    discarded,
    Number.isFinite(score) ? score : 0,
    complete ? 1 : 0,
    JSON.stringify(dayCtx ?? {}),
    new Date().toISOString(),
  );
}

/**
 * Черновик руки дня: исходные 14 тайлов на момент генерации (score=0 —
 * «в процессе»). Позволяет восстановить руку игрока, если она пропадает из
 * localStorage (очистка кеша, другое устройство) и игрок ещё не сбрасывал.
 * Если запись уже со счётом (сброс/пересчёт) — её данные не трогаем.
 */
export function upsertDayHandDraft(db, { userId, date, hand = [], dayCtx = {} }) {
  db.prepare(`
    INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
    VALUES (?, ?, ?, NULL, '[]', NULL, 0, 0, ?, 0, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      hand = CASE WHEN day_hands.score > 0 THEN day_hands.hand ELSE excluded.hand END,
      day_ctx = CASE WHEN day_hands.score > 0 THEN day_hands.day_ctx ELSE excluded.day_ctx END
  `).run(
    userId, date,
    JSON.stringify(hand ?? []),
    JSON.stringify(dayCtx ?? {}),
    new Date().toISOString(),
  );
}

function decodeDayHand(row) {
  return {
    ...row,
    hand: parseJson(row.hand, []),
    tiles: row.tiles ? parseJson(row.tiles, []) : null,
    kans: parseJson(row.kans, []),
    day_ctx: parseJson(row.day_ctx, {}),
    complete: row.complete === 1,
    recalculated: row.recalculated === 1,
  };
}

/** Рука дня игрока за дату или null. */
export function getDayHand(db, userId, date) {
  const row = db.prepare('SELECT * FROM day_hands WHERE user_id = ? AND date = ?').get(userId, date);
  return row ? decodeDayHand(row) : null;
}

/** Все руки за дату (для ночного пересчёта). */
export function listDayHands(db, date) {
  return db.prepare('SELECT * FROM day_hands WHERE date = ?').all(date).map(decodeDayHand);
}

/** Руки дня игрока по убыванию даты (профиль: история ежедневных рук). */
export function listMyDayHands(db, userId, limit) {
  return db.prepare(`
    SELECT date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated
    FROM day_hands
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(userId, limit).map(decodeDayHand);
}

/** Отметить руку пересчитанной и сохранить новый счёт. */
export function markDayHandRecalculated(db, userId, date, newScore) {
  db.prepare('UPDATE day_hands SET score = ?, recalculated = 1 WHERE user_id = ? AND date = ?')
    .run(Number.isFinite(newScore) ? newScore : 0, userId, date);
}

/** Записать очки игрока за день (после ночного пересчёта). */
export function setScoreValue(db, userId, date, score) {
  db.prepare('UPDATE scores SET score = ? WHERE user_id = ? AND date = ?')
    .run(Number.isFinite(score) ? score : 0, userId, date);
}

