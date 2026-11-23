import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';
import { LIVE_GPS_SOURCE, gpsIngestConfigured, telemetryStatus, verifyGpsIngestToken } from '../lib/gpsProviders.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

const telemetrySchema = z.object({
  imei: z.string().trim().min(6, 'IMEI minimal 6 karakter').max(24),
  lat: z.coerce.number().min(-90, 'Latitude tidak valid').max(90, 'Latitude tidak valid'),
  lng: z.coerce.number().min(-180, 'Longitude tidak valid').max(180, 'Longitude tidak valid'),
  speedKph: z.coerce.number().min(0).max(300).optional(),
  heading: z.coerce.number().min(0).max(360).optional().nullable(),
  ignition: z.boolean().optional(),
  accuracyM: z.coerce.number().min(0).max(5000).optional().nullable(),
  recordedAt: z.coerce.date().optional(),
});

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;

router.post('/', asyncRoute(async (req, res) => {
  if (!gpsIngestConfigured()) throw new HttpError(404, 'Endpoint tidak ditemukan');
  if (!verifyGpsIngestToken(req.get('x-gps-token'))) {
    throw new HttpError(401, 'Token ingest GPS tidak valid');
  }

  const payload = telemetrySchema.parse(req.body);
  const recordedAt = payload.recordedAt || new Date();
  const now = Date.now();
  if (recordedAt.getTime() > now + MAX_FUTURE_SKEW_MS) {
    throw new HttpError(400, 'Waktu telemetri melebihi toleransi clock perangkat');
  }
  if (now - recordedAt.getTime() > MAX_BACKFILL_MS) {
    throw new HttpError(400, 'Waktu telemetri terlalu lama (maksimal 7 hari)');
  }

  const device = await prisma.gpsDevice.findUnique({
    where: { imei: payload.imei },
    include: { vehicle: { select: { id: true, plateNumber: true } } },
  });
  if (!device) throw new HttpError(404, 'IMEI tidak terdaftar');
  if (device.status !== 'ACTIVE') throw new HttpError(409, 'Perangkat GPS tidak aktif');

  const trip = await prisma.trip.findFirst({
    where: { vehicleId: device.vehicleId, status: { in: ACTIVE_TRIP_STATUSES } },
    orderBy: { assignedAt: 'desc' },
    select: { id: true, bookingId: true },
  });

  const location = await prisma.vehicleLocation.create({
    data: {
      vehicleId: device.vehicleId,
      deviceId: device.id,
      tripId: trip?.id || null,
      lat: payload.lat,
      lng: payload.lng,
      speedKph: payload.speedKph ?? 0,
      heading: payload.heading ?? null,
      ignition: payload.ignition ?? true,
      accuracyM: payload.accuracyM ?? null,
      source: LIVE_GPS_SOURCE,
      recordedAt,
    },
  });

  if (!device.lastPingAt || device.lastPingAt.getTime() < recordedAt.getTime()) {
    await prisma.gpsDevice.update({ where: { id: device.id }, data: { lastPingAt: recordedAt } });
  }

  logger.info('gps_telemetry_ingested', {
    requestId: req.id,
    deviceId: device.id,
    vehicleId: device.vehicleId,
    recordedAt: recordedAt.toISOString(),
  });

  res.status(201).json({
    ok: true,
    locationId: location.id,
    vehicleId: device.vehicleId,
    plateNumber: device.vehicle.plateNumber,
    tripId: trip?.id || null,
    telemetryStatus: telemetryStatus(location, device),
    recordedAt,
  });
}));

export default router;
