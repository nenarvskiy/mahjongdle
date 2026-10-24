/**
 * Полноэкранное окно «Вчера».
 *
 * Правила показа (по ТЗ):
 *  - вчера руки НЕ было → игрок сразу на основной странице;
 *  - вчера рука БЫЛА → при входе показывается полноэкранное окно:
 *    вчерашняя рука, открывшиеся доры (ура, кан-доры, кан-ура) и старый/
 *    новый счёт; кнопка «К сегодняшнему дню» ведёт на основную страницу;
 *  - в ТЕЧЕНИЕ дня окно показывается ОДИН РАЗ: после нажатия кнопки
 *    (или повторного входа в тот же день) игрок попадает сразу на основную
 *    страницу;
 *  - гость (не вошёл) — сразу основная страница.
 *
 * Данные готовит сервер (GET /api/me/yesterday): он же один раз за день
 * пересчитывает вчерашние руки с ура-дорами и кандорами. Ура-индикатор
 * и мёртвая стена детерминированы dayKey — считаются локально.
 */
import { getAuth, fetchYesterday } from './auth.js';
import { renderTiles } from './ui.js';
import { createDailyContext, doraFromIndicator } from './daily-context.js';
import { openKanDoraCount } from './kans.js';

const SEEN_KEY = 'mh_yesterday_seen_v1';

export function initYesterday({ dayKey }) {
  const view = document.getElementById('view-yesterday');
  const game = document.getElementById('view-game');
  const tabs = document.getElementById('view-tabs');
  if (!view) return null;

  const dateEl = document.getElementById('yesterday-date');
  const handEl = document.getElementById('yesterday-hand');
  const discardEl = document.getElementById('yesterday-discarded');
  const uraBlockEl = document.getElementById('yesterday-ura-block');
  const uraEl = document.getElementById('yesterday-ura');
  const kanDoraEl = document.getElementById('yesterday-kandoras');
  const kanUraEl = document.getElementById('yesterday-kanuras');
  const scoreEl = document.getElementById('yesterday-score');
  const btnToday = document.getElementById('btn-yesterday-today');

  function seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === dayKey;
    } catch {
      return false;
    }
  }
  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, dayKey);
    } catch {
      /* приватный режим — окну просто придётся открыться повторно */
    }
  }

  function showGate() {
    view.hidden = false;
    if (game) game.hidden = true;
    if (tabs) tabs.hidden = true;
  }
  function hideGate() {
    view.hidden = true;
    if (game) game.hidden = false;
    if (tabs) tabs.hidden = false;
  }

  /** Тайл-индикатор со стрелкой к открывшейся доре. */
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

    if (ctx.uraIndicators.length) {
      uraBlockEl.hidden = false;
      uraEl.innerHTML = '';
      uraEl.append(doraCell(ctx.uraIndicators[0]));
    } else {
      uraBlockEl.hidden = true;
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
      hideGate();
      return;
    }
    if (seen()) {
      hideGate();
      return;
    }
    let data;
    try {
      data = await fetchYesterday(dayKey);
    } catch {
      hideGate();
      return;
    }
    // Вчера руки не было → сразу на основную страницу.
    if (!data || data.hand == null) {
      hideGate();
      return;
    }

    dateEl.textContent = data.date;
    const tiles = data.tiles?.length ? data.tiles : data.hand;
    handEl.innerHTML = '';
    renderTiles(handEl, tiles, { disabled: true });
    if (data.discarded) {
      discardEl.hidden = false;
      discardEl.innerHTML = '';
      renderTiles(discardEl, [data.discarded], { disabled: true });
    } else {
      discardEl.hidden = true;
    }

    renderOpenedDoras(data.date, data.kans ?? []);

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

    showGate();
  }

  btnToday.addEventListener('click', () => {
    markSeen();
    hideGate();
  });

  return { refresh, seen };
}
