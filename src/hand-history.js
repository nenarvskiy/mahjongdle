/**
 * История ежедневных рук в диалоге:
 *  * «Мои руки» — прошлые руки игрока (профиль, GET /api/me/hands);
 *  * клик по строке таблицы дня — рука этого игрока (данные уже в строке).
 * Два вида: список (дата + состояние) → просмотр руки: тайлы, каны,
 * условия дня (ветра, дора, ура, кан-доры) и полная разбивка «за что очки».
 */
import { getAuth, fetchMyHands } from './auth.js';
import { renderTiles, createTileElement } from './ui.js';
import { createDailyContext, createDeadWall, doraFromIndicator } from './daily-context.js';
import { tileToIndex } from './tile-index.js';
import { openKanDoraCount, withKanPons, KAN_DORA_SLOTS } from './kans.js';
import { evaluateHand, evaluateCompleteHand } from './scoring.js';

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
        date: row.date,
        dayCtx: row.day_ctx,
        tiles: row.tiles,
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

/** Сконтекст дня для руки: ветра, дора, ура, кан-доры (детерминированы dayKey). */
function dayInfo(date, dayCtx) {
  if (!date) return null;
  let ctx;
  try {
    ctx = createDailyContext(new Date(`${date}T12:00:00Z`));
  } catch {
    return null;
  }
  const wall = ctx.deadWall;
  const kansCount = dayCtx && Array.isArray(dayCtx.kans) ? dayCtx.kans.length : 0;
  return { ctx, wall, kansCount };
}

/**
 * Разбивка «за что очки» пересчётом той же руки тем же контекстом,
 * что и серверный ночной пересчёт (server/recalc.js).
 */
function recompute({ date, dayCtx, tiles, hand, kans = [], complete = false, today = null }) {
  if (!date) return null;
  let ctx;
  try {
    ctx = createDailyContext(new Date(`${date}T12:00:00Z`));
  } catch {
    return null;
  }
  const wall = ctx.deadWall;
  const open = openKanDoraCount(kans.length);
  const kanDoras = wall.kanDora.slice(0, Math.min(open, KAN_DORA_SLOTS));
  const scoringCtx = {
    ...ctx,
    uraIndicators: [...(ctx.uraIndicators ?? []), ...wall.kanUra],
    doraIndicators: [...(dayCtx?.doraIndicators ?? ctx.doraIndicators), ...kanDoras],
    ...(dayCtx?.roundWind != null ? { roundWind: dayCtx.roundWind } : {}),
    ...(dayCtx?.seatWind != null ? { seatWind: dayCtx.seatWind } : {}),
  };
  try {
    if (complete && Array.isArray(hand) && hand.length === 14) {
      return evaluateCompleteHand(hand, scoringCtx, kans);
    }
    // 13 тайлов после сброса; с каноми — 13 − 3×каны (поны канов добираются).
    if (
      Array.isArray(tiles) &&
      (tiles.length === 13 || tiles.length + 3 * kans.length === 13)
    ) {
      return evaluateHand(withKanPons(tiles, kans), scoringCtx, kans);
    }
    return null;
  } catch {
    return null;
  }
}

/** Строка условий дня: ветра, дора, ура, кан-доры. */
function renderContextRow(el, date, dayCtx) {
  el.innerHTML = '';
  el.hidden = true;
  const info = dayInfo(date, dayCtx);
  if (!info) return;
  const { ctx, wall } = info;
  const open = openKanDoraCount(dayCtx?.kans?.length ?? 0);

  const parts = [];
  const push = (label, value, title) => {
    if (!value) return;
    const span = document.createElement('span');
    span.className = 'hands-ctx-part';
    if (title) span.title = title;
    const b = document.createElement('b');
    b.textContent = `${label}: `;
    span.append(b, document.createTextNode(value));
    parts.push(span);
  };
  push('Ветер раунда', ctx.roundWindId, 'Ветер раунда дня');
  push('Ветер игрока', ctx.seatWindId, 'Ветер места дня');
  push('Дора', `${ctx.doraIndicators.join(' ')} → ${ctx.doraTiles.join(' ')}`, 'Индикатор доры → дора');
  if (ctx.uraIndicators?.length) {
    push('Ура', `${ctx.uraIndicators.join(' ')} → ${ctx.uraTiles.join(' ')}`, 'Открывается в конце дня');
  }
  push('Кан-доры', wall.kanDora.slice(0, open).join(' '), `Открыто: ${open} (1 базовая + за каждый кан)`);

  if (!parts.length) return;
  const lead = document.createElement('div');
  lead.className = 'hands-ctx-lead';
  lead.textContent = `Условия дня ${date}`;
  el.append(lead);
  const row = document.createElement('div');
  row.className = 'hands-ctx';
  row.append(...parts);
  el.append(row);
  el.hidden = false;
}

/** Разбивка счёта «за что очки». */
function renderBreakdown(el, scoreResult) {
  el.innerHTML = '';
  el.hidden = true;
  if (!scoreResult) return;
  const rows = scoreResult.breakdown ?? [];
  if (!rows.length) return;
  const ul = document.createElement('ul');
  ul.className = 'hands-breakdown-list';
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.yaku ? 'score-yaku' : r.potential ? 'score-potential' : '';
    li.textContent = `${r.label}: +${fmt(r.points)}`;
    ul.append(li);
  }
  el.append(ul);
  el.hidden = false;
}

/** Просмотр конкретной руки: тайлы, каны, условия дня, разбивка очков. */
export function showHandView({
  title, hand, kans = [], discarded = null, score = null, complete = false,
  date = null, dayCtx = null, tiles = null, today = null,
}) {
  const view = $('hands-view');
  view.hidden = false;
  $('hands-list').hidden = true;
  $('hands-dialog-title').textContent = title;
  $('btn-hands-back').hidden = !listRows.length;

  const handEl = $('hands-view-hand');
  handEl.replaceChildren();
  const doraTiles = date ? (() => { try { return createDailyContext(new Date(`${date}T12:00:00Z`)).doraTiles; } catch { return []; } })() : [];
  if (Array.isArray(hand) && hand.length) renderTiles(handEl, hand, { disabled: true, doraTiles });
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

  renderContextRow($('hands-view-context'), date ?? today?.dayKey, dayCtx);
  const recomputed = recompute({ date: date ?? today?.dayKey, dayCtx, tiles, hand, kans, complete });
  renderBreakdown($('hands-view-breakdown'), recomputed);

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

// Контекст «сегодня» (подставляется в строки таблицы дня: у них нет
// day_ctx, но условия дня детерминированы датой). main.js вызывает
// setHandHistoryToday при старте.
let today = null;
export function setHandHistoryToday(dayKey, ctx) {
  today = { dayKey, ctx };
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
    today,
  });
}
