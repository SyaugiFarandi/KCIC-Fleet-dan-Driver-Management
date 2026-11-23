import { prisma } from '../db.js';
import { ACTIVE_TRIP_STATUSES } from './workflow.js';

const db = (tx) => tx ?? prisma;

export async function refreshVehicleStatus(tx, vehicleId) {
  const client = db(tx);
  const vehicle = await client.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || vehicle.status === 'INACTIVE') return vehicle;
  const [activeTrips, activeMaintenance] = await Promise.all([
    client.trip.count({ where: { vehicleId, status: { in: ACTIVE_TRIP_STATUSES } } }),
    client.maintenance.count({ where: { vehicleId, status: 'IN_PROGRESS' } }),
  ]);
  const status = activeMaintenance > 0 ? 'MAINTENANCE' : activeTrips > 0 ? 'ASSIGNED' : 'AVAILABLE';
  if (status === vehicle.status) return vehicle;
  return client.vehicle.update({ where: { id: vehicleId }, data: { status } });
}

export async function refreshDriverAvailability(tx, driverId) {
  const client = db(tx);
  const activeTrips = await client.trip.count({
    where: { driverId, status: { in: ACTIVE_TRIP_STATUSES } },
  });
  return client.driver.update({ where: { id: driverId }, data: { available: activeTrips === 0 } });
}
