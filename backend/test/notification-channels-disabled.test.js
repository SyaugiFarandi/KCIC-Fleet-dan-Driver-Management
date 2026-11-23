import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

const { app, bearer, tokenFor } = await import('./helpers.js');
const { deliverNotification, channelStates } = await import('../src/lib/notificationChannels.js');

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test('external channels stay disabled and unconfigured by default', async () => {
  const admin = await tokenFor();
  const res = await request(app).get('/api/notifications/channels').set(bearer(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.inApp.enabled, true);
  for (const channel of res.body.channels) {
    assert.equal(channel.enabled, false);
    assert.equal(channel.configured, false);
    assert.equal(channel.problem, null);
  }
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('BOT_TOKEN'), false);
  assert.equal(serialized.includes('TEST-TOKEN'), false);
});

test('channel and delivery history endpoints require audit permission', async () => {
  const driver = await tokenFor('driver@demo.local');
  const channels = await request(app).get('/api/notifications/channels').set(bearer(driver));
  assert.equal(channels.status, 403);
  const deliveries = await request(app).get('/api/notifications/deliveries').set(bearer(driver));
  assert.equal(deliveries.status, 403);
});

test('disabled channels never create external deliveries', async () => {
  assert.equal(channelStates().every((state) => !state.enabled), true);
  const notification = await prisma.notification.create({
    data: { userId: 'test_admin', type: 'TEST', title: 'TEST CHANNEL DISABLED', message: 'tidak boleh terkirim' },
  });
  const rows = await deliverNotification({ notification, user: { id: 'test_admin', email: 'admin@demo.local' } });
  assert.deepEqual(rows, []);
  const stored = await prisma.notificationDelivery.count({ where: { notificationId: notification.id } });
  assert.equal(stored, 0);

  const admin = await tokenFor();
  const history = await request(app).get('/api/notifications/deliveries').set(bearer(admin));
  assert.equal(history.status, 200);
  assert.equal(history.body.items.length, 0);

  await prisma.notification.delete({ where: { id: notification.id } });
});
