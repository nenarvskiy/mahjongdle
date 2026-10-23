/**
 * Окно «Вчерашняя рука» (сверху страницы).
 *
 * Показывается после входа, если вчера игрок сдавал руку:
 *  - вчерашняя рука тайлами и сброшенный тайл;
 *  - вчерашние открытые кандоры (только те, что были открыты);
 *  - старый и новый счёт, если он изменился после ночного пересчёта.
 *
 * Данные готовит сервер (GET /api/me/yesterday): он же один раз за день
 * пересчитывает вчерашние руки с ура-дорами и кандорами.
 */
import { fetchYesterday } from './auth.js';
import { renderTiles } from './ui.js';
import { createDeadWall, doraFromIndicator } from './daily-context.js';
import { openKanDoraCount } from './kans.js';

export function initYesterday({ dayKey }) {
  const panel = document.getElementById('yesterday-panel');
  if (!panel) return;
  const handEl = document.getElementById('yesterday-hand');
  const discardEl = document.getElementById('yesterday-discarded');
  const kanDoraEl = document.getElementById('yesterday-kandoras');
  const scoreEl = document.getElementById('yesterday-score');
  const titleEl = document.getElementById('yesterday-title');

  async function refresh() {
    let data;
    try {
      data = await fetchYesterday(dayKey);
    } catch {
      panel.hidden = true;
      return;
    }
    if (!data || !data.hand || data.hand.length === 0) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    titleEl.textContent = `Вчерашняя рука (${data.date})`;

    const tiles = data.tiles?.length ? data.tiles : data.hand;
    renderTiles(handEl, tiles, { disabled: true });

    if (data.discarded) {
      discardEl.hidden = false;
      renderTiles(discardEl, [data.discarded], { disabled: true });
    } else {
      discardEl.hidden = true;
    }

    // Вчерашние открытые кандоры: 1 базовая + по одной за объявленный кан.
    const wall = createDeadWall(data.date);
    const openCount = openKanDoraCount((data.kans ?? []).length);
    const openKanDoras = wall.kanDora.slice(0, openCount);
    kanDoraEl.innerHTML = '';
    for (const indicator of openKanDoras) {
      const cell = document.createElement('div');
      cell.className = 'yesterday-kandora';
      cell.title = `Кан-дора вчера: ${doraFromIndicator(indicator)}`;
      renderTiles(cell, [indicator], { disabled: true });
      kanDoraEl.append(cell);
    }

    const oldScore = Number(data.oldScore ?? 0);
    const newScore = Number(data.newScore ?? oldScore);
    if (newScore !== oldScore) {
      const up = newScore > oldScore;
      scoreEl.textContent = `Очки пересчитаны: ${oldScore.toLocaleString('ru-RU')} → ${newScore.toLocaleString('ru-RU')} (${up ? '+' : ''}${(newScore - oldScore).toLocaleString('ru-RU')})`;
      scoreEl.className = `yesterday-score ${up ? 'is-up' : 'is-down'}`;
    } else {
      scoreEl.textContent = `Очки: ${newScore.toLocaleString('ru-RU')} (не изменились)`;
      scoreEl.className = 'yesterday-score';
    }
    scoreEl.hidden = false;
  }

  return { refresh };
}
