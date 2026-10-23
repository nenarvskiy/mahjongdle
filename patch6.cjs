const fs = require('fs');
const f = (v) => (v ? 1 : 0);

let s = fs.readFileSync('src/test-mode.js', 'utf8');
const A1 = [
  '    if (hand.length === 13 && declaredKans.length === 0) {',
  "      phase = 'result';",
  '      remaining = hand;',
  '      score = evaluateHand(hand, ctx);',
  '      return;',
  '    }',
  '    const full = fullTiles();',
  '    if (full.length >= 14) {',
  '      const complete = evaluateCompleteHand(full, ctx);',
  '      if (complete) {',
  "        phase = 'complete';",
  '        score = complete;',
  '        remaining = hand;',
  '        return;',
  '      }',
  "      phase = 'choose';",
  '      score = null;',
  '      remaining = [];',
  '      return;',
  '    }',
].join('\n');
const A2 = [
  '    const full = fullTiles();',
  '    if (full.length === 14) {',
  "      phase = 'choose';",
  '      score = null;',
  '      remaining = [];',
  '      return;',
  '    }',
  '    if (full.length === 13) {',
  "      phase = 'result';",
  '      remaining = hand;',
  '      score = evaluateHand(full, ctx);',
  '      return;',
  '    }',
].join('\n');
let a = false;
if (s.includes(A1)) { s = s.replace(A1, A2); a = true; }

const B1 = "      else if (phase === 'choose') els.hint.textContent = pendingKan ? 'Объявите кан или пропустите.' : 'Выберите тайл для сброса.';";
const B2 = [
  "      else if (pendingKan) els.hint.textContent = 'Есть кан: объявите его или пропустите.';",
  '      else if (phase === \'choose\') els.hint.textContent = `Рука просчитана. Теперь выберите тайл для сброса (${hand.length} в руке).`;',
].join('\n');
let b = false;
if (s.includes(B1)) { s = s.replace(B1, B2); b = true; }

const C1 = 'if (els.reset) els.reset.hidden = !scored;';
const C2 = "if (els.hand) els.hand.classList.toggle('await-discard', scored && phase === 'choose' && !pendingKan);\n    " + C1;
let c = false;
if (s.includes(C1)) { s = s.replace(C1, C2); c = true; }
fs.writeFileSync('src/test-mode.js', s);

let h = fs.readFileSync('index.html', 'utf8');
let d = false;
if (!h.includes('btn-tm-score')) {
  const anchor = 'Отменить сброс</button>';
  const i = h.indexOf(anchor);
  if (i >= 0) {
    const end = i + anchor.length;
    h = h.slice(0, end) + '\n      <button id="btn-tm-score" type="button">Просчитать руку</button>' + h.slice(end);
    fs.writeFileSync('index.html', h);
    d = true;
  }
}

let css = fs.readFileSync('styles.css', 'utf8');
let e = false;
if (!css.includes('await-discard')) {
  css += '\n.hand.await-discard {\n  outline: 2px dashed rgba(201, 167, 255, .55);\n  outline-offset: 6px;\n  border-radius: 10px;\n}\n';
  fs.writeFileSync('styles.css', css);
  e = true;
}

const t = fs.readFileSync('src/test-mode.js', 'utf8');
const hh = fs.readFileSync('index.html', 'utf8');
const cc = fs.readFileSync('styles.css', 'utf8');
console.log('A=' + a + ' B=' + b + ' C=' + c + ' btnHtml=' + d
  + ' choose14=' + f(t.includes('full.length === 14'))
  + ' result13=' + f(t.includes('full.length === 13'))
  + ' hint=' + f(t.includes('Есть кан'))
  + ' await=' + f(t.includes('await-discard'))
  + ' htmlBtn=' + f(hh.includes('btn-tm-score'))
  + ' css=' + f(cc.includes('await-discard')));
