import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';

const paths = [
  'C:/Users/pyv20/OneDrive/Desktop/Работа/mahjongdle',
  'D:/Работа/mahjongdle',
];

const out = [];
for (const p of paths) {
  const hasGit = existsSync(`${p}/.git`);
  const hasIndex = existsSync(`${p}/index.html`);
  const hasTm = existsSync(`${p}/src/test-mode.js`);
  let mtime = '-';
  let palette = '-';
  let ver = '-';
  if (hasTm) {
    mtime = statSync(`${p}/src/test-mode.js`).mtime.toISOString().slice(0, 16);
    const t = readFileSync(`${p}/src/test-mode.js`, 'utf8');
    palette = t.includes('addTile(row[index])') ? 'fixed' : 'old';
  }
  if (hasIndex) {
    const h = readFileSync(`${p}/index.html`, 'utf8');
    ver = h.includes('v0.6.8') ? '068' : 'older';
  }
  out.push(`${p} | git=${hasGit} index=${hasIndex} tm=${hasTm} mtime=${mtime} palette=${palette} ver=${ver}`);
}
writeFileSync('where.txt', out.join('\n'), 'utf8');
