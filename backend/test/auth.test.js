import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor } from './helpers.js';

test('health endpoint reports database connectivity', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.database, 'up');
});

test('login rejects wrong password', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@demo.local', password: 'SalahBanget123!' });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /salah/i);
});

test('login requires valid email format', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'bukan-email', password: 'x' });
  assert.equal(res.status, 400);
});

test('login returns token and current user', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@demo.local', password: 'Demo123!' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.role, 'SYSTEM_ADMIN');
  assert.equal(res.body.user.passwordHash, undefined);
});

test('protected endpoint requires token', async () => {
  const res = await request(app).get('/api/dashboard');
  assert.equal(res.status, 401);
});

test('me returns authenticated profile', async () => {
  const token = await tokenFor('fleet@demo.local');
  const res = await request(app).get('/api/auth/me').set(bearer(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'fleet@demo.local');
  assert.equal(res.body.user.role, 'FLEET_MANAGER');
});

test('change password flow and revert', async () => {
  const token = await tokenFor('employee@demo.local');
  const changed = await request(app)
    .patch('/api/auth/password')
    .set(bearer(token))
    .send({ currentPassword: 'Demo123!', newPassword: 'RahasiaBaru123!' });
  assert.equal(changed.status, 200);

  const oldLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'employee@demo.local', password: 'Demo123!' });
  assert.equal(oldLogin.status, 401);

  const newToken = await tokenFor('employee@demo.local', 'RahasiaBaru123!');
  const revert = await request(app)
    .patch('/api/auth/password')
    .set(bearer(newToken))
    .send({ currentPassword: 'RahasiaBaru123!', newPassword: 'Demo123!' });
  assert.equal(revert.status, 200);

  const loginAgain = await request(app)
    .post('/api/auth/login')
    .send({ email: 'employee@demo.local', password: 'Demo123!' });
  assert.equal(loginAgain.status, 200);
});

test('short password is rejected', async () => {
  const token = await tokenFor('employee@demo.local');
  const res = await request(app)
    .patch('/api/auth/password')
    .set(bearer(token))
    .send({ currentPassword: 'Demo123!', newPassword: 'pendek' });
  assert.equal(res.status, 400);
});

test('deactivated account cannot authenticate', async () => {
  const admin = await tokenFor();
  const email = `inactive-${Date.now()}@demo.local`;
  const created = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'Akun Nonaktif', email, password: 'Demo123!', role: 'CREW_EMPLOYEE' });
  assert.equal(created.status, 201);

  const deactivated = await request(app)
    .patch(`/api/users/${created.body.id}`)
    .set(bearer(admin))
    .send({ active: false });
  assert.equal(deactivated.status, 200);

  const login = await request(app).post('/api/auth/login').send({ email, password: 'Demo123!' });
  assert.equal(login.status, 401);

  const removed = await request(app).delete(`/api/users/${created.body.id}`).set(bearer(admin));
  assert.equal(removed.status, 200);
});

test('unknown API route returns 404 JSON', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});
