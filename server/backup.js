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
 *    скачать последнюю копию из репо и открыть её. Файлы >1 МБ GitHub
 *    Contents API не возвращает в body (content: null) — тогда копию
 *    добирают raw-скачиванием по download_url (0.6.26, аудит K1).
 *  - защита F5/K1: пока удалённое состояние НЕИЗВЕСТНО (pull завершился
 *    'error'), пуш ЗАПРЕЩЁН целиком — не по числу строк, а по факту:
 *    свежий инстанс с любой локальной записью (да и событиями гостей)
 *    не должен затирать хорошую удалённую копию (аудит K1: dbRowCount
 *    считал events, и «пустая» БД с событиями пушилась). Пуш доступен,
 *    когда remoteKnown = true: pull восстановил БД / в репо пусто
 *    (no-copy) / локальная БД не была пустой при старте (постоянный диск —
 *    локаль не старше последней копии) / был успешный push. После неудачного
 *    pull разблокировка — только успешным pull-ом при следующем старте
 *    (рестарт/деплой) или успешным push в будущем.
 *
 * Окружение (Render): BACKUP_GITHUB_REPO=owner/name,
 * BACKUP_GITHUB_TOKEN=токен (fine-grained, Contents: read/write на репо),
 * BACKUP_FILE=leaderboard.db (по умолчанию), BACKUP_BRANCH=main.
 *
 * Тесты: test/backup.test.js (mock GitHub API).
 */
import fs from 'node:fs';
import path from 'node:path';

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
    let buf;
    if (data?.content) {
      buf = Buffer.from(data.content, 'base64');
    } else if (data?.download_url) {
      // Файл крупнее ~1 МБ: Contents API отдаёт content: null (encoding: none)
      // — копию скачивают сырьём по download_url (аудит K1).
      const rawRes = await fetch(data.download_url);
      if (!rawRes.ok) throw new Error(`raw-скачивание ${rawRes.status}`);
      buf = Buffer.from(await rawRes.arrayBuffer());
    } else {
      throw new Error('пустой ответ GitHub');
    }
    if (!buf.length) throw new Error('пустая копия в репозитории');
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
 * пустая при старте). Если false, push ЗАПРЕЩЁН целиком (не только для
 * пустой БД) — иначе свежий инстанс после упавшего pull затрёт хорошую
 * копию в репо (аудит F5/K1).
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
    lastUnknownWarnAt: 0,
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
   *  F5/K1: при неизвестном удалённом состоянии (pull упал) push запрещён
   *  ЦЕЛИКОМ — независимо от числа строк: и «пустая» БД, и БД, накопившая
   *  записи (да и гостевые события в events), затёрли бы хорошую удалённую
   *  копию (аудит K1: старый guard считал строки по всем таблицам). */
  async function pushNow(reason = '') {
    if (state.pushing) return;
    state.pushing = true;
    state.lastPushError = null;
    const tmp = db ? `${dbPath}.bak` : dbPath;
    try {
      if (!fs.existsSync(dbPath)) throw new Error(`нет файла БД: ${dbPath}`);
      if (!state.remoteKnown) {
        // Предупреждение не чаще раза в 15 минут (watcher будит pushNow
        // при каждом изменении БД — без дросселя это было бы раз в минуту).
        const now = Date.now();
        if (!state.lastUnknownWarnAt || now - state.lastUnknownWarnAt > 15 * 60 * 1000) {
          state.lastUnknownWarnAt = now;
          log.warn?.('[backup] удалённое состояние неизвестно (pull не удался) — push ' +
            'отменён: иначе была бы затёрта копия в репо (аудит K1). Разблокирует ' +
            'успешный pull при следующем старте (рестарт/деплой) или успешный push.');
        }
        return;
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
