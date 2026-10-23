import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const out = [];
const files = [];
for (const dir of ['src', 'test', 'scripts', 'server']) {
  try {
    for (const f of readdirSync(dir)) if (f.endsWith('.js') || f.endsWith('.mjs')) files.push(`${dir}/${f}`);
  } catch {}
}
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  text.split('\n').forEach((t, i) => {
    if (t.includes('test-mode')) out.push(`${f}:${i + 1}|${t.trim().slice(0, 80)}`);
  });
}
writeFileSync('scripts/deps.txt', out.join('\n') || 'нет зависимостей', 'utf8');
console.log('files', files.length, 'hits', out.length);
