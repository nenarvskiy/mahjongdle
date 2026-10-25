import { CONFIG } from './config.js';
import { drawHand, sortHand, tileDisplayName } from './tiles.js';
import { createStore } from './state.js';
import { renderTiles, renderScore, renderGroupedHand, createTileElement } from './ui.js';
import { evaluateCompleteHand, evaluateHand } from './scoring.js';
import { createDailyContext, doraFromIndicator } from './daily-context.js';
import { readStoredDailyHand, writeStoredDailyHand } from './daily-hand.js';
import { findKans, withKanPons, MAX_KAN_DORA } from './kans.js';
import { renderClosedKan, renderKanPrompt, renderKanDoras } from './kans-ui.js';
import { initAuthButton, onAuthChange, getAuth, getRole, logout, submitScore, canTestMode, refreshMe, fetchDailyHand, saveDailyHand, fetchDayKans, reissueDailyHand } from './auth.js';
import { initTestMode } from './test-mode.js';
import { initRolesPanel } from './roles-panel.js';
import { initBugViewer } from './bug-viewer.js';
import { logHand, updateHandBlock, scorePayload } from './event-log.js';
import { initLeaderboard } from './leaderboard.js';
import { initHandHistory, openMyHands, openLeaderboardHand, setHandHistoryToday } from './hand-history.js';
import { initYesterday } from './yesterday.js';
import { APP_VERSION } from './version.js';

const dailyContext = createDailyContext();

/**
 * Контекст живой игры: только базовая дора (индикатор дня) и ветра.
 * Ура-доры и кан-доры НИКТО не знает до полуночи (00:00 МСК): они
 * открываются в конце дня, и сервер пересчитывает вчерашние очки
 * (server/recalc.js) — 1 ура-дора по умолчанию + 1 ура и 1 кан-дора
 * за каждый кан дня.
 */
const baseScoreContext = {
  ...dailyContext,
  uraIndicators: [],
  uraTiles: [],
};

/** Контекст оценки: тот же для всех фаз (кан-доры открываются в полночь). */
function scoreContextFor(_kans = []) {
  return baseScoreContext;
}

/**
 * Каны ДНЯ (все игроки) с сервера: [{name, kanCount}]. Пока игрок не
 * сбрасывал, его собственные каны сервер ещё не знает — учтём и их.
 */
let dayKans = [];
function refreshDayKans() {
  fetchDayKans(dailyContext.dayKey)
    .then((data) => {
      dayKans = Array.isArray(data?.kans) ? data.kans : [];
      render(store.getState());
    })
    .catch(() => { /* сервер недоступен — кан-доры без жёлтой обводки */ });
}

/**
 * Слоты кан-дор «откроются в конце дня»: базовой НЕТ — одна кан-дора
 * за каждый кан дня (кто бы его ни объявил). До полуночи все слоты
 * закрыты; за объявленные каны обводятся жёлтым с пояснением, ЧЕЙ кан.
 * Индексы 0-based по 4-слотовой стене (kanDora.slice(0, MAX_KAN_DORA)).
 */
function kanDoraPending() {
  const total = Math.min(
    MAX_KAN_DORA,
    Math.max(declaredKans.length, dayKans.reduce((sum, k) => sum + (k.kanCount || 0), 0)),
  );
  const names = dayKans.map((k) => k.name).slice(0, total);
  const me = getAuth()?.user?.name;
  const pending = [];
  for (let i = 0; i < total; i++) {
    const who = names[i] ?? (i < declaredKans.length && me ? me : null);
    pending.push({
      index: i,
      tooltip: who
        ? `Игрок «${who}» получил кан, поэтому в конце дня всем откроется кан-дора. Заходите завтра.`
        : 'Сегодня объявили кан — в конце дня всем откроется кан-дора. Заходите завтра.',
    });
  }
  return pending;
}

/**
 * Таймер «до полуночи МСК» (МСК = UTC+3 без переходов): сколько осталось
 * до 00:00 — в этот момент откроются доры и пересчитаются очки.
 */
function msUntilMidnightMoscow(now = new Date()) {
  const MSK_OFFSET = 3 * 3600 * 1000;
  return 86400000 - ((now.getTime() + MSK_OFFSET) % 86400000);
}
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function tickClock() {
  els.dailyClock.textContent = `Новая рука через ${formatCountdown(msUntilMidnightMoscow())}`;
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
  btnReissue: document.getElementById('btn-reissue'),
  handStatus: document.getElementById('hand-status'),
  roundWind: document.getElementById('round-wind'),
  seatWind: document.getElementById('seat-wind'),
  doraIndicator: document.getElementById('dora-indicator'),
  dailyDate: document.getElementById('daily-date'),
  dailyClock: document.getElementById('daily-clock'),
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
/** Удалить ровно ОДНО вхождение тайла (копий одного тайла в руке может быть несколько). */
function removeOne(arr, tile) {
  const idx = arr.indexOf(tile);
  return idx === -1 ? arr.slice() : arr.filter((_, i) => i !== idx);
}

/**
 * Состояние по руке дня и её прогрессу:
 *  - discarded (тайл сброшен, рука посчитана) — фаза 'result' со счётом:
 *    повторный сброс невозможен, на любом устройстве показывается тот же
 *    результат (счёт пересчитывается детерминированно: та же рука и те же
 *    условия дня);
 *  - готовая рука — фаза 'complete' сразу со счётом;
 *  - иначе — фаза выбора сброса.
 * kans — объявленные каны дня (из localStorage или сервера): рука из
 * завершённой с каном сессии хранится в «пон-форме» (14 тайлов + кан),
 * поэтому для корректного счёта и UI каны восстанавливаются вместе с рукой.
 */
function stateFromHandData({ hand, kans = [], discarded = null, tiles = null }) {
  const sorted = sortHand(hand);
  const kanList = kans.map((tile) => ({ tile }));
  declaredKans = kanList;
  if (discarded) {
    const remaining = sortHand(Array.isArray(tiles) && tiles.length ? tiles : removeOne(sorted, discarded));
    const score = evaluateHand(withKanPons(remaining, kanList), scoreContextFor(kanList), kanList);
    return {
      phase: 'result',
      hand: sorted,
      discarded,
      remaining,
      score,
      daily: true,
    };
  }
  const completed = evaluateCompleteHand(sorted, scoreContextFor(kanList), kanList);
  return {
    phase: completed ? 'complete' : 'choose',
    hand: sorted,
    discarded: null,
    remaining: completed ? sorted : [],
    score: completed,
    daily: true,
  };
}

// Объявленные каны: [{tile, tiles}]; pendingKan — предложенный кан,
// pendingKans — очередь (корректная работа нескольких канов).
// skippedKans — кан-тилы, которые игрок ПРОПУСТИЛ: такие каны больше не
// предлагаем ни в этой сессии, ни после перезагрузки (хранятся в
// localStorage вместе с рукой, см. daily-hand.js).
// Объявлены ДО boot-IIFE: восстановление руки при загрузке их использует.
let declaredKans = [];
let pendingKan = null;
let pendingKans = [];
let skippedKans = [];

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

/**
 * «Печать» руки дня: мультимножество тайлов (рука + тайлы канов),
 * не зависящее от того, объявлены каны или ещё лежат в руке. По ней
 * сравниваем «какая рука сейчас на экране» с «какая рука на сервере».
 */
function handKey(handTiles, kanList = []) {
  const tiles = [...handTiles];
  for (const k of kanList ?? []) tiles.push(k && typeof k === 'object' ? k.tile : k);
  return sortHand(tiles).join('|');
}

/**
 * Синхронизация руки дня с сервером для залогиненного игрока.
 *
 * Сервер — ИСТОЧНИК ПРАВДЫ: рука фиксируется на нём при генерации и может
 * быть заменена (ре-ишю) с любого устройства, поэтому:
 *  - серверная рука отличная от локальной → сервер выигрывает (кэш на
 *    устройстве обновляется, рука на экране заменяется);
 *  - на сервере руки нет → остаётся локальная (фолбэк: БД протёрта
 *    деплоем, сервер недоступен, гостевая рука).
 */
let syncPromise = null; // защита от параллельных синхронизаций
function syncDailyHandFromServer() {
  if (!getAuth() || booting || dealing || reissuing) return;
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      await syncDailyHandFromServerInner();
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

async function syncDailyHandFromServerInner() {
  const local = readStoredDailyHand();
  const localOk = local?.dayKey === dailyContext.dayKey;
  const localKey = localOk ? handKey(local.hand, local.kans ?? []) : null;
  let data;
  try {
    data = await fetchDailyHand(dailyContext.dayKey);
  } catch {
    return; // сервер недоступен — играем с локальной рукой
  }
  if (!data?.hand?.length) return; // на сервере нет руки — локальная остаётся
  if (dealing || reissuing) return; // во время синхронизации начали генерацию
  const cur = store.getState();
  const curKey = cur.daily ? handKey(cur.hand, declaredKans) : null;
  const newKey = handKey(data.hand, data.kans ?? []);
  // Пока запрос шёл, пользователь сам сгенерировал руку (на чистом
  // устройстве) — её рука новее нашего ответа, не затираем.
  if (localKey === null && curKey !== null && curKey !== newKey) return;
  // Прогресс дня: сброшенный тайл (+ пометка готовой руки). Сброс,
  // сделанный на другом устройстве, должен появиться здесь.
  const curProgress = `${cur.discarded ?? ''}|${cur.phase === 'complete' ? 'c' : ''}`;
  const newProgress = `${data.discarded ?? ''}|${data.complete ? 'c' : ''}`;
  // Рука и прогресс совпадают с серверными — ничего не трогаем: локальный
  // кэш может содержать более точное состояние (пропущенные каны), а
  // повторный setState лишний раз перерисует.
  if (curKey === newKey && curProgress === newProgress) return;
  // Иначе сервер — источник правды: новая рука (ре-ишю с другого
  // устройства) и/или сделанный где-то сброс. Заменяем состояние и
  // обновляем кэш; пропущенные каны сохраняем, только если рука та же.
  const sameHand = curKey === newKey;
  skippedKans = sameHand && localOk ? (local.skipped ?? []) : [];
  writeStoredDailyHand(dailyContext.dayKey, data.hand, data.kans ?? [], skippedKans, data.discarded ?? null);
  store.setState(stateFromHandData({ hand: data.hand, kans: data.kans ?? [], discarded: data.discarded ?? null, tiles: data.tiles }));
}

void (async () => {
  // Фаза 1: мгновенно показываем локальную руку (если есть) — не ждём
  // сервер, чтобы рука не «плывала» после перезагрузки.
  const stored = readStoredDailyHand();
  const local = stored?.dayKey === dailyContext.dayKey ? stored : null;
  booting = false;
  if (local) {
    // Каны дня и сброшенный тайл восстанавливаются вместе с рукой:
    // иначе при следующей отправке счёта каны были бы затёрты пустым
    // списком (см. maybeSubmitScore), а посчитанная рука снова
    // предлагала бы сброс.
    skippedKans = local.skipped ?? [];
    store.setState(stateFromHandData({ hand: local.hand, kans: local.kans ?? [], discarded: local.discarded }));
  } else {
    store.setState({ phase: 'waiting', hand: [], discarded: null, remaining: [], score: null, daily: false });
  }
  // Фаза 2: для залогиненных сверяемся с сервером (источник правды):
  // на чистом устройстве рука появится здесь, а «устаревший» кэш
  // (руку перевыдали на другом устройстве) — заменится на свежую.
  // Откладываем в микротаск: переменные dealing/reissuing инициализируются
  // ниже по модулю (TDZ), а сам запрос всё равно асинхронный.
  if (getAuth()) void Promise.resolve().then(() => syncDailyHandFromServer());
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
      // Готовая рука после кана идёт полным 14-тайловым списком (пон кана);
      // восстановленная с сервера уже лежит в итоговой 14-тайловой форме —
      // пон не добавляем повторно (иначе 17 тайлов и сервер отдаст 400).
      hand: state.phase === 'complete'
        ? (state.hand.length === 14 ? state.hand : withKanPons(state.hand, declaredKans))
        : state.hand,
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
    els.btnReissue.hidden = a.user.role !== 'admin';
    // Вход после того, как результат дня уже есть — отправляем его.
    maybeSubmitScore(store.getState());
  } else {
    els.authUser.hidden = true;
    els.authSlot.hidden = false;
    els.btnTestMode.hidden = true;
    els.btnRoles.hidden = true;
    els.btnBugs.hidden = true;
    els.btnReissue.hidden = true;
  }
  refreshDayKans();
}

/**
 * «Сгенерировать руку»: одна рука на день. Сдаём 14 тайлов (копии
 * индикаторов в мёртвой стене), фиксируем руку в localStorage и
 * переворачиваем тайлы партиями 4/4/4/2 — чистая анимация, после неё
 * обычная фаза choose/complete и кнопка блокируется до следующего дня.
 */
let dealing = false;
// --- Каны ---
/**
 * Предложить кан, если он есть и фаза выбора.
 * Пропущенные каны (skippedKans) НЕ предлагаем повторно: один раз нажал
 * «Пропустить» — этот кан в руке больше не предлагать.
 */
function refreshKanPrompt(state) {
  const hand = state.phase === 'choose' ? state.hand : state.remaining;
  const candidates = findKans(hand).filter((kan) => !skippedKans.includes(kan.tile));
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
  // Закрепляем новое состояние дня: рука ПОСЛЕ кана + объявленные каны.
  // Готовая рука фиксируется в 14-тайловой «пон-форме», чтобы при
  // восстановлении сразу опознавалась как готовая (11 тайлов сами по себе
  // готовой рукой не являются).
  writeStoredDailyHand(
    dailyContext.dayKey,
    completed ? full : hand,
    declaredKans.map((kan) => kan.tile),
    skippedKans,
    state.discarded, // кан объявляется только в фазе выбора — сброса ещё нет
  );
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

/**
 * Пропустить кан: запоминаем (не предлагаем больше, и это переживает
 * перезагрузку — хранится вместе с рукой), затем следующий кан из очереди
 * или обычный сброс.
 */
function skipKan() {
  if (pendingKan && !skippedKans.includes(pendingKan.tile)) {
    skippedKans = [...skippedKans, pendingKan.tile];
  }
  const rest = pendingKans.filter((kan) => kan !== pendingKan);
  if (rest.length > 0) {
    pendingKans = rest;
    pendingKan = rest[0];
    renderKanPrompt(els.kanPromptTiles, pendingKan);
    // Закрепляем пропуск ДО перехода к следующему кану: если рендер
    // перезапустит refreshKanPrompt, пропущенный кан уже не найдётся.
    persistSkippedKans();
    return;
  }
  pendingKan = null;
  pendingKans = [];
  els.kanPrompt.hidden = true;
  persistSkippedKans();
}

/** Сохранить пропущенные каны вместе с рукой дня (для восстановления). */
function persistSkippedKans() {
  const state = store.getState();
  if (!state.daily) return;
  writeStoredDailyHand(
    dailyContext.dayKey,
    state.hand,
    declaredKans.map((kan) => kan.tile),
    skippedKans,
    state.discarded,
  );
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
    skippedKans = [];
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

/**
 * Админ: «Заново сгенерировать руку». Сервер выдаёт НОВУЮ руку дня и
 * заменяет старую в БД (старый результат удаляется) — логика «1 рука в
 * день» сохраняется. Клиент подхватывает новую руку с анимацией.
 */
let reissuing = false;
async function reissueHand() {
  if (reissuing || booting) return;
  if (getRole() !== 'admin') return;
  reissuing = true;
  els.btnReissue.disabled = true;
  els.handStatus.hidden = false;
  els.handStatus.textContent = 'Генерирую новую руку…';
  try {
    const data = await reissueDailyHand(dailyContext.dayKey);
    const hand = sortHand(data.hand);
    writeStoredDailyHand(dailyContext.dayKey, hand);
    declaredKans = [];
    pendingKan = null;
    pendingKans = [];
    skippedKans = [];
    els.kanPrompt.hidden = true;
    dailyBlockId = null;
    handFixWarning = null;
    resetScoreStatus();
    lastSubmitKey = null;
    refreshLeaderboard(); // счёт удалён — таблица дня обновится
    await playDealAnimation(hand);
    const completed = evaluateCompleteHand(hand, scoreContextFor());
    if (completed) {
      void logHand({ mode: 'daily', payload: scorePayload(dailyContext, { hand, score: completed }) }).then((res) => {
        if (res?.id) dailyBlockId = res.id;
      });
    }
    store.setState({
      phase: completed ? 'complete' : 'choose',
      hand,
      discarded: null,
      remaining: completed ? hand : [],
      score: completed,
      daily: true,
    });
    els.handStatus.textContent = 'Новая рука выдана — старая заменена.';
  } catch (e) {
    els.handStatus.textContent = `Не удалось: ${e.message}`;
  } finally {
    reissuing = false;
    els.btnReissue.disabled = false;
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
  // Фиксируем сброс локально: рука посчитана — после перезагрузки на этом
  // устройстве повторный сброс невозможен (а на других устройствах сброс
  // придёт с сервера при синхронизации).
  writeStoredDailyHand(
    dailyContext.dayKey,
    hand,
    declaredKans.map((kan) => kan.tile),
    skippedKans,
    discarded,
  );
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
  // Ура-дора и кан-доры открываются в КОНЦЕ дня (ночной пересчёт):
  // в течение дня урадоры не учитываются и нигде не показываются;
  // открывшиеся тайлы видны в полноэкранном окне «Вчера».
  const uraTiles = [];

  if (state.phase === 'waiting') {
    // Рука ещё не сгенерирована: 14 закрытых тайлов — поле не пустое,
    // рука «спит рубашкой» до нажатия «Сгенерировать руку».
    els.hand.innerHTML = '';
    for (let i = 0; i < CONFIG.handSize; i++) {
      const back = document.createElement('div');
      back.className = 'tile-back';
      back.title = 'Рука ещё не сгенерирована';
      els.hand.append(back);
    }
    els.kanList.innerHTML = '';
    els.discardedPanel.hidden = true;
    els.resultPanel.hidden = true;
    els.potentialPreview.hidden = true;
    els.handStatus.hidden = true;
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

  // Кан-доры в строке доры: базовой НЕТ, все 4 слота закрыты до полуночи;
  // за каждый кан дня — жёлтая обводка («откроется в конце дня», чей кан —
  // в подсказке). Открытые тайлы кан-дор игрок увидит завтра, в окне «Вчера».
  const pending = kanDoraPending();
  renderKanDoras(els.kanDoraWall, dailyContext.deadWall.kanDora.slice(0, MAX_KAN_DORA), 0, pending);

  // Таймер «до полуночи» виден только после того, как рука дня потрачена:
  // до генерации ждать нечего.
  els.dailyClock.hidden = !state.hand || state.hand.length === 0;

  // Кнопка генерации: видна ПОД рукой только до первой генерации дня
  // (во время анимации/восстановления — заблокирована).
  els.btnGenerate.hidden = state.phase !== 'waiting';
  els.btnGenerate.disabled = dealing || booting;

  // Предложение кана — только когда есть кан и фаза выбора
  if (state.phase === 'choose') refreshKanPrompt(state);
  else els.kanPrompt.hidden = true;

  // Заметка о полночном пересчёте (ура-дора и кан-доры откроются в 00:00 МСК)
  const hasScore = state.phase === 'result' || state.phase === 'complete';
  if (hasScore) {
    els.nightNote.hidden = false;
    els.nightNote.textContent =
      'В полночь (00:00 МСК) откроются ура-дора и кан-доры — очки и место в таблице могут вырасти. ' +
      'Загляните завтра: сначала откроется окно с вчерашней рукой, открывшимися дорами и новым счётом.';
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

// Таймер до полуночи МСК: тикает каждую секунду.
tickClock();
setInterval(tickClock, 1000);

els.btnGenerate.addEventListener('click', () => {
  void generateHand();
});
els.btnKan.addEventListener('click', () => declareKan());
els.btnKanSkip.addEventListener('click', () => skipKan());
els.btnReissue.addEventListener('click', () => {
  void reissueHand();
});

// Регистрация через Google и таблица дня (тихо деградируют, если сервер
// или client ID не настроены: игра работает как раньше).
initAuthButton(els.authSlot).then(renderAuthUser);
onAuthChange(renderAuthUser);
renderAuthUser();
// Логин ПОСЛЕ загрузки страницы (новое устройство / повторный вход):
// boot уже отработал без сессии — тянем руку дня с сервера. В UI ничего
// не меняем, если рука уже показана (она сверится при следующей перезагрузке).
onAuthChange((auth) => {
  if (!auth) return;
  const st = store.getState();
  if (st.daily) return; // рука уже на экране — не трогаем
  void syncDailyHandFromServer();
});
// Роль на сервере может измениться без повторного логина (hot-reload файла
// ролей) — при загрузке страницы подтягиваем актуальный профиль.
refreshMe();

// Инициализация в этом порядке ВАЖНА: если что-то здесь кинет исключение,
// всё, что ниже, не подключится (кнопки/окна перестанут работать).
initTestMode();
initRolesPanel();
initBugViewer();
initHandHistory();
// Контекст «сегодня» для просмотра рук из таблицы дня (у строк нет day_ctx).
setHandHistoryToday(dailyContext.dayKey, dailyContext);

initLeaderboard({
  listEl: els.leaderboard,
  panelEl: els.leaderboardPanel,
  dateLabel: els.lbDate,
  dayKey: dailyContext.dayKey,
  onRowClick: openLeaderboardHand,
}).then((refresh) => {
  refreshLeaderboard = refresh;
});

// Полноэкранное окно «Вчера»: показывается один раз в день, если вчера
// была рука (сервер уже пересчитал очки с открытыми дорами).
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
