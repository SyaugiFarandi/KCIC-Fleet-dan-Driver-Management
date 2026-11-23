import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, futureIso } from './helpers.js';

test('vehicle CRUD, validation, and reference protection', async () => {
  const admin = await tokenFor();
  const fleet = await tokenFor('fleet@demo.local');
  const fleetofficer = await tokenFor('fleetofficer@demo.local');
  const maintenance = await tokenFor('maintenance@demo.local');
  const plate = `MD-VEH-${Date.now()}`;

  const created = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleetofficer))
    .send({ plateNumber: plate, brand: 'Toyota', model: 'Innova', category: 'MPV', capacity: 6, ownership: 'KCIC' });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'AVAILABLE');

  const duplicate = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleetofficer))
    .send({ plateNumber: plate, brand: 'Toyota', model: 'Innova', category: 'MPV', capacity: 6 });
  assert.equal(duplicate.status, 409);

  const updated = await request(app).patch(`/api/vehicles/${created.body.id}`).set(bearer(fleetofficer)).send({ capacity: 12, notes: 'Diperbarui' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.capacity, 12);

  const invalidCapacity = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleetofficer))
    .send({ plateNumber: `MD-BAD-${Date.now()}`, brand: 'X', model: 'Y', category: 'MPV', capacity: 0 });
  assert.equal(invalidCapacity.status, 400);

  const vendorWithoutVendor = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleetofficer))
    .send({ plateNumber: `MD-BAD2-${Date.now()}`, brand: 'X', model: 'Y', category: 'MPV', capacity: 4, ownership: 'VENDOR' });
  assert.equal(vendorWithoutVendor.status, 400);

  const inactive = await request(app).patch(`/api/vehicles/${created.body.id}`).set(bearer(fleetofficer)).send({ status: 'INACTIVE' });
  assert.equal(inactive.status, 200);
  const manualAssigned = await request(app).patch(`/api/vehicles/${created.body.id}`).set(bearer(fleetofficer)).send({ status: 'MAINTENANCE' });
  assert.equal(manualAssigned.status, 400);
  await request(app).patch(`/api/vehicles/${created.body.id}`).set(bearer(fleetofficer)).send({ status: 'AVAILABLE' });

  const maintenanceItem = await request(app)
    .post('/api/maintenance')
    .set(bearer(maintenance))
    .send({ vehicleId: created.body.id, title: 'Servis sebelum dihapus', scheduledAt: futureIso(10) });
  assert.equal(maintenanceItem.status, 201);
  const blockedDelete = await request(app).delete(`/api/vehicles/${created.body.id}`).set(bearer(fleet));
  assert.equal(blockedDelete.status, 409);
  const removeMaintenance = await request(app).delete(`/api/maintenance/${maintenanceItem.body.id}`).set(bearer(admin));
  assert.equal(removeMaintenance.status, 200);
  const deleted = await request(app).delete(`/api/vehicles/${created.body.id}`).set(bearer(fleet));
  assert.equal(deleted.status, 200);

  const filtered = await request(app).get('/api/vehicles?pageSize=2&ownership=KCIC').set(bearer(admin));
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.items.length, 2);
  assert.ok(filtered.body.total >= 2);
});

test('vendor CRUD with ownership references', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const vendorManager = await tokenFor('vendor@demo.local');

  const created = await request(app)
    .post('/api/vendors')
    .set(bearer(vendorManager))
    .send({ name: `MD Vendor ${Date.now()}`, contactName: 'PIC Uji', phone: '021-9999', email: 'vendor@demo.local' });
  assert.equal(created.status, 201);

  const patched = await request(app)
    .patch(`/api/vendors/${created.body.id}`)
    .set(bearer(vendorManager))
    .send({ contactName: 'PIC Diperbarui', address: 'Jakarta' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.contactName, 'PIC Diperbarui');

  const invalidEmail = await request(app)
    .post('/api/vendors')
    .set(bearer(vendorManager))
    .send({ name: 'Bad Vendor', contactName: 'X', phone: '021-111', email: 'not-an-email' });
  assert.equal(invalidEmail.status, 400);

  const vehicle = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleet))
    .send({ plateNumber: `VND-${Date.now().toString().slice(-7)}`, brand: 'Toyota', model: 'Hiace', category: 'Minibus', capacity: 12, ownership: 'VENDOR', vendorId: created.body.id });
  assert.equal(vehicle.status, 201);

  const blocked = await request(app).delete(`/api/vendors/${created.body.id}`).set(bearer(fleet));
  assert.equal(blocked.status, 409);

  const vendorDeleteForbidden = await request(app).delete(`/api/vendors/${created.body.id}`).set(bearer(vendorManager));
  assert.equal(vendorDeleteForbidden.status, 403);

  await request(app).delete(`/api/vehicles/${vehicle.body.id}`).set(bearer(fleet));
  const removed = await request(app).delete(`/api/vendors/${created.body.id}`).set(bearer(fleet));
  assert.equal(removed.status, 200);
});

test('driver CRUD, account linking, and vendor rule', async () => {
  const admin = await tokenFor();
  const driverCoord = await tokenFor('drivercoord@demo.local');
  const licenseNumber = `SIM-MD-${Date.now()}`;

  const created = await request(app)
    .post('/api/drivers')
    .set(bearer(driverCoord))
    .send({ name: 'Driver Master Data', phone: '0812-7777', licenseNumber, licenseExpiry: '2031-01-01', type: 'INTERNAL' });
  assert.equal(created.status, 201);
  assert.equal(created.body.available, true);
  assert.equal(created.body.active, true);

  const patched = await request(app)
    .patch(`/api/drivers/${created.body.id}`)
    .set(bearer(driverCoord))
    .send({ licenseCategory: 'SIM A Umum', notes: 'Uji master data' });
  assert.equal(patched.status, 200);

  const vendorMissing = await request(app)
    .post('/api/drivers')
    .set(bearer(driverCoord))
    .send({ name: 'Driver Vendor Gagal', phone: '0812-7778', licenseNumber: `SIM-MD-V-${Date.now()}`, licenseExpiry: '2031-01-01', type: 'VENDOR' });
  assert.equal(vendorMissing.status, 400);

  const driverUserEmail = `driver-user-${Date.now()}@demo.local`;
  const driverUser = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'Akun Driver Baru', email: driverUserEmail, password: 'Demo123!', role: 'DRIVER' });
  assert.equal(driverUser.status, 201);

  const linked = await request(app).patch(`/api/drivers/${created.body.id}`).set(bearer(driverCoord)).send({ userId: driverUser.body.id });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.user.email, driverUserEmail);

  const alreadyLinked = await request(app).patch(`/api/drivers/${created.body.id}`).set(bearer(driverCoord)).send({ userId: 'test_driver' });
  assert.equal(alreadyLinked.status, 409);

  const employeeLink = await request(app).patch(`/api/drivers/${created.body.id}`).set(bearer(driverCoord)).send({ userId: 'test_employee' });
  assert.equal(employeeLink.status, 400);

  const driverDeleteForbidden = await request(app).delete(`/api/drivers/${created.body.id}`).set(bearer(driverCoord));
  assert.equal(driverDeleteForbidden.status, 403);
  const removed = await request(app).delete(`/api/drivers/${created.body.id}`).set(bearer(admin));
  assert.equal(removed.status, 200);

  const userRemoved = await request(app).delete(`/api/users/${driverUser.body.id}`).set(bearer(admin));
  assert.equal(userRemoved.status, 200);
});

test('route CRUD and protection when used by booking', async () => {
  const admin = await tokenFor();
  const fleet = await tokenFor('fleet@demo.local');
  const transport = await tokenFor('transport@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const created = await request(app)
    .post('/api/routes')
    .set(bearer(transport))
    .send({ origin: 'Stasiun Uji Asal', destination: 'Stasiun Uji Tujuan', estimatedMinutes: 40, distanceKm: 25 });
  assert.equal(created.status, 201);
  assert.ok(created.body.code.startsWith('RTE-'));

  const patched = await request(app)
    .patch(`/api/routes/${created.body.id}`)
    .set(bearer(transport))
    .send({ estimatedMinutes: 45, distanceKm: 30.5 });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.estimatedMinutes, 45);

  const invalid = await request(app)
    .post('/api/routes')
    .set(bearer(transport))
    .send({ origin: 'A', destination: 'B', estimatedMinutes: 0, distanceKm: 1 });
  assert.equal(invalid.status, 400);

  const usedBooking = await request(app)
    .post('/api/bookings')
    .set(bearer(employee))
    .send({ department: 'QA', purpose: 'Rute dipakai', passengerCount: 2, routeId: 'test_route_1', departureAt: futureIso(240) });
  assert.equal(usedBooking.status, 201);
  assert.equal(usedBooking.body.origin, 'Stasiun Halim');
  const blocked = await request(app).delete('/api/routes/test_route_1').set(bearer(fleet));
  assert.equal(blocked.status, 409);

  const forbiddenDelete = await request(app).delete(`/api/routes/${created.body.id}`).set(bearer(transport));
  assert.equal(forbiddenDelete.status, 403);
  const removed = await request(app).delete(`/api/routes/${created.body.id}`).set(bearer(admin));
  assert.equal(removed.status, 200);
});

test('master data changes are written to the audit log', async () => {
  const admin = await tokenFor();
  const fleet = await tokenFor('fleet@demo.local');
  const plate = `MD-AUD-${Date.now()}`;
  const vehicle = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleet))
    .send({ plateNumber: plate, brand: 'Isuzu', model: 'Elf', category: 'Minibus', capacity: 15 });
  assert.equal(vehicle.status, 201);
  await request(app).delete(`/api/vehicles/${vehicle.body.id}`).set(bearer(fleet));

  const audit = await request(app).get('/api/audit?q=' + encodeURIComponent(plate)).set(bearer(admin));
  assert.equal(audit.status, 200);
  const actions = audit.body.items.map((a) => a.action);
  assert.ok(actions.includes('VEHICLE_CREATE'));
  assert.ok(actions.includes('VEHICLE_DELETE'));
});
