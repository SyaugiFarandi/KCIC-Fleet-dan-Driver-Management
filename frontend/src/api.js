const API_BASE = '/api';
const TOKEN_KEY = 'fleet_token';
const USER_KEY = 'fleet_user';

let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, status = 0, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function storeSession(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export async function api(path, { method = 'GET', body, query, headers = {} } = {}) {
  const token = getToken();
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(API_BASE + path + buildQuery(query), {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server API. Pastikan backend berjalan.', 0);
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && token) {
      clearSession();
      unauthorizedHandler?.();
    }
    const details = Array.isArray(payload?.details)
      ? payload.details
          .map((detail) => (typeof detail === 'string' ? detail : detail?.message))
          .filter(Boolean)
      : [];
    throw new ApiError(payload?.error || `Permintaan gagal (HTTP ${response.status})`, response.status, details);
  }

  return payload;
}

export const apiGet = (path, query) => api(path, { query });
export const apiPost = (path, body) => api(path, { method: 'POST', body });
export const apiPatch = (path, body) => api(path, { method: 'PATCH', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });
