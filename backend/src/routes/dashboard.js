import express from 'express';
import { prisma } from '../db.js';
import { asyncRoute } from '../lib/http.js';
import { can } from '../lib/permissions.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';

const router = express.Router();

const tripCardInclude = {
  booking: { select: { id: true, code: true, origin: true, destination: true, departureAt: true, returnAt: true, passengerCount: true } },
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
  driver: { select: { id: true, name: true, phone: true } },
};

function toCountMap(rows) {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

router.get('/', asyncRoute(async (req, res) => {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  if (!can(req.user.role, 'trips:read:all')) {
    if (req.user.role === 'DRIVER') {
      const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
      if (!driver) {
        return res.json({
          scope: 'PERSONAL',
          kpis: { myActiveTrips: 0, myCompletedTrips: 0, myUpcomingTrips: 0 },
          statuses: { trips: {} },
          myTrips: [],
          generatedAt: now,
        });
      }
      const [trips, grouped] = await Promise.all([
        prisma.trip.findMany({
          where: { driverId: driver.id, status: { in: ACTIVE_TRIP_STATUSES } },
          include: tripCardInclude,
          orderBy: { booking: { departureAt: 'asc' } },
          take: 10,
        }),
        prisma.trip.groupBy({ by: ['status'], where: { driverId: driver.id }, _count: { _all: true } }),
      ]);
      const statuses = toCountMap(grouped);
      return res.json({
        scope: 'PERSONAL',
        kpis: {
          myActiveTrips: (statuses.DRIVER_ACCEPTED || 0) + (statuses.PICKED_UP || 0) + (statuses.IN_PROGRESS || 0),
          myScheduledTrips: statuses.SCHEDULED || 0,
          myCompletedTrips: statuses.COMPLETED || 0,
          myUpcomingTrips: trips.length,
        },
        statuses: { trips: statuses },
        myTrips: trips,
        generatedAt: now,
      });
    }

    const [grouped, upcoming] = await Promise.all([
      prisma.booking.groupBy({ by: ['status'], where: { requesterId: req.user.id }, _count: { _all: true } }),
      prisma.booking.findMany({
        where: { requesterId: req.user.id, status: { in: ['PENDING', 'APPROVED', 'ASSIGNED'] } },
        orderBy: { departureAt: 'asc' },
        take: 10,
        include: {
          requester: { select: { id: true, name: true, email: true } },
          trip: { include: { vehicle: true, driver: true } },
        },
      }),
    ]);
    const statuses = toCountMap(grouped);
    return res.json({
      scope: 'PERSONAL',
      kpis: {
        myBookings: Object.values(statuses).reduce((a, b) => a + b, 0),
        myPendingBookings: statuses.PENDING || 0,
        myApprovedBookings: statuses.APPROVED || 0,
        myAssignedBookings: statuses.ASSIGNED || 0,
        myCompletedBookings: statuses.COMPLETED || 0,
      },
      statuses: { bookings: statuses },
      myBookings: upcoming,
      generatedAt: now,
    });
  }

  const [
    vehicleGroups,
    driverTotal,
    driverAvailable,
    driverActive,
    bookingGroups,
    tripGroups,
    maintenanceGroups,
    tripsToday,
    pendingApprovals,
    activeTrips,
    upcomingMaintenance,
    recentAudit,
  ] = await Promise.all([
    prisma.vehicle.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.driver.count(),
    prisma.driver.count({ where: { available: true, active: true } }),
    prisma.driver.count({ where: { active: true } }),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.trip.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.maintenance.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.trip.count({ where: { booking: { departureAt: { gte: dayStart, lt: dayEnd } } } }),
    prisma.booking.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      include: { requester: { select: { id: true, name: true, email: true } } },
    }),
    prisma.trip.findMany({
      where: { status: { in: ACTIVE_TRIP_STATUSES } },
      orderBy: { booking: { departureAt: 'asc' } },
      take: 5,
      include: tripCardInclude,
    }),
    prisma.maintenance.findMany({
      where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      include: { vehicle: { select: { id: true, plateNumber: true } } },
    }),
    can(req.user.role, 'audit:read')
      ? prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { user: { select: { id: true, name: true, role: true } } },
        })
      : Promise.resolve([]),
  ]);

  const vehicleStatus = toCountMap(vehicleGroups);
  const bookingStatus = toCountMap(bookingGroups);
  const tripStatus = toCountMap(tripGroups);
  const maintenanceStatus = toCountMap(maintenanceGroups);
  const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

  res.json({
    scope: 'OPERATIONS',
    kpis: {
      vehicles: sum(vehicleStatus),
      vehiclesAvailable: vehicleStatus.AVAILABLE || 0,
      vehiclesAssigned: vehicleStatus.ASSIGNED || 0,
      vehiclesMaintenance: vehicleStatus.MAINTENANCE || 0,
      drivers: driverTotal,
      driversAvailable: driverAvailable,
      driversActive: driverActive,
      bookings: sum(bookingStatus),
      pendingBookings: bookingStatus.PENDING || 0,
      activeTrips: ACTIVE_TRIP_STATUSES.reduce((a, s) => a + (tripStatus[s] || 0), 0),
      tripsToday,
      maintenanceActive: maintenanceStatus.IN_PROGRESS || 0,
      maintenancePlanned: maintenanceStatus.PLANNED || 0,
    },
    statuses: {
      vehicles: vehicleStatus,
      bookings: bookingStatus,
      trips: tripStatus,
      maintenance: maintenanceStatus,
    },
    pendingApprovals,
    activeTrips,
    upcomingMaintenance,
    recentAudit,
    generatedAt: now,
  });
}));

export default router;
