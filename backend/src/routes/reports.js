import express from 'express';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { sendCsv } from '../lib/csv.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';

const router = express.Router();
router.use(requirePermission('reports:read'));

const DAY_MS = 24 * 60 * 60 * 1000;
const BOOKING_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ASSIGNED', 'COMPLETED', 'CANCELLED'];

function parseRange(query) {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'Rentang laporan tidak valid');
  }
  if (from.getTime() > to.getTime()) throw new HttpError(400, 'Tanggal awal harus sebelum tanggal akhir');
  const end = String(query.to || '').length === 10 ? new Date(to.getTime() + DAY_MS - 1) : to;
  return { from, to: end };
}

const iso = (value) => (value ? new Date(value).toISOString() : '');

async function loadReport(from, to) {
  const [bookings, maintenance, vehicles] = await Promise.all([
    prisma.booking.findMany({
      where: { departureAt: { gte: from, lte: to } },
      include: {
        requester: { select: { name: true } },
        route: true,
        trip: {
          include: {
            vehicle: { select: { id: true, plateNumber: true } },
            driver: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { departureAt: 'asc' },
    }),
    prisma.maintenance.findMany({
      where: { scheduledAt: { gte: from, lte: to } },
      include: { vehicle: { select: { id: true, plateNumber: true } } },
      orderBy: { scheduledAt: 'asc' },
    }),
    prisma.vehicle.findMany({
      select: {
        id: true,
        plateNumber: true,
        brand: true,
        model: true,
        category: true,
        ownership: true,
        status: true,
        capacity: true,
        stnkExpiry: true,
        insuranceExpiry: true,
      },
      orderBy: { plateNumber: 'asc' },
    }),
  ]);

  const bookingStatus = Object.fromEntries(BOOKING_STATUSES.map((status) => [status, 0]));
  const tripStatus = { SCHEDULED: 0, DRIVER_ACCEPTED: 0, PICKED_UP: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const booking of bookings) {
    bookingStatus[booking.status] = (bookingStatus[booking.status] || 0) + 1;
    if (booking.trip) tripStatus[booking.trip.status] = (tripStatus[booking.trip.status] || 0) + 1;
  }

  const maintenanceByVehicle = new Map();
  let totalMaintenanceCost = 0;
  for (const item of maintenance) {
    if (item.status === 'CANCELLED') continue;
    totalMaintenanceCost += item.cost || 0;
    const entry = maintenanceByVehicle.get(item.vehicleId) || { cost: 0, count: 0 };
    entry.cost += item.cost || 0;
    entry.count += 1;
    maintenanceByVehicle.set(item.vehicleId, entry);
  }

  const perVehicle = vehicles.map((vehicle) => {
    const trips = bookings.filter((booking) => booking.trip && booking.trip.vehicleId === vehicle.id);
    const completedTrips = trips.filter((booking) => booking.trip.status === 'COMPLETED').length;
    const activeTrips = trips.filter((booking) => ACTIVE_TRIP_STATUSES.includes(booking.trip.status)).length;
    const distanceKm = Number(
      trips
        .filter((booking) => ['COMPLETED', ...ACTIVE_TRIP_STATUSES].includes(booking.trip.status))
        .reduce((sum, booking) => sum + (booking.route?.distanceKm || 0), 0)
        .toFixed(1)
    );
    const passengers = trips
      .filter((booking) => !['CANCELLED', 'REJECTED'].includes(booking.status))
      .reduce((sum, booking) => sum + booking.passengerCount, 0);
    const maintenanceEntry = maintenanceByVehicle.get(vehicle.id) || { cost: 0, count: 0 };
    return {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      brand: vehicle.brand,
      model: vehicle.model,
      category: vehicle.category,
      ownership: vehicle.ownership,
      status: vehicle.status,
      capacity: vehicle.capacity,
      stnkExpiry: vehicle.stnkExpiry,
      insuranceExpiry: vehicle.insuranceExpiry,
      trips: trips.length,
      completedTrips,
      activeTrips,
      distanceKm,
      passengers,
      maintenanceCost: maintenanceEntry.cost,
      maintenanceCount: maintenanceEntry.count,
      costPerTrip: completedTrips > 0 ? Number((maintenanceEntry.cost / completedTrips).toFixed(0)) : null,
    };
  });

  const departmentMap = new Map();
  for (const booking of bookings) {
    const entry = departmentMap.get(booking.department) || {
      department: booking.department,
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      completed: 0,
      passengers: 0,
    };
    entry.total += 1;
    if (booking.status === 'PENDING') entry.pending += 1;
    else if (booking.status === 'REJECTED') entry.rejected += 1;
    else if (booking.status === 'CANCELLED') entry.cancelled += 1;
    else if (booking.status === 'COMPLETED') entry.completed += 1;
    else entry.approved += 1;
    if (!['CANCELLED', 'REJECTED'].includes(booking.status)) entry.passengers += booking.passengerCount;
    departmentMap.set(booking.department, entry);
  }

  const decided = bookingStatus.APPROVED + bookingStatus.ASSIGNED + bookingStatus.COMPLETED + bookingStatus.REJECTED;
  const approvedOrDone = bookingStatus.APPROVED + bookingStatus.ASSIGNED + bookingStatus.COMPLETED;
  const vehiclesWithTrips = perVehicle.filter((vehicle) => vehicle.trips > 0).length;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      bookings: bookings.length,
      passengers: bookings
        .filter((booking) => !['CANCELLED', 'REJECTED'].includes(booking.status))
        .reduce((sum, booking) => sum + booking.passengerCount, 0),
      completedTrips: tripStatus.COMPLETED,
      activeTrips: tripStatus.SCHEDULED + tripStatus.DRIVER_ACCEPTED + tripStatus.PICKED_UP + tripStatus.IN_PROGRESS,
      cancelledTrips: tripStatus.CANCELLED,
      maintenanceCost: totalMaintenanceCost,
      maintenanceItems: maintenance.filter((item) => item.status !== 'CANCELLED').length,
      approvalRate: decided ? Math.round((approvedOrDone / decided) * 100) : null,
      utilizationRate: perVehicle.length ? Math.round((vehiclesWithTrips / perVehicle.length) * 100) : 0,
      fleetSize: perVehicle.length,
    },
    bookingStatus,
    tripStatus,
    perVehicle,
    bookingByDepartment: [...departmentMap.values()].sort((a, b) => b.total - a.total),
    maintenance: maintenance.map((item) => ({
      id: item.id,
      vehicle: item.vehicle.plateNumber,
      title: item.title,
      status: item.status,
      scheduledAt: item.scheduledAt,
      completedAt: item.completedAt,
      cost: item.cost,
    })),
    trips: bookings
      .filter((booking) => booking.trip)
      .map((booking) => ({
        id: booking.trip.id,
        bookingCode: booking.code,
        requester: booking.requester?.name || '',
        department: booking.department,
        origin: booking.origin,
        destination: booking.destination,
        departureAt: booking.departureAt,
        returnAt: booking.returnAt,
        passengers: booking.passengerCount,
        status: booking.trip.status,
        vehicle: booking.trip.vehicle?.plateNumber || '',
        driver: booking.trip.driver?.name || '',
        distanceKm: booking.route?.distanceKm || null,
        startedAt: booking.trip.startedAt,
        completedAt: booking.trip.completedAt,
      })),
  };
}

router.get('/summary', asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  res.json(await loadReport(from, to));
}));

const DATASETS = {
  bookings: {
    columns: [
      { key: 'code', label: 'Kode Booking' },
      { key: 'requester', label: 'Pemohon' },
      { key: 'department', label: 'Departemen' },
      { key: 'purpose', label: 'Tujuan Perjalanan' },
      { key: 'origin', label: 'Asal' },
      { key: 'destination', label: 'Tujuan' },
      { key: 'departureAt', label: 'Keberangkatan' },
      { key: 'returnAt', label: 'Kembali' },
      { key: 'passengers', label: 'Penumpang' },
      { key: 'status', label: 'Status' },
    ],
  },
  trips: {
    columns: [
      { key: 'bookingCode', label: 'Kode Booking' },
      { key: 'vehicle', label: 'Kendaraan' },
      { key: 'driver', label: 'Driver' },
      { key: 'origin', label: 'Asal' },
      { key: 'destination', label: 'Tujuan' },
      { key: 'departureAt', label: 'Keberangkatan' },
      { key: 'startedAt', label: 'Mulai' },
      { key: 'completedAt', label: 'Selesai' },
      { key: 'distanceKm', label: 'Jarak (km)' },
      { key: 'status', label: 'Status' },
    ],
  },
  vehicles: {
    columns: [
      { key: 'plateNumber', label: 'Nomor Polisi' },
      { key: 'brand', label: 'Merek' },
      { key: 'model', label: 'Model' },
      { key: 'ownership', label: 'Kepemilikan' },
      { key: 'status', label: 'Status' },
      { key: 'trips', label: 'Total Trip' },
      { key: 'completedTrips', label: 'Trip Selesai' },
      { key: 'distanceKm', label: 'Jarak (km)' },
      { key: 'passengers', label: 'Penumpang' },
      { key: 'maintenanceCost', label: 'Biaya Maintenance' },
      { key: 'costPerTrip', label: 'Biaya per Trip' },
    ],
  },
  maintenance: {
    columns: [
      { key: 'vehicle', label: 'Kendaraan' },
      { key: 'title', label: 'Pekerjaan' },
      { key: 'status', label: 'Status' },
      { key: 'scheduledAt', label: 'Dijadwalkan' },
      { key: 'completedAt', label: 'Selesai' },
      { key: 'cost', label: 'Biaya' },
    ],
  },
  department: {
    columns: [
      { key: 'department', label: 'Departemen' },
      { key: 'total', label: 'Total Booking' },
      { key: 'pending', label: 'Menunggu' },
      { key: 'approved', label: 'Disetujui' },
      { key: 'rejected', label: 'Ditolak' },
      { key: 'completed', label: 'Selesai' },
      { key: 'cancelled', label: 'Dibatalkan' },
      { key: 'passengers', label: 'Total Penumpang' },
    ],
  },
};

router.get('/export.csv', asyncRoute(async (req, res) => {
  const dataset = String(req.query.dataset || 'bookings');
  const config = DATASETS[dataset];
  if (!config) throw new HttpError(400, 'Jenis ekspor laporan tidak dikenal');
  const { from, to } = parseRange(req.query);
  const report = await loadReport(from, to);

  let rows;
  if (dataset === 'bookings') {
    const bookings = await prisma.booking.findMany({
      where: { departureAt: { gte: from, lte: to } },
      include: { requester: { select: { name: true } } },
      orderBy: { departureAt: 'asc' },
    });
    rows = bookings.map((booking) => ({
      code: booking.code,
      requester: booking.requester?.name || '',
      department: booking.department,
      purpose: booking.purpose,
      origin: booking.origin,
      destination: booking.destination,
      departureAt: iso(booking.departureAt),
      returnAt: iso(booking.returnAt),
      passengers: booking.passengerCount,
      status: booking.status,
    }));
  } else if (dataset === 'trips') {
    rows = report.trips.map((trip) => ({ ...trip, departureAt: iso(trip.departureAt), startedAt: iso(trip.startedAt), completedAt: iso(trip.completedAt) }));
  } else if (dataset === 'vehicles') {
    rows = report.perVehicle;
  } else if (dataset === 'maintenance') {
    rows = report.maintenance.map((item) => ({ ...item, scheduledAt: iso(item.scheduledAt), completedAt: iso(item.completedAt) }));
  } else {
    rows = report.bookingByDepartment;
  }

  const stamp = from.toISOString().slice(0, 10).replaceAll('-', '');
  sendCsv(res, `laporan-${dataset}-${stamp}.csv`, config.columns, rows);
}));

export default router;
