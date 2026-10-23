/**
 * Верификация ID-токена Google (google-auth-library).
 * Токен приходит из фронтенда: Google Identity Services (кнопка «Войти через
 * Google») отдаёт JWT (response_type=token, callback → credential). Сервер
 * проверяет подпись (JWKS Google), срок, issuer и audience = наш client ID.
 */
import { OAuth2Client } from 'google-auth-library';

const ALLOWED_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Вернуть функцию verifyIdToken(idToken) -> profile {id, email, name, picture}. */
export function createGoogleVerifier(clientId) {
  const client = new OAuth2Client(clientId);
  return async function verifyIdToken(idToken) {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const p = ticket.getPayload();
    if (!ALLOWED_ISSUERS.has(p.iss)) {
      throw new Error(`недопустимый issuer: ${p.iss}`);
    }
    if (!p.sub) {
      throw new Error('в токене нет sub');
    }
    return {
      id: p.sub,
      email: p.email ?? null,
      name: p.name || p.email || 'Игрок',
      picture: p.picture ?? null,
    };
  };
}
