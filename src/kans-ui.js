/**
 * Отрисовка канов и кандор.
 *
 *  - объявленный кан — закрытый: крайние тайлы рубашкой, центральные два
 *    открыты (как в реальном маджонге);
 *  - превью кана над кнопками «Кан»/«Пропустить» — мелкие тайлы;
 *  - слоты кандор: открытая — тайл, закрытая — рубашка с золотой обводкой
 *    и подсказкой «уже открыта, возвращайтесь завтра».
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

/**
 * Слоты кандор: открытые тайлы и закрытые рубашки.
 * pending — [{index, tooltip}]: слоты, которые «откроются в конце дня»
 * (за каны, объявленные сегодня кем угодно) — рубашка с ЖЁЛТОЙ обводкой
 * и пояснением на наведении.
 */
export function renderKanDoras(container, deadWall, openCount, pending = []) {
  const pendingByIndex = new Map(pending.map((p) => [p.index, p.tooltip]));
  container.innerHTML = '';
  for (const slot of kanDoraSlots(deadWall, openCount)) {
    const cell = document.createElement('div');
    cell.className = 'kan-dora-slot';
    if (slot.open) {
      cell.append(createTileElement(slot.tile, { disabled: true }));
    } else if (pendingByIndex.has(slot.index)) {
      const back = document.createElement('div');
      back.className = 'tile-back kan-dora-back kan-dora-pending';
      back.title = pendingByIndex.get(slot.index);
      cell.append(back);
    } else {
      const back = document.createElement('div');
      back.className = 'tile-back kan-dora-back';
      back.title = 'Откроется, если сегодня объявят ещё один кан';
      cell.append(back);
    }
    container.append(cell);
  }
}
