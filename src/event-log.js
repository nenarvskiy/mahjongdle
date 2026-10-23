/**
 * Сквозной лог игры → сервер. Один блок = одна ПОСЧИТАННАЯ рука:
 * рука + условия (ветра, дора, ура) + счёт с полной разбивкой «что за что».
 * Жалоба (если игрок её оставил) лежит в том же блоке (payload.report).
 *
 * Несчитанные руки не пишутся вообще (правило сервера: payload.total обязателен).
 *
 * Кто: сервер сам подставляет данные игрока из сессии (id/email/name) —
 * в теле запроса только игровые данные. Анонимные руки тоже логируются
 * (игрок = null → «аноним» в окне админа).
 *
 * Деградация: сервер недоступен или ошибка — блок просто теряется,
 * игра не страдает.
 */
import { AUTH_CONFIG } from './config.js';
import { getAuth } from './auth.js';

const MODES = new Set(['daily', 'test']);

/** Условия (контекст) руки для лога — то, что влияет на счёт. */
export function ctxPayload(ctx) {
  return {
    dayKey: ctx?.dayKey ?? null,
    roundWindId: ctx?.roundWindId ?? null,
    seatWindId: ctx?.seatWindId ?? null,
    doraIndicators: ctx?.doraIndicators ?? [],
    uraIndicators: ctx?.uraIndicators ?? [],
  };
}

/**
 * Снапшот счёта для лога: итог + полная разбивка (что за что) + рука.
 * Чистая функция — проверяется в test/event-log.test.js.
 */
export function scorePayload(ctx, { hand, discarded = null, remaining = null, score = null }) {
  return {
    ctx: ctxPayload(ctx),
    hand: hand ?? [],
    discarded,
    remaining: remaining ?? hand ?? [],
    total: score?.total ?? null,
    shanten: score?.shanten ?? null,
    complete: Boolean(score?.complete),
    tier: score?.tier?.label ?? null,
    state: score?.state ?? null,
    base: score?.base ?? null,
    breakdown: (score?.breakdown ?? []).map((row) => ({
      label: row.label,
      points: row.points,
      yaku: row.yaku === true,
      potential: row.potential === true,
    })),
    potentialSummary: score?.potentialSummary ?? null,
  };
}

function authHeaders() {
  const token = getAuth()?.token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Создать блок руки со счётом. Возвращает {id} или null (тихо). */
export function logHand({ mode, payload }) {
  if (!MODES.has(mode) || !Number.isFinite(payload?.total)) return Promise.resolve(null);
  return fetch(`${AUTH_CONFIG.apiBaseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ mode, kind: 'hand', payload }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Обновить уже созданный блок (другой сброс/условия той же руки). */
export function updateHandBlock(id, payload) {
  if (!id || !Number.isFinite(payload?.total)) return Promise.resolve(null);
  return fetch(`${AUTH_CONFIG.apiBaseUrl}/api/events/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ payload }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Приложить жалобу к блоку руки. Возвращает {id, report} или null. */
export function reportHandBlock(id, text) {
  if (!id || !text) return Promise.resolve(null);
  return fetch(`${AUTH_CONFIG.apiBaseUrl}/api/events/${id}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Админ: блоки рук (новые сначала). reports — только с жалобами. */
export function fetchEvents({ reports = false, limit = 100 } = {}) {
  let qs = `limit=${encodeURIComponent(String(limit))}`;
  if (reports) qs += '&reports=1';
  return fetch(`${AUTH_CONFIG.apiBaseUrl}/api/events?${qs}`, {
    headers: { ...authHeaders() },
  })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data.rows ?? [];
    });
}
