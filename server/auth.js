/**
 * Сессии сервера: JWT HS256 на чистом node:crypto (без jsonwebtoken).
 * Токен живёт 30 дней; расшифровка не нужна — весь профиль дублируем в payload.
 */
import crypto from 'node:crypto';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Подписать сессионный токен для пользователя (из Google ID-токена). */
export function signSession(profile, secret, ttlSec = 30 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    sub: profile.id,
    email: profile.email,
    name: profile.name,
    iat: now,
    exp: now + ttlSec,
  });
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Проверить сессионный токен; вернёт payload или null. */
export function verifySession(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return payload;
}
