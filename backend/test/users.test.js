import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, futureIso } from './helpers.js';

test('user CRUD, validation, and password reset', async () => {
  const admin = await tokenFor();
  const email = `crud-user-${Date.now()}@demo.local`;

  const created = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'User CRUD', email, password: 'Demo123!', role: 'CREW_EMPLOYEE', department: 'QA' });
  assert.equal(created.status, 201);
  assert.equal(created.body.passwordHash, undefined);

  const duplicate = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'Duplikat', email, password: 'Demo123!', role: 'CREW_EMPLOYEE' });
  assert.equal(duplicate.status, 409);

  const invalidRole = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'Role Salah', email: `role-${Date.now()}@demo.local`, password: 'Demo123!', role: 'SUPERUSER' });
  assert.equal(invalidRole.status, 400);

  const search = await request(app).get(`/api/users?q=${encodeURIComponent('crud-user-')}`).set(bearer(admin));
  assert.equal(search.status, 200);
  assert.ok(search.body.items.some((u) => u.email === email));
  assert.ok(search.body.roles.length >= 11);

  const patched = await request(app)
    .patch(`/api/users/${created.body.id}`)
    .set(bearer(admin))
    .send({ name: 'User CRUD Diperbarui', role: 'FLEET_OFFICER', department: 'Fleet Operations' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.role, 'FLEET_OFFICER');

  const reset = await request(app)
    .patch(`/api/users/${created.body.id}`)
    .set(bearer(admin))
    .send({ password: 'PasswordBaru123!' });
  assert.equal(reset.status, 200);
  const newLogin = await request(app).post('/api/auth/login').send({ email, password: 'PasswordBaru123!' });
  assert.equal(newLogin.status, 200);

  const deactivated = await request(app).patch(`/api/users/${created.body.id}`).set(bearer(admin)).send({ active: false });
  assert.equal(deactivated.status, 200);
  const blockedLogin = await request(app).post('/api/auth/login').send({ email, password: 'PasswordBaru123!' });
  assert.equal(blockedLogin.status, 401);
  await request(app).patch(`/api/users/${created.body.id}`).set(bearer(admin)).send({ active: true });

  const removed = await request(app).delete(`/api/users/${created.body.id}`).set(bearer(admin));
  assert.equal(removed.status, 409, 'user with login audit history must not be hard-deleted');

  const afterDeactivate = await request(app).patch(`/api/users/${created.body.id}`).set(bearer(admin)).send({ active: false });
  assert.equal(afterDeactivate.status, 200);
});

test('admin cannot deactivate or demote own account', async () => {
  const admin = await tokenFor();
  const self = await request(app).patch('/api/users/test_admin').set(bearer(admin)).send({ active: false });
  assert.equal(self.status, 400);
  const demote = await request(app).patch('/api/users/test_admin').set(bearer(admin)).send({ role: 'FLEET_MANAGER' });
  assert.equal(demote.status, 400);
});

test('referenced user cannot be deleted but can be deactivated', async () => {
  const admin = await tokenFor();
  const email = `ref-user-${Date.now()}@demo.local`;
  const created = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'User Dengan Riwayat', email, password: 'Demo123!', role: 'CREW_EMPLOYEE', department: 'QA' });
  assert.equal(created.status, 201);

  const userToken = await tokenFor(email);
  const booking = await request(app)
    .post('/api/bookings')
    .set(bearer(userToken))
    .send({ department: 'QA', purpose: 'Membuat riwayat booking', passengerCount: 1, origin: 'Stasiun Halim', destination: 'Kantor Pusat', departureAt: futureIso(260) });
  assert.equal(booking.status, 201);

  const blocked = await request(app).delete(`/api/users/${created.body.id}`).set(bearer(admin));
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Nonaktifkan/);

  const deactivated = await request(app).patch(`/api/users/${created.body.id}`).set(bearer(admin)).send({ active: false });
  assert.equal(deactivated.status, 200);

  await request(app).patch(`/api/bookings/${booking.body.id}/cancel`).set(bearer(userToken)).send({ reason: 'cleanup' });
});

test('user list is paginated and filterable by role and status', async () => {
  const admin = await tokenFor();
  const page = await request(app).get('/api/users?role=DRIVER&active=true&pageSize=2').set(bearer(admin));
  assert.equal(page.status, 200);
  assert.ok(page.body.items.every((u) => u.role === 'DRIVER' && u.active === true));
  assert.ok(page.body.total >= 1);
  assert.equal(page.body.page, 1);
});
