import { CONFIG } from './config.js';
import { drawHand, sortHand, tileDisplayName } from './tiles.js';
import { createStore } from './state.js';
import { renderTiles, renderScore, renderGroupedHand, createTileElement } from './ui.js';
import { evaluateCompleteHand, evaluateHand } from './scoring.js';
import { createDailyContext } from './daily-context.js';
import { readStoredDailyHand, writeStoredDailyHand } from './daily-hand.js';
import { initStructureEditor } from './structure-editor.js';
import { initAuthButton, onAuthChange, getAuth, logout, submitScore, canTestMode, refreshMe } from './auth.js';
import { initTestMode } from './test-mode.js';
import { initRolesPanel } from './roles-panel.js';
import { initBugViewer } from './bug-viewer.js';
import { logHand, updateHandBlock, scorePayload } from './event-log.js';
import { initLeaderboard } from './leaderboard.js';

const dailyContext = createDailyContext();

const els = {
  hand: document.getElementById('hand'),
  discarded: document.getElementById('discarded'),
  discardedPanel: document.getElementById('discarded-panel'),
  result: document.getElementById('result'),
  resultPanel: document.getElementById('result-panel'),
  groupedHand: document.getElementById('grouped-hand'),
  subtitle: document.getElementById('subtitle'),
  btnGenerate: document.getElementById('btn-generate'),
  btnReset: document.getElementById('btn-reset'),
  roundWind: document.getElementById('round-wind'),
  seatWind: document.getElementById('seat-wind'),
  doraIndicator: document.getElementById('dora-indicator'),
  uraIndicator: document.getElementById('ura-indicator'),
  uraItem: document.getElementById('ura-item'),
  dailyDate: document.getElementById('daily-date'),
  potentialPreview: document.getElementById('potential-preview'),
  potentialHand: document.getElementById('potential-hand'),
  potentialTitle: document.getElementById('potential-title'),
  authSlot: document.getElementById('auth-slot'),
  authUser: document.getElementById('auth-user'),
  btnTestMode: document.getElementById('btn-test-mode'),
  btnRoles: document.getElementById('btn-roles'),
  btnBugs: document.getElementById('btn-bugs'),
  scoreStatus: document.getElementById('score-status'),
  leaderboardPanel: document.getElementById('leaderboard-panel'),
  leaderboard: document.getElementById('leaderboard'),
  lbDate: document.getElementById('lb-date'),
};

/**
 * Начальное состояние:
 *  - если рука дня уже сгенерирована в этом браузере (localStorage) —
 *    восстанавливаем её (та же рука, что игрок видел до перезагрузки),
 *  - иначе — фаза 'waiting': 14 тайлов рубашкой вверх, ждём нажатия
 *    «Сгенерировать руку» (кнопка активна один раз в день).
 */
function initialDailyState() {
  const stored = readStoredDailyHand();
  if (stored?.dayKey === dailyContext.dayKey) {
    const hand = sortHand(stored.hand);
    const completed = evaluateCompleteHand(hand, dailyContext);
    return {
      phase: completed ? 'complete' : 'choose',
      hand,
      discarded: null,
      remaining: completed ? hand : [],
      score: completed,
      daily: true,
    };
  }
  return {
    phase: 'waiting',
    hand: [],
    discarded: null,
    remaining: [],
    score: null,
    daily: false,
  };
}

const store = createStore(initialDailyState());

/** Таблица дня: обновлять после записи результата. */
let refreshLeaderboard = () => {};
let lastSubmitKey = null;

/** Сбросить статус записи (новая рука/выход). */
function resetScoreStatus() {
  els.scoreStatus.hidden = true;
  els.scoreStatus.textContent = '';
  lastSubmitKey = null;
}

/**
 * Если игрок вошёл — отправить результат ДНЯ на сервер (там хранится лучший).
 * Ключ по «рука+сброс»: один и тот же вариант не отправляем повторно.
 */
async function maybeSubmitScore(state) {
  const authed = getAuth();
  if (!authed || !state.daily) {
    if (state.phase === 'choose' || !state.daily) resetScoreStatus();
    return;
  }
  const hasScore = state.phase === 'result' || state.phase === 'complete';
  if (!hasScore || state.score?.total == null) return;
  const key = `${dailyContext.dayKey}|${state.hand.join(',')}|${state.discarded ?? ''}`;
  if (key === lastSubmitKey) return;
  lastSubmitKey = key;
  els.scoreStatus.textContent = 'Записываю результат…';
  els.scoreStatus.hidden = false;
  try {
    const r = await submitScore(dailyContext.dayKey, state.score.total, {
      discarded: state.discarded ?? undefined,
      tiles: state.phase === 'complete' ? state.hand : state.remaining,
    });
    els.scoreStatus.textContent =
      `Сохранено: ${r.score.toLocaleString('ru-RU')} очков — ` +
      `${r.isBest ? 'личный рекорд' : 'у вас уже был лучший результат'}, ${r.rank} место в таблице дня`;
    refreshLeaderboard();
  } catch (e) {
    lastSubmitKey = null; // позволить повторить
    els.scoreStatus.textContent = `Не удалось сохранить результат: ${e.message}`;
  }
}

/** Чип с профилем (аватар + имя + «выйти») или слот с кнопкой Google. */
function renderAuthUser() {
  const a = getAuth();
  if (a) {
    els.authUser.hidden = false;
    els.authSlot.hidden = true;
    els.authUser.innerHTML = '';
    if (a.user.picture) {
      const img = document.createElement('img');
      img.className = 'auth-pic';
      img.src = a.user.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      els.authUser.append(img);
    }
    const name = document.createElement('span');
    name.className = 'auth-name';
    name.textContent = a.user.name;
    els.authUser.append(name);
    if (a.user.role && a.user.role !== 'player') {
      const roleBadge = document.createElement('span');
      roleBadge.className = `auth-role role-${a.user.role}`;
      roleBadge.textContent = a.user.role;
      els.authUser.append(roleBadge);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-logout';
    btn.textContent = 'выйти';
    btn.addEventListener('click', () => logout());
    els.authUser.append(btn);
    // Кнопки по ролям: тестовый режим — admin и test, панели — admin
    els.btnTestMode.hidden = !canTestMode();
    els.btnRoles.hidden = a.user.role !== 'admin';
    els.btnBugs.hidden = a.user.role !== 'admin';
    // Вход после того, как результат дня уже есть — отправляем его.
    maybeSubmitScore(store.getState());
  } else {
    els.authUser.hidden = true;
    els.authSlot.hidden = false;
    els.btnTestMode.hidden = true;
    els.btnRoles.hidden = true;
    els.btnBugs.hidden = true;
  }
}

/**
 * «Сгенерировать руку»: одна рука на день. Сдаём 14 тайлов (копии
 * индикаторов в мёртвой стене), фиксируем руку в localStorage и
 * переворачиваем тайлы партиями 4/4/4/2 — чистая анимация, после неё
 * обычная фаза choose/complete и кнопка блокируется до следующего дня.
 */
let dealing = false;
// id блока лога текущей руки дня (одна рука = один блок; null — ещё не создан)
let dailyBlockId = null;
async function generateHand() {
  if (dealing || store.getState().phase !== 'waiting') return;
  dealing = true;
  els.btnGenerate.disabled = true;

  const raw = drawHand(CONFIG.handSize, { deadTiles: dailyContext.deadTiles });
  const hand = CONFIG.autoSortHand ? sortHand(raw) : raw;
  writeStoredDailyHand(dailyContext.dayKey, hand);
  const completed = evaluateCompleteHand(hand, dailyContext);

  // лог: блок создаётся только для ПОСЧИТАННОЙ руки (готовая с раздачи);
  // просто сгенерированная рука без счёта в логи не попадает
  dailyBlockId = null;
  if (completed) {
    void logHand({ mode: 'daily', payload: scorePayload(dailyContext, { hand, score: completed }) }).then((res) => {
      if (res?.id) dailyBlockId = res.id;
    });
  }

  await playDealAnimation(hand);

  store.setState({
    phase: completed ? 'complete' : 'choose',
    hand,
    discarded: null,
    remaining: completed ? hand : [],
    score: completed,
    daily: true,
  });
  dealing = false;
}

/** Анимация: 14 рубашек, потом по 4 тайла переворачиваются, последняя партия — 2. */
const FLIP_BATCHES = [4, 4, 4, 2];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function playDealAnimation(hand) {
  els.hand.innerHTML = '';
  const backs = hand.map(() => {
    const back = document.createElement('div');
    back.className = 'tile-back';
    return back;
  });
  els.hand.append(...backs);
  await sleep(300);
  let offset = 0;
  for (const count of FLIP_BATCHES) {
    for (let i = 0; i < count && offset + i < hand.length; i++) {
      const idx = offset + i;
      const tile = createTileElement(hand[idx], {
        disabled: true,
        doraTiles: dailyContext.doraTiles,
        uraTiles: [],
      });
      tile.classList.add('is-flipping');
      tile.style.animationDelay = `${i * 70}ms`;
      backs[idx].replaceWith(tile);
    }
    offset += count;
    await sleep(520);
  }
}

/** Вернуться к исходной раздаче, не генерируя новую. */
function resetChoice() {
  const { phase } = store.getState();
  if (phase !== 'result') return;
  store.setState({ phase: 'choose', discarded: null, remaining: [], score: null });
}

/** Обработка клика по тайлу — сброс. */
function discardAt(index) {
  const { phase, hand } = store.getState();
  if (phase !== 'choose') return;

  const discarded = hand[index];
  const remaining = hand.filter((_, i) => i !== index);
  const score = evaluateHand(remaining, dailyContext);

  store.setState({
    phase: 'result',
    discarded,
    remaining,
    score,
  });
  // лог: одна рука = один блок; первый счёт создаёт блок, повторный — обновляет
  const payload = scorePayload(dailyContext, { hand, discarded, remaining, score });
  if (dailyBlockId) {
    void updateHandBlock(dailyBlockId, payload);
  } else {
    void logHand({ mode: 'daily', payload }).then((res) => {
      if (res?.id) dailyBlockId = res.id;
    });
  }
}

/** Отрисовка по текущему состоянию. */
function render(state) {
  // Индикатор урадор открывается только после сброса: до этого момента тайл
  // лежит «рубашкой вверх», и урадоры нигде не учитываются.
  const uraOpen = state.phase !== 'choose' && state.phase !== 'waiting';
  const uraTiles = uraOpen ? dailyContext.uraTiles : [];

  if (state.phase === 'waiting') {
    // Рука ещё не сгенерирована: 14 тайлов рубашкой вверх.
    els.hand.innerHTML = '';
    for (let i = 0; i < CONFIG.handSize; i++) {
      const back = document.createElement('div');
      back.className = 'tile-back';
      els.hand.append(back);
    }
    els.discardedPanel.hidden = true;
    els.resultPanel.hidden = true;
    els.potentialPreview.hidden = true;
    els.subtitle.textContent = 'Нажмите «Сгенерировать руку» — рука дня выдаётся один раз в день.';
  } else {
    const visibleHand = state.phase === 'choose' ? state.hand : state.remaining;
    renderTiles(els.hand, visibleHand, {
      disabled: state.phase !== 'choose',
      onTileClick: discardAt,
      doraTiles: dailyContext.doraTiles,
      uraTiles,
    });

    // Сброшенный тайл
    if (state.discarded) {
      els.discardedPanel.hidden = false;
      renderTiles(els.discarded, [state.discarded], {
        disabled: true,
        doraTiles: dailyContext.doraTiles,
        uraTiles,
      });
    } else {
      els.discardedPanel.hidden = true;
    }

    // Результат скоринга + сгруппированная рука
    if (state.phase !== 'choose' && state.score) {
      els.resultPanel.hidden = false;
      renderGroupedHand(els.groupedHand, state.score.display, {
        doraTiles: dailyContext.doraTiles, uraTiles,
      });
      renderScore(els.result, state.score);
      if (state.score.potentialDisplay) {
        els.potentialPreview.hidden = false;
        els.potentialTitle.textContent = state.score.potentialSummary;
        renderGroupedHand(els.potentialHand, state.score.potentialDisplay, {
          doraTiles: dailyContext.doraTiles,
          uraTiles,
        });
      } else {
        els.potentialPreview.hidden = true;
      }
    } else {
      els.resultPanel.hidden = true;
      els.potentialPreview.hidden = true;
    }

    // Подпись
    if (state.phase === 'choose') {
      els.subtitle.textContent = `Выберите тайл для сброса (${state.hand.length})`;
    } else if (state.phase === 'complete') {
      els.subtitle.textContent = 'Готовая рука! Сбрасывать тайл не нужно.';
    } else {
      els.subtitle.textContent = `Рука из ${state.remaining.length} тайлов. Тайл ${tileDisplayName(state.discarded)} сброшен.`;
    }
  }
  // Кнопка: активна только до первой генерации дня (и пока идёт анимация)
  els.btnGenerate.disabled = state.phase !== 'waiting' || dealing;
  els.btnReset.hidden = state.phase !== 'result';

  // Мёртвая стена: ура-индикатор показывается только после сброса
  els.uraItem.hidden = dailyContext.uraIndicators.length === 0;
  if (uraOpen) {
    renderTiles(els.uraIndicator, dailyContext.uraIndicators, { disabled: true });
  } else {
    els.uraIndicator.innerHTML = '<div class="tile-back" title="Откроется после сброса"></div>';
  }

  // Результат дня → таблица (если игрок вошёл)
  maybeSubmitScore(state);
}

store.subscribe(render);

renderTiles(els.roundWind, [dailyContext.roundWindId], { disabled: true });
renderTiles(els.seatWind, [dailyContext.seatWindId], { disabled: true });
renderTiles(els.doraIndicator, dailyContext.doraIndicators, { disabled: true });
els.dailyDate.textContent = dailyContext.dayKey;

els.btnGenerate.addEventListener('click', () => {
  void generateHand();
});
els.btnReset.addEventListener('click', resetChoice);

initStructureEditor({
  onChange: () => {
    const state = store.getState();
    if (state.phase === 'result') {
      store.setState({ score: evaluateHand(state.remaining, dailyContext) });
    } else if (state.phase === 'complete') {
      store.setState({ score: evaluateCompleteHand(state.hand, dailyContext) });
    }
  },
});

// Регистрация через Google и таблица дня (тихо деградируют, если сервер
// или client ID не настроены: игра работает как раньше).
initAuthButton(els.authSlot).then(renderAuthUser);
onAuthChange(renderAuthUser);
renderAuthUser();
// Роль на сервере может измениться без повторного логина (hot-reload файла
// ролей) — при загрузке страницы подтягиваем актуальный профиль.
refreshMe();

initTestMode();
initRolesPanel();
initBugViewer();

initLeaderboard({
  listEl: els.leaderboard,
  panelEl: els.leaderboardPanel,
  dateLabel: els.lbDate,
  dayKey: dailyContext.dayKey,
}).then((refresh) => {
  refreshLeaderboard = refresh;
});

render(store.getState()); // waiting (14 рубашек) либо уже сгенерированная рука дня
