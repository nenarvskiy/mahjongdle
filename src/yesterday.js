/**
 * Окно «Вчерашняя рука» (справа).
 *
 * Видно каждому вошедшему игроку (рука/счёт — только если вчера была рука):
 *  - вчерашняя рука тайлами и сброшенный тайл (или «рука не сдавалась»);
 *  - что открылось в конце дня: ура-индикатор + ура-дора,
 *    открытые кан-доры (1 базовая + по одной за кан) и кан-ура;
 *  - старый и новый счёт, если он изменился после ночного пересчёта.
 *
 * Данные готовит сервер (GET /api/me/yesterday): он же один раз за день
 * пересчитывает вчерашние руки с ура-дорами и кандорами. Ура-индикатор
 * и мёртвая стена детерминированы dayKey — считаются локально.
 */
import { getAuth, fetchYesterday } from './auth.js';
import { renderTiles } from './ui.js';
import { createDailyContext, doraFromIndicator } from './daily-context.js';
import { openKanDoraCount } from './kans.js';

export function initYesterday({ dayKey }) {
  const panel = document.getElementById('yesterday-panel');
  if (!panel) return;
  const handEl = document.getElementById('yesterday-hand');
  const discardEl = document.getElementById('yesterday-discarded');
  const uraRowEl = document.getElementById('yesterday-ura-row');
  const uraEl = document.getElementById('yesterday-ura');
  const kanDoraEl = document.getElementById('yesterday-kandoras');
  const kanUraEl = document.getElementById('yesterday-kanuras');
  const scoreEl = document.getElementById('yesterday-score');
  const titleEl = document.getElementById('yesterday-title');

  /** Тайл с подписью (для открывшихся дор). */
  function doraCell(indicator) {
    const cell = document.createElement('div');
    cell.className = 'yesterday-kandora';
    cell.title = `Индикатор: ${indicator} → дора: ${doraFromIndicator(indicator)}`;
    renderTiles(cell, [indicator], { disabled: true });
    const tag = document.createElement('span');
    tag.className = 'yesterday-dora-tag';
    tag.textContent = `→ ${doraFromIndicator(indicator)}`;
    cell.append(tag);
    return cell;
  }

  /** Открывшиеся в конце дня доры (детерминированы dayKey вчерашнего дня). */
  function renderOpenedDoras(date, kans = []) {
    const ctx = createDailyContext(new Date(`${date}T12:00:00Z`));
    const wall = ctx.deadWall;

    if (uraRowEl && uraEl) {
      uraEl.innerHTML = '';
      if (ctx.uraIndicators.length) {
        uraRowEl.hidden = false;
        uraEl.append(doraCell(ctx.uraIndicators[0]));
      } else {
        uraRowEl.hidden = true;
      }
    }

    // Открытые кан-доры: 1 базовая + по одной за объявленный кан.
    const openCount = openKanDoraCount((kans ?? []).length);
    kanDoraEl.innerHTML = '';
    for (const indicator of wall.kanDora.slice(0, openCount)) {
      kanDoraEl.append(doraCell(indicator));
    }

    // Кан-ура открываются все пять в конце дня.
    kanUraEl.innerHTML = '';
    for (const indicator of wall.kanUra) {
      kanUraEl.append(doraCell(indicator));
    }
  }

  async function refresh() {
    if (!getAuth()) {
      panel.hidden = true;
      return;
    }
    let data;
    try {
      data = await fetchYesterday(dayKey);
    } catch {
      panel.hidden = true;
      return;
    }
    if (!data || !data.date) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    const hasHand = Array.isArray(data.hand) && data.hand.length > 0;
    titleEl.textContent = hasHand
      ? `Вчерашняя рука (${data.date})`
      : `Вчера (${data.date})`;

    if (hasHand) {
      const tiles = data.tiles?.length ? data.tiles : data.hand;
      renderTiles(handEl, tiles, { disabled: true });
      if (data.discarded) {
        discardEl.hidden = false;
        renderTiles(discardEl, [data.discarded], { disabled: true });
      } else {
        discardEl.hidden = true;
      }
      handEl.hidden = false;
    } else {
      discardEl.hidden = true;
      handEl.replaceChildren();
      const note = document.createElement('span');
      note.className = 'yesterday-note';
      note.textContent = 'рука не сдавалась';
      handEl.append(note);
    }

    renderOpenedDoras(data.date, data.kans ?? []);

    if (hasHand) {
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
    } else {
      scoreEl.hidden = true;
    }
  }

  return { refresh };
}
