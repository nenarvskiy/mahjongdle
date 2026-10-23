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

/** Таблица дня: топ-N, сортировка — очки (по убыванию), при равенстве — раньше по времени. */
export function leaderboard(db, date, limit) {
  return db.prepare(`
    SELECT u.id AS id, u.name AS name, u.picture AS picture, s.score AS score, s.discarded AS discarded
    FROM scores s
    JOIN users u ON u.id = s.user_id
    WHERE s.date = ?
    ORDER BY s.score DESC, s.created_at ASC
    LIMIT ?
  `).all(date, limit);
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
