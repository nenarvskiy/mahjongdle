import { readFileSync } from 'node:fs';

const R = 'C:/Users/pyv20/OneDrive/Desktop/Работа/mahjongdle';
const r = (p) => readFileSync(`${R}/${p}`, 'utf8');
const html = r('index.html');
const tm = r('src/test-mode.js');
const css = r('styles.css');
const ver = r('src/version.js');

const out = {
  viewGame: html.includes('id="view-game"'),
  viewTest: html.includes('id="view-test"'),
  tabTest: html.includes('id="tab-test"'),
  palette: html.includes('id="tm-palette"'),
  kanDoraWall: html.includes('tm-kan-dora-wall'),
  noDialog: !html.includes('</dialog>') && !html.includes('<dialog id="test-mode-dialog"'),
  htmlV068: html.includes('v0.6.8'),
  ver068: ver.includes("'0.6.8'"),
  cssTestView: css.includes('.test-view'),
  cssPalette: css.includes('.tile-palette'),
  tmInit: tm.includes('export function initTestMode'),
  tmParse: tm.includes('export function parseHandTokens'),
  tmFindKans: tm.includes('findKans'),
  tmKanPons: tm.includes('withKanPons'),
  tmClosedKan: tm.includes('renderClosedKan'),
  tmRefresh: tm.includes('refreshKanPrompt()'),
  tmPalette: tm.includes('renderPalette'),
  tmAddTile: tm.includes('function addTile'),
};
console.log(JSON.stringify(out));
const bad = Object.entries(out).filter(([, v]) => !v).map(([k]) => k);
console.log(bad.length ? 'BAD: ' + bad.join(',') : 'ALL OK');
