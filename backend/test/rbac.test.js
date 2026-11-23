import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, makeBooking, futureIso } from './helpers.js';

test('crew employee cannot read fleet master data', async () => {
  const token = await tokenFor('employee@demo.local');
  for (const path of ['/api/vehicles', '/api/drivers', '/api/vendors', '/api/routes', '/api/maintenance']) {
    const res = await request(app).get(path).set(bearer(token));
    assert.equal(res.status, 403, `${path} should be forbidden for crew employee`);
  }
});

test('crew employee cannot list all trips or use audit log', async () => {
  const token = await tokenFor('employee@demo.local');
  const trips = await request(app).get('/api/trips').set(bearer(token));
  assert.equal(trips.status, 403);
  const audit = await request(app).get('/api/audit').set(bearer(token));
  assert.equal(audit.status, 403);
});

test('driver cannot access driver master data or fleet vehicles', async () => {
  const token = await tokenFor('driver@demo.local');
  const drivers = await request(app).get('/api/drivers').set(bearer(token));
  assert.equal(drivers.status, 403);
  const vehicles = await request(app).get('/api/vehicles').set(bearer(token));
  assert.equal(vehicles.status, 403);
  const users = await request(app).get('/api/users').set(bearer(token));
  assert.equal(users.status, 403);
});

test('dispatcher cannot read audit log or manage users', async () => {
  const token = await tokenFor('dispatch@demo.local');
  const audit = await request(app).get('/api/audit').set(bearer(token));
  assert.equal(audit.status, 403);
  const users = await request(app).get('/api/users').set(bearer(token));
  assert.equal(users.status, 403);
  const createUser = await request(app)
    .post('/api/users')
    .set(bearer(token))
    .send({ name: 'Nope', email: `nope-${Date.now()}@demo.local`, password: 'Demo123!', role: 'CREW_EMPLOYEE' });
  assert.equal(createUser.status, 403);
});

test('fleet manager cannot manage users but can delete unused vehicles', async () => {
  const token = await tokenFor('fleet@demo.local');
  const users = await request(app).get('/api/users').set(bearer(token));
  assert.equal(users.status, 403);

  const created = await request(app)
    .post('/api/vehicles')
    .set(bearer(token))
    .send({ plateNumber: `FLT-${Date.now().toString().slice(-7)}`, brand: 'Toyota', model: 'Test', category: 'MPV', capacity: 4 });
  assert.equal(created.status, 201);
  const del = await request(app).delete(`/api/vehicles/${created.body.id}`).set(bearer(token));
  assert.equal(del.status, 200);
});

test('maintenance officer cannot create vehicles but can read maintenance', async () => {
  const token = await tokenFor('maintenance@demo.local');
  const create = await request(app)
    .post('/api/vehicles')
    .set(bearer(token))
    .send({ plateNumber: 'NOPE-1', brand: 'X', model: 'Y', category: 'MPV', capacity: 4 });
  assert.equal(create.status, 403);
  const list = await request(app).get('/api/maintenance').set(bearer(token));
  assert.equal(list.status, 200);
});

test('driver coordinator can create drivers but not vehicles', async () => {
  const token = await tokenFor('drivercoord@demo.local');
  const driver = await request(app)
    .post('/api/drivers')
    .set(bearer(token))
    .send({ name: 'Driver RBAC', phone: '0812-9999', licenseNumber: `SIM-RBAC-${Date.now()}`, licenseExpiry: '2030-01-01', type: 'INTERNAL' });
  assert.equal(driver.status, 201);
  const removed = await request(app).delete(`/api/drivers/${driver.body.id}`).set(bearer(token));
  assert.equal(removed.status, 403);

  const vehicle = await request(app)
    .post('/api/vehicles')
    .set(bearer(token))
    .send({ plateNumber: 'NOPE-2', brand: 'X', model: 'Y', category: 'MPV', capacity: 4 });
  assert.equal(vehicle.status, 403);
});

test('employee can create booking but cannot approve it', async () => {
  const employee = await tokenFor('employee@demo.local');
  const created = await makeBooking(employee, { departureAt: futureIso(60) });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'PENDING');

  const approve = await request(app)
    .patch(`/api/bookings/${created.body.id}/decision`)
    .set(bearer(employee))
    .send({ decision: 'APPROVED' });
  assert.equal(approve.status, 403);

  const cleanup = await request(app)
    .patch(`/api/bookings/${created.body.id}/cancel`)
    .set(bearer(employee))
    .send({ reason: 'RBAC test cleanup' });
  assert.equal(cleanup.status, 200);
});

test('employee only sees own bookings and cannot read others', async () => {
  const employee = await tokenFor('employee@demo.local');
  const other = await tokenFor('employee2@demo.local');
  const otherBooking = await makeBooking(other, { departureAt: futureIso(72) });
  assert.equal(otherBooking.status, 201);
  const ownBooking = await makeBooking(employee, { departureAt: futureIso(74) });
  assert.equal(ownBooking.status, 201);

  const list = await request(app).get('/api/bookings').set(bearer(employee));
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0);
  assert.ok(list.body.items.every((b) => b.requesterId === 'test_employee'));
  assert.ok(!list.body.items.some((b) => b.id === otherBooking.body.id));

  const detail = await request(app).get(`/api/bookings/${otherBooking.body.id}`).set(bearer(employee));
  assert.equal(detail.status, 403);

  await request(app).patch(`/api/bookings/${otherBooking.body.id}/cancel`).set(bearer(other)).send({ reason: 'cleanup' });
  await request(app).patch(`/api/bookings/${ownBooking.body.id}/cancel`).set(bearer(employee)).send({ reason: 'cleanup' });
});

test('driver cannot assign trips', async () => {
  const token = await tokenFor('driver@demo.local');
  const res = await request(app)
    .post('/api/trips')
    .set(bearer(token))
    .send({ bookingId: 'x', vehicleId: 'y', driverId: 'z' });
  assert.equal(res.status, 403);
});

test('booking form options are available to all authenticated roles', async () => {
  const employee = await tokenFor('employee@demo.local');
  const res = await request(app).get('/api/bookings/options').set(bearer(employee));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.routes));
  assert.ok(res.body.routes.length > 0);
  assert.ok(Array.isArray(res.body.departments));
});

test('personal dashboards are scoped by role', async () => {
  const employee = await tokenFor('employee@demo.local');
  const crewDash = await request(app).get('/api/dashboard').set(bearer(employee));
  assert.equal(crewDash.status, 200);
  assert.equal(crewDash.body.scope, 'PERSONAL');
  assert.ok(!crewDash.body.kpis.vehicles);

  const driver = await tokenFor('driver@demo.local');
  const driverDash = await request(app).get('/api/dashboard').set(bearer(driver));
  assert.equal(driverDash.status, 200);
  assert.equal(driverDash.body.scope, 'PERSONAL');
  assert.ok(Array.isArray(driverDash.body.myTrips));

  const fleet = await tokenFor('fleet@demo.local');
  const opsDash = await request(app).get('/api/dashboard').set(bearer(fleet));
  assert.equal(opsDash.status, 200);
  assert.equal(opsDash.body.scope, 'OPERATIONS');
});
