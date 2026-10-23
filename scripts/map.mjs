import { readFileSync, writeFileSync } from 'node:fs';

function scan(file, patterns, max = 70) {
  const out = [];
  readFileSync(file, 'utf8').split('\n').forEach((t, i) => {
    if (patterns.some((p) => t.includes(p))) out.push(`${i + 1}|${t.trim().slice(0, max)}`);
  });
  return out.join('\n');
}

writeFileSync('scripts/m1.txt', scan('index.html', ['<main', '</main>', '</header>', '<dialog', '</dialog>', 'btn-test-mode', '<footer'], 50), 'utf8');
writeFileSync('scripts/m2.txt', scan('src/main.js', ['showModal', 'TestMode', 'test-mode', 'ialog'], 60), 'utf8');
writeFileSync('scripts/m3.txt', scan('src/main.js', ['declaredKans', 'pendingKan', 'refreshKanPrompt', 'declareKan', 'skipKan', 'withKanPons', 'renderKanDoras', 'kanList'], 60), 'utf8');
writeFileSync('scripts/m4.txt', scan('src/test-mode.js', ['function ', 'renderClosedKan', 'refreshKanPrompt', 'els.kanList', 'withKanPons'], 60), 'utf8');
console.log('ok');
