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

/** Число записей по всем таблицам: 0 — «пустая» БД (свежая схема, данных нет).
 *  Для бэкапа: пустую БД нельзя пушить поверх удалённой копии (аудит F5). */
export function dbRowCount(db) {
  let n = 0;
  for (const table of ['users', 'scores', 'events', 'day_hands']) {
    try {
      n += db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch { /* таблицы нет — считаем 0 */ }
  }
  return n;
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
 * Зафиксированный результат дня игрока (строка в scores с score > 0;
 * страховка — day_hands с очками). null — результат ещё не записан.
 * Политика «1 результат в день»: повторная отправка обычного игрока
 * не пишется, возвращается эта запись (см. POST /api/scores).
 */
export function getFixedResult(db, userId, date) {
  const s = db
    .prepare('SELECT score, created_at FROM scores WHERE user_id = ? AND date = ?')
    .get(userId, date);
  if (s && s.score > 0) return { score: s.score, createdAt: s.created_at };
  const dh = db
    .prepare('SELECT score FROM day_hands WHERE user_id = ? AND date = ?')
    .get(userId, date);
  if (dh && dh.score > 0) return { score: dh.score, createdAt: null };
  return null;
}

/** Ранг (score, createdAt) в таблице дня: 1 + число строго «выше». */
export function dayRank(db, date, score, createdAt) {
  return db.prepare(`
    SELECT 1 + (
      SELECT COUNT(*) FROM scores
      WHERE date = ? AND (score > ? OR (score = ? AND created_at < ?))
    ) AS rank
  `).get(date, score, score, createdAt ?? '').rank;
}

/**
 * Записать результат дня ОДНОЙ транзакцией в оба слоя — scores (публичный
 * счёт дня) и day_hands (рука/каны/сброс для ночного пересчёта). Слои
 * всегда согласованы: одна запись — один счёт.
 *
 * force (admin/test) — перезапись уже зафиксированного результата: оба
 * слоя получают новые значения, recalculated сбрасывается в 0 (новый
 * результат пройдёт ночной пересчёт), created_at — время записи.
 *
 * Возвращает { score, isBest, rank }:
 *   score  — результат после записи,
 *   isBest — запись зафиксирована как результат (первая или force),
 *   rank   — место в таблице дня (одинаковые очки — ранг по времени).
 */
export function submitDayResult(db, {
  userId, date, score, discarded = null, tiles = null,
  hand = [], kans = [], complete = false, dayCtx = {}, force = false,
}) {
  const now = new Date().toISOString();
  const existing = getFixedResult(db, userId, date);
  const isBest = !existing || force;
  // tiles — массив id тайлов (или уже сериализованная строка / null)
  const tilesJson = Array.isArray(tiles)
    ? JSON.stringify(tiles)
    : (typeof tiles === 'string' && tiles.length ? tiles : null);
  db.exec('BEGIN');
  try {
    if (existing) {
      // force-перезапись: created_at — время последней записи (ранг при
      // равенстве очков решается ей, а не устаревшей первой записью).
      db.prepare(`
        UPDATE scores SET score = ?, discarded = ?, tiles = ?, created_at = ?
        WHERE user_id = ? AND date = ?
      `).run(score, discarded, tilesJson, now, userId, date);
    } else {
      db.prepare(`
        INSERT INTO scores (user_id, date, score, discarded, tiles, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, date, score, discarded, tilesJson, now);
    }
    // Каны дня накапливаются: повторная запись не стирает объявленные каны
    // (от них зависит ночной пересчёт всего дня); при force — пишем
    // присланные как есть (явная перезапись).
    const existingRow = db
      .prepare('SELECT kans FROM day_hands WHERE user_id = ? AND date = ?')
      .get(userId, date);
    let mergedKans = kans ?? [];
    if (!force && existingRow) {
      const oldKans = parseJson(existingRow.kans, []);
      if (oldKans.length) mergedKans = Array.from(new Set([...oldKans, ...mergedKans]));
    }
    db.prepare(`
      INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        hand = excluded.hand,
        tiles = excluded.tiles,
        kans = excluded.kans,
        discarded = excluded.discarded,
        day_ctx = excluded.day_ctx,
        score = excluded.score,
        complete = excluded.complete,
        recalculated = CASE WHEN ? = 1 THEN 0 ELSE day_hands.recalculated END
    `).run(
      userId, date,
      JSON.stringify(hand ?? []),
      tilesJson,
      JSON.stringify(mergedKans),
      discarded,
      Number.isFinite(score) ? score : 0,
      complete ? 1 : 0,
      JSON.stringify(dayCtx ?? {}),
      now,
      force ? 1 : 0,
    );
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* уже откатилось */ }
    throw e;
  }
  const createdAt = isBest ? now : existing.createdAt;
  return { score, isBest, rank: dayRank(db, date, score, createdAt) };
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

/**
 * Админ-реиздус руки дня: рука ЗАМЕНЯЕТСЯ (новая 14), старый результат
 * удаляется из scores, счёт/каны/сброс сбрасываются. Логика «1 рука в день»
 * сохраняется: это всё ещё та же строка (user_id, date), просто с новой рукой.
 */
export function reissueDayHand(db, { userId, date, hand = [], dayCtx = {} }) {
  db.prepare('DELETE FROM scores WHERE user_id = ? AND date = ?').run(userId, date);
  db.prepare(`
    INSERT INTO day_hands (user_id, date, hand, tiles, kans, discarded, score, complete, day_ctx, recalculated, created_at)
    VALUES (?, ?, ?, NULL, '[]', NULL, 0, 0, ?, 0, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      hand = excluded.hand,
      tiles = NULL,
      kans = '[]',
      discarded = NULL,
      score = 0,
      complete = 0,
      day_ctx = excluded.day_ctx,
      recalculated = 0
  `).run(
    userId, date,
    JSON.stringify(hand ?? []),
    JSON.stringify(dayCtx ?? {}),
    new Date().toISOString(),
  );
}

/**
 * Каны дня (публично): кто из игроков за дату объявил каны — для
 * «кан-дора откроется в конце дня» на главной странице.
 */
export function listDayKans(db, date) {
  return db.prepare(`
    SELECT u.name, dh.kans
    FROM day_hands dh
    LEFT JOIN users u ON u.id = dh.user_id
    WHERE dh.date = ? AND dh.kans != '[]'
    ORDER BY dh.created_at ASC
    LIMIT 10
  `).all(date).map((row) => ({
    name: row.name ?? 'аноним',
    kanCount: parseJson(row.kans, []).length,
  }));
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

