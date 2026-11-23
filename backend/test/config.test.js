import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRONG_SECRET = 'T3st-Only-Str0ng-Secret-For-Config-Guard-9xQz';

function runGuard(overrides = {}) {
  const env = { ...process.env };
  for (const key of [
    'NODE_ENV',
    'JWT_SECRET',
    'COOKIE_SECURE',
    'ALLOW_INSECURE_HTTP',
    'CORS_ORIGIN',
    'JWT_EXPIRES_IN',
    'METRICS_TOKEN',
    'GPS_INGEST_TOKEN',
    'EMAIL_NOTIFICATIONS_ENABLED',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'EMAIL_FROM',
    'TELEGRAM_NOTIFICATIONS_ENABLED',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'NOTIFICATION_RETRY_BASE_MS',
  ]) {
    delete env[key];
  }
  Object.assign(env, overrides);
  return spawnSync(
    process.execPath,
    ['-e', "import('./src/config.js').then((m) => { m.assertProductionConfig(); console.log('CONFIG_OK'); })"],
    { cwd: backendRoot, env, encoding: 'utf8' }
  );
}

test('production guard rejects missing JWT_SECRET', () => {
  const res = runGuard({ NODE_ENV: 'production', ALLOW_INSECURE_HTTP: 'true' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /JWT_SECRET wajib di-set/);
});

test('production guard rejects short, placeholder, and low-entropy secrets', () => {
  for (const secret of ['short-secret', 'replace-this-demo-secret-before-deployment', 'a'.repeat(64)]) {
    const res = runGuard({ NODE_ENV: 'production', JWT_SECRET: secret, ALLOW_INSECURE_HTTP: 'true' });
    assert.notEqual(res.status, 0, `expected rejection for ${secret.slice(0, 12)}...`);
    assert.match(res.stderr, /JWT_SECRET/, 'error must name the variable');
    assert.equal(res.stdout.includes(secret), false, 'secret value must not be printed to stdout');
    assert.equal(res.stderr.includes(secret), false, 'secret value must not be printed to stderr');
  }
});

test('production guard accepts a strong secret and defaults cookie Secure', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    CORS_ORIGIN: 'https://fleet.example.test',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /CONFIG_OK/);
});

test('production guard blocks insecure cookies without explicit demo opt-in', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    COOKIE_SECURE: 'false',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /COOKIE_SECURE=false tidak diizinkan/);
});

test('production guard allows insecure cookies only with explicit ALLOW_INSECURE_HTTP', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    COOKIE_SECURE: 'false',
    ALLOW_INSECURE_HTTP: 'true',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /Mode demo HTTP/);
});

test('production guard rejects wildcard CORS origin', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    CORS_ORIGIN: '*',
    ALLOW_INSECURE_HTTP: 'true',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /CORS_ORIGIN/);
});

test('production guard rejects short GPS_INGEST_TOKEN', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    ALLOW_INSECURE_HTTP: 'true',
    GPS_INGEST_TOKEN: 'short-token',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /GPS_INGEST_TOKEN/);
});

test('production guard rejects enabled email notifications without SMTP config', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    ALLOW_INSECURE_HTTP: 'true',
    EMAIL_NOTIFICATIONS_ENABLED: 'true',
    EMAIL_FROM: 'fleet@example.test',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /SMTP_HOST/);
});

test('production guard rejects enabled Telegram notifications without credentials', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    ALLOW_INSECURE_HTTP: 'true',
    TELEGRAM_NOTIFICATIONS_ENABLED: 'true',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /TELEGRAM_BOT_TOKEN/);
});

test('production guard accepts configured GPS ingest and notification channels', () => {
  const res = runGuard({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    ALLOW_INSECURE_HTTP: 'true',
    GPS_INGEST_TOKEN: 'ingest-token-strong-1234567890',
    EMAIL_NOTIFICATIONS_ENABLED: 'true',
    SMTP_HOST: 'smtp.example.test',
    EMAIL_FROM: 'fleet@example.test',
    TELEGRAM_NOTIFICATIONS_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456:example-bot-token',
    TELEGRAM_CHAT_ID: '-1001234567890',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /CONFIG_OK/);
});

test('development and test environments do not require production guards', () => {
  const res = runGuard({ NODE_ENV: 'test' });
  assert.equal(res.status, 0, res.stderr);
});
