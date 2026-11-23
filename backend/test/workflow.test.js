import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, makeBooking, approveBooking, cancelBooking, futureIso, listItems } from './helpers.js';

test('full workflow: booking → approval → dispatch → trip completion releases resources', async () => {
  const admin = await tokenFor();
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const driver = await tokenFor('driver@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const booking = await makeBooking(employee, { departureAt: futureIso(48), passengerCount: 4 });
  assert.equal(booking.status, 201);
  const bookingId = booking.body.id;

  const approved = await approveBooking(fleet, bookingId);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'APPROVED');

  const availability = await request(app)
    .get(`/api/trips/availability?bookingId=${bookingId}`)
    .set(bearer(dispatcher));
  assert.equal(availability.status, 200);
  assert.ok(availability.body.vehicles.some((v) => v.id === 'veh_t1'));
  assert.ok(availability.body.drivers.some((d) => d.id === 'drv_t1'));

  const assigned = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId, vehicleId: 'veh_t1', driverId: 'drv_t1' });
  assert.equal(assigned.status, 201);
  assert.equal(assigned.body.status, 'SCHEDULED');
  const tripId = assigned.body.id;

  const bookingDetail = await request(app).get(`/api/bookings/${bookingId}`).set(bearer(admin));
  assert.equal(bookingDetail.body.status, 'ASSIGNED');
  assert.equal(bookingDetail.body.trip.id, tripId);

  const vehicle = await request(app).get('/api/vehicles').set(bearer(dispatcher));
  const vehicleRow = vehicle.body.items.find((v) => v.id === 'veh_t1');
  assert.equal(vehicleRow.status, 'ASSIGNED');
  const driverRow = (await request(app).get('/api/drivers').set(bearer(dispatcher))).body.items.find((d) => d.id === 'drv_t1');
  assert.equal(driverRow.available, false);

  const myTrips = await request(app).get('/api/trips').set(bearer(driver));
  assert.equal(myTrips.status, 200);
  assert.ok(myTrips.body.items.some((t) => t.id === tripId));

  const invalid = await request(app).patch(`/api/trips/${tripId}/status`).set(bearer(driver)).send({ status: 'COMPLETED' });
  assert.equal(invalid.status, 409);

  const checklist = await request(app)
    .patch(`/api/trips/${tripId}/checklist`)
    .set(bearer(driver))
    .send({
      items: [
        { key: 'documents', checked: true },
        { key: 'tires', checked: true },
        { key: 'lights', checked: true },
        { key: 'fluids', checked: true },
        { key: 'safety', checked: true },
        { key: 'cleanliness', checked: true },
      ],
    });
  assert.equal(checklist.status, 200, JSON.stringify(checklist.body));
  assert.equal(checklist.body.checklist.complete, true);

  for (const status of ['DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED']) {
    const res = await request(app).patch(`/api/trips/${tripId}/status`).set(bearer(driver)).send({ status });
    assert.equal(res.status, 200, `transition to ${status} failed: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.status, status);
  }

  const completedBooking = await request(app).get(`/api/bookings/${bookingId}`).set(bearer(admin));
  assert.equal(completedBooking.body.status, 'COMPLETED');

  const releasedVehicle = (await request(app).get('/api/vehicles').set(bearer(dispatcher))).body.items.find((v) => v.id === 'veh_t1');
  assert.equal(releasedVehicle.status, 'AVAILABLE');
  const releasedDriver = (await request(app).get('/api/drivers').set(bearer(dispatcher))).body.items.find((d) => d.id === 'drv_t1');
  assert.equal(releasedDriver.available, true);

  const audit = await request(app).get('/api/audit?pageSize=200').set(bearer(admin));
  const actions = audit.body.items.map((a) => a.action);
  for (const action of ['BOOKING_CREATE', 'BOOKING_APPROVE', 'TRIP_ASSIGN', 'TRIP_STATUS']) {
    assert.ok(actions.includes(action), `audit should contain ${action}`);
  }

  const reAssign = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId, vehicleId: 'veh_t2', driverId: 'drv_t2' });
  assert.equal(reAssign.status, 409);
});

test('rejection requires a reason and updates booking status', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');
  const booking = await makeBooking(employee, { departureAt: futureIso(52) });
  assert.equal(booking.status, 201);

  const withoutReason = await request(app)
    .patch(`/api/bookings/${booking.body.id}/decision`)
    .set(bearer(fleet))
    .send({ decision: 'REJECTED' });
  assert.equal(withoutReason.status, 400);

  const rejected = await request(app)
    .patch(`/api/bookings/${booking.body.id}/decision`)
    .set(bearer(fleet))
    .send({ decision: 'REJECTED', reason: 'Jadwal kendaraan tidak tersedia' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, 'REJECTED');
  assert.match(rejected.body.rejectionReason, /tidak tersedia/);

  const employeeDelete = await request(app).delete(`/api/bookings/${booking.body.id}`).set(bearer(employee));
  assert.equal(employeeDelete.status, 403);

  const admin = await tokenFor();
  const adminDelete = await request(app).delete(`/api/bookings/${booking.body.id}`).set(bearer(admin));
  assert.equal(adminDelete.status, 200);
});

test('dispatch detects schedule conflicts and capacity problems', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const first = await makeBooking(employee, { departureAt: futureIso(72), passengerCount: 2 });
  assert.equal((await approveBooking(fleet, first.body.id)).status, 200);
  const trip = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: first.body.id, vehicleId: 'veh_t1', driverId: 'drv_t2' });
  assert.equal(trip.status, 201);

  const second = await makeBooking(employee, { departureAt: futureIso(72), passengerCount: 2 });
  assert.equal((await approveBooking(fleet, second.body.id)).status, 200);

  const vehicleConflict = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: second.body.id, vehicleId: 'veh_t1', driverId: 'drv_t3' });
  assert.equal(vehicleConflict.status, 409);
  assert.match(vehicleConflict.body.error, /Kendaraan/);

  const driverConflict = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: second.body.id, vehicleId: 'veh_t2', driverId: 'drv_t2' });
  assert.equal(driverConflict.status, 409);
  assert.match(driverConflict.body.error, /Driver/);

  const bigBooking = await makeBooking(employee, { departureAt: futureIso(80), passengerCount: 8 });
  assert.equal((await approveBooking(fleet, bigBooking.body.id)).status, 200);
  const capacity = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: bigBooking.body.id, vehicleId: 'veh_t4', driverId: 'drv_t3' });
  assert.equal(capacity.status, 409);
  assert.match(capacity.body.error, /Kapasitas/);

  const expiredLicense = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: bigBooking.body.id, vehicleId: 'veh_t2', driverId: 'drv_t4' });
  assert.equal(expiredLicense.status, 409);
  assert.match(expiredLicense.body.error, /SIM/);

  const cancelled = await cancelBooking(fleet, first.body.id, 'Selesai uji konflik');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.trip.status, 'CANCELLED');
  await cancelBooking(fleet, second.body.id, 'cleanup');
  await cancelBooking(fleet, bigBooking.body.id, 'cleanup');

  const vehicle = (await request(app).get('/api/vehicles').set(bearer(dispatcher))).body.items.find((v) => v.id === 'veh_t1');
  assert.equal(vehicle.status, 'AVAILABLE');
});

test('requester can cancel an assigned booking and resources are released', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const booking = await makeBooking(employee, { departureAt: futureIso(96) });
  await approveBooking(fleet, booking.body.id);
  const trip = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: booking.body.id, vehicleId: 'veh_t2', driverId: 'drv_t3' });
  assert.equal(trip.status, 201);

  const cancelled = await cancelBooking(employee, booking.body.id, 'Agenda berubah');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');

  const tripDetail = await request(app).get(`/api/trips/${trip.body.id}`).set(bearer(dispatcher));
  assert.equal(tripDetail.body.status, 'CANCELLED');
  const vehicle = (await request(app).get('/api/vehicles').set(bearer(dispatcher))).body.items.find((v) => v.id === 'veh_t2');
  assert.equal(vehicle.status, 'AVAILABLE');
  const driverRow = (await request(app).get('/api/drivers').set(bearer(dispatcher))).body.items.find((d) => d.id === 'drv_t3');
  assert.equal(driverRow.available, true);

  const pending = await makeBooking(employee, { departureAt: futureIso(110) });
  const dispatcherCancel = await cancelBooking(dispatcher, pending.body.id, 'bukan haknya');
  assert.equal(dispatcherCancel.status, 403);
  const ownerCancel = await cancelBooking(employee, pending.body.id, 'Batal');
  assert.equal(ownerCancel.status, 200);
});

test('maintenance lifecycle updates vehicle status and blocks unsafe starts', async () => {
  const admin = await tokenFor();
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const maintenance = await tokenFor('maintenance@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const created = await request(app)
    .post('/api/maintenance')
    .set(bearer(maintenance))
    .send({ vehicleId: 'veh_t3', title: 'Servis uji otomatis', description: 'Pemeriksaan lengkap', scheduledAt: futureIso(24), cost: 500000 });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'PLANNED');
  const maintenanceId = created.body.id;

  const started = await request(app).patch(`/api/maintenance/${maintenanceId}/start`).set(bearer(maintenance));
  assert.equal(started.status, 200);
  assert.equal(started.body.status, 'IN_PROGRESS');
  let vehicle = (await request(app).get('/api/vehicles').set(bearer(maintenance))).body.items.find((v) => v.id === 'veh_t3');
  assert.equal(vehicle.status, 'MAINTENANCE');

  const completed = await request(app)
    .patch(`/api/maintenance/${maintenanceId}/complete`)
    .set(bearer(maintenance))
    .send({ cost: 650000 });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'COMPLETED');
  vehicle = (await request(app).get('/api/vehicles').set(bearer(maintenance))).body.items.find((v) => v.id === 'veh_t3');
  assert.equal(vehicle.status, 'AVAILABLE');
  assert.ok(vehicle.lastServiceAt);

  const restart = await request(app).patch(`/api/maintenance/${maintenanceId}/start`).set(bearer(maintenance));
  assert.equal(restart.status, 409);

  const disposable = await request(app)
    .post('/api/maintenance')
    .set(bearer(maintenance))
    .send({ vehicleId: 'veh_t3', title: 'Maintenance dibatalkan', scheduledAt: futureIso(48) });
  assert.equal(disposable.status, 201);
  const deleted = await request(app).delete(`/api/maintenance/${disposable.body.id}`).set(bearer(admin));
  assert.equal(deleted.status, 200);

  const booking = await makeBooking(employee, { departureAt: futureIso(120) });
  await approveBooking(fleet, booking.body.id);
  const trip = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: booking.body.id, vehicleId: 'veh_t3', driverId: 'drv_t2' });
  assert.equal(trip.status, 201);

  const blocked = await request(app)
    .post('/api/maintenance')
    .set(bearer(maintenance))
    .send({ vehicleId: 'veh_t3', title: 'Tidak boleh mulai', scheduledAt: futureIso(130) });
  assert.equal(blocked.status, 201);
  const blockedStart = await request(app).patch(`/api/maintenance/${blocked.body.id}/start`).set(bearer(maintenance));
  assert.equal(blockedStart.status, 409);
  assert.match(blockedStart.body.error, /trip aktif/);

  await cancelBooking(fleet, booking.body.id, 'cleanup');
  await request(app).patch(`/api/maintenance/${blocked.body.id}/cancel`).set(bearer(maintenance));
  await request(app).delete(`/api/maintenance/${blocked.body.id}`).set(bearer(admin));
});

test('driver can only access and update own trips', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const driver = await tokenFor('driver@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const booking = await makeBooking(employee, { departureAt: futureIso(150) });
  await approveBooking(fleet, booking.body.id);
  const trip = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: booking.body.id, vehicleId: 'veh_t2', driverId: 'drv_t2' });
  assert.equal(trip.status, 201);

  const list = await request(app).get('/api/trips').set(bearer(driver));
  assert.equal(list.status, 200);
  assert.ok(!list.body.items.some((t) => t.id === trip.body.id));

  const detail = await request(app).get(`/api/trips/${trip.body.id}`).set(bearer(driver));
  assert.equal(detail.status, 403);
  const update = await request(app).patch(`/api/trips/${trip.body.id}/status`).set(bearer(driver)).send({ status: 'DRIVER_ACCEPTED' });
  assert.equal(update.status, 403);

  await cancelBooking(fleet, booking.body.id, 'cleanup');
});

test('trip assignment can be reassigned before completion', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const booking = await makeBooking(employee, { departureAt: futureIso(160) });
  await approveBooking(fleet, booking.body.id);
  const trip = await request(app)
    .post('/api/trips')
    .set(bearer(dispatcher))
    .send({ bookingId: booking.body.id, vehicleId: 'veh_t1', driverId: 'drv_t2' });
  assert.equal(trip.status, 201);

  const reassigned = await request(app)
    .patch(`/api/trips/${trip.body.id}/assignment`)
    .set(bearer(dispatcher))
    .send({ vehicleId: 'veh_t2', driverId: 'drv_t3', notes: 'Penggantian unit' });
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body));
  assert.equal(reassigned.body.vehicle.id, 'veh_t2');
  assert.equal(reassigned.body.driver.id, 'drv_t3');
  assert.ok(reassigned.body.events.some((e) => /Penggantian unit/.test(e.note || '')));

  const vehicle = (await request(app).get('/api/vehicles').set(bearer(dispatcher))).body.items.find((v) => v.id === 'veh_t2');
  assert.equal(vehicle.status, 'ASSIGNED');
  const oldVehicle = (await request(app).get('/api/vehicles').set(bearer(dispatcher))).body.items.find((v) => v.id === 'veh_t1');
  assert.equal(oldVehicle.status, 'AVAILABLE');

  const completedCancel = await cancelBooking(fleet, booking.body.id, 'cleanup');
  assert.equal(completedCancel.status, 200);
});

test('booking editing rules and validation', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');
  const employee2 = await tokenFor('employee2@demo.local');

  const past = await makeBooking(employee, { departureAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  assert.equal(past.status, 400);

  const booking = await makeBooking(employee, { departureAt: futureIso(200) });
  assert.equal(booking.status, 201);

  const ownerEdit = await request(app)
    .patch(`/api/bookings/${booking.body.id}`)
    .set(bearer(employee))
    .send({ purpose: 'Tujuan diperbarui oleh pemohon', passengerCount: 3 });
  assert.equal(ownerEdit.status, 200);
  assert.equal(ownerEdit.body.passengerCount, 3);

  const otherEdit = await request(app)
    .patch(`/api/bookings/${booking.body.id}`)
    .set(bearer(employee2))
    .send({ purpose: 'Tidak berhak' });
  assert.equal(otherEdit.status, 403);

  const dispatcherEdit = await request(app)
    .patch(`/api/bookings/${booking.body.id}`)
    .set(bearer(dispatcher))
    .send({ purpose: 'Tidak berhak' });
  assert.equal(dispatcherEdit.status, 403);

  const fleetEdit = await request(app)
    .patch(`/api/bookings/${booking.body.id}`)
    .set(bearer(fleet))
    .send({ passengerCount: 4 });
  assert.equal(fleetEdit.status, 200);

  await approveBooking(fleet, booking.body.id);
  const lockedEdit = await request(app)
    .patch(`/api/bookings/${booking.body.id}`)
    .set(bearer(employee))
    .send({ purpose: 'Tidak boleh setelah approve' });
  assert.equal(lockedEdit.status, 403);
  await cancelBooking(fleet, booking.body.id, 'cleanup');

  const availabilityForbidden = await request(app)
    .get(`/api/trips/availability?bookingId=${booking.body.id}`)
    .set(bearer(employee));
  assert.equal(availabilityForbidden.status, 403);
});
