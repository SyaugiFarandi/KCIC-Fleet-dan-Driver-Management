import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app, bearer, tokenFor, makeBooking, approveBooking, cancelBooking, futureIso } from './helpers.js';

const prisma = new PrismaClient();

before(async () => {
  const now = Date.now();
  await prisma.vehicleLocation.deleteMany({ where: { vehicleId: { in: ['veh_t1', 'veh_t2', 'veh_t3'] } } });
  await prisma.vehicleLocation.createMany({
    data: [
      { id: 'loc_t1_latest', vehicleId: 'veh_t1', deviceId: 'gpsdev_t1', lat: -6.2501, lng: 106.9001, speedKph: 45, heading: 120, recordedAt: new Date(now - 5_000) },
      { id: 'loc_t1_prev', vehicleId: 'veh_t1', deviceId: 'gpsdev_t1', lat: -6.2515, lng: 106.9015, speedKph: 30, heading: 120, recordedAt: new Date(now - 65_000) },
      { id: 'loc_t2_latest', vehicleId: 'veh_t2', deviceId: 'gpsdev_t2', lat: -6.3001, lng: 106.9501, speedKph: 0, heading: 0, recordedAt: new Date(now - 5_000) },
      { id: 'loc_t3_stale', vehicleId: 'veh_t3', deviceId: 'gpsdev_t3', lat: -6.8436, lng: 107.4822, speedKph: 40, heading: 90, recordedAt: new Date(now - 10 * 60_000) },
    ],
  });
});

after(async () => {
  await prisma.$disconnect();
});

test('GPS endpoints are restricted to staff roles', async () => {
  for (const email of ['driver@demo.local', 'employee@demo.local']) {
    const token = await tokenFor(email);
    const res = await request(app).get('/api/gps/positions').set(bearer(token));
    assert.equal(res.status, 403, `${email} must not read fleet positions`);
  }
  const staff = await tokenFor('maintenance@demo.local');
  const res = await request(app).get('/api/gps/positions').set(bearer(staff));
  assert.equal(res.status, 200);
});

test('positions derive motion status from the latest coordinates', async () => {
  const token = await tokenFor();
  const res = await request(app).get('/api/gps/positions').set(bearer(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'DEMO_SIMULATOR');
  assert.match(res.body.disclaimer, /simulator/i);

  const byId = Object.fromEntries(res.body.items.map((item) => [item.id, item]));
  assert.equal(byId.veh_t1.motionStatus, 'MOVING');
  assert.equal(byId.veh_t2.motionStatus, 'STOPPED');
  assert.equal(byId.veh_t3.motionStatus, 'OFFLINE');
  assert.equal(byId.veh_t4.motionStatus, 'OFFLINE');
  assert.equal(byId.veh_t1.location.speedKph, 45);
  assert.equal(byId.veh_t1.device.imei, 'TESTIMEI000001');
  assert.equal(byId.veh_t4.device, null);

  const { counts } = res.body;
  assert.equal(counts.total, 4);
  assert.equal(counts.moving, 1);
  assert.equal(counts.stopped, 1);
  assert.equal(counts.offline, 2);
  assert.equal(counts.withDevice, 3);
  assert.equal(counts.moving + counts.stopped + counts.offline, counts.total);
});

test('positions filter by status, ownership, search and driver, and replay works', async () => {
  const admin = await tokenFor();
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const moving = await request(app).get('/api/gps/positions?status=MOVING').set(bearer(admin));
  assert.equal(moving.status, 200);
  assert.ok(moving.body.items.length > 0);
  assert.ok(moving.body.items.every((item) => item.motionStatus === 'MOVING'));

  const vendor = await request(app).get('/api/gps/positions?ownership=VENDOR').set(bearer(admin));
  assert.equal(vendor.status, 200);
  assert.deepEqual(vendor.body.items.map((item) => item.id), ['veh_t2']);
  assert.equal(vendor.body.counts.total, 4);

  const search = await request(app).get('/api/gps/positions?q=TEST-0001').set(bearer(admin));
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.items.map((item) => item.id), ['veh_t1']);
  assert.equal(search.body.totalFiltered, 1);

  const none = await request(app).get('/api/gps/positions?status=MOVING&ownership=VENDOR').set(bearer(admin));
  assert.equal(none.status, 200);
  assert.equal(none.body.items.length, 0);

  const booking = await makeBooking(employee, { departureAt: futureIso(48), passengerCount: 1 });
  assert.equal(booking.status, 201);
  assert.equal((await approveBooking(fleet, booking.body.id)).status, 200);
  const trip = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: booking.body.id, vehicleId: 'veh_t4', driverId: 'drv_t2' });
  assert.equal(trip.status, 201);

  const byDriver = await request(app).get('/api/gps/positions?driverId=drv_t2').set(bearer(admin));
  assert.equal(byDriver.status, 200);
  const tracked = byDriver.body.items.find((item) => item.id === 'veh_t4');
  assert.ok(tracked, 'vehicle with active trip must appear in driver filter');
  assert.equal(tracked.driver.id, 'drv_t2');
  assert.equal(tracked.destination, 'Kantor Pusat');
  assert.equal(tracked.trip.code, booking.body.code);

  const replay = await request(app).get(`/api/gps/trips/${trip.body.id}/replay`).set(bearer(dispatcher));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.trip.id, trip.body.id);
  assert.equal(replay.body.trip.vehicle.id, 'veh_t4');
  assert.ok(Array.isArray(replay.body.points));
  assert.equal(replay.body.source, 'DEMO_SIMULATOR');

  const missingReplay = await request(app).get('/api/gps/trips/trip_missing/replay').set(bearer(dispatcher));
  assert.equal(missingReplay.status, 404);

  await cancelBooking(fleet, booking.body.id, 'cleanup GPS test');
});

test('vehicle detail returns device, latest location, events and trips', async () => {
  const token = await tokenFor();
  const res = await request(app).get('/api/gps/vehicles/veh_t1').set(bearer(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.vehicle.plateNumber, 'TEST-0001');
  assert.equal(res.body.device.imei, 'TESTIMEI000001');
  assert.equal(res.body.location.id, 'loc_t1_latest');
  assert.equal(res.body.motionStatus, 'MOVING');
  assert.ok(res.body.events.some((event) => event.id === 'gps_evt_t1' && event.geofence?.name === 'TEST Stasiun Halim'));
  assert.ok(Array.isArray(res.body.trips));
  assert.equal(res.body.source, 'DEMO_SIMULATOR');

  const missing = await request(app).get('/api/gps/vehicles/veh_missing').set(bearer(token));
  assert.equal(missing.status, 404);
});

test('coordinate history is bounded and chronological', async () => {
  const token = await tokenFor();
  const res = await request(app).get('/api/gps/vehicles/veh_t1/history').set(bearer(token));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((point) => point.id), ['loc_t1_prev', 'loc_t1_latest']);
  assert.ok(new Date(res.body.items[0].recordedAt) < new Date(res.body.items[1].recordedAt));

  const limited = await request(app).get('/api/gps/vehicles/veh_t1/history?limit=1').set(bearer(token));
  assert.equal(limited.status, 200);
  assert.equal(limited.body.items.length, 1);
  assert.equal(limited.body.items[0].id, 'loc_t1_latest');

  const invalid = await request(app).get('/api/gps/vehicles/veh_t1/history?from=not-a-date').set(bearer(token));
  assert.equal(invalid.status, 400);
});

test('GPS events paginate and filter by type and vehicle', async () => {
  const token = await tokenFor();
  const all = await request(app).get('/api/gps/events').set(bearer(token));
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 2);
  assert.ok(all.body.labels.OVERSPEED);
  assert.equal(all.body.source, 'DEMO_SIMULATOR');

  const overspeed = await request(app).get('/api/gps/events?type=OVERSPEED').set(bearer(token));
  assert.equal(overspeed.status, 200);
  assert.ok(overspeed.body.items.length > 0);
  assert.ok(overspeed.body.items.every((event) => event.type === 'OVERSPEED'));
  assert.ok(overspeed.body.items.some((event) => event.id === 'gps_evt_t1'));

  const byVehicle = await request(app).get('/api/gps/events?vehicleId=veh_t2').set(bearer(token));
  assert.equal(byVehicle.status, 200);
  assert.deepEqual(byVehicle.body.items.map((event) => event.id), ['gps_evt_t2']);

  const byText = await request(app).get('/api/gps/events?q=idle').set(bearer(token));
  assert.equal(byText.status, 200);
  assert.ok(byText.body.items.some((event) => event.id === 'gps_evt_t2'));
});

test('geofence CRUD validates input, audits changes and blocks non-writers', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const admin = await tokenFor();
  const driver = await tokenFor('driver@demo.local');

  const forbidden = await request(app)
    .post('/api/gps/geofences')
    .set(bearer(driver))
    .send({ name: 'Nope', centerLat: -6.2, centerLng: 106.8, radiusM: 100 });
  assert.equal(forbidden.status, 403);

  const invalid = await request(app)
    .post('/api/gps/geofences')
    .set(bearer(fleet))
    .send({ name: 'TEST Radius Kecil', centerLat: -6.2, centerLng: 106.8, radiusM: 10 });
  assert.equal(invalid.status, 400);

  const duplicate = await request(app)
    .post('/api/gps/geofences')
    .set(bearer(fleet))
    .send({ name: 'TEST Stasiun Halim', centerLat: -6.2, centerLng: 106.8, radiusM: 500 });
  assert.equal(duplicate.status, 409);

  const created = await request(app)
    .post('/api/gps/geofences')
    .set(bearer(fleet))
    .send({ name: 'TEST Geofence QA', category: 'ZONE', centerLat: -6.3, centerLng: 106.9, radiusM: 800, notes: 'Zona pengujian' });
  assert.equal(created.status, 201);
  assert.equal(created.body.radiusM, 800);

  const list = await request(app).get('/api/gps/geofences').set(bearer(admin));
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((item) => item.id === created.body.id));

  const updated = await request(app)
    .patch(`/api/gps/geofences/${created.body.id}`)
    .set(bearer(fleet))
    .send({ radiusM: 900, active: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.radiusM, 900);
  assert.equal(updated.body.active, false);

  const removed = await request(app).delete(`/api/gps/geofences/${created.body.id}`).set(bearer(fleet));
  assert.equal(removed.status, 200);
  const afterDelete = await request(app).delete(`/api/gps/geofences/${created.body.id}`).set(bearer(fleet));
  assert.equal(afterDelete.status, 404);

  const audit = await request(app).get('/api/audit?pageSize=200').set(bearer(admin));
  const actions = audit.body.items.map((entry) => entry.action);
  assert.ok(actions.includes('GEOFENCE_CREATE'));
  assert.ok(actions.includes('GEOFENCE_UPDATE'));
  assert.ok(actions.includes('GEOFENCE_DELETE'));
});

test('GPS device CRUD enforces one device per vehicle and unique IMEI', async () => {
  const admin = await tokenFor();
  const officer = await tokenFor('fleetofficer@demo.local');
  const maintenance = await tokenFor('maintenance@demo.local');
  const suffix = Date.now().toString().slice(-7);

  const vehicleA = await request(app)
    .post('/api/vehicles')
    .set(bearer(admin))
    .send({ plateNumber: `GPS-A-${suffix}`, brand: 'Toyota', model: 'Test', category: 'MPV', capacity: 4 });
  const vehicleB = await request(app)
    .post('/api/vehicles')
    .set(bearer(admin))
    .send({ plateNumber: `GPS-B-${suffix}`, brand: 'Toyota', model: 'Test', category: 'MPV', capacity: 4 });
  assert.equal(vehicleA.status, 201);
  assert.equal(vehicleB.status, 201);

  const forbidden = await request(app)
    .post('/api/gps/devices')
    .set(bearer(maintenance))
    .send({ imei: `QA${suffix}`, vehicleId: vehicleA.body.id });
  assert.equal(forbidden.status, 403);

  const invalid = await request(app)
    .post('/api/gps/devices')
    .set(bearer(officer))
    .send({ imei: '!!', vehicleId: vehicleA.body.id });
  assert.equal(invalid.status, 400);

  const created = await request(app)
    .post('/api/gps/devices')
    .set(bearer(officer))
    .send({ imei: `QAIMEI${suffix}`, vehicleId: vehicleA.body.id, simNumber: '0817-QA-0001' });
  assert.equal(created.status, 201);
  assert.equal(created.body.provider, 'DEMO_SIMULATOR');

  const duplicateImei = await request(app)
    .post('/api/gps/devices')
    .set(bearer(officer))
    .send({ imei: `QAIMEI${suffix}`, vehicleId: vehicleB.body.id });
  assert.equal(duplicateImei.status, 409);

  const duplicateVehicle = await request(app)
    .post('/api/gps/devices')
    .set(bearer(officer))
    .send({ imei: `QAIMEI2${suffix}`, vehicleId: vehicleA.body.id });
  assert.equal(duplicateVehicle.status, 409);

  const updated = await request(app)
    .patch(`/api/gps/devices/${created.body.id}`)
    .set(bearer(officer))
    .send({ status: 'INACTIVE' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'INACTIVE');

  const removed = await request(app).delete(`/api/gps/devices/${created.body.id}`).set(bearer(officer));
  assert.equal(removed.status, 200);

  const audit = await request(app).get('/api/audit?pageSize=200').set(bearer(admin));
  assert.ok(audit.body.items.some((entry) => entry.action === 'GPS_DEVICE_CREATE'));

  assert.equal((await request(app).delete(`/api/vehicles/${vehicleA.body.id}`).set(bearer(admin))).status, 200);
  assert.equal((await request(app).delete(`/api/vehicles/${vehicleB.body.id}`).set(bearer(admin))).status, 200);
});
