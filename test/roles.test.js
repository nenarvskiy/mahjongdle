/**
 * Тесты файла ролей (server/roles.js):
 *  - F14: битый JSON — не молча, а с лог-предупреждением;
 *  - F14: нельзя убрать последнего админа (lockout панели ролей);
 *  - F14: запись атомарна (tmp + rename), .tmp не остаётся;
 *  - базовое: приоритет admin > test, регистр email не важен.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRolesFile, writeRolesFile, setRole, roleFor } from '../server/roles.js';

async function tempRolesFile() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'mj-roles-'));
  return path.join(dir, 'roles.json');
}

test('F14: битый JSON — пустые списки + лог-предупреждение', async () => {
  const file = await tempRolesFile();
  await fs.writeFile(file, '{ это не json', 'utf8');
  const warnings = [];
  const log = { error: (message) => warnings.push(message) };
  const roles = await readRolesFile(file, log);
  assert.deepEqual(roles, { admin: [], test: [] });
  assert.equal(warnings.length, 1, 'ошибка зафиксирована в логе, а не проглочена');
  assert.match(warnings[0], /битый JSON/);
});

test('F14: нет файла — пустые списки без предупреждения (свежий запуск)', async () => {
  const file = await tempRolesFile();
  const warnings = [];
  const roles = await readRolesFile(file, { error: (m) => warnings.push(m) });
  assert.deepEqual(roles, { admin: [], test: [] });
  assert.deepEqual(warnings, []);
});

test('F14: нельзя убрать последнего админа (lockout)', async () => {
  const file = await tempRolesFile();
  await writeRolesFile({ admin: ['only-admin@example.com'], test: [] }, file);
  await assert.rejects(
    () => setRole('only-admin@example.com', 'player', file),
    /последнего админа/,
  );
  // Файл не изменился
  assert.deepEqual(await readRolesFile(file), { admin: ['only-admin@example.com'], test: [] });
  // Назначить второго админа — и снять первого: можно
  await setRole('second@example.com', 'admin', file);
  const roles = await setRole('only-admin@example.com', 'player', file);
  assert.deepEqual(roles.admin, ['second@example.com']);
});

test('F14: запись атомарна — в каталоге не остаётся .tmp', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'mj-roles-'));
  const file = path.join(dir, 'roles.json');
  await setRole('a@example.com', 'admin', file);
  const entries = (await fs.readdir(dir)).sort();
  assert.deepEqual(entries, ['roles.json']);
  assert.deepEqual(await readRolesFile(file), { admin: ['a@example.com'], test: [] });
});

test('roleFor: приоритет admin > test, регистр и пробелы не важны', async () => {
  const file = await tempRolesFile();
  await writeRolesFile({ admin: ['Admin@Example.com'], test: ['Tester@Example.com'] }, file);
  assert.equal(await roleFor('admin@example.com', file), 'admin');
  assert.equal(await roleFor(' admin@example.com ', file), 'admin');
  assert.equal(await roleFor('tester@example.com', file), 'test');
  assert.equal(await roleFor('nobody@example.com', file), 'player');
  assert.equal(await roleFor(null, file), 'player');
});
