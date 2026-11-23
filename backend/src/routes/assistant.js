import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { buildPredictions } from '../lib/maintenancePrediction.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';

const router = express.Router();
router.use(requirePermission('assistant:ask'));

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const DISCLAIMER =
  'Asisten ini rule-based dan hanya-baca: jawaban dihitung dari database DEMO dengan aturan kata kunci, bukan model bahasa atau AI generatif. Tidak ada aksi tulis yang dijalankan dari percakapan ini.';

const SUGGESTIONS = [
  { id: 'fleet', label: 'Ringkas status armada', question: 'Ringkas status armada saat ini' },
  { id: 'maintenance', label: 'Kendaraan yang perlu servis', question: 'Kendaraan mana yang perlu servis?' },
  { id: 'bookings', label: 'Booking menunggu persetujuan', question: 'Booking apa yang menunggu persetujuan?' },
  { id: 'trips', label: 'Trip sedang berjalan', question: 'Trip apa yang sedang berjalan?' },
  { id: 'fuel', label: 'Anomali bahan bakar', question: 'Bagaimana kondisi transaksi bahan bakar?' },
  { id: 'inspection', label: 'Defect & inspeksi', question: 'Ada defect kritis atau inspeksi gagal?' },
  { id: 'emergency', label: 'Status transport darurat', question: 'Bagaimana status transport darurat?' },
  { id: 'vendor', label: 'Kontrak vendor', question: 'Kontrak vendor mana yang mendekati berakhir?' },
];

const INTENT_KEYWORDS = [
  ['emergency', ['darurat', 'emergency', 'evakuasi']],
  ['maintenance', ['maintenance', 'servis', 'perawatan', 'bengkel', 'prediksi', 'rusak', 'work order']],
  ['inspection', ['inspeksi', 'defect', 'cacat', 'kelayakan', 'pre-trip', 'pretrip']],
  ['fuel', ['bbm', 'bahan bakar', 'fuel', 'solar', 'pertalite', 'anomali', 'spbu']],
  ['bookings', ['booking', 'pemesanan', 'persetujuan', 'approval', 'menunggu', 'pending']],
  ['trips', ['trip', 'perjalanan', 'berjalan', 'aktif', 'mengemudi']],
  ['vendor', ['vendor', 'kontrak', 'sla', 'mitra', 'sewa']],
  ['drivers', ['driver', 'pengemudi', 'sim', 'lisensi', 'tersedia']],
  ['fleet', ['armada', 'kendaraan', 'fleet', 'mobil', 'status', 'ringkas', 'ringkasan']],
  ['help', ['bantuan', 'help', 'bisa apa', 'halo', 'hai', 'menu']],
];

function classify(question) {
  const text = question.toLowerCase();
  for (const [intent, words] of INTENT_KEYWORDS) {
    if (words.some((word) => text.includes(word))) return intent;
  }
  return 'help';
}

const fmtDate = (value) =>
  value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const rupiah = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;

function reply(intent, payload) {
  return {
    intent,
    engine: 'RULE_BASED',
    readOnly: true,
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    ...payload,
  };
}

async function answerFleet() {
  const [vehicles, drivers, activeTrips, pendingBookings, openWorkOrders] = await Promise.all([
    prisma.vehicle.findMany({ select: { status: true } }),
    prisma.driver.findMany({ where: { active: true }, select: { available: true } }),
    prisma.trip.count({ where: { status: { in: ACTIVE_TRIP_STATUSES } } }),
    prisma.booking.count({ where: { status: 'PENDING' } }),
    prisma.maintenance.count({ where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } } }),
  ]);
  const byStatus = { AVAILABLE: 0, ASSIGNED: 0, MAINTENANCE: 0, INACTIVE: 0 };
  for (const vehicle of vehicles) byStatus[vehicle.status] += 1;
  const availableDrivers = drivers.filter((driver) => driver.available).length;
  return reply('fleet', {
    title: 'Ringkasan armada',
    answer: `Ada ${vehicles.length} kendaraan terdaftar: ${byStatus.AVAILABLE} tersedia, ${byStatus.ASSIGNED} ditugaskan, ${byStatus.MAINTENANCE} di maintenance, ${byStatus.INACTIVE} nonaktif. ${activeTrips} trip sedang berjalan dan ${pendingBookings} booking menunggu persetujuan.`,
    bullets: [
      `Driver aktif siap ditugaskan: ${availableDrivers} dari ${drivers.length}`,
      `Work order terbuka (PLANNED/IN_PROGRESS): ${openWorkOrders}`,
      pendingBookings > 0 ? 'Buka modul Booking untuk memutuskan permintaan yang menunggu.' : 'Tidak ada booking yang menunggu keputusan.',
    ],
    sources: ['Vehicle', 'Driver', 'Trip', 'Booking', 'Maintenance'],
  });
}

async function answerMaintenance() {
  const predictions = await buildPredictions(prisma);
  const overdue = predictions.items.filter((item) => item.status === 'OVERDUE');
  const dueSoon = predictions.items.filter((item) => item.status === 'DUE_SOON');
  const openOrders = await prisma.maintenance.findMany({
    where: { status: { in: ['PLANNED', 'IN_PROGRESS'] }, scheduledAt: { lt: new Date() } },
    include: { vehicle: { select: { plateNumber: true } } },
    orderBy: { scheduledAt: 'asc' },
    take: 5,
  });
  const bullets = [
    ...overdue.slice(0, 3).map((item) => `${item.plateNumber} — ${item.reasons?.[0] || 'melewati interval servis'}`),
    ...openOrders.map((item) => `Work order terlambat: ${item.vehicle.plateNumber} — ${item.title} (jadwal ${fmtDate(item.scheduledAt)})`),
  ].slice(0, 6);
  return reply('maintenance', {
    title: 'Prediksi maintenance (aturan)',
    answer:
      overdue.length > 0
        ? `${overdue.length} kendaraan melewati interval servis dan ${dueSoon.length} mendekati jatuh tempo. ${openOrders.length} work order melewati jadwal.`
        : `Tidak ada kendaraan yang melewati interval; ${dueSoon.length} mendekati jatuh tempo dan ${openOrders.length} work order melewati jadwal.`,
    bullets: bullets.length ? bullets : ['Semua kendaraan dalam interval servis menurut data kilometer dan tanggal demo.'],
    sources: ['Vehicle', 'FuelTransaction', 'Maintenance'],
  });
}

async function answerBookings() {
  const now = new Date();
  const [pending, total] = await Promise.all([
    prisma.booking.findMany({
      where: { status: 'PENDING' },
      include: { requester: { select: { name: true } } },
      orderBy: { departureAt: 'asc' },
      take: 5,
    }),
    prisma.booking.count({ where: { status: 'PENDING' } }),
  ]);
  const oldest = pending[0];
  return reply('bookings', {
    title: 'Booking menunggu persetujuan',
    answer:
      total > 0
        ? `Ada ${total} booking menunggu keputusan. Yang paling dekat keberangkatannya: ${oldest.code} (${oldest.origin} → ${oldest.destination}) pada ${fmtDate(oldest.departureAt)}.`
        : 'Tidak ada booking yang menunggu persetujuan saat ini.',
    bullets: pending.map(
      (booking) =>
        `${booking.code} — ${booking.origin} → ${booking.destination} · ${fmtDate(booking.departureAt)} · ${booking.passengerCount} pax · ${booking.requester?.name || 'pemohon'}`
    ),
    sources: ['Booking', 'User'],
    meta: { checkedAt: now.toISOString() },
  });
}

async function answerTrips() {
  const trips = await prisma.trip.findMany({
    where: { status: { in: ACTIVE_TRIP_STATUSES } },
    include: {
      booking: { select: { code: true, origin: true, destination: true, departureAt: true } },
      vehicle: { select: { plateNumber: true } },
      driver: { select: { name: true } },
    },
    orderBy: { booking: { departureAt: 'asc' } },
    take: 6,
  });
  return reply('trips', {
    title: 'Trip sedang berjalan',
    answer:
      trips.length > 0
        ? `Ada ${trips.length} trip aktif (SCHEDULED, DRIVER_ACCEPTED, PICKED_UP, atau IN_PROGRESS). Pantau posisi lewat GPS Monitoring.`
        : 'Tidak ada trip aktif saat ini.',
    bullets: trips.map(
      (trip) =>
        `${trip.booking.code} — ${trip.booking.origin} → ${trip.booking.destination} · ${trip.vehicle.plateNumber} · ${trip.driver.name} · ${trip.status}`
    ),
    sources: ['Trip', 'Booking', 'Vehicle', 'Driver'],
  });
}

async function answerDrivers() {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * DAY_MS);
  const drivers = await prisma.driver.findMany({
    where: { active: true },
    select: { name: true, available: true, licenseExpiry: true },
  });
  const available = drivers.filter((driver) => driver.available).length;
  const expiring = drivers.filter((driver) => {
    const expiry = new Date(driver.licenseExpiry).getTime();
    return expiry <= soon.getTime();
  });
  return reply('drivers', {
    title: 'Kesiapan driver',
    answer: `${available} dari ${drivers.length} driver aktif siap ditugaskan. ${expiring.length} driver memiliki SIM yang sudah/akan kedaluwarsa dalam 30 hari.`,
    bullets: expiring.slice(0, 6).map((driver) => `${driver.name} — SIM berakhir ${fmtDate(driver.licenseExpiry)}`),
    sources: ['Driver'],
  });
}

async function answerFuel() {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [transactions, flagged] = await Promise.all([
    prisma.fuelTransaction.findMany({ where: { transactionAt: { gte: since } }, select: { totalCost: true, liters: true } }),
    prisma.fuelTransaction.findMany({
      where: { transactionAt: { gte: since }, anomalyStatus: 'FLAGGED' },
      include: { vehicle: { select: { plateNumber: true } } },
      orderBy: { transactionAt: 'desc' },
      take: 5,
    }),
  ]);
  const totalCost = transactions.reduce((sum, item) => sum + (item.totalCost || 0), 0);
  const totalLiters = transactions.reduce((sum, item) => sum + (item.liters || 0), 0);
  return reply('fuel', {
    title: 'Transaksi bahan bakar 30 hari',
    answer: `${transactions.length} transaksi BBM tercatat dengan total ${rupiah(totalCost)} (${totalLiters.toFixed(1)} liter). ${flagged.length} transaksi ditandai anomali dan perlu review.`,
    bullets: flagged.map(
      (item) => `${item.vehicle.plateNumber} — ${fmtDate(item.transactionAt)} · ${item.liters} L · ${rupiah(item.totalCost)}`
    ),
    sources: ['FuelTransaction', 'Vehicle'],
  });
}

async function answerInspection() {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [inspections, defects] = await Promise.all([
    prisma.inspection.findMany({ where: { createdAt: { gte: since } }, select: { status: true } }),
    prisma.defect.findMany({
      where: { status: { in: ['OPEN', 'IN_REPAIR'] } },
      include: { vehicle: { select: { plateNumber: true } } },
      orderBy: [{ severity: 'desc' }, { reportedAt: 'asc' }],
      take: 6,
    }),
  ]);
  const byStatus = { DRAFT: 0, PASSED: 0, DEFECTS: 0, FAILED: 0 };
  for (const item of inspections) byStatus[item.status] += 1;
  const completed = byStatus.PASSED + byStatus.DEFECTS + byStatus.FAILED;
  const passRate = completed ? Math.round((byStatus.PASSED / completed) * 100) : null;
  return reply('inspection', {
    title: 'Kualitas inspeksi & defect',
    answer:
      completed > 0
        ? `Dari ${completed} inspeksi selesai dalam 30 hari, ${byStatus.PASSED} lulus (${passRate}%), ${byStatus.DEFECTS} menemukan defect, dan ${byStatus.FAILED} gagal. Saat ini ada ${defects.length} defect terbuka/dalam perbaikan.`
        : `Belum ada inspeksi selesai dalam 30 hari. Saat ini ada ${defects.length} defect terbuka/dalam perbaikan.`,
    bullets: defects.map(
      (defect) => `${defect.vehicle.plateNumber} — ${defect.title} (${defect.severity}, ${defect.status})`
    ),
    sources: ['Inspection', 'Defect', 'Vehicle'],
  });
}

async function answerEmergency() {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const emergencies = await prisma.booking.findMany({
    where: { priority: 'EMERGENCY', createdAt: { gte: since } },
    include: { trip: { select: { id: true, status: true, assignedAt: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const pending = emergencies.filter((booking) => booking.status === 'PENDING');
  const approvedUnassigned = emergencies.filter((booking) => booking.status === 'APPROVED' && !booking.trip);
  const decided = emergencies.filter((booking) => booking.decidedAt);
  const avgApproval = decided.length
    ? Math.round(
        decided.reduce((sum, booking) => sum + (new Date(booking.decidedAt).getTime() - new Date(booking.createdAt).getTime()) / MINUTE_MS, 0) /
          decided.length
      )
    : null;
  return reply('emergency', {
    title: 'Status transport darurat',
    answer:
      emergencies.length > 0
        ? `Ada ${emergencies.length} permintaan darurat dalam 30 hari: ${pending.length} menunggu keputusan dan ${approvedUnassigned.length} disetujui namun belum ditugaskan.${avgApproval !== null ? ` Rata-rata keputusan ${avgApproval} menit.` : ''}`
        : 'Belum ada permintaan transport darurat dalam 30 hari.',
    bullets: [...pending, ...approvedUnassigned]
      .slice(0, 6)
      .map((booking) => `${booking.code} — ${booking.origin} → ${booking.destination} · ${booking.status}`),
    sources: ['Booking', 'Trip'],
  });
}

async function answerVendor() {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * DAY_MS);
  const [vendors, contracts] = await Promise.all([
    prisma.vendor.findMany({ where: { active: true }, select: { id: true } }),
    prisma.vendorContract.findMany({
      where: { status: 'ACTIVE', endDate: { lte: soon } },
      include: { vendor: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
      take: 6,
    }),
  ]);
  return reply('vendor', {
    title: 'Kontrak vendor',
    answer:
      contracts.length > 0
        ? `${contracts.length} kontrak vendor aktif berakhir dalam 30 hari atau sudah lewat. Tersedia ${vendors.length} vendor aktif di master data.`
        : `Tidak ada kontrak vendor aktif yang berakhir dalam 30 hari. Tersedia ${vendors.length} vendor aktif.`,
    bullets: contracts.map(
      (contract) => `${contract.vendor.name} — ${contract.contractNumber} · berakhir ${fmtDate(contract.endDate)}`
    ),
    sources: ['Vendor', 'VendorContract'],
  });
}

function answerHelp() {
  return reply('help', {
    title: 'Yang bisa saya bantu',
    answer:
      'Saya menjawab pertanyaan operasional dari data DEMO dengan aturan kata kunci dan hanya-baca. Pilih salah satu topik atau tulis pertanyaan yang menyebut topik tersebut.',
    bullets: SUGGESTIONS.map((item) => `${item.label} — "${item.question}"`),
    sources: [],
  });
}

const handlers = {
  fleet: answerFleet,
  maintenance: answerMaintenance,
  bookings: answerBookings,
  trips: answerTrips,
  drivers: answerDrivers,
  fuel: answerFuel,
  inspection: answerInspection,
  emergency: answerEmergency,
  vendor: answerVendor,
  help: answerHelp,
};

router.get('/suggestions', (req, res) => {
  res.json({
    suggestions: SUGGESTIONS,
    disclaimer: DISCLAIMER,
    role: req.user.role,
  });
});

const querySchema = z.object({
  question: z.string().trim().min(3, 'Pertanyaan minimal 3 karakter').max(300, 'Pertanyaan maksimal 300 karakter'),
});

router.post('/query', asyncRoute(async (req, res) => {
  const { question } = querySchema.parse(req.body);
  const intent = classify(question);
  const handler = handlers[intent] || answerHelp;
  const result = await handler();
  res.json({ question, role: req.user.role, ...result });
}));

export default router;
