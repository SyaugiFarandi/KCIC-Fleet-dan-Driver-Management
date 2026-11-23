import { config } from '../config.js';

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|jwt|api[-_]?key/i;
const MAX_STRING = 500;

function scrub(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrub(item, depth + 1);
  }
  return out;
}

function emit(level, message, meta = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'fleet-api',
    env: config.env,
    message,
    ...scrub(meta),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
};
