import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { APP_VERSION } from '../src/version.js';

test('версия игры: 0.7.0', () => {
  assert.equal(APP_VERSION, '0.7.0');
});

test('версия отображается в шапке и берётся из version.js', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="app-version"/, 'в шапке есть элемент версии');
  assert.match(html, /v0\.7\.0/, 'есть статичный фолбэк версии');
  assert.match(html, /from '\.\/src\/version\.js'/, 'версия подставляется из общего модуля');
});
