/**
 * Тестовый режим — ОТДЕЛЬНАЯ ВКЛАДКА (не модальное окно).
 *
 * Отличия от игры: рука собирается вручную (палитра всех тайлов), ничего не
 * пишется в рейтинг. Всё остальное — как в руке дня: кан предлагается и
 * объявляется теми же функциями (findKans / withKanPons / renderClosedKan /
 * renderKanPrompt), сброс считается через withKanPons, кандоры и ура-доры
 * показываются так же.
 */
import { drawHand, sortHand, allTileIds, canonicalTileId } from './tiles.js';
import { evaluateHand, evaluateCompleteHand } from './scoring.js';
import { renderTiles, renderScore, renderGroupedHand } from './ui.js';
import { createDailyContext, createDeadWall, doraFromIndicator } from './daily-context.js';
import { findKans, withKanPons, openKanDoraCount } from './kans.js';
import { renderClosedKan, renderKanPrompt, renderKanDoras } from './kans-ui.js';
import { logHand, updateHandBlock, reportHandBlock, scorePayload } from './event-log.js';

const WIND_IDS = ['ew', 'sw', 'ww', 'nw'];
const WIND_LABEL = { ew: 'Восток', sw: 'Юг', ww: 'Запад', nw: 'Север' };
const WIND_INDEX = { ew: 27, sw: 28, ww: 29, nw: 30 };
const HONORS = new Set(['ew', 'sw', 'ww', 'nw', 'wd', 'gd', 'rd']);
const SUIT_RE = /^([1-9]|0)([mps])$/;

/** Разобрать строку тайлов («1m 2m rd») в массив id. */
export function parseHandTokens(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((t) => HONORS.has(t) || SUIT_RE.test(t))
    .map((t) => canonicalTileId(t));
}

/** Годятся только 13 или 14 тайлов. */
export function validateHandTiles(tiles) {
  return Array.isArray(tiles) && (tiles.length === 13 || tiles.length === 14);
}

/** Контекст тестовой руки: ветра, индикаторы, мёртвая стена дня. */
export function buildTestContext(roundWindId = 'ew', seatWindId = 'sw', doraIndicator = null, uraIndicator = null) {
  const day = createDailyContext(new Date());
  const deadWall = day.deadWall ?? createDeadWall(day.dayKey);
  const doraIndicators = doraIndicator ? [canonicalTileId(doraIndicator)] : [];
  const uraIndicators = uraIndicator ? [canonicalTileId(uraIndicator)] : [];
  return {
    dayKey: day.dayKey,
    roundWindId,
    seatWindId,
    roundWind: WIND_INDEX[roundWindId] ?? 27,
    seatWind: WIND_INDEX[seatWindId] ?? 28,
    doraIndicators,
    uraIndicators,
    doraTiles: doraIndicators.map((t) => doraFromIndicator(t)),
    uraTiles: uraIndicators.map((t) => doraFromIndicator(t)),
    deadWall,
    deadTiles: day.deadTiles ?? [
      ...(deadWall.kanDora ?? []),
      ...(deadWall.kanUra ?? []),
      ...(deadWall.tiles ?? []),
    ],
  };
}

export function randomTestContext() {
  return buildTestContext('ew', 'sw', null, null);
}

/** Инициализация вкладки. Возвращает функцию очистки. */
export function initTestMode() {
  const view = document.getElementById('view-test');
  if (!view) return () => {};
  const game = document.getElementById('view-game');
  const tabGame = document.getElementById('tab-game');
  const tabTest = document.getElementById('tab-test');
  const entry = document.getElementById('btn-test-mode');

  const q = (sel) => view.querySelector(sel);
  const els = {
    roundWinds: q('#tm-round-winds'),
    seatWinds: q('#tm-seat-winds'),
    dora: q('#tm-dora'),
    ura: q('#tm-ura'),
    rand: q('#btn-tm-rand'),
    newHand: q('#btn-tm-new'),
    reset: q('#btn-tm-reset'),
    customForm: q('#tm-custom-form'),
    custom: q('#tm-custom'),
    error: q('#tm-error'),
    palette: q('#tm-palette'),
    hand: q('#tm-hand'),
    kanPrompt: q('#tm-kan-prompt'),
    kanPromptTiles: q('#tm-kan-prompt-tiles'),
    btnKan: q('#tm-btn-kan'),
    btnKanSkip: q('#tm-btn-kan-skip'),
    kanList: q('#tm-kan-list'),
    kanDoras: q('#tm-kan-dora-wall'),
    discardedPanel: q('#tm-discarded-panel'),
    discarded: q('#tm-discarded'),
    resultPanel: q('#tm-result-panel'),
    groupedHand: q('#tm-grouped-hand'),
    result: q('#tm-result'),
    potentialPreview: q('#tm-potential-preview'),
    potentialHand: q('#tm-potential-hand'),
    potentialTitle: q('#tm-potential-title'),
    hint: q('#tm-hint'),
    close: q('#btn-test-close'),
    bugButton: q('#btn-tm-bug'),
    bugForm: q('#tm-bug-form'),
    bugText: q('#tm-bug-text'),
    bugStatus: q('#tm-bug-status'),
    bugCancel: q('#tm-bug-cancel'),
  };

  // ---- вкладки ----
  function showTest() {
    if (game) game.hidden = true;
    view.hidden = false;
    tabGame?.classList.remove('is-active');
    tabTest?.classList.add('is-active');
    if (!ctx) resetAll();
    render();
  }
  function showGame() {
    view.hidden = true;
    if (game) game.hidden = false;
    tabTest?.classList.remove('is-active');
    tabGame?.classList.add('is-active');
  }
  // Совместимость: если кто-то зовёт showModal()/close() — ведём себя как вкладка.
  if (typeof view.showModal !== 'function') view.showModal = showTest;
  if (typeof view.close !== 'function') view.close = showGame;

  tabGame?.addEventListener('click', showGame);
  tabTest?.addEventListener('click', showTest);
  entry?.addEventListener('click', showTest);
  els.close?.addEventListener('click', showGame);
  if (tabTest && entry) tabTest.hidden = entry.hidden;

  // ---- состояние ----
  let ctx = null;
  let phase = 'idle'; // idle | choose | result | complete
  let hand = [];
  let declaredKans = [];
  let pendingKans = [];
  let pendingKan = null;
  let discarded = null;
  let remaining = [];
  let score = null;
  let blockId = null;

  function resetAll() {
    ctx = buildTestContext('ew', 'sw', null, null);
    phase = 'idle';
    hand = [];
    declaredKans = [];
    pendingKans = [];
    pendingKan = null;
    discarded = null;
    remaining = [];
    score = null;
    blockId = null;
    if (els.dora) els.dora.value = '';
    if (els.ura) els.ura.value = '';
    showError(null);
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message ?? '';
    els.error.hidden = !message;
  }

  // ---- кан-логика (та же, что в руке дня) ----
  function refreshKanPrompt() {
    if (!els.kanPrompt) return;
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

  function declareKan() {
    if (!pendingKan || phase !== 'choose') return;
    const skip = new Set(pendingKan.indices ?? []);
    const rest = hand.filter((_, i) => !skip.has(i));
    const drawn = drawHand(1, { deadTiles: ctx.deadTiles });
    declaredKans = [...declaredKans, { tile: pendingKan.tile, tiles: pendingKan.tiles }];
    pendingKan = null;
    pendingKans = [];
    if (els.kanPrompt) els.kanPrompt.hidden = true;
    hand = sortHand([...rest, ...drawn]);
    reevaluate();
    render();
    void syncHandBlock();
  }

  function skipKan() {
    const rest = pendingKans.filter((k) => k !== pendingKan);
    if (rest.length > 0) {
      pendingKans = rest;
      pendingKan = rest[0];
      renderKanPrompt(els.kanPromptTiles, pendingKan);
      return;
    }
    pendingKan = null;
    pendingKans = [];
    if (els.kanPrompt) els.kanPrompt.hidden = true;
  }

  // ---- оценка ----
  function fullTiles() {
    return withKanPons(hand, declaredKans);
  }

  function reevaluate() {
    if (hand.length === 0) {
      phase = 'idle';
      score = null;
      remaining = [];
      return;
    }
    const full = fullTiles();
    if (full.length === 14) {
      const complete = evaluateCompleteHand(full, ctx);
      if (complete) {
        phase = 'complete';
        score = complete;
        remaining = hand;
        return;
      }
      phase = 'choose';
      score = null;
      remaining = [];
      return;
    }
    phase = 'choose';
    score = null;
    remaining = [];
  }

  function deal(tiles) {
    const sorted = sortHand(tiles);
    declaredKans = [];
    pendingKan = null;
    pendingKans = [];
    if (els.kanPrompt) els.kanPrompt.hidden = true;
    discarded = null;
    blockId = null;
    if (sorted.length === 13) {
      hand = sorted;
      phase = 'result';
      remaining = sorted;
      score = evaluateHand(sorted, ctx);
    } else {
      hand = sorted;
      reevaluate();
    }
    render();
    void syncHandBlock();
  }

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

  function resetChoice() {
    if (phase !== 'result') return;
    phase = 'choose';
    discarded = null;
    remaining = [];
    score = null;
    render();
  }

  // ---- палитра: добавить тайл в руку ----
  function usedOf(tile) {
    const canon = canonicalTileId(tile);
    const inHand = hand.filter((t) => canonicalTileId(t) === canon).length;
    const inKans = declaredKans.filter((k) => canonicalTileId(k.tile) === canon).length * 4;
    return inHand + inKans;
  }

  function addTile(tile) {
    if (phase === 'result' || phase === 'complete') {
      // начинаем новую руку из палитры
      hand = [];
      declaredKans = [];
      discarded = null;
      remaining = [];
      score = null;
      phase = 'choose';
      blockId = null;
    }
    if (hand.length >= 14) return;
    if (usedOf(tile) >= 4) {
      showError(`Тайлов ${tile} уже 4 — больше нельзя.`);
      return;
    }
    showError(null);
    hand = sortHand([...hand, canonicalTileId(tile)]);
    reevaluate();
    render();
    void syncHandBlock();
  }

  // ---- рендер ----
  function renderWinds() {
    for (const [container, key] of [[els.roundWinds, 'roundWindId'], [els.seatWinds, 'seatWindId']]) {
      if (!container) continue;
      container.innerHTML = '';
      for (const id of WIND_IDS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = WIND_LABEL[id];
        btn.className = 'tm-wind' + (ctx[key] === id ? ' is-active' : '');
        btn.addEventListener('click', () => {
          ctx = { ...ctx, [key]: id, roundWind: WIND_INDEX[ctx.roundWindId] ?? 27, seatWind: WIND_INDEX[ctx.seatWindId] ?? 28 };
          ctx.roundWind = WIND_INDEX[ctx.roundWindId];
          ctx.seatWind = WIND_INDEX[ctx.seatWindId];
          reevaluate();
          render();
        });
        container.appendChild(btn);
      }
    }
  }

  function renderPalette() {
    if (!els.palette) return;
    renderTiles(els.palette, allTileIds(), { onTileClick: addTile });
  }

  function render() {
    if (!ctx) return;
    const uraOpen = phase !== 'choose';
    const uraTiles = uraOpen ? ctx.uraTiles : [];

    renderWinds();
    renderPalette();

    if (phase === 'idle') {
      if (els.hand) els.hand.innerHTML = '';
      if (els.discardedPanel) els.discardedPanel.hidden = true;
      if (els.resultPanel) els.resultPanel.hidden = true;
      if (els.kanPrompt) els.kanPrompt.hidden = true;
      if (els.kanList) els.kanList.innerHTML = '';
      if (els.hint) els.hint.textContent = 'Тыкайте тайлы в палитре или нажмите «Случайная рука».';
      return;
    }

    const visible = phase === 'choose' ? hand : remaining;
    renderTiles(els.hand, visible, {
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
        renderGroupedHand(els.potentialHand, score.potentialDisplay);
      } else {
        els.potentialPreview.hidden = true;
      }
    } else {
      els.resultPanel.hidden = true;
      els.potentialPreview.hidden = true;
    }

    // каны: объявленные — справа, предложение — над рукой
    if (els.kanList) {
      els.kanList.innerHTML = '';
      for (const kan of declaredKans) renderClosedKan(els.kanList, kan);
    }
    if (els.kanDoras && ctx.deadWall) {
      renderKanDoras(els.kanDoras, ctx.deadWall, openKanDoraCount(declaredKans.length));
    }
    refreshKanPrompt();

    if (els.hint) {
      els.hint.textContent = phase === 'choose'
        ? `Выберите тайл для сброса (${hand.length} в руке${declaredKans.length ? `, канов: ${declaredKans.length}` : ''}).`
        : phase === 'complete'
          ? 'Готовая рука — можно менять условия.'
          : 'Сброс сделан — можно менять условия или «Вернуть тайл».';
    }
  }

  // ---- лог (не критично: ошибки не ломают вкладку) ----
  async function syncHandBlock() {
    try {
      if (!score) return;
      const payload = scorePayload(ctx, { hand, discarded, remaining, score });
      if (blockId) await updateHandBlock(blockId, payload);
      else {
        const res = await logHand({ mode: 'test', payload });
        blockId = res?.id ?? null;
      }
    } catch {
      /* тестовый режим не должен падать из-за лога */
    }
  }

  // ---- обработчики ----
  function randomHand() {
    if (!ctx) ctx = buildTestContext();
    deal(drawHand(14, { deadTiles: ctx.deadTiles }));
  }

  els.rand?.addEventListener('click', randomHand);
  els.newHand?.addEventListener('click', randomHand);
  els.reset?.addEventListener('click', resetChoice);
  els.btnKan?.addEventListener('click', declareKan);
  els.btnKanSkip?.addEventListener('click', skipKan);

  els.customForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ctx) ctx = buildTestContext();
    const tiles = parseHandTokens(els.custom?.value ?? '');
    if (!validateHandTiles(tiles)) {
      showError('Нужно 13 или 14 тайлов: 1m 2m rd …');
      return;
    }
    showError(null);
    deal(tiles);
  });

  const onIndicator = (input, key, tilesKey) => {
    input?.addEventListener('input', () => {
      if (!ctx) return;
      const raw = input.value.trim();
      if (raw && !(HONORS.has(raw) || SUIT_RE.test(raw))) {
        showError('Индикатор — один тайл, например 5m или rd.');
        return;
      }
      showError(null);
      const list = raw ? [canonicalTileId(raw)] : [];
      ctx = { ...ctx, [key]: list, [tilesKey]: list.map((t) => doraFromIndicator(t)) };
      reevaluate();
      render();
    });
  };
  onIndicator(els.dora, 'doraIndicators', 'doraTiles');
  onIndicator(els.ura, 'uraIndicators', 'uraTiles');

  els.bugButton?.addEventListener('click', () => {
    if (!els.bugForm) return;
    els.bugForm.hidden = !els.bugForm.hidden;
  });
  els.bugCancel?.addEventListener('click', () => {
    if (els.bugForm) els.bugForm.hidden = true;
    if (els.bugStatus) els.bugStatus.textContent = '';
  });
  els.bugForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.bugText?.value?.trim();
    if (!text) return;
    if (!blockId) {
      if (els.bugStatus) els.bugStatus.textContent = 'Сначала посчитайте руку.';
      return;
    }
    try {
      await reportHandBlock(blockId, text);
      if (els.bugStatus) els.bugStatus.textContent = 'Спасибо, отмечено.';
      els.bugText.value = '';
    } catch {
      if (els.bugStatus) els.bugStatus.textContent = 'Не удалось отправить.';
    }
  });

  resetAll();
  render();

  return showGame;
}
