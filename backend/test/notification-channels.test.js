process.env.EMAIL_NOTIFICATIONS_ENABLED = 'true';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.EMAIL_FROM = 'fleet@test.local';
process.env.TELEGRAM_NOTIFICATIONS_ENABLED = 'true';
process.env.TELEGRAM_BOT_TOKEN = '123456:TEST-TOKEN-NOT-REAL';
process.env.TELEGRAM_CHAT_ID = '-1001234567890';
process.env.NOTIFICATION_RETRY_BASE_MS = '10';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const { app, bearer, tokenFor } = await import('./helpers.js');
const { prisma } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const {
  deliverNotification,
  channelStates,
  __setTransportForTests,
  __resetTransportsForTests,
} = await import('../src/lib/notificationChannels.js');
const { notify } = await import('../src/lib/notifications.js');

const createdNotificationIds = [];
const createdDeliveryIds = [];

async function makeNotification(title) {
  const notification = await prisma.notification.create({
    data: { userId: 'test_admin', type: 'TEST', title, message: 'Pesan pengujian channel eksternal' },
  });
  createdNotificationIds.push(notification.id);
  return notification;
}

function track(rows) {
  for (const row of rows) createdDeliveryIds.push(row.id);
  return rows;
}

after(async () => {
  __resetTransportsForTests();
  if (createdDeliveryIds.length) {
    await prisma.notificationDelivery.deleteMany({ where: { id: { in: createdDeliveryIds } } });
  }
  if (createdNotificationIds.length) {
    await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
  }
  await prisma.$disconnect();
});

test('channels report enabled state without exposing secrets', async () => {
  const states = channelStates();
  assert.equal(states.find((state) => state.channel === 'EMAIL').enabled, true);
  assert.equal(states.find((state) => state.channel === 'EMAIL').configured, true);
  assert.equal(states.find((state) => state.channel === 'TELEGRAM').enabled, true);
  assert.equal(states.find((state) => state.channel === 'TELEGRAM').configured, true);

  const admin = await tokenFor();
  const res = await request(app).get('/api/notifications/channels').set(bearer(admin));
  assert.equal(res.status, 200);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('TEST-TOKEN-NOT-REAL'), false);
  assert.equal(serialized.includes('-1001234567890'), false);
  assert.equal(serialized.includes('123456:'), false);
});

test('configured channels deliver with masked targets and record history', async () => {
  const calls = [];
  __setTransportForTests('EMAIL', async (message) => calls.push(['EMAIL', message.target, message.subject]));
  __setTransportForTests('TELEGRAM', async (message) => calls.push(['TELEGRAM', message.target, message.text]));

  const notification = await makeNotification('TEST CHANNEL SUCCESS');
  const rows = track(await deliverNotification({ notification, user: { id: 'test_admin', email: 'admin@demo.local' } }));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.status, 'SENT');
    assert.equal(row.attempts, 1);
    assert.ok(row.sentAt);
  }
  const email = rows.find((row) => row.channel === 'EMAIL');
  const telegram = rows.find((row) => row.channel === 'TELEGRAM');
  assert.equal(email.target, 'a***@demo.local');
  assert.equal(telegram.target, '***7890');
  assert.deepEqual(calls.map((call) => call[0]).sort(), ['EMAIL', 'TELEGRAM']);
  assert.equal(calls.find((call) => call[0] === 'EMAIL')[1], 'admin@demo.local');
  assert.equal(calls.find((call) => call[0] === 'TELEGRAM')[1], '-1001234567890');

  const admin = await tokenFor();
  const history = await request(app).get('/api/notifications/deliveries?status=SENT').set(bearer(admin));
  assert.equal(history.status, 200);
  assert.ok(history.body.items.some((item) => item.notificationId === notification.id));
  const stored = await prisma.notificationDelivery.findMany({ where: { notificationId: notification.id } });
  assert.equal(stored.length, 2);
  assert.ok(stored.every((row) => !String(row.target).includes('admin@demo.local')));
});

test('failed transports retry and recover within the attempt budget', async () => {
  let emailAttempts = 0;
  __setTransportForTests('EMAIL', async () => {
    emailAttempts += 1;
    if (emailAttempts < 3) throw new Error('SMTP sementara tidak tersedia');
  });
  __setTransportForTests('TELEGRAM', async () => {});

  const notification = await makeNotification('TEST CHANNEL RETRY');
  const rows = track(await deliverNotification({ notification, user: { id: 'test_admin', email: 'admin@demo.local' } }));
  const email = rows.find((row) => row.channel === 'EMAIL');
  assert.equal(emailAttempts, 3);
  assert.equal(email.status, 'SENT');
  assert.equal(email.attempts, 3);
});

test('persistent transport failures end as FAILED without leaking the token', async () => {
  __setTransportForTests('EMAIL', async () => {});
  __setTransportForTests('TELEGRAM', async () => {
    throw new Error('Telegram Bot API menolak pesan (HTTP 503)');
  });

  const notification = await makeNotification('TEST CHANNEL FAILURE');
  const rows = track(await deliverNotification({ notification, user: { id: 'test_admin', email: 'admin@demo.local' } }));
  const telegram = rows.find((row) => row.channel === 'TELEGRAM');
  assert.equal(telegram.status, 'FAILED');
  assert.equal(telegram.attempts, 3);
  assert.match(telegram.detail, /HTTP 503/);
  assert.equal(telegram.detail.includes('TEST-TOKEN-NOT-REAL'), false);
});

test('enabled but incomplete configuration skips delivery instead of sending', async () => {
  const originalHost = config.smtp.host;
  config.smtp.host = '';
  let emailCalled = false;
  __setTransportForTests('EMAIL', async () => {
    emailCalled = true;
  });
  __setTransportForTests('TELEGRAM', async () => {});

  try {
    const notification = await makeNotification('TEST CHANNEL UNCONFIGURED');
    const rows = track(await deliverNotification({ notification, user: { id: 'test_admin', email: 'admin@demo.local' } }));
    const email = rows.find((row) => row.channel === 'EMAIL');
    assert.equal(email.status, 'SKIPPED');
    assert.equal(emailCalled, false);
    assert.match(email.detail, /SMTP_HOST/);
    const state = channelStates().find((item) => item.channel === 'EMAIL');
    assert.equal(state.enabled, true);
    assert.equal(state.configured, false);
  } finally {
    config.smtp.host = originalHost;
    __setTransportForTests('EMAIL', async () => {});
  }
});

test('notify() dispatches external delivery in the background when channels are enabled', async () => {
  __setTransportForTests('EMAIL', async () => {});
  __setTransportForTests('TELEGRAM', async () => {});

  const item = await notify({ userId: 'test_admin', type: 'TEST', title: 'TEST CHANNEL NOTIFY HOOK', message: 'hook' });
  assert.ok(item?.id);
  createdNotificationIds.push(item.id);

  let rows = [];
  for (let attempt = 0; attempt < 40 && rows.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    rows = await prisma.notificationDelivery.findMany({ where: { notificationId: item.id } });
  }
  track(rows);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.status === 'SENT'));
});
