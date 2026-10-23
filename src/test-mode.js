/**
 * Тестовый режим (роль admin или test): неограниченная генерация рук +
 * ручные руки 13/14 тайлов. Очки считаются ТО ИДЕНТИЧНО игре
 * (evaluateHand/evaluateCompleteHand + renderScore + контекст с дорами),
 * НО НИЧЕГО не отправляется в таблицу дня и статистику — submitScore здесь
 * просто не вызывается.
 *
 * Правила:
 *  - «Новая рука» — 14 случайных тайлов в текущих условиях (ветер/дора);
 *  - «Случайные условия» — новые случайный ветер раунда/места и индикаторы;
 *  - ручная рука: 13 тайлов — оценка сразу; 14 — если готова, оценка сразу,
 *    иначе игра просит сбросить (кликабельные тайлы), как в основной игре;
 *  - контекст редактируется в любой момент (ветра, дора, ура) — рука
 *    пересчитывается.
 */
import { drawHand, sortHand, allTileIds, tileDisplayName, canonicalTileId } from './tiles.js';
import { tileToIndex } from './tile-index.js';
import { evaluateHand, evaluateCompleteHand } from './scoring.js';
import { renderTiles, renderScore, renderGroupedHand } from './ui.js';
import { doraFromIndicator } from './daily-context.js';
import { findKans, withKanPons } from './kans.js';
import { renderClosedKan, renderKanPrompt } from './kans-ui.js';
import { logHand, updateHandBlock, reportHandBlock, scorePayload } from './event-log.js';

const WIND_IDS = ['ew', 'sw', 'ww', 'nw'];
const HONOR_IDS = new Set(['ew', 'sw', 'ww', 'nw', 'wd', 'gd', 'rd']);
const SUIT_RE = /^([1-9]|0)([mps])$/;

/** Собрать контекст оценки (та же форма, что у createDailyContext). */
export function buildTestContext(roundWindId, seatWindId, doraIndicator, uraIndicator = null) {
  const uraIndicators = uraIndicator ? [uraIndicator] : [];
  return {
    dayKey: 'test',
    roundWindId,
    seatWindId,
    roundWind: tileToIndex(roundWindId),
    seatWind: tileToIndex(seatWindId),
    doraIndicators: [doraIndicator],
    uraIndicators,
    doraTiles: [doraFromIndicator(doraIndicator)],
    uraTiles: uraIndicators.map(doraFromIndicator),
    deadTiles: [doraIndicator, ...uraIndicators],
  };
}

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Случайный контекст: ветра + индикаторы доры и ура. */
export function randomTestContext() {
  const ids = allTileIds();
  return buildTestContext(
    randomOf(WIND_IDS),
    randomOf(WIND_IDS),
    randomOf(ids),
    randomOf(ids),
  );
}

/**
 * Разобрать строку с тайлами: «1m 2m 3m 1p 2p 3p 1s 2s 3s 4s 5s 9s rd rd».
 * Красные пятёрки — «0m/0p/0s». Возвращает {tiles} или {error}.
 */
export function parseHandTokens(text) {
  const tiles = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    const m = SUIT_RE.exec(raw);
    if (m) {
      tiles.push(m[1] === '0' ? `0${m[2]}` : `${m[1]}${m[2]}`);
      continue;
    }
    if (HONOR_IDS.has(raw)) {
      tiles.push(raw);
      continue;
    }
    return { error: `Не распознанный тайл «${raw}»` };
  }
  return { tiles };
}

/** Валидация ручной руки: 13/14 тайлов, не более 4 копий вида, 1 красная на масть. */
export function validateHandTiles(tiles) {
  if (tiles.length !== 13 && tiles.length !== 14) {
    return `Рука — 13 или 14 тайлов, а здесь ${tiles.length}`;
  }
  const counts = new Map();
  for (const t of tiles) {
    const c = canonicalTileId(t);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n > 4) return `Тайл ${id} — ${n} копии, а в стене 4`;
  }
  const reds = new Map();
  for (const t of tiles) {
    if (t[0] === '0') reds.set(t[1], (reds.get(t[1]) ?? 0) + 1);
  }
  for (const [suit, n] of reds) {
    if (n > 1) return `Красных пятёрок масти ${suit} — ${n}, а в стене одна`;
  }
  return null;
}

export function initTestMode() {
  const dialog = document.getElementById('test-mode-dialog');
  if (!dialog) return () => {};

  const els = {
    roundWinds: dialog.querySelector('#tm-round-winds'),
    seatWinds: dialog.querySelector('#tm-seat-winds'),
    dora: dialog.querySelector('#tm-dora'),
    ura: dialog.querySelector('#tm-ura'),
    rand: dialog.querySelector('#btn-tm-rand'),
    newHand: dialog.querySelector('#btn-tm-new'),
    reset: dialog.querySelector('#btn-tm-reset'),
    customForm: dialog.querySelector('#tm-custom-form'),
    custom: dialog.querySelector('#tm-custom'),
    error: dialog.querySelector('#tm-error'),
    hand: dialog.querySelector('#tm-hand'),
    kanPrompt: dialog.querySelector('#tm-kan-prompt'),
    kanPromptTiles: dialog.querySelector('#tm-kan-prompt-tiles'),
    btnKan: dialog.querySelector('#tm-btn-kan'),
    btnKanSkip: dialog.querySelector('#tm-btn-kan-skip'),
    kanList: dialog.querySelector('#tm-kan-list'),
    discardedPanel: dialog.querySelector('#tm-discarded-panel'),
    discarded: dialog.querySelector('#tm-discarded'),
    resultPanel: dialog.querySelector('#tm-result-panel'),
    groupedHand: dialog.querySelector('#tm-grouped-hand'),
    result: dialog.querySelector('#tm-result'),
    potentialPreview: dialog.querySelector('#tm-potential-preview'),
    potentialTitle: dialog.querySelector('#tm-potential-title'),
    potentialHand: dialog.querySelector('#tm-potential-hand'),
    hint: dialog.querySelector('#tm-hint'),
    close: dialog.querySelector('#btn-test-close'),
    bugButton: dialog.querySelector('#btn-tm-bug'),
    bugForm: dialog.querySelector('#tm-bug-form'),
    bugText: dialog.querySelector('#tm-bug-text'),
    bugStatus: dialog.querySelector('#tm-bug-status'),
    bugCancel: dialog.querySelector('#tm-bug-cancel'),
  };

  // состояние — локальное для диалога, ничего общего с «рукой дня»
  let ctx = null;
  let phase = 'idle'; // idle | choose(14) | result(13) | complete(14)
  let hand = [];
  let discarded = null;
  let remaining = [];
  let score = null;
  // id блока лога этой руки: одна рука = один блок (жалоба — в нём же)
  let blockId = null;

  // --- Каны: та же логика, что в руке дня ---
  let declaredKans = [];
  let pendingKan = null;
  let pendingKans = [];

  /** Предложить кан (только в фазе выбора). */
  function refreshKanPrompt() {
    if (phase !== 'choose') {
      els.kanPrompt.hidden = true;
      return;
    }
    pendingKans = findKans(hand);
    pendingKan = pendingKans[0] ?? null;
    if (!pendingKan) {
      els.kanPrompt.hidden = true;
      return;
    }
    els.kanPrompt.hidden = false;
    renderKanPrompt(els.kanPromptTiles, pendingKan);
  }

  /** Объявить кан: вынести 4 тайла, добрать тайл, проверить каны снова. */
  function declareKan() {
    if (!pendingKan || phase !== 'choose') return;
    const skip = new Set(pendingKan.indices);
    const rest = hand.filter((_, i) => !skip.has(i));
    const drawn = drawHand(1, { deadTiles: ctx.deadTiles });
    declaredKans = [...declaredKans, { tile: pendingKan.tile, tiles: pendingKan.tiles }];
    pendingKan = null;
    pendingKans = [];
    els.kanPrompt.hidden = true;
    hand = sortHand([...rest, ...drawn]);
    const completed = evaluateCompleteHand(hand, ctx);
    if (completed) {
      phase = 'complete';
      score = completed;
      remaining = hand;
    } else {
      phase = 'choose';
      score = null;
      remaining = [];
    }
    render();
    void syncHandBlock();
  }

  /** Пропустить: следующий кан, иначе обычный сброс. */
  function skipKan() {
    const rest = pendingKans.filter((kan) => kan !== pendingKan);
    if (rest.length > 0) {
      pendingKans = rest;
      pendingKan = rest[0];
      renderKanPrompt(els.kanPromptTiles, pendingKan);
      return;
    }
    pendingKan = null;
    pendingKans = [];
    els.kanPrompt.hidden = true;
  }

  /**
   * Синхронизировать блок лога с текущим счётом: первый счёт руки создаёт
   * блок, дальнейшие сбросы/смены условий обновляют ТОТ ЖЕ блок.
   * Несчитанная рука не пишется (возвращает null).
   */
  function syncHandBlock() {
    if (!ctx || !score) return Promise.resolve(null);
    const payload = scorePayload(ctx, { hand, discarded, remaining, score });
    if (blockId) return updateHandBlock(blockId, payload);
    return logHand({ mode: 'test', payload }).then((res) => {
      if (res?.id) blockId = res.id;
      return res;
    });
  }

  /** Рисуем ветерные кнопки (4 шт.) и подсветку активного. */
  function renderWindButtons(container, activeId, onSelect) {
    container.innerHTML = '';
    for (const id of WIND_IDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tm-wind${id === activeId ? ' active' : ''}`;
      btn.textContent = id.toUpperCase();
      btn.title = windTileName(id);
      btn.addEventListener('click', () => onSelect(id));
      container.append(btn);
    }
  }
  const windTileName = (id) =>
    ({ ew: 'Восток', sw: 'Юг', ww: 'Запад', nw: 'Север' })[id] ?? id;

  /** Обновить ветровые кнопки под текущий ctx. */
  function renderWindControls() {
    if (!ctx) return;
    renderWindButtons(els.roundWinds, ctx.roundWindId, (id) => setContextCtx(ctx, id, ctx.seatWindId, ctx.doraIndicators[0], ctx.uraIndicators[0] ?? null));
    renderWindButtons(els.seatWinds, ctx.seatWindId, (id) => setContextCtx(ctx, ctx.roundWindId, id, ctx.doraIndicators[0], ctx.uraIndicators[0] ?? null));
    els.dora.value = ctx.doraIndicators[0] ?? '';
    els.ura.value = ctx.uraIndicators[0] ?? '';
  }

  /** Сменить контекст и пересчитать текущую руку. */
  function setContextCtx(prev, roundWindId, seatWindId, dora, ura) {
    ctx = buildTestContext(roundWindId, seatWindId, dora, ura);
    renderWindControls();
    // пересчёт текущей руки, если она есть
    if (phase === 'choose') {
      const completed = evaluateCompleteHand(hand, ctx);
      if (completed) {
        phase = 'complete';
        score = completed;
        remaining = hand;
      }
    } else if (phase === 'result') {
      score = evaluateHand(remaining, ctx);
    } else if (phase === 'complete') {
      score = evaluateCompleteHand(hand, ctx);
      if (!score) {
        phase = 'choose';
        remaining = [];
        score = null;
      }
    }
    render();
    // пересчёт при смене условий — обновляем блок этой же руки
    void syncHandBlock();
  }

  /** Раздать руку (13 → сразу оценка; 14 → complete или choose со сбросом). */
  function deal(tiles) {
    const sorted = sortHand(tiles);
    declaredKans = [];
    pendingKan = null;
    pendingKans = [];
    if (els.kanPrompt) els.kanPrompt.hidden = true;
    if (sorted.length === 13) {
      phase = 'result';
      hand = sorted;
      discarded = null;
      remaining = sorted;
      score = evaluateHand(sorted, ctx);
    } else {
      hand = sorted;
      discarded = null;
      remaining = [];
      score = evaluateCompleteHand(sorted, ctx);
      if (score) {
        phase = 'complete';
        remaining = sorted;
      } else {
        phase = 'choose';
        score = null;
      }
    }
    render();
    // новая рука — новый блок; пишется только если рука посчитана
    // (13 тайлов и готовые 14 пишутся сразу — их счёт уже есть)
    blockId = null;
    void syncHandBlock();
  }

  /** Сброс в тестовом режиме — как в игре: кликнули тайл → 13 тайлов. */
  function discardAt(index) {
    if (phase !== 'choose') return;
    discarded = hand[index];
    remaining = hand.filter((_, i) => i !== index);
    // объявленные каны входят в оценку как фиксированные поны
    score = evaluateHand(withKanPons(remaining, declaredKans), ctx);
    phase = 'result';
    render();
    void syncHandBlock();
  }

  /** Отменить сброс — вернуться к 14 тайлам. */
  function resetChoice() {
    if (phase !== 'result') return;
    phase = 'choose';
    discarded = null;
    remaining = [];
    score = null;
    render();
  }

  /** Отрисовка — как в основной игре (renderTiles/renderScore/renderGroupedHand). */
  function render() {
    if (!ctx) return;
    // ура-индикатор «открывается» после сброса, как в игре
    const uraOpen = phase !== 'choose';
    const uraTiles = uraOpen ? ctx.uraTiles : [];

    if (phase === 'idle') {
      els.hand.innerHTML = '';
      els.discardedPanel.hidden = true;
      els.resultPanel.hidden = true;
      els.hint.textContent = 'Сгенерируйте руку или введите тайлы вручную.';
      return;
    }

    const visibleHand = phase === 'choose' ? hand : remaining;
    renderTiles(els.hand, visibleHand, {
      disabled: phase !== 'choose',
      onTileClick: discardAt,
      doraTiles: ctx.doraTiles,
      uraTiles,
    });

    if (discarded) {
      els.discardedPanel.hidden = false;
      renderTiles(els.discarded, [discarded], { disabled: true, doraTiles: ctx.doraTiles, uraTiles });
    } else {
      els.discardedPanel.hidden = true;
    }

    if (phase !== 'choose' && score) {
      els.resultPanel.hidden = false;
      renderGroupedHand(els.groupedHand, score.display, { doraTiles: ctx.doraTiles, uraTiles });
      renderScore(els.result, score);
      if (score.potentialDisplay) {
        els.potentialPreview.hidden = false;
        els.potentialTitle.textContent = score.potentialSummary;
        renderGroupedHand(els.potentialHand, score.potentialDisplay, { doraTiles: ctx.doraTiles, uraTiles });
      } else {
        els.potentialPreview.hidden = true;
      }
    } else {
      els.resultPanel.hidden = true;
    }

    if (phase === 'choose') els.hint.textContent = 'Выберите тайл для сброса (14).';
    else if (phase === 'complete') els.hint.textContent = 'Готовая рука! Сбрасывать тайл не нужно.';
    else els.hint.textContent = `Рука из ${remaining.length} тайлов. Тайл ${tileDisplayName(discarded)} сброшен.`;
    els.reset.hidden = phase !== 'result';
  }

  // --- события ---
  document.getElementById('btn-test-mode').addEventListener('click', () => {
    if (!ctx) {
      ctx = randomTestContext();
      renderWindControls();
    }
    dialog.showModal();
  });
  els.close.addEventListener('click', () => dialog.close());

  els.btnKan.addEventListener('click', () => {
    declareKan();
  });
  els.btnKanSkip.addEventListener('click', () => {
    skipKan();
  });

  els.rand.addEventListener('click', () => {
    ctx = randomTestContext();
    renderWindControls();
    // новые условия → новая рука
    if (phase !== 'idle') deal(drawHand(14, { deadTiles: ctx.deadTiles }));
  });

  els.newHand.addEventListener('click', () => {
    if (!ctx) ctx = randomTestContext();
    renderWindControls();
    deal(drawHand(14, { deadTiles: ctx.deadTiles }));
  });

  els.reset.addEventListener('click', resetChoice);

  // дора/ура — по одному токену (или пусто для ура)
  const onIndicatorInput = (input, isUra) => {
    input.addEventListener('change', () => {
      const value = input.value.trim().toLowerCase();
      if (value && !HONOR_IDS.has(value) && !SUIT_RE.test(value)) {
        showError(`Не распознанный тайл «${value}»`);
        return;
      }
      if (!ctx) return;
      const ura = isUra ? (value || null) : ctx.uraIndicators[0] ?? null;
      const dora = isUra ? ctx.doraIndicators[0] : value;
      setContextCtx(ctx, ctx.roundWindId, ctx.seatWindId, dora, ura);
    });
  };
  onIndicatorInput(els.dora, false);
  onIndicatorInput(els.ura, true);

  // ручная рука
  els.customForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ctx) {
      ctx = randomTestContext();
      renderWindControls();
    }
    const { tiles, error } = parseHandTokens(els.custom.value);
    if (error) return showError(error);
    const bad = validateHandTiles(tiles);
    if (bad) return showError(bad);
    showError(null);
    deal(tiles);
  });

  // «Сообщить об ошибке»: текст + снапшот текущей руки/счёта уходят в лог
  // (bug_report) и видны админам в окне «Логи и жалобы».
  els.bugButton.addEventListener('click', () => {
    els.bugForm.hidden = !els.bugForm.hidden;
    if (!els.bugForm.hidden) els.bugText.focus();
  });
  els.bugCancel.addEventListener('click', () => {
    els.bugForm.hidden = true;
    els.bugStatus.textContent = '';
  });
  els.bugForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.bugText.value.trim();
    if (!text) return;
    // жалоба прикладывается к блоку посчитанной руки: если блок ещё не создан — создаём
    if (score) await syncHandBlock();
    if (!blockId) {
      els.bugStatus.textContent = 'Жалоба не отправлена: сначала посчитайте руку.';
      return;
    }
    const res = await reportHandBlock(blockId, text);
    els.bugStatus.textContent = res
      ? 'Отправлено — спасибо, админ увидит в «Логах и жалобах».'
      : 'Не удалось отправить жалобу (сервер недоступен).';
    if (!res) return;
    els.bugText.value = '';
    setTimeout(() => {
      els.bugForm.hidden = true;
      els.bugStatus.textContent = '';
    }, 1500);
  });

  function showError(message) {
    els.error.textContent = message ?? '';
    if (message) els.error.hidden = false;
    else els.error.hidden = true;
  }
}
