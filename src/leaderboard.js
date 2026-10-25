/**
 * Панель «Таблица дня»: топ-10 по дате (публичная, видна и гостям) +
 * подсветка текущего игрока. Обновляется при входе/выходе и после записи результата.
 */
import { fetchLeaderboard, getAuth, onAuthChange, isAuthAvailable } from './auth.js';

export async function initLeaderboard({ listEl, panelEl, dateLabel, dayKey, limit = 10, onRowClick = null }) {
  let rows = [];

  function render() {
    // Панель видна, когда есть строки или функция настроена (клиент-ID задан)
    if (!rows.length && !isAuthAvailable() && !getAuth()) {
      panelEl.hidden = true;
      return;
    }
    panelEl.hidden = false;
    if (dateLabel) dateLabel.textContent = dayKey;
    listEl.replaceChildren();
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = 'Пока никто не записался — будьте первым!';
      listEl.append(li);
      return;
    }
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'lb-row';
      // F18: подсветку «это я» даёт серверный флаг mine (id в ответе нет).
      if (row.mine) li.classList.add('lb-me');

      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(i + 1);

      if (row.picture) {
        const img = document.createElement('img');
        img.className = 'lb-pic';
        img.src = row.picture;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        li.append(img);
      }

      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = row.name;
      name.title = row.discarded ? `Сброс: ${row.discarded}` : '';

      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = row.score.toLocaleString('ru-RU');

      if (onRowClick) {
        li.classList.add('lb-clickable');
        li.title = 'Клик — показать руку за этот день';
        li.addEventListener('click', () => onRowClick(row));
      }
      li.append(rank, name, score);
      listEl.append(li);
    });
  }

  async function refresh() {
    try {
      const data = await fetchLeaderboard(dayKey, limit);
      rows = Array.isArray(data.rows) ? data.rows : [];
    } catch {
      // сервер недоступен — не мешаем игре
      rows = [];
    }
    render();
  }

  onAuthChange(refresh);
  await refresh();
  return refresh;
}
