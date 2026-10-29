/**
 * Отрисовка канов и кандор.
 *
 *  - объявленный кан — закрытый: крайние тайлы рубашкой, центральные два
 *    открыты (как в реальном маджонге);
 *  - превью кана над кнопками «Кан»/«Пропустить» — мелкие тайлы;
 *  - слоты кан-дор: до полуночи — закрытые рубашки (открытие — в окне
 *    «Вчера»); за объявленные каны — жёлтая обводка, а на наведении
 *    (0.7.5) — карточка: кто объявил кан, его рука, счёт и что кан-дора
 *    откроется в полночь.
 */
import { createTileElement } from './ui.js';
import { tileDisplayName } from './tiles.js';
import { kanDoraSlots } from './kans.js';

/** Закрытый кан: рубашка, открытый, открытый, рубашка. */
export function renderClosedKan(container, kan) {
  const wrap = document.createElement('div');
  wrap.className = 'kan-closed';
  wrap.title = `Закрытый кан: ${tileDisplayName(kan.tile)}`;
  for (let i = 0; i < 4; i++) {
    if (i === 1 || i === 2) {
      const tile = createTileElement(kan.tile, { disabled: true });
      tile.classList.add('kan-tile-open');
      wrap.append(tile);
    } else {
      const back = document.createElement('div');
      back.className = 'tile-back kan-tile-back';
      wrap.append(back);
    }
  }
  container.append(wrap);
}

/** Превью кана мелким размером (над кнопками). */
export function renderKanPrompt(container, kan) {
  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    container.append(createTileElement(kan.tile, { disabled: true }));
  }
}

/* 0.7.5: карточка кан-дора «откроется в конце дня» живёт в BODY
   (position:fixed): панель «Условия дня» имеет overflow:hidden и
   обрезала бы карточку, позиционированную внутри неё. Один элемент,
   наполняется заново на каждый ховер; на тач-экранах — тап «запирает»
   карточку до второго тапа. */
let tipEl = null;
let tipHideTimer = null;
let tipPinned = null; // back-элемент, для которого карточка заперта

function ensureTipEl() {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'kan-dora-tip';
  document.body.append(tipEl);
  return tipEl;
}

function fillTip(tip, player) {
  tip.innerHTML = '';
  const name = document.createElement('div');
  name.className = 'kan-dora-tip-name';
  name.textContent = player.mine ? `Кан: ${player.name} (вы)` : `Кан: ${player.name}`;
  tip.append(name);
  // Рука: после сброса — 13 тайлов + сброшенный, до сброса — все 14.
  const hand = document.createElement('div');
  hand.className = 'kan-dora-tip-hand';
  const tiles = (player.tiles && player.tiles.length ? player.tiles : player.hand) || [];
  for (const t of tiles) hand.append(createTileElement(t, { disabled: true }));
  if (player.discarded) {
    const sep = document.createElement('span');
    sep.className = 'kan-dora-tip-sep';
    sep.textContent = '→';
    const d = createTileElement(player.discarded, { disabled: true });
    d.classList.add('kan-dora-tip-discarded');
    hand.append(sep, d);
  }
  tip.append(hand);
  const meta = document.createElement('div');
  meta.className = 'kan-dora-tip-meta';
  meta.textContent = player.score > 0
    ? `Счёт: ${Number(player.score).toLocaleString('ru-RU')}`
    : 'Ещё не сбрасывал тайл';
  tip.append(meta);
  const note = document.createElement('div');
  note.className = 'kan-dora-tip-note';
  note.textContent =
    'Кан-дора откроется в полночь (00:00 МСК): всем за день добавится +1 дора, ' +
    'очки пересчитаются. Загляните завтра.';
  tip.append(note);
}

function positionTip(tip, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let top = r.top - h - 10; // выше рубашки
  if (top < 8) top = Math.min(r.bottom + 10, window.innerHeight - h - 8); // иначе — ниже
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showTip(player, anchor) {
  if (tipHideTimer) { clearTimeout(tipHideTimer); tipHideTimer = null; }
  const tip = ensureTipEl();
  fillTip(tip, player);
  tip.classList.add('show');
  positionTip(tip, anchor);
}

function hideTip(delay = 120) {
  if (tipPinned) return;
  if (tipHideTimer) clearTimeout(tipHideTimer);
  tipHideTimer = setTimeout(() => {
    tipHideTimer = null;
    if (tipEl) tipEl.classList.remove('show');
  }, delay);
}

function unpinTip() {
  tipPinned = null;
  if (tipHideTimer) { clearTimeout(tipHideTimer); tipHideTimer = null; }
  if (tipEl) tipEl.classList.remove('show');
}

if (typeof window !== 'undefined') {
  // Скролл/ресайз — фиксированная карточка «оторвётся» от рубашки:
  // закрываем (кроме запертой тапом).
  const close = () => { if (!tipPinned && tipEl) tipEl.classList.remove('show'); };
  window.addEventListener('scroll', close, { passive: true });
  window.addEventListener('resize', close);
}

/**
 * Слоты кан-дор: открытые тайлы и закрытые рубашки.
 * В живой игре все закрыты (открытие — в полночь); pending — [{index,
 * tooltip, player}]: слоты «откроются в конце дня» (за каны, объявленные
 * сегодня кем угодно) — рубашка с ЖЁЛТОЙ обводкой, на наведении/тапе —
 * карточка игрока (рука, счёт, когда откроется дора).
 */
export function renderKanDoras(container, deadWall, openCount, pending = []) {
  unpinTip(); // новая отрисовка — старая «запертая» карточка неактуальна
  const pendingByIndex = new Map(pending.map((p) => [p.index, p]));
  container.innerHTML = '';
  for (const slot of kanDoraSlots(deadWall, openCount)) {
    const cell = document.createElement('div');
    cell.className = 'kan-dora-slot';
    if (slot.open) {
      cell.append(createTileElement(slot.tile, { disabled: true }));
      container.append(cell);
      continue;
    }
    const back = document.createElement('div');
    back.className = 'tile-back kan-dora-back';
    back.tabIndex = 0; // клавиатура/тач тоже открывают карточку (focus)
    const p = pendingByIndex.get(slot.index);
    back.title = p ? p.tooltip : 'Откроется, если сегодня объявят ещё один кан';
    if (p) back.classList.add('kan-dora-pending');
    if (p?.player) {
      back.addEventListener('mouseenter', () => showTip(p.player, back));
      back.addEventListener('focus', () => showTip(p.player, back));
      back.addEventListener('mouseleave', () => hideTip());
      back.addEventListener('blur', () => hideTip());
      // Тач: первый тап — показать и запереть, второй — закрыть.
      back.addEventListener('click', () => {
        if (tipPinned === back) { unpinTip(); return; }
        tipPinned = back;
        showTip(p.player, back);
      });
    }
    cell.append(back);
    container.append(cell);
  }
}
