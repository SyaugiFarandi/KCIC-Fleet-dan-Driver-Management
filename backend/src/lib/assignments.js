import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { ACTIVE_TRIP_STATUSES, usageWindow, windowsOverlap } from './workflow.js';

const db = (tx) => tx ?? prisma;

export const BLOCKING_DEFECT_STATUSES = ['OPEN', 'IN_REPAIR'];

async function blockedVehicleIds(client) {
  const criticalDefects = await client.defect.findMany({
    where: { status: { in: BLOCKING_DEFECT_STATUSES }, severity: 'CRITICAL' },
    select: { vehicleId: true },
  });
  return new Set(criticalDefects.map((defect) => defect.vehicleId));
}

async function overlappingTrips(tx, booking, excludeTripId) {
  const client = db(tx);
  const trips = await client.trip.findMany({
    where: {
      status: { in: ACTIVE_TRIP_STATUSES },
      ...(excludeTripId ? { id: { not: excludeTripId } } : {}),
    },
    include: { booking: true, vehicle: true, driver: true },
  });
  const window = usageWindow(booking);
  return { window, trips: trips.filter((t) => windowsOverlap(window, usageWindow(t.booking))) };
}

/** Returns vehicles and drivers that are eligible for the booking's schedule. */
export async function availabilityFor(tx, booking, excludeTripId) {
  const client = db(tx);
  const { window, trips } = await overlappingTrips(tx, booking, excludeTripId);
  const busyVehicleIds = new Set(trips.map((t) => t.vehicleId));
  const busyDriverIds = new Set(trips.map((t) => t.driverId));
  const activeMaintenance = await client.maintenance.findMany({
    where: { status: 'IN_PROGRESS' },
    select: { vehicleId: true },
  });
  const maintenanceIds = new Set(activeMaintenance.map((m) => m.vehicleId));
  const blockedIds = await blockedVehicleIds(client);

  const [vehicles, drivers] = await Promise.all([
    client.vehicle.findMany({
      where: { status: { in: ['AVAILABLE', 'ASSIGNED'] }, capacity: { gte: booking.passengerCount } },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { plateNumber: 'asc' },
    }),
    client.driver.findMany({
      where: { active: true },
      include: { vendor: { select: { id: true, name: true } }, user: { select: { id: true, email: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    window: {
      from: new Date(window.start).toISOString(),
      to: new Date(window.end).toISOString(),
    },
    vehicles: vehicles.filter((v) => !busyVehicleIds.has(v.id) && !maintenanceIds.has(v.id) && !blockedIds.has(v.id)),
    drivers: drivers.filter(
      (d) => !busyDriverIds.has(d.id) && new Date(d.licenseExpiry).getTime() >= window.start
    ),
  };
}

export async function assertAssignable(tx, booking, { vehicleId, driverId, excludeTripId }) {
  const client = db(tx);
  const [vehicle, driver] = await Promise.all([
    client.vehicle.findUnique({ where: { id: vehicleId } }),
    client.driver.findUnique({ where: { id: driverId } }),
  ]);
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (!driver) throw new HttpError(404, 'Driver tidak ditemukan');

  if (vehicle.status === 'INACTIVE') throw new HttpError(409, 'Kendaraan sedang tidak aktif');
  if (vehicle.capacity < booking.passengerCount) {
    throw new HttpError(409, `Kapasitas kendaraan (${vehicle.capacity}) tidak mencukupi untuk ${booking.passengerCount} penumpang`);
  }
  if (!driver.active) throw new HttpError(409, 'Driver sedang tidak aktif');
  if (new Date(driver.licenseExpiry).getTime() < new Date(booking.departureAt).getTime()) {
    throw new HttpError(409, 'SIM driver sudah kedaluwarsa pada waktu keberangkatan');
  }

  const activeMaintenance = await client.maintenance.findFirst({
    where: { vehicleId, status: 'IN_PROGRESS' },
  });
  if (activeMaintenance) throw new HttpError(409, 'Kendaraan sedang dalam perawatan aktif');

  const criticalDefect = await client.defect.findFirst({
    where: { vehicleId, status: { in: BLOCKING_DEFECT_STATUSES }, severity: 'CRITICAL' },
  });
  if (criticalDefect) {
    throw new HttpError(409, `Kendaraan diblokir karena defect kritis "${criticalDefect.title}" belum terselesaikan`);
  }

  const { trips } = await overlappingTrips(tx, booking, excludeTripId);
  const vehicleConflict = trips.find((t) => t.vehicleId === vehicleId);
  if (vehicleConflict) {
    throw new HttpError(409, `Kendaraan sudah dipakai pada ${vehicleConflict.booking.code} di jadwal yang sama`);
  }
  const driverConflict = trips.find((t) => t.driverId === driverId);
  if (driverConflict) {
    throw new HttpError(409, `Driver sudah ditugaskan pada ${driverConflict.booking.code} di jadwal yang sama`);
  }

  return { vehicle, driver };
}
