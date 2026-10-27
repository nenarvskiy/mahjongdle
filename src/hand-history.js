/**
 * История ежедневных рук в диалоге:
 *  * «Мои руки» — прошлые руки игрока (профиль, GET /api/me/hands);
 *  * клик по строке таблицы дня — рука этого игрока (данные уже в строке).
 * Два вида: список (дата + состояние) → просмотр руки: 13 тайлов после
 * сброса + сброшенный тайл отдельной картинкой ниже (0.7.2), каны,
 * условия дня и полный разбор «за что очки» форматом основной страницы
 * (рука по структурам тайлами + список + «Итого» + потенциал; пересчёт,
 * ничего не сохраняется).
 *
 * ВАЖНО (видимость дор): ура-доры и кан-доры никто не должен знать до
 * полуночи. Поэтому для руки СЕГОДНЯ показываем только ветра и дору, а
 * разбивка считается живым контекстом (без ура и кан-дор). Для рук
 * прошедших дней доры уже открыты в полночь — показываем открытые тайлы,
 * а разбивка пересчитывается по канам дня (все игроки, /api/daily/kans).
 */
import { getAuth, fetchMyHands, fetchDayKans } from './auth.js';
import { renderTiles, createTileElement, renderGroupedHand, renderScore } from './ui.js';
import { canonicalTileId, tileDisplayName } from './tiles.js';
import { createDailyContext, doraFromIndicator } from './daily-context.js';
import { openKanDoraCount, withKanPons } from './kans.js';
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
      btn.addEventListener('click', () => {
        void showHandView({
          title: `Рука за ${row.date}`,
          date: row.date,
          dayCtx: row.day_ctx,
          tiles: row.tiles,
          hand: row.hand,
          kans: row.kans,
          discarded: row.discarded,
          score: row.score,
          complete: row.complete,
        });
      });
    } else {
      btn.disabled = true;
    }
    list.append(btn);
  }
}

/** Контекст дня по дате (детерминирован dayKey). */
function dayContextOf(dateKey) {
  try {
    return createDailyContext(new Date(`${dateKey}T12:00:00Z`));
  } catch {
    return null;
  }
}

/**
 * Разбивка «за что очки» пересчётом той же руки тем же контекстом, что
 * использует сервер:
 *  - рука СЕГОДНЯ: живой контекст — дора и ветра только (ура-доры и
 *    кан-доры откроются в полночь, до этого ни у кого не считаются);
 *  - рука прошедшего дня: дора + открытые кан-доры (по кано дня) и
 *    ура-доры (1 базовая + по одной за каждый кан дня).
 */
function recompute({
  dateKey, dayCtx, tiles, hand, kans = [], complete = false,
  isToday = false, dayKanCount = 0,
}) {
  if (!dateKey) return null;
  const ctx = dayContextOf(dateKey);
  if (!ctx) return null;
  const wall = ctx.deadWall;

  let scoringCtx;
  if (isToday) {
    // До полуночи: только базовая дора и ветра.
    scoringCtx = {
      ...ctx,
      uraIndicators: [],
      ...(dayCtx?.roundWind != null ? { roundWind: dayCtx.roundWind } : {}),
      ...(dayCtx?.seatWind != null ? { seatWind: dayCtx.seatWind } : {}),
    };
  } else {
    // В полночь открылись: кан-доры — по одной за кан дня (без базовой),
    // ура — 1 базовая + по одной за кан дня.
    const open = openKanDoraCount(dayKanCount);
    scoringCtx = {
      ...ctx,
      uraIndicators: [...(ctx.uraIndicators ?? []), ...wall.kanUra.slice(0, open)],
      doraIndicators: [...(dayCtx?.doraIndicators ?? ctx.doraIndicators), ...wall.kanDora.slice(0, open)],
      ...(dayCtx?.roundWind != null ? { roundWind: dayCtx.roundWind } : {}),
      ...(dayCtx?.seatWind != null ? { seatWind: dayCtx.seatWind } : {}),
    };
  }

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

/**
 * Строка условий дня: ветра, дора — всегда; ура и кан-доры — только для
 * прошедших дней (до полуночи их никто не должен видеть).
 * Все тайлы — картинками: доры показывают ИНДИКАТОРЫ (как в игре),
 * открывшаяся дора — в подсказке (0.6.25: без текстовых «2m → 3m»).
 */
function renderContextRow(el, dateKey, dayCtx, { isToday = false, dayKanCount = 0 } = {}) {
  el.innerHTML = '';
  el.hidden = true;
  if (!dateKey) return;
  const ctx = dayContextOf(dateKey);
  if (!ctx) return;
  const wall = ctx.deadWall;
  const open = openKanDoraCount(dayKanCount);

  const parts = [];
  const pushTiles = (label, indicators, title) => {
    if (!indicators?.length) return;
    const span = document.createElement('span');
    span.className = 'hands-ctx-part hands-ctx-tiles';
    span.title = title;
    const b = document.createElement('b');
    b.textContent = `${label}: `;
    span.append(b);
    for (const indicator of indicators) {
      const tile = createTileElement(indicator, { disabled: true });
      // Подсказка: индикатор → открывшаяся дора (текст только в тултипе).
      tile.title = `${tileDisplayName(indicator)} → дора: ${tileDisplayName(doraFromIndicator(indicator))}`;
      span.append(tile);
    }
    parts.push(span);
  };
  pushTiles('Ветер раунда', [ctx.roundWindId], 'Ветер раунда дня');
  pushTiles('Ветер игрока', [ctx.seatWindId], 'Ветер места дня');
  pushTiles('Дора', ctx.doraIndicators, 'Индикатор доры; открывшаяся дора — в подсказке');
  if (!isToday) {
    // Открытые в полночь тайлы: ура (базовая + кан-уры) и кан-доры —
    // индикаторы из мёртвой стены.
    const uraIndicators = [
      ...(ctx.uraIndicators ?? []),
      ...wall.kanUra.slice(0, open),
    ];
    pushTiles('Ура', uraIndicators, 'Ура-индикаторы, открывшиеся в полночь');
    pushTiles('Кан-доры', wall.kanDora.slice(0, open),
      'Кан-доры, открывшиеся в полночь: по одной за каждый кан дня');
  }

  if (!parts.length) return;
  const lead = document.createElement('div');
  lead.className = 'hands-ctx-lead';
  lead.textContent = `Условия дня ${dateKey}`;
  el.append(lead);
  const row = document.createElement('div');
  row.className = 'hands-ctx';
  row.append(...parts);
  el.append(row);
  el.hidden = false;
}

/** Убрать ровно ОДНО вхождение тайла (копий вида в руке может быть несколько). */
function removeOne(arr, tile) {
  const kind = canonicalTileId(tile);
  const idx = arr.findIndex((t) => canonicalTileId(t) === kind);
  return idx === -1 ? arr.slice() : arr.filter((_, i) => i !== idx);
}

/**
 * Просмотр конкретной руки: тайлы, каны, условия дня, разбивка очков.
 * Для рук прошедших дней асинхронно запрашивает каны дня (все игроки),
 * чтобы показать открытые в полночь доры.
 */
export async function showHandView({
  title, hand, kans = [], discarded = null, score = null, complete = false,
  date = null, dayCtx = null, tiles = null, today: todayRef = null,
}) {
  const view = $('hands-view');
  view.hidden = false;
  $('hands-list').hidden = true;
  $('hands-dialog-title').textContent = title;
  $('btn-hands-back').hidden = !listRows.length;

  const dateKey = date ?? todayRef?.dayKey ?? today?.dayKey ?? null;
  // «Сегодня» — день текущей игры: доры ещё не открыты.
  const isToday = dateKey != null && today?.dayKey != null && dateKey === today.dayKey;

  // Каны дня (все игроки) — только для прошедших дней: они определяют
  // открытые в полночь доры. Сегодня — 0 (ничего не открыто).
  let dayKanCount = 0;
  if (!isToday && dateKey) {
    try {
      const data = await fetchDayKans(dateKey);
      // Аудит №4 (0.7.1): точная сумма (total) — список ограничен 10 строками.
      dayKanCount = Array.isArray(data?.kans)
        ? (Number.isFinite(data?.total)
          ? data.total
          : data.kans.reduce((sum, k) => sum + (k.kanCount || 0), 0))
        : 0;
    } catch {
      dayKanCount = kans.length; // сервер недоступен — оцениваем по своим канам
    }
  }

  const handEl = $('hands-view-hand');
  handEl.replaceChildren();
  const ctx = dateKey ? dayContextOf(dateKey) : null;
  const doraTiles = ctx
    ? (() => {
        const marked = [...ctx.doraTiles];
        if (!isToday) {
          const open = openKanDoraCount(dayKanCount);
          ctx.uraTiles.forEach((tile) => marked.push(tile));
          ctx.deadWall.kanDora.slice(0, open).forEach((ind) => marked.push(doraFromIndicator(ind)));
          ctx.deadWall.kanUra.slice(0, open).forEach((ind) => marked.push(doraFromIndicator(ind)));
        }
        return marked;
      })()
    : [];
  const kanKinds = new Set(kans.map(canonicalTileId));
  let shown = null;
  if (!complete && Array.isArray(tiles) && tiles.length) {
    // 0.7.2: основная строка — тайлы, за которые даны очки: 13 после сброса
    // (с каноми — 13 − 3×каны: поны канов живут в блоке «Каны»). Сброшенный
    // тайл больше не рисуется равнозначно среди остальных — он отдельной
    // картинкой ниже (как панель «Сброшено» на основной странице).
    shown = tiles;
  } else if (Array.isArray(hand) && hand.length) {
    // M3 / legacy (tiles не сохранены): черновик 14 (или 11 после кана) —
    // убираем 4 тайла каждого кана (они в закрытом кано, блок ниже), а для
    // не готовой руки ещё и сброс (уходит в отдельную панель).
    shown = hand.filter((t) => !kanKinds.has(canonicalTileId(t)));
    if (!complete && discarded) shown = removeOne(shown, discarded);
  }
  if (shown) renderTiles(handEl, shown, { disabled: true, doraTiles });

  // 0.7.2: сброшенный тайл — отдельной картинкой ниже руки.
  const discEl = $('hands-view-discarded');
  discEl.replaceChildren();
  if (!complete && discarded) {
    const label = document.createElement('span');
    label.className = 'hands-discarded-label';
    label.textContent = 'Сброс:';
    discEl.append(label);
    discEl.append(createTileElement(discarded, { disabled: true, doraTiles }));
    discEl.hidden = false;
  } else {
    discEl.hidden = true;
  }

  // M3: кан показывается ТАЙЛАМИ, а не одной иконкой:
  //  - рука не готовая: пон кана (3 тайла) + 4-й тайл — рубашкой
  //    (закрытый кан: 4 тайла в руке игрока; добор после кана сервер не
  //    хранит — он в отображение не входит);
  //  - рука готовая: пон уже виден в 14-тайловой руке — показываем только
  //    4-й тайл (руба́шка), чтобы не дублировать пон.
  // До 0.7.0 показывался ОДИН тайл вида: физическая рука (13 + добор +
  // сброшенный) не сходилась со счётом.
  const kansEl = $('hands-view-kans');
  kansEl.replaceChildren();
  if (Array.isArray(kans) && kans.length) {
    const label = document.createElement('span');
    label.className = 'hands-kans-label';
    label.textContent = 'Каны:';
    kansEl.append(label);
    for (const tile of kans) {
      const group = document.createElement('span');
      group.className = 'hands-kan-group';
      group.title = complete
        ? `Кан: ${tileDisplayName(tile)} (пон в руке; 4-й тайл — закрытый)`
        : `Кан: ${tileDisplayName(tile)} (пон + 4-й тайл, закрытый)`;
      if (!complete) {
        for (let i = 0; i < 3; i += 1) {
          group.append(createTileElement(tile, { disabled: true }));
        }
      }
      const back = document.createElement('span');
      back.className = 'tile-back';
      back.title = '4-й тайл кана (закрытый)';
      group.append(back);
      kansEl.append(group);
    }
  }

  const info = { isToday, dayKanCount };
  renderContextRow($('hands-view-context'), dateKey, dayCtx, info);
  // 0.7.2: полный разбор «за что очки» — тем же форматом, что на основной
  // странице: рука, сгруппированная по структурам (тайлами), список
  // база/структуры/яку/доры, «Итого» и потенциал лучшей достройки. Всё
  // пересчётом по руке и условиям дня (recompute) — никуда не сохраняется.
  const recomputed = recompute({ dateKey, dayCtx, tiles, hand, kans, complete, ...info });
  const scorebox = $('hands-view-scorebox');
  const groupsEl = $('hands-view-groups');
  const scoreListEl = $('hands-view-score');
  const potentialEl = $('hands-view-potential');
  groupsEl.replaceChildren();
  scoreListEl.replaceChildren();
  $('hands-view-potential-hand').replaceChildren();
  potentialEl.hidden = true;
  if (recomputed) {
    renderGroupedHand(groupsEl, recomputed.display, { doraTiles });
    renderScore(scoreListEl, recomputed);
    if (recomputed.potentialDisplay) {
      potentialEl.hidden = false;
      $('hands-view-potential-title').textContent = recomputed.potentialSummary || 'Потенциальная рука';
      renderGroupedHand($('hands-view-potential-hand'), recomputed.potentialDisplay, { doraTiles });
    }
    scorebox.hidden = false;
  } else {
    scorebox.hidden = true;
  }

  const meta = [];
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
  void showHandView({
    title: row.name ? `${row.name} · таблица дня` : 'Рука игрока',
    hand: row.hand,
    kans: row.kans,
    discarded: row.discarded,
    score: row.score,
    complete: row.complete,
    // 13 тайлов после сброса — без них recompute не считает разбивку
    // «за что очки» (аудит F6).
    tiles: row.tiles ?? null,
    today,
  });
}
