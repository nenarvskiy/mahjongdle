/**
 * Полноэкранное окно «Вчера» — показ открытия дор в полночь.
 *
 * Правила показа (по ТЗ):
 *  - вчера руки НЕ было → игрок сразу на основной странице;
 *  - вчера рука БЫЛА → при входе показывается полноэкранное окно:
 *    вчерашняя рука, открывшиеся доры (ура, кан-доры) и старый/
 *    новый счёт; кнопка «К сегодняшнему дню» ведёт на основную страницу;
 *  - в ТЕЧЕНИЕ дня окно показывается ОДИН РАЗ: после нажатия кнопки
 *    (или повторного входа в тот же день) игрок попадает сразу на основную
 *    страницу;
 *  - гость (не вошёл) — сразу основная страница.
 *
 * Что открывается в полночь (для ВСЕХ, по канам дня в целом):
 *  - ура-доры: 1 базовая (ура-индикатор дня) + по одной за каждый кан;
 *  - кан-доры: по одной за каждый кан дня (базовой НЕТ);
 *  - очки пересчитаны сервером (GET /api/me/yesterday).
 * Ура-индикатор и мёртвая стена детерминированы dayKey — тайлы считаются
 * локально; количество — dayKanCount из ответа сервера.
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
  const kanDoraBlockEl = document.getElementById('yesterday-kandora-block');
  const kanDoraEl = document.getElementById('yesterday-kandoras');
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

  /** Картинка индикатора (0.6.25: без текстовой стрелки на экране —
   *  открывшаяся дора видна в подсказке при наведении). */
  function doraCell(indicator) {
    const cell = document.createElement('div');
    cell.className = 'yesterday-kandora';
    cell.title = `Индикатор: ${indicator} → дора: ${doraFromIndicator(indicator)}`;
    renderTiles(cell, [indicator], { disabled: true });
    return cell;
  }

  /**
   * Открывшиеся в полночь доры (детерминированы dayKey вчерашнего дня):
   *  - ура: базовая (индикатор дня) + по одной кан-уре за кан дня;
   *  - кан-доры: по одной за кан дня (без базовой).
   */
  function renderOpenedDoras(date, dayKanCount) {
    const ctx = createDailyContext(new Date(`${date}T12:00:00Z`));
    const wall = ctx.deadWall;
    const kanCount = openKanDoraCount(dayKanCount); // 0..4, без базовой

    // Ура-доры: 1 базовая + кан-уры.
    const uraIndicators = [
      ...ctx.uraIndicators,
      ...wall.kanUra.slice(0, Math.min(4, Math.max(0, dayKanCount ?? 0))),
    ];
    if (uraIndicators.length) {
      uraBlockEl.hidden = false;
      uraEl.innerHTML = '';
      for (const indicator of uraIndicators) uraEl.append(doraCell(indicator));
    } else {
      uraBlockEl.hidden = true;
    }

    // Кан-доры: только за каны дня.
    const kanDoras = wall.kanDora.slice(0, kanCount);
    if (kanDoras.length) {
      kanDoraBlockEl.hidden = false;
      kanDoraEl.innerHTML = '';
      for (const indicator of kanDoras) kanDoraEl.append(doraCell(indicator));
    } else {
      kanDoraBlockEl.hidden = true;
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

    // dayKanCount — суммарные каны дня (все игроки) из серверного ответа.
    renderOpenedDoras(data.date, Number(data.dayKanCount) || (data.kans ?? []).length);

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
