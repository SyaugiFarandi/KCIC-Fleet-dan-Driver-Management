import { prisma } from '../db.js';
import { ACTIVE_TRIP_STATUSES } from './workflow.js';
import { DEMO_GPS_SOURCE, DEVIATION_THRESHOLD_M, GPS_PLACES, distanceMeters, parkedPoint, routePoint, simulatedDeviationOffset } from './gps.js';
import { notifyGpsEvent } from './notifications.js';
import { observeGpsTick } from './metrics.js';
import { logger } from './logger.js';

/**
 * DEMO-only GPS simulator. It advances vehicle coordinates along the booked
 * route and writes telemetry with source DEMO_SIMULATOR. It is intentionally
 * separate from any real GPS/provider integration.
 */
let timer = null;
let ticking = false;
let intervalMs = 0;
const state = { ticks: 0, lastTickAt: null, lastDurationMs: null, lastError: null };

export function gpsSimulatorStatus() {
  return {
    enabled: Boolean(timer),
    intervalMs,
    ticks: state.ticks,
    lastTickAt: state.lastTickAt,
    lastTickAgeSeconds: state.lastTickAt ? Math.round((Date.now() - state.lastTickAt) / 1000) : null,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError,
  };
}

export function startGpsSimulator({ intervalMs: configuredMs = 15_000 } = {}) {
  if (timer) return timer;
  intervalMs = configuredMs;
  const tick = () => {
    runGpsTick().catch((err) => logger.error('gps_simulator_tick_failed', { error: err.message }));
  };
  tick();
  timer = setInterval(tick, configuredMs);
  timer.unref?.();
  logger.info('gps_simulator_started', { intervalMs: configuredMs, source: DEMO_GPS_SOURCE });
  return timer;
}

export function stopGpsSimulator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  intervalMs = 0;
}

export function tripProgress(trip, nowMs = Date.now()) {
  const startRaw = trip.startedAt || trip.acceptedAt || trip.assignedAt;
  const startMs = startRaw ? new Date(startRaw).getTime() : nowMs;
  const estimatedMinutes = trip.booking?.route?.estimatedMinutes || 45;
  const durationMs = Math.max(15 * 60 * 1000, estimatedMinutes * 60 * 1000);
  return Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
}

async function maybeOverspeed({ vehicle, device, trip, point, speedKph, recordedAt }) {
  if (speedKph <= 80) return null;
  const recent = await prisma.gpsEvent.findFirst({
    where: {
      vehicleId: vehicle.id,
      type: 'OVERSPEED',
      occurredAt: { gte: new Date(recordedAt.getTime() - 10 * 60 * 1000) },
    },
  });
  if (recent) return null;
  return prisma.gpsEvent.create({
    data: {
      vehicleId: vehicle.id,
      deviceId: device.id,
      tripId: trip?.id || null,
      type: 'OVERSPEED',
      message: `${vehicle.plateNumber} terdeteksi ${Math.round(speedKph)} km/jam (batas 80 km/jam)`,
      lat: point.lat,
      lng: point.lng,
      speedKph,
      source: DEMO_GPS_SOURCE,
      occurredAt: recordedAt,
    },
  });
}

export async function runGpsTick(nowMs = Date.now()) {
  if (ticking) return { skipped: true, written: 0 };
  ticking = true;
  const started = Date.now();
  let ok = false;
  try {
    const [vehicles, geofences] = await Promise.all([
      prisma.vehicle.findMany({
        include: {
          gpsDevice: true,
          trips: {
            where: { status: { in: ACTIVE_TRIP_STATUSES } },
            orderBy: { assignedAt: 'desc' },
            take: 1,
            include: { booking: { include: { route: true } }, driver: true },
          },
        },
      }),
      prisma.geofence.findMany({ where: { active: true } }),
    ]);

    let written = 0;
    let events = 0;

    for (const [index, vehicle] of vehicles.entries()) {
      const device = vehicle.gpsDevice;
      if (!device || device.status !== 'ACTIVE') continue;
      // Parked out of service: no fresh ping, so the vehicle shows as OFFLINE.
      if (vehicle.status === 'INACTIVE' || vehicle.status === 'MAINTENANCE') continue;

      const trip = vehicle.trips[0] || null;
      const booking = trip?.booking || null;
      let point;
      let expectedPoint = null;
      let speedKph = 0;
      let ignition = false;

      if (trip && booking) {
        ignition = true;
        if (trip.status === 'PICKED_UP' || trip.status === 'IN_PROGRESS') {
          const progress = tripProgress(trip, nowMs);
          const basePoint = routePoint(booking.origin, booking.destination, progress);
          const offset = simulatedDeviationOffset(vehicle.id, progress);
          point = offset
            ? {
                ...basePoint,
                lat: Number((basePoint.lat + offset.lat).toFixed(5)),
                lng: Number((basePoint.lng + offset.lng).toFixed(5)),
              }
            : basePoint;
          expectedPoint = basePoint;
          if (progress < 1) {
            const wave = 0.5 + 0.5 * Math.sin(nowMs / 45_000 + index * 1.7);
            speedKph = Math.round((38 + 22 * wave) * 10) / 10;
          }
        } else {
          point = GPS_PLACES[booking.origin] || routePoint(booking.origin, booking.destination, 0);
          point = { ...point, heading: 0 };
        }
      } else {
        point = parkedPoint(vehicle.id, vehicle.ownership, vehicle.vendorId);
      }

      const recordedAt = new Date(nowMs);
      const previous = await prisma.vehicleLocation.findFirst({
        where: { vehicleId: vehicle.id },
        orderBy: { recordedAt: 'desc' },
      });

      await prisma.vehicleLocation.create({
        data: {
          vehicleId: vehicle.id,
          deviceId: device.id,
          tripId: trip?.id || null,
          lat: point.lat,
          lng: point.lng,
          speedKph,
          heading: point.heading ?? 0,
          ignition,
          accuracyM: Math.round((6 + (index % 7)) * 10) / 10,
          source: DEMO_GPS_SOURCE,
          recordedAt,
        },
      });
      await prisma.gpsDevice.update({ where: { id: device.id }, data: { lastPingAt: recordedAt } });
      written += 1;

      for (const fence of geofences) {
        const insideNow = distanceMeters(point.lat, point.lng, fence.centerLat, fence.centerLng) <= fence.radiusM;
        if (!previous) continue;
        const insideBefore =
          distanceMeters(previous.lat, previous.lng, fence.centerLat, fence.centerLng) <= fence.radiusM;
        if (insideNow === insideBefore) continue;
        await prisma.gpsEvent.create({
          data: {
            vehicleId: vehicle.id,
            deviceId: device.id,
            tripId: trip?.id || null,
            geofenceId: fence.id,
            type: insideNow ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT',
            message: `${vehicle.plateNumber} ${insideNow ? 'masuk' : 'keluar'} area ${fence.name}`,
            lat: point.lat,
            lng: point.lng,
            speedKph,
            source: DEMO_GPS_SOURCE,
            occurredAt: recordedAt,
          },
        });
        events += 1;
        notifyGpsEvent({
          type: insideNow ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT',
          message: `${vehicle.plateNumber} ${insideNow ? 'masuk' : 'keluar'} area ${fence.name}`,
          vehicleId: vehicle.id,
          vehicle,
        }).catch(() => {});
      }

      const overspeed = await maybeOverspeed({ vehicle, device, trip, point, speedKph, recordedAt });
      if (overspeed) {
        events += 1;
        notifyGpsEvent({ ...overspeed, vehicle }).catch(() => {});
      }

      if (expectedPoint) {
        const deviationM = distanceMeters(point.lat, point.lng, expectedPoint.lat, expectedPoint.lng);
        if (deviationM > DEVIATION_THRESHOLD_M) {
          const recentDeviation = await prisma.gpsEvent.findFirst({
            where: {
              vehicleId: vehicle.id,
              type: 'ROUTE_DEVIATION',
              occurredAt: { gte: new Date(recordedAt.getTime() - 30 * 60 * 1000) },
            },
          });
          if (!recentDeviation) {
            const event = await prisma.gpsEvent.create({
              data: {
                vehicleId: vehicle.id,
                deviceId: device.id,
                tripId: trip?.id || null,
                type: 'ROUTE_DEVIATION',
                message: `${vehicle.plateNumber} menyimpang ${(deviationM / 1000).toFixed(1)} km dari rute ${booking.origin} → ${booking.destination}`,
                lat: point.lat,
                lng: point.lng,
                speedKph,
                source: DEMO_GPS_SOURCE,
                occurredAt: recordedAt,
              },
            });
            events += 1;
            notifyGpsEvent({ ...event, vehicle }).catch(() => {});
          }
        }
      }
    }

    ok = true;
    return { skipped: false, written, events, at: new Date(nowMs).toISOString() };
  } catch (err) {
    state.lastError = err.message;
    throw err;
  } finally {
    ticking = false;
    const durationMs = Date.now() - started;
    state.ticks += 1;
    state.lastTickAt = Date.now();
    state.lastDurationMs = durationMs;
    if (ok) state.lastError = null;
    observeGpsTick({ ok, durationMs });
  }
}
