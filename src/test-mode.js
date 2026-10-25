/**
 * Тестовый режим — отдельная вкладка.
 *
 * Поток: собираем руку из палитры (клик по тайлу в руке УБИРАЕТ его),
 * затем «Просчитать руку» — анализ канов, и только после этого сброс.
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
const WIND_LABEL = { ew: 'Восток', sw: 'Юг', ww: 'Запад', nw: 'Север' };
const HONORS = new Set(['ew', 'sw', 'ww', 'nw', 'wd', 'gd', 'rd']);
const SUIT_RE = /^([1-9]|0)([mps])$/;

/** Разобрать строку тайлов: {tiles} или {error}. */
export function parseHandTokens(text) {
  const tiles = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    const m = SUIT_RE.exec(raw);
    if (m) { tiles.push(m[1] === '0' ? `0${m[2]}` : `${m[1]}${m[2]}`); continue; }
    if (HONORS.has(raw)) { tiles.push(raw); continue; }
    return { error: `Не распознанный тайл «${raw}»` };
  }
  return { tiles };
}

/** Валидация ручной руки: 13/14 тайлов, ≤4 копий вида, ≤1 красная на масть. */
export function validateHandTiles(tiles) {
  if (tiles.length !== 13 && tiles.length !== 14) {
    return `Рука — 13 или 14 тайлов, а здесь ${tiles.length}`;
  }
  const counts = new Map();
  for (const t of tiles) {
    const c = canonicalTileId(t);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [id, n] of counts) if (n > 4) return `Тайл ${id} — ${n} копии, а в стене 4`;
  const reds = new Map();
  for (const t of tiles) if (t[0] === '0') reds.set(t[1], (reds.get(t[1]) ?? 0) + 1);
  for (const [suit, n] of reds) if (n > 1) return `Красных пятёрок масти ${suit} — ${n}, а в стене одна`;
  return null;
}

/** Контекст оценки — та же форма, что у createDailyContext. */
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

function randomOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Случайные условия: ветра + индикаторы доры и ура. */
export function randomTestContext() {
  const ids = allTileIds();
  return buildTestContext(randomOf(WIND_IDS), randomOf(WIND_IDS), randomOf(ids), randomOf(ids));
}

/** Палитра: три масти и отдельно хоноры. */
const PALETTE_ROWS = [
  ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'],
  ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p'],
  ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s'],
  ['ew', 'sw', 'ww', 'nw', 'wd', 'gd', 'rd'],
];

/** Инициализация вкладки. Возвращает функцию возврата в игру. */
export function initTestMode() {
  const view = document.getElementById('view-test');
  if (!view) return () => {};
  const game = document.getElementById('view-game');
  const tabGame = document.getElementById('tab-game');
  const tabTest = document.getElementById('tab-test');
  const entry = document.getElementById('btn-test-mode');

  const q = (sel) => document.getElementById(sel.slice(1));
  const els = {
    roundWinds: q('#tm-round-winds'),
    seatWinds: q('#tm-seat-winds'),
    dora: q('#tm-dora'),
    ura: q('#tm-ura'),
    rand: q('#btn-tm-rand'),
    newHand: q('#btn-tm-new'),
    reset: q('#btn-tm-reset'),
    scoreBtn: q('#btn-tm-score'),
    error: q('#tm-error'),
    palette: q('#tm-palette'),
    hand: q('#tm-hand'),
    kanPrompt: q('#tm-kan-prompt'),
    kanPromptTiles: q('#tm-kan-prompt-tiles'),
    btnKan: q('#tm-btn-kan'),
    btnKanSkip: q('#tm-btn-kan-skip'),
    kanList: q('#tm-kan-list'),
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
  if (typeof view.showModal !== 'function') view.showModal = showTest;
  if (typeof view.close !== 'function') view.close = showGame;

  tabGame?.addEventListener('click', showGame);
  tabTest?.addEventListener('click', showTest);
  entry?.addEventListener('click', showTest);
  els.close?.addEventListener('click', showGame);
  if (tabTest && entry) tabTest.hidden = entry.hidden;

  // ---- состояние ----
  let ctx = null;
  let phase = 'edit'; // edit | choose | result | complete
  let scored = false; // нажата «Просчитать руку»
  let hand = [];
  let declaredKans = [];
  let pendingKans = [];
  let pendingKan = null;
  // Пропущенные каны: нажал «Пропустить» — этот кан в руке не предлагаем
  // больше (сбрасывается только вместе с рукой: deal/resetAll/очистка).
  let skippedKans = [];
  let discarded = null;
  let remaining = [];
  let score = null;
  let blockId = null;

  /** Тайлы, исключённые из добора после кана: только индикаторы теста
   *  (доры/уры — те, что заданы в этом тестовом режиме). Доры РЕЖИМА ДНЯ
   *  в тесте не участвуют: тест — отдельный стенд, а не день. */
  function deadForDraw() {
    return [...(ctx?.deadTiles ?? [])];
  }

  function resetAll() {
    ctx = randomTestContext();
    phase = 'edit';
    scored = false;
    hand = [];
    declaredKans = [];
    pendingKans = [];
    pendingKan = null;
    skippedKans = [];
    discarded = null;
    remaining = [];
    score = null;
    blockId = null;
    showError(null);
    syncIndicatorInputs();
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message ?? '';
    els.error.hidden = !message;
  }

  function syncIndicatorInputs() {
    if (els.dora) els.dora.value = ctx?.doraIndicators?.[0] ?? '';
    if (els.ura) els.ura.value = ctx?.uraIndicators?.[0] ?? '';
  }

  function setContext(roundWindId, seatWindId, dora, ura) {
    ctx = buildTestContext(roundWindId, seatWindId, dora, ura);
    syncIndicatorInputs();
    renderWinds();
    reevaluate();
    render();
    void syncHandBlock();
  }

  // ---- каны: те же функции, что в руке дня ----
  function refreshKanPrompt() {
    if (!els.kanPrompt) return;
    if (!scored || phase !== 'choose') {
      pendingKans = [];
      pendingKan = null;
      els.kanPrompt.hidden = true;
      return;
    }
    if (!pendingKan) pendingKans = findKans(hand).filter((kan) =>
      !skippedKans.some((skipped) => canonicalTileId(skipped) === canonicalTileId(kan.tile)));
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
    const drawn = drawHand(1, { deadTiles: deadForDraw() });
    declaredKans = [...declaredKans, { tile: pendingKan.tile, tiles: pendingKan.tiles }];
    pendingKan = null;
    pendingKans = [];
    hand = sortHand([...rest, ...drawn]);
    if (els.kanPrompt) els.kanPrompt.hidden = true;
    reevaluate();
    render();
    void syncHandBlock();
  }

  function skipKan() {
    if (pendingKan && !skippedKans.includes(pendingKan.tile)) {
      skippedKans = [...skippedKans, pendingKan.tile];
    }
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
    render();
  }

  // ---- оценка ----
  function fullTiles() { return withKanPons(hand, declaredKans); }

  /** Контекст оценки: только условия ТЕКУЩЕГО теста (ветра + дора/ура,
   *  заданные пользователем в полях). Доры режима дня здесь НЕ участвуют:
   *  тест — отдельный стенд. */
  function scoringContext() {
    return { ...ctx };
  }

  function reevaluate() {
    if (!hand.length || !scored) {
      phase = 'edit';
      score = null;
      remaining = [];
      return;
    }
    const full = fullTiles();
    if (full.length === 14) {
      phase = 'choose';
      score = null;
      remaining = [];
      return;
    }
    if (full.length === 13) {
      phase = 'result';
      remaining = hand;
      score = evaluateHand(full, scoringContext(), declaredKans);
      return;
    }
    phase = 'edit';
    score = null;
    remaining = [];
  }

  function deal(tiles) {
    hand = sortHand(tiles);
    declaredKans = [];
    pendingKan = null;
    pendingKans = [];
    skippedKans = [];
    discarded = null;
    remaining = [];
    score = null;
    blockId = null;
    scored = false;
    if (els.kanPrompt) els.kanPrompt.hidden = true;
    reevaluate();
    render();
    void syncHandBlock();
  }

  /** Клик по тайлу ДО просчёта — убрать его из руки. */
  function removeAt(index) {
    if (scored) return;
    hand = hand.filter((_, i) => i !== index);
    showError(null);
    reevaluate();
    render();
    void syncHandBlock();
  }

  /** Клик по тайлу ПОСЛЕ просчёта и разбора канов — сброс. */
  function discardAt(index) {
    if (!scored || phase !== 'choose' || pendingKan) return;
    discarded = hand[index];
    remaining = hand.filter((_, i) => i !== index);
    hand = remaining;
    score = evaluateHand(withKanPons(remaining, declaredKans), scoringContext(), declaredKans);
    phase = 'result';
    render();
    void syncHandBlock();
  }

  function resetChoice() {
    scored = false;
    phase = 'edit';
    discarded = null;
    remaining = [];
    score = null;
    render();
  }

  // ---- палитра ----
  function usedOf(tile) {
    const canon = canonicalTileId(tile);
    const inHand = hand.filter((t) => canonicalTileId(t) === canon).length;
    const inKans = declaredKans.filter((k) => canonicalTileId(k.tile) === canon).length * 4;
    return inHand + inKans;
  }

  function addTile(tile) {
    if (!ctx) ctx = randomTestContext();
    if (!tile) return;
    if (scored) {
      // меняем руку — просчёт сбрасывается
      hand = [];
      declaredKans = [];
      discarded = null;
      remaining = [];
      score = null;
      pendingKan = null;
      pendingKans = [];
      skippedKans = [];
      scored = false;
      blockId = null;
    }
    if (hand.length >= 14) { showError('В руке уже 14 тайлов.'); return; }
    if (usedOf(tile) >= 4) { showError(`Тайлов ${tile} уже 4 — больше нельзя.`); return; }
    showError(null);
    hand = sortHand([...hand, canonicalTileId(tile)]);
    reevaluate();
    render();
    void syncHandBlock();
  }

  // ---- рендер ----
  function renderWinds() {
    if (!ctx) return;
    for (const [container, key] of [[els.roundWinds, 'roundWindId'], [els.seatWinds, 'seatWindId']]) {
      if (!container) continue;
      container.innerHTML = '';
      for (const id of WIND_IDS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = WIND_LABEL[id];
        btn.className = 'tm-wind' + (ctx[key] === id ? ' active' : '');
        btn.addEventListener('click', () => {
          setContext(
            key === 'roundWindId' ? id : ctx.roundWindId,
            key === 'seatWindId' ? id : ctx.seatWindId,
            ctx.doraIndicators[0],
            ctx.uraIndicators[0] ?? null,
          );
        });
        container.appendChild(btn);
      }
    }
  }

  function renderPalette() {
    if (!els.palette) return;
    if (!els.palette.dataset.ready) {
      els.palette.innerHTML = '';
      PALETTE_ROWS.forEach((_, i) => {
        const line = document.createElement('div');
        line.className = 'tile-palette-row';
        line.id = `tm-palette-row-${i}`;
        els.palette.append(line);
      });
      els.palette.dataset.ready = '1';
    }
    PALETTE_ROWS.forEach((row, i) => {
      const line = document.getElementById(`tm-palette-row-${i}`);
      // renderTiles зовёт (index, id) — берём id, индекс запасной.
      if (line) renderTiles(line, row, { onTileClick: (index, id) => addTile(id ?? row[index]) });
    });
  }

  function render() {
    if (!ctx) return;
    renderWinds();
    renderPalette();
    refreshKanPrompt();
    const canEdit = !scored;
    const canDiscard = scored && phase === 'choose' && !pendingKan;
    renderTiles(els.hand, hand, {
      disabled: !(canEdit || canDiscard),
      onTileClick: (index) => (canEdit ? removeAt(index) : discardAt(index)),
      doraTiles: ctx.doraTiles,
      uraTiles: scored ? ctx.uraTiles : [],
    });

    if (discarded) {
      els.discardedPanel.hidden = false;
      renderTiles(els.discarded, [discarded], { disabled: true, doraTiles: ctx.doraTiles, uraTiles: ctx.uraTiles });
    } else {
      els.discardedPanel.hidden = true;
    }

    if (scored && phase !== 'edit' && score) {
      els.resultPanel.hidden = false;
      renderGroupedHand(els.groupedHand, score.display, { doraTiles: ctx.doraTiles, uraTiles: ctx.uraTiles });
      renderScore(els.result, score);
      if (score.potentialDisplay) {
        els.potentialPreview.hidden = false;
        els.potentialTitle.textContent = score.potentialSummary;
        renderGroupedHand(els.potentialHand, score.potentialDisplay, { doraTiles: ctx.doraTiles, uraTiles: ctx.uraTiles });
      } else {
        els.potentialPreview.hidden = true;
      }
    } else {
      els.resultPanel.hidden = true;
      els.potentialPreview.hidden = true;
    }

    if (els.kanList) {
      els.kanList.innerHTML = '';
      for (const kan of declaredKans) renderClosedKan(els.kanList, kan);
    }

    if (els.hint) {
      if (!hand.length) els.hint.textContent = 'Тыкайте тайлы в палитре, чтобы собрать руку.';
      else if (!scored) els.hint.textContent = `В руке ${hand.length}. Клик по тайлу убирает его. Затем «Просчитать руку».`;
      else if (pendingKan) els.hint.textContent = 'Есть кан: объявите его или пропустите.';
      else if (phase === 'choose') els.hint.textContent = `Рука просчитана. Теперь выберите тайл для сброса (${hand.length} в руке).`;
      else if (phase === 'complete') els.hint.textContent = 'Готовая рука.';
      else els.hint.textContent = `Сброшен ${tileDisplayName(discarded)}.`;
    }
    if (els.hand) els.hand.classList.toggle('await-discard', scored && phase === 'choose' && !pendingKan);
    if (els.reset) els.reset.hidden = !scored;
  }

  async function syncHandBlock() {
    try {
      if (!score) return null;
      const payload = scorePayload(ctx, { hand, discarded, remaining, score });
      if (blockId) return await updateHandBlock(blockId, payload);
      const res = await logHand({ mode: 'test', payload });
      if (res?.id) blockId = res.id;
      return res;
    } catch {
      return null;
    }
  }

  function randomHand() {
    if (!ctx) ctx = randomTestContext();
    deal(drawHand(14, { deadTiles: deadForDraw() }));
  }

  els.rand?.addEventListener('click', randomHand);
  els.newHand?.addEventListener('click', randomHand);
  els.reset?.addEventListener('click', resetChoice);
  els.btnKan?.addEventListener('click', declareKan);
  els.btnKanSkip?.addEventListener('click', skipKan);

  els.scoreBtn?.addEventListener('click', () => {
    if (!ctx) ctx = randomTestContext();
    if (!hand.length) { showError('Сначала наберите тайлы в палитре.'); return; }
    if (hand.length !== 13 && hand.length !== 14) {
      showError(`В руке ${hand.length} тайлов, нужно 13 или 14.`);
      return;
    }
    showError(null);
    scored = true;
    pendingKan = null;
    pendingKans = [];
    reevaluate();
    render();
    void syncHandBlock();
  });

  const onIndicator = (input, isUra) => {
    input?.addEventListener('change', () => {
      if (!ctx) return;
      const value = input.value.trim().toLowerCase();
      if (value && !HONORS.has(value) && !SUIT_RE.test(value)) {
        showError(`Не распознанный тайл «${value}»`);
        return;
      }
      showError(null);
      const dora = isUra ? (ctx.doraIndicators[0] ?? null) : (value || null);
      const ura = isUra ? (value || null) : (ctx.uraIndicators[0] ?? null);
      setContext(ctx.roundWindId, ctx.seatWindId, dora, ura);
    });
  };
  onIndicator(els.dora, false);
  onIndicator(els.ura, true);

  els.bugButton?.addEventListener('click', () => {
    if (!els.bugForm) return;
    els.bugForm.hidden = !els.bugForm.hidden;
    if (!els.bugForm.hidden) els.bugText?.focus();
  });
  els.bugCancel?.addEventListener('click', () => {
    if (els.bugForm) els.bugForm.hidden = true;
    if (els.bugStatus) els.bugStatus.textContent = '';
  });
  els.bugForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.bugText?.value?.trim();
    if (!text) return;
    if (score) await syncHandBlock();
    if (!blockId) {
      if (els.bugStatus) els.bugStatus.textContent = 'Сначала посчитайте руку.';
      return;
    }
    try {
      const res = await reportHandBlock(blockId, text);
      if (els.bugStatus) els.bugStatus.textContent = res ? 'Спасибо, отмечено.' : 'Не удалось отправить.';
      if (res) els.bugText.value = '';
    } catch {
      if (els.bugStatus) els.bugStatus.textContent = 'Не удалось отправить.';
    }
  });

  resetAll();
  render();

  return showGame;
}
