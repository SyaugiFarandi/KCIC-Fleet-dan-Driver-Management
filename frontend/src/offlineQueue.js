import { api } from './api.js';

const KEY = 'fleet_offline_queue';
const EVENT = 'fleet:queue-change';

export function readQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function enqueue({ label, method = 'POST', path, body }) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    method,
    path,
    body,
    createdAt: new Date().toISOString(),
  };
  writeQueue([...readQueue(), item]);
  return item;
}

export function removeQueueItem(id) {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

export function subscribeQueue(handler) {
  const onChange = () => handler(readQueue());
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export async function flushQueue() {
  const items = readQueue();
  const summary = { ok: 0, conflict: 0, failed: 0, messages: [] };
  for (const item of items) {
    try {
      await api(item.path, { method: item.method, body: item.body });
      removeQueueItem(item.id);
      summary.ok += 1;
    } catch (err) {
      if (!err.status || err.status === 401) break;
      if (err.status === 404 || err.status === 409) {
        removeQueueItem(item.id);
        summary.conflict += 1;
        summary.messages.push(`${item.label}: ${err.message}`);
      } else {
        removeQueueItem(item.id);
        summary.failed += 1;
        summary.messages.push(`${item.label}: ${err.message}`);
      }
    }
  }
  summary.remaining = readQueue().length;
  return summary;
}
