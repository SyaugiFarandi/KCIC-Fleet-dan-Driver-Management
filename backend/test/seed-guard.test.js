import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSeed(overrides = {}) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.ALLOW_DEMO_SEED;
  delete env.DATABASE_URL;
  Object.assign(env, overrides);
  return spawnSync(process.execPath, ['prisma/seed.js'], {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('demo seed refuses to run under production without explicit opt-in', () => {
  const res = runSeed({ NODE_ENV: 'production' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /ALLOW_DEMO_SEED=true/);
});

test('demo seed does not refuse in development', () => {
  // No DATABASE_URL: it may fail on connection, but never on the production guard.
  const res = runSeed({ NODE_ENV: 'development' });
  assert.doesNotMatch(res.stderr, /ALLOW_DEMO_SEED/);
});
