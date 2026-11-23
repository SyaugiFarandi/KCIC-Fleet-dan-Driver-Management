import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission, can } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

const router = express.Router();

const include = {
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, ownership: true } },
  driver: { select: { id: true, name: true } },
  trip: { select: { id: true, booking: { select: { code: true } } } },
  reviewedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

const createSchema = z.object({
  vehicleId: z.string().trim().optional(),
  driverId: z.string().trim().optional().nullable(),
  tripId: z.string().trim().optional().nullable(),
  fuelType: z.string().trim().min(2).max(30).default('BIOSOLAR'),
  transactionAt: z.coerce.date().optional(),
  liters: z.coerce.number().positive('Volume harus lebih dari 0').max(500, 'Volume tidak wajar'),
  pricePerLiter: z.coerce.number().positive().max(100000).optional(),
  odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional().nullable(),
  paymentMethod: z.enum(['FUEL_CARD', 'VENDOR_CARD', 'CASH', 'TRANSFER']).default('FUEL_CARD'),
  cardRef: z.string().trim().max(60).optional().nullable(),
  station: z.string().trim().max(120).optional().nullable(),
});

export async function detectFuelAnomaly({ vehicleId, fuelType, liters, pricePerLiter, odometerKm }) {
  const reasons = [];
  const reference = await prisma.fuelPrice.findUnique({ where: { fuelType } });
  if (reference && pricePerLiter > reference.pricePerLiter * 1.15) {
    const pct = Math.round(((pricePerLiter - reference.pricePerLiter) / reference.pricePerLiter) * 100);
    reasons.push(`Harga per liter ${pct}% di atas referensi ${reference.fuelType}`);
  }
  if (liters > 100) reasons.push(`Volume ${liters} L di atas batas wajar 100 L`);
  if (odometerKm != null) {
    const previous = await prisma.fuelTransaction.findFirst({
      where: { vehicleId, odometerKm: { not: null } },
      orderBy: { transactionAt: 'desc' },
      select: { odometerKm: true, transactionAt: true },
    });
    if (previous?.odometerKm != null && odometerKm <= previous.odometerKm) {
      reasons.push(`Odometer ${odometerKm} km tidak lebih tinggi dari catatan sebelumnya (${previous.odometerKm} km)`);
    }
  }
  return { flagged: reasons.length > 0, note: reasons.join('; ') || null };
}

function rangeFilter(from, to) {
  if (!from && !to) return {};
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) throw new HttpError(400, 'Tanggal awal tidak valid');
  if (toDate && Number.isNaN(toDate.getTime())) throw new HttpError(400, 'Tanggal akhir tidak valid');
  if (fromDate && toDate && fromDate > toDate) throw new HttpError(400, 'Rentang tanggal tidak valid');
  return {
    transactionAt: {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    },
  };
}

router.get('/', requirePermission('fuel:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, anomalyStatus, paymentMethod, vehicleId, from, to } = req.query;
  const where = {
    ...rangeFilter(from, to),
    ...(anomalyStatus ? { anomalyStatus } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(q
      ? {
          OR: [
            { vehicle: { is: { plateNumber: { contains: q, mode: 'insensitive' } } } },
            { driver: { is: { name: { contains: q, mode: 'insensitive' } } } },
            { station: { contains: q, mode: 'insensitive' } },
            { cardRef: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.fuelTransaction.findMany({ where, include, orderBy: { transactionAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.fuelTransaction.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/prices', requirePermission('fuel:read'), asyncRoute(async (req, res) => {
  const items = await prisma.fuelPrice.findMany({ orderBy: { fuelType: 'asc' } });
  res.json({ items });
}));

router.get('/summary', requirePermission('fuel:read'), asyncRoute(async (req, res) => {
  const { from, to } = req.query;
  const range = rangeFilter(from, to);
  const items = await prisma.fuelTransaction.findMany({
    where: range,
    include: { vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } } },
    orderBy: { transactionAt: 'asc' },
    take: 5000,
  });

  const totals = { transactions: items.length, liters: 0, cost: 0, avgPricePerLiter: 0, flagged: 0, approved: 0 };
  const byVehicle = new Map();
  const byPaymentMethod = {};
  const byFuelType = {};
  const daily = new Map();

  for (const item of items) {
    totals.liters += item.liters;
    totals.cost += item.totalCost;
    if (item.anomalyStatus === 'FLAGGED') totals.flagged += 1;
    if (item.anomalyStatus === 'APPROVED') totals.approved += 1;

    byPaymentMethod[item.paymentMethod] = byPaymentMethod[item.paymentMethod] || { count: 0, cost: 0, liters: 0 };
    byPaymentMethod[item.paymentMethod].count += 1;
    byPaymentMethod[item.paymentMethod].cost += item.totalCost;
    byPaymentMethod[item.paymentMethod].liters += item.liters;

    byFuelType[item.fuelType] = byFuelType[item.fuelType] || { count: 0, cost: 0, liters: 0 };
    byFuelType[item.fuelType].count += 1;
    byFuelType[item.fuelType].cost += item.totalCost;
    byFuelType[item.fuelType].liters += item.liters;

    const vehicleEntry = byVehicle.get(item.vehicleId) || {
      vehicleId: item.vehicleId,
      plateNumber: item.vehicle.plateNumber,
      label: `${item.vehicle.plateNumber} · ${item.vehicle.brand} ${item.vehicle.model}`,
      transactions: 0,
      liters: 0,
      cost: 0,
      minOdometer: null,
      maxOdometer: null,
    };
    vehicleEntry.transactions += 1;
    vehicleEntry.liters += item.liters;
    vehicleEntry.cost += item.totalCost;
    if (item.odometerKm != null) {
      vehicleEntry.minOdometer = vehicleEntry.minOdometer == null ? item.odometerKm : Math.min(vehicleEntry.minOdometer, item.odometerKm);
      vehicleEntry.maxOdometer = vehicleEntry.maxOdometer == null ? item.odometerKm : Math.max(vehicleEntry.maxOdometer, item.odometerKm);
    }
    byVehicle.set(item.vehicleId, vehicleEntry);

    const day = item.transactionAt.toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + item.totalCost);
  }

  totals.avgPricePerLiter = totals.liters > 0 ? totals.cost / totals.liters : 0;

  const vehicles = [...byVehicle.values()]
    .map((entry) => {
      const distanceKm =
        entry.minOdometer != null && entry.maxOdometer != null ? Math.max(0, entry.maxOdometer - entry.minOdometer) : null;
      return {
        ...entry,
        distanceKm,
        kmPerLiter: distanceKm != null && entry.liters > 0 ? distanceKm / entry.liters : null,
        costPerKm: distanceKm != null && distanceKm > 0 ? entry.cost / distanceKm : null,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const flaggedItems = await prisma.fuelTransaction.findMany({
    where: { ...range, anomalyStatus: 'FLAGGED' },
    include,
    orderBy: { transactionAt: 'desc' },
    take: 5,
  });

  res.json({
    totals,
    byVehicle: vehicles,
    byPaymentMethod,
    byFuelType,
    daily: [...daily.entries()].map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date)),
    flaggedItems,
    range: { from: req.query.from || null, to: req.query.to || null },
    disclaimer: 'Data bahan bakar berasal dari seed/simulasi DEMO, bukan transaksi resmi KCIC.',
  });
}));

router.post('/', asyncRoute(async (req, res) => {
  const isDriver = req.user.role === 'DRIVER';
  if (!isDriver && !can(req.user.role, 'fuel:write')) {
    throw new HttpError(403, 'Anda tidak memiliki akses untuk mencatat transaksi bahan bakar');
  }
  const data = createSchema.parse(req.body);

  let vehicleId = data.vehicleId;
  let driverId = data.driverId || null;
  let tripId = data.tripId || null;

  if (isDriver) {
    if (!data.tripId) throw new HttpError(400, 'Driver wajib memilih trip untuk pengajuan bahan bakar');
    const trip = await prisma.trip.findUnique({ where: { id: data.tripId }, include: { driver: true } });
    if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');
    if (trip.driver?.userId !== req.user.id) throw new HttpError(403, 'Anda hanya dapat mengajukan bahan bakar untuk trip sendiri');
    vehicleId = trip.vehicleId;
    driverId = trip.driverId;
    tripId = trip.id;
  }

  if (!vehicleId) throw new HttpError(400, 'Kendaraan wajib dipilih');
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (vehicle.status === 'INACTIVE') throw new HttpError(409, 'Kendaraan tidak aktif');

  if (driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new HttpError(404, 'Driver tidak ditemukan');
  }

  const price = data.pricePerLiter ?? (await prisma.fuelPrice.findUnique({ where: { fuelType: data.fuelType } }))?.pricePerLiter;
  if (!price) throw new HttpError(400, 'Harga BBM referensi belum tersedia untuk jenis ini');

  const transactionAt = data.transactionAt || new Date();
  const anomaly = await detectFuelAnomaly({
    vehicleId,
    fuelType: data.fuelType,
    liters: data.liters,
    pricePerLiter: price,
    odometerKm: data.odometerKm,
  });

  const item = await prisma.fuelTransaction.create({
    data: {
      vehicleId,
      driverId,
      tripId,
      fuelType: data.fuelType,
      transactionAt,
      liters: data.liters,
      pricePerLiter: price,
      totalCost: Math.round(data.liters * price),
      odometerKm: data.odometerKm ?? null,
      paymentMethod: isDriver ? 'FUEL_CARD' : data.paymentMethod,
      cardRef: data.cardRef || null,
      station: data.station || null,
      anomalyStatus: anomaly.flagged ? 'FLAGGED' : 'NONE',
      anomalyNote: anomaly.note,
      createdById: req.user.id,
    },
    include,
  });

  if (data.odometerKm != null && (vehicle.odometerKm == null || data.odometerKm > vehicle.odometerKm)) {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: data.odometerKm } });
  }

  await writeAudit({
    userId: req.user.id,
    action: isDriver ? 'FUEL_SUBMIT' : 'FUEL_CREATE',
    entity: 'FuelTransaction',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.liters} L ${item.fuelType}${anomaly.flagged ? ' (anomali)' : ''}`,
  });

  res.status(201).json(item);
}));

router.patch('/:id/review', requirePermission('fuel:review'), asyncRoute(async (req, res) => {
  const schema = z.object({
    decision: z.enum(['APPROVE', 'CLEAR'], { error: 'Keputusan review tidak valid' }),
    note: z.string().trim().max(300).optional(),
  });
  const { decision, note } = schema.parse(req.body);
  const item = await prisma.fuelTransaction.findUnique({ where: { id: req.params.id }, include });
  if (!item) throw new HttpError(404, 'Transaksi bahan bakar tidak ditemukan');
  if (item.anomalyStatus !== 'FLAGGED') throw new HttpError(409, 'Hanya transaksi berstatus anomali yang dapat direview');

  const updated = await prisma.fuelTransaction.update({
    where: { id: item.id },
    data: {
      anomalyStatus: decision === 'APPROVE' ? 'APPROVED' : 'NONE',
      anomalyNote: note ? `${item.anomalyNote || ''}${item.anomalyNote ? ' — ' : ''}Review: ${note}` : item.anomalyNote,
      reviewedById: req.user.id,
      reviewedAt: new Date(),
    },
    include,
  });
  await writeAudit({
    userId: req.user.id,
    action: decision === 'APPROVE' ? 'FUEL_ANOMALY_APPROVE' : 'FUEL_ANOMALY_CLEAR',
    entity: 'FuelTransaction',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.liters} L${note ? ` — ${note}` : ''}`,
  });
  res.json(updated);
}));

router.patch('/prices/:fuelType', requirePermission('fuel:write'), asyncRoute(async (req, res) => {
  const schema = z.object({
    pricePerLiter: z.coerce.number().positive().max(100000),
    notes: z.string().trim().max(200).optional().nullable(),
  });
  const data = schema.parse(req.body);
  const existing = await prisma.fuelPrice.findUnique({ where: { fuelType: req.params.fuelType } });
  if (!existing) throw new HttpError(404, 'Jenis bahan bakar tidak ditemukan');
  const updated = await prisma.fuelPrice.update({
    where: { fuelType: existing.fuelType },
    data: { pricePerLiter: data.pricePerLiter, notes: data.notes ?? existing.notes, effectiveFrom: new Date() },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'FUEL_PRICE_UPDATE',
    entity: 'FuelPrice',
    entityId: updated.id,
    detail: `${updated.fuelType}: ${data.pricePerLiter}/L`,
  });
  res.json(updated);
}));

export default router;
