import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, makeBooking, approveBooking, cancelBooking, futureIso } from './helpers.js';

async function approvedBooking(employee, fleet, overrides = {}) {
  const booking = await makeBooking(employee, overrides);
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  const approved = await approveBooking(fleet, booking.body.id);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return booking.body.id;
}

async function tripsForBooking(admin, bookingId) {
  const res = await request(app).get('/api/trips?pageSize=200').set(bearer(admin));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.items.filter((trip) => trip.bookingId === bookingId);
}

test('concurrent assignments cannot share the same vehicle across bookings', async () => {
  const employee = await tokenFor('employee@demo.local');
  const fleet = await tokenFor('fleet@demo.local');
  const admin = await tokenFor('admin@demo.local');

  const departureAt = futureIso(1000);
  const [bookingA, bookingB] = await Promise.all([
    approvedBooking(employee, fleet, { departureAt }),
    approvedBooking(employee, fleet, { departureAt }),
  ]);

  const [first, second] = await Promise.all([
    request(app).post('/api/trips').set(bearer(fleet)).send({ bookingId: bookingA, vehicleId: 'veh_t1', driverId: 'drv_t1' }),
    request(app).post('/api/trips').set(bearer(fleet)).send({ bookingId: bookingB, vehicleId: 'veh_t1', driverId: 'drv_t2' }),
  ]);

  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], `${JSON.stringify(first.body)} / ${JSON.stringify(second.body)}`);
  const conflict = [first, second].find((res) => res.status === 409);
  assert.match(conflict.body.error, /Kendaraan sudah dipakai/);

  const tripsA = await tripsForBooking(admin, bookingA);
  const tripsB = await tripsForBooking(admin, bookingB);
  assert.equal(tripsA.length + tripsB.length, 1, 'only one assignment may be created');

  await Promise.all([cancelBooking(fleet, bookingA), cancelBooking(fleet, bookingB)]);
});

test('concurrent assignments cannot share the same driver across bookings', async () => {
  const employee = await tokenFor('employee@demo.local');
  const fleet = await tokenFor('fleet@demo.local');
  const admin = await tokenFor('admin@demo.local');

  const departureAt = futureIso(1200);
  const [bookingA, bookingB] = await Promise.all([
    approvedBooking(employee, fleet, { departureAt }),
    approvedBooking(employee, fleet, { departureAt }),
  ]);

  const [first, second] = await Promise.all([
    request(app).post('/api/trips').set(bearer(fleet)).send({ bookingId: bookingA, vehicleId: 'veh_t1', driverId: 'drv_t3' }),
    request(app).post('/api/trips').set(bearer(fleet)).send({ bookingId: bookingB, vehicleId: 'veh_t2', driverId: 'drv_t3' }),
  ]);

  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], `${JSON.stringify(first.body)} / ${JSON.stringify(second.body)}`);
  const conflict = [first, second].find((res) => res.status === 409);
  assert.match(conflict.body.error, /Driver sudah ditugaskan/);

  const tripsA = await tripsForBooking(admin, bookingA);
  const tripsB = await tripsForBooking(admin, bookingB);
  assert.equal(tripsA.length + tripsB.length, 1, 'only one assignment may be created');

  await Promise.all([cancelBooking(fleet, bookingA), cancelBooking(fleet, bookingB)]);
});

test('concurrent assignments for the same booking create a single trip', async () => {
  const employee = await tokenFor('employee@demo.local');
  const fleet = await tokenFor('fleet@demo.local');
  const admin = await tokenFor('admin@demo.local');

  const bookingId = await approvedBooking(employee, fleet, { departureAt: futureIso(1400) });

  const [first, second] = await Promise.all([
    request(app).post('/api/trips').set(bearer(fleet)).send({ bookingId, vehicleId: 'veh_t1', driverId: 'drv_t1' }),
    request(app).post('/api/trips').set(bearer(fleet)).send({ bookingId, vehicleId: 'veh_t2', driverId: 'drv_t2' }),
  ]);

  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], `${JSON.stringify(first.body)} / ${JSON.stringify(second.body)}`);
  const conflict = [first, second].find((res) => res.status === 409);
  assert.match(conflict.body.error, /sudah memiliki penugasan/);

  const trips = await tripsForBooking(admin, bookingId);
  assert.equal(trips.length, 1);

  await cancelBooking(fleet, bookingId);
});
