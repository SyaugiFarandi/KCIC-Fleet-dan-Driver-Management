const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_DAYS = 120;
export const DUE_SOON_KM = 1000;
export const DUE_SOON_DAYS = 14;

const SEVERITY_PRIORITY = { LOW: 'LOW', MEDIUM: 'NORMAL', HIGH: 'HIGH', CRITICAL: 'URGENT' };

export const PREDICTION_RULES = [
  'Interval servis dan umur pakai diambil dari data kendaraan (serviceIntervalKm, serviceIntervalDays, lastServiceAt).',
  'KM sejak servis terakhir diestimasi dari selisih odometer transaksi BBM 120 hari terakhir dibagi rentang harinya.',
  'Status OVERDUE bila sisa KM atau sisa hari <= 0; DUE_SOON bila sisa KM <= 1.000 km atau sisa hari <= 14 hari.',
  'Prediksi bersifat rule-based tanpa model machine learning; kualitas estimasi ditandai tinggi/sedang/rendah sesuai jumlah sampel odometer.',
];

function priorityFor(status) {
  if (status === 'OVERDUE') return 'URGENT';
  if (status === 'DUE_SOON') return 'HIGH';
  if (status === 'UNKNOWN') return 'LOW';
  return 'NORMAL';
}

export function severityPriority(severity) {
  return SEVERITY_PRIORITY[severity] || 'NORMAL';
}

export function predictVehicle(vehicle, { samples = [], planned = [], now = new Date() } = {}) {
  const intervalKm = vehicle.serviceIntervalKm ?? 10000;
  const intervalDays = vehicle.serviceIntervalDays ?? 180;
  const openWorkOrder = planned.find((item) => item.status === 'IN_PROGRESS');
  const plannedWorkOrder = planned.find((item) => item.status === 'PLANNED');
  const base = {
    vehicleId: vehicle.id,
    plateNumber: vehicle.plateNumber,
    brand: vehicle.brand,
    model: vehicle.model,
    vehicleStatus: vehicle.status,
    odometerKm: vehicle.odometerKm,
    lastServiceAt: vehicle.lastServiceAt,
    serviceIntervalKm: intervalKm,
    serviceIntervalDays: intervalDays,
    hasOpenWorkOrder: Boolean(openWorkOrder),
    plannedWorkOrder: plannedWorkOrder ? { id: plannedWorkOrder.id, title: plannedWorkOrder.title, scheduledAt: plannedWorkOrder.scheduledAt } : null,
  };

  if (!vehicle.lastServiceAt) {
    return {
      ...base,
      status: 'UNKNOWN',
      priority: priorityFor('UNKNOWN'),
      confidence: 'LOW',
      daysSinceService: null,
      kmSinceService: null,
      remainingKm: null,
      remainingDays: null,
      estimatedDailyKm: null,
      reasons: ['Tanggal servis terakhir belum tercatat, prediksi berbasis waktu/km tidak dapat dihitung.'],
    };
  }

  const lastService = new Date(vehicle.lastServiceAt);
  const daysSinceService = Math.max(0, Math.floor((now.getTime() - lastService.getTime()) / DAY_MS));
  const sorted = [...samples]
    .filter((sample) => Number.isFinite(sample.odometerKm) && sample.transactionAt)
    .sort((a, b) => new Date(a.transactionAt).getTime() - new Date(b.transactionAt).getTime());

  let estimatedDailyKm = null;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const spanDays = Math.max(1, (new Date(last.transactionAt).getTime() - new Date(first.transactionAt).getTime()) / DAY_MS);
    const deltaKm = last.odometerKm - first.odometerKm;
    if (deltaKm > 0) estimatedDailyKm = deltaKm / spanDays;
  }

  const kmSinceService = estimatedDailyKm != null ? Math.round(estimatedDailyKm * daysSinceService) : null;
  const remainingKm = kmSinceService != null ? Math.round(intervalKm - kmSinceService) : null;
  const remainingDays = intervalDays - daysSinceService;

  const reasons = [];
  let status = 'OK';
  if (remainingDays <= 0) {
    status = 'OVERDUE';
    reasons.push(`Sudah ${daysSinceService} hari sejak servis terakhir, melewati interval ${intervalDays} hari.`);
  } else if (remainingDays <= DUE_SOON_DAYS) {
    status = 'DUE_SOON';
    reasons.push(`Servis berikutnya tinggal ${remainingDays} hari lagi (interval ${intervalDays} hari).`);
  }
  if (remainingKm != null && remainingKm <= 0) {
    status = 'OVERDUE';
    reasons.push(`Estimasi pemakaian ${kmSinceService?.toLocaleString('id-ID')} km sudah melewati interval ${intervalKm.toLocaleString('id-ID')} km.`);
  } else if (remainingKm != null && remainingKm <= DUE_SOON_KM && status === 'OK') {
    status = 'DUE_SOON';
    reasons.push(`Sisa estimasi ${remainingKm.toLocaleString('id-ID')} km menuju servis berikutnya.`);
  }
  if (estimatedDailyKm == null) {
    reasons.push('Sampel odometer BBM belum cukup, estimasi KM memakai basis waktu saja.');
  } else if (status === 'OK') {
    reasons.push(`Sisa estimasi ${remainingKm.toLocaleString('id-ID')} km dan ${remainingDays} hari, masih dalam interval.`);
  }

  const confidence = sorted.length >= 3 ? 'HIGH' : sorted.length === 2 ? 'MEDIUM' : 'LOW';

  return {
    ...base,
    status,
    priority: priorityFor(status),
    confidence,
    daysSinceService,
    kmSinceService,
    remainingKm,
    remainingDays,
    estimatedDailyKm: estimatedDailyKm != null ? Number(estimatedDailyKm.toFixed(1)) : null,
    reasons,
  };
}

export async function buildPredictions(client) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SAMPLE_DAYS * DAY_MS);
  const [vehicles, samples, workOrders] = await Promise.all([
    client.vehicle.findMany({
      where: { status: { not: 'INACTIVE' } },
      select: {
        id: true,
        plateNumber: true,
        brand: true,
        model: true,
        status: true,
        odometerKm: true,
        lastServiceAt: true,
        serviceIntervalKm: true,
        serviceIntervalDays: true,
      },
      orderBy: { plateNumber: 'asc' },
    }),
    client.fuelTransaction.findMany({
      where: { transactionAt: { gte: cutoff }, odometerKm: { not: null } },
      select: { vehicleId: true, odometerKm: true, transactionAt: true },
    }),
    client.maintenance.findMany({
      where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      select: { id: true, vehicleId: true, title: true, status: true, scheduledAt: true },
    }),
  ]);

  const samplesByVehicle = new Map();
  for (const sample of samples) {
    const list = samplesByVehicle.get(sample.vehicleId) || [];
    list.push(sample);
    samplesByVehicle.set(sample.vehicleId, list);
  }
  const workOrdersByVehicle = new Map();
  for (const order of workOrders) {
    const list = workOrdersByVehicle.get(order.vehicleId) || [];
    list.push(order);
    workOrdersByVehicle.set(order.vehicleId, list);
  }

  const order = { OVERDUE: 0, DUE_SOON: 1, UNKNOWN: 2, OK: 3 };
  const items = vehicles
    .map((vehicle) =>
      predictVehicle(vehicle, {
        samples: samplesByVehicle.get(vehicle.id) || [],
        planned: workOrdersByVehicle.get(vehicle.id) || [],
        now,
      })
    )
    .sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      const aKm = a.remainingKm ?? Number.POSITIVE_INFINITY;
      const bKm = b.remainingKm ?? Number.POSITIVE_INFINITY;
      return aKm - bKm;
    });

  const summary = {
    vehicles: items.length,
    overdue: items.filter((item) => item.status === 'OVERDUE').length,
    dueSoon: items.filter((item) => item.status === 'DUE_SOON').length,
    ok: items.filter((item) => item.status === 'OK').length,
    unknown: items.filter((item) => item.status === 'UNKNOWN').length,
    withoutWorkOrder: items.filter((item) => ['OVERDUE', 'DUE_SOON'].includes(item.status) && !item.plannedWorkOrder && !item.hasOpenWorkOrder).length,
  };

  return {
    generatedAt: now.toISOString(),
    sampleWindowDays: SAMPLE_DAYS,
    serviceIntervals: { km: 'default 10.000 km', days: 'default 180 hari' },
    rules: PREDICTION_RULES,
    summary,
    items,
  };
}
