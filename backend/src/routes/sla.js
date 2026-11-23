import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';

const router = express.Router();
router.use(requirePermission('vendors:sla'));

const DAY_MS = 24 * 60 * 60 * 1000;
const ON_TIME_TOLERANCE_MIN = 15;
const EXPIRY_HORIZON_DAYS = 30;

const METRICS = ['ON_TIME_DEPARTURE', 'TRIP_COMPLETION', 'AVAILABILITY', 'RESPONSE_TIME'];
const METRIC_LABELS = {
  ON_TIME_DEPARTURE: 'Ketepatan Keberangkatan',
  TRIP_COMPLETION: 'Penyelesaian Trip',
  AVAILABILITY: 'Ketersediaan Armada',
  RESPONSE_TIME: 'Waktu Respons',
};

const RULES = [
  `On-time departure: trip dianggap tepat waktu bila startedAt ≤ departureAt + ${ON_TIME_TOLERANCE_MIN} menit toleransi evaluasi sistem.`,
  'Trip completion: trip COMPLETED dibagi (COMPLETED + CANCELLED) untuk kendaraan milik vendor terkait pada periode evaluasi.',
  'Availability: proporsi kendaraan vendor non-INACTIVE yang berstatus AVAILABLE/ASSIGNED saat evaluasi dijalankan.',
  'Response time: rata-rata menit dari assignedAt ke acceptedAt; target definisi kontrak dibaca sebagai batas maksimum.',
  'Nilai target, biaya kontrak, dan dokumen diambil dari data kontrak; sistem tidak mengisi nilai yang tidak tersedia.',
];

const contractSchema = z.object({
  vendorId: z.string().trim().min(1, 'Vendor wajib dipilih'),
  contractNumber: z.string().trim().min(3, 'Nomor kontrak wajib diisi').max(80),
  serviceScope: z.string().trim().max(300).optional().nullable(),
  startDate: z.coerce.date({ error: 'Tanggal mulai tidak valid' }),
  endDate: z.coerce.date({ error: 'Tanggal akhir tidak valid' }),
  monthlyValue: z.coerce.number().min(0).max(10_000_000_000).optional().nullable(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED']).optional(),
  documentRef: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  definitions: z
    .array(
      z.object({
        metric: z.enum(METRICS),
        target: z.coerce.number().min(0).max(100000),
        unit: z.string().trim().max(10).optional(),
        notes: z.string().trim().max(300).optional().nullable(),
      })
    )
    .optional(),
});

const updateSchema = contractSchema.partial().omit({ vendorId: true });

function parseRange(query) {
  const now = new Date();
  const rawTo = query.to ? new Date(query.to) : now;
  const to = String(query.to || '').length === 10 ? new Date(rawTo.getTime() + DAY_MS - 1) : rawTo;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 90 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, 'Rentang evaluasi tidak valid');
  if (from.getTime() > to.getTime()) throw new HttpError(400, 'Tanggal awal harus sebelum tanggal akhir');
  return { from, to };
}

function avg(values) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function pct(part, total) {
  if (!total) return null;
  return Number(((part / total) * 100).toFixed(1));
}

function evaluateMetric(definition, context) {
  const base = {
    id: definition.id,
    metric: definition.metric,
    label: METRIC_LABELS[definition.metric],
    target: definition.target,
    unit: definition.unit || '%',
    notes: definition.notes || null,
    value: null,
    achieved: null,
    evidenceCount: 0,
    evidence: [],
  };

  if (definition.metric === 'ON_TIME_DEPARTURE') {
    const trips = context.trips.filter((trip) => trip.startedAt);
    const scored = trips.map((trip) => {
      const lateMinutes = Math.round((new Date(trip.startedAt).getTime() - new Date(trip.booking.departureAt).getTime()) / 60000);
      return {
        tripId: trip.id,
        bookingCode: trip.booking.code,
        plateNumber: trip.vehicle?.plateNumber || null,
        startedAt: trip.startedAt,
        lateMinutes,
        onTime: lateMinutes <= ON_TIME_TOLERANCE_MIN,
      };
    });
    const onTime = scored.filter((item) => item.onTime).length;
    return {
      ...base,
      value: pct(onTime, scored.length),
      achieved: scored.length ? onTime / scored.length * 100 >= definition.target : null,
      evidenceCount: scored.length,
      evidence: scored.sort((a, b) => b.lateMinutes - a.lateMinutes).slice(0, 5),
      summary: `${onTime} dari ${scored.length} trip tepat waktu`,
    };
  }

  if (definition.metric === 'TRIP_COMPLETION') {
    const trips = context.trips.filter((trip) => ['COMPLETED', 'CANCELLED'].includes(trip.status));
    const completed = trips.filter((trip) => trip.status === 'COMPLETED').length;
    return {
      ...base,
      value: pct(completed, trips.length),
      achieved: trips.length ? completed / trips.length * 100 >= definition.target : null,
      evidenceCount: trips.length,
      evidence: trips
        .slice(0, 5)
        .map((trip) => ({ tripId: trip.id, bookingCode: trip.booking.code, plateNumber: trip.vehicle?.plateNumber || null, status: trip.status })),
      summary: `${completed} selesai dari ${trips.length} trip final`,
    };
  }

  if (definition.metric === 'AVAILABILITY') {
    const vehicles = context.vehicles.filter((vehicle) => vehicle.status !== 'INACTIVE');
    const available = vehicles.filter((vehicle) => ['AVAILABLE', 'ASSIGNED'].includes(vehicle.status)).length;
    return {
      ...base,
      value: pct(available, vehicles.length),
      achieved: vehicles.length ? available / vehicles.length * 100 >= definition.target : null,
      evidenceCount: vehicles.length,
      evidence: vehicles.slice(0, 5).map((vehicle) => ({ vehicleId: vehicle.id, plateNumber: vehicle.plateNumber, status: vehicle.status })),
      summary: `${available} dari ${vehicles.length} kendaraan tersedia`,
    };
  }

  const responded = context.trips
    .filter((trip) => trip.assignedAt && trip.acceptedAt)
    .map((trip) => {
      const minutes = Math.round((new Date(trip.acceptedAt).getTime() - new Date(trip.assignedAt).getTime()) / 60000);
      return { tripId: trip.id, bookingCode: trip.booking.code, plateNumber: trip.vehicle?.plateNumber || null, minutes };
    })
    .filter((item) => item.minutes >= 0);
  const average = avg(responded.map((item) => item.minutes));
  return {
    ...base,
    value: average,
    achieved: average != null ? average <= definition.target : null,
    evidenceCount: responded.length,
    evidence: responded.sort((a, b) => b.minutes - a.minutes).slice(0, 5),
    summary: average != null ? `Rata-rata ${average} menit dari ${responded.length} respons` : 'Belum ada data respons',
  };
}

async function loadOverview(from, to) {
  const [contracts, trips, vehicles] = await Promise.all([
    prisma.vendorContract.findMany({
      include: { vendor: { select: { id: true, name: true, active: true } }, slaDefinitions: { orderBy: { metric: 'asc' } } },
      orderBy: { endDate: 'asc' },
    }),
    prisma.trip.findMany({
      where: { booking: { departureAt: { gte: from, lte: to } } },
      select: {
        id: true,
        status: true,
        assignedAt: true,
        acceptedAt: true,
        startedAt: true,
        completedAt: true,
        vehicle: { select: { id: true, plateNumber: true, vendorId: true } },
        driver: { select: { id: true, name: true, vendorId: true } },
        booking: { select: { code: true, departureAt: true, returnAt: true } },
      },
      orderBy: { booking: { departureAt: 'asc' } },
    }),
    prisma.vehicle.findMany({ select: { id: true, plateNumber: true, status: true, vendorId: true } }),
  ]);

  const now = new Date();
  const evaluated = contracts.map((contract) => {
    const vendorTrips = trips.filter((trip) => trip.vehicle?.vendorId === contract.vendorId);
    const vendorVehicles = vehicles.filter((vehicle) => vehicle.vendorId === contract.vendorId);
    const definitions = contract.slaDefinitions;
    const metrics = definitions.map((definition) => evaluateMetric(definition, { trips: vendorTrips, vehicles: vendorVehicles }));
    const scored = metrics.filter((metric) => metric.value != null);
    const met = metrics.filter((metric) => metric.achieved === true);
    const missed = metrics.filter((metric) => metric.achieved === false);
    const noData = metrics.filter((metric) => metric.value == null);
    const compliancePct = scored.length ? Math.round((met.length / scored.length) * 100) : null;
    const daysToEnd = Math.ceil((new Date(contract.endDate).getTime() - now.getTime()) / DAY_MS);
    const expiringSoon = contract.status === 'ACTIVE' && daysToEnd >= 0 && daysToEnd <= EXPIRY_HORIZON_DAYS;
    const expiredActive = contract.status === 'ACTIVE' && daysToEnd < 0;

    const exceptions = [];
    for (const metric of missed) {
      exceptions.push({
        type: 'METRIC_BREACH',
        severity: 'HIGH',
        metric: metric.metric,
        message: `${metric.label} ${metric.value ?? '—'}${metric.unit} di bawah target ${metric.target}${metric.unit}`,
      });
    }
    for (const metric of noData) {
      exceptions.push({
        type: 'NO_DATA',
        severity: 'LOW',
        metric: metric.metric,
        message: `${metric.label} belum memiliki data bukti pada periode ini`,
      });
    }
    if (!definitions.length) {
      exceptions.push({ type: 'MISSING_DEFINITIONS', severity: 'MEDIUM', message: 'Kontrak belum memiliki definisi metrik SLA' });
    }
    if (expiringSoon) {
      exceptions.push({ type: 'EXPIRING', severity: 'MEDIUM', message: `Kontrak berakhir dalam ${daysToEnd} hari` });
    }
    if (expiredActive) {
      exceptions.push({ type: 'EXPIRED_ACTIVE', severity: 'HIGH', message: `Kontrak sudah lewat ${Math.abs(daysToEnd)} hari tetapi masih berstatus ACTIVE` });
    }
    if (!contract.vendor.active) {
      exceptions.push({ type: 'VENDOR_INACTIVE', severity: 'MEDIUM', message: 'Vendor terkait berstatus nonaktif' });
    }

    let scoreStatus = 'MEETS';
    if (missed.length) scoreStatus = 'BREACH';
    else if (!definitions.length || noData.length || expiringSoon || expiredActive) scoreStatus = 'AT_RISK';

    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      vendor: contract.vendor,
      serviceScope: contract.serviceScope,
      startDate: contract.startDate,
      endDate: contract.endDate,
      monthlyValue: contract.monthlyValue,
      status: contract.status,
      documentRef: contract.documentRef,
      notes: contract.notes,
      daysToEnd,
      expiringSoon,
      compliancePct,
      scoreStatus,
      metrics,
      exceptions,
      evidenceSummary: {
        trips: vendorTrips.length,
        activeTrips: vendorTrips.filter((trip) => ACTIVE_TRIP_STATUSES.includes(trip.status)).length,
        vehicles: vendorVehicles.length,
      },
    };
  });

  const active = evaluated.filter((contract) => contract.status === 'ACTIVE');
  const summary = {
    contracts: evaluated.length,
    active: active.length,
    meets: evaluated.filter((contract) => contract.scoreStatus === 'MEETS').length,
    atRisk: evaluated.filter((contract) => contract.scoreStatus === 'AT_RISK').length,
    breach: evaluated.filter((contract) => contract.scoreStatus === 'BREACH').length,
    expiringSoon: evaluated.filter((contract) => contract.expiringSoon).length,
    breaches: evaluated.reduce((sum, contract) => sum + contract.metrics.filter((metric) => metric.achieved === false).length, 0),
    evaluatedTrips: trips.length,
  };

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    generatedAt: now.toISOString(),
    rules: RULES,
    onTimeToleranceMinutes: ON_TIME_TOLERANCE_MIN,
    expiryHorizonDays: EXPIRY_HORIZON_DAYS,
    summary,
    contracts: evaluated,
  };
}

router.get('/overview', asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  res.json(await loadOverview(from, to));
}));

router.post('/contracts', asyncRoute(async (req, res) => {
  const data = contractSchema.parse(req.body);
  if (data.endDate.getTime() <= data.startDate.getTime()) throw new HttpError(400, 'Tanggal akhir harus setelah tanggal mulai');
  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor) throw new HttpError(404, 'Vendor tidak ditemukan');
  const duplicate = await prisma.vendorContract.findUnique({ where: { contractNumber: data.contractNumber } });
  if (duplicate) throw new HttpError(409, 'Nomor kontrak sudah digunakan');

  const metrics = data.definitions ? [...new Set(data.definitions.map((definition) => definition.metric))] : [];
  if (metrics.length !== (data.definitions?.length || 0)) throw new HttpError(400, 'Metrik SLA duplikat dalam satu kontrak');

  const contract = await prisma.vendorContract.create({
    data: {
      vendorId: data.vendorId,
      contractNumber: data.contractNumber,
      serviceScope: data.serviceScope || '',
      startDate: data.startDate,
      endDate: data.endDate,
      monthlyValue: data.monthlyValue ?? null,
      status: data.status || 'ACTIVE',
      documentRef: data.documentRef || null,
      notes: data.notes || null,
      slaDefinitions: {
        create: (data.definitions || []).map((definition) => ({
          metric: definition.metric,
          target: definition.target,
          unit: definition.unit || (definition.metric === 'RESPONSE_TIME' ? 'menit' : '%'),
          notes: definition.notes || null,
        })),
      },
    },
    include: { vendor: { select: { id: true, name: true } }, slaDefinitions: true },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'SLA_CONTRACT_CREATE',
    entity: 'VendorContract',
    entityId: contract.id,
    detail: `${contract.vendor.name}: ${contract.contractNumber}`,
  });
  res.status(201).json(contract);
}));

router.patch('/contracts/:id', asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const current = await prisma.vendorContract.findUnique({ where: { id: req.params.id }, include: { slaDefinitions: true } });
  if (!current) throw new HttpError(404, 'Kontrak tidak ditemukan');

  const startDate = data.startDate || current.startDate;
  const endDate = data.endDate || current.endDate;
  if (endDate.getTime() <= startDate.getTime()) throw new HttpError(400, 'Tanggal akhir harus setelah tanggal mulai');
  if (data.contractNumber && data.contractNumber !== current.contractNumber) {
    const duplicate = await prisma.vendorContract.findUnique({ where: { contractNumber: data.contractNumber } });
    if (duplicate) throw new HttpError(409, 'Nomor kontrak sudah digunakan');
  }
  const metricNames = data.definitions ? [...new Set(data.definitions.map((definition) => definition.metric))] : [];
  if (data.definitions && metricNames.length !== data.definitions.length) throw new HttpError(400, 'Metrik SLA duplikat dalam satu kontrak');

  const contract = await prisma.$transaction(async (tx) => {
    await tx.vendorContract.update({
      where: { id: current.id },
      data: {
        ...(data.contractNumber !== undefined ? { contractNumber: data.contractNumber } : {}),
        ...(data.serviceScope !== undefined ? { serviceScope: data.serviceScope || '' } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
        ...(data.monthlyValue !== undefined ? { monthlyValue: data.monthlyValue ?? null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.documentRef !== undefined ? { documentRef: data.documentRef || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      },
    });
    if (data.definitions) {
      await tx.slaDefinition.deleteMany({ where: { contractId: current.id, metric: { notIn: metricNames } } });
      for (const definition of data.definitions) {
        await tx.slaDefinition.upsert({
          where: { contractId_metric: { contractId: current.id, metric: definition.metric } },
          update: {
            target: definition.target,
            unit: definition.unit || (definition.metric === 'RESPONSE_TIME' ? 'menit' : '%'),
            notes: definition.notes || null,
          },
          create: {
            contractId: current.id,
            metric: definition.metric,
            target: definition.target,
            unit: definition.unit || (definition.metric === 'RESPONSE_TIME' ? 'menit' : '%'),
            notes: definition.notes || null,
          },
        });
      }
    }
    return tx.vendorContract.findUnique({
      where: { id: current.id },
      include: { vendor: { select: { id: true, name: true } }, slaDefinitions: { orderBy: { metric: 'asc' } } },
    });
  });
  await writeAudit({
    userId: req.user.id,
    action: 'SLA_CONTRACT_UPDATE',
    entity: 'VendorContract',
    entityId: contract.id,
    detail: `${contract.vendor.name}: ${contract.contractNumber} (${contract.status})`,
  });
  res.json(contract);
}));

export default router;
