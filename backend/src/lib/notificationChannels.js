import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * External notification adapters (email via SMTP, Telegram via Bot API).
 * In-app notifications always work; external delivery only starts when a
 * channel is explicitly enabled and fully configured, and every attempt is
 * recorded in NotificationDelivery so operators can audit what was sent.
 */
export const CHANNELS = ['EMAIL', 'TELEGRAM'];
export const MAX_ATTEMPTS = 3;
const DETAIL_LIMIT = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function maskEmail(value) {
  const [local, domain] = String(value || '').split('@');
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskChat(value) {
  const text = String(value || '');
  if (!text) return null;
  return `***${text.slice(-4)}`;
}

function maskTarget(channel, target) {
  return channel === 'EMAIL' ? maskEmail(target) : maskChat(target);
}

export function channelStates() {
  const emailConfigured = Boolean(config.smtp.host && config.smtp.from);
  const telegramConfigured = Boolean(config.telegram.botToken && config.telegram.chatId);
  return [
    {
      channel: 'EMAIL',
      label: 'Email (SMTP)',
      enabled: config.emailNotificationsEnabled,
      configured: emailConfigured,
      transport: 'SMTP',
      problem:
        config.emailNotificationsEnabled && !emailConfigured
          ? 'SMTP_HOST dan EMAIL_FROM wajib diisi sebelum email dapat dikirim.'
          : null,
    },
    {
      channel: 'TELEGRAM',
      label: 'Telegram (Bot API)',
      enabled: config.telegramNotificationsEnabled,
      configured: telegramConfigured,
      transport: 'HTTPS Bot API',
      problem:
        config.telegramNotificationsEnabled && !telegramConfigured
          ? 'TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID wajib diisi sebelum pesan dapat dikirim.'
          : null,
    },
  ];
}

export function hasEnabledChannels() {
  return channelStates().some((state) => state.enabled);
}

const defaultTransports = {
  async EMAIL(message) {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    await transport.sendMail({
      from: config.smtp.from,
      to: message.target,
      subject: message.subject,
      text: message.text,
    });
  },
  async TELEGRAM(message) {
    const base = config.telegram.apiBase.replace(/\/+$/, '');
    const url = `${base}/bot${config.telegram.botToken}/sendMessage`;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: message.target, text: message.text, disable_web_page_preview: true }),
      });
    } catch {
      // Never surface the request URL here: it contains the bot token.
      throw new Error('Gagal menghubungi Telegram Bot API');
    }
    if (!response.ok) throw new Error(`Telegram Bot API menolak pesan (HTTP ${response.status})`);
  },
};

const transports = { ...defaultTransports };

export function __setTransportForTests(channel, handler) {
  transports[channel] = handler;
}

export function __resetTransportsForTests() {
  Object.assign(transports, defaultTransports);
}

function messageFor(notification, target) {
  const link = notification.link ? `\n\nBuka: ${notification.link}` : '';
  return {
    target,
    subject: `[KCIC Fleet] ${notification.title}`,
    text: `${notification.title}\n\n${notification.message}${link}`,
  };
}

async function createRecord({ notification, channel, status, target, detail = null }) {
  return prisma.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      userId: notification.userId,
      channel,
      status,
      target,
      detail,
    },
  });
}

async function attemptWithRetry(record, message) {
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await transports[record.channel](message);
      return prisma.notificationDelivery.update({
        where: { id: record.id },
        data: { status: 'SENT', attempts: attempt, sentAt: new Date(), detail: null },
      });
    } catch (err) {
      lastError = String(err?.message || err).slice(0, DETAIL_LIMIT);
      await prisma.notificationDelivery.update({
        where: { id: record.id },
        data: { attempts: attempt, detail: lastError },
      });
      if (attempt < MAX_ATTEMPTS) await sleep(config.notificationRetryBaseMs * attempt);
    }
  }
  logger.warn('notification_delivery_failed', {
    channel: record.channel,
    deliveryId: record.id,
    attempts: MAX_ATTEMPTS,
    error: lastError,
  });
  return prisma.notificationDelivery.update({
    where: { id: record.id },
    data: { status: 'FAILED', detail: lastError },
  });
}

/**
 * Delivers one in-app notification to every enabled external channel.
 * Returns the delivery rows; never throws so callers may fire-and-forget.
 */
export async function deliverNotification({ notification, user }) {
  try {
    const active = channelStates().filter((state) => state.enabled);
    if (!active.length) return [];
    const results = [];
    for (const state of active) {
      const rawTarget = state.channel === 'EMAIL' ? user?.email : config.telegram.chatId;
      if (!state.configured) {
        results.push(
          await createRecord({
            notification,
            channel: state.channel,
            status: 'SKIPPED',
            target: maskTarget(state.channel, rawTarget),
            detail: state.problem || 'Konfigurasi channel belum lengkap',
          })
        );
        continue;
      }
      if (!rawTarget) {
        results.push(
          await createRecord({
            notification,
            channel: state.channel,
            status: 'SKIPPED',
            target: null,
            detail: 'Tujuan pengiriman tidak tersedia',
          })
        );
        continue;
      }
      const record = await createRecord({
        notification,
        channel: state.channel,
        status: 'PENDING',
        target: maskTarget(state.channel, rawTarget),
      });
      results.push(await attemptWithRetry(record, messageFor(notification, rawTarget)));
    }
    return results;
  } catch (err) {
    logger.error('notification_delivery_setup_failed', { notificationId: notification?.id, error: err.message });
    return [];
  }
}

export function dispatchNotificationDelivery({ notification, user }) {
  if (!notification || !hasEnabledChannels()) return;
  void deliverNotification({ notification, user });
}
