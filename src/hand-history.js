/**
 * История ежедневных рук в диалоге:
 *  * «Мои руки» — прошлые руки игрока (профиль, GET /api/me/hands);
 *  * клик по строке таблицы дня — рука этого игрока (данные уже в строке).
 * Два вида: список (дата + состояние) → просмотр руки (тайлы, каны, счёт).
 */
import { getAuth, fetchMyHands } from './auth.js';
import { renderTiles, createTileElement } from './ui.js';

const $ = (id) => document.getElementById(id);

let listRows = [];
let listTitle = 'Мои руки';

const fmt = (n) => Number(n).toLocaleString('ru-RU');

export function initHandHistory() {
  $('btn-hands-close').addEventListener('click', () => closeHandHistory());
  $('btn-hands-back').addEventListener('click', () => showHandList(listRows, listTitle));
}

export function closeHandHistory() {
  const dialog = $('hands-dialog');
  if (dialog?.open) dialog.close();
}

/** Список рук: дата + состояние; клик — просмотр. */
export function showHandList(rows, title = 'Мои руки') {
  listRows = rows;
  listTitle = title;
  $('hands-view').hidden = true;
  const list = $('hands-list');
  list.hidden = false;
  $('hands-dialog-title').textContent = title;
  list.replaceChildren();
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'hands-empty';
    p.textContent = 'Пока нет сохранённых рук.';
    list.append(p);
    return;
  }
  for (const row of rows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hands-row';

    const date = document.createElement('span');
    date.className = 'hands-date';
    date.textContent = row.date;

    const state = document.createElement('span');
    state.className = 'hands-state';
    const hasHand = Array.isArray(row.hand) && row.hand.length;
    if (!hasHand) state.textContent = 'нет руки';
    else if (row.complete) state.textContent = 'Готовая рука';
    else if (row.score > 0) state.textContent = `Очки: ${fmt(row.score)}`;
    else state.textContent = 'в процессе';
    btn.append(date, state);

    if (hasHand) {
      btn.addEventListener('click', () => showHandView({
        title: `Рука за ${row.date}`,
        hand: row.hand,
        kans: row.kans,
        discarded: row.discarded,
        score: row.score,
        complete: row.complete,
      }));
    } else {
      btn.disabled = true;
    }
    list.append(btn);
  }
}

/** Просмотр конкретной руки. */
export function showHandView({ title, hand, kans = [], discarded = null, score = null, complete = false }) {
  const view = $('hands-view');
  view.hidden = false;
  $('hands-list').hidden = true;
  $('hands-dialog-title').textContent = title;
  $('btn-hands-back').hidden = !listRows.length;

  const handEl = $('hands-view-hand');
  if (Array.isArray(hand) && hand.length) renderTiles(handEl, hand, { disabled: true });
  else handEl.replaceChildren();

  const kansEl = $('hands-view-kans');
  kansEl.replaceChildren();
  if (Array.isArray(kans) && kans.length) {
    const label = document.createElement('span');
    label.className = 'hands-kans-label';
    label.textContent = 'Каны:';
    kansEl.append(label);
    for (const tile of kans) kansEl.append(createTileElement(tile, { disabled: true }));
  }

  const meta = [];
  if (discarded) meta.push(`Сброс: ${discarded}`);
  if (complete) meta.push('Готовая рука');
  else if (score > 0) meta.push(`Очки: ${fmt(score)}`);
  else meta.push('ещё не посчитана');
  $('hands-view-meta').textContent = meta.join(' · ');
}

/** Профиль: открыть историю своих рук с сервера. */
export async function openMyHands() {
  if (!getAuth()) return;
  const dialog = $('hands-dialog');
  dialog.showModal();
  const list = $('hands-list');
  list.hidden = false;
  $('hands-view').hidden = true;
  $('hands-dialog-title').textContent = 'Мои руки';
  list.replaceChildren();
  const p = document.createElement('p');
  p.className = 'hands-empty';
  p.textContent = 'Загружаю…';
  list.append(p);
  try {
    const data = await fetchMyHands(30);
    showHandList(Array.isArray(data.rows) ? data.rows : []);
  } catch {
    list.replaceChildren();
    const err = document.createElement('p');
    err.className = 'hands-empty';
    err.textContent = 'Не удалось загрузить историю рук (сервер недоступен?).';
    list.append(err);
  }
}

/** Клик по строке таблицы дня: показать руку игрока (данные в строке). */
export function openLeaderboardHand(row) {
  const dialog = $('hands-dialog');
  dialog.showModal();
  const hasHand = Array.isArray(row.hand) && row.hand.length;
  if (!hasHand) {
    showHandList([], row.name ? `Рука: ${row.name}` : 'Рука игрока');
    const list = $('hands-list');
    list.replaceChildren();
    const p = document.createElement('p');
    p.className = 'hands-empty';
    p.textContent = 'У этой записи рука не сохранена.';
    list.append(p);
    return;
  }
  showHandView({
    title: row.name ? `${row.name} · таблица дня` : 'Рука игрока',
    hand: row.hand,
    kans: row.kans,
    discarded: row.discarded,
    score: row.score,
    complete: row.complete,
  });
}
