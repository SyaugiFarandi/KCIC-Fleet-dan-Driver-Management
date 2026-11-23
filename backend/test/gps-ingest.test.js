process.env.GPS_INGEST_TOKEN = 'gps-ingest-test-token-123456';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

const { app, bearer, tokenFor } = await import('./helpers.js');
const prisma = new PrismaClient();
const createdLocationIds = [];

after(async () => {
  if (createdLocationIds.length) {
    await prisma.vehicleLocation.deleteMany({ where: { id: { in: createdLocationIds } } });
  }
  await prisma.gpsDevice.update({ where: { id: 'gpsdev_t3' }, data: { status: 'ACTIVE' } }).catch(() => {});
  await prisma.$disconnect();
});

function postTelemetry(payload, token = 'gps-ingest-test-token-123456') {
  const req = request(app).post('/api/gps/ingest');
  if (token !== null) req.set('x-gps-token', token);
  return req.send(payload);
}

const validPayload = () => ({
  imei: 'TESTIMEI000001',
  lat: -6.2501,
  lng: 106.9001,
  speedKph: 0,
  heading: 90,
  ignition: true,
  accuracyM: 8,
});

test('ingest endpoint rejects missing and invalid tokens', async () => {
  const missing = await postTelemetry(validPayload(), null);
  assert.equal(missing.status, 401);
  const wrong = await postTelemetry(validPayload(), 'wrong-token-000000');
  assert.equal(wrong.status, 401);
});

test('ingest endpoint validates payload and device registration', async () => {
  const badLat = await postTelemetry({ ...validPayload(), lat: 999 });
  assert.equal(badLat.status, 400);

  const unknown = await postTelemetry({ ...validPayload(), imei: 'IMEI-NOT-REGISTERED' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /tidak terdaftar/i);

  const future = await postTelemetry({ ...validPayload(), recordedAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
  assert.equal(future.status, 400);

  const tooOld = await postTelemetry({ ...validPayload(), recordedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
  assert.equal(tooOld.status, 400);
});

test('ingest endpoint rejects inactive devices', async () => {
  await prisma.gpsDevice.update({ where: { id: 'gpsdev_t3' }, data: { status: 'INACTIVE' } });
  const res = await postTelemetry({ ...validPayload(), imei: 'TESTIMEI000003' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /tidak aktif/i);
  await prisma.gpsDevice.update({ where: { id: 'gpsdev_t3' }, data: { status: 'ACTIVE' } });
});

test('ingested telemetry becomes the latest LIVE position when configured', async () => {
  const res = await postTelemetry({ ...validPayload(), speedKph: 32 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.telemetryStatus, 'LIVE');
  assert.equal(res.body.vehicleId, 'veh_t1');
  createdLocationIds.push(res.body.locationId);

  const fleet = await tokenFor('fleet@demo.local');
  const positions = await request(app).get('/api/gps/positions').set(bearer(fleet));
  assert.equal(positions.status, 200);
  assert.equal(positions.body.source, 'DEMO_SIMULATOR');
  assert.equal(positions.body.telemetry.ingestEnabled, true);
  assert.equal(positions.body.telemetry.provider, 'DEVICE_WEBHOOK');
  assert.deepEqual(positions.body.telemetry.modes, ['SIMULATED', 'LIVE', 'STALE', 'OFFLINE']);

  const vehicle = positions.body.items.find((item) => item.id === 'veh_t1');
  assert.equal(vehicle.telemetryStatus, 'LIVE');
  assert.equal(vehicle.location.source, 'DEVICE');
  assert.ok(positions.body.counts.live >= 1);

  const detail = await request(app).get('/api/gps/vehicles/veh_t1').set(bearer(fleet));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.telemetryStatus, 'LIVE');
  assert.equal(detail.body.source, 'DEMO_SIMULATOR');
});
