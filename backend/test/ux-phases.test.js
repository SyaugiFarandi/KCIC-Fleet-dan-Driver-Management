import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, futureIso } from './helpers.js';

const ALL_NOTIFICATION_TYPES = ['BOOKING', 'TRIP', 'GPS_ALERT', 'DOCUMENT', 'MAINTENANCE_DUE'];

test('login sets an httpOnly session cookie that authenticates /auth/me', async () => {
  const login = await request(app).post('/api/auth/login').send({ email: 'fleet@demo.local', password: 'Demo123!' });
  assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie'] || [];
  const session = setCookie.find((value) => value.startsWith('fleet_session='));
  assert.ok(session, 'login must set the fleet_session cookie');
  assert.match(session, /HttpOnly/i);
  assert.match(session, /SameSite=Lax/i);
  assert.match(session, /Path=\//i);

  const cookie = session.split(';')[0];
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'fleet@demo.local');
  assert.ok(Array.isArray(me.body.user.notificationTypes));
  assert.ok(Array.isArray(me.body.preferences.types));

  const anonymous = await request(app).get('/api/auth/me');
  assert.equal(anonymous.status, 401);

  const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
  assert.equal(logout.status, 200);
  const cleared = (logout.headers['set-cookie'] || []).find((value) => value.startsWith('fleet_session='));
  assert.ok(cleared, 'logout must clear the session cookie');
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
});

test('notification preferences are persisted per user and filter the inbox', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  try {
    const chosen = ALL_NOTIFICATION_TYPES.filter((type) => type !== 'GPS_ALERT');
    const save = await request(app).patch('/api/auth/preferences').set(bearer(fleet)).send({ types: chosen });
    assert.equal(save.status, 200);
    assert.deepEqual(save.body.preferences.types.sort(), [...chosen].sort());

    const me = await request(app).get('/api/auth/me').set(bearer(fleet));
    assert.deepEqual(me.body.user.notificationTypes.sort(), [...chosen].sort());

    const inbox = await request(app).get('/api/notifications?pageSize=100').set(bearer(fleet));
    assert.equal(inbox.status, 200);
    assert.ok(!inbox.body.enabledTypes.includes('GPS_ALERT'));
    assert.ok(inbox.body.items.every((item) => item.type !== 'GPS_ALERT'), 'disabled type must not appear in the list');

    const invalid = await request(app).patch('/api/auth/preferences').set(bearer(fleet)).send({ types: ['NOT_A_TYPE'] });
    assert.equal(invalid.status, 400);
  } finally {
    await request(app).patch('/api/auth/preferences').set(bearer(fleet)).send({ types: ALL_NOTIFICATION_TYPES });
  }

  const restored = await request(app).get('/api/notifications?pageSize=1').set(bearer(fleet));
  assert.deepEqual(restored.body.enabledTypes.sort(), [...ALL_NOTIFICATION_TYPES].sort());
});

test('series-wide cancel applies to the whole recurring series with RBAC', async () => {
  const employee = await tokenFor('employee@demo.local');
  const driver = await tokenFor('driver@demo.local');
  const admin = await tokenFor();

  const created = await request(app)
    .post('/api/bookings')
    .set(bearer(employee))
    .send({
      department: 'QA',
      purpose: 'Uji pembatalan seri otomatis',
      passengerCount: 2,
      origin: 'Stasiun Halim',
      destination: 'Kantor Pusat',
      departureAt: futureIso(240),
      recurrence: { frequency: 'DAILY', count: 3 },
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.series.count, 3);
  assert.equal(created.body.series.codes.length, 3);
  const seriesId = created.body.series.id;

  const forbidden = await request(app).patch(`/api/bookings/series/${seriesId}/cancel`).set(bearer(driver)).send({});
  assert.equal(forbidden.status, 403);

  const cancelled = await request(app)
    .patch(`/api/bookings/series/${seriesId}/cancel`)
    .set(bearer(employee))
    .send({ reason: 'Rapat dibatalkan' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.cancelled, 3);
  assert.equal(cancelled.body.skipped, 0);

  const list = await request(app).get('/api/bookings?pageSize=100').set(bearer(employee));
  assert.equal(list.status, 200);
  const seriesRows = list.body.items.filter((booking) => booking.seriesId === seriesId);
  assert.equal(seriesRows.length, 3);
  assert.ok(seriesRows.every((booking) => booking.status === 'CANCELLED'));
  assert.ok(seriesRows.every((booking) => booking.cancelledReason === 'Rapat dibatalkan'));

  const again = await request(app).patch(`/api/bookings/series/${seriesId}/cancel`).set(bearer(admin)).send({});
  assert.equal(again.status, 409, 'a fully cancelled series cannot be cancelled twice');

  for (const booking of seriesRows) {
    await request(app).delete(`/api/bookings/${booking.id}`).set(bearer(admin));
  }
});

test('vehicle checklist template is validated and persisted', async () => {
  const admin = await tokenFor();
  const vehicles = await request(app).get('/api/vehicles?pageSize=5').set(bearer(admin));
  assert.equal(vehicles.status, 200);
  const vehicle = vehicles.body.items[0];
  assert.ok(vehicle);

  const saved = await request(app)
    .patch(`/api/vehicles/${vehicle.id}`)
    .set(bearer(admin))
    .send({ checklistItems: ['Tekanan ban', 'Lampu & klakson', 'Kebersihan kabin'] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.checklistTemplate.items.map((item) => item.label), ['Tekanan ban', 'Lampu & klakson', 'Kebersihan kabin']);

  const tooMany = await request(app)
    .patch(`/api/vehicles/${vehicle.id}`)
    .set(bearer(admin))
    .send({ checklistItems: Array.from({ length: 21 }, (_, index) => `Item checklist ${index + 1}`) });
  assert.equal(tooMany.status, 400);

  const tooShort = await request(app)
    .patch(`/api/vehicles/${vehicle.id}`)
    .set(bearer(admin))
    .send({ checklistItems: ['ab'] });
  assert.equal(tooShort.status, 400);

  const cleared = await request(app).patch(`/api/vehicles/${vehicle.id}`).set(bearer(admin)).send({ checklistItems: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.checklistTemplate, null);
});

test('Excel export returns a real xls attachment and stays staff-only', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');
  const range = 'from=2026-01-01&to=2026-12-31';

  const exportRes = await request(app).get(`/api/reports/export.xls?dataset=bookings&${range}`).set(bearer(fleet));
  assert.equal(exportRes.status, 200);
  assert.match(exportRes.headers['content-type'], /application\/vnd\.ms-excel/);
  assert.match(exportRes.headers['content-disposition'], /attachment; filename="laporan-bookings-\d{8}\.xls"/);
  const workbook = exportRes.text || exportRes.body;
  assert.ok(workbook && workbook.length > 500, 'Excel workbook must contain serialized rows');

  const forbidden = await request(app).get(`/api/reports/export.xls?dataset=bookings&${range}`).set(bearer(employee));
  assert.equal(forbidden.status, 403);
});
