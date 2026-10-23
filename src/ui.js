import { CONFIG } from './config.js';
import { canonicalTileId, tileDisplayName } from './tiles.js';

/** Создать DOM-элемент тайла. */
export function createTileElement(tileId, {
  onClick, disabled = false, doraTiles = [], uraTiles = [],
} = {}) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tile = tileId;
  el.title = tileDisplayName(tileId);
  el.setAttribute('role', 'listitem');

  if (disabled) el.classList.add('is-disabled');
  if (tileId[0] === '0') el.classList.add('is-red-five');
  if (doraTiles.map(canonicalTileId).includes(canonicalTileId(tileId))) {
    el.classList.add('is-dora');
  }
  // Ура-дора: помечаем тайлы только когда ура-индикатор открыт (после сброса).
  if (uraTiles.map(canonicalTileId).includes(canonicalTileId(tileId))) {
    el.classList.add('is-ura');
  }

  const img = document.createElement('img');
  img.alt = tileDisplayName(tileId);
  img.src = CONFIG.tileImagePath(tileId);
  img.addEventListener('error', () => {
    img.remove();
    const fallback = document.createElement('span');
    fallback.className = 'tile-fallback';
    fallback.textContent = tileId;
    el.appendChild(fallback);
  });
  el.appendChild(img);

  if (onClick && !disabled) {
    el.addEventListener('click', () => onClick(tileId, el));
  }
  return el;
}

/** Отрисовать массив тайлов в контейнер. */
export function renderTiles(container, tiles, options = {}) {
  container.innerHTML = '';
  tiles.forEach((id, index) => {
    const el = createTileElement(id, {
      disabled: options.disabled,
      doraTiles: options.doraTiles,
      uraTiles: options.uraTiles,
      onClick: options.onTileClick
        ? (_id, node) => options.onTileClick(index, _id, node)
        : null,
    });
    container.appendChild(el);
  });
}

/** Отрисовать руку, сгруппированную по структурам. */
export function renderGroupedHand(container, groups, options = {}) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'hand-groups';

  for (const g of groups) {
    const block = document.createElement('div');
    block.className = 'hand-group' + (g.isSingle ? ' is-single' : '');

    const row = document.createElement('div');
    row.className = 'group-tiles';
    for (const tid of g.tiles) {
      const el = createTileElement(tid, {
        disabled: true, doraTiles: options.doraTiles, uraTiles: options.uraTiles,
      });
      row.appendChild(el);
    }
    block.appendChild(row);

    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = g.label;
    block.appendChild(label);

    const pts = document.createElement('div');
    pts.className = 'group-points';
    pts.textContent = g.points > 0 ? `+${g.points}` : '0';
    block.appendChild(pts);

    wrap.appendChild(block);
  }

  container.appendChild(wrap);
}

/** Отрисовать результат скоринга (список строк + итог). */
export function renderScore(container, score) {
  container.innerHTML = '';
  if (!score) { container.textContent = '—'; return; }

  const list = document.createElement('ul');
  list.style.cssText = 'margin:0;padding:0 0 0 18px;line-height:1.6';

  for (const row of score.breakdown) {
    const li = document.createElement('li');
    let text = row.points === 0
      ? row.label
      : `${row.label}: ${row.points > 0 ? '+' : ''}${row.points}`;
    if (row.blocks?.length) {
      text += ` (${row.blocks.map((b) => `${b.label} +${b.points}`).join(', ')})`;
    }
    li.textContent = text;
    li.className = row.yaku ? 'score-yaku' : row.potential ? 'score-potential' : '';
    list.appendChild(li);
  }

  const total = document.createElement('div');
  total.style.cssText = 'margin-top:10px;font-size:20px;color:var(--accent)';
  total.textContent = `Итого: ${score.total}`;

  container.appendChild(list);
  container.appendChild(total);
}
