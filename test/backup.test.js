/**
 * Тесты бэкапа БД в GitHub (server/backup.js) — против mock Contents API.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { createBackup, pullBackupFile } from '../server/backup.js';

const REPO = 'test/repo';
const FILE = 'leaderboard.db';

let server;
let apiBase;
let remote; // { sha, content(base64), message }
let putCount;
let remoteError; // true — GET отвечает 500 (сбой GitHub)
let tmpDir;
const silentLog = { log() {}, warn() {}, error() {} };
const warned = [];
const logCapture = { log() {}, warn(m) { warned.push(m); }, error() {} };

/** Пустая БД (только схема, 0 строк) — как у свежего инстанса после openDb. */
function makeEmptyDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scores (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, score INTEGER NOT NULL, discarded TEXT, tiles TEXT,
      created_at TEXT NOT NULL, PRIMARY KEY (user_id, date)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, user_id TEXT, user_email TEXT, user_name TEXT,
      mode TEXT, kind TEXT, payload TEXT
    );
  `);
  db.close();
}

function makeDbWithRows(file, rows = 3) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scores (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, score INTEGER NOT NULL, discarded TEXT, tiles TEXT,
      created_at TEXT NOT NULL, PRIMARY KEY (user_id, date)
    );
  `);
  for (let i = 0; i < rows; i++) {
    db.prepare('INSERT OR REPLACE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .run(`u${i}`, `u${i}@x.com`, `U${i}`, new Date().toISOString());
    db.prepare('INSERT OR REPLACE INTO scores (user_id, date, score, created_at) VALUES (?, ?, ?, ?)')
      .run(`u${i}`, '2026-10-25', 100 + i, new Date().toISOString());
  }
  db.close();
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-backup-test-'));
  remote = null;
  putCount = 0;
  remoteError = false;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/raw/leaderboard.db') {
      // Mок raw-скачивания (download_url): бинарная копия из remote.content.
      if (!remote) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"message":"Not Found"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from(remote.content, 'base64'));
      return;
    }
    const expectPath = `/repos/${REPO}/contents/${encodeURIComponent(FILE)}`;
    if (url.pathname !== expectPath) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (req.method === 'GET') {
      if (remoteError) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"message":"Internal Server Error"}');
        return;
      }
      if (!remote) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"message":"Not Found"}');
        return;
      }
      // remote.large — GitHub Contents API для файла >1 МБ: content: null.
      if (remote.large) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          sha: remote.sha, encoding: 'none', size: 2000000,
          download_url: `${apiBase}/raw/leaderboard.db`,
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: remote.content, sha: remote.sha, encoding: 'base64' }));
      return;
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const data = JSON.parse(body);
        if (remote && data.sha !== remote.sha) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end('{"message":"sha mismatch"}');
          return;
        }
        putCount += 1;
        remote = {
          sha: `sha-${putCount}`,
          content: data.content,
          message: data.message,
        };
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: { sha: remote.sha } }));
      });
      return;
    }
    res.writeHead(405);
    res.end();
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  apiBase = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('pullBackupFile: восстанавливает БД, когда локального файла нет', async () => {
  const src = path.join(tmpDir, 'src.db');
  const dst = path.join(tmpDir, 'sub', 'restored.db');
  makeDbWithRows(src, 3);
  remote = {
    sha: 'sha-seed',
    content: fs.readFileSync(src).toString('base64'),
    message: 'seed',
  };

  const status = await pullBackupFile(dst, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  assert.equal(status, 'restored');
  assert.ok(fs.existsSync(dst));

  const db = new DatabaseSync(dst);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM scores').get();
  db.close();
  assert.equal(rows.n, 3, 'восстановленная БД содержит строки');
});

test('pullBackupFile: пустой репо (404) → no-copy, файл не создаётся', async () => {
  remote = null;
  const dst = path.join(tmpDir, 'empty.db');
  const status = await pullBackupFile(dst, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  assert.equal(status, 'no-copy');
  assert.equal(fs.existsSync(dst), false);
});

test('pullBackupFile: сбой GitHub (500) → error', async () => {
  remote = { sha: 'sha-x', content: 'Zm9v', message: 'x' };
  remoteError = true;
  const dst = path.join(tmpDir, 'err.db');
  const status = await pullBackupFile(dst, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  remoteError = false;
  assert.equal(status, 'error');
  assert.equal(fs.existsSync(dst), false, 'файл не создаётся при сбое');
});

// --- F5/K1: при неизвестном удалённом состоянии push запрещён ЦЕЛИКОМ ---

test('K1: pull упал + пустая БД → push пустой не уходит', async () => {
  const dbPath = path.join(tmpDir, 'k1-empty.db');
  makeEmptyDb(dbPath);
  const db = new DatabaseSync(dbPath);
  remote = { sha: 'sha-k1', content: 'Z29vZA==', message: 'good copy' };
  remoteError = true;
  // Сценарий аудита: GET 500 — pull не восстановил БД.
  const status = await pullBackupFile(dbPath, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  remoteError = false;
  assert.equal(status, 'error');

  putCount = 0;
  warned.length = 0;
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, apiBase, log: logCapture, remoteKnown: false });
  await bak.tick(); // mtime > 0 — remoteKnown = false
  assert.equal(putCount, 0, 'пустая БД не должна уходить в репо');
  assert.ok(remote.content === 'Z29vZA==', 'удалённая копия не тронута');
  assert.match(warned.join(' '), /push отменён/i, 'есть предупреждение');
  assert.equal(bak.status().remoteKnown, false);
  db.close();
});

test('K1: pull 500 + ТОЛЬКО события (гости) → PUT НЕ уходит', async () => {
  // Точный сценарий аудита: dbRowCount раньше считал events и «пустая» БД
  // с гостевыми событиями проходила guard, затирая хорошую копию в репо.
  const dbPath = path.join(tmpDir, 'k1-events.db');
  makeEmptyDb(dbPath);
  const db = new DatabaseSync(dbPath);
  remote = { sha: 'sha-k1e', content: 'Z29vZA==', message: 'good copy' };
  remoteError = true;
  const status = await pullBackupFile(dbPath, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  remoteError = false;
  assert.equal(status, 'error');
  // Гостевые события копятся в events (0.6.24: анонимные раздачи логируются).
  db.prepare(`
    INSERT INTO events (ts, user_id, user_email, user_name, mode, kind, payload)
    VALUES (?, NULL, NULL, NULL, 'daily', 'hand', '{}')
  `).run(new Date().toISOString());
  db.prepare(`
    INSERT INTO events (ts, user_id, user_email, user_name, mode, kind, payload)
    VALUES (?, NULL, NULL, NULL, 'daily', 'hand', '{}')
  `).run(new Date().toISOString());

  putCount = 0;
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, apiBase, log: silentLog, remoteKnown: false });
  await bak.tick();
  assert.equal(putCount, 0, 'события не разблокируют пуш при неизвестном удалённом состоянии');
  assert.ok(remote.content === 'Z29vZA==', 'удалённая копия не тронута');
  assert.equal(bak.status().remoteKnown, false);
  db.close();
});

test('K1: remoteKnown=false + записи в scores → пуш ВСЁ РАВНО не идёт', async () => {
  // Старый (опасный) guard пушил «небольшую БД, накопившую записи»:
  // локаль свежего инстанса старше удалённой истории быть не может —
  // пуш затёр бы её. Теперь remoteKnown разблокирует только pull/push.
  const dbPath = path.join(tmpDir, 'k1-fill.db');
  makeEmptyDb(dbPath);
  const db = new DatabaseSync(dbPath);
  remote = { sha: 'sha-k1f', content: 'Z29vZA==', message: 'good copy' };
  putCount = 0;
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, apiBase, log: silentLog, remoteKnown: false });
  await bak.tick();
  assert.equal(putCount, 0, 'пока пусто — не пушим');
  db.prepare('INSERT OR REPLACE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .run('u1', 'u1@x.com', 'U1', new Date().toISOString());
  db.prepare('INSERT OR REPLACE INTO scores (user_id, date, score, created_at) VALUES (?, ?, ?, ?)')
    .run('u1', '2026-10-25', 100, new Date().toISOString());
  await bak.tick();
  assert.equal(putCount, 0, 'записи НЕ разблокируют пуш — удалённое состояние неизвестно');
  assert.equal(bak.status().remoteKnown, false);
  db.close();
});

test('K1: pull >1 МБ (content: null) → raw-скачивание по download_url', async () => {
  // GitHub Contents API для файлов крупнее ~1 МБ не возвращает content —
  // pull должен добрать копию сырьём, иначе fresh-инстанс упирался в
  // 'пустой ответ GitHub' и (по старому guard) начинал пушить пустоту.
  const src = path.join(tmpDir, 'big.db');
  makeDbWithRows(src, 5);
  remote = {
    sha: 'sha-big',
    content: fs.readFileSync(src).toString('base64'),
    message: 'big copy',
    large: true, // мокируем поведение Contents API для больших файлов
  };
  const dst = path.join(tmpDir, 'big-restored.db');
  const status = await pullBackupFile(dst, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  assert.equal(status, 'restored', 'крупная копия восстановлена через download_url');
  const db = new DatabaseSync(dst);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM scores').get();
  db.close();
  assert.equal(rows.n, 5, 'содержимое совпадает');
});

test('F5: нет данных, но репо пустой (no-copy) → push разрешён', async () => {
  const dbPath = path.join(tmpDir, 'f5-nocopy.db');
  makeEmptyDb(dbPath);
  const db = new DatabaseSync(dbPath);
  remote = null; // 404 — в репо копии нет
  putCount = 0;
  const status = await pullBackupFile(dbPath, { repo: REPO, token: 't', file: FILE, apiBase, log: silentLog });
  assert.equal(status, 'no-copy');
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, apiBase, log: silentLog, remoteKnown: true });
  await bak.tick();
  assert.equal(putCount, 1, 'в репо и так пусто — перекрывать нечего');
  db.close();
});

test('pushNow: первый commit без sha, второй — с sha (обновление)', async () => {
  const dbPath = path.join(tmpDir, 'push.db');
  makeDbWithRows(dbPath, 2);
  const db = new DatabaseSync(dbPath);
  remote = null;
  putCount = 0;

  // Локальная БД не пустая (постоянный диск) → remoteKnown = true (index.js).
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, branch: 'main', apiBase, log: silentLog, remoteKnown: true });
  await bak.pushNow('initial');
  assert.equal(putCount, 1);
  assert.ok(remote.content, 'в репо лежит base64-копия');
  const firstSha = remote.sha;
  assert.equal(bak.status().lastPushError, null);

  // Изменяем БД и пушим снова: должен прийти тот же sha (обновление файла).
  db.prepare('INSERT OR REPLACE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .run('u9', 'u9@x.com', 'U9', new Date().toISOString());
  await bak.pushNow('second');
  assert.equal(putCount, 2);
  assert.notEqual(remote.sha, firstSha);

  // Содержимое в репо открывается как валидная БД со строкой u9.
  const checkPath = path.join(tmpDir, 'check.db');
  fs.writeFileSync(checkPath, Buffer.from(remote.content, 'base64'));
  const checkDb = new DatabaseSync(checkPath);
  const found = checkDb.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get('u9');
  checkDb.close();
  assert.equal(found.n, 1, 'обновлённая копия содержит новую строку');
  db.close();
});

test('tick: commit только при изменении БД; без изменений — молча', async () => {
  const dbPath = path.join(tmpDir, 'tick.db');
  makeDbWithRows(dbPath, 1);
  const db = new DatabaseSync(dbPath);
  remote = null;
  putCount = 0;

  // Локальная БД не пустая (постоянный диск) → remoteKnown = true (index.js).
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, branch: 'main', apiBase, log: silentLog, remoteKnown: true });
  await bak.tick(); // первый такт: БД «старше» lastPushMtime=0 → push
  assert.equal(putCount, 1);

  await bak.tick(); // ничего не изменилось → push не идёт
  assert.equal(putCount, 1);

  // Изменяем БД и форсим mtime вперёд (детерминированность теста).
  db.prepare('INSERT OR REPLACE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .run('u77', 'u77@x.com', 'U77', new Date().toISOString());
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(dbPath, future, future);
  await bak.tick();
  assert.equal(putCount, 2, 'изменение БД привело к новому commit');
  db.close();
});

test('status: показывает repo/file/branch, размер и отсутствие ошибок', async () => {
  const dbPath = path.join(tmpDir, 'status.db');
  makeDbWithRows(dbPath, 1);
  const db = new DatabaseSync(dbPath);
  const bak = createBackup({ db, dbPath, repo: REPO, token: 't', file: FILE, branch: 'main', apiBase, log: silentLog });
  const st = bak.status();
  assert.equal(st.configured, true);
  assert.equal(st.repo, REPO);
  assert.equal(st.file, FILE);
  assert.equal(st.branch, 'main');
  assert.equal(st.lastPushError, null);
  assert.ok(st.dbSize > 0);
  db.close();
});
