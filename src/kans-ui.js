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

/** Слоты кандор: открытые тайлы и закрытые рубашки с золотой обводкой. */
export function renderKanDoras(container, deadWall, openCount) {
  container.innerHTML = '';
  for (const slot of kanDoraSlots(deadWall, openCount)) {
    const cell = document.createElement('div');
    cell.className = 'kan-dora-slot';
    if (slot.open) {
      cell.append(createTileElement(slot.tile, { disabled: true }));
    } else {
      const back = document.createElement('div');
      back.className = 'tile-back kan-dora-back';
      back.title = 'Кан-дора уже открыта — возвращайтесь завтра, чтобы узнать её';
      cell.append(back);
    }
    container.append(cell);
  }
}
