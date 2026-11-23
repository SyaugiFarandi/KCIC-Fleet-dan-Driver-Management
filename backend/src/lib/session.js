import { config } from '../config.js';

export const SESSION_COOKIE = 'fleet_session';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.env === 'production',
  path: '/',
};

export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: 12 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

export function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return readCookie(req, SESSION_COOKIE);
}
