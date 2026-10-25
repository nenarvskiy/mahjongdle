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

  // F8: payload анонимного события — произвольный JSON (POST /api/events
  // принимает любой с конечным total). Рендерим дефensively: каждое поле
  // проверяем типами, а весь блок — try/catch с пометкой «битый блок»,
  // чтобы одно мусорное событие не ломало вкладку «Все руки».
  const asStringArray = (value) =>
    Array.isArray(value) ? value.filter((t) => typeof t === 'string') : [];
  const asString = (value) => (typeof value === 'string' ? value : '');

  /** Карточка одного блока: рука + счёт + (если есть) жалоба. */
  function renderBlock(row) {
    const item = document.createElement('article');
    const payload0 = (row.payload && typeof row.payload === 'object') ? row.payload : {};
    const hasReport = Boolean(payload0.report);
    item.className = `bug-item kind-hand${hasReport ? ' has-report' : ''}`;

    const head = document.createElement('div');
    head.className = 'bug-head';
    const modeSpan = document.createElement('span');
    modeSpan.className = 'bug-mode';
    modeSpan.textContent = row.mode === 'test' ? 'тест' : 'день';
    const userSpan = document.createElement('span');
    userSpan.className = 'bug-user';
    userSpan.textContent = asString(row.user_name)
      ? `${row.user_name}${asString(row.user_email) ? ` <${row.user_email}>` : ''}`
      : 'аноним';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'bug-time';
    timeSpan.textContent = new Date(row.ts).toLocaleString('ru-RU');
    head.append(modeSpan, userSpan, timeSpan);
    item.append(head);

    try {
      if (hasReport) {
        const quote = document.createElement('div');
        quote.className = 'bug-text';
        const report = payload0.report;
        quote.textContent = `Жалоба: ${typeof report === 'string' ? report : asString(report.text) || '(текст отсутствует)'}`;
        item.append(quote);
      }

      renderHand(item, payload0);
      renderScore(item, payload0);
      renderContext(item, (payload0.ctx && typeof payload0.ctx === 'object') ? payload0.ctx : null);
    } catch {
      // Последний рубеж: блок отрисовали частично — помечаем и показываем
      // исходный JSON, чтобы блок оставался видимым и удаляемым.
      const broken = document.createElement('div');
      broken.className = 'bug-broken';
      broken.textContent = 'Битый блок: payload несовместим с этой версией (показан исходный JSON).';
      const pre = document.createElement('pre');
      pre.className = 'bug-broken-json';
      try { pre.textContent = JSON.stringify(row.payload, null, 2)?.slice(0, 4000) ?? ''; }
      catch { pre.textContent = '(payload не сериализуется)'; }
      broken.append(pre);
      item.append(broken);
    }
    return item;
  }

  /** Рука: оставшиеся тайлы + отдельно сброшенный. */
  function renderHand(item, payload) {
    const raw = Array.isArray(payload.remaining) && payload.remaining.length
      ? payload.remaining
      : payload.hand;
    const tiles = asStringArray(raw);
    if (!tiles.length) return;
    const discarded = asString(payload.discarded);
    const block = document.createElement('div');
    block.className = 'bug-hand';
    const label = document.createElement('span');
    label.className = 'bug-hand-label';
    label.textContent = discarded ? `рука ${tiles.length} + сброшен` : `рука ${tiles.length}`;
    block.append(label);

    const handEl = document.createElement('div');
    handEl.className = 'hand bug-hand-tiles';
    const doraTiles = asStringArray(payload.ctx?.doraIndicators).map(doraFromIndicator);
    renderTiles(handEl, tiles, { disabled: true, doraTiles });
    block.append(handEl);

    if (discarded) {
      const discEl = document.createElement('div');
      discEl.className = 'hand bug-hand-tiles';
      renderTiles(discEl, [discarded], { disabled: true, doraTiles });
      block.append(discEl);
    }
    item.append(block);
  }

  /** Счёт: итог + разбивка «что за что». */
  function renderScore(item, payload) {
    const total = Number.isFinite(payload.total) ? payload.total : null;
    const breakdown = Array.isArray(payload.breakdown) ? payload.breakdown : [];
    if (total == null && !breakdown.length) return;
    const scoreEl = document.createElement('div');
    scoreEl.className = 'bug-score';
    if (total != null) {
      const totalEl = document.createElement('div');
      totalEl.className = 'bug-total';
      const details = [];
      if (Number.isFinite(payload.shanten)) details.push(`шантен ${payload.shanten}`);
      const tier = asString(payload.tier);
      if (tier) details.push(tier);
      totalEl.textContent = `${total.toLocaleString('ru-RU')} очков` +
        (details.length ? ` (${details.join(', ')})` : '');
      scoreEl.append(totalEl);
    }
    if (breakdown.length) {
      const ul = document.createElement('ul');
      for (const row of breakdown) {
        const li = document.createElement('li');
        if (!row || typeof row !== 'object' || typeof row.label !== 'string' || !Number.isFinite(row.points)) {
          li.className = 'score-broken';
          li.textContent = '(битая строка разбивки)';
        } else {
          li.className = row.yaku ? 'score-yaku' : row.potential ? 'score-potential' : '';
          li.textContent = `${row.label}: +${row.points.toLocaleString('ru-RU')}`;
        }
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
    const roundWind = asString(ctx.roundWindId);
    if (roundWind) parts.push(`раунд ${roundWind.toUpperCase()}`);
    const seatWind = asString(ctx.seatWindId);
    if (seatWind) parts.push(`место ${seatWind.toUpperCase()}`);
    const doraIndicators = asStringArray(ctx.doraIndicators);
    if (doraIndicators.length) parts.push(`дора ${doraIndicators.join(' ')}`);
    const uraIndicators = asStringArray(ctx.uraIndicators);
    if (uraIndicators.length) parts.push(`ура ${uraIndicators.join(' ')}`);
    const dayKey = asString(ctx.dayKey);
    if (dayKey) parts.push(dayKey);
    line.textContent = parts.join(' · ');
    item.append(line);
  }
}
