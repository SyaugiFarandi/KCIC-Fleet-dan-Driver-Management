import test from 'node:test';
import assert from 'node:assert/strict';

process.env.METRICS_TOKEN = 'observability-test-token-123456';

const { default: request } = await import('supertest');
const { app } = await import('./helpers.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('health returns structured checks and a generated request id', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.database, 'up');
  assert.match(res.headers['x-request-id'], UUID);
  assert.equal(res.body.checks.database.status, 'up');
  assert.ok(res.body.checks.gpsSimulator, 'simulator health is reported');
  assert.equal(res.body.checks.gpsSimulator.mode, 'DEMO_SIMULATOR');
  assert.equal(typeof res.body.uptimeSeconds, 'number');
});

test('incoming request id is echoed when safe and replaced when invalid', async () => {
  const safe = 'test-request-abc123';
  const ok = await request(app).get('/api/health').set('X-Request-Id', safe);
  assert.equal(ok.headers['x-request-id'], safe);

  const unsafe = await request(app).get('/api/health').set('X-Request-Id', 'bad id with spaces');
  assert.notEqual(unsafe.headers['x-request-id'], 'bad id with spaces');
  assert.match(unsafe.headers['x-request-id'], UUID);
});

test('metrics endpoint requires the configured token', async () => {
  const denied = await request(app).get('/api/metrics');
  assert.equal(denied.status, 401);

  const wrong = await request(app).get('/api/metrics').set('X-Metrics-Token', 'wrong-token-value-1234');
  assert.equal(wrong.status, 401);

  await request(app).get('/api/health');
  const ok = await request(app).get('/api/metrics').set('X-Metrics-Token', 'observability-test-token-123456');
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /text\/plain/);
  assert.match(ok.text, /fleet_http_requests_total\{method="GET",status="200"\}/);
  assert.match(ok.text, /fleet_gps_simulator_ticks_total/);
  assert.match(ok.text, /fleet_process_resident_memory_bytes/);
});
