/**
 * Регистрация через Google (Google Identity Services) + API таблицы дня.
 *
 * Как работает:
 *  1. Страница подгружает скрипт Google (accounts.google.com/gsi/client) и
 *     рендерит кнопку «Войти через Google» (initAuthButton).
 *  2. По клику Google отдаёт ID-токен (JWT) в callback — редиректов нет,
 *     всё работает со статической страницы (GitHub Pages/Vercel/Netlify).
 *  3. Токен уходит на наш сервер POST /api/auth/login; сервер проверяет
 *     подпись/issuer/audience (google-auth-library) и отдаёт сессию (JWT 30 дней).
 *  4. Сессия лежит в localStorage; каждый запрос API — с заголовком Bearer.
 *
 * Если AUTH_CONFIG.googleClientId пустой — функция полностью выключена
 * (кнопка не показывается, игра работает как раньше).
 */
import { AUTH_CONFIG } from './config.js';

const LS_KEY = 'mh_auth_v1';
const listeners = new Set();

let auth = loadStored();

/** Сессия из localStorage (проверяем срок — токен 30 дней). */
function loadStored() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.token || !data?.user) return null;
    if (isExpired(data.token)) return null;
    return data;
  } catch {
    return null;
  }
}

function isExpired(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function setAuth(data) {
  auth = data;
  if (data) localStorage.setItem(LS_KEY, JSON.stringify(data));
  else localStorage.removeItem(LS_KEY);
  listeners.forEach((fn) => fn(auth));
}

/** Подписка на изменение сессии; сразу вызывает fn с текущей. */
export function onAuthChange(fn) {
  listeners.add(fn);
  fn(auth);
  return () => listeners.delete(fn);
}

/** Текущая сессия {token, user} или null. */
export function getAuth() {
  return auth;
}

/** Роль: 'admin' | 'test' | 'player' (user.role с сервера; по умолчанию player). */
export function getRole() {
  return auth?.user?.role ?? 'player';
}

/** Кому доступен тестовый режим: admin и test. */
export function canTestMode() {
  return getRole() === 'admin' || getRole() === 'test';
}

/** Обновить профиль/роль с сервера (роль — hot-reload, без повторного логина). */
export async function refreshMe() {
  if (!auth?.token) return null;
  try {
    const data = await api('/api/me');
    setAuth({ token: auth.token, user: { ...auth.user, ...data.user } });
    return data.user;
  } catch {
    return null; // сервер недоступен — играем с последней известной ролью
  }
}

/** Панель ролей (admin): {admin: [email], test: [email]}. */
export function fetchRoles() {
  return api('/api/roles');
}

/** Установить роль email: 'admin' | 'test' | 'player' (admin). */
export function setUserRole(email, role) {
  return api('/api/roles', { method: 'POST', body: { email, role } });
}

/** Включена ли функция (задан client ID). */
export function isAuthAvailable() {
  return Boolean(AUTH_CONFIG?.googleClientId);
}

const gisReady = new Promise((resolve) => {
  if (typeof window === 'undefined') return resolve(null);
  if (window.google?.accounts?.id) return resolve(window.google);
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = () => resolve(window.google);
  s.onerror = () => resolve(null);
  document.head.appendChild(s);
});

/**
 * Отрендерить кнопку входа в slotEl. Вызывать один раз на страницу.
 * Возвращает false, если функция выключена или скрипт Google не загрузился
 * (например, офлайн) — игра от этого не страдает.
 */
export async function initAuthButton(slotEl) {
  if (!isAuthAvailable()) return false;
  const g = await gisReady;
  if (!g?.accounts?.id) return false;
  g.accounts.id.initialize({
    client_id: AUTH_CONFIG.googleClientId,
    callback: (resp) => loginWithToken(resp.credential).catch(() => {}),
    use_prompt: 'select_account',
  });
  g.accounts.id.renderButton(slotEl, {
    theme: 'outline',
    size: 'medium',
    text: 'signin_with',
    shape: 'pill',
    width: 200,
    locale: 'ru',
  });
  return true;
}

/** Выйти: просто чистим сессию (кнопка Google остаётся). */
export function logout() {
  setAuth(null);
}

/**
 * Обёртка над fetch: baseUrl из конфига, JSON, Bearer-токен при наличии.
 * Кидает Error с человекочитаемым сообщением (data.error) при статусе >= 400.
 */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${AUTH_CONFIG.apiBaseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth?.token ? { authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Войти по ID-токену Google (из кнопки). Возвращает профиль user. */
export async function loginWithToken(idToken) {
  const data = await api('/api/auth/login', { method: 'POST', body: { idToken } });
  setAuth({ token: data.token, user: data.user });
  return data.user;
}

/**
 * Записать результат дня на сервер (там хранится ЛУЧШИЙ по user+date).
 * @returns {{score:number, isBest:boolean, rank:number}}
 */
export function submitScore(dayKey, score, { discarded, tiles } = {}) {
  return api('/api/scores', {
    method: 'POST',
    body: { date: dayKey, score, discarded, tiles },
  });
}

/** Таблица дня (публичная): {date, rows:[{id?, name, picture, score, discarded}]}. */
export function fetchLeaderboard(dayKey, limit = 10) {
  return api(`/api/scores/${dayKey}?limit=${limit}`);
}
