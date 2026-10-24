import { CONFIG } from './config.js';
import { drawHand, sortHand, tileDisplayName } from './tiles.js';
import { createStore } from './state.js';
import { renderTiles, renderScore, renderGroupedHand, createTileElement } from './ui.js';
import { evaluateCompleteHand, evaluateHand } from './scoring.js';
import { createDailyContext } from './daily-context.js';
import { readStoredDailyHand, writeStoredDailyHand } from './daily-hand.js';
import { findKans, withKanPons, openKanDoraCount, countKans, KAN_DORA_SLOTS } from './kans.js';
import { renderClosedKan, renderKanPrompt, renderKanDoras } from './kans-ui.js';
import { initStructureEditor } from './structure-editor.js';
import { initAuthButton, onAuthChange, getAuth, logout, submitScore, canTestMode, refreshMe, fetchDailyHand, saveDailyHand } from './auth.js';
import { initTestMode } from './test-mode.js';
import { initRolesPanel } from './roles-panel.js';
import { initBugViewer } from './bug-viewer.js';
import { logHand, updateHandBlock, scorePayload } from './event-log.js';
import { initLeaderboard } from './leaderboard.js';
import { initHandHistory, openMyHands, openLeaderboardHand } from './hand-history.js';
import { initYesterday } from './yesterday.js';
import { APP_VERSION } from './version.js';

const dailyContext = createDailyContext();

/**
 * Контекст СДАЧИ: ура-доры при сдаче не учитываются — они открываются
 * в полночь (00:00 МСК), и сервер пересчитывает вчерашние очки.
 * Кандоры при этом учитываются: 1 базовая открыта с начала дня, каждый
 * объявленный кан открывает ещё одну (макс. 5) — та же формула, что в
 * серверном пересчёте (server/recalc.js).
 */
const baseScoreContext = {
  ...dailyContext,
  uraIndicators: [],
  uraTiles: [],
};

/** Контекст оценки с учётом объявленных канов (кандоры). */
function scoreContextFor(kans = []) {
  const open = openKanDoraCount(kans.length);
  const kanDoras = dailyContext.deadWall.kanDora.slice(0, Math.min(open, KAN_DORA_SLOTS));
  return {
    ...baseScoreContext,
    doraIndicators: [...baseScoreContext.doraIndicators, ...kanDoras],
  };
}

const els = {
  hand: document.getElementById('hand'),
  discarded: document.getElementById('discarded'),
  discardedPanel: document.getElementById('discarded-panel'),
  result: document.getElementById('result'),
  resultPanel: document.getElementById('result-panel'),
  groupedHand: document.getElementById('grouped-hand'),
  subtitle: document.getElementById('subtitle'),
  btnGenerate: document.getElementById('btn-generate'),
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
  nightNote: document.getElementById('night-note'),
  kanPrompt: document.getElementById('kan-prompt'),
  kanPromptTiles: document.getElementById('kan-prompt-tiles'),
  btnKan: document.getElementById('btn-kan'),
  btnKanSkip: document.getElementById('btn-kan-skip'),
  kanList: document.getElementById('kan-list'),
  kanDoraWall: document.getElementById('kan-dora-wall'),
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
/** Состояние по руке дня: готовая — сразу со счётом, иначе фаза выбора сброса. */
function stateFromHand(hand) {
  const sorted = sortHand(hand);
  const completed = evaluateCompleteHand(sorted, scoreContextFor());
  return {
    phase: completed ? 'complete' : 'choose',
    hand: sorted,
    discarded: null,
    remaining: completed ? sorted : [],
    score: completed,
    daily: true,
  };
}

const store = createStore({
  phase: 'waiting',
  hand: [],
  discarded: null,
  remaining: [],
  score: null,
  daily: false,
});

// Пока восстанавливается рука дня, кнопка «Сгенерировать» блокируется.
let booting = true;
void (async () => {
  let next = null;
  try {
    // Сначала localStorage — та же рука, что игрок видел до перезагрузки.
    const stored = readStoredDailyHand();
    if (stored?.dayKey === dailyContext.dayKey) {
      next = stateFromHand(stored.hand);
    } else if (getAuth()) {
      // Локальной руки дня нет (очистка кеша, другое устройство) —
      // восстанавливаем с сервера: рука фиксируется там при генерации.
      const data = await fetchDailyHand(dailyContext.dayKey);
      if (data?.hand?.length) {
        writeStoredDailyHand(dailyContext.dayKey, data.hand);
        next = stateFromHand(data.hand);
      }
    }
  } catch {
    /* сервер недоступен — не мешаем игре */
  }
  // Сначала снимаем флаг: финальный setState вызывает рендер, и он обязан
  // увидеть booting = false — иначе «Сгенерировать» остаётся заблокированной
  // навсегда (раньше booting=false выставлялся ПОСЛЕ setState).
  booting = false;
  if (next) store.setState(next);
  else store.setState({ phase: 'waiting', hand: [], discarded: null, remaining: [], score: null, daily: false });
})();

// Если день сменился, пока страница открыта (полночь МСК), — перезагружаем:
// иначе рука старого дня блокировала бы кнопку «Сгенерировать» до ручного
// обновления вкладки.
function maybeReloadOnNewDay() {
  if (createDailyContext(new Date()).dayKey !== dailyContext.dayKey) location.reload();
}
setInterval(maybeReloadOnNewDay, 60_000);
document.addEventListener('visibilitychange', maybeReloadOnNewDay);
window.addEventListener('focus', maybeReloadOnNewDay);

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
      // Для ночного пересчёта: исходная рука, объявленные каны, готовность,
      // контекст дня (ветра и индикатор доры — без ура-дор).
      // Готовая рука после кана идёт полным 14-тайловым списком (пон кана).
      hand: state.phase === 'complete' ? withKanPons(state.hand, declaredKans) : state.hand,
      kans: declaredKans.map((kan) => kan.tile),
      complete: state.phase === 'complete',
      dayCtx: {
        dayKey: dailyContext.dayKey,
        doraIndicators: dailyContext.doraIndicators,
        uraIndicators: [],
        roundWindId: dailyContext.roundWindId,
        seatWindId: dailyContext.seatWindId,
      },
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
    // Аватар + имя — кликабельно: история ежедневных рук (профиль)
    const profile = document.createElement('span');
    profile.className = 'auth-profile';
    profile.title = 'Мои руки';
    if (a.user.picture) {
      const img = document.createElement('img');
      img.className = 'auth-pic';
      img.src = a.user.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      profile.append(img);
    }
    const name = document.createElement('span');
    name.className = 'auth-name';
    name.textContent = a.user.name;
    profile.append(name);
    profile.addEventListener('click', () => openMyHands());
    els.authUser.append(profile);
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
// --- Каны ---
// Объявленные каны: [{tile, tiles}]; pendingKan — предложенный кан,
// pendingKans — очередь (корректная работа нескольких канов).
let declaredKans = [];
let pendingKan = null;
let pendingKans = [];

/** Предложить кан, если он есть и фаза выбора. */
function refreshKanPrompt(state) {
  const hand = state.phase === 'choose' ? state.hand : state.remaining;
  const candidates = findKans(hand);
  pendingKans = candidates;
  pendingKan = candidates[0] ?? null;
  if (!pendingKan) {
    els.kanPrompt.hidden = true;
    return;
  }
  els.kanPrompt.hidden = false;
  renderKanPrompt(els.kanPromptTiles, pendingKan);
}

/** Объявить кан: вынести 4 тайла, добрать тайл, проверить каны снова. */
function declareKan() {
  const state = store.getState();
  if (!pendingKan || state.phase !== 'choose') return;
  const skip = new Set(pendingKan.indices);
  const rest = state.hand.filter((_, i) => !skip.has(i));
  const drawn = drawHand(1, { deadTiles: dailyContext.deadTiles });
  declaredKans = [...declaredKans, { tile: pendingKan.tile, tiles: pendingKan.tiles }];
  pendingKan = null;
  pendingKans = [];
  els.kanPrompt.hidden = true;
  const hand = sortHand([...rest, ...drawn]);
  // После добора кана рука может оказаться ГОТОВОЙ (кан + 3 сета + пара):
  // сбрасывать тогда не нужно — сразу результат.
  const full = withKanPons(hand, declaredKans);
  const completed = evaluateCompleteHand(full, scoreContextFor(declaredKans), declaredKans);
  if (completed) {
    void logHand({ mode: 'daily', payload: scorePayload(dailyContext, { hand: full, score: completed }) }).then((res) => {
      if (res?.id) dailyBlockId = res.id;
    });
  }
  store.setState({
    phase: completed ? 'complete' : 'choose',
    hand,
    discarded: null,
    remaining: completed ? hand : [],
    score: completed,
  });
}

/** Пропустить кан: следующий кан, иначе обычный сброс. */
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

// id блока лога текущей руки дня (одна рука = один блок; null — ещё не создан)
let dailyBlockId = null;
// Предупреждение, если рука не удалось зафиксировать на сервере.
let handFixWarning = null;
async function generateHand() {
  if (dealing || booting || store.getState().phase !== 'waiting') return;
  dealing = true;
  els.btnGenerate.disabled = true;
  try {
    const raw = drawHand(CONFIG.handSize, { deadTiles: dailyContext.deadTiles });
    const hand = CONFIG.autoSortHand ? sortHand(raw) : raw;
    writeStoredDailyHand(dailyContext.dayKey, hand);
    // Фиксируем руку на сервере: она больше не пропадает вместе с
    // localStorage (очистка кеша, другое устройство).
    if (getAuth()) {
      // Фиксация руки на сервере: она восстанавливается при следующем входе
      // (другое устройство, чистый кеш). Ошибка видна игроку.
      saveDailyHand(dailyContext.dayKey, hand, {
        dayKey: dailyContext.dayKey,
        doraIndicators: dailyContext.doraIndicators,
        uraIndicators: [],
        roundWindId: dailyContext.roundWindId,
        seatWindId: dailyContext.seatWindId,
      }).catch(() => {
        handFixWarning = 'рука не зафиксирована на сервере — при очистке кеша или на другом устройстве она может не восстановиться';
        store.setState((s) => ({ ...s }));
      });
    }
    const completed = evaluateCompleteHand(hand, scoreContextFor());

    // лог: блок создаётся только для ПОСЧИТАННОЙ руки (готовая с раздачи);
    // просто сгенерированная рука без счёта в логи не попадает
    dailyBlockId = null;
    declaredKans = [];
    pendingKan = null;
    pendingKans = [];
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
  } finally {
    dealing = false;
  }
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

/** Обработка клика по тайлу — сброс. */
function discardAt(index) {
  const { phase, hand } = store.getState();
  if (phase !== 'choose') return;

  const discarded = hand[index];
  const remaining = hand.filter((_, i) => i !== index);
  // кан, оставшийся в руке после сброса, всё равно считается объявленным;
  // объявленные каны входят в оценку как фиксированные поны
  const score = evaluateHand(withKanPons(remaining, declaredKans), scoreContextFor(declaredKans), declaredKans);

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
  // Ура-дора открывается в КОНЦЕ дня (ночной пересчёт): в течение дня
  // индикатор лежит «рубашкой вверх», урадоры нигде не учитываются, а
  // открывшийся тайл виден в окне «Вчерашняя рука».
  const uraOpen = false;
  const uraTiles = [];

  if (state.phase === 'waiting') {
    // Рука ещё не сгенерирована: блок пустой, тайлов нет —
    // рука появляется только после «Сгенерировать руку».
    els.hand.innerHTML = '';
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

    // Объявленные каны — справа, закрытыми (крайние рубашкой)
  els.kanList.innerHTML = '';
  for (const kan of declaredKans) renderClosedKan(els.kanList, kan);

  // Кандоры: 1 открыта + по одной за объявленный кан (макс. 5)
  const handForKans = state.phase === 'result' ? state.remaining : state.hand;
  const kanCount = countKans(declaredKans, state.phase === 'waiting' ? [] : handForKans);
  renderKanDoras(els.kanDoraWall, dailyContext.deadWall.tiles, openKanDoraCount(kanCount));

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
    if (handFixWarning) {
      els.subtitle.textContent += `  ⚠ ${handFixWarning}`;
    }
  }
  // Кнопка: активна только до первой генерации дня (и пока идёт анимация
  // или восстановление руки дня с сервера).
  els.btnGenerate.disabled = state.phase !== 'waiting' || dealing || booting;

  // Мёртвая стена: ура-индикатор показывается только в конце дня
  els.uraItem.hidden = dailyContext.uraIndicators.length === 0;
  if (uraOpen) {
    renderTiles(els.uraIndicator, dailyContext.uraIndicators, { disabled: true });
  } else {
    els.uraIndicator.innerHTML = '<div class="tile-back" title="Откроется в конце дня (ночной пересчёт)"></div>';
  }

  // Предложение кана — только когда есть кан и фаза выбора
  if (state.phase === 'choose') refreshKanPrompt(state);
  else els.kanPrompt.hidden = true;

  // Заметка о полночном пересчёте (ура-доры и кандоры откроются в 00:00 МСК)
  const hasScore = state.phase === 'result' || state.phase === 'complete';
  if (hasScore) {
    els.nightNote.hidden = false;
    els.nightNote.textContent =
      'В полночь (00:00 МСК) откроются ура-доры и кандоры — очки и место в таблице могут вырасти. ' +
      'Загляните завтра: в окне справа будет вчерашняя рука, новый счёт и открывшиеся доры.';
  } else {
    els.nightNote.hidden = true;
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
els.btnKan.addEventListener('click', () => declareKan());
els.btnKanSkip.addEventListener('click', () => skipKan());

initStructureEditor({
  onChange: () => {
    const state = store.getState();
    if (state.phase === 'result') {
      store.setState({ score: evaluateHand(withKanPons(state.remaining, declaredKans), scoreContextFor(declaredKans), declaredKans) });
    } else if (state.phase === 'complete') {
      store.setState({ score: evaluateCompleteHand(state.hand, scoreContextFor()) });
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

initHandHistory();

initLeaderboard({
  listEl: els.leaderboard,
  panelEl: els.leaderboardPanel,
  dateLabel: els.lbDate,
  dayKey: dailyContext.dayKey,
  onRowClick: openLeaderboardHand,
}).then((refresh) => {
  refreshLeaderboard = refresh;
});

// Окно «Вчерашняя рука»: сервер сам пересчитал вчерашние очки
// (ура-доры + открытые кандоры). Показываем после входа.
const yesterday = initYesterday({ dayKey: dailyContext.dayKey });
if (yesterday) {
  onAuthChange(() => {
    if (getAuth()) void yesterday.refresh();
  });
  if (getAuth()) void yesterday.refresh();
}

render(store.getState()); // waiting (14 рубашек) либо уже сгенерированная рука дня

/* отображение версии в шапке */
const appVersionEl = document.getElementById('app-version');
if (appVersionEl) appVersionEl.textContent = `v${APP_VERSION}`;
