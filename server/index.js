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
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createBackup, pullBackupFile } from './backup.js';
import { openDb, dbRowCount } from './db.js';
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

// Бэкап БД в приватный GitHub-репо (защита от эфемерного диска Render):
// BACKUP_GITHUB_REPO=owner/name, BACKUP_GITHUB_TOKEN, [BACKUP_FILE], [BACKUP_BRANCH].
const BACKUP_REPO = env.BACKUP_GITHUB_REPO ?? '';
const BACKUP_TOKEN = env.BACKUP_GITHUB_TOKEN ?? '';
const BACKUP_FILE = env.BACKUP_FILE ?? 'leaderboard.db';
const BACKUP_BRANCH = env.BACKUP_BRANCH ?? 'main';
const BACKUP_API_BASE = env.BACKUP_API_BASE || undefined; // только для тестов
const BACKUP_ON = Boolean(BACKUP_REPO && BACKUP_TOKEN);

mkdirSync(path.dirname(DB_FILE), { recursive: true });

// Свежий инстанс после деплоя: локальной БД нет (или она пуста — 0 строк) —
// восстанавливаем из репо ДО открытия подключения (иначе openDb создаст
// пустую схему, а первый push затрёт хорошую копию в репо — аудит F5).
let db = openDb(DB_FILE);
let pullStatus = null;
if (BACKUP_ON && dbRowCount(db) === 0) {
  db.close();
  console.log(`backup: локальной БД нет (пустая) — восстанавливаю из ${BACKUP_REPO}/${BACKUP_FILE}…`);
  pullStatus = await pullBackupFile(DB_FILE, {
    repo: BACKUP_REPO, token: BACKUP_TOKEN, file: BACKUP_FILE, branch: BACKUP_BRANCH, apiBase: BACKUP_API_BASE,
  });
  db = openDb(DB_FILE);
  if (pullStatus === 'error') {
    console.warn('⚠ backup: pull не удался — пока локальная БД пуста, push в репо заблокирован (F5);'
      + ' после первой записи данные начнут сохраняться, но удалённая история может быть старше.');
  }
}
// remoteKnown: удалённое состояние известно и не новее локального —
// pull восстановил БД, в репо и так пусто (no-copy), либо локальная БД не
// пустая (постоянный диск: локаль новее последней успешной копии).
const remoteKnown = !BACKUP_ON || dbRowCount(db) > 0 || pullStatus === 'no-copy';

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

const backup = BACKUP_ON
  ? createBackup({
      db, dbPath: DB_FILE, repo: BACKUP_REPO, token: BACKUP_TOKEN,
      file: BACKUP_FILE, branch: BACKUP_BRANCH, apiBase: BACKUP_API_BASE,
      remoteKnown,
    })
  : null;

const app = createApp({
  db,
  verifyIdToken: createGoogleVerifier(env.GOOGLE_CLIENT_ID),
  sessionSecret: env.SESSION_SECRET,
  googleClientId: env.GOOGLE_CLIENT_ID,
  corsOrigins: CORS_ORIGINS,
  staticRoot: STATIC_DIR,
  backup,
});

// Наблюдатель: раз в минуту — если БД менялась, commit в репо.
// BACKUP_WATCH_INTERVAL_MS — интервал проверки (для тестов).
const BACKUP_WATCH_MS = Math.max(1000, parseInt(env.BACKUP_WATCH_INTERVAL_MS ?? '60000', 10) || 60000);
if (backup) {
  const timer = setInterval(() => {
    backup.tick().catch(() => {});
  }, BACKUP_WATCH_MS);
  timer.unref();
  console.log(`backup: БД загружается в ${BACKUP_REPO}/${BACKUP_FILE} при каждом изменении (проверка раз в ${BACKUP_WATCH_MS} мс)`);
}

app.listen(PORT, () => {
  const game = STATIC_DIR ? `игра: http://localhost:${PORT}` : 'игра: раздаётся отдельно (STATIC_DIR=off)';
  console.log(`mahjongdle-server: http://localhost:${PORT} (API + ${game}; БД: ${DB_FILE}, CORS: ${CORS_ORIGINS.length ? CORS_ORIGINS.join(', ') : '*'})`);
  console.log('роли: admin/test/player (player по умолчанию) — server/config/roles.json, hot-reload без рестарта:');
  console.log('  { "admin": ["вы@example.com"], "test": ["тестер@example.com"] }');
  console.log('  admin/test — тестовый режим (неограниченные руки, ничего в рейтинг); admin — управление ролями');
});
