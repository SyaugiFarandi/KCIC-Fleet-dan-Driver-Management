const API_BASE = '/api';
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

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function storeUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function clearSession() {
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

function errorDetails(payload) {
  return Array.isArray(payload?.details)
    ? payload.details.map((detail) => (typeof detail === 'string' ? detail : detail?.message)).filter(Boolean)
    : [];
}

export async function api(path, { method = 'GET', body, query, headers = {}, suppressAuthError = false } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(API_BASE + path + buildQuery(query), {
      method,
      headers: requestHeaders,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server API. Periksa koneksi atau pastikan backend berjalan.', 0);
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && !suppressAuthError && path !== '/auth/login') {
      clearSession();
      unauthorizedHandler?.();
    }
    throw new ApiError(payload?.error || `Permintaan gagal (HTTP ${response.status})`, response.status, errorDetails(payload));
  }

  return payload;
}

export const apiGet = (path, query) => api(path, { query });
export const apiPost = (path, body) => api(path, { method: 'POST', body });
export const apiPatch = (path, body) => api(path, { method: 'PATCH', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });

export async function downloadFile(path, query) {
  let response;
  try {
    response = await fetch(API_BASE + path + buildQuery(query), { credentials: 'include' });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server API.', 0);
  }
  if (!response.ok) {
    let message = `Ekspor gagal (HTTP ${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      /* keep default message */
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = match?.[1] || path.split('/').pop() || 'unduhan';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return anchor.download;
}
