import { readFileSync, writeFileSync } from 'node:fs';

const R = 'C:/Users/pyv20/OneDrive/Desktop/Работа/mahjongdle';
const rep = [];

// ---------- index.html ----------
let html = readFileSync(`${R}/index.html`, 'utf8');
const before = html.length;

if (!html.includes('id="view-game"')) {
  html = html.replace(/\n(\s*)<main>\n/, '\n$1<main id="view-game">\n');
  rep.push(`view-game: ${html.includes('id="view-game"')}`);
}

if (!html.includes('class="view-tabs"')) {
  const tabs = [
    '<nav class="view-tabs" id="view-tabs">',
    '  <button id="tab-game" class="view-tab is-active" type="button">Игра</button>',
    '  <button id="tab-test" class="view-tab" type="button" hidden>Тестовый режим</button>',
    '</nav>',
  ].join('\n  ');
  html = html.replace('</header>', `</header>\n  ${tabs}`);
  rep.push(`tabs: ${html.includes('id="tab-test"')}`);
}

if (html.includes('<dialog id="test-mode-dialog"')) {
  html = html.replace('<dialog id="test-mode-dialog" class="structure-dialog test-dialog">', '<section id="view-test" class="test-view" hidden>');
  rep.push(`dialog->section open: ${html.includes('id="view-test"')}`);
}
if (html.includes('</dialog>')) {
  html = html.replace('</dialog>', '</section>');
  rep.push('dialog close -> section');
}

if (!html.includes('id="tm-palette"')) {
  html = html.replace('id="tm-hand"', 'id="tm-hand"');
  const anchor = /(\s*)<div id="tm-hand" class="hand" role="list"><\/div>/;
  if (anchor.test(html)) {
    html = html.replace(anchor, (m, ws) => `${ws}<div id="tm-palette" class="tile-palette" role="list"></div>${ws}<div id="tm-kan-dora-wall" class="kan-dora-wall"></div>${m}`);
    rep.push(`palette: ${html.includes('id="tm-palette"')}, kandoras: ${html.includes('tm-kan-dora-wall')}`);
  } else {
    rep.push('palette: ЯКОРЬ НЕ НАЙДЕН');
  }
}

html = html.replace(/v0\.6\.7/g, 'v0.6.8');
writeFileSync(`${R}/index.html`, html, 'utf8');
rep.push(`index.html: ${before} -> ${html.length}`);

// ---------- version.js ----------
writeFileSync(`${R}/src/version.js`, "/** Версия игры. Меняется вручную при выпуске; показывается в шапке страницы. */\nexport const APP_VERSION = '0.6.8';\n", 'utf8');
rep.push('version.js -> 0.6.8');

// ---------- styles.css ----------
let css = readFileSync(`${R}/styles.css`, 'utf8');
if (!css.includes('.test-view')) {
  css += `

/* ===== тестовый режим: отдельная вкладка ===== */
.view-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 16px 0;
}
.view-tab {
  border: 1px solid var(--line, #2b3a44);
  background: transparent;
  color: inherit;
  padding: 7px 14px;
  border-radius: 10px 10px 0 0;
  font: inherit;
  cursor: pointer;
  opacity: .7;
}
.view-tab.is-active {
  opacity: 1;
  background: var(--panel, #16232b);
  border-bottom-color: transparent;
}
.test-view {
  /* явно другой фон: сразу видно, что это тестовый режим */
  background: linear-gradient(180deg, #2a1f3d 0%, #1b2740 100%);
  border: 1px solid #6b4fa0;
  border-radius: 14px;
  margin: 12px 16px 24px;
  padding: 16px;
  box-shadow: 0 0 0 1px rgba(160, 120, 255, .18) inset;
}
.test-view::before {
  content: 'ТЕСТОВЫЙ РЕЖИМ — в рейтинг не пишется';
  display: block;
  font-size: 11px;
  letter-spacing: .12em;
  font-weight: 700;
  color: #c9a7ff;
  margin-bottom: 12px;
}
.tile-palette {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 4px;
  margin: 10px 0 14px;
  padding: 8px;
  border: 1px dashed rgba(201, 167, 255, .35);
  border-radius: 10px;
}
.tile-palette .tile {
  cursor: pointer;
}
.kan-dora-wall {
  margin: 8px 0;
}
`;
  writeFileSync(`${R}/styles.css`, css, 'utf8');
  rep.push('styles.css: добавлены стили вкладки/палитры');
} else {
  rep.push('styles.css: стили уже есть');
}

writeFileSync(`${R}/scripts/patch-view.txt`, rep.join('\n'), 'utf8');
console.log('ok');
