/**
 * Бэкап локальной SQLite-БД в приватный GitHub-репозиторий.
 *
 * Зачем: у Render free-инстанса файловая система эфемерная — при каждом
 * деплое leaderboard.db стирается. Бэкап в репо (одна файлография,
 * Contents API) + восстановление при старте свежего инстанса закрывают
 * проблему без платного диска.
 *
 * Схема:
 *  - pushNow(): PRAGMA wal_checkpoint(TRUNCATE) (WAL сливается в главный
 *    файл) → копия файла → commit в репо (PUT /repos/.../contents/...);
 *  - tick(): раз в минуту — если mtime БД изменился, pushNow();
 *  - pullBackupFile(): при старте, если локальной БД нет/она пустая —
 *    скачать последнюю копию из репо и открыть её.
 *  - защита F5: если pull не удался (сеть/5xx), ПУСТУЮ локальную БД в репо
 *    НЕ пушим (pushNow пропускает push, пока 0 строк), иначе свежий инстанс
 *    затёр бы хорошую удалённую копию. Пуш разблокируется после первой
 *    записи в БД (тогда локаль реально новее последней успешной копии) или
 *    после успешного push (remoteKnown = true).
 *
 * Окружение (Render): BACKUP_GITHUB_REPO=owner/name,
 * BACKUP_GITHUB_TOKEN=токен (fine-grained, Contents: read/write на репо),
 * BACKUP_FILE=leaderboard.db (по умолчанию), BACKUP_BRANCH=main.
 *
 * Тесты: test/backup.test.js (mock GitHub API).
 */
import fs from 'node:fs';
import path from 'node:path';
import { dbRowCount } from './db.js';

const DEFAULT_API_BASE = 'https://api.github.com';

function githubHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

/**
 * Скачать файл из репо в dbPath.
 * @returns {Promise<'restored'|'no-copy'|'error'>} 'restored' — файл
 * восстановлен; 'no-copy' — в репо копии нет (404, начинаем с чистого БД —
 * пушить безопасно); 'error' — сеть/5xx, удалённое состояние НЕИЗВЕСТНО
 * (пушить пустую БД нельзя, иначе затрём хорошую копию — аудит F5).
 */
export async function pullBackupFile(dbPath, {
  repo, token, file = 'leaderboard.db', branch, apiBase = DEFAULT_API_BASE, log = console,
}) {
  try {
    const res = await fetch(`${apiBase}/repos/${repo}/contents/${encodeURIComponent(file)}`, {
      headers: githubHeaders(token),
    });
    if (res.status === 404) {
      log.warn?.(`[backup] в репо ${repo} нет файла ${file} — начинаем с чистого БД`);
      return 'no-copy';
    }
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    if (!data?.content) throw new Error('пустой ответ GitHub');
    const buf = Buffer.from(data.content, 'base64');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const tmp = `${dbPath}.download`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dbPath);
    log.log?.(`[backup] БД восстановлена из ${repo}/${file} (${buf.length} байт)`);
    return 'restored';
  } catch (err) {
    log.error?.(`[backup] pull: ${err?.message ?? err}`);
    return 'error';
  }
}

/**
 * Создать объект бэкапа для работающей БД.
 * @param {object} p
 * @param {import('node:sqlite').DatabaseSync} p.db — подключение (для WAL-checkpoint)
 * @param {string} p.dbPath — путь к файлу БД
 * @param {string} p.repo — 'owner/name'
 * @param {string} p.token — GitHub PAT
 * @param {string} [p.file] — имя файла в репо
 * @param {string} [p.branch]
 * @param {string} [p.apiBase] — для тестов
 * @param {object} [p.log]
 * @param {boolean} [p.remoteKnown] — удалённое состояние известно и НЕ новее
 * локальной БД (pull завершился 'restored'/'no-copy' либо локальная БД не
 * пустая). Если false, ПУСТУЮ локальную БД пушить запрещено — иначе свежий
 * инстанс после упавшего pull затрёт хорошую копию в репо (аудит F5).
 */
export function createBackup({
  db, dbPath, repo, token,
  file = 'leaderboard.db', branch = 'main',
  apiBase = DEFAULT_API_BASE, log = console, remoteKnown = false,
}) {
  const state = {
    lastPushAt: null,
    lastPushError: null,
    lastPushMtime: 0,
    pushing: false,
    remoteKnown: Boolean(remoteKnown),
  };

  const contentUrl = () => `/repos/${repo}/contents/${encodeURIComponent(file)}`;

  /**
   * «Момент последнего изменения» БД в WAL-режиме: максимум mtime главного
   * файла и файлов -wal/-shm. Записи в WAL копятся в -wal, главный файл
   * меняется только при чекпоинте, поэтому смотреть только его mtime —
   * не видеть свежие изменения (баг: watcher пропускал push после первого).
   */
  function dbMtime() {
    let m = 0;
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try { m = Math.max(m, fs.statSync(p).mtimeMs); } catch { /* файла нет */ }
    }
    return m;
  }

  async function remoteFile() {
    const res = await fetch(`${apiBase}${contentUrl()}`, { headers: githubHeaders(token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  /** Загрузка актуальной БД в репо (commit с timestamp).
   *  F5: при неизвестном удалённом состоянии (pull упал) ПУСТУЮ локальную
   *  БД не пушим — это затёрло бы хорошую копию в репо. Небольшая локальная
   *  БД, накопившая записи, пушится (локаль новее последней успешной копии). */
  async function pushNow(reason = '') {
    if (state.pushing) return;
    state.pushing = true;
    state.lastPushError = null;
    const tmp = db ? `${dbPath}.bak` : dbPath;
    try {
      if (!fs.existsSync(dbPath)) throw new Error(`нет файла БД: ${dbPath}`);
      if (!state.remoteKnown) {
        const rows = db ? dbRowCount(db) : 0;
        if (rows === 0) {
          log.warn?.('[backup] pull не удался, а локальная БД пуста — push отменён ' +
            '(иначе была бы затёрта удалённая копия); повторим после восстановления данных)');
          return;
        }
      }
      if (db) {
        // Сливаем WAL в главный файл, чтобы копия была консистентной
        // (БД маленькая, блокировка микросекундная).
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
        fs.copyFileSync(dbPath, tmp);
      }
      const content = fs.readFileSync(tmp).toString('base64');
      const body = {
        message: `backup ${file}: ${new Date().toISOString()}${reason ? ` (${reason})` : ''}`,
        content,
        branch,
      };
      const remote = await remoteFile();
      if (remote?.sha) body.sha = remote.sha;
      const res = await fetch(`${apiBase}${contentUrl()}`, {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`GitHub PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      state.lastPushAt = new Date().toISOString();
      state.lastPushMtime = dbMtime();
      // Удалённое состояние теперь = наша копия: дальнейшие push безопасны.
      state.remoteKnown = true;
      log.log?.(`[backup] БД загружена в ${repo}/${file}${reason ? ` (${reason})` : ''}`);
    } catch (err) {
      state.lastPushError = String(err?.message ?? err);
      log.error?.(`[backup] push: ${state.lastPushError}`);
    } finally {
      if (db) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      }
      state.pushing = false;
    }
  }

  /** Один такт наблюдения: commit только если БД менялась с прошлого push. */
  async function tick() {
    if (!fs.existsSync(dbPath)) return;
    // Сравниваем «момент изменения» всех файлов БД (WAL!): записи копятся в
    // -wal, главный файл меняется только при чекпоинте.
    if (dbMtime() > state.lastPushMtime) await pushNow('watcher');
  }

  function status() {
    return {
      configured: true,
      repo,
      file,
      branch,
      lastPushAt: state.lastPushAt,
      lastPushError: state.lastPushError,
      remoteKnown: state.remoteKnown,
      dbSize: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    };
  }

  return { pushNow, tick, status };
}
