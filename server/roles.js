// Роли игроков: admin / test / player (по умолчанию).
//
// Источник правды — JSON-файл (по умолчанию server/config/roles.json, НЕ в
// корневом config/ — корневой раздаётся статикой браузеру):
//   { "admin": ["owner@example.com"], "test": ["tester@example.com"] }
// player — это просто «не в списках», отдельный список не ведётся.
//
// Файл перечитывается при каждом обращении (hot-reload): владелец правит
// списки на сервере — и при следующем логине/опросе роль уже новая,
// рестарт не нужен.
//
// Смысл ролей:
//   admin — всё, включая панель управления ролями (GET/POST /api/roles);
//   test  — тестовый режим (неограниченные руки + ручные руки, без рейтинга);
//   player — только рука дня (1 в день, идёт в таблицу).
// НИЧЕГО из тестового режима не отправляется в рейтинг/статистику —
// фронтенд в этом режиме просто не вызывает POST /api/scores.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROLES_FILE = path.join(HERE, 'config', 'roles.json');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['admin', 'test', 'player']);

/** Прочитать и нормализовать файл ролей. Не найден -> пустые списки (норма
 *  для свежего запуска); битый JSON -> пустые списки + ЛОГ (F14: раньше было
 *  молча — все роли «слетали» незаметно). */
export async function readRolesFile(file = DEFAULT_ROLES_FILE, log = console) {
  let raw = null;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { admin: [], test: [] };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    log.error?.(`[roles] файл ролей ${file} содержит битый JSON — списки считаются пустыми: ${err.message}`);
    return { admin: [], test: [] };
  }
  const list = (value) =>
    Array.isArray(value)
      ? [...new Set(value.filter((e) => typeof e === 'string' && EMAIL_RE.test(e)).map((e) => e.trim().toLowerCase()))]
      : [];
  return { admin: list(data?.admin), test: list(data?.test) };
}

/** Записать файл ролей (красиво, UTF-8). Атомарно: tmp + rename (F14),
 *  чтобы при падении посреди записи файл не остался обрезанным. */
export async function writeRolesFile(roles, file = DEFAULT_ROLES_FILE) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify({ admin: roles.admin, test: roles.test }, null, 2)}\n`;
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

/** Роль пользователя по email: admin > test > player. */
export async function roleFor(email, file = DEFAULT_ROLES_FILE) {
  const roles = await readRolesFile(file);
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!e) return 'player';
  if (roles.admin.includes(e)) return 'admin';
  if (roles.test.includes(e)) return 'test';
  return 'player';
}

/**
 * Установить роль email: 'player' = убрать из обоих списков.
 * Возвращает новое содержимое файла. Бросает Error на невалидных аргументах.
 */
export async function setRole(email, role, file = DEFAULT_ROLES_FILE) {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(e)) throw new Error('Некорректный email');
  if (!ROLES.has(role)) throw new Error('Роль должна быть admin, test или player');
  const roles = await readRolesFile(file);
  // F14: нельзя убрать последнего админа — иначе lockout (панель ролей
  // требует admin, и восстановить список будет некому).
  if (role !== 'admin' && roles.admin.length === 1 && roles.admin[0] === e) {
    throw new Error('Нельзя убрать последнего админа: сначала назначьте другого');
  }
  roles.admin = roles.admin.filter((x) => x !== e);
  roles.test = roles.test.filter((x) => x !== e);
  if (role === 'admin') roles.admin.push(e);
  else if (role === 'test') roles.test.push(e);
  roles.admin.sort();
  roles.test.sort();
  await writeRolesFile(roles, file);
  return roles;
}
