import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor } from './helpers.js';

test('ingest endpoint stays hidden while GPS_INGEST_TOKEN is unset', async () => {
  const res = await request(app)
    .post('/api/gps/ingest')
    .set('x-gps-token', 'any-token-value-123456')
    .send({ imei: 'TESTIMEI000001', lat: -6.25, lng: 106.9 });
  assert.equal(res.status, 404);
});

test('positions report simulator-only telemetry when no provider is configured', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const res = await request(app).get('/api/gps/positions').set(bearer(fleet));
  assert.equal(res.status, 200);
  assert.equal(res.body.telemetry.ingestEnabled, false);
  assert.equal(res.body.telemetry.provider, 'DEMO_SIMULATOR');
  assert.equal(res.body.telemetry.simulatorEnabled, false);
  assert.deepEqual(res.body.telemetry.modes, ['SIMULATED', 'LIVE', 'STALE', 'OFFLINE']);
});
