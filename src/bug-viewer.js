/**
 * Окно «Логи и жалобы» (только admin): блоки рук из лога.
 *
 * Один блок = одна ПОСЧИТАННАЯ рука: рука тайлами, условия, счёт с полной
 * разбивкой «что за что» и — если игрок её оставил — жалоба (payload.report).
 * Отдельных записей «раздача»/«счёт»/«жалоба» больше нет: всё в одном блоке.
 *
 * Вкладки: «Жалобы» (reports=1) и «Все руки» (все блоки).
 */
import { fetchEvents } from './event-log.js';
import { renderTiles } from './ui.js';
import { doraFromIndicator } from './daily-context.js';

export function initBugViewer() {
  const dialog = document.getElementById('bugs-dialog');
  if (!dialog) return;

  const listEl = dialog.querySelector('#bugs-list');
  const tabBugs = dialog.querySelector('#bugs-tab-bugs');
  const tabAll = dialog.querySelector('#bugs-tab-all');
  const refreshBtn = dialog.querySelector('#btn-bugs-refresh');
  const errorEl = dialog.querySelector('#bugs-error');

  let reportsOnly = true;

  document.getElementById('btn-bugs').addEventListener('click', () => {
    dialog.showModal();
    refresh();
  });
  dialog.querySelector('#btn-bugs-close').addEventListener('click', () => dialog.close());
  tabBugs.addEventListener('click', () => selectTab(true));
  tabAll.addEventListener('click', () => selectTab(false));
  refreshBtn.addEventListener('click', () => refresh());

  function selectTab(next) {
    reportsOnly = next;
    tabBugs.classList.toggle('active', reportsOnly);
    tabAll.classList.toggle('active', !reportsOnly);
    refresh();
  }

  function showError(message) {
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  }

  async function refresh() {
    showError(null);
    listEl.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'bugs-loading';
    loading.textContent = 'Загружаю…';
    listEl.append(loading);
    let rows;
    try {
      rows = await fetchEvents({ reports: reportsOnly, limit: 100 });
    } catch (e) {
      listEl.innerHTML = '';
      showError(e.message);
      return;
    }
    listEl.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'bugs-empty';
      empty.textContent = reportsOnly ? 'Жалоб пока нет.' : 'Логов пока нет: блок появится, когда рука будет посчитана.';
      listEl.append(empty);
      return;
    }
    for (const row of rows) listEl.append(renderBlock(row));
  }

  /** Карточка одного блока: рука + счёт + (если есть) жалоба. */
  function renderBlock(row) {
    const item = document.createElement('article');
    const hasReport = Boolean(row.payload?.report);
    item.className = `bug-item kind-hand${hasReport ? ' has-report' : ''}`;

    const head = document.createElement('div');
    head.className = 'bug-head';
    const modeSpan = document.createElement('span');
    modeSpan.className = 'bug-mode';
    modeSpan.textContent = row.mode === 'test' ? 'тест' : 'день';
    const userSpan = document.createElement('span');
    userSpan.className = 'bug-user';
    userSpan.textContent = row.user_name
      ? `${row.user_name}${row.user_email ? ` <${row.user_email}>` : ''}`
      : 'аноним';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'bug-time';
    timeSpan.textContent = new Date(row.ts).toLocaleString('ru-RU');
    head.append(modeSpan, userSpan, timeSpan);
    item.append(head);

    const payload = row.payload ?? {};

    if (hasReport) {
      const quote = document.createElement('div');
      quote.className = 'bug-text';
      quote.textContent = `Жалоба: ${payload.report.text}`;
      item.append(quote);
    }

    renderHand(item, payload);
    renderScore(item, payload);
    renderContext(item, payload.ctx);
    return item;
  }

  /** Рука: оставшиеся тайлы + отдельно сброшенный. */
  function renderHand(item, payload) {
    const tiles = payload.remaining?.length ? payload.remaining : payload.hand;
    if (!tiles?.length) return;
    const block = document.createElement('div');
    block.className = 'bug-hand';
    const label = document.createElement('span');
    label.className = 'bug-hand-label';
    label.textContent = payload.discarded ? `рука ${tiles.length} + сброшен` : `рука ${tiles.length}`;
    block.append(label);

    const handEl = document.createElement('div');
    handEl.className = 'hand bug-hand-tiles';
    const doraTiles = (payload.ctx?.doraIndicators ?? []).map(doraFromIndicator);
    renderTiles(handEl, tiles, { disabled: true, doraTiles });
    block.append(handEl);

    if (payload.discarded) {
      const discEl = document.createElement('div');
      discEl.className = 'hand bug-hand-tiles';
      renderTiles(discEl, [payload.discarded], { disabled: true, doraTiles });
      block.append(discEl);
    }
    item.append(block);
  }

  /** Счёт: итог + разбивка «что за что». */
  function renderScore(item, payload) {
    if (payload.total == null && !(payload.breakdown?.length)) return;
    const scoreEl = document.createElement('div');
    scoreEl.className = 'bug-score';
    if (payload.total != null) {
      const total = document.createElement('div');
      total.className = 'bug-total';
      const details = [];
      if (payload.shanten != null) details.push(`шантен ${payload.shanten}`);
      if (payload.tier) details.push(payload.tier);
      total.textContent = `${payload.total.toLocaleString('ru-RU')} очков` +
        (details.length ? ` (${details.join(', ')})` : '');
      scoreEl.append(total);
    }
    if (payload.breakdown?.length) {
      const ul = document.createElement('ul');
      for (const row of payload.breakdown) {
        const li = document.createElement('li');
        li.className = row.yaku ? 'score-yaku' : row.potential ? 'score-potential' : '';
        li.textContent = `${row.label}: +${row.points.toLocaleString('ru-RU')}`;
        ul.append(li);
      }
      scoreEl.append(ul);
    }
    item.append(scoreEl);
  }

  /** Условия: ветра, дора, ура. */
  function renderContext(item, ctx) {
    if (!ctx) return;
    const line = document.createElement('div');
    line.className = 'bug-context';
    const parts = [];
    if (ctx.roundWindId) parts.push(`раунд ${ctx.roundWindId.toUpperCase()}`);
    if (ctx.seatWindId) parts.push(`место ${ctx.seatWindId.toUpperCase()}`);
    if (ctx.doraIndicators?.length) parts.push(`дора ${ctx.doraIndicators.join(' ')}`);
    if (ctx.uraIndicators?.length) parts.push(`ура ${ctx.uraIndicators.join(' ')}`);
    if (ctx.dayKey) parts.push(ctx.dayKey);
    line.textContent = parts.join(' · ');
    item.append(line);
  }
}
