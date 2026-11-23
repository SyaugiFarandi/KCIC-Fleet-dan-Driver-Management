import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, makeBooking, approveBooking, cancelBooking, assignTrip, futureIso } from './helpers.js';

const CHECKLIST_KEYS = ['documents', 'tires', 'lights', 'fluids', 'safety', 'cleanliness'];
const checklistItems = (checked = true) => CHECKLIST_KEYS.map((key) => ({ key, checked }));

test('booking decisions and trip assignments create in-app notifications', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');
  const driver = await tokenFor('driver@demo.local');

  const booking = await makeBooking(employee, { departureAt: futureIso(300), passengerCount: 1 });
  assert.equal(booking.status, 201);
  assert.equal((await approveBooking(fleet, booking.body.id)).status, 200);

  const inbox = await request(app).get('/api/notifications?pageSize=50').set(bearer(employee));
  assert.equal(inbox.status, 200);
  const approval = inbox.body.items.find(
    (item) => item.type === 'BOOKING' && (item.title.includes(booking.body.code) || item.message.includes(booking.body.code))
  );
  assert.ok(approval, 'requester must receive an approval notification');
  assert.equal(approval.readAt, null);
  assert.ok(inbox.body.unreadCount >= 1);

  const trip = await assignTrip(dispatcher, booking.body.id, 'veh_t1', 'drv_t1');
  assert.equal(trip.status, 201);

  const driverInbox = await request(app).get('/api/notifications?pageSize=50').set(bearer(driver));
  assert.ok(
    driverInbox.body.items.some(
      (item) => item.type === 'TRIP' && (item.title.includes(booking.body.code) || item.message.includes(booking.body.code))
    )
  );

  const forbidden = await request(app).patch(`/api/notifications/${approval.id}/read`).set(bearer(driver));
  assert.equal(forbidden.status, 403);

  const read = await request(app).patch(`/api/notifications/${approval.id}/read`).set(bearer(employee));
  assert.equal(read.status, 200);
  assert.ok(read.body.readAt);

  const readAll = await request(app).post('/api/notifications/read-all').set(bearer(employee));
  assert.equal(readAll.status, 200);
  const after = await request(app).get('/api/notifications?unreadOnly=true').set(bearer(employee));
  assert.equal(after.body.total, 0);

  await cancelBooking(fleet, booking.body.id, 'cleanup notification test');
});

test('staff reminder sweep creates document alerts once per day', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const first = await request(app).get('/api/notifications?pageSize=100').set(bearer(fleet));
  assert.equal(first.status, 200);
  const docs = first.body.items.filter((item) => item.type === 'DOCUMENT');
  assert.ok(docs.some((item) => item.title.includes('TEST-0001')), 'expiring STNK must be reported');
  assert.ok(docs.some((item) => item.title.includes('Driver Test Empat')), 'expired SIM must be reported');

  const second = await request(app).get('/api/notifications?pageSize=100').set(bearer(fleet));
  const docsSecond = second.body.items.filter((item) => item.type === 'DOCUMENT');
  assert.equal(docsSecond.length, docs.length, 'reminder sweep must not duplicate notifications');
});

test('reports summary and CSV export are staff-only', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  assert.equal((await request(app).get('/api/reports/summary').set(bearer(employee))).status, 403);

  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = futureIso(1000);
  const summary = await request(app)
    .get(`/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    .set(bearer(fleet));
  assert.equal(summary.status, 200);
  assert.ok(summary.body.totals.bookings >= 1);
  assert.ok(summary.body.perVehicle.length >= 4);
  assert.ok(Array.isArray(summary.body.bookingByDepartment));
  assert.ok(summary.body.bookingStatus.PENDING >= 0);

  const csv = await request(app)
    .get(`/api/reports/export.csv?dataset=vehicles&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    .set(bearer(fleet));
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Nomor Polisi/);
  assert.match(csv.text, /TEST-0001/);

  assert.equal((await request(app).get('/api/reports/export.csv?dataset=nope').set(bearer(fleet))).status, 400);
  assert.equal((await request(app).get('/api/reports/summary?from=2027-01-02&to=2027-01-01').set(bearer(fleet))).status, 400);
});

test('recurring booking series is created atomically', async () => {
  const employee = await tokenFor('employee@demo.local');
  const res = await makeBooking(employee, {
    departureAt: futureIso(400),
    recurrence: { frequency: 'WEEKLY', count: 3 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.series.count, 3);
  assert.equal(res.body.seriesId, res.body.series.id);

  const list = await request(app).get('/api/bookings?pageSize=100').set(bearer(employee));
  const series = list.body.items.filter((item) => item.seriesId === res.body.series.id);
  assert.equal(series.length, 3);
  const sorted = series.sort((a, b) => new Date(a.departureAt) - new Date(b.departureAt));
  assert.equal(new Date(sorted[1].departureAt) - new Date(sorted[0].departureAt), 7 * 24 * 60 * 60 * 1000);

  const tooSmall = await makeBooking(employee, {
    departureAt: futureIso(500),
    recurrence: { frequency: 'DAILY', count: 1 },
  });
  assert.equal(tooSmall.status, 400);

  for (const item of series) {
    assert.equal((await cancelBooking(employee, item.id, 'cleanup series')).status, 200);
  }
});

test('trip checklist is required before pick-up and affects ETA visibility', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const driver = await tokenFor('driver@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const booking = await makeBooking(employee, { departureAt: futureIso(600), passengerCount: 2 });
  assert.equal((await approveBooking(fleet, booking.body.id)).status, 200);
  const trip = await assignTrip(dispatcher, booking.body.id, 'veh_t2', 'drv_t1');
  assert.equal(trip.status, 201);

  const template = await request(app).get('/api/trips/checklist-template').set(bearer(driver));
  assert.equal(template.status, 200);
  assert.equal(template.body.items.length, CHECKLIST_KEYS.length);
  assert.equal((await request(app).get('/api/trips/checklist-template').set(bearer(employee))).status, 403);

  const accepted = await request(app)
    .patch(`/api/trips/${trip.body.id}/status`)
    .set(bearer(driver))
    .send({ status: 'DRIVER_ACCEPTED' });
  assert.equal(accepted.status, 200);

  const blocked = await request(app).patch(`/api/trips/${trip.body.id}/status`).set(bearer(driver)).send({ status: 'PICKED_UP' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Checklist/);

  const partial = await request(app)
    .patch(`/api/trips/${trip.body.id}/checklist`)
    .set(bearer(driver))
    .send({ items: checklistItems(true).map((item, index) => ({ ...item, checked: index !== 0 })) });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.checklist.complete, false);

  const stillBlocked = await request(app).patch(`/api/trips/${trip.body.id}/status`).set(bearer(driver)).send({ status: 'PICKED_UP' });
  assert.equal(stillBlocked.status, 409);

  const complete = await request(app)
    .patch(`/api/trips/${trip.body.id}/checklist`)
    .set(bearer(driver))
    .send({ items: checklistItems(true), note: 'Semua aman' });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.checklist.complete, true);

  const pickedUp = await request(app).patch(`/api/trips/${trip.body.id}/status`).set(bearer(driver)).send({ status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200);

  const positions = await request(app).get('/api/gps/positions').set(bearer(fleet));
  assert.equal(positions.status, 200);
  const tracked = positions.body.items.find((item) => item.id === 'veh_t2');
  assert.ok(tracked, 'vehicle with active trip must be listed');
  assert.ok(tracked.etaAt, 'moving trip must expose an ETA');
  assert.ok(['ON_TIME', 'DUE_SOON', 'OVERDUE'].includes(tracked.etaStatus));

  const forbidden = await request(app)
    .patch(`/api/trips/${trip.body.id}/checklist`)
    .set(bearer(employee))
    .send({ items: checklistItems(true) });
  assert.equal(forbidden.status, 403);

  const cancelled = await request(app)
    .patch(`/api/trips/${trip.body.id}/status`)
    .set(bearer(dispatcher))
    .send({ status: 'CANCELLED', note: 'cleanup checklist test' });
  assert.equal(cancelled.status, 200);
});

test('availability can be checked for a time window without a booking', async () => {
  const dispatcher = await tokenFor('dispatch@demo.local');
  const driver = await tokenFor('driver@demo.local');
  const from = futureIso(700);
  const to = new Date(new Date(from).getTime() + 2 * 60 * 60 * 1000).toISOString();

  const res = await request(app)
    .get(`/api/trips/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&passengerCount=3`)
    .set(bearer(dispatcher));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.vehicles));
  assert.ok(res.body.vehicles.every((vehicle) => vehicle.capacity >= 3));
  assert.ok(Array.isArray(res.body.drivers));

  const forbidden = await request(app)
    .get(`/api/trips/availability?from=${encodeURIComponent(from)}`)
    .set(bearer(driver));
  assert.equal(forbidden.status, 403);
  const missing = await request(app).get('/api/trips/availability').set(bearer(dispatcher));
  assert.equal(missing.status, 400);
});

test('GPS events can be acknowledged once and the action is audited', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const maintenance = await tokenFor('maintenance@demo.local');
  const admin = await tokenFor();

  const forbidden = await request(app).patch('/api/gps/events/gps_evt_t1/acknowledge').set(bearer(maintenance));
  assert.equal(forbidden.status, 403);

  const ack = await request(app).patch('/api/gps/events/gps_evt_t1/acknowledge').set(bearer(fleet));
  assert.equal(ack.status, 200);
  assert.ok(ack.body.acknowledgedAt);
  assert.equal(ack.body.acknowledgedBy.name, 'Test Fleet Manager');

  const again = await request(app).patch('/api/gps/events/gps_evt_t1/acknowledge').set(bearer(fleet));
  assert.equal(again.status, 409);

  const unacked = await request(app).get('/api/gps/events?acknowledged=false').set(bearer(admin));
  assert.equal(unacked.status, 200);
  assert.ok(!unacked.body.items.some((event) => event.id === 'gps_evt_t1'));
  assert.ok(unacked.body.unacknowledged >= 0);

  const audit = await request(app).get('/api/audit?pageSize=200').set(bearer(admin));
  assert.ok(audit.body.items.some((entry) => entry.action === 'GPS_EVENT_ACK'));
});
