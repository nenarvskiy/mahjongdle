/**
 * Точка входа: mahjongdle-server.
 *
 * Переменные окружения (.env не нужен — ставьте прямо в окружении или в .env,
 * если запускаете через node --env-file=.env, Node 20+):
 *   GOOGLE_CLIENT_ID  — OAuth Client ID (Web) из Google Cloud Console. ОБЯЗАТЕЛЬНО.
 *   SESSION_SECRET    — любая длинная случайная строка (HMAC сессий). ОБЯЗАТЕЛЬНО.
 *   PORT              — порт (по умолчанию 3000).
 *   DB_FILE           — файл SQLite (по умолчанию server/data/leaderboard.db).
 *   CORS_ORIGINS      — кому разрешён доступ, через запятую; «*» = все (dev).
 *                       Пример: "https://you.me,https://you.github.io"
 *   STATIC_DIR        — каталог фронтенда (по умолчанию корень репозитория —
 *                       тогда игра и API на одном origin, один порт);
 *                       'off' — только API (фронтенд раздаётся отдельно).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { createGoogleVerifier } from './google.js';

const env = process.env;

if (!env.GOOGLE_CLIENT_ID) {
  console.error('GOOGLE_CLIENT_ID не задан (OAuth Client ID из Google Cloud Console).');
  process.exit(1);
}
if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
  console.error('SESSION_SECRET не задан или слишком короткий (нужно ≥ 16 символов).');
  process.exit(1);
}

const PORT = parseInt(env.PORT ?? '3000', 10);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.DB_FILE ?? path.join(HERE, 'data', 'leaderboard.db');
const CORS_ORIGINS = (env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// 'off' — не раздавать фронтенд; пусто — корень репозитория (один origin).
const STATIC_DIR = env.STATIC_DIR === 'off' ? '' : (env.STATIC_DIR || path.resolve(HERE, '..'));

mkdirSync(path.dirname(DB_FILE), { recursive: true });

// На free-инстансе Render файл вне подключённого диска (/opt/data) стирается
// при каждом деплое — предупреждаем, чтобы таблица/история рук не «слетали».
if (process.env.NODE_ENV === 'production' && !DB_FILE.startsWith('/opt/data/')) {
  console.warn(
    '⚠ БД хранится на ЭФЕМЕРНОМ диске: при каждом деплое Render таблица дня, ' +
    'руки и история игроков сбрасываются.\n' +
    '   Как исправить (Render → сервис → Disks → Attach: mount /opt/data, 1 ГБ;\n' +
    '   Environment → DB_FILE=/opt/data/leaderboard.db). Подробности: server/README.md.',
  );
}

const app = createApp({
  db: openDb(DB_FILE),
  verifyIdToken: createGoogleVerifier(env.GOOGLE_CLIENT_ID),
  sessionSecret: env.SESSION_SECRET,
  googleClientId: env.GOOGLE_CLIENT_ID,
  corsOrigins: CORS_ORIGINS,
  staticRoot: STATIC_DIR,
});

app.listen(PORT, () => {
  const game = STATIC_DIR ? `игра: http://localhost:${PORT}` : 'игра: раздаётся отдельно (STATIC_DIR=off)';
  console.log(`mahjongdle-server: http://localhost:${PORT} (API + ${game}; БД: ${DB_FILE}, CORS: ${CORS_ORIGINS.length ? CORS_ORIGINS.join(', ') : '*'})`);
  console.log('роли: admin/test/player (player по умолчанию) — server/config/roles.json, hot-reload без рестарта:');
  console.log('  { "admin": ["вы@example.com"], "test": ["тестер@example.com"] }');
  console.log('  admin/test — тестовый режим (неограниченные руки, ничего в рейтинг); admin — управление ролями');
});
