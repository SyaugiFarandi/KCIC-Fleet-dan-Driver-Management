import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

const router = express.Router();
router.use(requirePermission('intelligence:read'));

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function parseRange(query) {
  const now = new Date();
  const fallbackTo = new Date(now);
  fallbackTo.setHours(23, 59, 59, 999);
  const to = query.to ? new Date(query.to) : fallbackTo;
  const from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'Rentang laporan tidak valid');
  }
  if (from.getTime() > to.getTime()) throw new HttpError(400, 'Tanggal awal harus sebelum tanggal akhir');
  const end = String(query.to || '').length === 10 ? new Date(to.getTime() + DAY_MS - 1) : to;
  return { from, to: end };
}

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : null);

function averageMinutes(from, to) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / MINUTE_MS));
}

function avg(values) {
  const filled = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!filled.length) return null;
  return Math.round(filled.reduce((sum, value) => sum + value, 0) / filled.length);
}

function statusOf(value, direction, goodAt, warnAt) {
  if (value === null || value === undefined) return 'NEUTRAL';
  if (direction === 'NEUTRAL') return 'NEUTRAL';
  if (direction === 'HIGHER_BETTER') {
    if (value >= goodAt) return 'GOOD';
    if (value >= warnAt) return 'WARN';
    return 'BAD';
  }
  if (value <= goodAt) return 'GOOD';
  if (value <= warnAt) return 'WARN';
  return 'BAD';
}

const kpi = (definition) => ({ ...definition, status: statusOf(definition.value, definition.direction, definition.goodAt, definition.warnAt) });

async function loadKpis(from, to) {
  const now = new Date();
  const [vehicles, drivers, bookings, maintenance, inspections, defects, fuel, latestLocations] = await Promise.all([
    prisma.vehicle.findMany({
      select: {
        id: true,
        plateNumber: true,
        status: true,
        odometerKm: true,
        lastServiceAt: true,
        serviceIntervalKm: true,
        serviceIntervalDays: true,
        stnkExpiry: true,
        insuranceExpiry: true,
      },
    }),
    prisma.driver.findMany({ select: { id: true, name: true, active: true, licenseExpiry: true, userId: true } }),
    prisma.booking.findMany({
      where: { departureAt: { gte: from, lte: to } },
      select: {
        id: true,
        code: true,
        status: true,
        priority: true,
        routeId: true,
        createdAt: true,
        decidedAt: true,
        route: { select: { distanceKm: true } },
        trip: {
          select: {
            id: true,
            vehicleId: true,
            status: true,
            startedAt: true,
            completedAt: true,
            assignedAt: true,
          },
        },
      },
    }),
    prisma.maintenance.findMany({
      where: { OR: [{ scheduledAt: { gte: from, lte: to } }, { completedAt: { gte: from, lte: to } }] },
      select: { id: true, vehicleId: true, title: true, status: true, cost: true, scheduledAt: true, completedAt: true },
    }),
    prisma.inspection.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.defect.findMany({ select: { id: true, severity: true, status: true, reportedAt: true, resolvedAt: true } }),
    prisma.fuelTransaction.findMany({
      where: { transactionAt: { gte: from, lte: to } },
      select: { id: true, liters: true, totalCost: true, anomalyStatus: true, odometerKm: true, vehicleId: true, transactionAt: true },
    }),
    prisma.vehicleLocation.groupBy({ by: ['vehicleId'], _max: { recordedAt: true } }),
  ]);

  const fleetSize = vehicles.length;
  const vehiclesOnTrip = new Set(bookings.filter((booking) => booking.trip).map((booking) => booking.trip.vehicleId));
  const utilization = pct(vehiclesOnTrip.size, fleetSize);
  const availability = pct(vehicles.filter((vehicle) => vehicle.status === 'AVAILABLE').length, fleetSize);

  const decided = bookings.filter((booking) => ['APPROVED', 'ASSIGNED', 'COMPLETED', 'REJECTED'].includes(booking.status)).length;
  const approved = bookings.filter((booking) => ['APPROVED', 'ASSIGNED', 'COMPLETED'].includes(booking.status)).length;
  const approvalRate = pct(approved, decided);

  const trips = bookings.filter((booking) => booking.trip).map((booking) => booking.trip);
  const completedTrips = trips.filter((trip) => trip.status === 'COMPLETED');
  const cancelledTrips = trips.filter((trip) => trip.status === 'CANCELLED');
  const completionRate = pct(completedTrips.length, completedTrips.length + cancelledTrips.length);

  const completedInspections = inspections.filter((item) => ['PASSED', 'DEFECTS', 'FAILED'].includes(item.status));
  const inspectionPassRate = pct(completedInspections.filter((item) => item.status === 'PASSED').length, completedInspections.length);

  const flaggedFuel = fuel.filter((item) => item.anomalyStatus === 'FLAGGED').length;
  const fuelAnomalyRate = pct(flaggedFuel, fuel.length);

  const fuelCost = fuel.reduce((sum, item) => sum + (item.totalCost || 0), 0);
  const completedDistanceKm = Number(
    bookings
      .filter((booking) => booking.trip?.status === 'COMPLETED' && booking.route?.distanceKm)
      .reduce((sum, booking) => sum + booking.route.distanceKm, 0)
      .toFixed(1)
  );
  const fuelCostPerKm = completedDistanceKm > 0 ? Math.round(fuelCost / completedDistanceKm) : null;

  const maintenanceCost = maintenance
    .filter((item) => item.status !== 'CANCELLED')
    .reduce((sum, item) => sum + (item.cost || 0), 0);
  const maintenanceCostPerTrip = completedTrips.length > 0 ? Math.round(maintenanceCost / completedTrips.length) : null;

  const emergencyDecided = bookings.filter((booking) => booking.priority === 'EMERGENCY' && booking.decidedAt);
  const emergencyResponse = avg(emergencyDecided.map((booking) => averageMinutes(booking.createdAt, booking.decidedAt)));

  const activeDrivers = drivers.filter((driver) => driver.active);
  const licenseCompliance = pct(
    activeDrivers.filter((driver) => new Date(driver.licenseExpiry).getTime() > now.getTime()).length,
    activeDrivers.length
  );

  const documentCompliance = pct(
    vehicles.filter(
      (vehicle) =>
        vehicle.stnkExpiry &&
        vehicle.insuranceExpiry &&
        new Date(vehicle.stnkExpiry).getTime() > now.getTime() &&
        new Date(vehicle.insuranceExpiry).getTime() > now.getTime()
    ).length,
    fleetSize
  );

  const openCriticalDefects = defects.filter(
    (defect) => defect.severity === 'CRITICAL' && ['OPEN', 'IN_REPAIR'].includes(defect.status)
  ).length;

  const openWorkOrders = await prisma.maintenance.count({ where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } } });

  const freshLocations = latestLocations.filter(
    (entry) => entry._max.recordedAt && now.getTime() - new Date(entry._max.recordedAt).getTime() <= 24 * 60 * MINUTE_MS
  ).length;
  const gpsCoverage = pct(freshLocations, fleetSize);

  return {
    fleet: [
      kpi({
        id: 'fleet_utilization',
        label: 'Utilisasi armada',
        group: 'Armada',
        value: utilization,
        unit: '%',
        formula: 'Kendaraan dengan minimal 1 trip dalam periode ÷ total kendaraan × 100',
        target: '≥ 70%',
        direction: 'HIGHER_BETTER',
        goodAt: 70,
        warnAt: 40,
        note: 'Bergantung pada booking yang memakai rute/kendaraan pada periode terpilih.',
      }),
      kpi({
        id: 'vehicle_availability',
        label: 'Ketersediaan armada',
        group: 'Armada',
        value: availability,
        unit: '%',
        formula: 'Kendaraan berstatus AVAILABLE ÷ total kendaraan × 100',
        target: '≥ 60%',
        direction: 'HIGHER_BETTER',
        goodAt: 60,
        warnAt: 40,
        note: 'Snapshot status kendaraan saat ini, bukan rata-rata periode.',
      }),
      kpi({
        id: 'gps_coverage',
        label: 'Cakupan GPS 24 jam',
        group: 'Armada',
        value: gpsCoverage,
        unit: '%',
        formula: 'Kendaraan dengan ping GPS ≤ 24 jam ÷ total kendaraan × 100',
        target: '≥ 80%',
        direction: 'HIGHER_BETTER',
        goodAt: 80,
        warnAt: 50,
        note: 'Simulator GPS demo dapat dihentikan, sehingga nilai turun tanpa berarti perangkat rusak.',
      }),
    ],
    operations: [
      kpi({
        id: 'booking_approval_rate',
        label: 'Tingkat persetujuan booking',
        group: 'Operasi',
        value: approvalRate,
        unit: '%',
        formula: '(Disetujui + Ditugaskan + Selesai) ÷ booking yang sudah diputuskan × 100',
        target: '≥ 80%',
        direction: 'HIGHER_BETTER',
        goodAt: 80,
        warnAt: 60,
        note: 'Booking PENDING dan CANCELLED tidak dihitung sebagai keputusan.',
      }),
      kpi({
        id: 'trip_completion_rate',
        label: 'Penyelesaian trip',
        group: 'Operasi',
        value: completionRate,
        unit: '%',
        formula: 'Trip selesai ÷ (trip selesai + trip dibatalkan) × 100',
        target: '≥ 90%',
        direction: 'HIGHER_BETTER',
        goodAt: 90,
        warnAt: 75,
        note: 'Trip masih berjalan tidak dihitung sampai selesai/dibatalkan.',
      }),
      kpi({
        id: 'inspection_pass_rate',
        label: 'Lulus inspeksi kendaraan',
        group: 'Operasi',
        value: inspectionPassRate,
        unit: '%',
        formula: 'Inspeksi PASSED ÷ inspeksi yang sudah selesai (PASSED, DEFECTS, FAILED) × 100',
        target: '≥ 85%',
        direction: 'HIGHER_BETTER',
        goodAt: 85,
        warnAt: 65,
        note: 'Inspeksi DRAFT belum dihitung.',
      }),
      kpi({
        id: 'emergency_response_minutes',
        label: 'Respons transport darurat',
        group: 'Operasi',
        value: emergencyResponse,
        unit: 'mnt',
        formula: 'Rata-rata (waktu keputusan − waktu pengajuan) untuk booking EMERGENCY',
        target: '≤ 15 menit',
        direction: 'LOWER_BETTER',
        goodAt: 15,
        warnAt: 30,
        note: 'Hanya permintaan darurat yang sudah diputuskan dalam periode.',
      }),
      kpi({
        id: 'maintenance_backlog',
        label: 'Work order terbuka',
        group: 'Operasi',
        value: openWorkOrders,
        unit: 'work order',
        formula: 'Jumlah maintenance berstatus PLANNED atau IN_PROGRESS saat ini',
        target: '≤ 5',
        direction: 'LOWER_BETTER',
        goodAt: 5,
        warnAt: 12,
        note: 'Snapshot saat ini; bukan hanya periode terpilih.',
      }),
      kpi({
        id: 'open_critical_defects',
        label: 'Defect kritis terbuka',
        group: 'Operasi',
        value: openCriticalDefects,
        unit: 'defect',
        formula: 'Defect severity CRITICAL dengan status OPEN atau IN_REPAIR',
        target: '0',
        direction: 'LOWER_BETTER',
        goodAt: 0,
        warnAt: 2,
        note: 'Defect kritis memblokir penugasan kendaraan sampai diperbaiki.',
      }),
    ],
    cost: [
      kpi({
        id: 'fuel_cost_per_km',
        label: 'Biaya BBM per km',
        group: 'Biaya',
        value: fuelCostPerKm,
        unit: 'IDR',
        formula: 'Total biaya BBM periode ÷ total jarak trip selesai yang memiliki rute',
        target: 'Tanpa target demo',
        direction: 'NEUTRAL',
        note: `Jarak trip selesai periode ini: ${completedDistanceKm.toLocaleString('id-ID')} km. Estimasi dari rute master, bukan odometer GPS.`,
      }),
      kpi({
        id: 'fuel_anomaly_rate',
        label: 'Rasio anomali BBM',
        group: 'Biaya',
        value: fuelAnomalyRate,
        unit: '%',
        formula: 'Transaksi BBM FLAGGED ÷ total transaksi BBM periode × 100',
        target: '≤ 5%',
        direction: 'LOWER_BETTER',
        goodAt: 5,
        warnAt: 15,
        note: 'Anomali ditandai aturan volume/harga demo; perlu review manual.',
      }),
      kpi({
        id: 'maintenance_cost_per_trip',
        label: 'Biaya maintenance per trip',
        group: 'Biaya',
        value: maintenanceCostPerTrip,
        unit: 'IDR',
        formula: 'Total biaya maintenance (non-cancelled) ÷ trip selesai pada periode',
        target: 'Tanpa target demo',
        direction: 'NEUTRAL',
        note: 'Angka DEMO; bukan benchmark biaya resmi KCIC.',
      }),
    ],
    compliance: [
      kpi({
        id: 'driver_license_compliance',
        label: 'Kepatuhan SIM driver',
        group: 'Kepatuhan',
        value: licenseCompliance,
        unit: '%',
        formula: 'Driver aktif dengan SIM belum kedaluwarsa ÷ total driver aktif × 100',
        target: '100%',
        direction: 'HIGHER_BETTER',
        goodAt: 100,
        warnAt: 90,
        note: 'SIM kedaluwarsa memblokir penugasan driver di backend.',
      }),
      kpi({
        id: 'document_compliance',
        label: 'Kepatuhan STNK & asuransi',
        group: 'Kepatuhan',
        value: documentCompliance,
        unit: '%',
        formula: 'Kendaraan dengan STNK dan asuransi berlaku ÷ total kendaraan × 100',
        target: '100%',
        direction: 'HIGHER_BETTER',
        goodAt: 100,
        warnAt: 85,
        note: 'Dokumen kosong dihitung belum patuh; lengkapi data kendaraan.',
      }),
    ],
  };
}

const SEVERITY_WEIGHT = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function check({ id, label, severity, count, total, sample, detail }) {
  return {
    id,
    label,
    severity,
    count,
    total,
    sample: sample.slice(0, 5),
    detail,
    status: count === 0 ? 'PASS' : severity === 'HIGH' ? 'FAIL' : 'WARN',
  };
}

async function loadDataQuality(from, to) {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * DAY_MS);

  const [bookings, vehicles, drivers, maintenance, inspections, fuel, contracts, emergency, locations] = await Promise.all([
    prisma.booking.findMany({
      where: { departureAt: { gte: from, lte: to } },
      select: {
        id: true,
        code: true,
        status: true,
        routeId: true,
        trip: { select: { id: true, status: true, startedAt: true, completedAt: true } },
      },
    }),
    prisma.vehicle.findMany({ select: { id: true, plateNumber: true, stnkExpiry: true, insuranceExpiry: true } }),
    prisma.driver.findMany({ select: { id: true, name: true, active: true, licenseExpiry: true, userId: true } }),
    prisma.maintenance.findMany({
      select: { id: true, vehicleId: true, title: true, status: true, scheduledAt: true },
      where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
    }),
    prisma.inspection.findMany({ where: { status: 'DRAFT' }, select: { id: true, createdAt: true, vehicleId: true } }),
    prisma.fuelTransaction.findMany({ where: { transactionAt: { gte: from, lte: to } }, select: { id: true, vehicleId: true, anomalyStatus: true } }),
    prisma.vendorContract.findMany({ where: { status: 'ACTIVE' }, select: { id: true, contractNumber: true, endDate: true } }),
    prisma.booking.findMany({
      where: { priority: 'EMERGENCY', status: 'APPROVED', trip: null, createdAt: { lt: new Date(now.getTime() - 60 * MINUTE_MS) } },
      select: { id: true, code: true, createdAt: true },
    }),
    prisma.vehicleLocation.groupBy({ by: ['vehicleId'], _max: { recordedAt: true } }),
  ]);

  const latest = new Map(locations.map((entry) => [entry.vehicleId, entry._max.recordedAt]));
  const activeVehicleCodes = (list) =>
    list.map((id) => vehicles.find((vehicle) => vehicle.id === id)?.plateNumber).filter(Boolean);

  const missingRoute = bookings.filter((booking) => !booking.routeId && ['APPROVED', 'ASSIGNED', 'COMPLETED'].includes(booking.status));
  const staleTrips = bookings.filter(
    (booking) => booking.trip?.status === 'COMPLETED' && (!booking.trip.startedAt || !booking.trip.completedAt)
  );
  const missingDocs = vehicles.filter((vehicle) => !vehicle.stnkExpiry || !vehicle.insuranceExpiry);
  const expiringDocs = vehicles.filter((vehicle) => {
    const dates = [vehicle.stnkExpiry, vehicle.insuranceExpiry].filter(Boolean).map((value) => new Date(value).getTime());
    return dates.some((time) => time > now.getTime() && time <= soon.getTime());
  });
  const expiredLicenses = drivers.filter((driver) => driver.active && new Date(driver.licenseExpiry).getTime() <= now.getTime());
  const driversWithoutAccount = drivers.filter((driver) => driver.active && !driver.userId);
  const flaggedFuel = fuel.filter((item) => item.anomalyStatus === 'FLAGGED');
  const staleGps = vehicles.filter((vehicle) => {
    const at = latest.get(vehicle.id);
    return !at || now.getTime() - new Date(at).getTime() > 24 * 60 * MINUTE_MS;
  });
  const overdueMaintenance = maintenance.filter((item) => new Date(item.scheduledAt).getTime() < now.getTime());
  const staleDrafts = inspections.filter((item) => now.getTime() - new Date(item.createdAt).getTime() > 24 * 60 * MINUTE_MS);
  const expiringContracts = contracts.filter((contract) => new Date(contract.endDate).getTime() <= soon.getTime());

  const checks = [
    check({
      id: 'booking_route_missing',
      label: 'Booking aktif tanpa rute',
      severity: 'MEDIUM',
      count: missingRoute.length,
      total: bookings.length,
      sample: missingRoute.map((booking) => booking.code),
      detail: 'Rute dipakai untuk estimasi jarak, total km, dan biaya per trip.',
    }),
    check({
      id: 'trip_timestamps_missing',
      label: 'Trip selesai tanpa waktu mulai/selesai',
      severity: 'MEDIUM',
      count: staleTrips.length,
      total: bookings.filter((booking) => booking.trip?.status === 'COMPLETED').length,
      sample: staleTrips.map((booking) => booking.code),
      detail: 'Timestamp dibutuhkan untuk durasi, SLA, dan audit operasional.',
    }),
    check({
      id: 'vehicle_documents_missing',
      label: 'Kendaraan tanpa data STNK/asuransi',
      severity: 'HIGH',
      count: missingDocs.length,
      total: vehicles.length,
      sample: missingDocs.map((vehicle) => vehicle.plateNumber),
      detail: 'Dokumen kosong tidak bisa dipantau masa berlakunya.',
    }),
    check({
      id: 'vehicle_documents_expiring',
      label: 'STNK/asuransi habis ≤ 30 hari',
      severity: 'MEDIUM',
      count: expiringDocs.length,
      total: vehicles.length,
      sample: expiringDocs.map((vehicle) => vehicle.plateNumber),
      detail: 'Perpanjangan perlu dijadwalkan sebelum jatuh tempo.',
    }),
    check({
      id: 'driver_license_expired',
      label: 'SIM driver aktif kedaluwarsa',
      severity: 'HIGH',
      count: expiredLicenses.length,
      total: drivers.filter((driver) => driver.active).length,
      sample: expiredLicenses.map((driver) => driver.name),
      detail: 'Driver dengan SIM kedaluwarsa diblokir dari penugasan backend.',
    }),
    check({
      id: 'driver_account_missing',
      label: 'Driver aktif tanpa akun login',
      severity: 'LOW',
      count: driversWithoutAccount.length,
      total: drivers.filter((driver) => driver.active).length,
      sample: driversWithoutAccount.map((driver) => driver.name),
      detail: 'Akun dibutuhkan untuk PWA driver dan konfirmasi trip mandiri.',
    }),
    check({
      id: 'fuel_anomaly_flagged',
      label: 'Transaksi BBM ditandai anomali',
      severity: 'HIGH',
      count: flaggedFuel.length,
      total: fuel.length,
      sample: flaggedFuel.map((item) => item.id.slice(-6)),
      detail: 'Anomali harus direview dan disetujui/dikoreksi oleh pengawas.',
    }),
    check({
      id: 'gps_stale',
      label: 'Kendaraan tanpa ping GPS 24 jam',
      severity: 'LOW',
      count: staleGps.length,
      total: vehicles.length,
      sample: staleGps.map((vehicle) => vehicle.plateNumber),
      detail: 'Pada demo, simulator dapat dihentikan sehingga status ini normal.',
    }),
    check({
      id: 'maintenance_overdue',
      label: 'Work order melewati jadwal',
      severity: 'HIGH',
      count: overdueMaintenance.length,
      total: maintenance.length,
      sample: overdueMaintenance.map((item) => item.title),
      detail: 'Pekerjaan PLANNED/IN_PROGRESS dengan tanggal jadwal lampau.',
    }),
    check({
      id: 'inspection_draft_stale',
      label: 'Inspeksi draft > 24 jam',
      severity: 'MEDIUM',
      count: staleDrafts.length,
      total: inspections.length,
      sample: activeVehicleCodes(staleDrafts.map((item) => item.vehicleId)),
      detail: 'Draft lama mengaburkan status kelayakan kendaraan.',
    }),
    check({
      id: 'emergency_unassigned',
      label: 'Darurat disetujui > 60 menit belum ditugaskan',
      severity: 'HIGH',
      count: emergency.length,
      total: null,
      sample: emergency.map((booking) => booking.code),
      detail: 'Permintaan darurat yang disetujui harus segera mendapat kendaraan.',
    }),
    check({
      id: 'contract_expiring',
      label: 'Kontrak vendor habis ≤ 30 hari',
      severity: 'MEDIUM',
      count: expiringContracts.length,
      total: contracts.length,
      sample: expiringContracts.map((contract) => contract.contractNumber),
      detail: 'Kontrak aktif yang mendekati atau sudah melewati tanggal akhir.',
    }),
  ];

  const weightTotal = checks.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity], 0);
  const weightFailed = checks.reduce((sum, item) => (item.status === 'PASS' ? sum : sum + SEVERITY_WEIGHT[item.severity]), 0);
  const score = weightTotal > 0 ? Math.round(((weightTotal - weightFailed) / weightTotal) * 100) : 100;

  return {
    score,
    passed: checks.filter((item) => item.status === 'PASS').length,
    total: checks.length,
    failing: checks.filter((item) => item.status === 'FAIL').map((item) => item.id),
    checks,
  };
}

const VALID_WIDGET_IDS = [
  'fleet_utilization',
  'vehicle_availability',
  'gps_coverage',
  'booking_approval_rate',
  'trip_completion_rate',
  'inspection_pass_rate',
  'emergency_response_minutes',
  'maintenance_backlog',
  'open_critical_defects',
  'fuel_cost_per_km',
  'fuel_anomaly_rate',
  'maintenance_cost_per_trip',
  'driver_license_compliance',
  'document_compliance',
];

const DEFAULT_WIDGETS = ['fleet_utilization', 'booking_approval_rate', 'inspection_pass_rate', 'maintenance_cost_per_trip'];

function widgetsFrom(user) {
  const stored = user?.dashboardPrefs?.intelligenceWidgets;
  if (!Array.isArray(stored)) return DEFAULT_WIDGETS;
  return stored.filter((id) => VALID_WIDGET_IDS.includes(id));
}

router.get('/kpis', asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const [groups, user] = await Promise.all([
    loadKpis(from, to),
    prisma.user.findUnique({ where: { id: req.user.id }, select: { dashboardPrefs: true } }),
  ]);
  res.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    generatedAt: new Date().toISOString(),
    groups,
    kpiLibrary: VALID_WIDGET_IDS,
    preferences: { widgets: widgetsFrom(user) },
    defaultWidgets: DEFAULT_WIDGETS,
    disclaimer:
      'Semua KPI dihitung dari data DEMO lokal dengan formula yang ditampilkan. Tidak ada model ML atau benchmark resmi KCIC yang dipakai.',
  });
}));

router.get('/data-quality', asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  res.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    generatedAt: new Date().toISOString(),
    ...(await loadDataQuality(from, to)),
    disclaimer: 'Pemeriksaan kualitas data berbasis aturan terhadap isi database DEMO, bukan validasi data operasional resmi.',
  });
}));

const widgetsSchema = z.object({
  widgets: z.array(z.string().min(1).max(60)).max(6),
});

router.put('/widgets', asyncRoute(async (req, res) => {
  const { widgets } = widgetsSchema.parse(req.body);
  const unknown = widgets.filter((id) => !VALID_WIDGET_IDS.includes(id));
  if (unknown.length) throw new HttpError(400, `Widget tidak dikenal: ${unknown.join(', ')}`);
  const unique = [...new Set(widgets)];
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { dashboardPrefs: true } });
  const existing = user?.dashboardPrefs && typeof user.dashboardPrefs === 'object' && !Array.isArray(user.dashboardPrefs)
    ? user.dashboardPrefs
    : {};
  await prisma.user.update({
    where: { id: req.user.id },
    data: { dashboardPrefs: { ...existing, intelligenceWidgets: unique } },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'INTELLIGENCE_WIDGETS_UPDATE',
    entity: 'User',
    entityId: req.user.id,
    detail: `Widget dashboard intelijen: ${unique.join(', ') || '(kosong)'}`,
  });
  res.json({ widgets: unique });
}));

export default router;
