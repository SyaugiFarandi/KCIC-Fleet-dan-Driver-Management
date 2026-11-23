import './env.js';
import request from 'supertest';
import { buildApp } from '../src/app.js';

export const app = buildApp();
const cache = new Map();

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export async function tokenFor(email = 'admin@demo.local', password = 'Demo123!') {
  const key = `${email}|${password}`;
  if (cache.has(key)) return cache.get(key);
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  cache.set(key, res.body.token);
  return res.body.token;
}

export function futureIso(hoursAhead = 48) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

export async function makeBooking(token, overrides = {}) {
  return request(app)
    .post('/api/bookings')
    .set(bearer(token))
    .send({
      department: 'QA',
      purpose: 'Perjalanan pengujian otomatis',
      passengerCount: 2,
      origin: 'Stasiun Halim',
      destination: 'Kantor Pusat',
      departureAt: futureIso(48),
      ...overrides,
    });
}

export async function approveBooking(token, id) {
  return request(app).patch(`/api/bookings/${id}/decision`).set(bearer(token)).send({ decision: 'APPROVED' });
}

export async function cancelBooking(token, id, reason = 'Pengujian selesai') {
  return request(app).patch(`/api/bookings/${id}/cancel`).set(bearer(token)).send({ reason });
}

export async function assignTrip(token, bookingId, vehicleId = 'veh_t1', driverId = 'drv_t2') {
  return request(app).post('/api/trips').set(bearer(token)).send({ bookingId, vehicleId, driverId });
}

export async function listItems(token, path) {
  const res = await request(app).get(path).set(bearer(token));
  if (res.status !== 200) throw new Error(`GET ${path} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.items;
}

export async function findById(token, path, id) {
  const items = await listItems(token, path);
  return items.find((item) => item.id === id);
}
