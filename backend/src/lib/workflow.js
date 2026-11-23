import { HttpError } from './http.js';

export const ACTIVE_TRIP_STATUSES = ['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS'];

export const TRIP_TRANSITIONS = {
  SCHEDULED: ['DRIVER_ACCEPTED', 'CANCELLED'],
  DRIVER_ACCEPTED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TRIP_STATUS_LABELS = {
  SCHEDULED: 'Dijadwalkan',
  DRIVER_ACCEPTED: 'Diterima Driver',
  PICKED_UP: 'Penumpang Diambil',
  IN_PROGRESS: 'Dalam Perjalanan',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const BOOKING_TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['ASSIGNED', 'CANCELLED'],
  REJECTED: [],
  ASSIGNED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(map, from, to) {
  return Boolean(map[from]?.includes(to));
}

export function assertTransition(map, from, to, message = 'Perubahan status tidak valid') {
  if (!canTransition(map, from, to)) throw new HttpError(409, message);
}

/** Effective usage window of a booking: departure -> return (or departure + 4 hours). */
export function usageWindow(booking) {
  const start = new Date(booking.departureAt).getTime();
  const rawEnd = booking.returnAt ? new Date(booking.returnAt).getTime() : start + 4 * 60 * 60 * 1000;
  return { start, end: Math.max(rawEnd, start + 60 * 60 * 1000) };
}

export function windowsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}
