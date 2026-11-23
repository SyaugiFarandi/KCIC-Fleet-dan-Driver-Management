import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function channelForUser(userId) {
  return `notification:${userId}`;
}

export function publishNotification(userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) bus.emit(channelForUser(userId), { at: Date.now() });
}

export function subscribeUser(userId, handler) {
  const channel = channelForUser(userId);
  bus.on(channel, handler);
  return () => bus.off(channel, handler);
}

export function subscribe(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}
