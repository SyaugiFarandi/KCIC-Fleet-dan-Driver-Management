import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, paged, pagination } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';
import { DEMO_GPS_DISCLAIMER, DEMO_GPS_SOURCE, GPS_EVENT_LABELS, etaInfo, motionStatus } from '../lib/gps.js';

const router = express.Router();

function demoMeta() {
  return { source: DEMO_GPS_SOURCE, disclaimer: DEMO_GPS_DISCLAIMER };
}

function serializeLocation(location) {
  if (!location) return null;
  return {
    id: location.id,
    lat: location.lat,
    lng: location.lng,
    speedKph: location.speedKph,
    heading: location.heading,
    ignition: location.ignition,
    accuracyM: location.accuracyM,
    source: location.source,
    tripId: location.tripId,
    recordedAt: location.recordedAt,
  };
}

function serializeDevice(device) {
  if (!device) return null;
  return {
    id: device.id,
    imei: device.imei,
    status: device.status,
    provider: device.provider,
    simNumber: device.simNumber,
    installedAt: device.installedAt,
    lastPingAt: device.lastPingAt,
  };
}

router.get('/positions', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const { status, ownership, driverId, q } = req.query;
  const vehicles = await prisma.vehicle.findMany({
    include: {
      vendor: { select: { id: true, name: true } },
      gpsDevice: true,
      trips: {
        where: { status: { in: ACTIVE_TRIP_STATUSES } },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          booking: {
            select: {
              id: true,
              code: true,
              origin: true,
              destination: true,
              departureAt: true,
              returnAt: true,
              route: { select: { estimatedMinutes: true, distanceKm: true } },
              requester: { select: { name: true, department: true } },
            },
          },
        },
      },
    },
    orderBy: { plateNumber: 'asc' },
  });

  const now = Date.now();
  const latestRows = await Promise.all(
    vehicles.map((vehicle) =>
      prisma.vehicleLocation.findFirst({ where: { vehicleId: vehicle.id }, orderBy: { recordedAt: 'desc' } })
    )
  );

  const recentDeviations = await prisma.gpsEvent.findMany({
    where: {
      type: 'ROUTE_DEVIATION',
      occurredAt: { gte: new Date(now - 30 * 60 * 1000) },
      vehicleId: { in: vehicles.map((vehicle) => vehicle.id) },
    },
    orderBy: { occurredAt: 'desc' },
    select: { id: true, vehicleId: true, message: true, occurredAt: true, acknowledgedAt: true },
  });
  const deviationByVehicle = new Map();
  for (const event of recentDeviations) {
    if (!deviationByVehicle.has(event.vehicleId)) deviationByVehicle.set(event.vehicleId, event);
  }

  const allItems = vehicles.map((vehicle, index) => {
    const location = latestRows[index];
    const trip = vehicle.trips[0] || null;
    const booking = trip?.booking || null;
    const motion = motionStatus(location, now);
    const eta = etaInfo(trip, now);
    return {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      brand: vehicle.brand,
      model: vehicle.model,
      category: vehicle.category,
      ownership: vehicle.ownership,
      status: vehicle.status,
      vendor: vehicle.vendor,
      device: serializeDevice(vehicle.gpsDevice),
      location: serializeLocation(location),
      motionStatus: motion,
      driver: trip?.driver || null,
      trip: trip
        ? {
            id: trip.id,
            status: trip.status,
            bookingId: trip.bookingId,
            code: booking?.code || null,
            origin: booking?.origin || null,
            destination: booking?.destination || null,
            departureAt: booking?.departureAt || null,
            returnAt: booking?.returnAt || null,
            distanceKm: booking?.route?.distanceKm ?? null,
          }
        : null,
      etaAt: eta?.etaAt || null,
      etaMinutes: eta?.remainingMinutes ?? null,
      etaStatus: eta?.status || null,
      deviation: deviationByVehicle.get(vehicle.id) || null,
      destination: booking?.destination || null,
      requester: booking?.requester ? { name: booking.requester.name, department: booking.requester.department } : null,
      lastUpdateAt: location?.recordedAt || null,
    };
  });

  const counts = {
    total: allItems.length,
    moving: allItems.filter((item) => item.motionStatus === 'MOVING').length,
    stopped: allItems.filter((item) => item.motionStatus === 'STOPPED').length,
    offline: allItems.filter((item) => item.motionStatus === 'OFFLINE').length,
    withDevice: allItems.filter((item) => item.device).length,
    deviations: allItems.filter((item) => item.deviation).length,
  };

  const needle = String(q || '').trim().toLowerCase();
  const items = allItems.filter((item) => {
    if (status && status !== 'ALL' && item.motionStatus !== status) return false;
    if (ownership && ownership !== 'ALL' && item.ownership !== ownership) return false;
    if (driverId && item.driver?.id !== driverId) return false;
    if (needle) {
      const haystack = [
        item.plateNumber,
        item.brand,
        item.model,
        item.destination,
        item.trip?.origin,
        item.destination,
        item.driver?.name,
        item.vendor?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  res.json({
    items,
    totalFiltered: items.length,
    counts,
    generatedAt: new Date(now).toISOString(),
    ...demoMeta(),
  });
}));

router.get('/options', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({
      select: {
        id: true,
        plateNumber: true,
        brand: true,
        model: true,
        status: true,
        ownership: true,
        gpsDevice: { select: { id: true, imei: true, status: true } },
      },
      orderBy: { plateNumber: 'asc' },
    }),
    prisma.driver.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({
    vehicles,
    drivers,
    eventTypes: Object.entries(GPS_EVENT_LABELS).map(([value, label]) => ({ value, label })),
    geofenceCategories: [
      { value: 'STATION', label: 'Stasiun' },
      { value: 'DEPOT', label: 'Depo' },
      { value: 'OFFICE', label: 'Kantor' },
      { value: 'AIRPORT', label: 'Bandara' },
      { value: 'ZONE', label: 'Zona Operasional' },
    ],
    ...demoMeta(),
  });
}));

router.get('/vehicles/:id', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: req.params.id },
    include: { vendor: { select: { id: true, name: true } }, gpsDevice: true },
  });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');

  const [location, trip, events, trips] = await Promise.all([
    prisma.vehicleLocation.findFirst({
      where: { vehicleId: vehicle.id },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.trip.findFirst({
      where: { vehicleId: vehicle.id, status: { in: ACTIVE_TRIP_STATUSES } },
      orderBy: { assignedAt: 'desc' },
      include: {
        driver: { select: { id: true, name: true, phone: true } },
        booking: {
          include: {
            route: true,
            requester: { select: { id: true, name: true, department: true } },
          },
        },
      },
    }),
    prisma.gpsEvent.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { occurredAt: 'desc' },
      take: 10,
      include: {
        geofence: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.trip.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { assignedAt: 'desc' },
      take: 10,
      include: {
        driver: { select: { id: true, name: true } },
        booking: { select: { id: true, code: true, origin: true, destination: true, departureAt: true, returnAt: true } },
        _count: { select: { locations: true } },
      },
    }),
  ]);

  res.json({
    vehicle: {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      brand: vehicle.brand,
      model: vehicle.model,
      category: vehicle.category,
      capacity: vehicle.capacity,
      ownership: vehicle.ownership,
      status: vehicle.status,
      vendor: vehicle.vendor,
    },
    device: serializeDevice(vehicle.gpsDevice),
    location: serializeLocation(location),
    motionStatus: motionStatus(location),
    activeTrip: trip,
    eta: etaInfo(trip),
    events,
    trips,
    ...demoMeta(),
  });
}));

router.get('/vehicles/:id/history', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');

  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'Rentang waktu riwayat tidak valid');
  }
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));

  const rows = await prisma.vehicleLocation.findMany({
    where: {
      vehicleId: vehicle.id,
      recordedAt: { gte: from, lte: to },
      ...(req.query.tripId ? { tripId: req.query.tripId } : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  });
  rows.reverse();

  res.json({ items: rows.map(serializeLocation), from, to, ...demoMeta() });
}));

router.get('/trips/:tripId/replay', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const trip = await prisma.trip.findUnique({
    where: { id: req.params.tripId },
    include: {
      booking: { select: { id: true, code: true, origin: true, destination: true, departureAt: true, returnAt: true } },
      vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
      driver: { select: { id: true, name: true } },
    },
  });
  if (!trip) throw new HttpError(404, 'Perjalanan tidak ditemukan');

  let points = await prisma.vehicleLocation.findMany({
    where: { tripId: trip.id },
    orderBy: { recordedAt: 'asc' },
    take: 2000,
  });

  if (points.length === 0) {
    const start = trip.startedAt || trip.acceptedAt || trip.assignedAt;
    const end = trip.completedAt || trip.cancelledAt || new Date(start.getTime() + 3 * 60 * 60 * 1000);
    points = await prisma.vehicleLocation.findMany({
      where: { vehicleId: trip.vehicleId, recordedAt: { gte: start, lte: end } },
      orderBy: { recordedAt: 'asc' },
      take: 2000,
    });
  }

  res.json({
    trip: {
      id: trip.id,
      status: trip.status,
      booking: trip.booking,
      vehicle: trip.vehicle,
      driver: trip.driver,
      startedAt: trip.startedAt,
      completedAt: trip.completedAt,
    },
    points: points.map(serializeLocation),
    ...demoMeta(),
  });
}));

router.get('/events', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const page = pagination(req, { defaultPageSize: 30, maxPageSize: 200 });
  const { type, vehicleId, q, acknowledged } = req.query;
  const baseWhere = {
    ...(type && type !== 'ALL' ? { type } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(q ? { message: { contains: q, mode: 'insensitive' } } : {}),
  };
  const where = {
    ...baseWhere,
    ...(acknowledged === 'false' ? { acknowledgedAt: null } : acknowledged === 'true' ? { acknowledgedAt: { not: null } } : {}),
  };
  const [items, total, unacknowledged] = await Promise.all([
    prisma.gpsEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: page.skip,
      take: page.take,
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        geofence: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.gpsEvent.count({ where }),
    prisma.gpsEvent.count({ where: { ...baseWhere, acknowledgedAt: null } }),
  ]);
  res.json({ ...paged(items, total, page), unacknowledged, labels: GPS_EVENT_LABELS, ...demoMeta() });
}));

router.patch('/events/:id/acknowledge', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const existing = await prisma.gpsEvent.findUnique({
    where: { id: req.params.id },
    include: { vehicle: { select: { id: true, plateNumber: true } } },
  });
  if (!existing) throw new HttpError(404, 'Event GPS tidak ditemukan');
  if (existing.acknowledgedAt) throw new HttpError(409, 'Event sudah dikonfirmasi');

  const item = await prisma.gpsEvent.update({
    where: { id: existing.id },
    data: { acknowledgedAt: new Date(), acknowledgedById: req.user.id },
    include: {
      vehicle: { select: { id: true, plateNumber: true } },
      acknowledgedBy: { select: { id: true, name: true } },
    },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'GPS_EVENT_ACK',
    entity: 'GpsEvent',
    entityId: item.id,
    detail: `${item.type} ${existing.vehicle.plateNumber}`,
  });
  res.json(item);
}));

const geofenceSchema = z.object({
  name: z.string().trim().min(3, 'Nama geofence minimal 3 karakter').max(80),
  category: z.enum(['STATION', 'DEPOT', 'OFFICE', 'AIRPORT', 'ZONE']).optional().default('ZONE'),
  centerLat: z.coerce.number().min(-90).max(90),
  centerLng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(50, 'Radius minimal 50 meter').max(20000),
  active: z.boolean().optional().default(true),
  notes: z.string().trim().max(300).optional().nullable(),
});

router.get('/geofences', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const items = await prisma.geofence.findMany({ orderBy: { name: 'asc' } });
  res.json({ items, ...demoMeta() });
}));

router.post('/geofences', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const data = geofenceSchema.parse(req.body);
  const existing = await prisma.geofence.findFirst({ where: { name: data.name }, select: { id: true } });
  if (existing) throw new HttpError(409, 'Nama geofence sudah digunakan');
  const item = await prisma.geofence.create({ data: { ...data, notes: data.notes || null } });
  await writeAudit({
    userId: req.user.id,
    action: 'GEOFENCE_CREATE',
    entity: 'Geofence',
    entityId: item.id,
    detail: `${item.name} (${item.radiusM} m)`,
  });
  res.status(201).json(item);
}));

router.patch('/geofences/:id', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const existing = await prisma.geofence.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Geofence tidak ditemukan');
  const data = geofenceSchema.partial().parse(req.body);
  if (data.name) {
    const duplicate = await prisma.geofence.findFirst({
      where: { name: data.name, id: { not: existing.id } },
      select: { id: true },
    });
    if (duplicate) throw new HttpError(409, 'Nama geofence sudah digunakan');
  }
  const item = await prisma.geofence.update({
    where: { id: existing.id },
    data: { ...data, ...(data.notes === '' ? { notes: null } : {}) },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'GEOFENCE_UPDATE',
    entity: 'Geofence',
    entityId: item.id,
    detail: item.name,
  });
  res.json(item);
}));

router.delete('/geofences/:id', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const existing = await prisma.geofence.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Geofence tidak ditemukan');
  await prisma.geofence.delete({ where: { id: existing.id } });
  await writeAudit({
    userId: req.user.id,
    action: 'GEOFENCE_DELETE',
    entity: 'Geofence',
    entityId: existing.id,
    detail: existing.name,
  });
  res.json({ ok: true });
}));

const deviceSchema = z.object({
  imei: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{6,24}$/, 'IMEI harus 6-24 karakter alfanumerik'),
  vehicleId: z.string().trim().min(1, 'Kendaraan wajib dipilih'),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  provider: z.string().trim().max(40).optional().default(DEMO_GPS_SOURCE),
  simNumber: z.string().trim().max(30).optional().nullable(),
  installedAt: z.coerce.date().optional().nullable(),
});

router.get('/devices', requirePermission('gps:read'), asyncRoute(async (req, res) => {
  const items = await prisma.gpsDevice.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, ownership: true, status: true } },
    },
  });
  res.json({ items, ...demoMeta() });
}));

router.post('/devices', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const data = deviceSchema.parse(req.body);
  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId }, select: { id: true, plateNumber: true, gpsDevice: { select: { id: true } } } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (vehicle.gpsDevice) throw new HttpError(409, `Kendaraan ${vehicle.plateNumber} sudah memiliki perangkat GPS`);
  const duplicate = await prisma.gpsDevice.findUnique({ where: { imei: data.imei }, select: { id: true } });
  if (duplicate) throw new HttpError(409, 'IMEI sudah terdaftar');

  const item = await prisma.gpsDevice.create({
    data: {
      imei: data.imei,
      vehicleId: data.vehicleId,
      status: data.status,
      provider: data.provider,
      simNumber: data.simNumber || null,
      installedAt: data.installedAt || null,
    },
    include: { vehicle: { select: { id: true, plateNumber: true } } },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'GPS_DEVICE_CREATE',
    entity: 'GpsDevice',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.imei}`,
  });
  res.status(201).json(item);
}));

router.patch('/devices/:id', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const existing = await prisma.gpsDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Perangkat GPS tidak ditemukan');
  const data = deviceSchema.partial().parse(req.body);

  if (data.vehicleId && data.vehicleId !== existing.vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: data.vehicleId },
      select: { id: true, plateNumber: true, gpsDevice: { select: { id: true } } },
    });
    if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
    if (vehicle.gpsDevice) throw new HttpError(409, `Kendaraan ${vehicle.plateNumber} sudah memiliki perangkat GPS`);
  }
  if (data.imei && data.imei !== existing.imei) {
    const duplicate = await prisma.gpsDevice.findUnique({ where: { imei: data.imei }, select: { id: true } });
    if (duplicate) throw new HttpError(409, 'IMEI sudah terdaftar');
  }

  const item = await prisma.gpsDevice.update({
    where: { id: existing.id },
    data: {
      ...(data.imei !== undefined ? { imei: data.imei } : {}),
      ...(data.vehicleId !== undefined ? { vehicleId: data.vehicleId } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.provider !== undefined ? { provider: data.provider } : {}),
      ...(data.simNumber !== undefined ? { simNumber: data.simNumber || null } : {}),
      ...(data.installedAt !== undefined ? { installedAt: data.installedAt || null } : {}),
    },
    include: { vehicle: { select: { id: true, plateNumber: true } } },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'GPS_DEVICE_UPDATE',
    entity: 'GpsDevice',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.imei}`,
  });
  res.json(item);
}));

router.delete('/devices/:id', requirePermission('gps:write'), asyncRoute(async (req, res) => {
  const existing = await prisma.gpsDevice.findUnique({
    where: { id: req.params.id },
    include: { vehicle: { select: { plateNumber: true } } },
  });
  if (!existing) throw new HttpError(404, 'Perangkat GPS tidak ditemukan');
  await prisma.gpsDevice.delete({ where: { id: existing.id } });
  await writeAudit({
    userId: req.user.id,
    action: 'GPS_DEVICE_DELETE',
    entity: 'GpsDevice',
    entityId: existing.id,
    detail: `${existing.vehicle.plateNumber}: ${existing.imei}`,
  });
  res.json({ ok: true });
}));

export default router;
